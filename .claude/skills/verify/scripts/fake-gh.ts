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
 * Checks, reviews and conflicts are scripted from a shell with `gh fake ...` (run it with the same
 * `FAKE_GH_DIR`; see features/projects.md, "Pull request watcher"). The server reads them the way it
 * reads GitHub: `gh pr view`, `gh pr checks` and `gh api repos/{owner}/{repo}/pulls/<n>/reviews`.
 * A push to the pull request's branch starts a new round of checks, still pending, with a new run id;
 * a round that finished keeps its run id and completion time however often it is read.
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

type Outcome = "pending" | "pass" | "fail";

interface Round {
  /** The commit of the head branch this round of checks is for. */
  sha: string;
  run: number;
  names: string[];
  outcome: Outcome;
  startedAt: string;
  completedAt: string | null;
  /** What the failed steps printed, for `gh run view <run> --log-failed`. */
  log: string;
}

interface Review {
  id: number;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED";
  body: string;
  user: { login: string };
  author_association: string;
  submitted_at: string;
}

interface ReviewComment {
  id: number;
  pull_request_review_id: number;
  path: string;
  line: number;
  body: string;
  user: { login: string };
}

interface PullRequest {
  number: number;
  url: string;
  title: string;
  body: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  head: string;
  base: string;
  draft: boolean;
  /** The origin remote of the checkout that opened it, so a script can act on it from any directory. */
  origin: string;
  /** Absent until a `gh fake checks` call: a repository with no CI reports no checks. */
  checks?: Round;
  reviews?: Review[];
  comments?: ReviewComment[];
  conflicting?: boolean;
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
const byNumber = (value = args[2]) => prs.find((pr) => String(pr.number) === value);
const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};
const print = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);

const hangOnce = (marker: string) => {
  const path = join(dir, marker);
  if (!existsSync(path)) return;
  rmSync(path);
  spawnSync("sleep", ["60"]);
};

/** The pull request as `gh` prints it: what GitHub has, not what this fake keeps to script it. */
const publicFields = (pr: PullRequest) => ({
  number: pr.number,
  url: pr.url,
  title: pr.title,
  body: pr.body,
  state: pr.state,
  isDraft: pr.draft,
  baseRefName: pr.base,
  headRefName: pr.head,
  mergeable: pr.conflicting ? "CONFLICTING" : "MERGEABLE",
  headRefOid: headSha(pr),
});

/** The commit the origin has for the pull request's branch, so a push changes it. */
const headSha = (pr: PullRequest): string => {
  const listed = spawnSync("git", ["ls-remote", pr.origin, `refs/heads/${pr.head}`], {
    encoding: "utf8",
  });
  const sha = listed.stdout.split("\t")[0]?.trim();
  return sha || `sha-${pr.number}`;
};

const commands: Record<string, () => void> = {
  "auth status": () => undefined,

  "pr list": () => {
    const found = prs.filter((pr) => pr.head === flag("--head")).slice(-1);
    print(found.map(publicFields));
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
      origin: spawnSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).stdout.trim(),
    });
    save();
    hangOnce("hang-after-create");
    process.stdout.write(`${url}\n`);
  },

  "pr view": () => {
    const pr = byNumber() ?? fail("no pull request found");
    const merged = pr.state === "MERGED";
    print({
      ...publicFields(pr),
      author: { login: "octocat" },
      additions: 1,
      deletions: 0,
      changedFiles: 1,
      mergedAt: merged ? new Date().toISOString() : null,
    });
  },

  "pr merge": () => {
    const pr = byNumber() ?? fail("no pull request found");
    if (pr.state !== "OPEN") fail(`pull request is ${pr.state}`);
    squashMerge(pr);
    pr.state = "MERGED";
    save();
    hangOnce("hang-after-merge");
  },

  // Like gh: the checks are printed even when they fail (exit 1) or still run (exit 8).
  "pr checks": () => {
    const pr = byNumber() ?? prs.find((candidate) => candidate.head === args[2]);
    if (!pr?.checks) return fail(`no checks reported on the '${args[2]}' branch`);
    const round = currentRound(pr, pr.checks);
    save();
    print(checkRows(pr, round));
    process.exitCode = { pending: 8, pass: 0, fail: 1 }[round.outcome];
  },

  // `gh run view <run id> --log-failed`: the log of the round whose run it is.
  "run view": () => {
    const round = prs.find((pr) => String(pr.checks?.run) === args[2])?.checks;
    if (!round) return fail(`could not find any workflow run with ID ${args[2]}`);
    process.stdout.write(`${round.log}\n`);
  },

  // `gh api repos/{owner}/{repo}/pulls/<n>/reviews` and `.../comments`.
  api: () => {
    const [, number, endpoint] = /pulls\/(\d+)\/(\w+)/.exec(args[1] ?? "") ?? [];
    const pr = byNumber(number) ?? fail("Not Found (HTTP 404)");
    if (endpoint === "reviews") return print(pr.reviews ?? []);
    if (endpoint === "comments") return print(pr.comments ?? []);
    return fail(`fake gh: unsupported api call: ${args[1]}`);
  },

  fake: () => {
    const control = controls[args[1] ?? ""] ?? fail(`fake gh: unknown control: ${args[1]}`);
    control();
    save();
  },
};

