/** One JSONL record on stdout. */
export type JsonLine = Record<string, unknown>;

/** The name the adapter registers the AOP MCP server under, so its tools read `mcp__aop__<tool>`. */
export const AOP_MCP_SERVER = "aop";

export interface AskUser {
  question: string;
  options: string[];
  tool: string;
}

/** An MCP tool call the script has the model make. */
export interface McpCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** What the model sees back from a tool call. */
export interface McpResult {
  text: string;
  isError: boolean;
}

/** A connection to the AOP MCP server. Failures come back as error results, never as throws. */
export interface McpConnection {
  callTool(name: string, args: Record<string, unknown>): Promise<McpResult>;
}

/** A CLI-neutral step in a scripted turn; each dialect renders it in its own event shape. */
export type Beat =
  | { kind: "text"; text: string }
  | { kind: "shell"; command: string; output: string }
  | { kind: "ask"; ask: AskUser }
  /** An MCP tool call that has been carried out, with the result the model saw. */
  | { kind: "mcp"; call: McpCall; result: McpResult };

/** A step before it is carried out: an MCP call still has to reach the server. */
export type PlannedBeat = Exclude<Beat, { kind: "mcp" }> | { kind: "call"; call: McpCall };

export type Ending =
  | { kind: "success"; text: string }
  | { kind: "failure"; message: string }
  /** The CLI dies without a terminal event; only the exit code says what happened. */
  | { kind: "silent" };

/** The four token buckets every CLI's usage event maps onto. */
export interface TokenUsage {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export interface TurnContext {
  sessionId: string;
  cwd: string;
  model?: string;
  /** What the turn reports as consumed; the dialect renders it in its own event shape. */
  usage: TokenUsage;
  prompt: string;
  turn: number;
  resumed: boolean;
}

/** What the adapter asked the CLI to do, recovered from argv. */
export interface Invocation {
  prompt: string;
  resumeId?: string;
  model?: string;
  /** HTTP MCP servers from `--mcp-config`, by name. Other transports are not imitated. */
  mcpServers: Record<string, { url: string }>;
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
