import * as fs from "node:fs/promises";
import * as path from "node:path";

export const DEFAULT_IGNORED_DIRS = [
  "node_modules",
  ".venv",
  "venv",
  "env",
  ".virtualenv",
  "virtualenv",
  ".conda",
  "conda-env",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  ".nox",
] as const;

export const BINARY_EXTENSIONS = new Set([
  // Archives & Compressed
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".bz2",
  ".tbz2",
  ".xz",
  ".txz",
  ".7z",
  ".rar",
  ".zst",
  ".lz4",
  ".lzma",
  ".iso",
  ".dmg",
  ".pkg",
  ".deb",
  ".rpm",
  ".apk",
  ".jar",
  ".war",
  ".ear",

  // Executables, Libraries, Object files
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".elf",
  ".o",
  ".obj",
  ".a",
  ".lib",
  ".out",
  ".app",

  // Bytecode & Compiled
  ".pyc",
  ".pyo",
  ".pyd",
  ".class",
  ".wasm",
  ".dex",

  // Images
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".tiff",
  ".tif",
  ".psd",
  ".ai",
  ".raw",
  ".heic",
  ".avif",

  // Audio & Video
  ".mp3",
  ".wav",
  ".ogg",
  ".flac",
  ".aac",
  ".m4a",
  ".wma",
  ".mp4",
  ".mkv",
  ".avi",
  ".mov",
  ".wmv",
  ".flv",
  ".webm",

  // Fonts
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",

  // Databases & Binary Data
  ".db",
  ".sqlite",
  ".sqlite3",
  ".db3",
  ".mdb",
  ".ldb",
  ".parquet",
  ".arrow",

  // Documents
  ".pdf",
  ".docx",
  ".xlsx",
  ".pptx",
]);

export function getExplicitDirs(...sources: (string | undefined)[]): Set<string> {
  const explicit = new Set<string>();

  for (const source of sources) {
    if (!source) continue;
    const normalized = source.replaceAll("\\", "/");
    for (const envDir of DEFAULT_IGNORED_DIRS) {
      const escaped = envDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`(^|[/])${escaped}([/]|$)`);
      if (regex.test(normalized)) {
        explicit.add(envDir);
      }
    }
  }

  return explicit;
}

export function shouldSkipDir(
  dirName: string,
  explicitDirs: Set<string>
): boolean {
  if (dirName === ".git") return true;
  if (explicitDirs.has(dirName)) return false;
  return DEFAULT_IGNORED_DIRS.includes(dirName as any);
}

export async function isBinaryOrZip(filePath: string): Promise<boolean> {
  const ext = path.extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) {
    return true;
  }

  let fd: fs.FileHandle | null = null;
  try {
    fd = await fs.open(filePath, "r");
    const stat = await fd.stat();
    if (stat.size === 0) return false;
    // Skip large files (> 20MB) to prevent reading massive binaries or dumps
    if (stat.size > 20 * 1024 * 1024) return true;

    const bufferSize = Math.min(4096, stat.size);
    const buffer = Buffer.alloc(bufferSize);
    const { bytesRead } = await fd.read(buffer, 0, bufferSize, 0);
    const slice = buffer.subarray(0, bytesRead);

    // Zip header magic number check (PK\x03\x04 or PK\x05\x06 or PK\x07\x08)
    if (
      slice.length >= 4 &&
      slice[0] === 0x50 &&
      slice[1] === 0x4b &&
      (slice[2] === 0x03 || slice[2] === 0x05 || slice[2] === 0x07)
    ) {
      return true;
    }

    // Standard binary check: NUL byte (0x00) anywhere in the first chunk
    return slice.includes(0);
  } catch {
    return true;
  } finally {
    await fd?.close();
  }
}

export function globToRegex(glob: string): RegExp {
  let res = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          res += "(?:.*/)?";
          i += 3;
          continue;
        } else {
          res += ".*";
          i += 2;
          continue;
        }
      } else {
        res += "[^/]*";
        i++;
        continue;
      }
    } else if (c === "?") {
      res += "[^/]";
      i++;
      continue;
    } else if (c === "{" && glob.includes("}", i)) {
      const close = glob.indexOf("}", i);
      const inner = glob.slice(i + 1, close);
      res += "(?:" + inner.split(",").map((s) => s.trim()).join("|") + ")";
      i = close + 1;
      continue;
    } else if (/[.+^$()[\]\\]/.test(c)) {
      res += "\\" + c;
      i++;
      continue;
    } else {
      res += c;
      i++;
      continue;
    }
  }
  return new RegExp(`^${res}$`, "i");
}

export interface ParsedPattern {
  raw: string;
  pattern: string;
  flags?: string;
  ignoreCase?: boolean;
}

export function parsePattern(input: string): ParsedPattern {
  const trimmed = input.trim();
  const match = trimmed.match(/^\/(.+)\/([a-z]*)$/);
  if (match) {
    const inner = match[1];
    const flags = match[2];
    if (/^[gimsuy]*$/.test(flags)) {
      const hasRegexMeta = /[\\^$*+?()[\]{}|]/.test(inner);
      const isPath = inner.includes("/") && !hasRegexMeta && flags === "";
      if (!isPath) {
        return {
          raw: input,
          pattern: inner,
          flags,
          ignoreCase: flags.includes("i"),
        };
      }
    }
  }

  return {
    raw: input,
    pattern: input,
    ignoreCase: false,
  };
}

