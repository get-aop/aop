# The coordinator chat in the dashboard

The coordinator chat, the middle pane of a project's screen, is the conversation with its coordinator: what was said, the reply being written, the cards of the threads it started, and a box to say more. The code is in `apps/dashboard/src/projects/chat/`. The wire types (`Message`, `MessageBlock`, `MessageDelta`, `Resync`) are in `@aop/common`, and the stream is described in [Project event stream](./project-event-stream.md).

## Three sources, one rule

The page learns about messages from three places that overlap and can arrive in any order:

1. A fetch of `GET /api/projects/:id/messages`, which answers `{ messages, hasMore }`: the latest 200 messages, oldest first, and whether older ones exist. `?before=<message id>&limit=<n>` (limit 1 to 500) answers the page before that message, so the page keeps paging back by the oldest message it holds (`loadEarlier`). A newest-page fetch after a resync keeps the older pages already loaded when it joins them. A reply whose run failed (not a usage-limit wait) carries `failed: true`, in the fetch and in its `message.created` entry alike, and is drawn as an error.
2. The project's stream: a `message.created` entry for every message (the person's, the coordinator's, and the reports threads send it), a `message.updated` entry when the host changes a message after it was created (an answered proposal, see [Suggested threads](#suggested-threads)), and `delta` frames with the text of a reply being written.
3. The message a send returns: `POST /api/projects/:id/messages` answers with the stored message, not with the coordinator's reply.

Every message is applied by its id (`chat-state.ts`). Applying one the page already holds replaces it in place, so a fetch, a replayed entry and a send that return the same message leave one copy. A `message.updated` entry replaces the copy held too, but is never the way a message gets in: one the page does not hold is ignored, because the page holds only a window of the conversation (the latest page, and the older pages it loaded) and an old message would be put at the end.

## Staying complete

`useProjectChat` starts when a project opens and runs until it closes, whether or not the pane is on screen. It listens to the stream first and fetches after, so a message stored between the two is either in the fetch or on the stream.

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
| `suggested-threads` | Proposals, each its title and one line of reason with a start button (↵); Skip shows on hover, and "Start N threads" starts the ones still waiting. |
| `quote-forwarded` | The person's words as the coordinator relayed them to a thread. |

The coordinator writes a thread into a reply as `[its title](thread:<id>)`; the host stores it as a `thread-chip` block, and the chip shows the thread's own title, state and, on hover, how many replies and how long ago. `thread_spawn` and `thread_steer` add the thread to the reply's routing receipt.

A thread's report to the coordinator is a `thread-report` message. It is drawn as an event line naming the thread and what happened, with the report behind "Show report", and never as something the person said. The person's own messages are shown as typed, not read as markdown, with the images they attached above them (see [Images](#images)).

Reports that arrive close together are answered by one coordinator turn (see [the MCP guide](../MCP.md)). Its reply says which message it answers (`inReplyTo`, the newest report of the batch), so it reads after every report it answers, live as well as after a reload, and no report is left looking unanswered.

## Images

The person can attach images to a message, in the coordinator chat and in a thread alike: paste one into the box, drop one on it, or pick files with the "+" before the model chip. The box is one component for both chats (`chat/Composer.tsx`, with `image-attachments.ts` and `ComposerImages.tsx`). Up to 5 PNG, JPEG, GIF or WebP images of 10 MB or less go with one message (`CHAT_IMAGE_LIMITS` in `@aop/common`); a message of images alone needs no text.

1. **Upload.** Each image uploads as soon as it is added: `POST /api/projects/:projectId/attachments`, the file's own bytes as the body (no multipart, no path on the client's disk), so the browser, the desktop app and a remote host all send it the same way. The host names the type from the bytes, not from `Content-Type`, refuses anything else (`415`), an empty body (`400`) and one over the limit (`413`), and keeps the image under `<AOP_HOME>/projects/<id>/uploads/` with an `img_` id. An upload never sent is pruned after a day, and goes with the project.
2. **Send.** `POST /api/projects/:id/messages` and `POST /api/threads/:id/messages` take `images`, the upload ids in order. An id that is not a waiting upload of the project refuses the message (`400`) and nothing runs. Once stored, the images are copied into the conversation's attachments (`logs/chat-sessions/<session>/attachments/<message id>-<n>.<ext>`), named in the message's content trailer, and the uploads are removed. The box sends only when every image has uploaded, and keeps them if the send is refused.
3. **The model.** A turn whose message has images gives Claude Code one stream-json user message on stdin (`--input-format stream-json`): the images as base64 image blocks, then the prompt's text (`packages/llm-provider/src/providers/claude-code-input.ts`). The model sees the images themselves, whatever tools the run has; the coordinator has no Read tool to open a file by its path. The message goes through a file the detached CLI holds open, removed as soon as it is spawned, so the run still outlives a host that crashes. A turn without images keeps its prompt as an argument. The prompt's text also lists each image's path, for a thread that wants the file itself and for runtimes that take no images.
4. **History.** A user message carries `images` (`{ id, mimeType, path }`); `GET /api{path}` (`/projects/:projectId/images/:fileName`) serves one, found only through a message of that project's conversations. The page fetches it with its own credentials (an `<img>` cannot send the desktop app's bearer token), shows thumbnails above the bubble, and opens one larger on click.

