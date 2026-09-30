import type { CommandResult } from "../github-cli/index.ts";

/** A review as `gh api repos/{owner}/{repo}/pulls/N/reviews` returns it, plus the line comments it holds. */
export interface FakeReviewInput {
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED";
  body?: string;
  author?: string;
  /** How the reviewer relates to the repository; a collaborator unless a test says otherwise. */
  association?: string;
  comments?: { path: string; line: number; body: string }[];
}

interface FakeReview {
  id: number;
  state: FakeReviewInput["state"];
  body: string;
  user: { login: string };
  author_association: string;
}

interface FakeComment {
  id: number;
  pull_request_review_id: number;
  path: string;
  line: number;
  body: string;
  user: { login: string };
}

type Outcome = "pending" | "pass" | "fail";

interface Ci {
  /** The commit the head branch is at. A push changes it and starts a new round of checks. */
  sha: string;
  pushes: number;
  mergeable: "MERGEABLE" | "CONFLICTING";
  /** The Actions run of the current round, which is what names a failure. */
  run: number;
  /** The checks the repository runs; null when it has none. */
  names: string[] | null;
  outcome: Outcome;
  startedAt: string;
  completedAt: string | null;
  /** What the failed steps of the current round printed, for `gh run view --log-failed`. */
  log: string;
  reviews: FakeReview[];
  comments: FakeComment[];
}

const CHECK_STATE: Record<Outcome, { state: string; bucket: string; exitCode: number }> = {
  pending: { state: "PENDING", bucket: "pending", exitCode: 8 },
  pass: { state: "SUCCESS", bucket: "pass", exitCode: 0 },
  fail: { state: "FAILURE", bucket: "fail", exitCode: 1 },
};

/**
 * What a pull request has beyond its state, for the in-memory GitHub: checks that run in rounds
 * (a push starts a new round with a new run id, and a check that has finished stays as it was),
 * reviews with line comments, and whether it conflicts. A round a test never scripted stays
 * pending, and a repository with no `setChecks` call has no checks at all, like one without CI.
 */
export const createFakeCi = (repo: string) => {
  const rounds = new Map<number, Ci>();
  const failing = { comments: null as string | null };
  const counter = (from: number) => {
    let last = from;
    return () => {
      last += 1;
      return last;
    };
  };
  const tick = counter(0);
  const nextId = counter(1000);
  const stamp = () => new Date(Date.UTC(2026, 8, 30, 12, 0, tick())).toISOString();
  const of = (number: number): Ci => {
    const existing = rounds.get(number);
    if (existing) return existing;
    const created: Ci = {
      sha: `sha-${number}-0`,
      pushes: 0,
      mergeable: "MERGEABLE",
      run: 100 * number,
      names: null,
      outcome: "pending",
      startedAt: stamp(),
      completedAt: null,
      log: "",
      reviews: [],
      comments: [],
    };
    rounds.set(number, created);
    return created;
  };

  const ok = (stdout: string, exitCode = 0): CommandResult => ({ exitCode, stdout, stderr: "" });
  const fail = (stderr: string): CommandResult => ({ exitCode: 1, stdout: "", stderr });

  const checks = (number: number, name: string): CommandResult => {
    const ci = of(number);
    if (!ci.names) return fail(`no checks reported on the '${name}' branch`);
    const { state, bucket, exitCode } = CHECK_STATE[ci.outcome];
    const rows = ci.names.map((check, index) => ({
      name: check,
      workflow: "ci",
      state,
      bucket,
      link: `https://github.com/${repo}/actions/runs/${ci.run}/job/${ci.run * 10 + index}`,
      startedAt: ci.startedAt,
      completedAt: ci.completedAt,
      description: "",
    }));
    return ok(JSON.stringify(rows), exitCode);
  };

  const api = (number: number, endpoint: string): CommandResult => {
    const ci = of(number);
    if (endpoint === "reviews") return ok(JSON.stringify(ci.reviews));
    if (endpoint === "comments") {
      return failing.comments ? fail(failing.comments) : ok(JSON.stringify(ci.comments));
    }
    return fail(`unexpected gh api endpoint: ${endpoint}`);
  };

  return {
    /** What `gh pr view` adds for the watcher. */
    viewFields: (number: number) => ({
      mergeable: of(number).mergeable,
      headRefOid: of(number).sha,
    }),
    checks,
    api,
    /** `gh run view <run id> --log-failed`: the log of the current round of the pull request that has that run. */
    runLog: (runId: string): CommandResult => {
      const round = [...rounds.values()].find((ci) => String(ci.run) === runId);
      return round ? ok(round.log) : fail(`could not find any workflow run with ID ${runId}`);
    },
    /**
     * Sets the outcome of the current round; `names` says which checks the repository runs and
     * `log` what its failed steps printed.
     */
    setChecks: (number: number, outcome: Outcome, names?: string[], log?: string) => {
      const ci = of(number);
      ci.names = names ?? ci.names ?? ["test"];
      ci.outcome = outcome;
      ci.completedAt = outcome === "pending" ? null : stamp();
      if (log !== undefined) ci.log = log;
    },
    /** A new commit on the head branch: a new round of checks starts, still pending. */
    push: (number: number) => {
      const ci = of(number);
      ci.pushes += 1;
      ci.sha = `sha-${number}-${ci.pushes}`;
      ci.run += 1;
      ci.outcome = "pending";
      ci.startedAt = stamp();
      ci.completedAt = null;
    },
    /** Makes reading the line comments of reviews fail, while everything else reads. */
    failComments: (message: string | null) => {
      failing.comments = message;
    },
    setMergeable: (number: number, mergeable: Ci["mergeable"]) => {
      of(number).mergeable = mergeable;
    },
    review: (number: number, input: FakeReviewInput) => {
      const ci = of(number);
      const user = { login: input.author ?? "reviewer" };
      const id = nextId();
      ci.reviews.push({
        id,
        state: input.state,
        body: input.body ?? "",
        user,
        author_association: input.association ?? "COLLABORATOR",
      });
      for (const comment of input.comments ?? []) {
        ci.comments.push({
          id: nextId(),
          pull_request_review_id: id,
          ...comment,
          user,
        });
      }
      return id;
    },
  };
};

/**
 * How many pull requests are being read at once, overall and per checkout. Each call takes the
 * delay set with `setDelay`, so reads that a watcher starts together really overlap.
 */
export const createReadLoad = () => {
  const active = new Map<string, number>();
  const peaks = { all: 0, byCheckout: new Map<string, number>() };
  let delayMs = 0;

  const pullRequestsIn = (checkout?: string): number =>
    [...active.entries()].filter(
      ([key, count]) => count > 0 && (!checkout || key.startsWith(`${checkout}\n`)),
    ).length;

  return {
    setDelay: (ms: number) => {
      delayMs = ms;
    },
    /** Runs one read of `pullRequest` in `checkout`, counting it while it takes its delay. */
    around: async <T>(checkout: string, pullRequest: string, read: () => T): Promise<T> => {
      const key = `${checkout}\n${pullRequest}`;
      active.set(key, (active.get(key) ?? 0) + 1);
      peaks.all = Math.max(peaks.all, pullRequestsIn());
      peaks.byCheckout.set(
        checkout,
        Math.max(peaks.byCheckout.get(checkout) ?? 0, pullRequestsIn(checkout)),
      );
      await Bun.sleep(delayMs);
      active.set(key, (active.get(key) ?? 1) - 1);
      return read();
    },
    peakAll: () => peaks.all,
    peakIn: (checkout: string) => peaks.byCheckout.get(checkout) ?? 0,
  };
};
