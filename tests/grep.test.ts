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
