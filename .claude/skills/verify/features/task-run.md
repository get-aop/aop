# Run a task

Run a task takes an assigned task from `DRAFT` to `DONE`: the user marks it ready, the worker's workflow runs its steps in an isolated git worktree, and the result lands on a branch in the repository while task detail shows the steps, logs, and verdict.

## Sub-features

- `run-ready-cli` queues an assigned task with `aop task:ready`.
- `run-ready-ui` queues it with the **Mark ready** button on task detail.
- `run-complete` finishes all workflow steps and reports `DONE`.
- `run-detail` shows steps, evidence, and logs on `/tasks/:taskId`.
- `run-handoff` leaves the work on a branch named after the task.

## How to get to it (user POV)

- Run `aop task:ready <taskId>` in a terminal.
- Open `/tasks/<taskId>` in the dashboard and choose **Mark ready** (`data-testid=mark-ready-button`, shown on an assigned `DRAFT` task).
- From Sessions, an assignment card offers **Assign and Start**. That path needs a real runtime to create the card, so this map does not drive it.

## Driving it with verify-stack and drive

Preconditions:

- A freshly seeded run: task `backlog-test` is `DRAFT` and assigned to `Verify Worker`.
- `doctor` is all `PASS`.
- Read `taskId` and `repoPath` from `state.json`.

- **Confirm the starting state.** Run `bun $S/verify-stack.ts aop --name <run> -- status <taskId> --json`. It prints the raw task row: `status` is `DRAFT`. The assignee is only in the factory view: `aop status --json` lists it as `repos[].tasks[].assignedAgentName`, which is `Verify Worker`.
- **Queue from the CLI.** Run `bun $S/verify-stack.ts aop --name <run> -- task:ready <taskId>`. Exit code `0`, and the log line reads `Task marked as READY`.
- **Wait for completion.** Poll `aop status <taskId> --json` every 2s until the status is `DONE`; fixture runs finish in under 10s. A `BLOCKED` status is a failure: read `.work/verify/<run>/logs/server.log`.
- **See it in task detail.** In Chrome, navigate to `<dashboard>/tasks/<taskId>`, find `data-testid=task-status-badge` and read its text, and take a screenshot. The badge reads `Done`. In the Chrome run the Logs pane can show `Waiting for logs...` instead of the fixture output; the screenshot shows `Execution history` with `Completed`, the steps `implement`, `run tests`, and `code review` each `success`, and `review_verdict passed`.
- **Check the side effect.** Run `git -C <repoPath> show backlog-test:hello.txt`. Stdout is `Hello from AOP backlog test!`. Run `git -C <repoPath> branch --list backlog-test` to see the branch. `hello.txt` is not in the `main` checkout.
- **Queue from the dashboard instead.** On a fresh seed, in Chrome navigate to `<dashboard>/tasks/<taskId>`, click `data-testid=mark-ready-button` (its label reads **Continue**, and the badge on an unstarted task reads **To do**, not `DRAFT`), watch `data-testid=task-status-badge` change, and take a screenshot, then poll `aop status` as above. This entry point comes from `e2e-tests/src/dashboard.e2e.ts` and has not been re-driven for this map.
- **Proof.** Keep `run-detail.png`, the `status --json` output showing `DONE`, and the `git show` output, with the feature ID `task-run` and the entry point used.

## Gotchas

- Task packages have no user-facing creation path without a real runtime (`/task create` goes through the MCP tools). The seed writes `task.md` into `$AOP_HOME/repos/<repoId>/tasks/backlog-test/` and calls `/api/refresh`. Dropping files in `<repo>/docs/tasks/` does nothing: legacy discovery is off (`discover_legacy_repo_tasks=false`).
- The completion mode reads `pull_request`, so the work stays on the `backlog-test` branch and is not merged to `main`. `e2e-tests/src/backlog.e2e.ts` still expects a squash-style flow; do not copy its assertions.
- A task can be queued once per seed. To repeat, stop and start a new run.
- The Logs pane prints each fixture line twice and the browser logs `Encountered two children with the same key` errors into `evidence/console.log`. Seen once, in fixture output where lines from different steps share a millisecond timestamp; the cause is not confirmed. Report it, but it does not by itself fail `run-detail`.
- Deep-linking `/tasks/<taskId>` shows `Loading sessions…` in the rail for a moment; wait on the task badge, not the rail.
