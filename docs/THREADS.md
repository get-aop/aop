# Threads and git

A thread is one agent session that does one piece of work in one repository. A thread that has a repository works in a git worktree of its own, on a branch of its own, and lands its work through one pull request. This guide describes that lifecycle and what runs it.

## Worktree and branch

When a thread starts, AOP creates the worktree `~/.aop/worktrees/<repo-id>/<thread-id>` on a new branch named `aop/<title>-<last six characters of the thread id>`, cut from the repository's default branch (origin's `HEAD`, else `main` or `master`). A name that already exists as a branch gets a counter (`-2`, `-3`). Every turn of the thread runs in that worktree, and the repository's own checkout is never touched.

The thread records its `branch` and its `target` (`host`, the only kind today), and its session row records the workspace path. A thread in a project with no repositories works in a scratch directory and has no branch.

The thread's row is stored before its worktree exists, so nothing on disk is ever without an owner. The worktree is created again, from the branch when the branch survived, whenever a message reaches a thread that has none: after a resolve, an archive, a restart, or a deletion by hand.

## Pull request

A thread has at most one pull request, and a pull request belongs to one thread. The database enforces it: two threads of one repository cannot record the same pull request number.

Opening it commits what the worktree holds, pushes the branch to `origin` and runs `gh pr create`. A thread may call it from inside its own turn. A second call opens nothing: it commits and pushes what the thread did since and returns the recorded pull request. A pull request that has merged or closed is not opened again; further work belongs in a new thread. A thread with nothing to publish is refused. Without a title, the thread's own runtime writes the title and description, and the thread's title stands in when it cannot. The number, URL and state are on the thread as its `pr` artifact, and every change publishes a `thread.upserted` entry on the project event stream.

Merging asks GitHub first. A merged pull request is finished and not merged again, and a closed one is refused. Otherwise the thread becomes `landing` and `gh pr merge` runs (squash unless told otherwise). Once the pull request is merged, the thread is `resolved`, and its worktree and branch are removed locally and on origin. A merge GitHub refuses (failing checks, conflicts, a review still needed) puts the thread back where it was and says why. Only what is on GitHub is merged, and the branch is deleted afterwards, so a merge is refused while the thread holds changes or commits its pull request lacks: opening the pull request again pushes them. A merge made on GitHub while the thread holds such work keeps the branch, with the work committed, and removes only the worktree.

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
| `POST /api/threads/:id/resolve` | Resolves the thread. |
| `DELETE /api/threads/:id` | Deletes the thread with its worktree and branch. |

The MCP tools `aop_open_pr` (thread) and `thread_open_pr`, `thread_merge_pr` and `thread_resolve` (coordinator) do the same; see [the MCP guide](./MCP.md). The server runs a maintenance pass at start and every hour that settles landing threads and resolves threads idle for seven days.
