import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { executeGlob } from "./glob.js";
import { executeGrep } from "./grep.js";
import { executeBash, executeTaskLogs } from "./bash.js";

export { executeGlob } from "./glob.js";
export { executeGrep } from "./grep.js";
export { executeBash, executeTaskLogs } from "./bash.js";

export default function opencodeToolsExtension(pi: ExtensionAPI) {
  // 1. Glob tool - 2 parameters (minimal token schema)
  pi.registerTool({
    name: "glob",
    label: "Glob",
    description:
      "Fast file pattern matching. Returns matching file paths relative to current directory. Truncates at 100 matches.",
    promptSnippet: "Find files by name patterns (e.g. '**/*.ts')",
    parameters: Type.Object(
      {
        pattern: Type.String({
          description: "The glob pattern to match files against (e.g. '**/*.ts')",
        }),
        path: Type.Optional(
          Type.String({
            description: "Directory to search in. Defaults to current directory.",
          })
        ),
      },
      { additionalProperties: false }
    ),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await executeGlob(params, ctx.cwd);
      return {
        content: [{ type: "text", text: result.output }],
        details: { count: result.count, truncated: result.truncated },
      };
    },
  });

  // 2. Grep tool - 3 parameters (minimal token schema)
  pi.registerTool({
    name: "grep",
    label: "Grep",
    description:
      "Fast regex content search using ripgrep. Groups results by file with line numbers. Truncates at 100 matches.",
    promptSnippet: "Search file contents by regex pattern",
    parameters: Type.Object(
      {
        pattern: Type.String({
          description: "The regex pattern to search for in file contents",
        }),
        path: Type.Optional(
          Type.String({
            description: "File or directory to search in. Defaults to current directory.",
          })
        ),
        include: Type.Optional(
          Type.String({
            description: "File pattern filter (e.g. '*.ts', '*.{js,jsx}')",
          })
        ),
      },
      { additionalProperties: false }
    ),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await executeGrep(params, ctx.cwd);
      return {
        content: [{ type: "text", text: result.output }],
        details: { matches: result.matches, truncated: result.truncated },
      };
    },
  });

  // 3. Bash with background: boolean parameter
  pi.registerTool({
    name: "bash",
    label: "Bash",
    description:
      "Execute a bash shell command. Supports background: true to run long commands detached without blocking.",
    promptSnippet: "Execute shell command (synchronous or background)",
    parameters: Type.Object(
      {
        command: Type.String({ description: "The shell command to execute" }),
        timeout: Type.Optional(
          Type.Number({ description: "Timeout in seconds (default 60)" })
        ),
        background: Type.Optional(
          Type.Boolean({
            description:
              "Run command in background detached. Returns immediately with taskId. Inspect with task_logs.",
          })
        ),
      },
      { additionalProperties: false }
    ),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = await executeBash(params, ctx.cwd);
      return {
        content: [{ type: "text", text: result.output }],
        details: {
          exitCode: result.exitCode,
          background: result.background,
          taskId: result.taskId,
          pid: result.pid,
        },
      };
    },
  });

  // 4. Task logs tool
  pi.registerTool({
    name: "task_logs",
    label: "Task Logs",
    description:
      "Retrieve stdout/stderr logs from a background task started with bash(background=true).",
    promptSnippet: "Inspect output of background task",
    parameters: Type.Object(
      {
        taskId: Type.String({ description: "The taskId returned by bash" }),
        tail: Type.Optional(
          Type.Number({ description: "Number of trailing lines to return (default 50)" })
        ),
        offset: Type.Optional(
          Type.Number({ description: "Start line offset" })
        ),
      },
      { additionalProperties: false }
    ),
    async execute(_toolCallId, params) {
      const result = await executeTaskLogs(params);
      return {
        content: [{ type: "text", text: result.output }],
        details: { taskId: result.taskId, status: result.status, exitCode: result.exitCode },
      };
    },
  });
}
