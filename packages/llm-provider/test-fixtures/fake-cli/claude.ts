import { parseArgv } from "./argv";
import {
  AOP_MCP_SERVER,
  type AskUser,
  type Beat,
  type Dialect,
  type Ending,
  type Invocation,
  type JsonLine,
  type TokenUsage,
  type TurnContext,
  type UserLine,
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
  readsStdin: (args) => parseArgv(args, ARGV_SPEC).values.get("--input-format") === "stream-json",
  readLine: readStreamJsonLine,
  replay: (message, ctx) => (ctx.replayUserMessages ? [replayOf(message, ctx)] : []),
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
    ...(ctx.usageWarning ? [usageWarning(ctx)] : []),
  ],
  beat: renderBeat,
  end: renderEnding,
};

// What a real Max login writes on an ordinary run, recorded from Claude Code 2.1.285 by the
// real-runtime harness: a warning event, not a limit. `status` is `allowed_warning` once a window
// passes a threshold (here 75% of the week), and `rejected` only when the plan refuses the run.
// There is no `overageStatus` on it.
function usageWarning(ctx: TurnContext): JsonLine {
  const now = Math.round(Date.now() / 1000);
  return {
    type: "rate_limit_event",
    rate_limit_info: {
      status: "allowed_warning",
      resetsAt: now + 7 * 24 * 3600,
      rateLimitType: "seven_day",
      utilization: 0.86,
      isUsingOverage: false,
      surpassedThreshold: 0.75,
      unifiedWindows: {
        five_hour: { utilization: 0.06, resetsAt: now + 5 * 3600 },
        seven_day: { utilization: 0.86, resetsAt: now + 7 * 24 * 3600 },
      },
    },
    session_id: ctx.sessionId,
  };
}

const ARGV_SPEC = {
  valueFlags: [
    "--output-format",
    "--input-format",
    "--setting-sources",
    "--permission-mode",
    "--resume",
    "--settings",
    "--model",
    "--effort",
    "--append-system-prompt",
    "--system-prompt-snapshot",
  ],
  // The real parser treats these as `<values...>`, so each one swallows a prompt placed after it.
  variadicFlags: ["--mcp-config", "--disallowedTools", "--add-dir", "--allowedTools", "--tools"],
};

function parseInvocation(args: string[], firstLine?: string): Invocation {
  const { flags, values, variadicValues, positionals } = parseArgv(args, ARGV_SPEC);
  const streamed =
    values.get("--input-format") === "stream-json" ? readStreamJsonLine(firstLine ?? "") : null;
  return {
    ...(streamed ?? { prompt: positionals[0] ?? "" }),
    resumeId: values.get("--resume"),
    model: values.get("--model"),
    effort: values.get("--effort"),
    flags,
    appendSystemPrompt: values.get("--append-system-prompt"),
    recordSystemPrompt: values.get("--system-prompt-snapshot") !== "off",
    mcpServers: readMcpServers(variadicValues.get("--mcp-config") ?? []),
  };
}

// A stream-json user line: its text blocks are the prompt, its image blocks what the reply
// reports, and its `uuid` what its echo carries.
function readStreamJsonLine(line: string): UserLine {
  let content: unknown[] = [];
  let uuid: string | undefined;
  try {
    const parsed = JSON.parse(line) as { uuid?: unknown; message?: { content?: unknown } } | null;
    content = Array.isArray(parsed?.message?.content) ? parsed.message.content : [];
    uuid = typeof parsed?.uuid === "string" ? parsed.uuid : undefined;
  } catch {
    // A line that is not JSON gives no prompt, and the run says so.
  }
  const blocks = content as Array<{
    type?: string;
    text?: string;
    source?: Record<string, string>;
  }>;
  return {
    prompt: blocks.flatMap((block) => (block.type === "text" ? [block.text ?? ""] : [])).join("\n"),
    ...(uuid && { uuid }),
    images: blocks.flatMap((block) =>
      block.type === "image" && block.source
        ? [
            {
              mediaType: block.source.media_type ?? "",
              bytes: Buffer.from(block.source.data ?? "", "base64").length,
            },
          ]
        : [],
    ),
  };
}

