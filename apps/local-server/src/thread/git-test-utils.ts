import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommandResult, RunGh } from "../github-cli/index.ts";
import { createFakeCi, createReadLoad } from "./github-ci-test-utils.ts";

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

/**
 * Commits a file to the origin's `branch` from a clone of its own, the way a pull request merged
 * on GitHub lands: the repo's checkout, and its `origin/<branch>`, know nothing of it until a
 * fetch. Returns the new commit.
 */
export const commitOnOrigin = (
  origin: string,
  file: string,
  text: string,
  branch = "main",
): string => {
  const clone = mkdtempSync(join(tmpdir(), "aop-clone-"));
  git(clone, "clone", "-q", "-b", branch, origin, ".");
  git(clone, "config", "user.email", "aop-tests@example.com");
  git(clone, "config", "user.name", "AOP Tests");
  writeFileSync(join(clone, file), text);
  git(clone, "add", file);
  git(clone, "commit", "-m", `Add ${file} (#1)`);
  git(clone, "push", "-q", "origin", branch);
  return git(clone, "rev-parse", "HEAD");
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
 * An in-memory GitHub behind the `gh` seam: it lists, creates, views and merges pull requests,
 * and runs checks, reviews and conflicts as a test scripts them (see github-ci-test-utils.ts). A
 * repository nobody scripted checks for answers as one without CI would. Nothing leaves the process.
 */
export const createFakeGithub = (options: { repo?: string } = {}) => {
  const repo = options.repo ?? "acme/widget";
  const prs: FakePullRequest[] = [];
  const calls: string[][] = [];
  const ci = createFakeCi(repo);
  const readLoad = createReadLoad();
  const failures = {
    merge: null as string | null,
    unavailable: false,
    reads: null as string | null,
  };
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
        ...ci.viewFields(pr.number),
      }),
    );
  };

  const checks = (args: string[]): CommandResult => {
    const pr = byNumber(args) ?? prs.find((candidate) => candidate.head === args[2]);
    return pr ? ci.checks(pr.number, pr.head) : fail("no pull requests found for branch");
  };

  // `gh api repos/{owner}/{repo}/pulls/<n>/<endpoint>?per_page=100 --paginate`
  const api = (args: string[]): CommandResult => {
    const [, number, endpoint] = /pulls\/(\d+)\/(\w+)/.exec(args[1] ?? "") ?? [];
    return number && endpoint ? ci.api(Number(number), endpoint) : fail(`unexpected gh api call`);
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
    "pr checks": checks,
    "run view": (args) => ci.runLog(args[2] ?? ""),
    api,
  };

  const READS = new Set(["pr view", "pr checks", "api"]);
  // `gh api` takes an endpoint where other commands take a subcommand.
  const commandOf = (args: string[]): string =>
    args[0] === "api" ? "api" : `${args[0]} ${args[1]}`;

  // The pull request a read is about: its number, or the number in a `gh api` path.
  const pullRequestOf = (args: string[]): string =>
    args[0] === "api" ? (/pulls\/(\d+)/.exec(args[1] ?? "")?.[1] ?? "") : (args[2] ?? "");

  const run: RunGh = async (args, cwd) => {
    calls.push(args);
    if (failures.unavailable) return fail("gh: not logged in");
    const command = commandOf(args);
    const handler = commands[command];
    if (!handler) return fail(`unexpected gh call: ${args.join(" ")}`);
    if (!READS.has(command)) return handler(args);
    return readLoad.around(cwd, pullRequestOf(args), () =>
      failures.reads ? fail(failures.reads) : handler(args),
    );
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
    /** Makes what the watcher reads (a pull request, its checks, its reviews) fail with this message. */
    failReads: (message: string | null) => {
      failures.reads = message;
    },
    /** Checks, reviews and conflicts as a person or a CI system would leave them on a pull request. */
    ci,
    /** Makes every read take this long, and counts how many pull requests are being read at once. */
    readLoad,
    /** `gh` calls of one kind so far, such as `pr checks`. */
    callsTo: (command: string) => calls.filter((call) => commandOf(call) === command),
    /** Closes without merging on the GitHub side. */
    closeOnGithub: (number: number) => {
      const pr = prs.find((candidate) => candidate.number === number);
      if (pr) pr.state = "CLOSED";
    },
    /** Merges on the GitHub side, as a person clicking the button would. */
    mergeOnGithub: (number: number) => {
      const pr = prs.find((candidate) => candidate.number === number);
      if (pr) pr.state = "MERGED";
    },
  };
};
