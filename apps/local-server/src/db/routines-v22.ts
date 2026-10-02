const NOW_ISO = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

/**
 * Migration v22: routines, a project's work on a schedule. Versions 1 to 21 are never edited; a
 * database that applied them only runs these statements.
 *
 * - routines: one row per routine. `next_run_at` is the occurrence the scheduler fires next, null
 *   while the routine is paused or its schedule never comes round again. `deferred_occurrence`
 *   is set while a run waits for a usage limit to reset: `next_run_at` is then the reset, and the
 *   run that fires there is the deferred occurrence's, not a new one.
 * - routine_runs: what each occurrence did. `occurrence_key` is unique per routine, and a run is
 *   claimed by inserting it in the same transaction that moves `next_run_at` on, so an
 *   occurrence fires at most once however many times the scheduler looks, a restart included,
 *   and two host processes on one database cannot both start it. `starting` is a claimed run
 *   whose thread or message is not made yet; one a host stopped during is failed at the next
 *   boot. A thread or message a run made is linked; deleting it leaves the run in the history.
 */
export const ROUTINES_V22_STATEMENTS: readonly string[] = [
  `CREATE TABLE routines (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    prompt TEXT NOT NULL,
    schedule_json TEXT NOT NULL CHECK (json_type(schedule_json) = 'object'),
    target TEXT NOT NULL CHECK (target IN ('thread', 'coordinator')),
    repo_id TEXT REFERENCES repos(id) ON DELETE SET NULL,
    model TEXT,
    effort TEXT,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    catch_up TEXT NOT NULL DEFAULT 'skip' CHECK (catch_up IN ('skip', 'run-once')),
    created_by TEXT NOT NULL CHECK (created_by IN ('person', 'coordinator')),
    next_run_at TEXT,
    deferred_occurrence TEXT,
    created_at TEXT NOT NULL DEFAULT ${NOW_ISO},
    updated_at TEXT NOT NULL DEFAULT ${NOW_ISO}
  )`,
  "CREATE INDEX routines_by_project ON routines(project_id)",
  "CREATE INDEX routines_due ON routines(next_run_at) WHERE enabled = 1",
  `CREATE TABLE routine_runs (
    id TEXT PRIMARY KEY,
    routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    occurrence_key TEXT NOT NULL,
    occurrence TEXT NOT NULL,
    trigger TEXT NOT NULL CHECK (trigger IN ('schedule', 'manual', 'catch-up')),
    state TEXT NOT NULL
      CHECK (state IN ('starting', 'started', 'failed', 'skipped', 'missed', 'deferred')),
    reason TEXT,
    thread_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
    message_id TEXT REFERENCES chat_messages(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT ${NOW_ISO},
    updated_at TEXT NOT NULL DEFAULT ${NOW_ISO},
    UNIQUE (routine_id, occurrence_key)
  )`,
  "CREATE INDEX routine_runs_by_routine ON routine_runs(routine_id, created_at)",
];
