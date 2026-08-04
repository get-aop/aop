# @aop/e2e-tests

End-to-end coverage for AOP orchestration, the dashboard, and optional live Codex benchmarks.

The tests exercise the product promise behind AOP: task readiness starts workflow execution, worker capacity controls concurrency, logs and status stay visible, and handoff artifacts survive across the local-server, CLI, and dashboard surfaces.

## Test lanes

| Command | What it runs |
|---------|----------------|
| `bun run test:e2e` | CLI + local-server orchestration (`e2e-fixture` provider — no live model). Requires `AOP_RUN_E2E=1` (set by the script). |
| `bun run test:e2e:dashboard` | Playwright dashboard UI (`dashboard.e2e.ts`) |
| `bun run test:e2e:codex-benchmark` | Live AOP + Codex on `benchmark-fixtures/notes-cli` |
| `bun run benchmark:codex:pure` | Same fixture, single Codex session without AOP |
| `bun run benchmark:codex:compare` | Compare latest AOP vs pure benchmark JSON |

## Orchestration tests (`test:e2e`)

| File | Coverage |
|------|----------|
| `automatic-handoff.e2e.ts` | `task:ready` → DONE + git handoff |
| `backlog.e2e.ts` | DRAFT → READY → DONE via queue |
| `concurrency.e2e.ts` | Global concurrent task limit |
| `real-concurrency.e2e.ts` | Parallel + dependent tasks |
| `linear-import.e2e.ts` | Multi-ticket Linear import |
| `local-server.e2e.ts` | Start/stop, health, graceful shutdown |

## Dashboard tests (`test:e2e:dashboard`)

Playwright against the running local server + built dashboard. Includes:

- Repo init and task visible on the **Backlog** swimlane row
- Drag/assign flows on the **Pool**
- Shell actions on `/`, `/metrics`, `/settings`, `/tasks/:id`
- Theme persistence (light/dark)
- Responsive layout (mobile nav, desktop sidebar)
- Workflow and settings interactions (see `dashboard.e2e.ts` for the full checklist)

Screenshots are written under the e2e run directory when tests capture them.

## Live Codex benchmark

Requires `codex` on `PATH` and `~/.codex/auth.json`. Artifacts: `~/.aop/benchmarks/`.

Fixture repo: `benchmark-fixtures/notes-cli/` (three related tasks).

## Fixtures

Under `fixtures/` and `benchmark-fixtures/`:

| Fixture | Use |
|---------|-----|
| `backlog-test/` | Basic backlog flow |
| `concurrency-test-*` | Multi-repo limits |
| `cli-greeting-command/` | Sample task docs |
| `linear-issues.json` | Deterministic Linear import |
| `notes-cli/` | Live Codex benchmark |

## Utilities

`src/helpers/` and `src/utils.ts`:

- `createTestRepo`, `copyFixture`, `runAopCommand`
- `waitForTaskStatus`, isolated `AOP_DB_PATH` / log dirs

## Environment (tests)

| Variable | Typical test value |
|----------|-------------------|
| `AOP_DB_PATH` | Temp SQLite per run |
| `AOP_LOCAL_SERVER_URL` | Ephemeral server URL |
| `AOP_LOG_DIR` | `./tmp` |

## Notes

- Default `bun test` / `bun test:coverage` run **unit and integration tests only** (`apps`, `packages`, `scripts`). E2E is opt-in.
- Default `test:e2e` uses **`e2e-fixture`** — deterministic, no API spend. Sets `AOP_RUN_E2E=1` so suites are not skipped.
- CI runs `test:e2e:dashboard` on PRs/pushes to `main`.
- Per-test timeouts are long (minutes) when agents run for real.
