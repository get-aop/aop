import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeDialect } from "./claude";
import { type Directives, parseDirectives } from "./directives";
import { writeFiles } from "./files";
import { createInbox, type Inbox } from "./inbox";
import type { InputLines } from "./input-lines";
import { carryOut } from "./mcp-beats";
import { beginTurn } from "./session-store";
import { planTurn } from "./turn";
import {
  AOP_MCP_SERVER,
  type Dialect,
  type Ending,
  type Interruption,
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

/** How often a long step looks for an interrupt. */
const HOLD_POLL_MS = 50;

/** How a launch goes on: the turns its stdin asks for, one after another. */
interface Launch {
  runtime: Runtime;
  io: Io;
  dialect: Dialect;
  invocation: Invocation;
  /** Stdin, when the prompt and later messages come there. */
  input: Inbox | undefined;
  /** What the launch's turns so far consumed. */
  usage: TokenUsage;
}

/**
 * Plays the turns of one CLI launch and returns the exit code. See directives.ts for the
 * scripting syntax. A prompt on stdin (`--input-format stream-json`) is read a line at a time,
 * as Claude Code reads it: a line that arrives while a turn works reaches it after the step it
 * is on, and one that arrives as the turn answers starts another turn once it has. An interrupt
 * (a `control_request` line) stops the turn at the step it is on, and the messages not taken yet
 * start the next turn. The launch ends with its input, or with a turn that does not end well.
 */
export const runFakeCli = async (runtime: Runtime, io: Io): Promise<number> => {
  const dialect = DIALECTS.find((candidate) => candidate.matches(runtime.args));
  if (!dialect) return abort(io, "fake-cli: unrecognised arguments", USAGE_EXIT_CODE);
  const input =
    dialect.readsStdin(runtime.args) && runtime.stdin ? createInbox(runtime.stdin) : undefined;
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
  const { runtime, io, dialect, invocation } = launch;
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
  const turn: TurnState = { launch, ctx, cut: null };
  const aop = server ? io.mcp(server.url) : undefined;
  let ending = plan.ending;
  const segments: Segment[] = [
    steered(turn, async () => [...dialect.start(ctx), ...dialect.replay(message, ctx)]),
    ...plan.beats.flatMap((beat, index) =>
      beat.kind === "hold"
        ? holdSegments(turn, beat, index)
        : [steered(turn, beatSegment(dialect, beat, index, ctx, aop))],
    ),
    async () => {
      if (turn.cut) return dialect.interrupted(turn.cut, ctx);
      ending = steeredEnding(directives, ctx);
      return dialect.end(ending, ctx);
    },
  ];

  if (await emit(segments, directives, io)) return CRASHED_EXIT_CODE;
  if (!turn.cut && ending.kind !== "success") return exitCodeFor(ending, directives, io);
  return { sessionId: session.id, waiting: launch.input?.take() ?? [] };
};

/** One turn as it plays: `cut` once an interrupt stopped it, after which it writes nothing more. */
interface TurnState {
  launch: Launch;
  ctx: TurnContext;
  cut: Interruption | null;
}

// Steers are taken where the CLI takes them: after the step the turn is on. An interrupt that
// arrived meanwhile stops the turn there instead, and they wait for the next one.
const steered =
  (turn: TurnState, segment: Segment): Segment =>
  async () => {
    if (turn.cut) return [];
    const lines = await segment();
    return turn.cut || cutBy(turn) ? lines : [...lines, ...takeSteers(turn.launch, turn.ctx)];
  };

// A long step: its call is written, then it runs until it ends or an interrupt stops it.
const holdSegments = (
  turn: TurnState,
  beat: Extract<PlannedBeat, { kind: "hold" }>,
  index: number,
): Segment[] => {
  const { dialect, io } = turn.launch;
  const rendered = (phase: "start" | "end") => dialect.beat({ ...beat, phase }, index, turn.ctx);
  return [
    async () => (turn.cut ? [] : rendered("start")),
    steered(turn, async () => {
      for (let waited = 0; waited < beat.ms; waited += HOLD_POLL_MS) {
        if (cutBy(turn, toolUseIdOf(rendered("start")))) return [];
        await io.sleep(Math.min(HOLD_POLL_MS, beat.ms - waited));
      }
      return rendered("end");
    }),
  ];
};

// Whether an interrupt arrived: the turn is then cut at the step it is on.
const cutBy = (turn: TurnState, toolUseId?: string): boolean => {
  const input = turn.launch.input;
  const requestId = input?.takeInterrupt() ?? null;
  if (requestId === null || !input) return false;
  turn.cut = { requestId, ...(toolUseId && { toolUseId }), stillQueued: input.waitingUuids() };
  return true;
};

const toolUseIdOf = (lines: JsonLine[]): string | undefined => {
  for (const line of lines) {
    const content = (
      line.message as { content?: Array<{ type?: string; id?: string }> } | undefined
    )?.content;
    const call = content?.find((block) => block.type === "tool_use");
    if (call?.id) return call.id;
  }
  return undefined;
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
const takeSteers = ({ dialect, input }: Launch, ctx: TurnContext): JsonLine[] =>
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
    beat: Exclude<PlannedBeat, { kind: "hold" }>,
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
