# The coordinator chat in the dashboard

The coordinator chat, the middle pane of a project's screen, is the conversation with its coordinator: what was said, the reply being written, the cards of the threads it started, and a box to say more. The code is in `apps/dashboard/src/projects/chat/`. The wire types (`Message`, `MessageBlock`, `MessageDelta`, `Resync`) are in `@aop/common`, and the stream is described in [Project event stream](./project-event-stream.md).

## Three sources, one rule

The page learns about messages from three places that overlap and can arrive in any order:

1. A fetch of `GET /api/projects/:id/messages`, which answers `{ messages, hasMore }`: the latest 200 messages, oldest first, and whether older ones exist. `?before=<message id>&limit=<n>` (limit 1 to 500) answers the page before that message, so the page keeps paging back by the oldest message it holds (`loadEarlier`). A newest-page fetch after a resync keeps the older pages already loaded when it joins them. A reply whose run failed (not a usage-limit wait) carries `failed: true`, in the fetch and in its `message.created` entry alike, and is drawn as an error.
2. The project's stream: a `message.created` entry for every message (the person's, the coordinator's, and the reports threads send it), a `message.updated` entry when the host changes a message after it was created (an answered proposal, see [Suggested threads](#suggested-threads)), and `delta` frames with what changed in a reply being written.
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

The host stores messages in the order they were written and gives a reply the place of the message that started its turn, so a message held for after the coordinator's turn comes after the reply it waited for. A message the person sends while the coordinator works goes into its running turn (see [Messages sent while a turn runs](./README.md#messages-sent-while-a-turn-runs)): it carries `steers`, the reply it went into, and is drawn inside that reply, never as a row of its own, and it is never left to answer. While the coordinator works, the box says where a message lands ("Reaches it after its current step"); Alt+Enter, or "Send after this turn" on that line, sends it with `midRunMode: "queue"` to hold it until the turn ends. A fetch returns that order. The page reproduces it for messages that reach it one by one: a reply goes right after the oldest message that no reply follows yet, and any other message goes to the end. Reading a conversation after a reload therefore gives the same order as watching it.

The messages that no reply follows are also what says the coordinator is working: the pane shows "Coordinator is working" and how long, while the project is active.

## A reply being written

A reply is written token by token: Claude Code runs with `-p --include-partial-messages`, and the host reads its text and reasoning deltas from the run's log as they land (see [Project event stream](./project-event-stream.md#live-turns)). Before its message exists, the reply arrives as `delta` frames that change its parts: a paragraph starts or grows, a tool call starts, finishes or fails, reasoning grows. The page keeps the parts by the id the message will have (`chat-state.ts`), and a delta that arrives after its message is ignored.

