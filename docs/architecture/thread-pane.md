# The Overview and the thread pane in the dashboard

The threads panel beside a project's chat opens on the Overview: every thread grouped by what it needs from the person. Choosing a thread replaces the Overview in the panel with the thread pane, at `/projects/:id/threads/:threadId`: its transcript, the question it waits on, the box to steer it, its pull request, and the files it changed. The code is in `apps/dashboard/src/projects/` (`ThreadOverview.tsx`, `selectors.ts`) and `apps/dashboard/src/projects/thread/`. The wire types (`Thread`, `Message`, `MessageDelta`, `TurnPart`) are in `@aop/common`; the routes are in [Threads and git](../THREADS.md) and [Run scheduling](../SCHEDULING.md).

## The Overview

`ThreadOverview` draws one group per thread status, in the order a person should look at them: waiting on you, working, queued, rate limited, ready for review, landing, idle, resolved. Waiting on you and Resolved are always there, at 0 with a line that says what goes in them, so a new project reads the greeting and "Nothing is waiting on you." above those two; any other status with no thread has no group. Resolved starts folded. The greeting (`greetingOf` in `projects/greeting.ts`) uses the host owner's name from the `display_name` setting, first word only: "Welcome, Ada." until a thread in the project is ready for review, landing or resolved, "Welcome back, Ada." after, and a plain "Welcome back." when no name is set. Under it a sentence says how many threads wait on the person; the groups carry the other counts. Searching opens every group and filters the cards. A stopped thread whose open pull request fails its checks (where auto-fix ends at its cap) is drawn as an alert on its card and in the chat, not as ready or done. A card changes in place as `thread.upserted` entries arrive on the project's stream, and a rate-limited card carries a Resume button.

## What the pane holds

| Part | Source |
| --- | --- |
| Header, one row: back link, title (clicking it shows status, repository, branch, last activity and usage) | the `Thread` in the project's live state; usage from `GET /api/usage/threads/:id`, read again whenever the status changes |
| Pull request bar | `thread.artifacts` (the `pr` item), the diff's file count, and the calls of `usePullRequestControls` |
| Notice: queued, rate limited (with a countdown to `resumesAt`), landing, resolved | the `Thread` |
| Steps checklist and status line | `thread.steps` and `thread.liveStatusLine` (the line only while the thread is at work) |
| Transcript, with each turn's tool calls and reasoning | `GET /api/threads/:id/messages`, the stream's entries and live turns |
| The question, with its options | `thread.blockedQuestion` |
| Changes | `GET /api/threads/:id/diff` and `/diff/file?path=` |

The thread is never copied into the pane: it is read from the project's live state, so every change the host publishes shows at once. No action sets the state either. Stop, Resume, Resolve, Delete, merge and the rest call the host, and the page follows the entry the host publishes. The one exception is the person's own message, which the pane fetches again after sending so it shows even while the stream is down.

## The transcript

A thread's conversation is kept by the same code as the coordinator chat (`chat/conversation.ts`): three overlapping sources, applied by message id. The state is scoped by a conversation id (`ChatState.scope`): `null` is the coordinator chat, a thread id is that thread. A message or a live-text delta of another conversation is ignored, which is what lets one stream carry every conversation of the project. [The coordinator chat](./coordinator-chat.md) describes the rule and how reconnects, resyncs and reloads stay correct; nothing in it differs for a thread.

What a thread's messages are:

- The first one is the brief. The coordinator sends it as a relay, so it arrives as an assistant message: an optional `quote-forwarded` block ("Message forwarded from project chat", folded by default), then the brief as text.
- The agent's replies are assistant messages: the parts each turn produced, in order (prose, tool calls, reasoning).
- What the person types is a user message. While the thread waits on a question, the answer is a user message too, sent through `POST /api/threads/:id/reply`.

The agent's tool calls and reasoning are parts of its replies, where it made them: a call as a compact row (its status, its name, what it was asked to do; never what the tool returned), calls made one after another folded into "N tool calls", reasoning as a folded "Thinking" line. While a turn runs they arrive with its text on the stream, token by token, and the reply is drawn by the row its finished message takes over in place, exactly as in [the coordinator chat](./coordinator-chat.md#a-reply-being-written). Below it a line names the agent by its runtime ("Claude Code is working") and counts up from the message that started the turn, or from the brief for a thread's first turn.