// `--mcp-config` takes JSON strings (or file paths, which the fake does not follow). Only HTTP
// servers are imitated.
function readMcpServers(configs: string[]): Invocation["mcpServers"] {
  const servers: Invocation["mcpServers"] = {};
  for (const config of configs) {
    for (const [name, server] of Object.entries(parseMcpServers(config))) {
      const { type, url } = server as { type?: unknown; url?: unknown };
      if (type === "http" && typeof url === "string") servers[name] = { url };
    }
  }
  return servers;
}

function parseMcpServers(config: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(config) as { mcpServers?: Record<string, unknown> } | null;
    return parsed?.mcpServers && typeof parsed.mcpServers === "object" ? parsed.mcpServers : {};
  } catch {
    return {};
  }
}

// Claude Code 2.1.287 echoes a line it took as a user message flagged `isReplay`, with the
// line's own `uuid`, where the model got it: first the prompt, then each message sent meanwhile.
function replayOf(message: UserLine, ctx: TurnContext): JsonLine {
  return {
    type: "user",
    message: { role: "user", content: [{ type: "text", text: message.prompt }] },
    session_id: ctx.sessionId,
    parent_tool_use_id: null,
    uuid: message.uuid ?? `fake-${ctx.turn}-${(ctx.steers ?? []).length}`,
    isReplay: true,
  };
}

