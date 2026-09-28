import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  DEFAULT_IGNORED_DIRS,
  BINARY_EXTENSIONS,
  getExplicitDirs,
  shouldSkipDir,
  isBinaryOrZip,
  globToRegex,
  parsePattern,
} from "../src/filters";

describe("filters utility", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "filters-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("extracts explicit directories from path or pattern", () => {
    expect(Array.from(getExplicitDirs("node_modules"))).toEqual(["node_modules"]);
    expect(Array.from(getExplicitDirs("./node_modules/lodash"))).toEqual(["node_modules"]);
    expect(Array.from(getExplicitDirs("node_modules/**"))).toEqual(["node_modules"]);
    expect(Array.from(getExplicitDirs(".venv/lib/site-packages"))).toEqual([".venv"]);
    expect(Array.from(getExplicitDirs("venv"))).toEqual(["venv"]);
    expect(Array.from(getExplicitDirs("env/lib"))).toEqual(["env"]);
    expect(Array.from(getExplicitDirs("**/*.ts"))).toEqual([]);
    expect(Array.from(getExplicitDirs("my_environment"))).toEqual([]);
    expect(Array.from(getExplicitDirs("src/events.ts"))).toEqual([]);
  });

  it("correctly determines whether to skip directories", () => {
    const emptyExplicit = new Set<string>();
    expect(shouldSkipDir(".git", emptyExplicit)).toBe(true);
    expect(shouldSkipDir("node_modules", emptyExplicit)).toBe(true);
    expect(shouldSkipDir(".venv", emptyExplicit)).toBe(true);
    expect(shouldSkipDir("venv", emptyExplicit)).toBe(true);
    expect(shouldSkipDir("env", emptyExplicit)).toBe(true);
    expect(shouldSkipDir("__pycache__", emptyExplicit)).toBe(true);
    expect(shouldSkipDir(".pytest_cache", emptyExplicit)).toBe(true);
    expect(shouldSkipDir("src", emptyExplicit)).toBe(false);

    const withNodeModules = new Set(["node_modules"]);
    expect(shouldSkipDir("node_modules", withNodeModules)).toBe(false);
    expect(shouldSkipDir(".venv", withNodeModules)).toBe(true);

    const withVenv = new Set([".venv"]);
    expect(shouldSkipDir(".venv", withVenv)).toBe(false);
    expect(shouldSkipDir("node_modules", withVenv)).toBe(true);
  });

  it("identifies binary files and zip files", async () => {
    // Known binary extension
    const zipPath = path.join(tempDir, "archive.zip");
    await fs.writeFile(zipPath, "dummy content");
    expect(await isBinaryOrZip(zipPath)).toBe(true);

    const pngPath = path.join(tempDir, "pic.png");
    await fs.writeFile(pngPath, "dummy content");
    expect(await isBinaryOrZip(pngPath)).toBe(true);

    // Normal text file
    const txtPath = path.join(tempDir, "hello.txt");
    await fs.writeFile(txtPath, "Hello world!\nLine 2\n");
    expect(await isBinaryOrZip(txtPath)).toBe(false);

    // File with unknown extension but containing null byte
    const binPath = path.join(tempDir, "data.unknown");
    await fs.writeFile(binPath, Buffer.from([0x68, 0x65, 0x00, 0x6c, 0x6f]));
    expect(await isBinaryOrZip(binPath)).toBe(true);

    // File with zip magic bytes but no zip extension
    const fakeZipPath = path.join(tempDir, "magic.data");
    await fs.writeFile(fakeZipPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]));
    expect(await isBinaryOrZip(fakeZipPath)).toBe(true);
  });

  it("parsePattern parses regex literals and leaves plain patterns untouched", () => {
    expect(parsePattern("/^## 6/")).toEqual({
      raw: "/^## 6/",
      pattern: "^## 6",
      flags: "",
      ignoreCase: false,
    });

    expect(parsePattern("/^## 6/i")).toEqual({
      raw: "/^## 6/i",
      pattern: "^## 6",
      flags: "i",
      ignoreCase: true,
    });

    expect(parsePattern("/hello/")).toEqual({
      raw: "/hello/",
      pattern: "hello",
      flags: "",
      ignoreCase: false,
    });

    expect(parsePattern("/usr/local/bin/")).toEqual({
      raw: "/usr/local/bin/",
      pattern: "/usr/local/bin/",
      ignoreCase: false,
    });

    expect(parsePattern("^## 6")).toEqual({
      raw: "^## 6",
      pattern: "^## 6",
      ignoreCase: false,
    });
  });
});
