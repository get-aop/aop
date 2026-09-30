import type { RunRow } from "./host-db.ts";
import type { Fields } from "./log-shapes.ts";
import type { Observed, RunObservation, SessionObservation, ThreadObservation } from "./observe.ts";

/**
 * Builders for events in the shapes the real Claude Code 2.1.285 wrote (recorded by the harness),
 * and an `Observed` in which every check passes, to be spoiled one fact at a time.
 */
export const initEvent = (over: Fields = {}): Fields => ({
  type: "system",
  subtype: "init",
  session_id: "sess-1",
  tools: ["mcp__aop__thread_spawn"],
  mcp_servers: [{ name: "aop", status: "connected", source: "dynamic" }],
  model: "claude-sonnet-5-5",
  permissionMode: "default",
  ...over,
});

export const toolUse = (id: string, name: string, input: Fields = {}): Fields => ({
  type: "assistant",
  message: { id: `msg-${id}`, content: [{ type: "tool_use", id, name, input }] },
});

export const toolResult = (id: string, content: unknown, isError = false): Fields => ({
  type: "user",
  message: {
    content: [
      { type: "tool_result", tool_use_id: id, content, ...(isError ? { is_error: true } : {}) },
    ],
  },
});

export const text = (value: string): Fields => ({
  type: "assistant",
  message: { id: "msg-text", content: [{ type: "text", text: value }] },
});

/** A result shaped like the real one: snake_case `usage`, camelCase `modelUsage`. */
export const resultEvent = (over: Fields = {}): Fields => ({
  type: "result",
  subtype: "success",
  is_error: false,
  num_turns: 2,
  session_id: "sess-1",
  total_cost_usd: 0.04,
  usage: {
    input_tokens: 4,
    cache_creation_input_tokens: 7633,
    cache_read_input_tokens: 7052,
    output_tokens: 656,
  },
  modelUsage: {
    "claude-sonnet-5-5": {
      inputTokens: 4,
      outputTokens: 656,
      cacheReadInputTokens: 7052,
      cacheCreationInputTokens: 7633,
      costUSD: 0.04,
    },
  },
  permission_denials: [],
  ...over,
});

/** The rate_limit_event a real Max login writes on an ordinary run (status allowed_warning, no limit hit). */
export const REAL_RATE_LIMIT_EVENT: Fields = {
  type: "rate_limit_event",
  rate_limit_info: {
    status: "allowed_warning",
    resetsAt: 1790960400,
    rateLimitType: "seven_day",
    utilization: 0.86,
    isUsingOverage: false,
    surpassedThreshold: 0.75,
    unifiedWindows: {
      five_hour: { utilization: 0.06, resetsAt: 1790802600 },
      seven_day: { utilization: 0.86, resetsAt: 1790960400 },
    },
  },
  session_id: "sess-1",
};

const runRow = (id: string, over: Partial<RunRow> = {}): RunRow => ({
  id,
  session_id: "s",
  user_message_id: `m-${id}`,
  status: "completed",
  failure_kind: null,
  runtime_session_id: "sess-1",
  resume_session_id: null,
  log_file_path: "",
  pid: 1,
  created_at: "2026-09-30T00:00:00.000Z",
  ...over,
});

export const run = (
  id: string,
  events: Fields[],
  argv: string[] = [],
  row: Partial<RunRow> = {},
): RunObservation => ({
  row: runRow(id, row),
  argv: ["--model", "sonnet", "--effort", "medium", ...argv],
  events: [initEvent(), ...events, resultEvent()],
});

export const session = (label: string, runs: RunObservation[]): SessionObservation => ({
  label,
  session: {
    id: `id-${label}`,
    kind: "thread",
    project_id: "p",
    runtime_session_id: "sess-1",
    runtime_access_mode: null,
    model: "sonnet",
    reasoning_effort: "medium",
    workspace_path: "/work",
    title: label,
  },
  runs,
});

export const threadObservation = (label: string, runs: RunObservation[]): ThreadObservation => ({
  ...session(label, runs),
  thread: { branch: "aop/x", artifacts: [] },
  messages: [],
  diff: {},
});

/** An `Observed` with no runs at all; tests fill in the parts their check reads. */
export const emptyObserved = (): Observed => ({
  facts: { pullRequestNumber: null, pullRequestUrl: null, startedAt: "", notes: [] },
  ledger: { runs: 0, cliTurns: 0, costUsd: 0, timedOut: 0 },
  coordinator: { ...session("coordinator", []), messages: [], usage: null },
  editCoordinator: session("editCoordinator", []),
  threads: {
    pr: threadObservation("pr", []),
    ask: threadObservation("ask", []),
    browser: threadObservation("browser", []),
    edit: threadObservation("edit", []),
  },
  projectUsage: null,
  watch: null,
  gh: null,
  gaps: [],
});
