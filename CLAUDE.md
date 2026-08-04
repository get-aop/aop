# AOP - Agents Operating Platform

AOP (Agents Operating Platform) - A platform for orchestrating AI agents with CLI, local server, and dashboard components.

## Coding Conventions

Optimize for AI agent context windows (the 40% rule).

### Size Limits

- **Files**: Max 500 lines - split into focused modules if exceeded
- **Functions**: cyclomatic complexity under 10

### Architecture

- **Vertical slices**: Organize by domain, not technical layer (no `repositories/`, `services/`, `controllers/` folders)
- **Single responsibility**: Each module does one thing well
- **Newspaper style**: Public functions at top, private helpers below

### Data Flow (CRITICAL)

```
thin entrypoints (routes, commands, etc.) → domain services → repositories
```

- **Entrypoints** (routes, commands): ONLY parse input, call one service, return response
- **Services**: Business logic, orchestration
- **Repositories**: Data access only

Entrypoints must NEVER import repositories or contain business logic. If you're importing a repository into a route, create a service.

### Package Structure

```
apps/           # Apps (cli, local-server, dashboard)
packages/       # Shared code (common for types, infra for utilities)
```

Within apps, organize by domain:

```
apps/local-server/src/
  repo/       # Domain: repo registration and status
  task/       # Domain: task discovery and updates
  executor/   # Domain: agent execution lifecycle
  workflow/   # Domain: local workflow orchestration
  settings/   # Domain: local configuration
```

### DRY

- **Shared types** live in `@aop/common` - never duplicate types between apps
- **Shared utilities** live in `@aop/infra` - check before creating new ones
- **Test helpers** go in colocated `test-utils.ts` - never copy-paste setup code
- One field per value - don't hold same reference in multiple fields

### Code Quality

- Tests colocated: `*.test.ts` next to `*.ts`
- No dead code - delete unused functions/imports
- Comments explain "why", not "what"
- Verification must follow the focused and full-gate policy below
- Never disable lint rules

### Testing

- **Unit/Integration**: Real assertions on return values and state - no `expect(true).toBe(true)`
- **E2E**: Real agents, real API calls - never mock the agent
- **Repositories**: Integration tests with real database
- **Coverage**: NEVER fix coverage thresholds by ignoring files - always add tests

## Verification

This policy applies to every agent and chat surface working in this repository. Keep ordinary interactive chat and code-fix feedback focused:

- After changing code, update or add the relevant tests and run the closest affected test files or workspace test scope.
- Run Biome only on touched files and typecheck the affected workspace during the edit/feedback loop.
- Report the exact verification commands run and their results. If the full repository gate was not required, say that it was deferred.
- Do not run the bare root `bun test`, `bun run test`, `bun test:coverage`, `bun run test:coverage`, or `bun check` commands for a routine chat change. Finishing a normal chat request is not, by itself, a reason to run the full repository gate.
- Run root `bun check` plus the full test or coverage suite only when the user explicitly requests full verification, during PR or release work, or for repository-wide or otherwise high-risk changes.
- When a full gate is required, run it at most once after implementation and focused verification are complete.
- Do not repeat a successful full gate when the diff has not changed. Reuse and report the existing result.
- If the diff changes after a full gate, rerun the checks affected by that change. Rerun the full gate only when the change can invalidate its result.

Focused verification is mandatory; deferring the full repository gate does not mean skipping relevant tests, lint, or typechecking.

Use these focused command shapes from the repository root:

```bash
# Closest affected tests
bun test path/to/affected.test.ts

# Only files changed in this request
bunx biome check path/to/touched.ts path/to/touched.test.ts

# Only workspaces affected by the change
bun run --filter @aop/<workspace> typecheck
```

## AOP Skill Routing

When the user asks to use AOP in natural language, treat that as an AOP skill invocation even if they do not type the exact slash command.


Examples that should trigger the same behavior as the slash commands:
- "use AOP from scratch"
- "use AOP planning"
- "use AOP to plan this"
- "read this Linear ticket and use AOP"
- "read this ticket and plan it with AOP"

---

## Reference

- `docs/` - Technical documentation
- `docs/licensing.md` - MIT OSS + optional Lemon Squeezy / license-server tiers
- `CONTRIBUTING.md` - Contributor guide

### Bun Runtime

Use Bun instead of Node.js: `bun`, `bun test`, `bun install`, `bunx`.

### Bun APIs

- `Bun.serve()` for HTTP/WebSocket (not express)
- `bun:sqlite` for SQLite (not better-sqlite3)
- `Bun.sql` for Postgres (not pg)
- `Bun.file` for file I/O (not fs)
- `Bun.$` for shell commands (not execa)

### Logging

Use `@aop/infra` logger with structured logging. Use `{placeholder}` syntax with properties object, never template literals. Use `logger.with()` for persistent context in a function scope.

### Frontend

Use `Bun.serve()` with HTML imports for React/CSS/Tailwind. No vite. See `node_modules/bun-types/docs/**.mdx` for details.

## Key Commands

```bash
# Verify the install / tooling state
./install --check 2>/dev/null || echo "run ./install to set up" 

# Install dependencies
bun install

# Run the full unit/integration suite (final gate; E2E is opt-in via test:e2e)
bun test

# Run the full suite with coverage (final gate; same scope as bun test)
bun test:coverage

# Opt-in suites (slow)
bun run test:integration   # CLI HTTP integration
bun run test:e2e           # Orchestration E2E (e2e-fixture provider)
bun run test:e2e:dashboard # Playwright dashboard E2E

# Run the full repository lint + typecheck + build gate
bun check

# Lint
bun run lint

# Format
bun run format

# Type check
bun run typecheck

# Build
bun run build

# Dev server (isolated state in ~/.aop-dev, so a released `aop` keeps ~/.aop)
bun run dev

# Run this worktree's CLI against the dev stack
bun run dev:aop -- <aop args>

# E2E tests
bun test:e2e
```
