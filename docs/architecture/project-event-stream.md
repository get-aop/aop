# Project event stream

One Server-Sent Events connection per client and project carries everything that happens in that project: the project's own changes, thread status changes, every message (coordinator and thread), and the live text of replies being written. A browser allows six connections per origin over HTTP/1.1, so a client keeps at most one stream per project open and filters by `threadId` on its side.

```
GET /api/projects/:projectId/stream?after=<entry id>
```

The server code is in `apps/local-server/src/event-log/`. The wire types (`EventLogEntry`, `MessageDelta`, `Resync`, `PROJECT_STREAM_EVENTS`) are in `@aop/common`.

## The log

Every change a client must learn about is appended to the `event_log` table as an `EventLogEntry` and gets an id that only grows. Ids are never reused, even after old entries are trimmed. Entries carry whole entities (`project.upserted`, `thread.upserted`, `message.created`, `message.updated`) or a removal (`thread.removed`, `project.removed`), and a client applies them by id, so replaying a range twice leaves the same state. `message.updated` carries a message the host changed after it was created, as when a suggested thread is answered; it has the payload of `message.created`, and a client replaces the message it holds.

Domains do not write the table. They call the publisher on `LocalServerContext`:

- `publisher.publish(entry)` stores one entry and delivers it.
- `publisher.transaction(({ db, append }) => ...)` commits the entries together with the state change they describe, and delivers them only after the commit. Use it for every change that also writes other tables, so an entry exists exactly when its change does.
- `publisher.publishLive(delta)` and `publisher.clearLive(...)` carry live reply text (see below).

The `project.removed` entry has no foreign key to the project: it must outlive the row it announces.

## Frames

Every frame's `data` is JSON.

| SSE `event` | SSE `id` | `data` | Meaning |
| --- | --- | --- | --- |
| `entry` | the entry id | `EventLogEntry` | A durable change. Its id is the cursor. |
| `delta` | none | `MessageDelta` | Live text of an assistant turn. Not stored, not replayed. |
| `resync` | the new cursor | `{ cursor, reason }` | The client cannot be caught up from the log. |
| `heartbeat` | none | `{}` | The connection is alive. Sent first, and every 5 seconds. |

Only `entry` and `resync` carry an id, and it is always a log id. A browser that reconnects by itself sends the last id it saw as `Last-Event-ID`, and `delta` and `heartbeat` never move it.

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

## Live reply text

A reply is written over seconds. The stream sends its text as `delta` frames: the text appended since the last frame, or the whole text so far when `replace` is true. A client that connects mid-turn first receives the text so far as a `replace` frame, so later appends have a baseline. A delta names the id the finished reply will have (`messageId`). The client shows the live text of every `messageId` it does not yet hold as a created message, and drops it when the `message.created` entry with that id arrives, which makes the order in which the two paths deliver irrelevant. A turn that ends without a message is cleared with `clearLive`, which sends an empty `replace`.

A slow client costs one waiting frame per running turn, not one per chunk: deltas that arrive while a write is pending are merged.

## Trimming and bounds

The log keeps its newest 10,000 entries, over all projects. It is trimmed after any append whose id is a multiple of 1,000, so it never exceeds 11,000. Trimming only removes the oldest prefix, so one number, `trimFloor`, says which cursors are still complete: a cursor below it may have missed entries, one at or above it has missed none. The stream checks it on every read.

A client more than 1,000 entries behind is not replayed to; it resyncs. Every read is one page of 200 entries, so a slow or distant client never holds more than that in memory.
