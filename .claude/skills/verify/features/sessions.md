# Sessions (API only)

A plain chat session is one conversation with an agent runtime in a repository. The dashboard no longer has a page for them: its front door is [Projects](./projects-shell.md), and the coordinator and thread sessions of a project never appear in `GET /api/chat-sessions`. The server side is intact, so this map drives it with the HTTP API and the fake runtime. The composer, the transcript and the diff components are still in `apps/dashboard/src/views/sessions`, waiting to be mounted by the coordinator chat and the thread pane.

Every recipe needs a stack seeded with `--fake-runtime`, started with stub `claude`, `codex` and `pi` scripts first on `PATH`. Never send a message on a stack without the fake: it reaches the real CLI with the user's auth.

## Sub-features

- `sessions-fake-chat` sends scripted messages to the fake CLI and reads the replies back.
- `sessions-usage` sends turns that report known token counts and reads them back through `/api/usage`.
- `sessions-restart` crashes the server mid-turn, then stops the orphaned CLI.

## Driving it with verify-stack and curl

Preconditions:

- A started and seeded run (`seed.ts --name <run> --fake-runtime`); `<api>`, `<repoId>` and the run's database `$AOP_DB_PATH` (`bun $S/verify-stack.ts env --name <run>`).
- Write each request body to a file and send it with `--data @file`, so the `[fake: ...]` marker needs no shell quoting.

## Fake chat (`sessions-fake-chat`)

- **Create a session.** `curl -s -X POST <api>/api/chat-sessions -H 'content-type: application/json' -d '{"repoId":"<repoId>"}'`. The reply holds `session.id`; its `runtimeAlias` ends in `fake-cli.ts`. If it does not, stop: a message would reach the real CLI.
- **Send a scripted message.** `POST <api>/api/chat-sessions/<id>/messages` with `{"content":"hello [fake: steps=2 delay=300]"}`. After a few seconds `GET <api>/api/chat-sessions/<id>` lists the user message and the assistant's reply, `Fake reply for turn 1 of session <runtime session id>.`, and `runtimeSessionId` is set.
- **Resume.** Send `and again`. The reply reads `Fake reply for turn 2 of session <same runtime session id> (resumed). You said: and again`.
- **More scripts.** `[fake: crash=3]` fails the run with `Runtime exited with code 137. Check that the CLI is installed and authenticated.` `[fake: delay=30000]` then `POST <api>/api/chat-sessions/<id>/abort` cancels the run and the next message resumes the session. `[fake: ask="Which one?" options="a|b"]` ends the turn on a question; a plain chat is not offered `aop_ask_user` (only project threads are), so it gets an error result in the run log under `$AOP_HOME/logs/chat-sessions/<id>/`. For a working question flow see [Projects](./projects.md). The full syntax is in `packages/llm-provider/test-fixtures/README.md`.
- **Proof.** The requests, `GET <api>/api/chat-sessions/<id>` before and after, and the note that the runtime was the fake CLI.

## Usage accounting (`sessions-usage`)

Every finished chat run stores what its log reported in `run_usage` (one row per run and model).

- **Send turns with known numbers.** `{"content":"first [fake: usage=1200,340,5000,61000]"}`, then `{"content":"second [fake: usage=100,50,0,2000]"}` (the four numbers are input, output, cache write, cache read).
- **Read them back.** `curl -s <api>/api/usage/threads/<id>` returns totals `1300, 390, 5000, 63000`, cost `0.237` and `runs: 2`, and one `byModel` entry for `fake-model` (after the first turn alone: `1200, 340, 5000, 61000` at `0.22875`). `curl -s <api>/api/usage/runs/<run id>` returns one turn (run ids: `sqlite3 "$AOP_DB_PATH" 'select id from chat_runs'`), and `sqlite3 "$AOP_DB_PATH" 'select * from run_usage'` shows the rows. The fake prices a turn at Opus list prices.
- **Restart.** `bun $S/verify-stack.ts restart-server --name <run>`, then read the session again: same totals.
- **A killed turn.** `{"content":"break [fake: steps=2 crash=3 usage=700,80,0,9000]"}`. The run fails (`Runtime exited with code 137. ...`) and the totals grow by 700, 80, 0, 9000 (to `2000, 470, 5000, 72000` and `runs: 3`) while the cost stays `0.237`: the CLI died before its result, so the assistant messages it streamed are counted and nothing is priced.
- **A project.** `GET <api>/api/usage/projects/<id>` reports a project's totals, its `byModel` and one entry per thread; `since` and `until` narrow the window. There is no usage screen yet: it is the Usage tab of project settings.

## Server crash during a turn (`sessions-restart`)

A crashed server leaves the detached CLI running. The chat run records the CLI's pid (`chat_runs.pid`), so the restarted server can stop it or notice it died.

- **Crash mid-turn.** Send `{"content":"long job [fake: steps=3 delay=20000]"}`. Read the pid with `sqlite3 "$AOP_DB_PATH" 'select id,status,pid from chat_runs order by rowid desc limit 1'`. Run `bun $S/verify-stack.ts restart-server --name <run> --crash`; it SIGKILLs the server, so no shutdown hook runs, and starts a new one on the same port and DB. `ps -p <pid>` still lists the fake.
- **Stop after the restart.** `GET <api>/api/chat-sessions` reports `assistantLifecycle: "uncontrollable"` for the session. `POST <api>/api/chat-sessions/<id>/abort` with `{}` answers `{"aborted":true,"disposition":"durable_cancelled"}`, the last message reads `Stopped after the app restarted.`, the run is `cancelled`, and `ps -p <pid>` finds nothing. Before this existed, Stop only edited the row and the CLI kept running.
- **CLI dies while the server is down.** Send `carry on [fake: steps=4 delay=3000 crash=6]`, then `restart-server --crash` within a few seconds. About 18 seconds later the fake crashes. The restarted server sees the recorded pid is gone and fails the run with `The runtime process exited without a final response. Try again, or reset the runtime session.` instead of leaving it running forever. This variant was checked through the composer before the page was removed and has not been re-driven through the API.
- **Proof.** The `chat_runs` rows before and after, `ps -p <pid>`, and the two session reads.

## Gotchas

- Only `/clear` and `/alias` are handled by AOP as chat commands (`apps/local-server/src/chat-session/commands.ts`); any other text, including `/status` and `/workflow`, is forwarded to the session's runtime, which is the real CLI unless the session is on the fake. Whether `/clear` works through the messages route was not re-driven after the composer was removed.
- A new session defaults to `Claude Code`, the user's real CLI, unless the stack was seeded with `--fake-runtime`.
- Bodies with `[fake: ...]` markers: the marker's quoting is JSON-in-shell-in-JSON. A file per request avoids it.
