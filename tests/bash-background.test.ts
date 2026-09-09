import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { executeBash, executeTaskLogs, TaskManager } from "../src/bash";

describe("bash tool with background execution", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bash-test-"));
    TaskManager.clearAll();
  });

  afterEach(async () => {
    TaskManager.clearAll();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("executes standard synchronous command", async () => {
    const result = await executeBash({ command: "echo 'hello from sync bash'" }, tempDir);
    expect(result.exitCode).toBe(0);
    expect(result.output.trim()).toBe("hello from sync bash");
    expect(result.background).toBe(false);
  });

  it("launches detached background task and returns task info immediately", async () => {
    const result = await executeBash(
      {
        command: "for i in 1 2 3; do echo \"step $i\"; sleep 0.1; done",
        background: true,
      },
      tempDir
    );

    expect(result.background).toBe(true);
    expect(result.taskId).toBeDefined();
    expect(result.pid).toBeDefined();
    expect(result.status).toBe("running");
    expect(result.output).toContain("Background task started");

    // Wait for the task to finish
    await new Promise((r) => setTimeout(r, 450));

    const logs = await executeTaskLogs({ taskId: result.taskId! });
    expect(logs.output).toContain("step 1");
    expect(logs.output).toContain("step 2");
    expect(logs.output).toContain("step 3");
    expect(logs.status).toBe("completed");
  });

  it("supports tail pagination on task_logs", async () => {
    const result = await executeBash(
      {
        command: "for i in $(seq 1 20); do echo \"line $i\"; done",
        background: true,
      },
      tempDir
    );

    await new Promise((r) => setTimeout(r, 200));

    const logs = await executeTaskLogs({ taskId: result.taskId!, tail: 5 });
    const logLines = logs.output.trim().split("\n");
    expect(logLines.length).toBeLessThanOrEqual(5);
    expect(logs.output).toContain("line 20");
  });
});
