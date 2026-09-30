# Runtimes

AOP drives external coding-agent CLIs; it does not replace their model or tool harnesses. Phase 1 supports one runtime, Claude Code. Adapters for Codex CLI and PI exist in the tree but are not supported or tested until Phase 2. This guide covers how AOP runs the runtimes and where their state lives.

## Agent CLIs

| Runtime | Provider id | Phase 1 status | Process shape |
| --- | --- | --- | --- |
| Claude Code | `claude-code` | Supported | `claude` stream-json session |
| Codex CLI | `codex-cli` | Phase 2, not supported yet | `codex exec --json` with resume support |
| PI | `pi` | Phase 2, not supported yet | `pi --mode json --print` with resumable follow-up |

Install and authenticate Claude Code on the machine that hosts AOP before you use it. AOP does not install these tools or sign in to them for you.

Each adapter launches a detached process, ingests its JSONL events, and persists the runtime session id when the CLI reports one, so a later turn can resume the same conversation. Detached processes keep running when the browser closes.

## Reasoning effort and Fast mode

Reasoning effort runs from Low to Max where the runtime and model support it. Provider labels differ: Codex-family selections use Light through Ultra, and Claude labels Extra-High as Extra. Fast mode is available only where the runtime and model support it. The dashboard shows only the controls the selected model supports.

## Isolated authentication homes

AOP keeps some runtime state under `~/.aop/`: Codex uses `~/.aop/codex-home` as `CODEX_HOME` unless you set your own, and PI keeps its sessions in `~/.aop/pi-sessions`. These homes preserve agent logins when you remove a repository. A full uninstall cleanup can remove them.

## Checking a runtime against the real CLI

Everything the tests know about Claude Code's output comes from a fake CLI, so a change in the real one would go unseen. `scripts/real-runtime` is an opt-in harness that runs a short session on the real `claude` (Sonnet at medium effort, on your own login) and a private scratch GitHub repository, and writes a pass/fail report: the coordinator's restrictions, what a thread with full access or with Edit files can run, `aop_ask_user` and the resume that follows, the appended system prompt on a resumed session, thread links, the usage, `modelUsage` and rate-limit events of a result, the `gh` output the pull request watcher reads, and the watcher's fix prompt on a check that really fails.

It never runs by default, in a test or in CI. It needs `AOP_REAL_RUNTIME=1`, starts an isolated stack (its own `AOP_HOME`, database and ports) whose only runtime is a gate in front of `claude`, and the gate refuses a run past `AOP_REAL_RUNTIME_MAX_RUNS`, past `AOP_REAL_RUNTIME_MAX_COST_USD` (total cost from the results), and kills one that outlives `AOP_REAL_RUNTIME_RUN_TIMEOUT_MS`. The header of `scripts/real-runtime/run.ts` lists the commands (`up`, `scenario`, `report`, `down`). `scenario --only tools` runs one thread that asks a question and is answered in the browser (two real runs), and its report checks that a thread still lists the person's own MCP servers, has the `aop` tools without a `ToolSearch` call, and is offered none of the built-ins that schedule or wake a session.

## Related guides

- [MCP](./MCP.md)
- [Architecture](./architecture/README.md)
