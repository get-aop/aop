/**
 * Migration v6: one pull request belongs to one thread. Versions 1 to 5 are never edited; a
 * database that applied them only runs these statements.
 *
 * A thread's branch is its own, so the pull request opened from it can only be its own. The
 * index makes that a rule of the data and not only of the code that opens pull requests: two
 * threads of one repo can never both record the same pull request number. Threads without a
 * pull request (`pr_number` null) are not constrained, and the same number in another repo is
 * another pull request.
 */
export const THREAD_GIT_V6_STATEMENTS: readonly string[] = [
  `CREATE UNIQUE INDEX uq_chat_sessions_repo_pull_request
    ON chat_sessions(repo_id, pr_number) WHERE pr_number IS NOT NULL`,
];
