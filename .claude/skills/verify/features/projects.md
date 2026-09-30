# Projects and threads (API)

A project is one coordinator chat plus the threads it starts. This map covers the HTTP API. The dashboard shows the result as projects in the sidebar and threads as cards on the project home, and [Projects shell](./projects-shell.md) is the recipe for watching that; the coordinator chat is drawn by the Coordinator tab ([Projects chat](./projects-chat.md)), while the thread transcript pane is still a placeholder. Coordinator and thread sessions never appear in `GET /api/chat-sessions`.

Everything here needs a stack seeded with `--fake-runtime`: projects resolve their coordinator and thread runtime from the first runtime configuration, which then is the fake CLI, so no model is called. Confirm before sending anything: `sqlite3 "$AOP_DB_PATH" "select kind, runtime_alias from chat_sessions"` shows the path of `fake-cli.ts` for the coordinator and every thread.

## Sub-features

- `projects-crud` creates, reads, updates, pauses, archives, restores, restarts the coordinator of, and deletes a project.
- `projects-coordinator` chats with the coordinator, which starts threads through the AOP MCP tools.
- `projects-thread` follows a thread: waiting on you, replying, status reports, Stop.
- `projects-memory` writes and reads the project's memory files.
- `projects-scheduling` caps the thread turns that run at once, watches the rest queue and start in order, and follows a thread through a usage limit.
- `projects-thread-git` gives a thread a worktree and branch, opens and merges its pull request against a fake `gh`, and cleans up; see the last section.

## How to get to it

Preconditions: a started run seeded with `--fake-runtime`; `<api>` and `<repoId>` from `state.json`.

- **Create.** `curl -s -X POST <api>/api/projects -H 'content-type: application/json' -d '{"name":"Checkout","repoIds":["<repoId>"]}'`. The reply holds `project.id`; `status` is `active`; a `coordinator` chat session exists (see the sqlite query above).
- **Coordinator starts a thread.** The coordinator has only the AOP MCP tools. The fake makes real tool calls from a `calls` marker (JSON array of `{name, arguments}`), so a message like `start it [fake: calls='[{"name":"thread_spawn","arguments":{"title":"Pick a database","prompt":"Choose [fake: ask=\"Which one?\" options=\"a|b\"]"}}]']` makes the coordinator call `thread_spawn` over HTTP. `POST <api>/api/projects/<id>/messages` with `{"text": ...}`. Only the last `[fake: ...]` marker in a prompt counts, so put every directive in one marker.
- **Thread row.** `GET <api>/api/projects/<id>/threads`: the thread is `waiting-on-you` with `blockedQuestion {question, options}`. `GET <api>/api/projects/<id>/messages` shows the coordinator chat as wire messages: your message, the coordinator's reply with a `thread-card` block, a `thread-report` (`needs-you`) and the coordinator's answer to it with a `needs-call` card.
- **Reply and resume.** `POST <api>/api/threads/<threadId>/reply` with `{"text":"b"}`. The thread goes `working`, then `idle`. Its `chat_sessions.runtime_session_id` is unchanged and the reply text reads `turn 2 ... (resumed)`.
- **Status line.** Steer with `POST <api>/api/threads/<threadId>/messages` and a `calls` marker for `aop_report_status` (`{"line": ..., "steps": [{"label": ..., "state": "done|active|pending"}]}`); add `delay=3000` inside the same marker to see the row update while the thread is `working`.
- **Stop.** Steer with `[fake: delay=30000]`, then `POST <api>/api/threads/<threadId>/stop`: the run is `cancelled`, the thread is `idle` with the line `Stopped`, and `pgrep -f fake-cli.ts` finds nothing.
- **Pause and delete.** `POST <api>/api/projects/<id>/pause` stops every running thread and makes messages answer 409 `PROJECT_NOT_ACTIVE`; `/resume` reopens. `DELETE <api>/api/projects/<id>` answers 204 and leaves no project, thread, coordinator session or memory row; the repo stays registered.
- **Cap and queue (`projects-scheduling`).** Set the cap with `PUT <api>/api/settings/max_concurrent_runs` `{"value":"1"}` (`"0"` answers 400 and keeps the old value). Start three threads with `POST <api>/api/projects/<id>/threads`, an explicit `title` and a prompt like `work A [fake: startup=9000]`, or have the coordinator start them with three `thread_spawn` calls in one `calls` marker. The first is `working`; the others are `queued` with the line `Waiting for a free run slot`, and their cards read `Queued`. They start one at a time in the order they were started: `sqlite3 "$AOP_DB_PATH" "select s.title, r.created_at, r.updated_at from chat_runs r join chat_sessions s on s.id = r.session_id where s.kind = 'thread' order by r.created_at"` shows each run starting within milliseconds of the previous one ending, and the coordinator's own runs in between, unqueued. `PUT` a cap of 3 while threads are queued and they start at once. `bun $S/verify-stack.ts restart-server --name <run> --crash` mid-queue keeps the queue: the run in progress is recovered and holds its slot, and the queued threads start in order when it ends.
- **Usage limit (`projects-scheduling`).** Start a thread with `[fake: ratelimit=25]` in its prompt. It becomes `rate-limited` with `resumesAt` about 26 seconds ahead, its card reads `Rate limited` with the line `Paused: You've hit your session limit · resets <time>. Resuming automatically at <time>.`, and its run is `failed` with `failure_kind` `rate_limit`. It resumes by itself at `resumesAt` (`chat_runs` gets a second, `completed` run and the thread is `idle`), also after a `restart-server --crash` in between. With `ratelimit=3600`, `POST <api>/api/threads/<threadId>/resume` resumes it at once (`409 NOT_RATE_LIMITED` for a thread that is not waiting), and so does a message to the thread. The clock time in the text is the host's local time; `resumesAt` is UTC.
- **Proof.** The requests and responses, the sqlite rows (`chat_sessions`, `chat_runs`, `event_log` types), and, in Chrome on `<dashboard>/`, screenshots of the project home with the thread cards these calls produced (see [Projects shell](./projects-shell.md)) and `read_console_messages` with no errors. Say that the runtime was the fake CLI.

