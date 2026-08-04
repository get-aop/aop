# AOP CLI

The `aop` CLI is a thin HTTP client for the local AOP server. This reference covers every supported public command, useful configuration keys, service endpoints, and uninstall behavior.

## General

```bash
aop --help
aop --version
```

The production local server and dashboard share `http://aop.localhost:25150`. Dashboard development commonly uses port `25160`.

## Status

```bash
aop status [taskId] [--json]
```

Without a task id, status summarizes the local factory. With an id, it returns the matching task. `--json` emits machine-readable output.

## Repositories

```bash
aop repo:init [path]
aop repo:remove [path] [--force]
```

`repo:init` registers the path, defaulting to the current directory. `repo:remove` asks you to type the repository name before removing AOP-owned data. `--force` aborts active tasks before removal.

## Task lifecycle

```bash
aop task:ready <id> [--resume [stepId]]
aop task:remove <id> [--force]
```

`task:ready` queues an assigned task. `--resume` retries from its last step; an optional step id selects the resume point. `task:remove` discards a task, with `--force` available when it is working.

## Compatibility task commands

```bash
aop create-task [description]
aop run-task <name>
```

`create-task` is deprecated. Open Sessions and use `/task create` so the runtime can load AOP's current methodology and generate the complete package. `run-task` remains a compatibility path for generating task documents from a name; chat is the public task-intake flow.

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

Useful keys include:

| Key | Purpose |
| --- | --- |
| `budget_wall_clock_secs` | Maximum run wall-clock time |
| `budget_cost_usd` | Maximum recorded run cost |
| `budget_total_tokens` | Maximum run tokens |
| `handoff_requires_approval` | Gate handoff on operator approval |

Runtime providers and models are easier to manage through **Settings → Runtime configuration**.

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

- [Chat](../../docs/CHAT.md)
- [Commands](../../docs/COMMANDS.md)
- [Tasks](../../docs/TASKS.md)
- [Architecture](../../docs/architecture/README.md)
