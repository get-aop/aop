# Coding Guidelines

- **General**:
  - We are in 2026. When adding or updating dependencies, always consider using the latest stable versions of packages.
  - Follow newspaper style (Clean Code): main/public functions at top, private helpers below
  - Write small, focused functions with a single responsibility
  - Avoid self-explanatory comments. Comments should explain why the code is doing something, not what the code is doing. Public interfaces should be documented accordingly.
- **golang**:
  - Standard Go Idioms
  - Interfaces defined where they're consumed, not where implemented
  - Consume interfaces, return structs
- **JavaScript/TypeScript**:
  - Modern ES6+ features
  - Use arrow functions
  - Strict TypeScript configuration
  - Maintain CommonJS/ESM compatibility

## Verification

This policy applies to every agent and chat surface working in this repository. Keep ordinary interactive chat and code-fix feedback focused:

- After changing code, update or add the relevant tests and run the closest affected test files or workspace test scope.
- Run lint only on touched files and typecheck the affected workspace during the edit/feedback loop.
- Report the exact verification commands run and their results. If the full repository gate was not required, say that it was deferred.
- Do not run the bare root `bun test`, `bun run test`, `bun test:coverage`, `bun run test:coverage`, or `bun check` commands for a routine chat change. Finishing a normal chat request is not, by itself, a reason to run the full repository gate.
- Run root `bun check` plus the full test or coverage suite only when the user explicitly requests full verification, during `/ship`, PR or release work, or for repository-wide or otherwise high-risk changes.
- When a full gate is required, run it at most once after implementation and focused verification are complete.
- Do not repeat a successful full gate when the diff has not changed. Reuse and report the existing result.
- If the diff changes after a full gate, rerun the checks affected by that change. Rerun the full gate only when the change can invalidate its result.

Use these focused command shapes from the repository root:

- Tests: `bun test path/to/affected.test.ts`
- Lint: `bunx biome check path/to/touched.ts path/to/touched.test.ts`
- Typecheck: `bun run --filter @aop/<workspace> typecheck`

If the correct focused scope is unclear, ask the user.

# Git

- **Never** push any commits unless explicitly asked
- Only make code changes and let the user handle all git operations
- Same for writing operations on external systems (eg. never create a Linear Ticket, GitHub issue, POST/PATCH to APIs), unless explicitly asked.

## Methodology Prompts

AOP bundles workflow methodology prompts under `apps/local-server/src/prompts/methodology/` (AOP-maintained implementation, debugging, and cleanup passes).

Current built-in methodology set: `test-driven-development`, `systematic-debugging`, `code-simplifier`, `remove-ai-slop`, and `improve-codebase-architecture`, plus the `_artifact-reuse` chat partial.

Workflow steps inject these prompts directly at runtime. AOP does not vendor `.claude/skills` or `.codex/skills` in this repository.

New task packages use `task.md` and `plan.md` as the canonical docs:
- `task.md` stores the original request, source metadata, attachments, status, and acceptance criteria.
- `plan.md` is the work spec: the implementation plan, acceptance criteria, and scope boundaries.
- `prd.md` and `issues.md` are legacy docs from the retired modeling flow. Keep reading them as fallbacks for old tasks; do not create them for new tasks.
