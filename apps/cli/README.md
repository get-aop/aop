# AOP CLI

The `aop` CLI is a thin HTTP client for the local AOP server. This reference covers every supported public command, useful configuration keys, service endpoints, and uninstall behavior.

## General

```bash
aop --help
aop --version
```

The production local server and dashboard share `http://aop.localhost:25150`. Dashboard development commonly uses port `25160`.

## Repositories

```bash
aop repo:init [path]
aop repo:remove [path]
```

`repo:init` registers the path, defaulting to the current directory. `repo:remove` asks you to type the repository name before removing AOP-owned data, including the repository's chat sessions and worktrees. Removing the last registered repository also resets AOP's runtime data and settings.

## Session workspace

```bash
aop session workspace set <sessionId> <absolute-path>
aop session workspace reset <sessionId>
```

`set` binds a chat session to a path in the same git repository. `reset` returns it to the registered repository root.

## Configuration

```bash
aop config:get [key]
aop config:set <key> <value>
```

Keys:

| Key | Purpose |
| --- | --- |
| `chat_global_instructions` | Free-text preferences added to every chat turn, outside the visible transcript |
| `max_concurrent_runs` | How many thread turns the host runs at once, from 1 to 32 (default 4); see [Run scheduling](../../docs/SCHEDULING.md) |

Runtime providers and models are easier to manage through **Settings → Runtimes**.

## Service management

The installer registers a launchd service on macOS or a systemd user service on Linux. AOP runs in the background; there is no separate public command to start an interactive server process.

The curl installer and desktop downloads are available from [getaop.com](https://getaop.com). A source checkout uses `./install`.

## Uninstall

From a source checkout:

```bash
./uninstall
```

This stops the user service and unlinks the CLI. Data under `~/.aop/` remains until you remove it separately.

## Related guides

- [Runtimes](../../docs/RUNTIMES.md)
- [Architecture](../../docs/architecture/README.md)
