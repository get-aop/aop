# Project event stream

One SSE connection per project, `GET /api/projects/:projectId/stream`, carries project, thread and message changes and can be resumed from any point. There is no Projects UI yet, so this map drives the stream from a browser tab with an `EventSource`. The protocol is in `docs/architecture/project-event-stream.md`.

## Sub-features

- `stream-live` receives entries appended after connecting.
- `stream-resume` reconnects with `?after=` and gets exactly the entries it missed.
- `stream-restart` keeps the browser's own reconnect (`Last-Event-ID`) working across a server restart.
- `stream-removal` ends a stream when its project is removed.

## How to get to it (user POV)

Nothing in the dashboard opens it yet. The Projects dashboard will open one `EventSource` per project.

## Driving it with verify-stack and drive

Preconditions:

- A started run (no fake runtime needed; this recipe sends no chat).
- `S=.claude/skills/verify/scripts`. Events come from `bun $S/seed-events.ts --name <run> <command>`, which writes through the same publisher the server uses. It opens the run's database directly, so the running server delivers the entry on its next heartbeat read of the log, at most 5 seconds later. Live reply text cannot be seeded this way; the tests cover it.
- Seed: `project demo` (creates the project and its `project.upserted`), `thread demo t1 "A title"`, `status t1 idle`, `message demo m1 "text" [threadId]`, `remove demo` (only for a project with no threads).

- **Connect.** In Chrome, open a new tab on `<dashboard>/` and run in `javascript_tool`: create `new EventSource('/api/projects/demo/stream')` and add listeners for `entry`, `resync`, `delta` and `heartbeat`. It opens with a `heartbeat`, then `resync` `{"cursor":<newest id>,"reason":"start"}` because there is no cursor.
- **Receive (`stream-live`).** Run `seed-events.ts --name <run> message demo m1 hi`. Within 5 seconds the tab logs `entry` with `id` and `lastEventId` equal to the entry id.
- **Resume (`stream-resume`).** `close()` the `EventSource`, seed three more entries, then open `new EventSource('/api/projects/demo/stream?after=<last id seen>')`. It logs exactly the three, in order, with no `resync` and no repeat of an entry already seen. Entries of another project (`project other`) never appear.
- **Restart (`stream-restart`).** With an `EventSource` open, run `bun $S/verify-stack.ts restart-server --name <run>`, and seed an entry around it. The browser logs an `error` (readyState 0), reconnects by itself about 3 seconds later, and logs the entries it missed, in order, without a `resync`: it sent `Last-Event-ID`.
- **Removal (`stream-removal`).** For a project without threads run `seed-events.ts --name <run> remove other`. The open stream logs `entry` `project.removed`, the server ends the response, and the reconnect gets `404`, so `readyState` becomes 2 and it stops. `fetch('/api/projects/other/stream?after=0')` from before the removal still returns the `project.removed` entry once.
- **Proof.** The logged frames from the tab (ids and order), the seed commands and their printed ids, and `read_console_messages` for the tab.

## Gotchas

- The seeded `thread` is a real `chat_sessions` row with a project id. The Sessions dashboard lists it and its runtime is `claude-code`: never type into it. Use a stack of its own for chat checks.
- A seed runs in another process, so the server has no in-memory notification for it; entries arrive on the next heartbeat. That is the fallback path, not the fast one, which the tests cover.
- The dashboard dev server proxies `/api` with Bun's default 10 second idle timeout. The stream's 5 second heartbeat keeps it open; a longer interval would drop the connection every 10 seconds (it would reconnect and resume).
