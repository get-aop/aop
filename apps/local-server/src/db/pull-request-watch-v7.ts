/**
 * Migration v7: what the pull request watcher stores. Versions 1 to 6 are never edited; a
 * database that applied them only runs these statements.
 *
 * - projects.auto_fix_pull_requests: whether the watcher sends a thread a fix prompt by itself.
 *   Every existing project gets it on, the default a new one has.
 * - chat_sessions.pr_checks_json: what the checks of the thread's pull request add up to, JSON
 *   `PullRequestChecks`. It is part of the `pr` artifact the thread shows, so it lives with the
 *   pull request columns, and only a thread that has a pull request can hold it.
 * - pull_request_watch: the watcher's memory of one thread, JSON entries of what it has already
 *   turned into a prompt or a report. It is what makes the watcher safe to restart: a failing
 *   check run, a review or a conflict that has an entry is never sent again, and the number of
 *   entries is the number of attempts against the cap. It is not derived from the thread's chat
 *   history, which a person can clear. It is deleted with its thread, since nothing in it means
 *   anything without the thread.
 */
const NOW_ISO = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

export const PULL_REQUEST_WATCH_V7_STATEMENTS: readonly string[] = [
  `ALTER TABLE projects ADD COLUMN auto_fix_pull_requests INTEGER NOT NULL DEFAULT 1
    CHECK (auto_fix_pull_requests IN (0, 1))`,

  `ALTER TABLE chat_sessions ADD COLUMN pr_checks_json TEXT
    CHECK (pr_checks_json IS NULL
      OR (json_valid(pr_checks_json) AND json_type(pr_checks_json) = 'object'
        AND pr_number IS NOT NULL))`,

  `CREATE TABLE pull_request_watch (
    thread_id TEXT PRIMARY KEY REFERENCES chat_sessions(id) ON DELETE CASCADE,
    entries_json TEXT NOT NULL DEFAULT '[]'
      CHECK (json_valid(entries_json) AND json_type(entries_json) = 'array'),
    updated_at TEXT NOT NULL DEFAULT ${NOW_ISO}
  )`,
];
