# ADR: Remote SSH execution hosts

- Status: **Accepted** (2026-07-19)
- Context: run agent CLIs on a LAN machine from the machine hosting AOP's local server.

## Context

Some developers keep a more powerful desktop on the same network with agent CLIs
authenticated and local AI configured. AOP's local server previously spawned every
provider only on the machine running the server via `resolveExecHost()`.

Two architectures were considered:

### Model A — Per-command SSH wrapping (`SshExecHost`) — CHOSEN

Each agent/verification spawn is wrapped as a local `ssh … -- <remote command>`
subprocess. The local PID is the OpenSSH client. Workspace content is synced with
`git bundle` + `rsync`. Stdout still lands in the existing local JSONL log file.

### Model B — Remote AOP sidecar/daemon

Install and run a second AOP local-server on the remote machine, with task
queueing and RPC. Larger surface, new lifecycle, and out of scope for v1.

## Decision

1. **Model A for v1.** One new `ExecHost` implementation (`kind: "ssh"`) keeps the
   executor/provider spawn contract unchanged. Call sites do not branch on OS or
   transport; they receive an injected `ExecHost`.
2. **POSIX remotes only.** Remote command construction uses POSIX `sh` quoting.
3. **Key-based BatchMode SSH only.** No password prompts; identity files stay in
   `~/.ssh`, not in AOP settings.
4. **Env over stdin for agent spawns.** When `stdin: "ignore"`, secrets are written
   as `KEY=value` lines into a remote bootstrap (`set -a; eval…; set +a; exec…`) so
   they never appear in remote `ps`/argv. Callers that need real stdin fall back to
   inline `export` (documented visibility caveat). Forwarded env is sanitized
   (`sanitizeForwardedEnv`): machine-identity vars (`PATH`, `HOME`, `TMPDIR`, …) stay
   local so the remote login shell's own values win, and non-POSIX names or
   newline-containing values are dropped — the line-based bootstrap `eval`s each
   line, so they cannot be forwarded safely.
5. **Remote steps do not survive local-server restarts.** On recovery, in-flight
   remote steps are cleaned up (`pkill -f AOP_STEP_ID=…` best-effort) and marked
   failed/reset like other dead agents. Reattach of a live remote agent is v1 out of scope.
6. **Binding is per runtime profile** (`execHostId`), not per task/repo in v1.

## Consequences

- Latency and network failures surface as spawn/preflight errors rather than hangs
  (`ConnectTimeout=5`, explicit preflight echo).
- Workspace sync cannot plain-rsync a worktree `.git` file; bundle + overlay rsync
  is required (see `apps/local-server/src/executor/remote-workspace.ts`).
- openclaw/hermes, chat sessions, channels, and terminal remain local-only.
