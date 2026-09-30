import { type CheckResult, clip, result, valuesAfter } from "./check-types.ts";
import { asFields, assistantText, initOf, type ToolCall, toolCallsOf } from "./log-shapes.ts";
import type { Observed, RunObservation } from "./observe.ts";

const AOP_SERVER = "aop";
const ASK_TOOL = "mcp__aop__aop_ask_user";
const TOOL_SEARCH = "ToolSearch";

/** The built-ins that schedule or wake a session; AOP withholds them from threads. */
export const SCHEDULING_TOOLS = [
  "ScheduleWakeup",
  "CronCreate",
  "CronDelete",
  "CronList",
  "Monitor",
  "RemoteTrigger",
];

const aopServerConfig = (argv: readonly string[]): Record<string, unknown> | undefined => {
  const raw = valuesAfter(argv, "--mcp-config")[0];
  if (!raw) return undefined;
  try {
    const servers = asFields(asFields(JSON.parse(raw))?.mcpServers);
    return asFields(servers?.[AOP_SERVER]);
  } catch {
    return undefined;
  }
};

const commandLineProblems = (run: RunObservation): string[] => {
  const disallowed = valuesAfter(run.argv, "--disallowedTools");
  const missing = SCHEDULING_TOOLS.filter((tool) => !disallowed.includes(tool));
  return [
    ...(aopServerConfig(run.argv)?.alwaysLoad === true
      ? []
      : ["the aop server was not passed with alwaysLoad: true"]),
    ...(run.argv.includes("--strict-mcp-config")
      ? ["--strict-mcp-config was passed, which would drop the person's own servers"]
      : []),
    ...(missing.length === 0 ? [] : [`--disallowedTools lacks ${missing.join(", ")}`]),
  ];
};

const callNames = (calls: readonly ToolCall[]): string[] => calls.map((call) => call.name);

// Whether a tool ran before the question is what deferral would show: the model would have to
// load `aop_ask_user` through ToolSearch first.
const behaviourProblems = (label: string, calls: readonly ToolCall[], asked: boolean): string[] => {
  const names = callNames(calls);
  const askAt = names.indexOf(ASK_TOOL);
  const before = askAt === -1 ? names : names.slice(0, askAt);
  const after = askAt === -1 ? [] : names.slice(askAt + 1);
  const scheduled = names.filter((name) => SCHEDULING_TOOLS.includes(name));
  return [
    ...(asked && askAt === -1 ? [`${label}: aop_ask_user was not called`] : []),
    ...(asked && before.includes(TOOL_SEARCH)
      ? [`${label}: ToolSearch ran before aop_ask_user, so the aop tools were deferred`]
      : []),
    ...(scheduled.length > 0
      ? [
          `${label}: called scheduling built-ins ${scheduled.join(", ")} (after the question: ${after.filter((name) => SCHEDULING_TOOLS.includes(name)).join(", ") || "none"})`,
        ]
      : []),
  ];
};

const runProblemsAndDetails = (
  run: RunObservation,
  label: string,
  asked: boolean,
): { problems: string[]; details: string[]; otherServers: string[] } => {
  const init = initOf(run.events);
  const calls = toolCallsOf(run.events);
  const servers = init?.mcpServers ?? [];
  const otherServers = servers
    .filter((server) => server.name !== AOP_SERVER)
    .map(({ name }) => name);
  const aop = servers.find((server) => server.name === AOP_SERVER);
  const offered = (init?.tools ?? []).filter((tool) => SCHEDULING_TOOLS.includes(tool));
  const problems = [
    ...commandLineProblems(run).map((problem) => `${label}: ${problem}`),
    ...(init ? [] : [`${label}: the log has no init event`]),
    ...(aop?.status === "connected"
      ? []
      : [`${label}: the aop server is ${aop?.status ?? "missing"}`]),
    ...(offered.length > 0 ? [`${label}: init still lists ${offered.join(", ")}`] : []),
    ...behaviourProblems(label, calls, asked),
  ];
  const details = [
    `${label}: init mcp servers ${JSON.stringify(servers)}`,
    `${label}: init lists ${init?.tools.length ?? 0} tools; ToolSearch ${init?.tools.includes(TOOL_SEARCH) ? "is" : "is not"} among them; ${ASK_TOOL} ${init?.tools.includes(ASK_TOOL) ? "is" : "is not"} among them`,
    `${label}: tool calls in order ${JSON.stringify(callNames(calls))}`,
    `${label}: reply ${clip(assistantText(run.events), 160)}`,
  ];
  return { problems, details, otherServers };
};

/**
 * A thread keeps the person's own MCP servers, has the aop tools from the first request (no
 * ToolSearch before the question), and is never offered a tool that schedules or wakes a session.
 */
export const threadToolsPinned = (observed: Observed): CheckResult => {
  const id = "thread-tools-pinned";
  const title =
    "A thread keeps the person's MCP servers, loads the aop tools up front and cannot schedule";
  const runs = observed.threads.ask.runs;
  if (runs.length === 0) return result(id, title, "skipped", "the ask thread never ran");

  const problems: string[] = [];
  const details: string[] = [];
  let kept = 0;
  for (const [index, run] of runs.entries()) {
    const label = index === 0 ? "first run" : "run after the answer";
    const judged = runProblemsAndDetails(run, label, index === 0);
    problems.push(...judged.problems);
    details.push(...judged.details);
    if (index === 0) kept = judged.otherServers.length;
  }
  if (problems.length > 0) return result(id, title, "fail", problems.join("; "), details);
  const summary = `the aop tools were loaded up front (no ToolSearch before aop_ask_user), no scheduling built-in was offered or called, ${runs.length} run(s) checked`;
  return kept > 0
    ? result(id, title, "pass", `${summary}; the init lists ${kept} server(s) besides aop`, details)
    : result(
        id,
        title,
        "warn",
        `${summary}; this machine's Claude Code listed no server besides aop, so keeping the person's servers was not shown`,
        details,
      );
};
