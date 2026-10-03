# Runtimes: status, default, pickers, delete guard

Covers AOP settings › Runtimes (every runtime with its status, the Default runtime picker, add/edit/remove), the Runtime pickers in project settings › Models and the New project dialog, the coordinator's runtime chip, a turn really running on the chosen runtime, the fail-fast message of a runtime that cannot run, and the delete guard. Design: `docs/architecture/runtime-choice.md`.

## Preconditions

- A stack serving the PRODUCTION-built dashboard, so the browser holds one connection per page: `bun run --filter @aop/dashboard build`, then `DASHBOARD_STATIC_PATH=$PWD/apps/dashboard/dist bun $S/verify-stack.ts start --name <run>` and open `<api>/` (the host URL, as owner).
- `bun $S/seed.ts --name <run>` WITHOUT `--fake-runtime` when the recipe adds the fake CLI by hand (step 1); with it, the fake is already the default runtime.
- Put a stub `claude` first on the server's `PATH` that logs and exits 1, so nothing reaches the real CLI. The built-in runtime then shows its real status for that stub (found, version unknown, login unknown).
- Two wrapper scripts for the fake CLI (each a runtime command):
  - `fake-a`: `#!/bin/sh` + `exec <repo>/packages/llm-provider/test-fixtures/fake-cli.ts "$@"`
  - `fake-out`: `#!/bin/sh` + `FAKE_CLI_LOGGED_OUT=1 exec <repo>/packages/llm-provider/test-fixtures/fake-cli.ts "$@"` (reports not logged in)

## Steps

1. **Add a custom runtime.** Settings (⌘, or the project switcher) › Runtimes › Add custom runtime: name `Fake A`, command the full path of `fake-a`, models `fake-model` and `fake-big`. The row reads `Ready · Found · v0.0.0 · Logged in`. Add `Fake out` (command `fake-out`) and `Missing` (command `/nonexistent/claude`): `Not ready · … Not logged in` and `Not ready · Not found` with the reason.
2. **Default runtime.** The Default runtime picker offers `Fake A`, and shows `Fake out` and `Missing` disabled with their reasons. Pick `Fake A`; its row gets the Default badge. `GET <api>/api/runtime-configuration` → `defaultRuntimeId` is its id.
3. **New project.** + › New project: both Runtime pickers read `Fake A`. Create it (no repository needed). `GET <api>/api/projects/<id>` → `coordinator.runtimeId` and `thread.runtimeId` are Fake A's id.
4. **A turn runs on it.** Send the coordinator a slow turn, `hello [fake: stream=200 delay=1500 steps=3 say="on fake a"]`. While it runs, read the run's pid (`sqlite3 "$AOP_DB_PATH" "select pid from chat_runs order by created_at desc limit 1"`) and `ps -o pid,command -p <pid>` (and its children with `ps -o pid,ppid,command --ppid <pid>`): the command line is the wrapper's path. The session is bound to it: `select runtime_alias, runtime_configuration_id from chat_sessions where kind='coordinator'`.
5. **Switch runtimes.** Project settings › Models: Coordinator Runtime → `Claude Code`; the Model list becomes the Claude catalog (Opus 5.5 …). Threads Runtime → `Fake A`; its Model list is `Fake model`, `fake-big`. The coordinator chip names the runtime; switch it back to `Fake A` from the chip and see the model chip list follow.
6. **Not ready.** Coordinator Runtime cannot be set to `Missing` from the pickers. Edit `Fake A`'s command to `/nonexistent/fake-a` and press Check again: the project's Models page says `Not ready: …` under the picker. Send the coordinator a message: the reply is `This turn could not start on its runtime. The command … was not found …` at once (no hang). Put the command back.
7. **Delete guard.** Settings › Runtimes › `Fake A` › Remove: the dialog lists the project (`coordinator, new threads`) and offers `Move them to <default> and remove`. Cancel. `curl -s -X DELETE <api>/api/runtime-configuration/providers/<id>` → 409 `RUNTIME_IN_USE`. Confirm in the dialog: the project moves to the built-in runtime (Fake A was the default, so the default becomes Claude Code) and the row is gone.
8. **Old projects unchanged.** A project created before step 2 still reads `claude-code` for both roles.
