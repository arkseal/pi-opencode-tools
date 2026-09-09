# pi-opencode-tools

Ultra-lean `glob`, `grep`, and `bash` (with detached background execution) tools for the **pi** coding agent, architected to minimize token overhead.

## Features & Token Impact

- **`glob`**:
  - Only **2 parameters** (`pattern`, `path`), saving ~400 prompt tokens per turn compared to 14-parameter alternatives.
  - Caps output at 100 matches to prevent runaway context consumption.
  - Outputs concise paths relative to the current working directory.

- **`grep`**:
  - Only **3 parameters** (`pattern`, `path`, `include`).
  - Fast ripgrep (`rg`) backend.
  - Cleanly groups matches by file with 1-based line numbers.
  - Caps at 100 matches with an explicit truncation indicator.

- **`bash` with `background: boolean`**:
  - Enables running dev servers, test suites, or Docker builds in the background (`background: true`).
  - Output is piped to `/tmp/pi-tasks/<taskId>.log` rather than flooding the active conversation turn with thousands of tokens.
  - Returns `{ taskId, pid, status: "running" }` immediately.

- **`task_logs`**:
  - Inspect background tasks on demand with pagination (`tail` and `offset`).

## Installation

```bash
pi install /path/to/pi-opencode-tools
# or in settings.json packages
```

## Running Tests

```bash
bun test
```
