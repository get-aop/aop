#!/usr/bin/env bun
/**
 * A fake GitHub CLI for verification runs: it never touches the network or the real GitHub.
 * Put it first on the server's PATH as `gh` (see features/projects.md) and threads can open and
 * merge pull requests against a local bare repository.
 *
 * State is `state.json` in `$FAKE_GH_DIR` (default `$AOP_HOME/fake-gh`); every call is appended to
 * `calls.log` there. `pr merge` really squash-merges the pull request's branch into the origin's base
 * branch, so the merge shows in the origin's log.
 *
 * Crash hooks: a file named `hang-after-create` or `hang-after-merge` in that directory makes the next
 * such call do its work and then sleep 60 seconds, once, so the server can be killed in the window
 * where GitHub has changed and the server has not yet recorded it.
 */
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface PullRequest {
  number: number;
  url: string;
  title: string;
  body: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  head: string;
  base: string;
  draft: boolean;
}

const dir = process.env.FAKE_GH_DIR ?? join(process.env.AOP_HOME ?? tmpdir(), "fake-gh");
mkdirSync(dir, { recursive: true });
const args = process.argv.slice(2);
appendFileSync(
  join(dir, "calls.log"),
  `${new Date().toISOString()} cwd=${process.cwd()} gh ${args.join(" ")}\n`,
);

const statePath = join(dir, "state.json");
const prs: PullRequest[] = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : [];
const save = () => writeFileSync(statePath, JSON.stringify(prs, null, 2));
const flag = (name: string) => args[args.indexOf(name) + 1] ?? "";
const byNumber = () => prs.find((pr) => String(pr.number) === args[2]);
const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const hangOnce = (marker: string) => {
  const path = join(dir, marker);
  if (!existsSync(path)) return;
  rmSync(path);
  spawnSync("sleep", ["60"]);
};

const commands: Record<string, () => void> = {
  "auth status": () => undefined,

  "pr list": () => {
    const found = prs.filter((pr) => pr.head === flag("--head")).slice(-1);
    const rows = found.map((pr) => ({
      ...pr,
      baseRefName: pr.base,
      headRefName: pr.head,
      mergeable: "MERGEABLE",
    }));
    process.stdout.write(`${JSON.stringify(rows)}\n`);
  },

  "pr create": () => {
    const number = prs.length + 1;
    const url = `https://github.com/acme/widget/pull/${number}`;
    const state = "OPEN" as const;
    const head = flag("--head");
    const draft = args.includes("--draft");
    prs.push({
      number,
      url,
      title: flag("--title"),
      body: flag("--body"),
      state,
      head,
      base: flag("--base"),
      draft,
    });
    save();
    hangOnce("hang-after-create");
    process.stdout.write(`${url}\n`);
  },

  "pr view": () => {
    const pr = byNumber() ?? fail("no pull request found");
    const merged = pr.state === "MERGED";
    const view = {
      ...pr,
      author: { login: "octocat" },
      additions: 1,
      deletions: 0,
      changedFiles: 1,
      mergedAt: merged ? new Date().toISOString() : null,
      baseRefName: pr.base,
      headRefName: pr.head,
    };
    process.stdout.write(`${JSON.stringify(view)}\n`);
  },

  "pr merge": () => {
    const pr = byNumber() ?? fail("no pull request found");
    if (pr.state !== "OPEN") fail(`pull request is ${pr.state}`);
    squashMerge(pr);
    pr.state = "MERGED";
    save();
    hangOnce("hang-after-merge");
  },

  "pr checks": () => fail("no checks reported on the branch"),
};

const squashMerge = (pr: PullRequest) => {
  const remote = spawnSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" });
  const clone = mkdtempSync(join(tmpdir(), "fake-gh-merge-"));
  const identity = ["-c", "user.name=fake-github", "-c", "user.email=noreply@github.invalid"];
  const steps = [
    ["clone", "-q", remote.stdout.trim(), clone],
    [...identity, "merge", "--squash", `origin/${pr.head}`],
    [...identity, "commit", "-q", "-m", `${pr.title} (#${pr.number})`],
    ["push", "-q", "origin", `HEAD:${pr.base}`],
  ];
  for (const step of steps) {
    const done = spawnSync("git", step, {
      cwd: step[0] === "clone" ? undefined : clone,
      encoding: "utf8",
    });
    if (done.status !== 0) fail(done.stderr);
  }
  rmSync(clone, { recursive: true, force: true });
};

(
  commands[`${args[0]} ${args[1]}`] ??
  (() => fail(`fake gh: unsupported command: ${args.join(" ")}`))
)();
