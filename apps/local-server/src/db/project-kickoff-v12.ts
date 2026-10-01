/**
 * Migration v12: the first-open kickoff of a project. Versions 1 to 11 are never edited; a
 * database that applied them only runs these statements.
 *
 * - project_kickoffs: one row per project created with "Let the coordinator look around first"
 *   and at least one repository. `pending` means the survey thread is still to be started: a
 *   host that restarts before starting it picks the row up again. `surveying` names the thread,
 *   written in the transaction that stores it, so the survey starts at most once whatever
 *   restarts. `reported` means the survey's first report went to the coordinator with the ask
 *   for a summary and proposals, which happens once too. A project with no row has no kickoff,
 *   or none left to do. The row goes with its project, and with its thread: a survey that is
 *   deleted has nothing left to report.
 */
export const PROJECT_KICKOFF_V12_STATEMENTS: readonly string[] = [
  `CREATE TABLE project_kickoffs (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('pending', 'surveying', 'reported')),
    survey_thread_id TEXT UNIQUE REFERENCES chat_sessions(id) ON DELETE CASCADE,
    CHECK ((state = 'pending') = (survey_thread_id IS NULL))
  )`,
];
