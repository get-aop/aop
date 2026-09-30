import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandResult, RunGh } from "../github-cli/index.ts";

/** Runs git in `cwd` and returns its trimmed output; a failing command throws. */
export const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** True when git succeeds: for asking whether a ref exists without a throw. */
export const gitSucceeds = (cwd: string, ...args: string[]): boolean => {
  try {
    git(cwd, ...args);
    return true;
  } catch {
    return false;
  }
};

/** A repository on `main` with one commit, in a fresh temporary directory. */
export const createRepo = (): string => {
  const path = mkdtempSync(join(tmpdir(), "aop-repo-"));
  git(path, "init", "-b", "main");
  git(path, "config", "user.email", "aop-tests@example.com");
  git(path, "config", "user.name", "AOP Tests");
  writeFileSync(join(path, "README.md"), "# widget\n");
  git(path, "add", "README.md");
  git(path, "commit", "-m", "init");
  return path;
};

/**
 * Gives a repo a bare repository as `origin`, with its default branch pushed and set as origin's
 * HEAD, so a thread's branch pushes somewhere real and never to GitHub. Returns the bare repository's path.
 */
export const attachBareOrigin = (repoPath: string, defaultBranch = "main"): string => {
  const bare = mkdtempSync(join(tmpdir(), "aop-origin-"));
  git(bare, "init", "--bare", "-b", defaultBranch);
  git(repoPath, "remote", "add", "origin", bare);
  git(repoPath, "push", "-u", "origin", defaultBranch);
  git(repoPath, "remote", "set-head", "origin", defaultBranch);
  return bare;
};

/** Writes a file into a worktree the way an agent's turn would. */
export const writeWorkFile = (worktree: string, name: string, text: string): void => {
  const path = join(worktree, name);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};

export interface FakePullRequest {
  number: number;
  url: string;
  title: string;
  body: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  head: string;
  base: string;
  draft: boolean;
}

/**
 * An in-memory GitHub behind the `gh` seam: it lists, creates, views and merges pull requests
 * and answers everything else as a repository without CI would. Nothing leaves the process.
 */
export const createFakeGithub = (options: { repo?: string } = {}) => {
  const repo = options.repo ?? "acme/widget";
  const prs: FakePullRequest[] = [];
  const calls: string[][] = [];
  const failures = { merge: null as string | null, unavailable: false };
  let createDelayMs = 0;

  const ok = (stdout: string): CommandResult => ({ exitCode: 0, stdout, stderr: "" });
  const fail = (stderr: string): CommandResult => ({ exitCode: 1, stdout: "", stderr });
  const flag = (args: string[], name: string): string => args[args.indexOf(name) + 1] ?? "";
  const byNumber = (args: string[]) => prs.find((pr) => String(pr.number) === args[2]);

  const list = (args: string[]): CommandResult => {
    const head = flag(args, "--head");
    const found = prs.filter((pr) => pr.head === head).slice(-1);
    return ok(
      JSON.stringify(
        found.map((pr) => ({
          number: pr.number,
          url: pr.url,
          state: pr.state,
          title: pr.title,
          mergeable: "MERGEABLE",
          baseRefName: pr.base,
          headRefName: pr.head,
        })),
      ),
    );
  };

  const create = async (args: string[]): Promise<CommandResult> => {
    // A real `gh pr create` takes a while; a caller that skipped its checks races here.
    await Bun.sleep(createDelayMs);
    const number = prs.length + 1;
    const pr: FakePullRequest = {
      number,
      url: `https://github.com/${repo}/pull/${number}`,
      title: flag(args, "--title"),
      body: flag(args, "--body"),
      state: "OPEN",
      head: flag(args, "--head"),
      base: flag(args, "--base"),
      draft: args.includes("--draft"),
    };
    prs.push(pr);
    return ok(`${pr.url}\n`);
  };

  const view = (args: string[]): CommandResult => {
    const pr = byNumber(args);
    if (!pr) return fail("no pull request found");
    return ok(
      JSON.stringify({
        number: pr.number,
        url: pr.url,
        title: pr.title,
        state: pr.state,
        author: { login: "octocat" },
        additions: 1,
        deletions: 0,
        changedFiles: 1,
        mergedAt: pr.state === "MERGED" ? "2026-09-30T12:00:00Z" : null,
        baseRefName: pr.base,
        headRefName: pr.head,
      }),
    );
  };

  const merge = (args: string[]): CommandResult => {
    const pr = byNumber(args);
    if (!pr) return fail("no pull request found");
    if (failures.merge) return fail(failures.merge);
    pr.state = "MERGED";
    return ok("");
  };

  const commands: Record<string, (args: string[]) => CommandResult | Promise<CommandResult>> = {
    "auth status": () => ok(""),
    "pr list": list,
    "pr create": create,
    "pr view": view,
    "pr merge": merge,
    "pr checks": () => fail("no checks reported"),
  };

  const run: RunGh = async (args) => {
    calls.push(args);
    if (failures.unavailable) return fail("gh: not logged in");
    const handler = commands[`${args[0]} ${args[1]}`];
    return handler ? handler(args) : fail(`unexpected gh call: ${args.join(" ")}`);
  };

  return {
    run,
    prs,
    calls,
    /** `gh pr create` calls so far: what a second open must not add to. */
    created: () => calls.filter((call) => `${call[0]} ${call[1]}` === "pr create").length,
    failMerge: (message: string | null) => {
      failures.merge = message;
    },
    /** Makes `gh pr create` slow, so overlapping calls are really in flight together. */
    delayCreate: (ms: number) => {
      createDelayMs = ms;
    },
    setUnavailable: (unavailable: boolean) => {
      failures.unavailable = unavailable;
    },
    /** Merges on the GitHub side, as a person clicking the button would. */
    mergeOnGithub: (number: number) => {
      const pr = prs.find((candidate) => candidate.number === number);
      if (pr) pr.state = "MERGED";
    },
  };
};
