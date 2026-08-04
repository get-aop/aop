# Runtimes

AOP orchestrates external coding-agent CLIs; it does not replace their model or tool harnesses. This guide covers supported runtimes, Runtime configuration, custom providers, isolated authentication, reasoning and Fast-mode capabilities, diagnostics, and factory concurrency.

## Supported agent CLIs

| Runtime | Provider id | Typical use |
| --- | --- | --- |
| Claude Code | `claude-code` | Interactive Sessions, MCP actions, workflow steps, skills, browser/computer loans |
| Codex CLI | `codex-cli` | Interactive Sessions, MCP actions, workflow steps, browser/computer loans, Fast mode |
| Grok | `grok-build` | Interactive Sessions, MCP actions (via `AOP_MCP_SERVER_URL`), delegation, and workflow steps |
| OpenCode | `opencode` | Interactive turns, delegation, and workflow steps |
| Pi | `pi` | Interactive turns, delegation, workflow steps, Fast mode, and live worker-channel follow-up |

Install and authenticate the CLI itself before selecting it in AOP.

## Runtime configuration

Open **Settings → Runtime configuration**. Built-in providers are read-only templates; clone one to customize it.

Each provider stores:

- Display name, executable command, and driver.
- A Fast-mode capability flag.
- Ordered model rows with model id, description, enabled thinking levels, default model, and default thinking.

**Add provider** creates a user-owned configuration. Choose a name, executable, and driver, then add model rows. Reorder providers to control their order in runtime, `%`, and `$` menus.

A personal executable or wrapper is a custom provider created by the user; it is not a shipped runtime.

## Session and workflow selection

The session runtime chip selects Runtime → Model → Thinking → Fast mode. `%` delegation swaps those settings for one message. `$` control loans pick their model, thinking, and Fast-mode defaults from Runtime configuration.

There is no separate computer/browser settings panel. Browser and computer capability are also per-step agent flags in [Workflows](./WORKFLOW.md#step-agents-and-control).

## Reasoning and Fast mode

Thinking levels are Low, Medium, High, Extra-High, and Max where the provider/model supports them. Provider-facing labels can vary: Codex-family selections use Light through Ultra, while Claude labels Extra-High as Extra.

Current built-in capability rules include:

- Codex CLI supports Fast mode.
- Pi supports Fast mode for its Codex-backed models.
- Claude Code exposes thinking and Ultracode on supported models.
- Grok thinking is available for `grok-4.5` at Low, Medium, and High.
- OpenCode thinking depends on the selected model.

Runtime configuration is the final authority shown by the UI; unsupported controls are omitted.

## Isolated authentication homes

AOP keeps runtime state under `~/.aop/`, including isolated homes such as `codex-home`, `opencode`, and `pi-sessions`. These homes preserve agent logins across repository removal and a factory reset. A full uninstall cleanup can remove them.

## Diagnostics

Open the help icon in Runtime configuration to view the capability matrix and doctor probes. It reports whether each CLI is installed, authenticated, spawnable, producing logs, capable of live follow-up, and a good fit for the requested surface.

Use these probes before changing workflows: a configured model cannot compensate for a missing executable or incomplete runtime login.

## Factory concurrency

- `max_concurrent_tasks` defaults to 5 across the factory.
- Each repository defaults to a cap of 3 running tasks.
- Each worker runs one task at a time.
- Active-worker license limits are 4 on Free, 8 on Pro, and unlimited on Team.

Worker seats are created and assigned from chat; see [Tasks](./TASKS.md) and [Licensing](./licensing.md) for tier details.

## Related guides

- [Chat](./CHAT.md)
- [Commands](./COMMANDS.md)
- [Tasks](./TASKS.md)
- [Workflows](./WORKFLOW.md)
- [Architecture](./architecture/README.md)
