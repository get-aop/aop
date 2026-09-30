import { type CheckResult, clip, firstRun, result, verdict } from "./check-types.ts";
import { resultOf, toolCallsOf } from "./log-shapes.ts";
import type { Observed, RunObservation } from "./observe.ts";

/** The watcher's `gh` calls, answered by the real GitHub and read by the server's own parsers. */
export const ghShapes = (observed: Observed): CheckResult => {
  const id = "gh-shapes";
  const title = "gh pr view / pr checks / reviews / run view --log-failed output parses";
  const gh = observed.gh;
  if (!gh) return result(id, title, "skipped", "the thread never opened a pull request");

  const problems = ghProblems(gh);

  const details = [
    `pr view head: ${clip(JSON.stringify(gh.head), 300)}`,
    `pr view: ${clip(JSON.stringify(gh.view), 400)}`,
    `pr checks (raw): ${clip(gh.rawChecks, 700)}`,
    `reviews (raw): ${clip(gh.rawReviews, 500)}`,
    `run view --log-failed (first lines): ${clip(gh.failedRun.log?.ok ? gh.failedRun.log.value : "none", 700)}`,
  ];
  return verdict(
    id,
    title,
    problems,
    "every call parsed and the failing run's log shows the failing test",
    details,
  );
};

type Gh = NonNullable<Observed["gh"]>;

const ghProblems = (gh: Gh): string[] => [
  ...(gh.head.ok ? [] : [`gh pr view (head): ${gh.head.message}`]),
  ...(gh.view.ok ? [] : [`gh pr view (full): ${gh.view.message}`]),
  ...(gh.checks.ok
    ? checkProblems(gh.checks.value.checks)
    : [`gh pr checks: ${gh.checks.message}`]),
  ...reviewProblems(gh.reviews),
  ...failedLogProblems(gh.failedRun),
];

const reviewProblems = (reviews: Gh["reviews"]): string[] => {
  if (!reviews.ok) return [`reviews: ${reviews.message}`];
  const first = reviews.value[0];
  if (!first) return ["reviews: the harness's review comment was not listed"];
  return first.state === "COMMENTED" ? [] : [`reviews: state ${first.state}, expected COMMENTED`];
};

const failedLogProblems = (failedRun: Gh["failedRun"]): string[] => {
  if (!failedRun.runId) return ["no failing check links to an Actions run"];
  const log = failedRun.log;
  if (!log?.ok) return [`gh run view --log-failed: ${log ? log.message : "not read"}`];
  return /expect|HELLO|error/i.test(log.value)
    ? []
    : ["the failed-run log does not show the failing test"];
};

const checkProblems = (
  checks: readonly { name: string; bucket: string; link: string }[],
): string[] => {
  const ci = checks.find((check) => check.name === "ci");
  if (!ci) {
    return [
      `pr checks: no check named ci (got ${checks.map((check) => check.name).join(", ") || "none"})`,
    ];
  }
  return /\/actions\/runs\/\d+/.test(ci.link)
    ? []
    : [`pr checks: the ci check's link is not an Actions run: ${ci.link}`];
};

/** The pull request exists, is open, and the thread holds its artifact and changes. */
export const pullRequestOpened = (observed: Observed): CheckResult => {
  const id = "pull-request-opened";
  const title =
    "aop_open_pr pushes the branch and opens the pull request in the scratch repository";
  const thread = observed.threads.pr;
  if (!firstRun(thread)) return result(id, title, "skipped", "the pull request thread never ran");

  const { facts } = observed;
  const problems = [
    ...(facts.pullRequestNumber ? [] : ["the thread has no pr artifact"]),
    ...(observed.gh?.view.ok && observed.gh.view.view.state === "CLOSED"
      ? ["the pull request was closed"]
      : []),
    ...(JSON.stringify(thread.diff ?? {}).includes("greeting")
      ? []
      : ["the thread's changes do not list src/greeting.ts"]),
  ];
  const details = [
    `pull request: ${facts.pullRequestUrl ?? "none"}`,
    `branch: ${String(thread.thread?.branch ?? "unknown")}`,
  ];
  return verdict(
    id,
    title,
    problems,
    `pull request #${facts.pullRequestNumber} is open with the thread's changes`,
    details,
  );
};

const promptProblems = (text: string): string[] => [
  ...(text.startsWith("Automatic fix, attempt 1 of 3")
    ? []
    : ["the prompt does not open with attempt 1 of 3"]),
  ...(/\bci\b/.test(text) ? [] : ["the prompt does not name the failing check ci"]),
  ...(/https:\/\/github\.com\/.+\/actions\/runs\/\d+/.test(text)
    ? []
    : ["the prompt has no link to the Actions run"]),
  ...(/HELLO|expect|error/i.test(text) ? [] : ["the prompt does not quote the failing test's log"]),
  ...(/\^\[\[|\t\d{4}-\d{2}-\d{2}T/.test(text)
    ? ["the quoted log still carries gh's job, step and timestamp prefixes or colour text"]
    : []),
];

const answerProblems = (reply: RunObservation | undefined): string[] => {
  if (!reply) return ["no run answered the prompt"];
  return reply.row.status === "completed"
    ? []
    : [`the run that answered the prompt ended ${reply.row.status}`];
};

/** The watcher's fix prompt on the real failing check, and the thread's answer to it. */
export const autoFixOnRealCheck = (observed: Observed): CheckResult => {
  const id = "pr-watch-auto-fix";
  const title = "The PR watcher sends an auto-fix prompt built from the real failing check";
  const thread = observed.threads.pr;
  const prompt = thread.messages.find(
    (message) => message.role === "user" && String(message.text ?? "").startsWith("Automatic fix"),
  );
  if (!prompt)
    return result(id, title, "fail", "no Automatic fix message reached the thread", [
      `watch: ${clip(JSON.stringify(observed.watch ?? null), 400)}`,
    ]);

  const text = String(prompt.text);
  const reply = thread.runs.find((run) => run.row.user_message_id === String(prompt.id));
  const problems = [...promptProblems(text), ...answerProblems(reply)];

  const details = [
    `prompt (${text.length} characters): ${clip(text, 1800)}`,
    `run that answered: ${reply ? `${reply.row.status}, ${clip(String(resultOf(reply.events)?.result ?? ""), 300)}` : "none"}`,
    `watch: ${clip(JSON.stringify(observed.watch ?? null), 600)}`,
    `checks on the thread now: ${JSON.stringify((thread.thread?.artifacts as { checks?: unknown }[] | undefined)?.[0]?.checks ?? null)}`,
  ];
  const base = verdict(
    id,
    title,
    problems,
    "the prompt named ci, linked the run and quoted its log; the thread ran a turn for it",
    details,
  );
  return base.status === "pass" && reply && !pushedFix(reply)
    ? { ...base, status: "warn", summary: `${base.summary}, but the turn did not push a fix` }
    : base;
};

const pushedFix = (reply: RunObservation): boolean =>
  toolCallsOf(reply.events).some(
    (call) => call.name === "mcp__aop__aop_open_pr" && call.result && !call.result.isError,
  );
