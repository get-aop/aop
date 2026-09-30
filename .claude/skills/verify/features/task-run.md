# Run a task

Run a task takes an assigned task from `DRAFT` to `DONE`: the user marks it ready, the worker's workflow runs its steps in an isolated git worktree, and the result lands on a branch in the repository. The dashboard has no task pages, so this feature is driven through the CLI and the server.

## Sub-features

- `run-ready-cli` queues an assigned task with `aop task:ready`.
- `run-complete` finishes all workflow steps and reports `DONE`.
- `run-handoff` leaves the work on a branch named after the task.

## How to get to it (user POV)

- Run `aop task:ready <taskId>` in a terminal.

## Driving it with verify-stack and drive

Preconditions:

- A freshly seeded run: task `backlog-test` is `DRAFT` and assigned to `Verify Worker`.
- `doctor` is all `PASS`.
- Read `taskId` and `repoPath` from `state.json`.

- **Confirm the starting state.** Run `bun $S/verify-stack.ts aop --name <run> -- status <taskId> --json`. It prints the raw task row: `status` is `DRAFT`. The assignee is only in the factory view: `aop status --json` lists it as `repos[].tasks[].assignedAgentName`, which is `Verify Worker`.
- **Queue from the CLI.** Run `bun $S/verify-stack.ts aop --name <run> -- task:ready <taskId>`. Exit code `0`, and the log line reads `Task marked as READY`.
- **Wait for completion.** Poll `aop status <taskId> --json` every 2s until the status is `DONE`; fixture runs finish in under 10s. A `BLOCKED` status is a failure: read `.work/verify/<run>/logs/server.log`.
- **Check the side effect.** Run `git -C <repoPath> show backlog-test:hello.txt`. Stdout is `Hello from AOP backlog test!`. Run `git -C <repoPath> branch --list backlog-test` to see the branch. `hello.txt` is not in the `main` checkout.
- **Proof.** Keep the `status --json` output showing `DONE` and the `git show` output, with the feature ID `task-run` and the entry point `aop task:ready`.

## Gotchas

- Task packages have no user-facing creation path without a real runtime (`/task create` goes through the MCP tools). The seed writes `task.md` into `$AOP_HOME/repos/<repoId>/tasks/backlog-test/` and calls `/api/refresh`. Dropping files in `<repo>/docs/tasks/` does nothing: legacy discovery is off (`discover_legacy_repo_tasks=false`).
- The completion mode reads `pull_request`, so the work stays on the `backlog-test` branch and is not merged to `main`. `e2e-tests/src/backlog.e2e.ts` still expects a squash-style flow; do not copy its assertions.
- A task can be queued once per seed. To repeat, stop and start a new run.
