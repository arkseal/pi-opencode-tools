import { spawn, exec } from "node:child_process";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execAsync = promisify(exec);

export interface BashParams {
  command: string;
  timeout?: number; // seconds
  background?: boolean;
}

export interface BashResult {
  exitCode?: number;
  output: string;
  background: boolean;
  taskId?: string;
  pid?: number;
  status?: "running" | "completed" | "failed";
  logFile?: string;
}

export interface TaskLogsParams {
  taskId: string;
  tail?: number;
  offset?: number;
}

export interface TaskLogsResult {
  taskId: string;
  status: "running" | "completed" | "failed" | "not_found";
  exitCode?: number | null;
  output: string;
}

interface ManagedTask {
  id: string;
  command: string;
  pid?: number;
  logFile: string;
  status: "running" | "completed" | "failed";
  exitCode?: number | null;
  startTime: number;
  endTime?: number;
}

const TASK_DIR = path.join(os.tmpdir(), "pi-tasks");
const activeTasks = new Map<string, ManagedTask>();

function ensureTaskDirSync() {
  if (!fsSync.existsSync(TASK_DIR)) {
    fsSync.mkdirSync(TASK_DIR, { recursive: true });
  }
}

export const TaskManager = {
  get(taskId: string): ManagedTask | undefined {
    return activeTasks.get(taskId);
  },
  list(): ManagedTask[] {
    return Array.from(activeTasks.values());
  },
  clearAll() {
    activeTasks.clear();
  },
};

export async function executeBash(
  params: BashParams,
  cwd: string
): Promise<BashResult> {
  const command = params.command?.trim();
  if (!command) {
    throw new Error("command is required");
  }

  ensureTaskDirSync();

  // Background execution
  if (params.background) {
    const taskId = `task_${randomUUID().slice(0, 8)}`;
    const logFile = path.join(TASK_DIR, `${taskId}.log`);
    const logFd = fsSync.openSync(logFile, "a");

    const child = spawn("bash", ["-c", command], {
      cwd,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: process.env,
    });

    const task: ManagedTask = {
      id: taskId,
      command,
      pid: child.pid,
      logFile,
      status: "running",
      exitCode: null,
      startTime: Date.now(),
    };

    activeTasks.set(taskId, task);

    child.on("close", (code) => {
      try {
        fsSync.closeSync(logFd);
      } catch {}
      task.status = code === 0 ? "completed" : "failed";
      task.exitCode = code;
      task.endTime = Date.now();
    });

    child.unref();

    return {
      background: true,
      taskId,
      pid: child.pid,
      status: "running",
      logFile,
      output: `Background task started [${taskId}] (PID ${child.pid}).\nLogs streaming to: ${logFile}\nUse task_logs with taskId="${taskId}" to check progress or tail output.`,
    };
  }

  // Synchronous execution
  const timeoutMs = (params.timeout ?? 60) * 1000;
  return new Promise<BashResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let timer: NodeJS.Timeout | null = null;
    let timedOut = false;

    const child = spawn(command, {
      cwd,
      shell: "/bin/bash",
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {}
        }, 2000).unref();
      }, timeoutMs);
    }

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({
        exitCode: 1,
        background: false,
        output: err.message,
      });
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        resolve({
          exitCode: 124,
          background: false,
          output: `Command timed out after ${params.timeout ?? 60} seconds`,
        });
        return;
      }
      const output = [stdout, stderr].filter(Boolean).join("\n");
      resolve({
        exitCode: code ?? 0,
        background: false,
        output: output.trim() || "(Command completed with empty output)",
      });
    });
  });
}

export async function executeTaskLogs(
  params: TaskLogsParams
): Promise<TaskLogsResult> {
  const task = activeTasks.get(params.taskId);
  const logFile = task?.logFile ?? path.join(TASK_DIR, `${params.taskId}.log`);

  let exists = false;
  try {
    await fs.stat(logFile);
    exists = true;
  } catch {
    exists = false;
  }

  if (!exists && !task) {
    return {
      taskId: params.taskId,
      status: "not_found",
      output: `Task ${params.taskId} not found.`,
    };
  }

  let content = "";
  try {
    content = await fs.readFile(logFile, "utf-8");
  } catch (err: any) {
    content = `Failed to read log file: ${err.message}`;
  }

  let lines = content.split("\n");
  if (params.offset && params.offset > 0) {
    lines = lines.slice(params.offset);
  }
  if (params.tail && params.tail > 0) {
    lines = lines.slice(-params.tail);
  }

  return {
    taskId: params.taskId,
    status: task?.status ?? "completed",
    exitCode: task?.exitCode,
    output: lines.join("\n").trim() || "(No logs captured yet)",
  };
}
