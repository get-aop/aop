# Threads and git

A thread is one agent session that does one piece of work in one repository. A thread that has a repository works in a git worktree of its own, on a branch of its own, and lands its work through one pull request. This guide describes that lifecycle and what runs it.

## Worktree and branch

When a thread starts, AOP creates the worktree `~/.aop/worktrees/<repo-id>/<thread-id>` on a new branch named `aop/<title>-<last six characters of the thread id>`. A name that already exists as a branch gets a counter (`-2`, `-3`). Every turn of the thread runs in that worktree, and the repository's own checkout is never touched.

The new branch is cut from origin's copy of the default branch (origin's `HEAD`, else `main` or `master`), fetched just before. The fetch updates only `origin/<default>`: never the checkout, its branches or its tags. The thread's pull request merges into origin's default branch, and the checkout's copy moves only when the person pulls, so a branch cut from that copy would miss every pull request merged since and conflict with them. For the same reason, commits on the checkout's default branch that were never pushed are not in the new branch: they do not belong in the thread's pull request. The fetch never prompts for credentials and gives up after 20 seconds. When there is no origin, or it cannot be reached in time, the branch starts from the `origin/<default>` that the repository fetched last, or from the checkout's default branch when it never fetched one. Threads started together in one repository share one fetch. The branch has no upstream until its pull request pushes it, so a `git push` without arguments in the worktree cannot reach the default branch.

The thread records its `branch` and its `target` (`host`, the only kind today), and its session row records the workspace path. A thread in a project with no repositories works in a scratch directory and has no branch.

The thread's row is stored before its worktree exists, so nothing on disk is ever without an owner. The worktree is created again, from the branch when the branch survived, whenever a message reaches a thread that has none: after a resolve, an archive, a restart, or a deletion by hand. A branch that survived is checked out as it is: nothing is fetched and the branch does not move.

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

Trouble found together is one message. The message starts with `Automatic fix, attempt 1 of 3` and says that the watcher sent it, not the person. It names the failing checks with the link to each run and quotes the end of the log of each failing Actions run (`gh run view --log-failed`; at most 3 runs, 60 lines each), because a thread on `auto-accept-edits` cannot run `gh` itself. Or it quotes the reviewers' words and line comments as feedback to weigh, not as instructions, or asks the thread to bring the base branch in and resolve the conflict, which a thread on `auto-accept-edits` cannot run `git` to do and can only report. It tells the thread to push with `aop_open_pr`. It is cut to 16,000 characters, since a message to a thread is refused above 20,000. It is stored and started the way a person's message is, so the run queue and the worktree rules apply.

A thread that is `idle` or `ready-for-review` gets it, and its status is checked again as the message is stored (`send` with `onlyIn`), so a thread resolved or asked something while the watcher was reading GitHub is not reopened or answered. One that is `working`, `queued`, `rate-limited`, `waiting-on-you` or `landing` is left alone and asked at the next look if the trouble is still there: a message would queue behind its turn, end its wait on a limit or answer its question. A `resolved` thread is still watched but never reopened by a fix.

**The cap.** A thread's pull request gets 3 messages in all, whichever trouble they answered. There is no reset. When more trouble comes after the third, the watcher stops. It sets the thread's status line to `Auto-fix stopped after 3 attempts: ...`, marks the thread unread and tells the coordinator in a thread report (`needs-you`). It reports once, and sends nothing more for that pull request; the person or the coordinator can still message the thread.

**The setting.** The project setting `autoFixPullRequests` is on for every project until the person turns it off (project settings, General, "Fix pull requests automatically"; or `PATCH /api/projects/:id`). Off means the watcher still publishes the checks and reports how the pull request ends, and sends no fix. The coordinator can read the setting and cannot change it.

**How it ends.** A pull request found merged is settled by the same landing the merge route uses (`syncPullRequest`): the thread is resolved and its worktree and branch are removed. One found closed without merging is recorded as `closed`, and the thread keeps its work. The coordinator gets a thread report for each (`finished`, and `needs-you`), written down before the thread is brought in line, so a crash in between reports nothing twice. A pull request that was merged or closed through AOP is not the watcher's find and is not reported. Commits pushed to the branch after the merge are not in the merged pull request, and go with the branch when the thread is cleaned up: this is how `syncPullRequest` already treats a merge made on GitHub.