/** A new commit on the head branch starts a new round of checks, pending, with a new run id. */
const currentRound = (pr: PullRequest, round: Round): Round => {
  const sha = headSha(pr);
  if (round.sha === sha) return round;
  const next: Round = {
    ...round,
    sha,
    run: round.run + 1,
    outcome: "pending",
    startedAt: new Date().toISOString(),
    completedAt: null,
  };
  pr.checks = next;
  return next;
};

const STATES: Record<Outcome, { state: string; bucket: string }> = {
  pending: { state: "PENDING", bucket: "pending" },
  pass: { state: "SUCCESS", bucket: "pass" },
  fail: { state: "FAILURE", bucket: "fail" },
};

const checkRows = (pr: PullRequest, round: Round) =>
  round.names.map((name, index) => ({
    name,
    workflow: "ci",
    ...STATES[round.outcome],
    link: `https://github.com/acme/widget/actions/runs/${round.run}/job/${round.run * 10 + index}`,
    startedAt: round.startedAt,
    completedAt: round.completedAt,
    description: `pull request #${pr.number}`,
  }));

const requirePr = (): PullRequest => byNumber(args[2]) ?? fail(`no pull request ${args[2]}`);
// Review and comment ids only ever grow, across calls: the server reads "newer than" from them.
const newId = (): number =>
  1 +
  Math.max(
    1000,
    ...prs.flatMap((pr) => [...(pr.reviews ?? []), ...(pr.comments ?? [])].map(({ id }) => id)),
  );

// Everything below is what a test script does to the fake GitHub, from a shell:
//   gh fake checks <pr> pending|pass|fail [name,name] [log]   the outcome of the current round of checks
//   gh fake review <pr> changes-requested|commented|approved [body] [path:line:comment ...]
//   gh fake conflict <pr> on|off                        whether the pull request conflicts
//   gh fake merge <pr> | gh fake close <pr>             a person merging or closing it on GitHub
//   gh fake show                                        the pull requests as this fake keeps them
const controls: Record<string, () => void> = {
  checks: () => {
    const pr = requirePr();
    const outcome = args[3] as Outcome;
    if (!(outcome in STATES)) {
      fail("usage: gh fake checks <pr> pending|pass|fail [name,name] [log text]");
    }
    const names = args[4]?.split(",") ?? pr.checks?.names ?? ["test"];
    const now = new Date().toISOString();
    const base: Round = pr.checks ?? {
      sha: headSha(pr),
      run: pr.number * 100,
      names,
      outcome: "pending",
      startedAt: now,
      completedAt: null,
      log: "",
    };
    const round = currentRound(pr, base);
    const log = args[5] ?? round.log;
    pr.checks = { ...round, names, outcome, log, completedAt: outcome === "pending" ? null : now };
  },

  review: () => {
    const pr = requirePr();
    const states = {
      "changes-requested": "CHANGES_REQUESTED",
      commented: "COMMENTED",
      approved: "APPROVED",
    } as const;
    const state = states[args[3] as keyof typeof states] ?? fail("unknown review state");
    const user = { login: "reviewer" };
    const id = newId();
    pr.reviews = [
      ...(pr.reviews ?? []),
      {
        id,
        state,
        body: args[4] ?? "",
        user,
        author_association: "COLLABORATOR",
        submitted_at: new Date().toISOString(),
      },
    ];
    for (const inline of args.slice(5)) {
      const [path = "", line = "1", ...text] = inline.split(":");
      pr.comments = [
        ...(pr.comments ?? []),
        {
          id: newId(),
          pull_request_review_id: id,
          path,
          line: Number(line),
          body: text.join(":"),
          user,
        },
      ];
    }
  },

  conflict: () => {
    requirePr().conflicting = args[3] === "on";
  },

  merge: () => {
    const pr = requirePr();
    squashMerge(pr);
    pr.state = "MERGED";
  },

  close: () => {
    requirePr().state = "CLOSED";
  },

  show: () => {
    print(prs.map((pr) => ({ ...publicFields(pr), checks: pr.checks, reviews: pr.reviews })));
  },
};

const squashMerge = (pr: PullRequest) => {
  const clone = mkdtempSync(join(tmpdir(), "fake-gh-merge-"));
  const identity = ["-c", "user.name=fake-github", "-c", "user.email=noreply@github.invalid"];
  const steps = [
    ["clone", "-q", pr.origin, clone],
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

// `gh api` and `gh fake` take an endpoint or a control where other commands take a subcommand.
(
  commands[args[0] === "api" || args[0] === "fake" ? args[0] : `${args[0]} ${args[1]}`] ??
  (() => fail(`fake gh: unsupported command: ${args.join(" ")}`))
)();
