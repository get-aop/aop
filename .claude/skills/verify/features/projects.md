# Projects and threads (backend, API only)

A project is one coordinator chat plus the threads it starts. The project UI is not built yet, so this map covers the HTTP API with the dashboard open beside it only to confirm the Sessions page still works: coordinator and thread sessions never appear in the Sessions rail or in `GET /api/chat-sessions`.

Everything here needs a stack seeded with `--fake-runtime`: projects resolve their coordinator and thread runtime from the first runtime configuration, which then is the fake CLI, so no model is called. Confirm before sending anything: `sqlite3 "$AOP_DB_PATH" "select kind, runtime_alias from chat_sessions"` shows the path of `fake-cli.ts` for the coordinator and every thread.

## Sub-features

- `projects-crud` creates, reads, updates, pauses, archives, restores, restarts the coordinator of, and deletes a project.
- `projects-coordinator` chats with the coordinator, which starts threads through the AOP MCP tools.
- `projects-thread` follows a thread: waiting on you, replying, status reports, Stop.
- `projects-memory` writes and reads the project's memory files.

## How to get to it

Preconditions: a started run seeded with `--fake-runtime`; `<api>` and `<repoId>` from `state.json`.

- **Create.** `curl -s -X POST <api>/api/projects -H 'content-type: application/json' -d '{"name":"Checkout","repoIds":["<repoId>"]}'`. The reply holds `project.id`; `status` is `active`; a `coordinator` chat session exists (see the sqlite query above).
- **Coordinator starts a thread.** The coordinator has only the AOP MCP tools. The fake makes real tool calls from a `calls` marker (JSON array of `{name, arguments}`), so a message like `start it [fake: calls='[{"name":"thread_spawn","arguments":{"title":"Pick a database","prompt":"Choose [fake: ask=\"Which one?\" options=\"a|b\"]"}}]']` makes the coordinator call `thread_spawn` over HTTP. `POST <api>/api/projects/<id>/messages` with `{"text": ...}`. Only the last `[fake: ...]` marker in a prompt counts, so put every directive in one marker.
- **Thread row.** `GET <api>/api/projects/<id>/threads`: the thread is `waiting-on-you` with `blockedQuestion {question, options}`. `GET <api>/api/projects/<id>/messages` shows the coordinator chat as wire messages: your message, the coordinator's reply with a `thread-card` block, a `thread-report` (`needs-you`) and the coordinator's answer to it with a `needs-call` card.
- **Reply and resume.** `POST <api>/api/threads/<threadId>/reply` with `{"text":"b"}`. The thread goes `working`, then `idle`. Its `chat_sessions.runtime_session_id` is unchanged and the reply text reads `turn 2 ... (resumed)`.
- **Status line.** Steer with `POST <api>/api/threads/<threadId>/messages` and a `calls` marker for `aop_report_status` (`{"line": ..., "steps": [{"label": ..., "state": "done|active|pending"}]}`); add `delay=3000` inside the same marker to see the row update while the thread is `working`.
- **Stop.** Steer with `[fake: delay=30000]`, then `POST <api>/api/threads/<threadId>/stop`: the run is `cancelled`, the thread is `idle` with the line `Stopped`, and `pgrep -f fake-cli.ts` finds nothing.
- **Pause and delete.** `POST <api>/api/projects/<id>/pause` stops every running thread and makes messages answer 409 `PROJECT_NOT_ACTIVE`; `/resume` reopens. `DELETE <api>/api/projects/<id>` answers 204 and leaves no project, thread, coordinator session or memory row; the repo stays registered.
- **Proof.** The requests and responses, the sqlite rows (`chat_sessions`, `chat_runs`, `event_log` types), and, in Chrome on `<dashboard>/`, a screenshot of the Sessions rail showing none of the project sessions plus a working fake chat (`sessions-fake-chat`) with no console errors. Say that the runtime was the fake CLI and that the project UI was not driven.

## Gotchas

- A `[fake: ...]` marker inside a thread's title or brief is replayed on every turn, because both go into the brief: give a thread with a marker in its prompt an explicit `title`.
- Two markers in one message do not add up: the last one wins.
- Not driven through the UI: there is none yet. `apps/local-server/src/project/coordinator.fake-cli.test.ts` runs the same flows against the engine.