The reply is drawn by the same row as its finished message (`AssistantRow`, under the message's id), placed right after the message it answers (`inReplyTo` on the delta), which is where the message lands. When `message.created` arrives, only the data under the mounted row changes: the parts the person watched are the parts the message stores, so nothing is swapped, dropped or typed again. A line under it says the coordinator is working and for how long; it goes once nothing is left to answer.

**The reveal.** Prose that arrives is typed out word by word (`use-turn-reveal.ts`), never letter by letter, at a pace that keeps it at most about 0.4 s behind what has arrived (`max(80 chars/s, backlog / 0.4 s)`). Tool calls, reasoning, cards and receipts appear when the prose before them is shown. What exists when a row mounts shows at once: a message loaded from history, or a reply the page joined mid-turn. When the turn ends with prose still to show, it drains at the same pace instead of appearing at once. Streamdown's own animation stays off; prose still being written gets its caret and has open markdown (a fence, a link) completed, and messages from history render in static mode.

**Following the end.** The transcript follows its end while the person is there (`ui/message-scroller.tsx`): whenever the content or the view changes size, a ResizeObserver sets `scrollTop` to the end before the frame is painted, with no smooth scroll to restart. Scrolling up, even a little, stops following and shows "Scroll to latest"; scrolling back near the end, or sending a message, follows again.

**Reconnecting.** The page keeps the live parts it holds when the connection drops. Each connection opens with a `live` snapshot of the turns being written, after the replay: a turn in it goes on from what the page already showed (the reveal only moves forward when the baseline extends it), and a turn the page holds that is not in it ended while the page could not hear, so its parts go (its message, if it has one, was in the replay). The snapshot comes once per connection, so the page also keeps every project's turns being written as its stream told them (`live-turn-mirror.ts`, `LiveProjects.liveTurns`): a conversation that starts on a stream already open (a thread pane opened again, or opened for another thread, mid-turn) starts from them, shows the turn so far at once, and goes on from there. A delta with an `end` op drops a turn that ended without a message.

## What a reply is made of

An assistant message is a list of blocks (`MessageBlocks.tsx`). It starts with the parts its turn produced, in the order it produced them (`TurnPart`: prose, tool calls, reasoning), followed by the blocks its tools posted:

| Block | Shown as |
| --- | --- |
| `text`, `thread-chip`, `pr-chip` | One paragraph of prose with the chips inside the sentence. A thread the text links to as `[title](thread:<id>)` is a chip too, live and finished alike: `ChatMarkdown` points such links at a reserved address that its link renderer swaps for the chip (`inline-run.ts`). `thread-chip` blocks are only in messages stored before that. |
| `tool` | One tool call where the agent made it: its status, its name (an MCP tool reads as "aop · thread spawn") and what it was asked to do, which opens in full on a click. Calls made one after another fold into "N tool calls", which opens to their rows; while the agent is on them, the line names the call in progress. What a tool returned is never shown. |
| `thinking` | A folded "Thinking" line that opens to the reasoning; "Thinking…" while the agent is still on it. |
| `steer` | A message sent into the turn while it ran, where the agent took it in: the person's bubble (or, in a thread, the coordinator's card with the person's words it forwards), "Sent while it worked" under it. A message with `steers` and no `steer` part yet waits at the end of the reply being written; a stopped turn that never took it says so. |
| `routing-receipt` | "Sent to one thread" or "Sent to 3 threads", after what the reply said, with a chip for each thread that has no card of its own in the same message. Blocks keep the order they were written in, so nothing lands above what the person has read. |
| `thread-card` | A card that follows its thread: `needs-call` with the question and View thread while the thread waits on the person, `live` with the status line and steps while it works, `done` with the pull request chip. The variant in the block is only what the card shows until the thread has loaded. |
| `suggested-threads` | Proposals, each its title and one line of reason with a start button (↵); Skip shows on hover, and "Start N threads" starts the ones still waiting. |

The coordinator writes a thread into a reply as `[its title](thread:<id>)`; the text keeps the link, and the chip shows the thread's own title, state and, on hover, how many replies and how long ago. `thread_spawn` and `thread_steer` add the thread to the reply's routing receipt.

**Where the parts are kept.** A finished turn's parts are in `chat_messages.parts` (migration v16), written when the run is finalized: calls still running then are done (or failed, when the run failed or was stopped), and the turn ends with the run's final text unless it already does, so a reply that failed, waited out a limit or was stopped says so after what it wrote. `chat_messages.content` keeps the final text alone, which the history prompt and thread reports use; a reply's copy button copies all its prose. A reply stored before parts existed is read from its `content` and its older `activity` (reasoning, the paragraphs said while working, the tool calls, then the answer).

A thread's report to the coordinator is a `thread-report` message. It is drawn as an event line naming the thread and what happened, with the report behind "Show report", and never as something the person said. The person's own messages are shown as typed, not read as markdown, with the images they attached above them (see [Images](#images)).

Reports that arrive close together are answered by one coordinator turn (see [the MCP guide](../MCP.md)). Its reply says which message it answers (`inReplyTo`, the newest report of the batch), so it reads after every report it answers, live as well as after a reload, and no report is left looking unanswered.

## Images

The person can attach images to a message, in the coordinator chat and in a thread alike: paste one into the box, drop one on it, or pick files with the "+" before the model chip. The box is one component for both chats (`chat/Composer.tsx`, with `image-attachments.ts` and `ComposerImages.tsx`). Up to 5 PNG, JPEG, GIF or WebP images of 10 MB or less go with one message (`CHAT_IMAGE_LIMITS` in `@aop/common`); a message of images alone needs no text.

1. **Upload.** Each image uploads as soon as it is added: `POST /api/projects/:projectId/attachments`, the file's own bytes as the body (no multipart, no path on the client's disk), so the browser, the desktop app and a remote host all send it the same way. The host names the type from the bytes, not from `Content-Type`, refuses anything else (`415`), an empty body (`400`) and one over the limit (`413`), and keeps the image under `<AOP_HOME>/projects/<id>/uploads/` with an `img_` id. An upload never sent is pruned after a day, and goes with the project.
2. **Send.** `POST /api/projects/:id/messages` and `POST /api/threads/:id/messages` take `images`, the upload ids in order. An id that is not a waiting upload of the project refuses the message (`400`) and nothing runs. Once stored, the images are copied into the conversation's attachments (`logs/chat-sessions/<session>/attachments/<message id>-<n>.<ext>`), named in the message's content trailer, and the uploads are removed. The box sends only when every image has uploaded, and keeps them if the send is refused.
3. **The model.** A turn gives Claude Code its message as one stream-json user message on stdin (`--input-format stream-json`): the images as base64 image blocks, then the prompt's text (`packages/llm-provider/src/providers/claude-code-input.ts`). The model sees the images themselves, whatever tools the run has; the coordinator has no Read tool to open a file by its path. The message goes through the run's input relay, which reads it from a file beside the run's log and removes it (see [Messages sent while a turn runs](./README.md#messages-sent-while-a-turn-runs)), so the run still outlives a host that crashes. A message sent while the turn runs carries its images the same way. The prompt's text also lists each image's path, for a thread that wants the file itself and for runtimes that take no images.
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
2. **The survey.** One thread titled "What <name> does and what's in flight", in the project's first repository, with a brief to look around. Its card sits under the welcome and it shows in the threads panel like any thread. It runs read-only whatever the project's thread access: its session is `approval-required`, so a headless run denies file edits and commands except `git log`, `git show`, `git branch`, `git status`, `gh pr list`, `gh pr view`, `gh issue list` and `gh run list` (`READ_ONLY_COMMANDS` in `chat-session/run-profile.ts`), and changing the project's thread access leaves it as it is. The host's Skip permission checks setting leaves it read-only too, since bypass mode would ignore that allow-list.
3. **The summary and proposals.** The survey's first finished report reaches the coordinator with an ask: two or three sentences on the project and what is in flight, pointing to the survey as `[title](thread:<id>)`, then `propose_threads` with two to four threads and their reasons, weighed against the goal. The reply shows the survey as a chip, not a card (the report's origin carries `kickoff: true`), followed by the Suggested threads block.

**Once only.** Table `project_kickoffs` (migration v12) holds one row per project with a survey to run: `pending` until the survey starts, `surveying` with the thread once it is stored, `reported` once its report carried the ask. Each step is a compare-and-set in the transaction that does it, so the survey starts at most once and the ask is made at most once. A host that restarts before a pending survey started starts it after it listens (`resumePending` in `server.ts`); a start that races it finds the row claimed and stores no thread.

## What this device has seen

The host keeps no read state for the chat, so the page does. The first time a device loads a project, everything already there counts as seen. After that the newest message it has looked at is kept in local storage, and opening the chat draws a "New" line above the first reply that came since and keeps it there while the chat stays open; a message is looked at only while the page is visible and the chat is on screen (not hidden by an expanded panel or, on a phone, by the panel).

## Paused and archived projects

The host refuses a message to a project that is not active. The pane says so, disables the box, and offers Resume or Restore. Threads cannot be started from a proposal either.
