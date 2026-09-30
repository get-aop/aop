# Threads and git

A thread is one agent session that does one piece of work in one repository. A thread that has a repository works in a git worktree of its own, on a branch of its own, and lands its work through one pull request. This guide describes that lifecycle and what runs it.

## Worktree and branch

When a thread starts, AOP creates the worktree `~/.aop/worktrees/<repo-id>/<thread-id>` on a new branch named `aop/<title>-<last six characters of the thread id>`, cut from the repository's default branch (origin's `HEAD`, else `main` or `master`). A name that already exists as a branch gets a counter (`-2`, `-3`). Every turn of the thread runs in that worktree, and the repository's own checkout is never touched.

The thread records its `branch` and its `target` (`host`, the only kind today), and its session row records the workspace path. A thread in a project with no repositories works in a scratch directory and has no branch.

The thread's row is stored before its worktree exists, so nothing on disk is ever without an owner. The worktree is created again, from the branch when the branch survived, whenever a message reaches a thread that has none: after a resolve, an archive, a restart, or a deletion by hand.

## Pull request

A thread has at most one pull request, and a pull request belongs to one thread. The database enforces it: two threads of one repository cannot record the same pull request number.

Opening it commits what the worktree holds, pushes the branch to `origin` and runs `gh pr create`, so the host needs `origin` to be a GitHub remote and the GitHub CLI installed and signed in (`gh auth login`, then `gh auth status`). Without them the request is refused and the thread page shows the CLI's own words, for example `You are not logged into any GitHub hosts. To log in, run: gh auth login`. A thread may call it from inside its own turn. A second call opens nothing: it commits and pushes what the thread did since and returns the recorded pull request. A pull request that has merged or closed is not opened again; further work belongs in a new thread. A thread with nothing to publish is refused. Without a title, the thread's own runtime writes the title and description, and the thread's title stands in when it cannot. The number, URL and state are on the thread as its `pr` artifact, and every change publishes a `thread.upserted` entry on the project event stream.

Merging asks GitHub first. A merged pull request is finished and not merged again, and a closed one is refused. Otherwise the thread becomes `landing` and `gh pr merge` runs (squash unless told otherwise). Once the pull request is merged, the thread is `resolved`, and its worktree and branch are removed locally and on origin. A merge GitHub refuses (failing checks, conflicts, a review still needed) puts the thread back where it was and says why. Only what is on GitHub is merged, and the branch is deleted afterwards, so a merge is refused while the thread holds changes or commits its pull request lacks: opening the pull request again pushes them. A merge made on GitHub while the thread holds such work keeps the branch, with the work committed, and removes only the worktree.

## Watching the pull request

While a thread's pull request is open, the server watches it. It looks at GitHub through the `gh` CLI and needs no webhook, so a host behind a firewall works. Each look reads the pull request's state and head commit, its checks and its reviews. Line comments are read only when a review that requests changes is being answered.

**What it publishes.** What the checks add up to goes on the thread's `pr` artifact as `checks` (`state` is `pending`, `success` or `failure`, with the counts of `successful`, `failing` and `pending` checks), and a `thread.upserted` entry on the project event stream tells clients. A summary that reads the same twice is announced once. A repository whose pull requests have no checks has no `checks`. A change of the checks does not move the thread: its status, unread mark and last activity stay.

**What it answers.** The watcher sends the thread a message when its pull request has one of these:

