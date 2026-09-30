import { type CheckResult, clip, firstRun, result, valuesAfter, verdict } from "./check-types.ts";
import {
  assistantText,
  initOf,
  permissionDenials,
  type ToolCall,
  toolCallsOf,
} from "./log-shapes.ts";
import type { Observed, RunObservation, SessionObservation } from "./observe.ts";

const AOP = "mcp__aop__";
const DENIED = /permission|denied|not allowed|requires approval|haven't granted|was blocked/i;

const callsOf = (session: SessionObservation): ToolCall[] =>
  session.runs.flatMap((run) => toolCallsOf(run.events));

const bashCalls = (session: SessionObservation): ToolCall[] =>
  callsOf(session).filter((call) => call.name === "Bash");

const commandOf = (call: ToolCall): string => String(call.input.command ?? "");

const wasDenied = (call: ToolCall): boolean =>
  call.result?.isError === true && DENIED.test(call.result.text);

const ranFine = (call: ToolCall): boolean => call.result !== undefined && !wasDenied(call);

const outcomeOf = (call: ToolCall): string => {
  if (wasDenied(call)) return "DENIED";
  return call.result?.isError ? "failed" : "ok";
};

const describeBash = (calls: readonly ToolCall[]): string[] =>
  calls.map(
    (call) =>
      `${outcomeOf(call)}: ${clip(commandOf(call), 100)} -> ${clip(call.result?.text ?? "no result", 160)}`,
  );

const ranBash = (calls: readonly ToolCall[], pattern: RegExp): boolean =>
  calls.some((call) => pattern.test(commandOf(call)) && ranFine(call));

const fullAccessProblems = (
  run: RunObservation,
  bash: readonly ToolCall[],
  opened: ToolCall | undefined,
): string[] => [
  ...(run.argv.includes("--dangerously-skip-permissions")
    ? []
    : ["--dangerously-skip-permissions was not passed"]),
  ...(ranBash(bash, /\bgit (status|log)\b/) ? [] : ["no git command ran"]),
  ...(ranBash(bash, /\bbun test\b/) ? [] : ["`bun test` did not run"]),
  ...(permissionDenials(run.events).length > 0 ? ["the result lists permission_denials"] : []),
  ...(opened && !opened.result?.isError
    ? []
    : [`aop_open_pr did not succeed: ${clip(opened?.result?.text ?? "never called")}`]),
];

/** A default thread (full access) runs Bash, git and the tests in its worktree, and opens its pull request. */
export const defaultThreadFullAccess = (observed: Observed): CheckResult => {
  const id = "default-thread-full-access";
  const title = "A default-access thread runs Bash, git and tests in its worktree";
  const thread = observed.threads.pr;
  const run = firstRun(thread);
  if (!run) return result(id, title, "skipped", "the pull request thread never ran");

  const bash = bashCalls(thread);
  const opened = callsOf(thread).find((call) => call.name === `${AOP}aop_open_pr`);
  const problems = fullAccessProblems(run, bash, opened);
  const init = initOf(run.events);
  const details = [
    `workspace: ${thread.session?.workspace_path ?? "unknown"}`,
    `init permission mode: ${init?.permissionMode ?? "not reported"}`,
    `init mcp servers: ${JSON.stringify(init?.mcpServers ?? [])}`,
    ...describeBash(bash),
    `aop_open_pr result: ${clip(opened?.result?.text ?? "none", 300)}`,
  ];
  return verdict(
    id,
    title,
    problems,
    "Bash, git and bun test ran without a denial; the pull request was opened",
    details,
  );
};

const editAccessProblems = (run: RunObservation): string[] => [
  ...(valuesAfter(run.argv, "--permission-mode")[0] === "acceptEdits"
    ? []
    : ["--permission-mode acceptEdits was not passed"]),
  ...(run.argv.includes("--dangerously-skip-permissions")
    ? ["--dangerously-skip-permissions was passed"]
    : []),
];

const mustBeDenied = (bash: readonly ToolCall[], pattern: RegExp): string[] => {
  const call = bash.find((candidate) => pattern.test(commandOf(candidate)));
  if (!call) return [`the thread never tried ${pattern.source}`];
  return ranFine(call) ? [`${pattern.source} ran though the thread may only edit files`] : [];
};

