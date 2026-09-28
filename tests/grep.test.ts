import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { executeGrep } from "../src/grep";

describe("grep tool", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "grep-test-"));
    await fs.mkdir(path.join(tempDir, "src"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "node_modules", "pkg"), { recursive: true });
    await fs.mkdir(path.join(tempDir, ".venv", "lib"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "venv", "bin"), { recursive: true });

    await fs.writeFile(
      path.join(tempDir, "src", "app.ts"),
      "function start() {\n  console.log('Starting server');\n  const port = 8080;\n  console.log('Server ready on port', port);\n}\n"
    );
    await fs.writeFile(
      path.join(tempDir, "src", "util.ts"),
      "export function log(msg: string) {\n  console.log('[LOG]: ' + msg);\n}\n"
    );
    await fs.writeFile(
      path.join(tempDir, "src", "config.json"),
      '{\n  "server": "localhost",\n  "log": true\n}\n'
    );

    // Dependencies and environments containing matching text
    await fs.writeFile(
      path.join(tempDir, "node_modules", "pkg", "dep.ts"),
      "console.log('Inside dependency package');\n"
    );
    await fs.writeFile(
      path.join(tempDir, ".venv", "lib", "site.py"),
      "# console.log in python venv\n"
    );
    await fs.writeFile(
      path.join(tempDir, "venv", "bin", "activate.py"),
      "# console.log in venv\n"
    );

    // Binary and zip files containing matching text
    // Zip file header (PK\x03\x04) with matching text embedded
    const zipBuffer = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]),
      Buffer.from("console.log('in zip file')\n"),
    ]);
    await fs.writeFile(path.join(tempDir, "archive.zip"), zipBuffer);

    // Binary file with NUL byte and matching text
    const binaryBuffer = Buffer.concat([
      Buffer.from([0x00, 0x01, 0x02, 0xff]),
      Buffer.from("console.log('in binary file')\n"),
    ]);
    await fs.writeFile(path.join(tempDir, "data.bin"), binaryBuffer);
    await fs.writeFile(path.join(tempDir, "image.png"), binaryBuffer);
    await fs.writeFile(path.join(tempDir, "custom.unknown"), binaryBuffer);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("searches pattern and groups output by file with line numbers", async () => {
    const result = await executeGrep({ pattern: "console\\.log" }, tempDir);
    expect(result.matches).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.output).toContain("Found 3 matches");
    expect(result.output).toContain("src/app.ts:");
    expect(result.output).toContain("  Line 2:   console.log('Starting server');");
    expect(result.output).toContain("  Line 4:   console.log('Server ready on port', port);");
    expect(result.output).toContain("src/util.ts:");
    expect(result.output).toContain("  Line 2:   console.log('[LOG]: ' + msg);");
  });

  it("respects include filter", async () => {
    const result = await executeGrep({ pattern: "log", include: "*.json" }, tempDir);
    expect(result.matches).toBe(1);
    expect(result.output).toContain("src/config.json:");
    expect(result.output).not.toContain("src/app.ts:");
  });

  it("returns clean message when no matches found", async () => {
    const result = await executeGrep({ pattern: "nonexistent_pattern_123" }, tempDir);
    expect(result.matches).toBe(0);
    expect(result.output).toBe("No files found");
  });

  it("skips node_modules, .venv, venv, and binary/zip files by default", async () => {
    const result = await executeGrep({ pattern: "console\\.log" }, tempDir);
    expect(result.matches).toBe(3);
    expect(result.output).not.toContain("node_modules");
    expect(result.output).not.toContain(".venv");
    expect(result.output).not.toContain("venv");
    expect(result.output).not.toContain("archive.zip");
    expect(result.output).not.toContain("data.bin");
    expect(result.output).not.toContain("image.png");
    expect(result.output).not.toContain("custom.unknown");
  });

  it("skips binary or zip file when passed directly as path", async () => {
    const zipResult = await executeGrep({ pattern: "console\\.log", path: "archive.zip" }, tempDir);
    expect(zipResult.matches).toBe(0);
    expect(zipResult.output).toBe("No files found");

    const binResult = await executeGrep({ pattern: "console\\.log", path: "data.bin" }, tempDir);
    expect(binResult.matches).toBe(0);
    expect(binResult.output).toBe("No files found");
  });

  it("searches node_modules when explicitly specified in path", async () => {
    const result = await executeGrep(
      { pattern: "console\\.log", path: "node_modules/pkg" },
      tempDir
    );
    expect(result.matches).toBe(1);
    expect(result.output).toContain("node_modules/pkg/dep.ts:");
    expect(result.output).toContain("Inside dependency package");
  });

  it("searches node_modules when explicitly specified in include", async () => {
    const result = await executeGrep(
      { pattern: "console\\.log", include: "node_modules/**" },
      tempDir
    );
    expect(result.matches).toBe(1);
    expect(result.output).toContain("node_modules/pkg/dep.ts:");
  });

  it("searches .venv when explicitly specified in path", async () => {
    const result = await executeGrep(
      { pattern: "console\\.log", path: ".venv" },
      tempDir
    );
    expect(result.matches).toBe(1);
    expect(result.output).toContain(".venv/lib/site.py:");
  });

  it("searches single file target with filename prefix", async () => {
    const result = await executeGrep(
      { pattern: "console\\.log", path: "src/app.ts" },
      tempDir
    );
    expect(result.matches).toBe(2);
    expect(result.output).toContain("src/app.ts:");
    expect(result.output).toContain("Line 2:   console.log('Starting server');");
  });

  it("supports regex literal format /^pattern/ and flags", async () => {
    await fs.writeFile(
      path.join(tempDir, "docs.md"),
      "# Introduction\n\n## 6 Specification\n\nDetails here.\n"
    );

    const result = await executeGrep(
      { pattern: "/^## 6/", path: "docs.md" },
      tempDir
    );
    expect(result.matches).toBe(1);
    expect(result.output).toContain("docs.md:");
    expect(result.output).toContain("Line 3: ## 6 Specification");

    // Case insensitive regex literal
    const caseResult = await executeGrep(
      { pattern: "/## 6 specification/i", path: "docs.md" },
      tempDir
    );
    expect(caseResult.matches).toBe(1);
    expect(caseResult.output).toContain("Line 3: ## 6 Specification");
  });

  it("truncates at limit and appends notice", async () => {
    const lines = [];
    for (let i = 0; i < 120; i++) {
      lines.push(`const match_${i} = "target_word";`);
    }
    await fs.writeFile(path.join(tempDir, "many_matches.ts"), lines.join("\n"));

    const result = await executeGrep({ pattern: "target_word" }, tempDir, 50);
    expect(result.matches).toBe(50);
    expect(result.truncated).toBe(true);
    expect(result.output).toContain("(Results truncated. Consider using a more specific path or pattern.)");
  });
});
