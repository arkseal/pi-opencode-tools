import { execFile } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GlobParams {
  pattern: string;
  path?: string;
}

export interface GlobResult {
  title: string;
  count: number;
  truncated: boolean;
  output: string;
}

export async function executeGlob(
  params: GlobParams,
  directory: string,
  limit = 100
): Promise<GlobResult> {
  const targetDir = params.path
    ? path.isAbsolute(params.path)
      ? params.path
      : path.resolve(directory, params.path)
    : directory;

  try {
    const stat = await fs.stat(targetDir);
    if (!stat.isDirectory()) {
      throw new Error(`glob path must be a directory: ${targetDir}`);
    }
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new Error(`Directory does not exist: ${targetDir}`);
    }
    throw err;
  }

  const args = [
    "--files",
    "--glob",
    params.pattern,
    "--hidden",
    "--glob",
    "!.git/**",
  ];

  let stdout = "";
  try {
    const res = await execFileAsync("rg", args, {
      cwd: targetDir,
      maxBuffer: 10 * 1024 * 1024,
    });
    stdout = res.stdout;
  } catch (err: any) {
    // Exit code 1 from rg means no matches found
    if (err?.code === 1) {
      stdout = "";
    } else {
      // Fallback if rg is not present: simple fs walk
      stdout = await fallbackFsGlob(targetDir, params.pattern);
    }
  }

  const rawLines = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const matchedPaths = rawLines.map((file) => {
    const absPath = path.isAbsolute(file) ? file : path.resolve(targetDir, file);
    return path.relative(directory, absPath).replaceAll("\\", "/");
  });

  const count = matchedPaths.length;
  if (count === 0) {
    return {
      title: path.relative(directory, targetDir) || ".",
      count: 0,
      truncated: false,
      output: "No files found",
    };
  }

  const truncated = count > limit;
  const displayPaths = matchedPaths.slice(0, limit);

  const outputLines = [...displayPaths];
  if (truncated) {
    outputLines.push("");
    outputLines.push(
      `(Results are truncated: showing first ${limit} results. Consider using a more specific path or pattern.)`
    );
  }

  return {
    title: path.relative(directory, targetDir) || ".",
    count: Math.min(count, limit),
    truncated,
    output: outputLines.join("\n"),
  };
}

async function fallbackFsGlob(dir: string, pattern: string): Promise<string> {
  const matches: string[] = [];
  const regex = globToRegex(pattern);

  async function walk(current: string) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const rel = path.relative(dir, full).replaceAll("\\", "/");
        if (regex.test(rel) || regex.test(entry.name)) {
          matches.push(rel);
        }
      }
    }
  }

  await walk(dir);
  return matches.join("\n");
}

function globToRegex(glob: string): RegExp {
  let escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ".*")
    .replace(/\*(?!\*)/g, "[^/]*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}
