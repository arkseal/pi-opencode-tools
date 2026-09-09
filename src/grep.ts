import { execFile } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { promisify } from "node:util";

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

  const requestedPath = params.path
    ? path.isAbsolute(params.path)
      ? params.path
      : path.resolve(directory, params.path)
    : directory;

  try {
    await fs.stat(requestedPath);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new Error(`Path does not exist: ${requestedPath}`);
    }
    throw err;
  }

  const args = [
    "-n",
    "--color=never",
    "--no-heading",
    "--hidden",
    "--glob",
    "!.git/**",
  ];

  if (params.include) {
    args.push("-g", params.include);
  }

  args.push("-e", params.pattern);
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
      stdout = await fallbackFsGrep(requestedPath, directory, params);
    }
  }

  const matches: MatchLine[] = [];
  const lines = stdout.split("\n");

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;

    // rg output format: <file>:<line>:<content>
    const match = rawLine.match(/^([^:]+):(\d+):(.*)$/);
    if (!match) continue;

    const [, filePath, lineStr, text] = match;
    const absPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(directory, filePath);
    const relPath = path.relative(directory, absPath).replaceAll("\\", "/");

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
  params: GrepParams
): Promise<string> {
  const results: string[] = [];
  const regex = new RegExp(params.pattern);

  async function searchFile(filePath: string) {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          results.push(`${filePath}:${i + 1}:${lines[i]}`);
        }
      }
    } catch {
      // ignore binary / unreadable
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
