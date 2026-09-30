# The coordinator chat in the dashboard

The Coordinator tab of a project is the conversation with its coordinator: what was said, the reply being written, the cards of the threads it started, and a box to say more. The code is in `apps/dashboard/src/projects/chat/`. The wire types (`Message`, `MessageBlock`, `MessageDelta`, `Resync`) are in `@aop/common`, and the stream is described in [Project event stream](./project-event-stream.md).

## Three sources, one rule

The page learns about messages from three places that overlap and can arrive in any order:

1. A fetch of `GET /api/projects/:id/messages`, which answers `{ messages, hasMore }`: the latest 200 messages, oldest first, and whether older ones exist. `?before=<message id>&limit=<n>` (limit 1 to 500) answers the page before that message, so the page keeps paging back by the oldest message it holds (`loadEarlier`). A newest-page fetch after a resync keeps the older pages already loaded when it joins them. A reply whose run failed (not a usage-limit wait) carries `failed: true`, in the fetch and in its `message.created` entry alike, and is drawn as an error.
2. The project's stream: a `message.created` entry for every message (the person's, the coordinator's, and the reports threads send it), a `message.updated` entry when the host changes a message after it was created (an answered proposal, see [Suggested threads](#suggested-threads)), and `delta` frames with the text of a reply being written.
3. The message a send returns: `POST /api/projects/:id/messages` answers with the stored message, not with the coordinator's reply.

Every message is applied by its id (`chat-state.ts`). Applying one the page already holds replaces it in place, so a fetch, a replayed entry and a send that return the same message leave one copy. A `message.updated` entry replaces the copy held too, but is never the way a message gets in: one the page does not hold is ignored, because the page holds only a window of the conversation (the latest page, and the older pages it loaded) and an old message would be put at the end.

## Staying complete

`useProjectChat` starts when a project opens and runs until it closes, whichever tab is showing. It listens to the stream first and fetches after, so a message stored between the two is either in the fetch or on the stream.

- **A fetch in flight.** Messages, and updates to them, that arrive while it runs are applied at once and again on top of its result, so a fetch that was read before them cannot roll them back. When a newer fetch starts, an older one that is still running is dropped.
- **Resync.** A `resync` event means the log cannot catch this client up, so the chat fetches again, starting after the event. The result replaces what the page held: a message the host no longer has disappears, and the ones that arrived meanwhile are put back on top.
- **A short break.** The browser, or the stream client, resumes from the last entry it saw, and the host replays what was missed. The replay is applied by id, so nothing is shown twice and nothing is missing.
- **A reload.** A new page has no cursor, the stream answers with a `resync`, and the chat fetches. A message the person typed and did not send is kept in local storage.
- **A failed fetch.** Before the first one succeeds the pane says so and offers to retry; later, it keeps what it has, says it could not refresh, and tries again every three seconds.

## Order

The host stores messages in the order they were written and gives a reply the place of the message that started its turn, so a message sent while the coordinator works comes after the reply it waited for. A fetch returns that order. The page reproduces it for messages that reach it one by one: a reply goes right after the oldest message that no reply follows yet, and any other message goes to the end. Reading a conversation after a reload therefore gives the same order as watching it.

The messages that no reply follows are also what says the coordinator is working: the pane shows "Coordinator is working" and how long, while the project is active.

## Live text

A reply's text arrives as `delta` frames before its message exists. The page keeps the text by the id the message will have and shows it where the reply will go, typed out at the pace it arrives. It drops that text when the `message.created` entry with the same id arrives, or when a delta with an empty replacement says the turn ended without a message. A delta that arrives after its message is ignored.

A client that connects mid-turn receives the text so far as a first frame with `replace` set, and the page rebuilds from it. When the connection drops, the page forgets the live text it holds, because the turn may have ended while it could not hear; the reconnect sends the baseline again for a turn that is still running.

## What a reply is made of

An assistant message is a list of blocks (`MessageBlocks.tsx`):

