import type { AskUser } from "./types";

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
  /** Set means the turn ends with the CLI's error event and a failing exit code. */
  failMessage?: string;
  /** Without `failMessage` the CLI exits with this code and no terminal event. */
  exitCode?: number;
  /** Complete events written before the process is SIGKILLed mid-line. */
  crashAfter?: number;
}

const MARKER = /\[fake:([^\]]*)\]/g;
const TOKEN = /(\w+)(?:=(?:"([^"]*)"|(\S+)))?/g;
const DEFAULT_ASK_TOOL = "aop_ask_user";
const DEFAULT_FAIL_MESSAGE = "fake CLI failure";
const DEFAULT_CRASH_AFTER = 2;

/**
 * The last `[fake: key=value ...]` marker in the prompt wins, so a resumed
 * conversation that replays old messages still obeys the newest one. Without a
 * marker, `FAKE_CLI_SCRIPT` (same syntax, no brackets) sets a process-wide default.
 */
export const parseDirectives = (prompt: string, envScript = ""): Directives => {
  const script = [...prompt.matchAll(MARKER)].at(-1)?.[1] ?? envScript;
  const tokens = readTokens(script);
  const question = tokens.get("ask");
  return {
    startupMs: toNumber(tokens.get("startup"), 0),
    delayMs: toNumber(tokens.get("delay"), 0),
    steps: toNumber(tokens.get("steps"), 0),
    say: tokens.get("say") || undefined,
    ask: question === undefined ? undefined : readAsk(question, tokens),
    failMessage: readFailMessage(tokens),
    exitCode: optionalNumber(tokens.get("exit")),
    crashAfter: readCrashAfter(tokens),
  };
};

/** The prompt as the user typed it, without the scripting marker. */
export const stripDirectives = (prompt: string): string => prompt.replace(MARKER, "").trim();

// A bare key (`crash`, `fail`) is a flag with its default value.
const readTokens = (script: string): Map<string, string> => {
  const tokens = new Map<string, string>();
  for (const [, key = "", quoted, bare] of script.matchAll(TOKEN)) {
    tokens.set(key, quoted ?? bare ?? "");
  }
  return tokens;
};

const readAsk = (question: string, tokens: Map<string, string>): AskUser => ({
  question,
  options: (tokens.get("options") ?? "").split("|").filter(Boolean),
  tool: tokens.get("tool") ?? DEFAULT_ASK_TOOL,
});

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

const optionalNumber = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const toNumber = (value: string | undefined, fallback: number): number =>
  optionalNumber(value) ?? fallback;
