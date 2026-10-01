import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeDialect } from "./claude";
import { type Directives, parseDirectives } from "./directives";
import { writeFiles } from "./files";
import type { InputLines } from "./input-lines";
import { carryOut } from "./mcp-beats";
import { beginTurn } from "./session-store";
import { planTurn } from "./turn";
import {
  AOP_MCP_SERVER,
  type Dialect,
  type Ending,
  type Invocation,
  type JsonLine,
  type McpConnection,
  type PlannedBeat,
  type TokenUsage,
  type TurnContext,
  type UserLine,
} from "./types";

const DIALECTS: Dialect[] = [claudeDialect];
const USAGE_EXIT_CODE = 2;
const FAILURE_EXIT_CODE = 1;
// Only reachable when `Io.crash` returns (an in-process test); a real SIGKILL ends the process first.
const CRASHED_EXIT_CODE = 137;

export interface Runtime {
  args: string[];
  env: Record<string, string | undefined>;
  cwd: string;
  /** The CLI's stdin as lines; only read when the arguments say the prompt is there. */
  stdin?: InputLines;
}

export interface Io {
  /** Synchronous, so events already written survive a SIGKILL. */
  write(text: string): void;
  warn(text: string): void;
  sleep(ms: number): Promise<void>;
  /** SIGKILLs the process. Tests substitute a recorder. */
  crash(): void;
  /** Opens a connection to the MCP server at `url`. Nothing is sent until the first tool call. */
  mcp(url: string): McpConnection;
}

/** One stretch of the turn's events; MCP calls run when their stretch is reached, not up front. */
type Segment = () => Promise<JsonLine[]>;

/** How a launch goes on: the turns its stdin asks for, one after another. */
interface Launch {
  runtime: Runtime;
  io: Io;
  dialect: Dialect;
  invocation: Invocation;
  input: InputLines | undefined;
  /** What the launch's turns so far consumed. */
  usage: TokenUsage;
}

/**
 * Plays the turns of one CLI launch and returns the exit code. See directives.ts for the
 * scripting syntax. A prompt on stdin (`--input-format stream-json`) is read a line at a time,
 * as Claude Code reads it: a line that arrives while a turn works reaches it after the step it
 * is on, and one that arrives as the turn answers starts another turn once it has. The launch
 * ends with its input, or with a turn that does not end well.
 */
export const runFakeCli = async (runtime: Runtime, io: Io): Promise<number> => {
  const dialect = DIALECTS.find((candidate) => candidate.matches(runtime.args));
  if (!dialect) return abort(io, "fake-cli: unrecognised arguments", USAGE_EXIT_CODE);
  const input = dialect.readsStdin(runtime.args) ? runtime.stdin : undefined;
  const firstLine = input ? ((await input.next()) ?? "") : undefined;
  const invocation = dialect.parse(runtime.args, firstLine);
  if (!invocation.prompt) return abort(io, "fake-cli: no prompt given", FAILURE_EXIT_CODE);

  const usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  return playTurns({ runtime, io, dialect, invocation, input, usage });
};

const playTurns = async (launch: Launch): Promise<number> => {
  let message: UserLine = launch.invocation;
  let resumeId = launch.invocation.resumeId;
  const waiting: string[] = [];
  for (let resultIndex = 0; ; resultIndex += 1) {
    const played = await playTurn(launch, message, resumeId, resultIndex);
    if (typeof played === "number") return played;
    if (!launch.input) return 0;
    waiting.push(...played.waiting);
    const line = waiting.shift() ?? (await launch.input.next());
    if (line === null) return 0;
    message = launch.dialect.readLine(line);
    resumeId = played.sessionId;
  }
};

/** The exit code of a launch that ends here, or how the next turn of a launch that goes on starts. */
type Played = number | { sessionId: string; waiting: string[] };