## Answering, steering, stopping

- **Waiting on you.** The answer card replaces the composer. Each option is a button (the recommended one is filled), and a one-line box takes an answer of the person's own. Either way the text goes to `POST /api/threads/:id/reply`, and the thread resumes in the same runtime session.
- **Steering.** The composer sends `POST /api/threads/:id/messages`. While the thread works, the message goes into its running turn, which reads it after the tool call it is on (see [Messages sent while a turn runs](./README.md#messages-sent-while-a-turn-runs)); the box says so under the text, and Alt+Enter, or "Send after this turn" beside that line, sends `midRunMode: "queue"` so the message waits for the turn to end instead. While the thread is idle it starts a new turn, and once the thread is resolved it reopens it. The reply draws a message sent into its turn where the agent took it in: the person's bubble, "Sent while it worked" under it, between what the agent did before and after. Until the agent takes it, it waits at the end of the reply being written ("it reads this after its current step"); a turn stopped before it did says so, and the message is dropped with the turn. It takes images like the coordinator's box (see [Images](./coordinator-chat.md#images)); a message queued while the thread works keeps its images for the turn it starts. The answer card's one-line box takes text only. A thread in `landing` takes no message, and neither does a paused or archived project; the box says why.
- **Stop.** While a turn runs or waits for a slot, the composer has a Stop button, and Escape in the box does the same; the header menu has Stop too. A rate-limited thread has no turn to stop: it waits for its reset, and its notice has Resume now (the host still accepts a stop for it).
- **Resume.** A rate-limited thread shows when it resumes by itself, counted down, and Resume now (`POST /api/threads/:id/resume`), also in the header menu. The same button is on its card in the Overview and in the coordinator chat.
- **Resolve and Delete**: a check button in the header resolves, and the header menu has both. Resolve is refused by the host while a turn runs or a merge is landing, so the item is disabled for those statuses. Delete asks first, since it removes the thread with its worktree and branch.

## The pull request bar

The bar is one slim row just above the box that steers the thread (at the bottom of the pane while the changes show). With no pull request it shows the thread's branch in a read-only field, "N files changed" (which opens the changes in the pane, and closes them), Create PR (with "as draft" behind its chevron), and a cross that puts the bar away for that thread until the header menu's "Show pull request bar" brings it back; with one open it shows "PR #N" with its checks, Sync, and Merge with its method (squash, merge commit, rebase); a merged or closed one shows what became of it. A pull request that exists is never put away. A thread that changed nothing, or that waits out a rate limit with no pull request, has no bar, and neither has a thread with no repository.

When the host refuses, the pane shows the host's own sentence and its code (`UNPUBLISHED_WORK`, `PULL_REQUEST_MERGED`, `NOTHING_TO_PUBLISH`, `THREAD_BUSY`, or the `PULL_REQUEST_FAILED` message GitHub gave), until the next attempt or until it is dismissed. Two refusals have a button that takes the step: `UNPUBLISHED_WORK` (the branch holds work its pull request lacks) offers Push the latest changes, which opens the pull request again, and `PULL_REQUEST_MERGED` offers Sync with GitHub.

## Changes

`GET /api/threads/:id/diff` lists the files the thread changed in its worktree against the default branch, with counts and no lines; a file's lines come from `/diff/file` when it is opened. Files open by default unless there are twelve or more. The list is read again when a turn ends or the pull request changes. A file the thread wrote and has not committed has its counts in the list too, so folded rows show them: the host reads the untracked file to count it, by the same rule as the lines `/diff/file` returns. Only an untracked text file over 1 MiB shows `+0 −0` until it is opened.

A line takes a review comment through the `+` in its gutter. Comments queue in this browser (per thread) and go to the thread together, as one message, from "Send N comments to the thread"; a send that fails keeps them. A thread whose worktree was removed (resolved, or its pull request merged) has no diff: the pane says so.

## Where it is not finished

- A thread's model and effort are read-only chips: a thread keeps the runtime it started with, and the host has no route to change one.
- The Library and Pull requests tabs of the video's Overview and Routines are not built: nothing on the host produces documents (`doc` artifacts) or lists pull requests across threads yet.
- Review comments queue per browser, not on the host.