## Thread worktrees and pull requests (`projects-thread-git`)

A thread with a repo works in `<home>/worktrees/<repoId>/<threadId>` on `aop/<title>-<id6>`, not in the repo's checkout. Never call the real GitHub or the real `claude`: put the tripwire stubs and the fake `gh` first on `PATH` for the server, and give the fixture repo a bare origin.

Preconditions:

- Stubs: a directory `<bin>` holding `claude`, `codex` and `pi` scripts that append a line to a log and `exit 97`, and a `gh` that runs `scripts/fake-gh.ts` (`printf '#!/bin/sh\nexec bun %s/.claude/skills/verify/scripts/fake-gh.ts "$@"\n' "$PWD" > <bin>/gh`, then `chmod +x`). The fake keeps its state and `calls.log` in `<home>/fake-gh`; `pr merge` really squash-merges into the origin.
- Start with the stubs on the path, on every start and every `restart-server`: `PATH=<bin>:$PATH bun $S/verify-stack.ts start --name <run>`, then `seed.ts --name <run> --fake-runtime`.
- Origin: `git init --bare -b main <fixtures>/origin.git`, then in the fixture repo `git remote add origin <that path>`, `git push -u origin main`, `git remote set-head origin main`.
- Open `new EventSource('/api/projects/<id>/stream')` in a dashboard tab (see [Project event stream](./project-stream.md)) and log `thread.upserted` entries.

- **Spawn.** Have the coordinator start a thread whose brief carries a `write` marker: `[fake: calls='[{"name":"thread_spawn","arguments":{"title":"Add notes","prompt":"Add it [fake: write=\"NOTES.md=hello\"]"}}]']`. `git -C <repoPath> worktree list` shows the thread's worktree on its branch, `NOTES.md` is in the worktree and not in the checkout, and `chat_sessions` holds `branch`, `target_json` and the worktree as `workspace_path`.
- **Open the pull request.** `POST <api>/api/threads/<id>/pull-request` (optional `title`, `body`, `draft`): 201 with `{thread, pullRequest, created: true}`, the branch pushed to the origin with the work committed, one `gh pr create` in `calls.log`, `pr_number`, `pr_url` and `pr_state` on the row, and a `thread.upserted` with the `pr` artifact on the stream. A second call answers 200 with `created: false` and adds no `gh pr create`.
- **Merge.** `POST <api>/api/threads/<id>/pull-request/merge`: the stream shows `landing` then `resolved`, the origin's `main` gains the squash commit, and the worktree and the branch are gone locally and on the origin. A second call answers 200 and adds no `gh pr merge`.
- **Crash in the open window.** `touch <home>/fake-gh/hang-after-create`, call open in the background, and after 4 seconds `PATH=<bin>:$PATH bun $S/verify-stack.ts restart-server --name <run> --crash`. The fake GitHub has the pull request and the row has none. Calling open again answers 200 `created: false` with the row filled in and `calls.log` still holding one `gh pr create`.
- **Crash in the merge window.** `touch <home>/fake-gh/hang-after-merge`, call merge in the background, kill the server the same way after 4 seconds (the row is `landing`, the pull request merged). After the restart the row is `resolved` with the pull request `merged` and the worktree and branch are gone, without another request; merging again answers 200 and adds no `gh pr merge`.
- **Resolve, reopen, delete.** `POST <api>/api/threads/<id>/resolve` removes the worktree and keeps the branch with the thread's files committed; a message to the thread brings the worktree back; `DELETE <api>/api/threads/<id>` removes the worktree and the branch, and a second delete answers 404.
- **Proof.** The requests and responses, `git worktree list`, `git branch` and the origin's log before and after each step, `calls.log`, the stream frames, the tripwire log (it must not exist), and in Chrome the Sessions page and a fake chat with no console errors. Say that the runtime was the fake CLI and that GitHub was the fake `gh`.

## Gotchas

- The stubs come from the shell that runs `start` and `restart-server`, not from `state.json`: a restart without them on `PATH` puts the real `gh` back.
- `gh` availability is cached for a minute per process, so make the fake unavailable (remove it from `PATH`) before the first call of a test that wants that failure.
- A `[fake: ...]` marker inside a thread's title or brief is replayed on every turn, because both go into the brief: give a thread with a marker in its prompt an explicit `title`.
- Two markers in one message do not add up: the last one wins.
- The thread transcript has no dashboard screen yet (a placeholder pane); the chat has one, the Coordinator tab. `apps/local-server/src/project/coordinator.fake-cli.test.ts` runs the same flows against the engine.
