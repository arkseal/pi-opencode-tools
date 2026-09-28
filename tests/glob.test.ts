import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { executeGlob } from "../src/glob";

describe("glob tool", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "glob-test-"));
    await fs.mkdir(path.join(tempDir, "src", "sub"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "node_modules", "pkg"), { recursive: true });
    await fs.mkdir(path.join(tempDir, ".venv", "lib"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "venv", "bin"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "__pycache__"), { recursive: true });

    await fs.writeFile(path.join(tempDir, "src", "a.ts"), "const a = 1;");
    await fs.writeFile(path.join(tempDir, "src", "b.js"), "const b = 2;");
    await fs.writeFile(path.join(tempDir, "src", "sub", "c.ts"), "const c = 3;");
    await fs.writeFile(path.join(tempDir, "README.md"), "# Test");

    // Files in dependency/environment directories
    await fs.writeFile(path.join(tempDir, "node_modules", "pkg", "dep.ts"), "export const d = 1;");
    await fs.writeFile(path.join(tempDir, ".venv", "lib", "site.py"), "# venv code");
    await fs.writeFile(path.join(tempDir, "venv", "bin", "activate.py"), "# activate");
    await fs.writeFile(path.join(tempDir, "__pycache__", "cache.pyc"), "bytecode");
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("finds matching files with glob pattern", async () => {
    const result = await executeGlob({ pattern: "**/*.ts" }, tempDir);
    expect(result.count).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.output).toContain("src/a.ts");
    expect(result.output).toContain("src/sub/c.ts");
    expect(result.output).not.toContain("b.js");
  });

  it("scoped to specific subpath", async () => {
    const result = await executeGlob({ pattern: "*.ts", path: "src/sub" }, tempDir);
    expect(result.count).toBe(1);
    expect(result.output).toContain("src/sub/c.ts");
  });

  it("returns message when no files match", async () => {
    const result = await executeGlob({ pattern: "*.xyz" }, tempDir);
    expect(result.count).toBe(0);
    expect(result.output).toBe("No files found");
  });

  it("skips node_modules, .venv, venv, __pycache__ by default", async () => {
    const tsResult = await executeGlob({ pattern: "**/*.ts" }, tempDir);
    expect(tsResult.output).not.toContain("node_modules");
    expect(tsResult.output).not.toContain("dep.ts");

    const pyResult = await executeGlob({ pattern: "**/*.py" }, tempDir);
    expect(pyResult.count).toBe(0);
    expect(pyResult.output).toBe("No files found");
  });

  it("searches node_modules when explicitly specified in path", async () => {
    const result = await executeGlob({ pattern: "*.ts", path: "node_modules/pkg" }, tempDir);
    expect(result.count).toBe(1);
    expect(result.output).toContain("node_modules/pkg/dep.ts");
  });

  it("searches node_modules when explicitly specified in pattern", async () => {
    const result = await executeGlob({ pattern: "node_modules/**/*.ts" }, tempDir);
    expect(result.count).toBe(1);
    expect(result.output).toContain("node_modules/pkg/dep.ts");
  });

  it("searches .venv when explicitly specified in path", async () => {
    const result = await executeGlob({ pattern: "**/*.py", path: ".venv" }, tempDir);
    expect(result.count).toBe(1);
    expect(result.output).toContain(".venv/lib/site.py");
  });

  it("searches venv when explicitly specified in pattern", async () => {
    const result = await executeGlob({ pattern: "venv/**/*.py" }, tempDir);
    expect(result.count).toBe(1);
    expect(result.output).toContain("venv/bin/activate.py");
  });

  it("truncates at limit and appends notice", async () => {
    // create 105 files
    for (let i = 0; i < 105; i++) {
      await fs.writeFile(path.join(tempDir, `file_${i.toString().padStart(3, "0")}.txt`), "test");
    }
    const result = await executeGlob({ pattern: "*.txt" }, tempDir, 100);
    expect(result.count).toBe(100);
    expect(result.truncated).toBe(true);
    expect(result.output).toContain("Results are truncated: showing first 100 results");
  });
});
