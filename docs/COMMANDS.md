# Chat commands and composer controls

This is the complete public command and composer reference for Sessions. It covers AOP-handled slash commands, runtime-forwarded commands, Quick Actions, typeahead tokens, attachments, one-turn control loans, delegation, and runtime selection.

## Slash commands

| Command | Behavior |
| --- | --- |
| `/task create <request> [%worker]` | Loads AOP's task methodology and creates a complete task package (`task.md`, `prd.md`, `issues.md`). A named worker prefills the assignment card; it does not assign or start the task. |
| `/task batch <several tasks in one request>` | Splits one prose request into independent, separately shippable tasks (`/task create multi` is an accepted alias). The runtime follows your own enumeration when present, never splits one coherent feature, runs the task methodology once per task, and calls `aop_create_task` once per task. The reply is a batch routing card with one row per created task; naming a worker for a specific task only prefills that row. Attached plan/prd/issues artifacts redirect to `/task create`. |
| `/task start <task title or id>` | Starts an already assigned task. |
| `/assign [task title or id] [%worker]` | Opens an assignment card. Both task and worker are optional; the card can select either and supports multiple unassigned tasks. |
| `/worker new` | Opens the worker editor card to create a named seat (job, runtime, repos); it lands in the pool immediately. |
| `/workflow run <name>` | Selects the named workflow for the current session. |
| `/skill <name>` | Runs a discoverable Claude Code skill in the current session. |
| `/status` | Shows repository task status (running, blocked, done) and active agents. |
| `/clear` | Settles the current session and opens a fresh sibling with a new runtime context. |

`/task create`, `/task batch`, and natural-language platform mutations require an MCP-capable runtime: Claude Code or Codex CLI. Deterministic commands such as assignment and status are handled by AOP itself.

AOP verifies batch creation against the tasks the run actually persisted. A clean batch run that created nothing is re-driven once before failing loudly; a partial batch is never re-driven (re-prompting could duplicate tasks) and instead surfaces the created subset in the routing card.

`/goal` and any unknown `/x` command are forwarded to the underlying runtime CLI. `/alias` is legacy: AOP intercepts it with a pointer to **Settings → Runtime configuration**, and it no longer appears in the menu.

## Quick Actions

`/implement`, `/review`, `/audit`, `/test`, and `/security` arm a runtime action chip. Each selection adds a runtime chip to the request:

- `/implement` chooses the single writer.
- Review, audit, test, and security actions can stack. With `/implement`, they run after its writer; on their own, they inspect the current repository state directly.
- Every action can select its own runtime, model, thinking level, and Fast mode.

## Typeahead tokens

| Token | Selects |
| --- | --- |
| `%worker` | A worker seat |
| `#workflow` | A workflow |
| `~repo` | A registered repository |
| `$control` | A one-turn browser or computer loan |
| `@runtime` | A one-message runtime delegation |

Selections appear as removable chips and are saved as session context where appropriate.

## Control loans with `$`

The `$` menu offers:

- Claude Browser
- Codex Browser
- Claude Computer (unavailable in detached sessions)
- Codex Computer

A loan applies to one message only. Choose its model, thinking level, and Fast mode in the loan menu; defaults come from **Settings → Runtime configuration**. Browser and computer capability can also be pinned on workflow steps, as described in [Workflows](./WORKFLOW.md).

## Runtime delegation with `@`

Delegate one message to another configured runtime. Delegation temporarily changes the runtime, model, thinking, and Fast-mode selection for that message. The saved message shows a history badge identifying the delegation.

## The `+` menu

- **Attach image** — PNG, JPEG, WebP, or GIF, up to 5 MB each; paste-to-attach is supported.
- **Attach file** — Markdown, text, CSV, or TSV, up to 256 KB; at most two documents per message.
- **Set workflow** (`#workflow`).
- Browser and computer control loans.
- **Goal**, **Skills**, and **Terminal**.

Skills are Claude Code-only. AOP discovers `SKILL.md` packages under `<repo>/.claude/skills` and `~/.claude/skills`; the Skills menu is hidden for other runtimes.

## Runtime chip

The merged chip walks through Runtime → Model → Thinking → Fast mode. Thinking options are Low, Medium, High, Extra-High, and Max where supported; provider labels can differ (for example, Codex uses Light and Ultra at the ends of the range). Unsupported levels and Fast mode are hidden or disabled according to the selected runtime configuration.

For provider capabilities and custom runtime setup, see [Runtimes](./RUNTIMES.md). For session organization and queueing behavior, see [Chat](./CHAT.md).
