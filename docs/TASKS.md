# Tasks

Tasks are document-first units of work that run through AOP's workflow engine. This guide covers creation from chat, assignment cards, task detail, lifecycle, run evidence, budgets, and PR handoff.

## Create a task

Use `/task create <request>` (or ask naturally in an MCP-capable session). AOP loads its task methodology first, then creates a complete package — `task.md`, `prd.md`, and `issues.md` — under `~/.aop/repos/<repo-id>/tasks/<slug>/`.

`/task batch <request>` (alias `/task create multi`) turns one prose message into several independent tasks: the runtime splits the request, applies the methodology once per task, and creates each package. The reply is a batch routing card with one row per created task. A clean run that created zero tasks is re-driven once; a partial batch is never re-driven (re-prompting could duplicate tasks) and instead surfaces the created subset in the routing card.

Attached plan/prd/issues artifacts redirect to `/task create`; batch splitting works on prose only.

## Assign and start

Task cards in the thread handle assignment. `/assign` opens an assignment card that can select a worker and one or more tasks:

- **Assign** assigns the task without starting it.
- **Assign and Start** assigns and immediately begins the worker's workflow.

`/task start <title or id>` starts an already assigned task. An optional `%worker` on `/task create` or `/assign` prefills the assignment; it never silently assigns or starts.

A worker is a named seat with runtime defaults, a default workflow, and repository memberships — created from chat via the worker card (`/worker new`). One worker runs at most one task at a time, and execution is refused when the assigned worker lacks the required repository membership. Workers have no dedicated page; profiles live behind the chat cards and the MCP tools.

## Lifecycle

| Status | Meaning |
| --- | --- |
| `DRAFT` | Created, not yet assigned or started |
| `READY` | Assigned, waiting to start |
| `RESUMING` | Reattaching to a resumable runtime session |
| `WORKING` | A workflow step is executing |
| `PAUSED` | Waiting for operator input |
| `BLOCKED` | Retries, validation, or an explicit failure stopped the run |
| `DONE` | The workflow reached a success terminal |
| `REMOVED` | Deleted from the dashboard |

## Task detail

Open a task from its chat card or the Tasks pane. Task detail has its own header — **← Sessions**, title, status badge, mono meta — and tabs:

- **Logs** — live streaming output while the run is active, historical events after.
- **Plan** — the task package and methodology.
- **Specs** — the specification with review annotations; comment and resolve inline.

Execution steps render with the same workflow glyphs as the composer rail, so the running step sequence matches what you selected. Blocked and paused tasks show their status with **Retry** / **Resume** actions. Done tasks expose PR actions when GitHub is configured.

## Run evidence

Each step run records normalized runtime events, token and cost usage when the provider reports them, and a persisted runtime session id for recovery. Logs stream through SSE while live and are read from SQLite afterward.

## Tasks pane

The right panel's **Tasks** tab shows background tasks and delegations live: the current activity of every agent, updated as it happens. The panel opens from the git row's Tasks button or the top-bar toggle; new activity while the panel is closed updates the count badge.

## Handoff

From a done task or a finished session you can open a pull request through the session PR flow or the task's PR actions. See [Session GitHub workflow](./session-github-workflow.md) for the branch, diff, and merge flow.

## Related guides

- [Chat](./CHAT.md)
- [Workflows](./WORKFLOW.md)
- [Commands](./COMMANDS.md)
- [Runtimes](./RUNTIMES.md)
- [MCP](./MCP.md)
