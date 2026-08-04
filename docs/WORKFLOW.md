# Workflows

Workflows encode a repeatable agent loop as ordered steps with signals, transitions, retries, and terminal states. This guide covers the engine, the Settings editor, legacy definitions, and chat invocation.

## Engine concepts

A workflow definition has a name, an initial step, a map of steps, and terminal states. Each step contains a type, prompt template, optional completion signals, transition rules, retry limits, and an optional agent pin.

Supported step types are:

- `implement`
- `test`
- `review`
- `debug`
- `iterate`
- `research`

A transition can match success, failure, or a named signal. It targets another step or one of these terminals:

- `__done__` — the run succeeds.
- `__paused__` — the run waits for operator input.
- `__blocked__` — retries, validation, or an explicit failure stop the run.
- `__draft__` — the task returns to spec review; the correction workflow uses this state.

## Workflow editor

Settings → **Workflows** lists every workflow with its step sequence. Simple workflows expand inline into an editor: rename the workflow, then edit step rows — each row picks a step kind (Implement, Code review, Test, or Browser check), provider, model, thinking level, and Fast mode. Providers are `claude-code`, `codex-cli`, `grok-build`, `opencode`, and `pi`; valid models and thinking levels come from the configured runtimes. Add steps up to the eight-step limit, or remove them. A fixed footnote explains the generated helpers below.

AOP compiles the linear step list into the workflow definition when you save. Each step also generates its own failure helper automatically:

- `implement`, `test`, and `browser` steps get a `--debug` helper that retries the step with systematic debugging (two iterations; five for tests).
- `code-review` steps get a `--fix` helper that applies the review's findings (two iterations).
- A helper that exhausts its iterations blocks the run.

The first time you open Settings with no user workflows, AOP seeds **“Ship it”**: implement on Codex CLI `gpt-5.6-sol` (high, Fast) → code review on Claude Code `opus-4.8` (max) → tests on Codex CLI `gpt-5.5` (medium, Fast).

## Legacy workflows

Anything that does not match the simple linear shape — custom signals, extra transitions, hand-tuned prompt templates, step blocks from an older AOP — is marked **Legacy**. Legacy workflows run exactly as defined; they can be set as default, duplicated, or deleted, but the inline editor does not open for them.

## Run from chat

- `#workflow` selects a workflow in the composer; the rail shows the workflow name and its step chips, and hovering a step reveals its full provider, model, effort, and Fast setting.
- `/workflow run <name>` selects the named workflow for the current session.
- Natural-language workflow requests return a preview card; confirm it to run, or open Settings → **Workflows** to build one first.

Workflow runs execute in the task's isolated git worktree. Each step spawns its runtime as a detached process, streams JSONL output, records normalized runtime events and usage, and persists the session id for recovery. AOP can continue observing the process after a local-server restart.

Canonical task docs live under `~/.aop/repos/<repo-id>/tasks/<slug>/`, while workflow definitions and execution metadata live in `~/.aop/aop.sqlite`.

## Related guides

- [Chat](./CHAT.md)
- [Tasks](./TASKS.md)
- [Runtimes](./RUNTIMES.md)
- [Commands](./COMMANDS.md)
- [Architecture](./architecture/README.md)
