# Chat sessions

Sessions is AOP's front door: an interactive workbench for a coding-agent CLI with local AOP context. This guide covers session organization, the chat thread, attachments, workspace and terminal controls, and what happens when you send another message during a run.

## Session rail

Sessions are grouped by repository, with a **General** group for repo-less work. Inactive sessions settle into a compact tail after three days, and sessions with closed or merged pull requests settle automatically. New work wakes them again. A session with no messages yet shows the draft hero: the **aop** wordmark and suggestion chips — **Implement a feature**, **Review a pull request**, **Debug failing tests**, and **Run “Ship it”** — that prefill the composer (the last one also arms the seed workflow).

Each active session menu provides **Rename**, **Pin**, **Settle**, **Delete**, and runtime reset when available. A settled session menu contains only **Un-settle thread**, **Reset runtime session**, **Rename thread**, and **Delete**.

Settling keeps the complete conversation and workspace. It is blocked while work is running or waiting for approval, and an explicit settle remains until new activity or a manual un-settle. `/clear` settles the current session and opens a sibling with the same repo, workspace, runtime, model, and defaults but a new runtime context.

## Chat thread and action cards

Assistant output streams into the thread, with day separators (**Today**, **Yesterday**, or a dated line) marking each new calendar day. AOP renders typed action cards for operations that need review, such as assigning tasks, previewing workflows, creating workers, or approving handoffs. Proposal cards are inert until you confirm them.

When a runtime conversation cannot resume safely, **Retry in fresh runtime session** keeps the AOP conversation and retries through a new CLI context. Markdown files opened from the thread render in the side panel so you can review task or repository docs without leaving Sessions.

## Create and assign tasks

Use `/task create <request>` or ask naturally in an MCP-capable session. AOP first loads its task methodology, then creates the complete `task.md`, `prd.md`, and `issues.md` package.

When one message describes several pieces of work, use `/task batch <request>` (alias `/task create multi`). The runtime splits the request into independent tasks, applies the methodology once per task, and creates each one as its own package. The reply is a batch routing card: one row per created task with an **Open** link and a destination select listing every active worker. A worker row offers **Assign** and **Assign and Start**. Rows route independently — one row's failure leaves the others actionable — and a summary footer appears once every row is routed. Batch splitting works on prose only; attach a plan/prd/issues artifact and AOP redirects you to `/task create`.

Creation returns unassigned work; it does not silently assign or start it. Use the assignment card to choose one or more tasks and a worker, then select **Assign** or **Assign and Start**. See [Tasks](./TASKS.md) for lifecycle and handoff details.

## Composer context

The composer exposes saved context as removable chips:

- `%worker` selects a worker.
- `#workflow` selects a workflow.
- `~repo` selects a registered repository.
- `$control` loans browser or computer control for one turn.
- `@runtime` delegates one message to another runtime configuration.

The `+` menu provides image and document attachments, worker and workflow selection, control loans, Goal, and Skills. The dedicated toolbar button opens the terminal, and the runtime chip selects Runtime → Model → Thinking → Fast mode. See the complete [command and composer reference](./COMMANDS.md).

## Attachments

You can attach up to two documents per message:

- Markdown, plain text, CSV, or TSV (`.md`, `.txt`, `.csv`, `.tsv`)
- 256 KB maximum per document

Images accept PNG, JPEG, WebP, or GIF up to 5 MB each. You can select them from `+` or paste an image into the composer. Attachment pills remain visible before send; attached planning documents are recorded as task source material when AOP creates a task.

## Workspace binding

A repo-scoped session starts at the registered repository root. AOP can bind the session to another path in the same git repository with `aop_set_chat_workspace`; the header shows the live location.

Use the workspace control to reset to the repository root. If you or an agent creates a worktree, bind the session immediately so terminal commands and runtime turns operate on that worktree.

## Terminal dock

Use the composer toolbar's **Terminal** button to run shell commands in the session workspace. The dock shares the visible workspace location but remains separate from the runtime's conversational context.

## Queue messages during a busy session

You can send another message while the assistant is running. AOP keeps the active reply going, queues follow-ups in order, and sends them automatically when the current reply finishes. The composer shows the number of waiting messages, and **Stop** cancels the active run and drops the queue.

Slash commands that AOP handles directly do not wait behind an LLM run. Suggestion pills can also seed common next actions.

## Factory context

MCP-capable sessions can read current workers, workflows, repos, tasks, approvals, and status. Task cards provide **Open in chat** and **Open task detail**, so you can ask about a task's specs, branch, current step, logs, or handoff without copying identifiers.

Interactive Sessions may load your normal runtime configuration. Autonomous workflow steps use AOP's bundled methodology and run in isolated worktrees. For the boundary, see [Architecture](./architecture/README.md); for available tools, see [MCP](./MCP.md).

## Related guides

- [Commands](./COMMANDS.md)
- [Tasks](./TASKS.md)
- [Workflows](./WORKFLOW.md)
- [Runtimes](./RUNTIMES.md)