**Notifications.** The server does not apply the project's notification level: the reports reach the coordinator whatever it is, and the client decides what to raise. The desktop app raises a notification for a coordinator post and for a pull request that merged or closed, read from the thread's `pr` artifact, and none when the level is `off`. A pull request found closed, and a thread the watcher gave up on, move the thread's last activity, since a client counts a thread that moved a moment ago as news; the second is also marked unread. The turn that a fix starts is reported to the coordinator like any turn, so `every-turn` hears of it.

**After a restart.** What the watcher answered is stored per thread (the `pull_request_watch` table): the failing check runs, reviews and head commits it sent a fix for, the attempts, and the reports it made. A fix is written down as an attempt, sent, and then confirmed; a crash between the two is settled by looking for the message in the thread, so a fix is neither sent twice nor lost from the count. The stored memory is not the thread's chat history, which a person can clear. When to look next is the only thing kept in memory.

**Pace and limits.** A pull request is looked at every 30 seconds while it changes or its checks run, and less and less often, down to every 5 minutes, while it stays as it is (also while a fix is owed to a thread that is not at rest); while its checks keep running the wait grows only to 2 minutes. A look that fails waits 1, 2, 4 minutes and so on, up to 15. All waits are spread by 20% so pull requests do not look in step. At most 4 pull requests are read at once, and one at a time within a repository. A rate limit from GitHub holds the whole repository for about 10 minutes. `AOP_PR_POLL_INTERVAL_MS` sets a fixed pace instead (see [the host guide](./HOST.md)). Only pull requests of active projects are watched.

The calls are `gh pr view --json state,mergeable,headRefOid,baseRefName`, `gh pr checks <number> --json ...`, `gh api repos/{owner}/{repo}/pulls/<number>/reviews` (and `.../comments`, with `--paginate`) and `gh run view <run id> --log-failed`. The real-runtime harness (`scripts/real-runtime`, opt-in, see [Runtimes](./RUNTIMES.md)) ran them against a private scratch repository with a failing check and confirmed that the parsers read what GitHub returns. One thing differed from what the fake plays: `gh run view --log-failed` prefixes every line with `<job>`, `<step>` and a timestamp separated by tabs (the first line also has a byte order mark, and colour codes appear as the text `^[[36;1m`), so the quoted log is cleaned of those before it goes into the prompt. The default tests still call no GitHub: they play the output with a fake (`.claude/skills/verify/scripts/fake-gh.ts`).

## Access

The project setting `threadAccess` decides what every thread of the project may do on the host. It is set when the project is created and changed only by the person (project settings, General, Thread access; or `PATCH /api/projects/:id`).

| Value | What a thread can do | Claude Code flags |
| --- | --- | --- |
| `full-access` (the default for a new project) | Run any command as the person on this host, without asking. This includes deleting files outside the repository, reading credentials and pushing to any remote. | `--dangerously-skip-permissions` |
| `auto-accept-edits` ("Edit files" in settings) | Edit files in its own worktree. Commands that run code or change anything (`bun test`, `git commit`) are denied; read-only ones such as `git status` still run, because Claude Code allows them without approval (seen on the real CLI). No approval prompt exists, so a denied command is not asked about. | `--permission-mode acceptEdits` |

A project created without a `threadAccess` gets `full-access`; the dashboard's New project form says so and does not offer the choice. Projects that already exist keep the value they stored. Changing the setting applies to the project's existing threads from their next turn, and to the ones started afterwards. The settings page shows a warning for as long as Full access is selected, and saving a change to Full access asks once more.

The coordinator is not affected. It always runs `approval-required`, pinned for every run whatever the project or the stored session says, and no coordinator tool can change `threadAccess`; see [the MCP guide](./MCP.md).

Other runtimes map the same two values to their own flags (Codex and Pi); a thread on a runtime without an equivalent is limited by that runtime, not by this table.

## Computer and browser use

The project setting `computerUse` decides where the project's threads get tools to see and operate apps and browsers on the host. Only the host owner changes it (project settings, General, Computer / browser use; or `PUT /api/projects/:id/computer-use` with `{"computerUse": "..."}`), and it saves as soon as it is chosen. A paired device sees it read-only and gets `403` from the route; `PATCH /api/projects/:id` and the coordinator's `project_settings_set` cannot change it.

