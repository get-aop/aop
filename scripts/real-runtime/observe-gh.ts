import {
  defaultRunGh,
  listPullRequestReviews,
  readFailedRunLog,
  readPullRequestChecks,
  readPullRequestHead,
  viewPullRequest,
} from "@aop/local-server/github-cli";

/**
 * What the real `gh` returns for the watcher's calls on the harness's pull request, read
 * through the server's own parsers: a call the parser cannot read shows up as `ok: false`.
 */
export interface GhObservation {
  head: Awaited<ReturnType<typeof readPullRequestHead>>;
  view: Awaited<ReturnType<typeof viewPullRequest>>;
  checks: Awaited<ReturnType<typeof readPullRequestChecks>>;
  rawChecks: string;
  reviews: Awaited<ReturnType<typeof listPullRequestReviews>>;
  rawReviews: string;
  failedRun: { runId: string | null; log: Awaited<ReturnType<typeof readFailedRunLog>> | null };
}

export const observeGh = async (
  repoPath: string,
  pullRequestNumber: number,
): Promise<GhObservation> => {
  const number = String(pullRequestNumber);
  // One review comment, so the reviews call has a real review to parse. A comment review never
  // asks the thread for anything.
  await defaultRunGh(["pr", "review", number, "--comment", "--body", "Harness note."], repoPath);
  const checks = await readPullRequestChecks(defaultRunGh, repoPath, number);
  return {
    head: await readPullRequestHead(defaultRunGh, repoPath, pullRequestNumber),
    view: await viewPullRequest(defaultRunGh, repoPath, pullRequestNumber),
    checks,
    rawChecks: await rawGh(repoPath, [
      "pr",
      "checks",
      number,
      "--json",
      "name,state,workflow,link,startedAt,completedAt,bucket,description",
    ]),
    reviews: await listPullRequestReviews(defaultRunGh, repoPath, pullRequestNumber),
    rawReviews: await rawGh(repoPath, [
      "api",
      `repos/{owner}/{repo}/pulls/${number}/reviews?per_page=100`,
      "--paginate",
    ]),
    failedRun: await failedRunOf(repoPath),
  };
};

// The pull request's checks may have passed by now, after the thread fixed them, so the failing
// run is the latest failed Actions run of the repository, which only this pull request produces.
const failedRunOf = async (repoPath: string): Promise<GhObservation["failedRun"]> => {
  const listed = await defaultRunGh(
    ["run", "list", "--status", "failure", "--limit", "1", "--json", "databaseId"],
    repoPath,
  );
  const runId = firstRunId(listed.stdout);
  return { runId, log: runId ? await readFailedRunLog(defaultRunGh, repoPath, runId) : null };
};

const firstRunId = (stdout: string): string | null => {
  try {
    const parsed = JSON.parse(stdout) as { databaseId?: number }[];
    return parsed[0]?.databaseId ? String(parsed[0].databaseId) : null;
  } catch {
    return null;
  }
};

const rawGh = async (cwd: string, args: string[]): Promise<string> => {
  const result = await defaultRunGh(args, cwd);
  return `${result.stdout}${result.stderr ? `\n[stderr] ${result.stderr}` : ""}`.trim();
};
