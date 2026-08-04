import type { RunGh } from "./run-gh.ts";

export interface GhPullRequestRef {
  number: number;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  title: string;
  /** GitHub merge ability: MERGEABLE | CONFLICTING | UNKNOWN (still computing). */
  mergeable: string | null;
  baseRefName: string | null;
  headRefName: string | null;
}

export const findPullRequestByHead = async (
  runGh: RunGh,
  repoPath: string,
  branchName: string,
): Promise<GhPullRequestRef | null> => {
  const result = await runGh(
    [
      "pr",
      "list",
      "--head",
      branchName,
      "--state",
      "all",
      "--json",
      "number,url,state,title,mergeable,baseRefName,headRefName",
      "--limit",
      "1",
    ],
    repoPath,
  );
  if (result.exitCode !== 0) {
    return null;
  }

  const parsed = JSON.parse(result.stdout.trim() || "[]") as Array<
    Partial<GhPullRequestRef> & Pick<GhPullRequestRef, "number" | "url" | "state" | "title">
  >;
  const pullRequest = parsed[0];
  if (!pullRequest) {
    return null;
  }

  return {
    ...pullRequest,
    mergeable: pullRequest.mergeable ?? null,
    baseRefName: pullRequest.baseRefName ?? null,
    headRefName: pullRequest.headRefName ?? null,
  };
};

export const reopenPullRequest = async (
  runGh: RunGh,
  repoPath: string,
  pullRequestNumber: number,
): Promise<boolean> => {
  const result = await runGh(["pr", "reopen", String(pullRequestNumber)], repoPath);
  return result.exitCode === 0;
};

export type MergeMethod = "squash" | "merge" | "rebase";

export interface GhPullRequestView {
  number: number;
  url: string;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  authorLogin: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  mergedAt: string | null;
  baseRefName: string | null;
  headRefName: string | null;
}

/** Full single-PR read via `gh pr view`; the list endpoint lags right after mutations. */
export const viewPullRequest = async (
  runGh: RunGh,
  repoPath: string,
  pullRequestNumber: number,
): Promise<{ ok: true; view: GhPullRequestView } | { ok: false; message: string }> => {
  const result = await runGh(
    [
      "pr",
      "view",
      String(pullRequestNumber),
      "--json",
      "number,url,title,state,author,additions,deletions,changedFiles,mergedAt,baseRefName,headRefName",
    ],
    repoPath,
  );
  if (result.exitCode !== 0) {
    return {
      ok: false,
      message: result.stderr.trim() || "GitHub CLI could not load the pull request",
    };
  }

  try {
    const parsed = JSON.parse(result.stdout.trim()) as {
      number: number;
      url: string;
      title: string;
      state: "OPEN" | "CLOSED" | "MERGED";
      author: { login?: string } | null;
      additions?: number;
      deletions?: number;
      changedFiles?: number;
      mergedAt?: string | null;
      baseRefName?: string | null;
      headRefName?: string | null;
    };
    return {
      ok: true,
      view: {
        number: parsed.number,
        url: parsed.url,
        title: parsed.title,
        state: parsed.state,
        authorLogin: parsed.author?.login ?? "",
        additions: parsed.additions ?? 0,
        deletions: parsed.deletions ?? 0,
        changedFiles: parsed.changedFiles ?? 0,
        mergedAt: parsed.mergedAt ?? null,
        baseRefName: parsed.baseRefName ?? null,
        headRefName: parsed.headRefName ?? null,
      },
    };
  } catch {
    return { ok: false, message: "GitHub CLI returned malformed pull request JSON" };
  }
};

export const repoNameWithOwnerFromUrl = (url: string): string => {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\//);
  return match ? `${match[1]}/${match[2]}` : "";
};

export type MergePullRequestResult = { ok: true } | { ok: false; message: string };

export const mergePullRequest = async (
  runGh: RunGh,
  repoPath: string,
  pullRequestNumber: number,
  options: { force?: boolean; method?: MergeMethod; deleteBranch?: boolean } = {},
): Promise<MergePullRequestResult> => {
  const method = options.method ?? "squash";
  const args = ["pr", "merge", String(pullRequestNumber), `--${method}`];
  if (options.deleteBranch ?? true) args.push("--delete-branch");
  if (options.force) {
    args.push("--admin");
  }

  const result = await runGh(args, repoPath);
  if (result.exitCode === 0) return { ok: true };
  return {
    ok: false,
    message: result.stderr.trim() || "GitHub could not merge the pull request",
  };
};

export const updatePullRequestBranch = async (
  runGh: RunGh,
  repoPath: string,
  pullRequestNumber: number,
): Promise<{ ok: true } | { ok: false; message: string }> => {
  const result = await runGh(["pr", "update-branch", String(pullRequestNumber)], repoPath);
  if (result.exitCode === 0) {
    return { ok: true };
  }

  return {
    ok: false,
    message: result.stderr.trim() || result.stdout.trim() || "GitHub could not update the branch",
  };
};