## Suggested threads

The coordinator's `propose_threads` tool attaches a `suggested-threads` block to its reply: proposals with a title, a brief, a repository and a reason (one line of at most 140 characters that the person reads instead of the brief), each with an id of its own. Proposals stored before reasons existed have none and show their title alone. Nothing runs until the person answers one, and the host records the answer, so every device sees the same one.

**The record.** The `suggestion_answers` table (migration v10) has one row per answered suggestion, keyed by the id of the message that holds the block and the suggestion's id. `started` names the thread it made; `skipped` names none. A suggestion nobody answered has no row. The row goes with its message, and with its thread: deleting the thread, or a start that fails after the thread was stored, leaves the proposal open again.

**The routes**, under `/api/projects/:projectId/messages/:messageId/suggestions/:suggestionId`:

| Route | Does |
| --- | --- |
| `POST /start` | Starts the thread the suggestion proposes, from the title, brief and repository the host holds, not from what the client sends. `201` with the thread when this call made it, `200` with the same thread when the suggestion was already started. A paused project answers `409`, an unknown message or suggestion `404`. |
| `POST /skip` | Skips it. `{ answer }` is what stands afterwards: a proposal that was started stays started. |
| `DELETE /skip` | Takes a skip back, so the proposal waits again. |

**Starting once.** The row is written in the transaction that stores the thread, so an answer exists exactly when its thread does, and the table's key allows one `started` row per suggestion. Answers to one suggestion also wait for each other in the host (one at a time, per suggestion), so a second click does not plan a thread before it finds the first. Two clients that click Start together get the same thread back, one with `201` and one with `200`, and the project has one new thread. A skipped proposal can still be started; the start replaces the skip.

**How a client learns it.** The answer is part of the message: every message the host sends, whether from the list or the stream, carries it on its suggestion (`answer`, `started` with the thread id or `skipped`; absent while the suggestion waits). The run's stored blocks never hold it. When an answer changes, the host appends a `message.updated` entry with the whole message, in the same transaction, after the `thread.upserted` entry of the thread a start made. A page that loads later reads the answers from the list, so a reload, a second computer and a restarted host all show the same proposal state.

**What the page does.** `SuggestedThreads` draws each row from its suggestion's `answer` and keeps nothing of its own: a click asks the host, and the row changes when the entry arrives, like the thread actions do. While a start is running the row shows a spinner in place of its ↵ button. "Start N threads" starts the waiting proposals one after the other and goes away once none is waiting. Nothing is kept in local storage; a proposal answered by an earlier build's browser-local answer shows as waiting.

## First open

The New project dialog has "Let the coordinator look around first", on by default; it sends `lookAround: true` with `POST /api/projects` (an API call that leaves it out gets `false`, a project that stays quiet). With it on, a new project's chat fills in with no message from the person (`project/kickoff.ts`):

1. **The welcome.** The host posts it in the coordinator's name: an assistant message with no run, its origin `kickoff-welcome`. It says what the coordinator does and, with a repository, that it will look at what the project does and what is in flight. A project with no repository gets the welcome only, which says to attach one.
2. **The survey.** One thread titled "What <name> does and what's in flight", in the project's first repository, with a brief to look around. Its card sits under the welcome and it shows in the threads panel like any thread. It runs read-only whatever the project's thread access: its session is `approval-required`, so a headless run denies file edits and commands except `git log`, `git show`, `git branch`, `git status`, `gh pr list`, `gh pr view`, `gh issue list` and `gh run list` (`READ_ONLY_COMMANDS` in `chat-session/run-profile.ts`), and changing the project's thread access leaves it as it is.
3. **The summary and proposals.** The survey's first finished report reaches the coordinator with an ask: two or three sentences on the project and what is in flight, pointing to the survey as `[title](thread:<id>)`, then `propose_threads` with two to four threads and their reasons, weighed against the goal. The reply shows the survey as a chip, not a card (the report's origin carries `kickoff: true`), followed by the Suggested threads block.

**Once only.** Table `project_kickoffs` (migration v12) holds one row per project with a survey to run: `pending` until the survey starts, `surveying` with the thread once it is stored, `reported` once its report carried the ask. Each step is a compare-and-set in the transaction that does it, so the survey starts at most once and the ask is made at most once. A host that restarts before a pending survey started starts it after it listens (`resumePending` in `server.ts`); a start that races it finds the row claimed and stores no thread.

## What this device has seen

The host keeps no read state for the chat, so the page does. The first time a device loads a project, everything already there counts as seen. After that the newest message it has looked at is kept in local storage, and opening the chat draws a "New" line above the first reply that came since and keeps it there while the chat stays open; a message is looked at only while the page is visible and the chat is on screen (not hidden by an expanded panel or, on a phone, by the panel).

## Paused and archived projects

The host refuses a message to a project that is not active. The pane says so, disables the box, and offers Resume or Restore. Threads cannot be started from a proposal either.
