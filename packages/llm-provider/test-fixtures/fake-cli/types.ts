/** One JSONL record on stdout. */
export type JsonLine = Record<string, unknown>;

export interface AskUser {
  question: string;
  options: string[];
  tool: string;
}

/** A CLI-neutral step in a scripted turn; each dialect renders it in its own event shape. */
export type Beat =
  | { kind: "text"; text: string }
  | { kind: "shell"; command: string; output: string }
  | { kind: "ask"; ask: AskUser };

export type Ending =
  | { kind: "success"; text: string }
  | { kind: "failure"; message: string }
  /** The CLI dies without a terminal event; only the exit code says what happened. */
  | { kind: "silent" };

export interface TurnContext {
  sessionId: string;
  cwd: string;
  model?: string;
  prompt: string;
  turn: number;
  resumed: boolean;
}

/** What the adapter asked the CLI to do, recovered from argv. */
export interface Invocation {
  prompt: string;
  resumeId?: string;
  model?: string;
}

/**
 * Everything that differs between the CLIs the fake can imitate. Adding a
 * dialect means adding one module that implements this and listing it in
 * `run.ts`; nothing else changes.
 */
export interface Dialect {
  name: string;
  /** Recognises the argv shape the matching adapter builds. */
  matches(args: string[]): boolean;
  parse(args: string[]): Invocation;
  start(ctx: TurnContext): JsonLine[];
  beat(beat: Beat, index: number, ctx: TurnContext): JsonLine[];
  end(ending: Ending, ctx: TurnContext): JsonLine[];
}
