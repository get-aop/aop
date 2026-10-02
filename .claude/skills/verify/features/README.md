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
- Run dashboard actions only when the task needs a browser check or the person asks, with the session's computer-use tools in a throwaway browser on `<dashboard>` (the URL in `env.AOP_DASHBOARD_URL`); see Drive in `../SKILL.md`. Find elements by `data-testid`. The recipes name Claude in Chrome tools (`find`, `read_page`, `javascript_tool`, `browser_batch`); SKILL.md maps them to the CUA tools.
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

- [Projects shell](./projects-shell.md) covers the dashboard: the top bar's project switcher, the New project dialog, a project's thread grid updating live, reconnecting after a host restart, and the pairing screen.
- [Projects chat](./projects-chat.md) covers the coordinator chat (the middle pane): typing to the coordinator, live text, thread cards and chips, suggested threads, reload and restart catch-up, the "New" line for unseen replies, and a paused project.
- [Projects thread pane and Overview](./projects-thread.md) covers a project's Overview (counters, groups, ordering) and a thread's screen: transcript with live text and tool calls, answering a question, steering, Stop, Resume, Resolve, Delete, the pull request bar with its honest refusals, the changes view, usage, and the run cap it depends on.
- [PR View](./pull-request-view.md) covers a pull request's page in the coordinator's place: the ways in and out, every tab and state, the merge box, the host owner's actions against a fixture `gh`, and a paired device's read-only view.
- [Projects](./projects.md) covers the project, coordinator and thread API, driven with the fake runtime; the shell shows the result.
- [Pull requests tab](./pull-requests.md) covers the threads panel's tab strip ("+" menu) and the Pull requests tab: rows, filters, search, sort, paging, refresh, not-signed-in and no-repository states, and opening a pull request in the PR View, against the fake `gh`.
- [Project event stream](./project-stream.md) covers `GET /api/projects/:id/stream`: live entries, resume, restart, removal.
- [Issues tab](./issues.md) covers the panel's Issues tab: GitHub and Linear issues against a fake `gh` and a fake Linear, grouping, filters, pull request chips, Start thread, the Linear connection, and every empty, error and not-connected state.
- [Repositories](./repositories.md) covers `aop repo:init`, `aop repo:remove`, and the attach dialog.
- [Sessions](./sessions.md) covers plain chat sessions through the API (no page in the dashboard): fake chat, usage, a server crash mid-turn.
- [Settings](./settings.md) covers the Settings dialog and its sections.
- [Updates](./updates.md) covers `aop update`, the update notice and Update now, against a fake release feed and a host installed in a scratch folder.
- [Project settings, memory, usage and Devices](./projects-settings.md) covers a project's settings screen (General, Models, Threads & permissions, Computer use, Notifications, Environment, Memory, Usage, Advanced) and the host owner's Devices section.
- [Desktop app](./desktop.md) covers the Electron thin client: connecting to a host, the bundled dashboard, notifications, revoked devices, and the host it can run on a Mac. Half of it runs in Chrome, half over the DevTools protocol.