| Block | Shown as |
| --- | --- |
| `text`, `thread-chip`, `pr-chip` | One paragraph of prose with the chips inside the sentence. A chip is a link to a reserved address in the markdown that `inline-run.ts` builds, which the renderer swaps for the chip. |
| `routing-receipt` | "Sent to one thread" or "Sent to 3 threads", above the reply, with a chip for each thread that has no card of its own in the same message. |
| `thread-card` | A card that follows its thread: `needs-call` with the question and View thread while the thread waits on the person, `live` with the status line and steps while it works, `done` with the pull request chip. The variant in the block is only what the card shows until the thread has loaded. |
| `suggested-threads` | Proposals with Start, Skip and Start all. |
| `quote-forwarded` | The person's words as the coordinator relayed them to a thread. |

The coordinator writes a thread into a reply as `[its title](thread:<id>)`; the host stores it as a `thread-chip` block, and the chip shows the thread's own title, state and, on hover, how many replies and how long ago. `thread_spawn` and `thread_steer` add the thread to the reply's routing receipt.

A thread's report to the coordinator is a `thread-report` message. It is drawn as an event line naming the thread and what happened, with the report behind "Show report", and never as something the person said. The person's own messages are shown as typed, not read as markdown.

## Suggested threads

The coordinator's `propose_threads` tool attaches a `suggested-threads` block to its reply: proposals with a title, a brief and a repository, each with an id of its own. Nothing runs until the person answers one, and the host records the answer, so every device sees the same one.

**The record.** The `suggestion_answers` table (migration v10) has one row per answered suggestion, keyed by the id of the message that holds the block and the suggestion's id. `started` names the thread it made; `skipped` names none. A suggestion nobody answered has no row. The row goes with its message, and with its thread: deleting the thread, or a start that fails after the thread was stored, leaves the proposal open again.

**The routes**, under `/api/projects/:projectId/messages/:messageId/suggestions/:suggestionId`:

| Route | Does |
| --- | --- |
| `POST /start` | Starts the thread the suggestion proposes, from the title, brief and repository the host holds, not from what the client sends. `201` with the thread when this call made it, `200` with the same thread when the suggestion was already started. A paused project answers `409`, an unknown message or suggestion `404`. |
| `POST /skip` | Skips it. `{ answer }` is what stands afterwards: a proposal that was started stays started. |
| `DELETE /skip` | Takes a skip back, so the proposal waits again. |

**Starting once.** The row is written in the transaction that stores the thread, so an answer exists exactly when its thread does, and the table's key allows one `started` row per suggestion. Answers to one suggestion also wait for each other in the host (one at a time, per suggestion), so a second click does not plan a thread before it finds the first. Two clients that click Start together get the same thread back, one with `201` and one with `200`, and the project has one new thread. A skipped proposal can still be started; the start replaces the skip.

**How a client learns it.** The answer is part of the message: every message the host sends, whether from the list or the stream, carries it on its suggestion (`answer`, `started` with the thread id or `skipped`; absent while the suggestion waits). The run's stored blocks never hold it. When an answer changes, the host appends a `message.updated` entry with the whole message, in the same transaction, after the `thread.upserted` entry of the thread a start made. A page that loads later reads the answers from the list, so a reload, a second computer and a restarted host all show the same proposal state.

**What the page does.** `SuggestedThreads` draws each row from its suggestion's `answer` and keeps nothing of its own: a click asks the host, and the row changes when the entry arrives, like the thread actions do. While a start is running the row says "Starting…". "Start all" starts the waiting proposals one after the other. Nothing is kept in local storage; a proposal answered by an earlier build's browser-local answer shows as waiting.

## What this device has seen

The host keeps no read state for the chat, so the page does. The first time a device loads a project, everything already there counts as seen. After that the newest message it has looked at is kept in local storage, and the Coordinator tab shows how many replies came after it while another tab is open. Opening the chat draws a "New" line above the first reply that came since and keeps it there while the chat stays open; a message is looked at only while the page is visible.

## Paused and archived projects

The host refuses a message to a project that is not active. The pane says so, disables the box, and offers Resume or Restore. Threads cannot be started from a proposal either.
