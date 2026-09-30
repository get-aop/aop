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

## Related guides

- [MCP](./MCP.md)
- [Architecture](./architecture/README.md)
