# AOP verification map

This directory is the maintained source for verifying the user-facing behavior of AOP. Read the index before driving the app, then use the matching feature file as the recipe. `S=.claude/skills/verify/scripts`, all commands run from the repo root, and `<run>` is the `--name` of your stack.

## Baseline preconditions

- Start a stack: `bun $S/verify-stack.ts start --name <run>`, then `bun $S/seed.ts --name <run>`.
- Run `bun $S/verify-stack.ts doctor --name <run>` and require every line to be `PASS`.
- Read `repoId`, `repoPath`, `taskId`, and `agentId` from `.work/verify/<run>/state.json` under `seed`. The seeded state is: repo `repo` registered, workflow `aop-default-gpt` (3 steps), worker `Verify Worker` with membership in `repo`, and task `backlog-test` assigned to that worker in status `DRAFT`.
- The stack runs with `AOP_TEST_MODE=true`: task steps use the deterministic fixture agent, not a real runtime.
- `<api>` is `env.AOP_LOCAL_SERVER_URL` in `.work/verify/<run>/state.json` (for example `http://127.0.0.1:25486`); the dashboard URL is `env.AOP_DASHBOARD_URL` in the same file.
- Never drive an instance that was not started by this verification run.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise. Features that mutate the seeded task (`task-run`) need a fresh seed: use a new `--name`.
- Prefer `data-testid` handles; they are the stable handles in the dashboard. Role and text selectors work too.
- Run CLI actions through `bun $S/verify-stack.ts aop --name <run> -- <aop args>`.
- Run dashboard actions in a new Claude in Chrome tab on `<dashboard>` (the URL in `env.AOP_DASHBOARD_URL`). Wait for elements with `find` by `data-testid`, batch steps with `browser_batch`, and read the console after each flow.
- Do not type into the Sessions composer unless the recipe says to. Chat messages reach the real `claude-code` or `codex-cli` runtime with the user's auth, unless the stack was seeded with `--fake-runtime` (see the Sessions recipe).
- Stop with `bun $S/verify-stack.ts stop --name <run>`; it keeps evidence.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof is a screenshot you have looked at, the `text:` output for the asserted element, and `evidence/console.log` read for new errors.
- CLI proof is the command, its output, and its exit code. Read the exit code without a pipe in front of it.
- Mutation proof includes a read-only second view: `aop status --json`, the API, or `git -C <repoPath>`.
- Record the feature ID and entry point used with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.
- State that the agent was the test-mode fixture whenever a run finished tasks.

## Features

- [Run a task](./task-run.md) covers `aop task:ready`, completion, and the handoff branch. The dashboard has no task pages.
- [Repositories](./repositories.md) covers `aop repo:init`, `aop repo:remove`, and the dashboard attach dialog.
- [Sessions](./sessions.md) covers the chat workbench, the composer, runtime-free commands, and settling.
- [Settings](./settings.md) covers the Settings dialog and its sections.
