# Performance Remediation Plan

**Date:** 2026-08-04 · **Trigger:** AOP becomes very slow when more than one session runs concurrently.
**Source:** Full-system audit (5 parallel code audits + live measurements on a real install). Key claims were verified against the code at the listed locations.

## Measured evidence (2026-08-04, release install `~/.aop`)

- Data dir 4.6 GB: logs 2.1 GB, worktrees 677 MB, chats 185 MB, SQLite 162 MB.
- Single chat-run transcript files up to **572 MB** (`logs/chat-sessions/<id>/*.jsonl`).
- `step_logs` table: 90k rows, ~90 MB of `content`. `chat_messages.activity` rows up to ~1.9 MB each.
- Server latency is fine when idle (sub-ms on `/health`, ~6 ms on `/api/chat-sessions`) — slowness is load-driven.

## Root causes (short version)

1. **One lane for everything.** Single-threaded server + one shared SQLite connection behind a mutex. Anything blocking or slow stalls every session at once.
2. **Blocking calls on that lane.** Sync `ps` every 50 ms per control session (×2 trackers), sync git + file hashing per turn, whole-log-file sync reads on timers.
3. **Full rebuilds instead of caching.** The task snapshot re-scans every repo folder + full table on nearly every query; `/api/status` rebuilds everything per 2 s poll per tab; status is O(tasks²).
4. **Writes on read paths.** Status polls re-read and re-insert entire runtime-event history; every commit fsyncs (missing `synchronous=NORMAL`).
5. **Per-tab duplication.** SSE event enrichment runs once per connected client; every event triggers full refetches; progress frames resend the whole cumulative transcript.
6. **Dashboard render storms.** Any delegation progress re-renders the whole sessions page; effects without dependency arrays; markdown re-parsing.
7. **Unbounded growth.** No retention for logs/tables, so hot paths get slower every week.

## Work packages (each is an AOP task in `docs/tasks/`)

| Order | Task | Depends on | Risk | Impact |
|---|---|---|---|---|
| 1 | `perf-01-db-quick-wins` | — | Low | High |
| 1 | `perf-02-task-snapshot-cache` | — | Medium | **Highest** |
| 1 | `perf-05-event-loop-blockers` | — | Medium | High |
| 1 | `perf-07-dashboard-render-storm` | — | Low | High (UI feel) |
| 2 | `perf-03-status-read-only` | perf-02 | Medium | High |
| 2 | `perf-06-sse-fanout-once` | — (best after perf-02) | Low | Medium |
| 2 | `perf-08-git-gh-hygiene` | — | Low | Medium |
| 3 | `perf-04-incremental-log-reads` | perf-03 | Medium | High |
| 4 | `perf-09-retention` | perf-03 | Low | Medium (long-term) |
| 5 | `perf-10-progress-deltas` | perf-06, perf-07 | High | Medium |

Rows with the same order number can run in parallel (they touch disjoint files).

## Dispatch guidance

- Every task doc is self-contained (context, exact files with approximate line numbers, exact changes, tests, acceptance criteria). Line numbers marked `~` may have drifted; locate by symbol name.
- All tasks start as `DRAFT`. **AOP does not enforce the `dependencies` frontmatter for local tasks** (dependency edges are only built for external-ticket tasks), so control ordering by flipping tasks to `READY` wave by wave: flip a task only when everything it depends on (table above) is merged.
- Commit these docs before dispatching so agent worktrees contain them.
- Per repo policy (CLAUDE.md): focused verification per task (closest tests, Biome on touched files, workspace typecheck). Run the full `bun check` + full test gate once, at PR/release time, not per task.
- Success check after order-1 and order-2 tasks land: run 3+ concurrent sessions with the dashboard open; UI stays responsive and `/api/status` p95 stays low while sessions stream.

## Deliberately out of scope (needs a product/architecture decision)

- Second read-only SQLite connection so dashboard reads never queue behind session writes (natural follow-up after perf-03).
- Virtualizing the chat transcript list in the dashboard.
- Moving `chat_runs.delegation_runs` JSON blob to a proper table (partially addressed in perf-10).