| Trouble | When it counts | It is answered once for |
| --- | --- | --- |
| Failing checks | No check is still running, and one has failed. A check that waits for a human approval is not a failure. | Each run of each failing check |
| A review that requests changes | A review in the state `CHANGES_REQUESTED` by an owner, member or collaborator of the repository (on a public repository anyone can review, and a stranger's words are not something to send an agent off to act on), and still its reviewer's latest verdict: GitHub keeps a request in the list after the same reviewer approves. A review that only comments, or approves, is left to the person. | Each review |
| A merge conflict | GitHub says the pull request conflicts. | Each head commit that conflicts |

Trouble found together is one message. The message starts with `Automatic fix, attempt 1 of 3` and says that the watcher sent it, not the person. It names the failing checks with the link to each run and quotes the end of the log of each failing Actions run (`gh run view --log-failed`; at most 3 runs, 60 lines each), because a thread that may only edit files cannot run `gh` itself. Or it quotes the reviewers' words and line comments as feedback to weigh, not as instructions, or asks the thread to bring the base branch in and resolve the conflict, which a thread that cannot run `git` can only report. It tells the thread to push with `aop_open_pr`. It is cut to 16,000 characters, since a message to a thread is refused above 20,000. It is stored and started the way a person's message is, so the run queue and the worktree rules apply.

A thread that is `idle` or `ready-for-review` gets it, and its status is checked again as the message is stored (`send` with `onlyIn`), so a thread resolved or asked something while the watcher was reading GitHub is not reopened or answered. One that is `working`, `queued`, `rate-limited`, `waiting-on-you` or `landing` is left alone and asked at the next look if the trouble is still there: a message would queue behind its turn, end its wait on a limit or answer its question. A `resolved` thread is still watched but never reopened by a fix.

**The cap.** A thread's pull request gets 3 messages in all, whichever trouble they answered. There is no reset. When more trouble comes after the third, the watcher stops. It sets the thread's status line to `Auto-fix stopped after 3 attempts: ...`, marks the thread unread and tells the coordinator in a thread report (`needs-you`). It reports once, and sends nothing more for that pull request; the person or the coordinator can still message the thread.

**The setting.** The project setting `autoFixPullRequests` is on for every project until the person turns it off (project settings, General, Pull requests; or `PATCH /api/projects/:id`). Off means the watcher still publishes the checks and reports how the pull request ends, and sends no fix. The coordinator can read the setting and cannot change it.

**How it ends.** A pull request found merged is settled by the same landing the merge route uses (`syncPullRequest`): the thread is resolved and its worktree and branch are removed. One found closed without merging is recorded as `closed`, and the thread keeps its work. The coordinator gets a thread report for each (`finished`, and `needs-you`), written down before the thread is brought in line, so a crash in between reports nothing twice. A pull request that was merged or closed through AOP is not the watcher's find and is not reported. Commits pushed to the branch after the merge are not in the merged pull request, and go with the branch when the thread is cleaned up: this is how `syncPullRequest` already treats a merge made on GitHub.

**Notifications.** The server does not apply the project's notification level: the reports reach the coordinator whatever it is, and the client decides what to raise. The desktop app raises a notification for a coordinator post and for a pull request that merged or closed, read from the thread's `pr` artifact, and none when the level is `off`. A pull request found closed, and a thread the watcher gave up on, move the thread's last activity, since a client counts a thread that moved a moment ago as news; the second is also marked unread. The turn that a fix starts is reported to the coordinator like any turn, so `every-turn` hears of it.

**After a restart.** What the watcher answered is stored per thread (the `pull_request_watch` table): the failing check runs, reviews and head commits it sent a fix for, the attempts, and the reports it made. A fix is written down as an attempt, sent, and then confirmed; a crash between the two is settled by looking for the message in the thread, so a fix is neither sent twice nor lost from the count. The stored memory is not the thread's chat history, which a person can clear. When to look next is the only thing kept in memory.

**Pace and limits.** A pull request is looked at every 30 seconds while it changes or its checks run, and less and less often, down to every 5 minutes, while it stays as it is (also while a fix is owed to a thread that is not at rest); while its checks keep running the wait grows only to 2 minutes. A look that fails waits 1, 2, 4 minutes and so on, up to 15. All waits are spread by 20% so pull requests do not look in step. At most 4 pull requests are read at once, and one at a time within a repository. A rate limit from GitHub holds the whole repository for about 10 minutes. `AOP_PR_POLL_INTERVAL_MS` sets a fixed pace instead (see [the host guide](./HOST.md)). Only pull requests of active projects are watched.

What is not verified against the real GitHub: the calls are `gh pr view --json state,mergeable,headRefOid,baseRefName`, `gh pr checks <number> --json ...`, `gh api repos/{owner}/{repo}/pulls/<number>/reviews` (and `.../comments`, with `--paginate`) and `gh run view <run id> --log-failed`. Their output shapes come from `gh`'s documentation and are played by a fake (`.claude/skills/verify/scripts/fake-gh.ts`); no test calls GitHub.

## States

| Status | How a thread gets there |
| --- | --- |
| `working` | A message reaches it and a turn runs. |
| `queued` | A turn is accepted but waits for a free run slot. The thread keeps its worktree, and the turn runs in it when its slot comes. |
| `rate-limited` | The CLI refused a turn on a usage limit and the thread waits until it resets. It keeps its worktree, and the resumed turn runs in it. |
| `waiting-on-you` | It calls `aop_ask_user`. |
| `ready-for-review` | A turn ends with its checklist done or its pull request open, or a pull request is opened on an idle thread. |
| `landing` | A merge is running; the thread takes no message and is not resolved meanwhile. A restart that interrupts one is settled against GitHub at the next start. |
| `idle` | A turn ends with nothing more to say. |
| `resolved` | Marked resolved, merged, or idle for seven days. A message reopens it. |

## What is removed, and when

| Event | Worktree | Branch |
| --- | --- | --- |
| Pull request merged | Removed | Deleted, on origin as well |
| Thread resolved, including after seven idle days | Removed, after committing what it held | Kept |
| Project archived | Removed, after committing what it held | Kept |
| Thread or project deleted | Removed | Deleted, locally only |

Deleting a thread does not close its pull request on GitHub.

Every step can be run again after a crash and ends in the same state: creating a worktree that exists leaves it alone, releasing one that is gone succeeds, and opening or merging a pull request reads GitHub before it acts. Calls that open, merge or sync a thread's pull request run one at a time, and so do calls that create or remove its worktree. A worktree is never removed under a turn. Starting a turn and every release of the worktree run one at a time for a thread, and a release is refused as busy while the thread has a turn running, a message waiting (a turn queued for a run slot is one) or a usage-limit wait to resume from (resolving and archiving also while a merge is running). A pull request found merged while a turn is running is recorded and the thread carries on, to be resolved later. A repository that cannot be reached leaves its worktrees as they are: resolving and archiving wait for it, and a status is only ever changed from the one it was read in.

## HTTP and tools

| Route | Effect |
| --- | --- |
| `POST /api/threads/:id/pull-request` | Opens the pull request (`draft`, `title`, `body` optional). Answers 201, or 200 with the existing one. |
| `POST /api/threads/:id/pull-request/merge` | Merges it (`method`: `squash`, `merge` or `rebase`). |
| `POST /api/threads/:id/pull-request/sync` | Brings the thread in line with GitHub. |
| `GET /api/threads/:id/pull-request/watch` | What the watcher has done for the pull request: `enabled`, `maxAttempts`, `attempts`, `gaveUp`, and each `action` it took (`fix`, `cap`, `merged` or `closed`, with a one-line `summary` and the time). |
| `POST /api/threads/:id/resolve` | Resolves the thread. |
| `DELETE /api/threads/:id` | Deletes the thread with its worktree and branch. |
| `GET /api/threads/:id/diff` | The files the thread changed in its worktree, against where its branch left the default branch (committed, uncommitted and untracked), with line counts and no hunks. A thread with no repository answers 409 `NO_REPOSITORY`, and a resolved or merged thread, whose worktree is gone, answers 409 `WORKTREE_FAILED`: nothing is made to compare. |
| `GET /api/threads/:id/diff/file?path=` | One changed file's hunks, capped. `path` is relative to the worktree: an empty, absolute or escaping one answers 400 `INVALID_PATH`, and a file with no change 404 `FILE_NOT_FOUND`. |
| `GET /api/threads/:id/activity` | What the thread did besides talk: for each of its latest 30 turns that did something, the tool calls (label, detail, status) in batches and the status paragraphs it said, oldest first. A running turn is last, keyed by the id its message will have, and carries its tool calls only, since its text is the stream's live text. Tool output and reasoning are never returned. |

The MCP tools `aop_open_pr` (thread) and `thread_open_pr`, `thread_merge_pr` and `thread_resolve` (coordinator) do the same; see [the MCP guide](./MCP.md). The server runs a maintenance pass at start and every hour that settles landing threads and resolves threads idle for seven days.
