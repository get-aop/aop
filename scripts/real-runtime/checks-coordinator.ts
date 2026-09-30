import { type CheckResult, clip, firstRun, result, valuesAfter, verdict } from "./check-types.ts";
import {
  assistantText,
  initOf,
  permissionDenials,
  type ToolCall,
  toolCallsOf,
} from "./log-shapes.ts";
import type { Observed, RunObservation } from "./observe.ts";
import { CODEWORD } from "./prompts.ts";

const AOP_TOOL_PREFIX = "mcp__aop__";

const restrictedProblems = (
  run: RunObservation,
  calls: readonly ToolCall[],
  hasInit: boolean,
): string[] => [
  ...(run.argv.includes("--dangerously-skip-permissions")
    ? ["passed --dangerously-skip-permissions"]
    : []),
  ...(run.argv.includes("--permission-mode") ? ["passed --permission-mode"] : []),
  ...(run.argv.includes("--strict-mcp-config") ? [] : ["did not pass --strict-mcp-config"]),
  ...calls
    .filter((call) => !call.name.startsWith(AOP_TOOL_PREFIX) && call.result && !call.result.isError)
    .map((call) => `built-in tool ${call.name} ran without an error`),
  ...(hasInit ? [] : ["the CLI reported no init event"]),
];

/**
 * The coordinator is restricted: approval-required, no permission-skipping flag, and only the
 * AOP tools. Judged from the argv the gate saw, the tool list the CLI reported at start, and
 * what happened when the coordinator was asked to run a shell command.
 */
export const coordinatorRestricted = (observed: Observed): CheckResult => {
  const id = "coordinator-restricted";
  const title = "Coordinator is restricted (approval-required, only mcp__aop__* tools)";
  const run = firstRun(observed.coordinator);
  if (!run) return result(id, title, "skipped", "the coordinator never ran");

  const calls = toolCallsOf(run.events);
  const init = initOf(run.events);
  const problems = restrictedProblems(run, calls, init !== null);

  const builtIns = init?.tools.filter((tool) => !tool.startsWith(AOP_TOOL_PREFIX)) ?? [];
  const details = [
    `argv flags: ${run.argv.filter((arg) => arg.startsWith("--")).join(" ")}`,
    `--tools value: ${JSON.stringify(valuesAfter(run.argv, "--tools"))}`,
    `init tools (${init?.tools.length ?? 0}): ${clip((init?.tools ?? []).join(", "), 600)}`,
    `init mcp servers: ${JSON.stringify(init?.mcpServers ?? [])}`,
    `init permission mode: ${init?.permissionMode ?? "not reported"}`,
    `tool calls: ${calls.map((call) => `${call.name}${call.result?.isError ? " (error)" : ""}`).join(", ") || "none"}`,
    `permission_denials: ${JSON.stringify(permissionDenials(run.events))}`,
  ];
  const base = verdict(
    id,
    title,
    problems,
    "no built-in tool ran; every tool offered was an AOP tool",
    details,
  );
  if (base.status === "pass" && builtIns.length > 0) {
    return result(
      id,
      title,
      "warn",
      `--tools "" left ${builtIns.length} built-in tool(s) offered (${builtIns.join(", ")}); none ran, so the access mode is what held them back`,
      details,
    );
  }
  return base;
};

/** thread_spawn worked, and the reply links the thread as a `thread:<id>` chip. */
export const coordinatorSpawnAndChips = (observed: Observed): CheckResult => {
  const id = "coordinator-spawn-and-chips";
  const title = "Coordinator starts a thread and links it as a thread:<id> chip";
  const run = firstRun(observed.coordinator);
  const threadId = observed.threads.pr.session?.id;
  if (!run) return result(id, title, "skipped", "the coordinator never ran");

  const spawn = toolCallsOf(run.events).find(
    (call) => call.name === `${AOP_TOOL_PREFIX}thread_spawn`,
  );
  const problems: string[] = [];
  if (!spawn) problems.push("the coordinator never called thread_spawn");
  else if (spawn.result?.isError) problems.push(`thread_spawn failed: ${clip(spawn.result.text)}`);
  if (!threadId) problems.push("no thread was started");

  const reply = assistantText(run.events);
  const chip = threadId ? new RegExp(`\\[[^\\]]+\\]\\(thread:${threadId}\\)`) : null;
  const details = [
    `reply: ${clip(reply, 500)}`,
    `thread_spawn input: ${clip(JSON.stringify(spawn?.input ?? {}), 400)}`,
  ];
  if (threadId && chip && !chip.test(reply)) {
    problems.push(`the reply has no [title](thread:${threadId}) link`);
  }
  return verdict(
    id,
    title,
    problems,
    "thread_spawn succeeded and the reply carries a thread:<id> link",
    details,
  );
};

/**
 * An edit to the project's instructions reaches a resumed coordinator session: the run passes
 * `--append-system-prompt` with `--system-prompt-snapshot off` on `--resume`, and the model
 * answers from the text it was just given.
 */
export const systemPromptOnResume = (observed: Observed): CheckResult => {
  const id = "system-prompt-on-resume";
  const title =
    "--append-system-prompt with --system-prompt-snapshot off reaches a resumed session";
  const messageId = observed.facts.codewordMessageId;
  const run = observed.coordinator.runs.find(
    (candidate) => candidate.row.user_message_id === messageId,
  );
  if (!run) return result(id, title, "skipped", "the second coordinator turn never ran");

  const problems: string[] = [];
  const appended = valuesAfter(run.argv, "--append-system-prompt")[0] ?? "";
  if (!run.argv.includes("--resume")) problems.push("the turn did not resume the session");
  if (valuesAfter(run.argv, "--system-prompt-snapshot")[0] !== "off")
    problems.push("--system-prompt-snapshot off was not passed");
  if (!appended.includes(CODEWORD))
    problems.push("the appended prompt does not hold the edited instructions");
  const reply = assistantText(run.events);
  if (!reply.includes(CODEWORD)) problems.push(`the reply does not contain ${CODEWORD}`);

  const first = firstRun(observed.coordinator);
  const details = [
    `resumed session: ${valuesAfter(run.argv, "--resume")[0] ?? "none"} (first turn session: ${first?.row.runtime_session_id ?? "unknown"})`,
    `appended prompt: ${appended.length} characters`,
    `reply: ${clip(reply, 400)}`,
    `init session id of this turn: ${initOf(run.events)?.sessionId ?? "not reported"}`,
  ];
  return verdict(
    id,
    title,
    problems,
    `the resumed turn answered ${CODEWORD} from the edited instructions`,
    details,
  );
};