/** An Edit files thread edits files and is denied commands that run code. */
export const editFilesThreadDenied = (observed: Observed): CheckResult => {
  const id = "edit-files-thread-denied";
  const title = "An Edit files thread edits files and is denied commands";
  const thread = observed.threads.edit;
  const run = firstRun(thread);
  if (!run) return result(id, title, "skipped", "the Edit files thread never ran");

  const bash = bashCalls(thread);
  const files = JSON.stringify(thread.diff ?? {});
  const problems = [
    ...editAccessProblems(run),
    ...mustBeDenied(bash, /\bbun test\b/),
    ...mustBeDenied(bash, /\bgit commit\b/),
    ...(files.includes("notes.txt") ? [] : ["notes.txt is not among the thread's changes"]),
  ];
  const details = [
    `permission_denials: ${JSON.stringify(permissionDenials(run.events))}`,
    ...describeBash(bash),
    `changes: ${clip(files, 300)}`,
  ];
  const base = verdict(
    id,
    title,
    problems,
    "commands that run code were denied; the file edit went through",
    details,
  );
  if (base.status === "pass" && ranBash(bash, /\bgit status\b/)) {
    const note =
      "read-only `git status` still ran (Claude Code allows read-only commands without approval)";
    return { ...base, status: "warn", summary: `${base.summary}; ${note}` };
  }
  return base;
};

const askProblems = (thread: SessionObservation, details: string[]): string[] => {
  const run = firstRun(thread);
  if (!run) return [`${thread.label} thread never ran`];
  const calls = toolCallsOf(run.events);
  const ask = calls.find((call) => call.name === `${AOP}aop_ask_user`);
  details.push(
    `${thread.label}: ask input ${clip(JSON.stringify(ask?.input ?? {}), 240)}; tool result: ${clip(ask?.result?.text ?? "none", 160)}`,
  );
  return [
    ...(ask && !ask.result?.isError
      ? []
      : [`${thread.label}: aop_ask_user ${ask ? "failed" : "was not called"}`]),
    ...(calls.some((call) => call.name === "AskUserQuestion")
      ? [`${thread.label}: used the withheld AskUserQuestion`]
      : []),
  ];
};

const resumeProblems = (
  thread: SessionObservation,
  expectedReply: string,
  details: string[],
): string[] => {
  const [first, second] = thread.runs;
  if (!first || !second) return [`${thread.label}: no second run after the answer`];
  const sessionId = first.row.runtime_session_id ?? initOf(first.events)?.sessionId;
  const resumed = valuesAfter(second.argv, "--resume")[0];
  const reply = assistantText(second.events);
  details.push(
    `${thread.label}: first session ${sessionId}; second run resumed ${resumed}, reports ${initOf(second.events)?.sessionId}; reply ${clip(reply, 160)}`,
  );
  return [
    ...(resumed === sessionId
      ? []
      : [`${thread.label}: the answer did not resume session ${sessionId}`]),
    ...(initOf(second.events)?.sessionId === sessionId
      ? []
      : [`${thread.label}: the resumed run reports another session id`]),
    ...(reply.includes(expectedReply)
      ? []
      : [`${thread.label}: the reply after the answer is not "${expectedReply}"`]),
  ];
};

// A model that keeps going after the question still ends its turn; the real run called the
// built-in ScheduleWakeup and wrote a sentence. It is a finding to record, not a failure.
const lingerNotes = (thread: SessionObservation): string[] => {
  const calls = toolCallsOf(firstRun(thread)?.events ?? []);
  const askIndex = calls.findIndex((call) => call.name === `${AOP}aop_ask_user`);
  const after = askIndex === -1 ? [] : calls.slice(askIndex + 1).map((call) => call.name);
  return after.length > 0 ? [`${thread.label}: also called ${after.join(", ")} after asking`] : [];
};

/** aop_ask_user ends the turn with a question, and the answer resumes the same runtime session. */
export const askUserAndResume = (observed: Observed): CheckResult => {
  const id = "ask-user-and-resume";
  const title = "aop_ask_user is called reliably and the answer resumes the same session";
  const details: string[] = [];
  const problems = [
    ...askProblems(observed.threads.ask, details),
    ...askProblems(observed.threads.browser, details),
    ...resumeProblems(observed.threads.ask, "Chosen: formal", details),
  ];
  const notes = [...lingerNotes(observed.threads.ask), ...lingerNotes(observed.threads.browser)];
  const base = verdict(
    id,
    title,
    problems,
    "both threads asked with aop_ask_user; the answer resumed the same session",
    [...details, ...notes],
  );
  return base.status === "pass" && notes.length > 0
    ? { ...base, status: "warn", summary: `${base.summary}; ${notes.join("; ")}` }
    : base;
};

/** After the browser answer: the thread resumed the same session and acted on it. */
export const browserAnswerApplied = (observed: Observed): CheckResult => {
  const id = "browser-answer-applied";
  const title = "The answer typed in the browser resumed the thread and was applied";
  const thread = observed.threads.browser;
  if (thread.runs.length < 2) return result(id, title, "skipped", "no answer has been given yet");
  const details: string[] = [];
  const changes = JSON.stringify(thread.diff ?? {});
  const problems = [
    ...resumeProblems(thread, "Saved: fox", details),
    ...(changes.includes("src/mascot.ts")
      ? []
      : ["src/mascot.ts is not among the thread's changes"]),
  ];
  return verdict(
    id,
    title,
    problems,
    "the browser answer resumed the session and src/mascot.ts was written",
    details,
  );
};
