import type { AskUser, McpCall, TokenUsage } from "./types";

/** How one turn should behave. Every field is optional in the script text. */
export interface Directives {
  /** Sleep before the first event, to exercise startup watchdogs. */
  startupMs: number;
  /** Sleep between consecutive events, to exercise streaming and inactivity watchdogs. */
  delayMs: number;
  /** Tool-call rounds before the final reply. */
  steps: number;
  /** Final reply text; replaces the default echo. */
  say?: string;
  ask?: AskUser;
  /** MCP tool calls made after the steps and before the question, in order. */
  calls?: McpCall[];
  /** Set when `calls` is not a JSON array of `{name, arguments}`; the turn then fails loudly. */
  callsError?: string;
  /** Set means the turn ends with the CLI's error event and a failing exit code. */
  failMessage?: string;
  /** Without `failMessage` the CLI exits with this code and no terminal event. */
  exitCode?: number;
  /** Complete events written before the process is SIGKILLed mid-line. */
  crashAfter?: number;
  /** Tokens the turn reports as consumed, so accounting can be asserted against known numbers. */
  usage: TokenUsage;
}

const MARKER_OPEN = "[fake:";
const TOKEN = /(\w+)(?:=(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
export const DEFAULT_ASK_TOOL = "aop_ask_user";
const DEFAULT_FAIL_MESSAGE = "fake CLI failure";
const DEFAULT_CRASH_AFTER = 2;
const DEFAULT_USAGE: TokenUsage = { input: 10, output: 5, cacheWrite: 200, cacheRead: 4000 };

/**
 * The last `[fake: key=value ...]` marker in the prompt wins, so a resumed
 * conversation that replays old messages still obeys the newest one. Without a
 * marker, `FAKE_CLI_SCRIPT` (same syntax, no brackets) sets a process-wide default.
 * Values are bare, `"double quoted"` or `'single quoted'`.
 */
export const parseDirectives = (prompt: string, envScript = ""): Directives => {
  const script = findMarkers(prompt).at(-1)?.script ?? envScript;
  const tokens = readTokens(script);
  const question = tokens.get("ask");
  return {
    startupMs: toNumber(tokens.get("startup"), 0),
    delayMs: toNumber(tokens.get("delay"), 0),
    steps: toNumber(tokens.get("steps"), 0),
    say: tokens.get("say") || undefined,
    ask: question === undefined ? undefined : readAsk(question, tokens),
    ...readCalls(tokens.get("calls")),
    failMessage: readFailMessage(tokens),
    exitCode: optionalNumber(tokens.get("exit")),
    crashAfter: readCrashAfter(tokens),
    usage: readUsage(tokens.get("usage")),
  };
};

/** The prompt as the user typed it, without the scripting marker. */
export const stripDirectives = (prompt: string): string => {
  let stripped = "";
  let from = 0;
  for (const marker of findMarkers(prompt)) {
    stripped += prompt.slice(from, marker.start);
    from = marker.end;
  }
  return (stripped + prompt.slice(from)).trim();
};

interface Marker {
  start: number;
  end: number;
  script: string;
}

const findMarkers = (text: string): Marker[] => {
  const markers: Marker[] = [];
  let from = 0;
  while (from < text.length) {
    const start = text.indexOf(MARKER_OPEN, from);
    if (start < 0) break;
    const close = findClose(text, start + MARKER_OPEN.length);
    if (close < 0) {
      from = start + MARKER_OPEN.length;
      continue;
    }
    markers.push({ start, end: close + 1, script: text.slice(start + MARKER_OPEN.length, close) });
    from = close + 1;
  }
  return markers;
};

// The marker ends at the first `]` outside a quoted value, so a value may hold `]`. A quote with
// no partner is plain text, so `say=don't` still parses as it did before values could be quoted.
const findClose = (text: string, from: number): number => {
  let index = from;
  while (index < text.length) {
    const char = text.charAt(index);
    if (char === "]") return index;
    const partner = char === '"' || char === "'" ? text.indexOf(char, index + 1) : -1;
    index = partner >= 0 ? partner + 1 : index + 1;
  }
  return -1;
};

// A bare key (`crash`, `fail`) is a flag with its default value.
const readTokens = (script: string): Map<string, string> => {
  const tokens = new Map<string, string>();
  for (const [, key = "", double, single, bare] of script.matchAll(TOKEN)) {
    tokens.set(key, double ?? single ?? bare ?? "");
  }
  return tokens;
};

const readAsk = (question: string, tokens: Map<string, string>): AskUser => ({
  question,
  options: (tokens.get("options") ?? "").split("|").filter(Boolean),
  tool: tokens.get("tool") ?? DEFAULT_ASK_TOOL,
});

const readCalls = (raw: string | undefined): Pick<Directives, "calls" | "callsError"> => {
  if (raw === undefined) return {};
  const calls = parseCalls(raw);
  return calls ? { calls } : { callsError: "fake CLI: invalid calls directive" };
};

const parseCalls = (raw: string): McpCall[] | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const calls: McpCall[] = [];
  for (const entry of parsed) {
    const call = toCall(entry);
    if (!call) return null;
    calls.push(call);
  }
  return calls;
};

const toCall = (entry: unknown): McpCall | null => {
  if (!isRecord(entry) || typeof entry.name !== "string" || !entry.name) return null;
  const args = entry.arguments ?? {};
  return isRecord(args) ? { name: entry.name, arguments: args } : null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readFailMessage = (tokens: Map<string, string>): string | undefined => {
  const message = tokens.get("fail");
  if (message === undefined) return undefined;
  return message || DEFAULT_FAIL_MESSAGE;
};

const readCrashAfter = (tokens: Map<string, string>): number | undefined => {
  const value = tokens.get("crash");
  if (value === undefined) return undefined;
  return toNumber(value, DEFAULT_CRASH_AFTER);
};

// `usage=<input>,<output>,<cacheWrite>,<cacheRead>`. A missing or non-numeric part is 0; no key,
// or a bare `usage`, keeps the default.
const readUsage = (value: string | undefined): TokenUsage => {
  if (!value) return DEFAULT_USAGE;
  const [input = 0, output = 0, cacheWrite = 0, cacheRead = 0] = value
    .split(",")
    .map((part) => toNumber(part, 0));
  return { input, output, cacheWrite, cacheRead };
};

const optionalNumber = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const toNumber = (value: string | undefined, fallback: number): number =>
  optionalNumber(value) ?? fallback;