const playTurn = async (
  launch: Launch,
  message: UserLine,
  resumeId: string | undefined,
  resultIndex: number,
): Promise<Played> => {
  const { runtime, io, dialect, invocation, input } = launch;
  const directives = parseDirectives(message.prompt, runtime.env.FAKE_CLI_SCRIPT);
  await io.sleep(directives.startupMs);

  const session = beginTurn(resolveHome(runtime.env), dialect.name, resumeId, {
    appended: invocation.appendSystemPrompt,
    recording: invocation.recordSystemPrompt,
    flags: invocation.flags,
    model: invocation.model,
    effort: invocation.effort,
  });
  if (!session) {
    const text = `No conversation found with session ID: ${resumeId}`;
    return abort(io, text, FAILURE_EXIT_CODE);
  }
  for (const path of writeFiles(directives.writes ?? [], runtime.cwd)) {
    io.warn(`fake-cli: refusing to write outside the working directory: ${path}`);
  }
  const ctx: TurnContext = {
    sessionId: session.id,
    cwd: runtime.cwd,
    model: invocation.model,
    usage: directives.usage,
    prompt: message.prompt,
    turn: session.turn,
    resumed: session.resumed,
    systemPrompt: session.appendedSystemPrompt,
    usageWarning: directives.usageWarning,
    partialMessages: invocation.flags.includes("--include-partial-messages"),
    replayUserMessages: invocation.flags.includes("--replay-user-messages"),
    images: message.images,
    steers: [],
    resultIndex,
    processUsage: addUsage(launch.usage, directives.usage),
  };
  const plan = planTurn(directives, ctx);
  const server = invocation.mcpServers[AOP_MCP_SERVER];
  const aop = server ? io.mcp(server.url) : undefined;
  // Steers are taken where the CLI takes them: after the step the turn is on.
  const steered =
    (segment: Segment): Segment =>
    async () => [...(await segment()), ...takeSteers(dialect, input, ctx)];
  let ending = plan.ending;
  const segments: Segment[] = [
    steered(async () => [...dialect.start(ctx), ...dialect.replay(message, ctx)]),
    ...plan.beats.map((beat, index) => steered(beatSegment(dialect, beat, index, ctx, aop))),
    async () => {
      ending = steeredEnding(directives, ctx);
      return dialect.end(ending, ctx);
    },
  ];

  if (await emit(segments, directives, io)) return CRASHED_EXIT_CODE;
  if (ending.kind !== "success") return exitCodeFor(ending, directives, io);
  return { sessionId: session.id, waiting: input?.take() ?? [] };
};

// Adds a turn's tokens to its launch's, which a result reports as the process's.
const addUsage = (total: TokenUsage, turn: TokenUsage): TokenUsage => {
  total.input += turn.input;
  total.output += turn.output;
  total.cacheWrite += turn.cacheWrite;
  total.cacheRead += turn.cacheRead;
  return { ...total };
};

/** The lines that reached the turn: echoed where it took them, and remembered for its reply. */
const takeSteers = (
  dialect: Dialect,
  input: InputLines | undefined,
  ctx: TurnContext,
): JsonLine[] =>
  (input?.take() ?? []).flatMap((line) => {
    const steer = dialect.readLine(line);
    ctx.steers?.push(steer);
    return dialect.replay(steer, ctx);
  });

/** The turn's ending once its steers are in: the newest steer's `say` replaces the prompt's. */
const steeredEnding = (directives: Directives, ctx: TurnContext): Ending => {
  const steer = (ctx.steers ?? []).findLast(
    (message) => parseDirectives(message.prompt).say !== undefined,
  );
  const say = steer === undefined ? directives.say : parseDirectives(steer.prompt).say;
  return planTurn({ ...directives, say }, ctx).ending;
};

const beatSegment =
  (
    dialect: Dialect,
    beat: PlannedBeat,
    index: number,
    ctx: TurnContext,
    aop: McpConnection | undefined,
  ): Segment =>
  async () =>
    dialect.beat(await carryOut(beat, aop), index, ctx);

// Empty counts as unset: shells and process managers export blank variables.
const resolveHome = (env: Runtime["env"]): string =>
  env.FAKE_CLI_HOME || join(env.AOP_HOME || tmpdir(), "fake-cli");

const abort = (io: Io, message: string, exitCode: number): number => {
  io.warn(message);
  return exitCode;
};

/** Returns true when the script crashed the process mid-line. */
const emit = async (segments: Segment[], directives: Directives, io: Io): Promise<boolean> => {
  let index = 0;
  for (const segment of segments) {
    for (const line of await segment()) {
      if (index > 0) await pauseBefore(line, directives, io);
      const text = JSON.stringify(line);
      if (index === directives.crashAfter) {
        // The half-written line is what a process killed mid-write leaves in the log.
        io.write(text.slice(0, Math.ceil(text.length / 2)));
        io.crash();
        return true;
      }
      io.write(`${text}\n`);
      index += 1;
    }
  }
  return false;
};

// Partial-message events have their own pace, so a reply can stream slowly between quick beats.
const pauseBefore = async (line: JsonLine, directives: Directives, io: Io): Promise<void> => {
  const pause = line.type === "stream_event" ? directives.streamMs : directives.delayMs;
  if (pause > 0) await io.sleep(pause);
};

const describeExit = (ending: Exclude<Ending, { kind: "success" }>, exitCode: number): string => {
  switch (ending.kind) {
    case "failure":
      return ending.message;
    case "rate-limit":
      return `usage limit reached, resets in ${ending.resetsInSeconds}s`;
    case "silent":
      return `exiting with status ${exitCode}`;
  }
};

const exitCodeFor = (ending: Ending, directives: Directives, io: Io): number => {
  if (ending.kind === "success") return 0;
  const exitCode = directives.exitCode ?? FAILURE_EXIT_CODE;
  io.warn(`fake-cli: ${describeExit(ending, exitCode)}`);
  return exitCode;
};