| Value | What a thread gets |
| --- | --- |
| `model-default` (the default) | Nothing from AOP. The thread has whatever its agent CLI brings by itself. |
| `cua` | [CUA Driver](https://github.com/trycua/cua)'s MCP server, as `cua-driver`, beside the `aop` server: its tools are `mcp__cua-driver__*` (windows, accessibility tree, click, type, browser tabs and so on). |
| `codex`, `claude` | Shown in settings as WIP. The host refuses them with `400` until they are built. |

**Checked on the host.** Whether CUA is ready is decided on the AOP host, the machine whose server spawns the threads, never on the device showing the dashboard (a paired laptop or the desktop app over Tailscale). The host looks for `cua-driver` on the PATH runs are spawned with, then in `/Applications/CuaDriver.app` (`AOP_CUA_DRIVER` points it at another file), and runs only read-only commands: `cua-driver --version`, `cua-driver permissions status --json` (whether its app runs, and its Accessibility and Screen Recording grants; it never raises a macOS prompt) and `cua-driver check-update --json` (a cached answer). Tahoe's direct capture consent cannot be read without a prompt, so it is reported as not checked. `GET /api/computer-use/cua` (any paired device) returns the result:

| `status` | `reason` | Meaning |
| --- | --- | --- |
| `ready` | `ready` | Installed, answers, its app runs, both grants given. |
| `not-installed` | `not-installed` | No `cua-driver` on the host. |
| `not-ready` | `no-answer`, `not-running` or `missing-permissions` | Installed, but it did not answer, its app is not running, or a grant is missing. |

It also carries `detail` (one sentence), `version`, `latestVersion`, `path`, each check with its result, the host's name (its Sharing name on macOS) and platform, and `checkedAt`. An answer is reused for 10 seconds; `?fresh=1` checks again, and probes that overlap share one run. A newer release is reported but does not make the host unready, nor does being offline.

**How CUA reaches a thread.** When each of a thread's turns is launched on a ready host, the run's `--mcp-config` gets `{"cua-driver": {"type": "stdio", "command": "<absolute path>", "args": ["mcp"]}}`, which is what CUA's own docs register for Claude Code. On macOS, `cua-driver mcp` proxies to the CuaDriver.app daemon, so the tools act with the app's grants, not the terminal's. The server keeps Claude Code's default loading, so its tools wait behind tool search until the model looks for them. A change to the setting applies from each thread's next turn. A host that is not ready starts the run without the CUA tools, and the host logs a warning naming the project, the status and the reason.

**Setting it up.** When the host is not ready, CUA stays selectable and the settings row shows a guide: the host's name and that the commands run there, each command with a Copy button (install, update, start the app, grant the permissions), the System Settings panes to grant by hand, the note that nothing else is configured (no API key; AOP hands the MCP server to threads itself), and Check again. AOP runs none of it. The steps are written once, in `packages/common/src/projects/cua-setup.ts`, so a later host-side setup flow can run the same commands.

**Thread access still applies.** A thread on Edit files sees the CUA tools, but every call needs an approval no thread can give, so it is denied; the settings row says so. With Full access the calls run without asking. CUA Driver's own permission mode (`standard` unless its daemon was started otherwise) applies on top.

**The coordinator never gets them.** It is hermetic: it runs with the AOP tools only and does no work itself, and a coordinator that could drive the desktop would act on what people and threads write without a thread's boundaries. A thread that needs the desktop does that work.

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
| `GET /api/threads/:id/diff` | The files the thread changed in its worktree, against where its branch left the default branch (committed, uncommitted and untracked), with line counts and no hunks. The host counts an untracked file by reading it, except a text file over 1 MiB, which shows 0 until `/diff/file` reads it; an untracked binary file has `status` `binary`. A thread with no repository answers 409 `NO_REPOSITORY`, and a thread whose worktree is gone (resolved, merged, or parked when its project was archived) answers 409 `NO_WORKTREE`: nothing is made to compare. |
| `GET /api/threads/:id/diff/file?path=` | One changed file's hunks, capped. `path` is relative to the worktree: an empty, absolute or escaping one answers 400 `INVALID_PATH`, and a file with no change 404 `FILE_NOT_FOUND`. |

The MCP tools `aop_open_pr` (thread) and `thread_open_pr`, `thread_merge_pr` and `thread_resolve` (coordinator) do the same; see [the MCP guide](./MCP.md). The server runs a maintenance pass at start and every hour that settles landing threads and resolves threads idle for seven days.
