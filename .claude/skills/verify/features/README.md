# AOP verification map

This directory is the maintained source for verifying the user-facing behavior of AOP. Read the index before driving the app, then use the matching feature file as the recipe. `S=.claude/skills/verify/scripts`, all commands run from the repo root, and `<run>` is the `--name` of your stack.

## Baseline preconditions

- Start a stack: `bun $S/verify-stack.ts start --name <run>`, then `bun $S/seed.ts --name <run>`.
- Run `bun $S/verify-stack.ts doctor --name <run>` and require every line to be `PASS`.
- Read `repoId` and `repoPath` from `.work/verify/<run>/state.json` under `seed`. The seeded state is the repo `repo` registered, with no projects and no sessions.
- `<api>` is `env.AOP_LOCAL_SERVER_URL` in `.work/verify/<run>/state.json` (for example `http://127.0.0.1:25486`); the dashboard URL is `env.AOP_DASHBOARD_URL` in the same file.
- Never drive an instance that was not started by this verification run.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Prefer `data-testid` handles; they are the stable handles in the dashboard. Role and text selectors work too.
- Run CLI actions through `bun $S/verify-stack.ts aop --name <run> -- <aop args>`.
- Run dashboard actions in a new Claude in Chrome tab on `<dashboard>` (the URL in `env.AOP_DASHBOARD_URL`). Wait for elements with `find` by `data-testid`, batch steps with `browser_batch`, and read the console after each flow.
- Do not send a chat or coordinator message unless the recipe says to. A message reaches the real `claude-code` runtime with the user's auth, unless the stack was seeded with `--fake-runtime` (see the Sessions and Projects recipes). Put stub `claude`, `codex` and `pi` scripts that log and exit non-zero first on `PATH` when starting the stack, so a misrouted call cannot reach a real CLI.
- Stop with `bun $S/verify-stack.ts stop --name <run>`; it keeps evidence.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof is a screenshot you have looked at, the `text:` output for the asserted element, and `evidence/console.log` read for new errors.
- CLI proof is the command, its output, and its exit code. Read the exit code without a pipe in front of it.
- Mutation proof includes a read-only second view: the API (`/api/status`, `/api/chat-sessions`) or `git -C <repoPath>`.
- Record the feature ID and entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.
- State that the runtime was the fake CLI whenever a chat turn ran with `--fake-runtime`.

## Features

- [Projects shell](./projects-shell.md) covers the dashboard: the projects sidebar, the New project dialog, a project's thread grid updating live, reconnecting after a host restart, and the pairing screen.
- [Projects](./projects.md) covers the project, coordinator and thread API, driven with the fake runtime; the shell shows the result.
- [Project event stream](./project-stream.md) covers `GET /api/projects/:id/stream`: live entries, resume, restart, removal.
- [Repositories](./repositories.md) covers `aop repo:init`, `aop repo:remove`, and the attach dialog.
- [Sessions](./sessions.md) covers plain chat sessions through the API (no page in the dashboard): fake chat, usage, a server crash mid-turn.
- [Settings](./settings.md) covers the Settings dialog and its sections.
- [Project settings, memory, usage and Devices](./projects-settings.md) covers a project's settings screen (General, Memory, Environment, Usage) and the host owner's Devices section.
- [Desktop app](./desktop.md) covers the Electron thin client: connecting to a host, the bundled dashboard, notifications, revoked devices, and the host it can run on a Mac. Half of it runs in Chrome, half over the DevTools protocol.
