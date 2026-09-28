import { execFile } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { promisify } from "node:util";
import {
  BINARY_EXTENSIONS,
  DEFAULT_IGNORED_DIRS,
  getExplicitDirs,
  shouldSkipDir,
  isBinaryOrZip,
  globToRegex,
  parsePattern,
  type ParsedPattern,
} from "./filters.js";

const execFileAsync = promisify(execFile);

export interface GrepParams {
  pattern: string;
  path?: string;
  include?: string;
}

export interface GrepResult {
  title: string;
  matches: number;
  truncated: boolean;
  output: string;
}

interface MatchLine {
  filePath: string;
  line: number;
  text: string;
}

export async function executeGrep(
  params: GrepParams,
  directory: string,
  limit = 100
): Promise<GrepResult> {
  if (!params.pattern) {
    throw new Error("pattern is required");
  }

  const parsed = parsePattern(params.pattern);

  const requestedPath = params.path
    ? path.isAbsolute(params.path)
      ? params.path
      : path.resolve(directory, params.path)
    : directory;

  let stat;
  try {
    stat = await fs.stat(requestedPath);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new Error(`Path does not exist: ${requestedPath}`);
    }
    throw err;
  }

  // If the target path itself is a file, skip if it's binary or a .zip file
  if (stat.isFile()) {
    if (await isBinaryOrZip(requestedPath)) {
      return {
        title: params.pattern,
        matches: 0,
        truncated: false,
        output: "No files found",
      };
    }
  }

  const explicitDirs = getExplicitDirs(params.path, params.include);

  const args = [
    "-n",
    "-H",
    "--color=never",
    "--no-heading",
    "--hidden",
    "--no-binary",
    "--glob",
    "!**/.git/**",
    "--glob",
    "!.git/**",
    "--glob",
    "!*.zip",
    "--glob",
    "!**/*.zip",
  ];

  if (parsed.ignoreCase) {
    args.push("-i");
  }

  for (const envDir of DEFAULT_IGNORED_DIRS) {
    if (!explicitDirs.has(envDir)) {
      args.push("--glob", `!**/${envDir}/**`);
      args.push("--glob", `!${envDir}/**`);
    }
  }

  if (params.include) {
    args.push("-g", params.include);
  }

  args.push("-e", parsed.pattern);
  args.push(requestedPath);

  let stdout = "";
  try {
    const res = await execFileAsync("rg", args, {
      cwd: directory,
      maxBuffer: 20 * 1024 * 1024,
    });
    stdout = res.stdout;
  } catch (err: any) {
    if (err?.code === 1) {
      stdout = "";
    } else {
      stdout = await fallbackFsGrep(requestedPath, directory, params, explicitDirs, parsed);
    }
  }

  const matches: MatchLine[] = [];
  const lines = stdout.split("\n");

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;

    // rg output format: <file>:<line>:<content>
    const match = rawLine.match(/^((?:[a-zA-Z]:)?[^:]+):(\d+):(.*)$/);
    if (!match) continue;

    const [, filePath, lineStr, text] = match;
    const absPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(directory, filePath);
    const relPath = path.relative(directory, absPath).replaceAll("\\", "/");

    // Skip if binary or zip by extension
    const ext = path.extname(relPath).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) {
      continue;
    }

    // Skip if matched inside an ignored env directory
    const segments = relPath.split("/");
    let skip = false;
    for (const segment of segments) {
      if (shouldSkipDir(segment, explicitDirs)) {
        skip = true;
        break;
      }
    }
    if (skip) continue;

    matches.push({
      filePath: relPath,
      line: parseInt(lineStr, 10),
      text,
    });
  }

  const totalMatches = matches.length;
  if (totalMatches === 0) {
    return {
      title: params.pattern,
      matches: 0,
      truncated: false,
      output: "No files found",
    };
  }

  const truncated = totalMatches > limit;
  const shownMatches = matches.slice(0, limit);

  const output: string[] = [
    `Found ${totalMatches} matches${truncated ? ` (showing first ${limit})` : ""}:`,
  ];

  let currentFile = "";
  for (const m of shownMatches) {
    if (currentFile !== m.filePath) {
      currentFile = m.filePath;
      output.push("");
      output.push(`${m.filePath}:`);
    }
    output.push(`  Line ${m.line}: ${m.text}`);
  }

  if (truncated) {
    output.push("");
    output.push(
      `(Results truncated. Consider using a more specific path or pattern.)`
    );
  }

  return {
    title: params.pattern,
    matches: Math.min(totalMatches, limit),
    truncated,
    output: output.join("\n"),
  };
}

async function fallbackFsGrep(
  targetPath: string,
  rootDirectory: string,
  params: GrepParams,
  explicitDirs: Set<string>,
  parsed: ParsedPattern
): Promise<string> {
  const results: string[] = [];
  const regexFlags = parsed.ignoreCase ? "i" : "";
  const regex = new RegExp(parsed.pattern, regexFlags);
  let quickTestRegex: RegExp | null = null;
  try {
    quickTestRegex = new RegExp(parsed.pattern, `m${regexFlags}`);
  } catch {
    quickTestRegex = null;
  }
  const includeRegex = params.include ? globToRegex(params.include) : null;

  async function searchFile(filePath: string) {
    if (includeRegex) {
      const fileName = path.basename(filePath);
      const rel = path.relative(rootDirectory, filePath).replaceAll("\\", "/");
      if (!includeRegex.test(fileName) && !includeRegex.test(rel)) {
        return;
      }
    }

    if (await isBinaryOrZip(filePath)) {
      return;
    }

    try {
      const content = await fs.readFile(filePath, "utf-8");
      // Fast pre-check before splitting into lines
      if (quickTestRegex && !quickTestRegex.test(content)) {
        return;
      }

      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          results.push(`${filePath}:${i + 1}:${lines[i]}`);
        }
      }
    } catch {
      // ignore unreadable
    }
  }

  const stat = await fs.stat(targetPath);
  if (stat.isFile()) {
    await searchFile(targetPath);
  } else {
    async function walk(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === ".git") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (shouldSkipDir(entry.name, explicitDirs)) continue;
          await walk(full);
        } else if (entry.isFile()) {
          await searchFile(full);
        }
      }
    }
    await walk(targetPath);
  }

  return results.join("\n");
}
