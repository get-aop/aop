# Choosing a runtime

A runtime is a runtime configuration: a command AOP launches, the adapter that command speaks (its driver, `claude-code` in Phase 1), and the models it offers. The built-in Claude Code configuration (id `claude-code`, command `claude`) is always there. AOP settings › Runtimes adds custom ones: a wrapper or alias that runs Claude Code, with a model list of its own. This guide covers how a project picks one per role, how a turn resolves it, and what happens when one cannot run. [Runtimes](../RUNTIMES.md) covers the CLIs themselves.

## What is stored

| Where | What | Since |
| --- | --- | --- |
| `runtime_configuration_providers`, `runtime_configuration_models` | Every runtime and its models | v1 |
| `projects.coordinator_runtime_id`, `projects.thread_runtime_id` | The runtime each role of a project runs on | v25 |
| `settings.default_runtime_id` | The runtime new projects start on; `claude-code` by default | v25 (a setting key, no migration) |
| `chat_sessions.runtime_configuration_id`, `runtime_alias` | The runtime a session is bound to, and its command | v1 |

Migration v25 gives every existing project `claude-code` for both roles. Before it, a role ran on the first configuration of its provider that had models, which was always the built-in one, so existing projects run exactly as before. There is no foreign key from a project to its runtime (SQLite cannot add one with a default); the delete guard below keeps the reference valid instead.

On the wire, `RuntimePreference` (a project's `coordinator` and `thread`, a thread's `runtime`) carries `runtimeId` next to `provider`, `model` and `effort`. `provider` is always the runtime's driver. A client may leave `runtimeId` out (`RuntimePreferenceInput`): a new project then takes the host's default, and a change keeps the runtime the role already has, so an older client, or the coordinator's `project_settings_set` (which only sets the thread model and effort), changes nothing it does not name. A `runtimeId` that names no runtime is refused with 400 `RUNTIME_NOT_FOUND`. Code: `apps/local-server/src/project/runtime-choice.ts`.

## How a turn resolves its runtime

`resolveSessionRuntime` (`apps/local-server/src/project/runtime.ts`) turns a role's preference into session columns when a coordinator is created or follows its project, and when a thread is spawned. It takes, in order, the first of these that exists and has at least one model:

1. the runtime the project names for the role,
2. the host's default runtime,
3. the built-in Claude Code runtime.

The runtime's order on the Runtimes page plays no part. A named model the runtime does not offer falls back to the runtime's default model; a null model or effort stays null ("use default": no flag is passed).

- **The coordinator** follows its project: a change to the project's coordinator runtime rebinds the coordinator session at once (`syncCoordinatorSession`), and its next turn launches the new command. The native session id is kept, so a wrapper that shares Claude Code's session store resumes the same conversation.
- **A thread** is bound to the runtime its project named when it was spawned, and keeps it for its whole life: the engine re-applies the session's own configuration on every send, so a later change to the project's thread runtime only applies to threads started after it.
- **A plain chat session** (one in no project) starts on the host's default runtime, then the first runtime that can run.

## Ready or not

`apps/local-server/src/runtime-configuration/readiness.ts` looks at a runtime the way a turn would use it, and keeps each look for a minute per command:

- **Found:** the command resolves on the PATH of the spawn environment (or is an executable path).
- **Version:** what `<command> --version` prints.
- **Logged in:** for the `claude-code` driver, `<command> auth status` prints JSON whose `loggedIn` is read. Anything else (a wrapper that does not pass the arguments on, a timeout after ten seconds) leaves the login `unknown`, which does not block.
- **Models:** a runtime with no models cannot be picked.

A runtime is ready when it is found, is not known to be logged out, and has a model. `GET /api/runtime-configuration/status` returns `RuntimeStatus` for every runtime; `?fresh=1` looks again now. The dashboard's pickers list every runtime but only offer ready ones; a runtime that is not ready shows the reason, and a role already on one says "Not ready" under its picker.

**Fail fast.** Right before a turn spawns its CLI, the engine asks the same check for the session's command (`turnBlockReason`). A runtime that is missing or logged out ends the turn at once with a message in the chat or thread ("This turn could not start on its runtime. The command `x` was not found on this host's PATH. Fix it in AOP settings › Runtimes, or pick another runtime in the project's settings › Models."), instead of a spawn error or a CLI waiting for a login. A look that found the runtime ready is trusted for a minute; one that did not is taken again, so a command installed or logged in a moment ago works on the next message. A test's injected provider launches no command and skips the check.

## Removing a runtime

`DELETE /api/runtime-configuration/providers/:id` (`runtime-configuration/service.ts`):

- The built-in runtime is never removed (404).
- A runtime a project names for either role, or that open (not resolved) threads run on, is refused with 409 `RUNTIME_IN_USE` and the list (`usage`: project, roles, open threads). `GET …/providers/:id/usage` returns the same list, which the remove dialog shows before anything is clicked.
- `?moveTo=default` moves them first: project settings go to the host's default through the project service (so dashboards and coordinators follow), then every session still bound to the runtime, resolved threads included, is pointed at it. When the runtime going is the default itself, they move to the built-in runtime and the default becomes the built-in one.

No session is left naming a runtime that is gone. Before this, removing a runtime left sessions bound to it, whose next send failed with `RUNTIME_CONFIGURATION_NOT_FOUND`.

## API

| Route | Does |
| --- | --- |
| `GET /api/runtime-configuration` | `{ providers, defaultRuntimeId }` |
| `GET /api/runtime-configuration/status[?fresh=1]` | `{ statuses: RuntimeStatus[] }` |
| `PUT /api/runtime-configuration/default` | `{ runtimeId }`; 404 for a runtime that does not exist |
| `GET /api/runtime-configuration/providers/:id/usage` | `{ usage: RuntimeUsage[] }` |
| `DELETE /api/runtime-configuration/providers/:id[?moveTo=default]` | 204, 404, or 409 `RUNTIME_IN_USE` |

## Dashboard

- **AOP settings › Runtimes** lists every runtime, built-in first, with its status line (Ready or Not ready · Found · version · login), a Default badge, and a Default runtime picker. Custom runtimes can be edited (name, command and model list), cloned and removed; the built-in one can be cloned.
- **Project settings › Models** has a Runtime picker above Model and Effort for the coordinator and for threads. Changing it puts the model back on "Use default" and keeps the effort only if the new runtime's default model takes it.
- **New project** has a Runtime picker per role, set to the host's default.
- **The coordinator's chips** show its runtime, model and effort; the runtime chip switches it. A thread's chips show the runtime it runs on.

The model and effort lists of project settings and of the coordinator's chips come from one helper, `modelOptions(runtimeId, runtimes)` in `apps/dashboard/src/projects/chat/runtime-options.ts`: the chosen runtime's models, or the built-in catalog while the runtimes load.

## Not yet

- **Per-thread override.** A thread runs on its project's thread runtime; `thread_spawn` takes no runtime.
- **Coordinator tools.** `project_settings_get` reports each role's `runtimeId`, but `project_settings_set` sets only the thread model and effort and the notification level, not a runtime.
- **Other drivers.** Codex CLI and PI need the provider catalog widened (get-aop/aop#23); a custom runtime's driver is always `claude-code` until then.
