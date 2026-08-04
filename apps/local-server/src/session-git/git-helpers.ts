import type { RunGit } from "./service.ts";

// RunGit is a type-only import to avoid a runtime cycle with service.ts.

const DEFAULT_BRANCH_CACHE_TTL_MS = 5 * 60 * 1_000;
const defaultBranchCache = new Map<string, { branch: string | null; expiresAt: number }>();

export const MACHINE_READABLE_GIT_DIFF_FLAGS = [
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
] as const;

/** Resolve origin/HEAD and main/master fallbacks in one Git process. */
export const resolveDefaultBranch = async (runGit: RunGit, cwd: string): Promise<string | null> => {
  const cached = defaultBranchCache.get(cwd);
  if (cached && cached.expiresAt > Date.now()) return cached.branch;

  const result = await runGit(
    [
      "for-each-ref",
      "--format=%(refname)%09%(symref)",
      "refs/remotes/origin/HEAD",
      "refs/heads/main",
      "refs/heads/master",
    ],
    cwd,
  );
  if (result.exitCode !== 0) {
    cacheDefaultBranch(cwd, null);
    return null;
  }

  let fallback: string | null = null;
  for (const line of result.stdout.split("\n")) {
    const [refName, symref] = line.trim().split("\t");
    const remoteBranch = symref?.match(/^refs\/remotes\/origin\/(.+)$/)?.[1];
    if (remoteBranch) {
      cacheDefaultBranch(cwd, remoteBranch);
      return remoteBranch;
    }
    const localBranch = refName?.match(/^refs\/heads\/(main|master)$/)?.[1] ?? null;
    if (!fallback || localBranch === "main") fallback = localBranch;
  }
  cacheDefaultBranch(cwd, fallback);
  return fallback;
};

export const resetDefaultBranchCacheForTests = (): void => {
  defaultBranchCache.clear();
};

const cacheDefaultBranch = (cwd: string, branch: string | null): void => {
  defaultBranchCache.set(cwd, {
    branch,
    expiresAt: Date.now() + DEFAULT_BRANCH_CACHE_TTL_MS,
  });
};

/** merge-base(HEAD, origin/baseRef), falling back to the local branch. */
export const resolveMergeBase = async (
  runGit: RunGit,
  cwd: string,
  baseRef: string,
): Promise<string | null> => {
  const remoteRef = `refs/remotes/origin/${baseRef}`;
  const remoteResult = await runGit(["merge-base", "HEAD", remoteRef], cwd);
  const result =
    remoteResult.exitCode === 0 ? remoteResult : await runGit(["merge-base", "HEAD", baseRef], cwd);
  if (result.exitCode !== 0) return null;
  const mergeBase = result.stdout.trim();
  return mergeBase || null;
};