function renderBeat(beat: Beat, index: number, ctx: TurnContext): JsonLine[] {
  const toolUseId = `toolu_fake_${ctx.turn}_${index}`;
  switch (beat.kind) {
    case "text":
      return block(ctx, { type: "text", text: beat.text });
    case "thinking":
      return block(ctx, { type: "thinking", thinking: beat.text, signature: "fake" });
    case "shell":
      return toolRound(ctx, toolUseId, "Bash", { command: beat.command }, beat.output, false);
    case "ask":
      return renderAsk(ctx, toolUseId, beat.ask);
    case "mcp": {
      const name = `mcp__${AOP_MCP_SERVER}__${beat.call.name}`;
      const { text, isError } = beat.result;
      return toolRound(
        ctx,
        toolUseId,
        name,
        beat.call.arguments,
        [{ type: "text", text }],
        isError,
      );
    }
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
  const name = ask.tool.startsWith("mcp__") ? ask.tool : `mcp__${AOP_MCP_SERVER}__${ask.tool}`;
  const input = { question: ask.question, options: ask.options };
  return toolRound(
    ctx,
    toolUseId,
    name,
    input,
    [{ type: "text", text: "Question sent. Wait for the user's answer." }],
    false,
  );
}

function toolRound(
  ctx: TurnContext,
  toolUseId: string,
  name: string,
  input: Record<string, unknown>,
  output: string | JsonLine[],
  isError: boolean,
): JsonLine[] {
  return [
    ...block(ctx, { type: "tool_use", id: toolUseId, name, input }),
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
        ...block(ctx, { type: "text", text: ending.text }),
        result(ctx, {
          subtype: "success",
          is_error: false,
          result: ending.text,
          // Present on a real success, recorded from Claude Code 2.1.285.
          api_error_status: null,
          permission_denials: [],
          stop_reason: "end_turn",
          terminal_reason: "completed",
        }),
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
    case "rate-limit":
      return renderRateLimit(ending.resetsInSeconds, ctx);
    case "silent":
      return [];
  }
}

// A usage limit as Claude Code documents it (code.claude.com/docs/en/errors, and the Agent SDK's
// SDKRateLimitEvent, SDKAssistantMessageError and SDKResultMessage.api_error_status): a
// `rate_limit_event` whose `resetsAt` is epoch seconds, an assistant message flagged
// `error: "rate_limit"` that holds the user-facing text, and an error result with HTTP status 429.
// No token is consumed. The real exit code is not verified; `exit=` sets it.
function renderRateLimit(resetsInSeconds: number, ctx: TurnContext): JsonLine[] {
  const resetsAt = Math.round(Date.now() / 1000) + resetsInSeconds;
  const text = `You've hit your session limit · resets ${clockTime(resetsAt)}`;
  const none = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  const limited = { ...ctx, usage: none, processUsage: none };
  return [
    {
      type: "rate_limit_event",
      rate_limit_info: {
        status: "rejected",
        resetsAt,
        rateLimitType: "five_hour",
        overageStatus: "rejected",
        isUsingOverage: false,
      },
      session_id: ctx.sessionId,
    },
    { ...assistant(limited, [{ type: "text", text }]), error: "rate_limit" },
    result(limited, { subtype: "success", is_error: true, api_error_status: 429, result: text }),
  ];
}

// Claude Code prints the reset as a wall-clock time without a zone, like "3:45pm".
function clockTime(epochSeconds: number): string {
  const at = new Date(epochSeconds * 1000);
  const hours = at.getHours() % 12 || 12;
  const minutes = String(at.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}${at.getHours() < 12 ? "am" : "pm"}`;
}

/**
 * One content block of the model's output. With partial messages Claude Code streams it first,
 * the way 2.1.286 does: the block opens, grows in deltas, its finished copy arrives as an
 * assistant event, and then it closes.
 */
function block(ctx: TurnContext, content: JsonLine): JsonLine[] {
  const finished = assistant(ctx, [content]);
  if (!ctx.partialMessages) return [finished];
  return [
    streamEvent(ctx, { type: "message_start", message: { id: `msg_fake_${ctx.turn}` } }),
    streamEvent(ctx, { type: "content_block_start", index: 0, content_block: emptied(content) }),
    ...deltasOf(content).map((delta) =>
      streamEvent(ctx, { type: "content_block_delta", index: 0, delta }),
    ),
    finished,
    streamEvent(ctx, { type: "content_block_stop", index: 0 }),
  ];
}

const emptied = (content: JsonLine): JsonLine => {
  if (content.type === "text") return { type: "text", text: "" };
  if (content.type === "thinking") return { type: "thinking", thinking: "", signature: "" };
  return { ...content, input: {} };
};

// A few words at a time, as tokens arrive; a tool's input as one piece of JSON.
const deltasOf = (content: JsonLine): JsonLine[] => {
  if (content.type === "tool_use") {
    return [{ type: "input_json_delta", partial_json: JSON.stringify(content.input) }];
  }
  const isText = content.type === "text";
  const whole = String(isText ? content.text : content.thinking);
  return chunksOf(whole).map((piece) =>
    isText ? { type: "text_delta", text: piece } : { type: "thinking_delta", thinking: piece },
  );
};

const chunksOf = (text: string): string[] => {
  const words = text.match(/\s*\S+/g) ?? [text];
  const chunks: string[] = [];
  for (let at = 0; at < words.length; at += 2) chunks.push(words.slice(at, at + 2).join(""));
  const tail = text.slice(chunks.join("").length);
  if (tail) chunks.push(tail);
  return chunks;
};

const streamEvent = (ctx: TurnContext, event: JsonLine): JsonLine => ({
  type: "stream_event",
  event,
  session_id: ctx.sessionId,
  parent_tool_use_id: null,
});

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

// `usage` is the turn's own; `modelUsage` and the cost add up every turn of the process so far,
// as Claude Code 2.1.287 reports a process that took a message after its first answer.
const result = (ctx: TurnContext, fields: JsonLine): JsonLine => {
  const processUsage = ctx.processUsage ?? ctx.usage;
  const costUsd = costOf(processUsage);
  return {
    type: "result",
    duration_ms: 1,
    num_turns: ctx.turn,
    session_id: ctx.sessionId,
    result_index: ctx.resultIndex ?? 0,
    total_cost_usd: costUsd,
    usage: messageUsage(ctx.usage),
    // Claude Code's breakdown per model, keyed by model id, in camelCase.
    modelUsage: {
      [ctx.model ?? DEFAULT_MODEL]: {
        inputTokens: processUsage.input,
        outputTokens: processUsage.output,
        cacheReadInputTokens: processUsage.cacheRead,
        cacheCreationInputTokens: processUsage.cacheWrite,
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
