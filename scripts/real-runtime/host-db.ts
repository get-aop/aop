import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";

/** Read-only views of the host's own database: which runs a session had and where their logs are. */
export interface RunRow {
  id: string;
  session_id: string;
  user_message_id: string;
  status: string;
  failure_kind: string | null;
  runtime_session_id: string | null;
  resume_session_id: string | null;
  log_file_path: string;
  pid: number | null;
  created_at: string;
}

export interface SessionRow {
  id: string;
  kind: string | null;
  project_id: string | null;
  runtime_session_id: string | null;
  runtime_access_mode: string | null;
  model: string | null;
  reasoning_effort: string | null;
  workspace_path: string | null;
  title: string;
}

export interface HostDb {
  runsOf(sessionId: string): RunRow[];
  allRuns(): RunRow[];
  session(sessionId: string): SessionRow | null;
  coordinatorOf(projectId: string): SessionRow | null;
  /** Runs still going, and the threads whose turn is queued for a slot. */
  activeCount(): number;
  readLog(run: RunRow): string;
  close(): void;
}

const RUN_COLUMNS =
  "id, session_id, user_message_id, status, failure_kind, runtime_session_id, resume_session_id, log_file_path, pid, created_at";
const SESSION_COLUMNS =
  "id, kind, project_id, runtime_session_id, runtime_access_mode, model, reasoning_effort, workspace_path, title";

export const openHostDb = (path: string): HostDb => {
  const db = new Database(path, { readonly: true });
  return {
    runsOf: (sessionId) =>
      db
        .query(`SELECT ${RUN_COLUMNS} FROM chat_runs WHERE session_id = ? ORDER BY created_at`)
        .all(sessionId) as RunRow[],
    allRuns: () =>
      db.query(`SELECT ${RUN_COLUMNS} FROM chat_runs ORDER BY created_at`).all() as RunRow[],
    session: (sessionId) =>
      (db
        .query(`SELECT ${SESSION_COLUMNS} FROM chat_sessions WHERE id = ?`)
        .get(sessionId) as SessionRow | null) ?? null,
    coordinatorOf: (projectId) =>
      (db
        .query(
          `SELECT ${SESSION_COLUMNS} FROM chat_sessions WHERE project_id = ? AND kind = 'coordinator'`,
        )
        .get(projectId) as SessionRow | null) ?? null,
    activeCount: () => {
      const running = db
        .query("SELECT count(*) AS n FROM chat_runs WHERE status = 'running'")
        .get();
      const queued = db
        .query("SELECT count(*) AS n FROM chat_sessions WHERE state = 'queued'")
        .get();
      return Number((running as { n: number }).n) + Number((queued as { n: number }).n);
    },
    readLog: (run) =>
      existsSync(run.log_file_path) ? readFileSync(run.log_file_path, "utf8") : "",
    close: () => db.close(),
  };
};
