import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeDialect } from "./claude";
import { type Directives, parseDirectives } from "./directives";
import { beginTurn } from "./session-store";
import { planTurn } from "./turn";
import type { Dialect, Ending, JsonLine, TurnContext } from "./types";

const DIALECTS: Dialect[] = [claudeDialect];
const USAGE_EXIT_CODE = 2;
const FAILURE_EXIT_CODE = 1;
// Only reachable when `Io.crash` returns (an in-process test); a real SIGKILL ends the process first.
const CRASHED_EXIT_CODE = 137;

export interface Runtime {
  args: string[];
  env: Record<string, string | undefined>;
  cwd: string;
}

export interface Io {
  /** Synchronous, so events already written survive a SIGKILL. */
  write(text: string): void;
  warn(text: string): void;
  sleep(ms: number): Promise<void>;
  /** SIGKILLs the process. Tests substitute a recorder. */
  crash(): void;
}

/** Plays one CLI turn and returns the exit code. See directives.ts for the scripting syntax. */
export const runFakeCli = async (runtime: Runtime, io: Io): Promise<number> => {
  const dialect = DIALECTS.find((candidate) => candidate.matches(runtime.args));
  if (!dialect) return abort(io, "fake-cli: unrecognised arguments", USAGE_EXIT_CODE);
  const invocation = dialect.parse(runtime.args);
  if (!invocation.prompt) return abort(io, "fake-cli: no prompt given", FAILURE_EXIT_CODE);

  const directives = parseDirectives(invocation.prompt, runtime.env.FAKE_CLI_SCRIPT);
  await io.sleep(directives.startupMs);

  const session = beginTurn(resolveHome(runtime.env), dialect.name, invocation.resumeId);
  if (!session) {
    const message = `No conversation found with session ID: ${invocation.resumeId}`;
    return abort(io, message, FAILURE_EXIT_CODE);
  }
  const ctx: TurnContext = {
    sessionId: session.id,
    cwd: runtime.cwd,
    model: invocation.model,
    usage: directives.usage,
    prompt: invocation.prompt,
    turn: session.turn,
    resumed: session.resumed,
  };
  const { beats, ending } = planTurn(directives, ctx);
  const lines = [
    ...dialect.start(ctx),
    ...beats.flatMap((beat, index) => dialect.beat(beat, index, ctx)),
    ...dialect.end(ending, ctx),
  ];

  if (await emit(lines, directives, io)) return CRASHED_EXIT_CODE;
  return exitCodeFor(ending, directives, io);
};

// Empty counts as unset: shells and process managers export blank variables.
const resolveHome = (env: Runtime["env"]): string =>
  env.FAKE_CLI_HOME || join(env.AOP_HOME || tmpdir(), "fake-cli");

const abort = (io: Io, message: string, exitCode: number): number => {
  io.warn(message);
  return exitCode;
};

/** Returns true when the script crashed the process mid-line. */
const emit = async (lines: JsonLine[], directives: Directives, io: Io): Promise<boolean> => {
  for (const [index, line] of lines.entries()) {
    if (index > 0 && directives.delayMs > 0) await io.sleep(directives.delayMs);
    const text = JSON.stringify(line);
    if (index === directives.crashAfter) {
      // The half-written line is what a process killed mid-write leaves in the log.
      io.write(text.slice(0, Math.ceil(text.length / 2)));
      io.crash();
      return true;
    }
    io.write(`${text}\n`);
  }
  return false;
};

const exitCodeFor = (ending: Ending, directives: Directives, io: Io): number => {
  if (ending.kind === "success") return 0;
  const exitCode = directives.exitCode ?? FAILURE_EXIT_CODE;
  io.warn(
    ending.kind === "failure"
      ? `fake-cli: ${ending.message}`
      : `fake-cli: exiting with status ${exitCode}`,
  );
  return exitCode;
};
