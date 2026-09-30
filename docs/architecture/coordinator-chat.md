# The coordinator chat in the dashboard

The Coordinator tab of a project is the conversation with its coordinator: what was said, the reply being written, the cards of the threads it started, and a box to say more. The code is in `apps/dashboard/src/projects/chat/`. The wire types (`Message`, `MessageBlock`, `MessageDelta`, `Resync`) are in `@aop/common`, and the stream is described in [Project event stream](./project-event-stream.md).

## Three sources, one rule

The page learns about messages from three places that overlap and can arrive in any order:

1. A fetch of `GET /api/projects/:id/messages`, which returns the latest 200 messages, oldest first.
2. The project's stream: a `message.created` entry for every message (the person's, the coordinator's, and the reports threads send it), and `delta` frames with the text of a reply being written.
3. The message a send returns: `POST /api/projects/:id/messages` answers with the stored message, not with the coordinator's reply.

Every message is applied by its id (`chat-state.ts`). Applying one the page already holds replaces it in place, so a fetch, a replayed entry and a send that return the same message leave one copy.

## Staying complete

`useProjectChat` starts when a project opens and runs until it closes, whichever tab is showing. It listens to the stream first and fetches after, so a message stored between the two is either in the fetch or on the stream.

- **A fetch in flight.** Messages that arrive while it runs are applied at once and again on top of its result, so a fetch that was read before them cannot roll them back. When a newer fetch starts, an older one that is still running is dropped.
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

The host has no route for accepting a proposal: starting one is `POST /api/projects/:id/threads` with the suggestion's title, brief and repository, and nothing on the host records that a suggestion was started or skipped. The page keeps that answer per device in local storage, by the suggestion's id, so a reload shows the same state. A proposal answered on another computer shows as waiting again on this one, and starting it there would make a second thread. Recording the answer on the host would close that gap.

## What this device has seen

The host keeps no read state for the chat, so the page does. The first time a device loads a project, everything already there counts as seen. After that the newest message it has looked at is kept in local storage, and the Coordinator tab shows how many replies came after it while another tab is open. Opening the chat draws a "New" line above the first reply that came since and keeps it there while the chat stays open; a message is looked at only while the page is visible.

## Paused and archived projects

The host refuses a message to a project that is not active. The pane says so, disables the box, and offers Resume or Restore. Threads cannot be started from a proposal either.
