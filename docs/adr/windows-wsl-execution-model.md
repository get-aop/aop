# ADR: Windows + WSL execution model

- Status: **Accepted** (2026-06-25)
- Context: porting the macOS Tauri desktop app to Windows (see
  `docs/superpowers/plans/2026-06-25-windows-tauri-port.md`).

## Context

On Windows, the coding agents AOP orchestrates (`claude`, `codex`, `opencode`) and the
`gh` CLI are most often installed **inside a WSL distro**, not on native Windows. The
desktop app and `local-server` runtime must work for both native-Windows and WSL users.
There are two ways to reach the Linux-installed tools:

### Model A — Windows-resident sidecar, wrap each command via `wsl.exe`

The `local-server` runs as a native Windows process and shells every agent/git/gh
invocation through `wsl.exe -d <distro> -- ...`.

**Fatal problem — cross-boundary PID:** the spawned pid is the Windows `wsl.exe`
launcher, not the Linux agent process. That breaks the executor's process lifecycle:
`apps/local-server/src/executor/step-launcher.ts` keys reaping on `onSpawn(proc.pid)` and
reattach on `findPidByEnv(AOP_STEP_ID)` via Linux `/proc`. Neither can see or signal the
real agent inside the distro. Liveness polling, reaping, and reattach-after-restart all
fail, and a PID-bridge to close the gap is significant novel work.

### Model B — Linux sidecar runs *inside* the chosen distro (CHOSEN)

The Windows desktop launches the Linux `aop` sidecar inside the selected distro via
`wsl.exe -d <distro> -- <linux-aop> run`, and talks to it over forwarded
`localhost:25150`. Agents, git, gh, and the sidecar all live in one Linux namespace, so
the **existing `/proc`-based PID tracking, reaping, and reattach work unchanged**.

## Decision

1. **Model B is the default and only implemented WSL execution model for v1.**
   It reuses the proven Linux runtime path; the cross-boundary PID problem never arises.
2. **Model A (`WslHost`) is out of scope.** The execution-host factory exposes a
   `wsl:<distro>` branch only as a guarded `NotImplemented` error — it is never
   half-built. Revisit only if a concrete need appears, and not without first solving
   PID-bridging across the WSL boundary.
3. **Native Windows** is supported directly via a `NativeWindowsHost` (no WSL involved).

## `AOP_EXEC_HOST` contract

Execution mode is carried by the `AOP_EXEC_HOST` environment variable, persisted from the
desktop setup flow and passed into the sidecar launch. Grammar:

```
AOP_EXEC_HOST := "native" | "wsl:" <distro-name>
```

- `native` — run the sidecar/agents as native Windows (or, on macOS/Linux, the existing
  native path). Resolves to `NativeUnixHost` on darwin/linux and `NativeWindowsHost` on
  win32.
- `wsl:<distro>` — Model B: the sidecar runs inside `<distro>`; the runtime uses the
  native Linux host *inside* the distro. On the Windows side this only selects how the
  sidecar is launched, not a per-command `wsl.exe` wrapper.

Unset is treated as `native`.

## Consequences

- WSL users must keep `AOP_HOME` and cloned repos **inside the distro filesystem**
  (e.g. `/home/<user>/.aop`), not on `/mnt/c` — cross-FS 9p access is slow and has
  case/lock semantics that can corrupt git worktrees and SQLite.
- Cross-boundary `localhost:25150` forwarding can be blocked (mirrored networking,
  firewalls); the launch path must surface an actionable diagnostic rather than a bare
  timeout.
- Provisioning the Linux `aop` CLI into an arbitrary distro is the main remaining unknown
  (tracked as WIN-11).

## Downstream tickets

`AOP_EXEC_HOST` and this decision are consumed by **WIN-4** (host implementations),
**WIN-10** (distro detection), **WIN-11** (in-distro sidecar launch), and **WIN-14**
(frontend mode selection).
