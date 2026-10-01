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

## Keeping the agent CLIs up to date

Settings › Runtimes lists each agent CLI the host runs sessions with: the installed version, the file its command resolves to, how it was installed, and the newest version on its release channel. When a newer version is out, the row shows it, the Runtimes item in Settings carries a dot, and a line under Settings in the sidebar names it. The host owner gets an Update button; a paired device sees the versions only (`POST /api/agent-clis/:provider/update` is owner-only, see [Running the host](./HOST.md)).

The host checks shortly after it starts and then every `agent_cli_check_interval_minutes` (60 by default, 0 turns it off), reading the npm registry's dist-tags of the CLI's package, one small JSON document with an eight-second timeout. A failed check, offline included, is retried after one minute, then two, then four, never later than the interval. Claude Code's channel is `latest` unless `autoUpdatesChannel` in `~/.claude/settings.json` says `stable`. `AOP_AGENT_CLI_REGISTRY` points the check at another registry. With `agent_cli_auto_update` on (off by default), a check that finds a newer version starts the update itself; one that failed is not retried for the same version.

The install method comes from the path the command resolves to, and decides the update command. AOP never runs one with `sudo`, and runs each with no terminal, so a prompt fails instead of hanging.

| Install | Recognised by | Update command | While runs are in flight |
| --- | --- | --- | --- |
| Native installer | `~/.local/share/claude/versions/` | `claude update` | Runs at once |
| Older local install | `~/.claude/local/` | `claude update` | Waits |
| npm global | `node_modules/@anthropic-ai/claude-code/` | `npm install --global @anthropic-ai/claude-code@<channel>` | Waits |
| pnpm global | a `pnpm` path | `pnpm add --global …` | Waits |
| Bun global | `~/.bun/install/global/` | `bun add --global …` | Waits |
| Homebrew | `Caskroom/` or `Cellar/` | `brew upgrade --cask claude-code` | Waits |
| Anything else | | none: the row shows the command to run by hand | |

The package manager is the one beside the command (npm under nvm, `~/.bun/bin/bun`) when it is there, so the update lands in the install sessions use. A package-manager install whose `node_modules` the user cannot write is refused up front with the command to run by hand, as is a failed update: the row shows why, the output, and the command.

### Sessions and updates

Every launch, a first turn, a follow-up or a resumed session, looks the command up on the PATH of the env it is spawned with, at that moment. Nothing pins a path or a version, so an update takes effect on the next turn without restarting AOP. The login shell's env, which that PATH includes, is read again after each update.

Updates never break a run in flight. The native installer writes each version to a file of its own, keeps the last few, and repoints `~/.local/bin/claude`, so a running process keeps the binary it started from; this was checked with a compiled binary whose symlink was repointed and whose file was deleted mid-run (`apps/local-server/src/agent-cli/mid-run-safety.test.ts` does the same with a script). A package manager replaces the package's files in place, so those updates wait until no run of the CLI is in flight. During any update, new launches of that CLI wait for it to finish (at most ten minutes), so no turn starts on a half-installed CLI. One update per CLI runs at a time.

Each run records the CLI version its `system` init event named (`chat_runs.cli_version`), and the Runtimes row shows the versions of the runs in flight and of the last finished one.

## Checking a runtime against the real CLI

Everything the tests know about Claude Code's output comes from a fake CLI, so a change in the real one would go unseen. `scripts/real-runtime` is an opt-in harness that runs a short session on the real `claude` (Sonnet at medium effort, on your own login) and a private scratch GitHub repository, and writes a pass/fail report: the coordinator's restrictions, what a thread with full access or with Edit files can run, `aop_ask_user` and the resume that follows, the appended system prompt on a resumed session, thread links, the usage, `modelUsage` and rate-limit events of a result, the `gh` output the pull request watcher reads, and the watcher's fix prompt on a check that really fails.

It never runs by default, in a test or in CI. It needs `AOP_REAL_RUNTIME=1`, starts an isolated stack (its own `AOP_HOME`, database and ports) whose only runtime is a gate in front of `claude`, and the gate refuses a run past `AOP_REAL_RUNTIME_MAX_RUNS`, past `AOP_REAL_RUNTIME_MAX_COST_USD` (total cost from the results), and kills one that outlives `AOP_REAL_RUNTIME_RUN_TIMEOUT_MS`. The header of `scripts/real-runtime/run.ts` lists the commands (`up`, `scenario`, `report`, `down`). `scenario --only tools` runs one thread that asks a question and is answered in the browser (two real runs), and its report checks that a thread still lists the person's own MCP servers, has the `aop` tools without a `ToolSearch` call, and is offered none of the built-ins that schedule or wake a session.

## Related guides

- [MCP](./MCP.md)
- [Architecture](./architecture/README.md)
