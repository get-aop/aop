import { parseArgv } from "./argv";
import type {
  AskUser,
  Beat,
  Dialect,
  Ending,
  Invocation,
  JsonLine,
  TokenUsage,
  TurnContext,
} from "./types";

const DEFAULT_MODEL = "fake-claude";
const NATIVE_ASK_TOOL = "AskUserQuestion";
// USD per million tokens (Claude Opus list prices), so a fake turn has a cost that tests can
// recompute from the token counts.
const PRICE_PER_MILLION = { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 };

/**
 * Claude Code as `ClaudeCodeProvider` drives it: `claude --output-format
 * stream-json --verbose [flags] <prompt>`, one `session_id` on every event,
 * `--resume <id>` to continue.
 */
export const claudeDialect: Dialect = {
  name: "claude",
  matches: (args) => args.includes("--output-format"),
  parse: parseInvocation,
  start: (ctx) => [
    {
      type: "system",
      subtype: "init",
      cwd: ctx.cwd,
      session_id: ctx.sessionId,
      tools: ["Bash"],
      mcp_servers: [],
      model: ctx.model ?? DEFAULT_MODEL,
      permissionMode: "default",
      apiKeySource: "none",
    },
  ],
  beat: renderBeat,
  end: renderEnding,
};

function parseInvocation(args: string[]): Invocation {
  const { values, positionals } = parseArgv(args, {
    valueFlags: [
      "--output-format",
      "--setting-sources",
      "--permission-mode",
      "--resume",
      "--settings",
      "--mcp-config",
      "--model",
      "--effort",
    ],
    variadicFlags: ["--disallowedTools", "--add-dir"],
  });
  return {
    prompt: positionals[0] ?? "",
    resumeId: values.get("--resume"),
    model: values.get("--model"),
  };
}

function renderBeat(beat: Beat, index: number, ctx: TurnContext): JsonLine[] {
  const toolUseId = `toolu_fake_${ctx.turn}_${index}`;
  switch (beat.kind) {
    case "text":
      return [assistant(ctx, [{ type: "text", text: beat.text }])];
    case "shell":
      return toolRound(ctx, toolUseId, "Bash", { command: beat.command }, beat.output, false);
    case "ask":
      return renderAsk(ctx, toolUseId, beat.ask);
  }
}

// Native AskUserQuestion has no answer channel under `claude` without a TTY, so the
// CLI reports an error result; an MCP question tool (the aop_ask_user plan) succeeds
// and leaves the wait to the caller.
function renderAsk(ctx: TurnContext, toolUseId: string, ask: AskUser): JsonLine[] {
  if (ask.tool === NATIVE_ASK_TOOL) {
    const questions = [
      {
        question: ask.question,
        header: "Question",
        multiSelect: false,
        options: ask.options.map((label) => ({ label, description: label })),
      },
    ];
    return toolRound(ctx, toolUseId, NATIVE_ASK_TOOL, { questions }, "Answer questions?", true);
  }
  const name = ask.tool.startsWith("mcp__") ? ask.tool : `mcp__aop__${ask.tool}`;
  const input = { question: ask.question, options: ask.options };
  return toolRound(
    ctx,
    toolUseId,
    name,
    input,
    "Question sent. Wait for the user's answer.",
    false,
  );
}

function toolRound(
  ctx: TurnContext,
  toolUseId: string,
  name: string,
  input: Record<string, unknown>,
  output: string,
  isError: boolean,
): JsonLine[] {
  return [
    assistant(ctx, [{ type: "tool_use", id: toolUseId, name, input }]),
    {
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: toolUseId, content: output, is_error: isError },
        ],
      },
      session_id: ctx.sessionId,
    },
  ];
}

function renderEnding(ending: Ending, ctx: TurnContext): JsonLine[] {
  switch (ending.kind) {
    case "success":
      return [
        assistant(ctx, [{ type: "text", text: ending.text }]),
        result(ctx, { subtype: "success", is_error: false, result: ending.text }),
      ];
    case "failure":
      // Real Claude Code reports failures as `error_*` result subtypes carrying `errors`.
      return [
        result(ctx, {
          subtype: "error_during_execution",
          is_error: true,
          errors: [ending.message],
        }),
      ];
    case "silent":
      return [];
  }
}

const assistant = (ctx: TurnContext, content: JsonLine[]): JsonLine => ({
  type: "assistant",
  message: {
    id: `msg_fake_${ctx.turn}`,
    type: "message",
    role: "assistant",
    model: ctx.model ?? DEFAULT_MODEL,
    content,
    stop_reason: null,
    // Every assistant event of a turn shares one message id, so a reader that keeps the last
    // usage per id sees the turn's usage once, also when the turn dies before its result.
    usage: messageUsage(ctx.usage),
  },
  session_id: ctx.sessionId,
});

const result = (ctx: TurnContext, fields: JsonLine): JsonLine => {
  const costUsd = costOf(ctx.usage);
  return {
    type: "result",
    duration_ms: 1,
    num_turns: ctx.turn,
    session_id: ctx.sessionId,
    total_cost_usd: costUsd,
    usage: messageUsage(ctx.usage),
    // Claude Code's breakdown per model, keyed by model id, in camelCase.
    modelUsage: {
      [ctx.model ?? DEFAULT_MODEL]: {
        inputTokens: ctx.usage.input,
        outputTokens: ctx.usage.output,
        cacheReadInputTokens: ctx.usage.cacheRead,
        cacheCreationInputTokens: ctx.usage.cacheWrite,
        webSearchRequests: 0,
        costUSD: costUsd,
      },
    },
    ...fields,
  };
};

const messageUsage = (usage: TokenUsage): JsonLine => ({
  input_tokens: usage.input,
  output_tokens: usage.output,
  cache_creation_input_tokens: usage.cacheWrite,
  cache_read_input_tokens: usage.cacheRead,
});

const costOf = (usage: TokenUsage): number => {
  const dollars =
    (usage.input * PRICE_PER_MILLION.input +
      usage.output * PRICE_PER_MILLION.output +
      usage.cacheWrite * PRICE_PER_MILLION.cacheWrite +
      usage.cacheRead * PRICE_PER_MILLION.cacheRead) /
    1_000_000;
  return Math.round(dollars * 1_000_000) / 1_000_000;
};
