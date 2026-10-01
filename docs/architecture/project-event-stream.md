# Project event stream

One Server-Sent Events connection per client and project carries everything that happens in that project: the project's own changes, thread status changes, every message (coordinator and thread), and the replies being written, as they are written. A browser allows six connections per origin over HTTP/1.1, so a client keeps at most one stream per project open and filters by `threadId` on its side.

```
GET /api/projects/:projectId/stream?after=<entry id>
```

The server code is in `apps/local-server/src/event-log/`. The wire types (`EventLogEntry`, `MessageDelta`, `LiveOp`, `LiveSnapshot`, `Resync`, `PROJECT_STREAM_EVENTS`) are in `@aop/common`, with the pure functions both sides use on live turns (`applyLiveOps`, `diffTurnParts`, `compactLiveOps` in `projects/live-turn.ts`).

## The log

Every change a client must learn about is appended to the `event_log` table as an `EventLogEntry` and gets an id that only grows. Ids are never reused, even after old entries are trimmed. Entries carry whole entities (`project.upserted`, `thread.upserted`, `message.created`, `message.updated`) or a removal (`thread.removed`, `project.removed`), and a client applies them by id, so replaying a range twice leaves the same state. `message.updated` carries a message the host changed after it was created, as when a suggested thread is answered; it has the payload of `message.created`, and a client replaces the message it holds.

Domains do not write the table. They call the publisher on `LocalServerContext`:

- `publisher.publish(entry)` stores one entry and delivers it.
- `publisher.transaction(({ db, append }) => ...)` commits the entries together with the state change they describe, and delivers them only after the commit. Use it for every change that also writes other tables, so an entry exists exactly when its change does.
- `publisher.publishLive(delta)` and `publisher.clearLive(...)` carry the replies being written (see below).

The `project.removed` entry has no foreign key to the project: it must outlive the row it announces.

## Frames

Every frame's `data` is JSON.

| SSE `event` | SSE `id` | `data` | Meaning |
| --- | --- | --- | --- |
| `entry` | the entry id | `EventLogEntry` | A durable change. Its id is the cursor. |
| `delta` | none | `MessageDelta` | What changed in an assistant turn being written. Not stored, not replayed. |
| `live` | none | `LiveSnapshot` | Every turn of the project being written as the connection opens, once per connection, after the replay. |
| `resync` | the new cursor | `{ cursor, reason }` | The client cannot be caught up from the log. |
| `heartbeat` | none | `{}` | The connection is alive. Sent first, and every 5 seconds. |

Only `entry` and `resync` carry an id, and it is always a log id. A browser that reconnects by itself sends the last id it saw as `Last-Event-ID`, and `delta`, `live` and `heartbeat` never move it.

## Resuming

A client resumes with `?after=<last entry id>`. The browser's own reconnect sends `Last-Event-ID` instead, and when both are present the larger one wins, because the URL keeps the cursor of the first connection. Both must be non-negative integers, or the server answers `400`.

The server replays the project's entries after the cursor, oldest first, then keeps the connection open. Replay after a reconnect, after a server restart, and live delivery are the same code: the stream reads the log after its cursor whenever a commit, a heartbeat or a reconnect says to. A wake-up that is missed delays an entry by at most one heartbeat; it cannot lose it.

A client with no cursor gets a `resync` first, with `reason: "start"`. The client:

1. Receives `resync`.
2. Fetches the project, its threads and its messages over REST, starting after the event, so everything up to `cursor` is in what it fetches.
3. Applies the entries that follow. They are idempotent, so overlap with the fetch is harmless.
4. Stores the newest entry id it applied, and resumes from it next time.

`resync` is also sent when the cursor cannot be served: `trimmed` (entries after it were trimmed), `ahead` (it is newer than any entry, as after a restored or replaced database), `too-large` (more than 1,000 entries behind) and `unreadable` (an entry after it was stored under an older schema and can no longer be read). The stream then continues from the cursor in the event.

A project that was deleted answers `404` to a client that has already seen the removal, and to a client with no cursor. A client resuming from before the removal receives the `project.removed` entry and the stream ends. A client that gets `project.removed` closes its `EventSource`, or the browser reconnects and gets the `404`.

## Live turns

A reply is written over seconds, and a turn is more than its text: it is ordered parts (`TurnPart`), prose, tool calls and reasoning, the same parts its message stores when it ends. A delta names the id the finished reply will have (`messageId`) and the message it answers (`inReplyTo`), and carries ops on the parts, applied in order:

| Op | Does |
| --- | --- |
| `reset` | The turn so far, replacing what the client holds. |
| `start` | A new part at the end (`index` is how many parts the client held). |
| `append` | Text added to the prose or reasoning at `index`. |
| `tool` | The tool call at `index` finished, failed, or says more about what it does. |
| `end` | The turn ended without a message; its live parts go. |

**Where they come from.** Claude Code runs with `-p --include-partial-messages` and writes its output to a log file, so a run outlives the server (see [the architecture](./README.md)). The host tails the log every 100 ms (`chat-session/stream-progress.ts`, which decodes UTF-8 across reads so a character split between two writes is not garbled). `stream-progress-parse.ts` reads the `stream_event` lines (a message starting, a content block opening, `text_delta` and `thinking_delta`, the block closing) as well as the finished blocks, and `turn-accumulator.ts` folds them into parts: a delta grows its part, and the finished block that follows settles it instead of adding another. Subagent events (with a `parent_tool_use_id`) are left out; the Agent call shows their progress. Partial events made up about 60% of a text-heavy log in a real run, which `CHAT_MAX_LOG_BYTES` (64 MB, a soft cap that only warns) leaves room for; final-text, outcome and usage extraction read the finished events and the result as before.

**On the stream.** The project's session hooks diff each snapshot of a turn's parts against what clients already have (`diffTurnParts`) and publish the ops; nothing new, nothing sent. The publisher keeps every running turn's parts (`live-turns.ts`), and a connection opens with a `live` frame after its replay: each running turn as a `reset`. A client drops the live parts of any turn it holds that the snapshot does not name: it ended while the client could not hear, and its message, if any, was in the replay. The client shows the parts of every `messageId` it does not yet hold as a created message, and drops them when the `message.created` entry with that id arrives, which makes the order in which the two paths deliver irrelevant. A turn that ends without a message is ended with `clearLive`, which sends `end`. After a server restart, recovery tails the logs of runs still writing and publishes their turns again.

A slow client costs one waiting frame per running turn, not one per chunk: deltas that arrive while a write is pending are merged, and their ops compacted (what precedes a `reset` or `end` goes, appends to one part join).

## Trimming and bounds

The log keeps its newest 10,000 entries, over all projects. It is trimmed after any append whose id is a multiple of 1,000, so it never exceeds 11,000. Trimming only removes the oldest prefix, so one number, `trimFloor`, says which cursors are still complete: a cursor below it may have missed entries, one at or above it has missed none. The stream checks it on every read.

A client more than 1,000 entries behind is not replayed to; it resyncs. Every read is one page of 200 entries, so a slow or distant client never holds more than that in memory.
