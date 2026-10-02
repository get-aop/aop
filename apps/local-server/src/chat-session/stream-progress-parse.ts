/** Provider-agnostic JSONL → stream chunks. */

import { formatToolInput, replayedUuid } from "@aop/llm-provider";

type StreamedBlock = "text" | "thinking";

export type ProgressChunk =
  /**
   * `whole` marks a finished content block of a Claude assistant message, which partial
   * messages may already have streamed; `final` marks the run's closing result text.
   */
  | { kind: "thought"; data: string; whole?: true }
  | { kind: "text"; data: string; whole?: true; final?: true }
  /** Claude partial messages (`stream_event`): a new message, its blocks opening, growing, closing. */
  | { kind: "stream-message" }
  | {
      kind: "stream-start";
      index: number;
      block: StreamedBlock | "tool";
      toolId?: string;
      toolName?: string;
    }
  | { kind: "stream-delta"; index: number; block: StreamedBlock; data: string }
  | { kind: "stream-stop"; index: number }
  | {
      kind: "command";
      phase: "start" | "update" | "done";
      command: string;
      itemId?: string;
      detail?: string;
      exitCode?: number | null;
    }
  | {
      kind: "tool";
      phase: "start" | "update" | "done";
      name: string;
      itemId?: string;
      detail?: string;
      failed?: boolean;
    }
  /** Claude echoed a user message where the model took it (`--replay-user-messages`). */
  | { kind: "user-message"; uuid: string };

/**
 * Parse one JSONL line from a chat runtime log into a progressive chunk.
 *
 * Runtimes differ:
 * - Codex: `item.started` / `item.completed` (tools + agent_message)
 * - Claude: `assistant` messages with thinking/text/tool_use blocks
 * - Pi: message_update thinking_end/text_end and content blocks
 */
export const parseStreamProgressLine = (line: string): ProgressChunk | null =>
  parseStreamProgressLines(line)[0] ?? null;

export const parseStreamProgressLines = (line: string): ProgressChunk[] => {
  const trimmed = line.trim();
  if (!trimmed) return [];

  try {
    return extractProgressChunks(JSON.parse(trimmed) as Record<string, unknown>);
  } catch {
    return [];
  }
};

const extractProgressChunks = (event: Record<string, unknown>): ProgressChunk[] => {
  // A subagent's own messages belong to the Agent call that started it, which shows its progress.
  if (typeof event.parent_tool_use_id === "string") return [];
  const claudeChunks = extractClaudeMessage(event);
  if (claudeChunks.length > 0) return claudeChunks;

  const chunk =
    extractClaudeStreamEvent(event) ??
    extractClaudeTaskLifecycle(event) ??
    extractCodexItem(event) ??
    extractPiToolExecution(event) ??
    extractPiUpdate(event) ??
    extractPiMessage(event) ??
    extractResultText(event);
  return chunk ? [chunk] : [];
};

/** Claude `--include-partial-messages`: the Anthropic stream events, one per line. */
const extractClaudeStreamEvent = (event: Record<string, unknown>): ProgressChunk | null => {
  if (stringType(event) !== "stream_event" || !isRecord(event.event)) return null;
  const inner = event.event;
  const index = typeof inner.index === "number" ? inner.index : -1;
  switch (stringType(inner)) {
    case "message_start":
      return { kind: "stream-message" };
    case "content_block_start":
      return isRecord(inner.content_block) ? streamStart(index, inner.content_block) : null;
    case "content_block_delta":
      return isRecord(inner.delta) ? streamDelta(index, inner.delta) : null;
    case "content_block_stop":
      return { kind: "stream-stop", index };
    default:
      return null;
  }
};

const streamStart = (index: number, block: Record<string, unknown>): ProgressChunk | null => {
  const type = stringType(block);
  if (type === "text") return { kind: "stream-start", index, block: "text" };
  if (type === "thinking") return { kind: "stream-start", index, block: "thinking" };
  if (type !== "tool_use" || typeof block.id !== "string") return null;
  const toolName = humanizeToolName(String(block.name ?? "Tool"));
  return { kind: "stream-start", index, block: "tool", toolId: block.id, toolName };
};

const streamDelta = (index: number, delta: Record<string, unknown>): ProgressChunk | null => {
  const type = stringType(delta);
  if (type === "text_delta" && typeof delta.text === "string" && delta.text) {
    return { kind: "stream-delta", index, block: "text", data: delta.text };
  }
  if (type === "thinking_delta" && typeof delta.thinking === "string" && delta.thinking) {
    return { kind: "stream-delta", index, block: "thinking", data: delta.thinking };
  }
  // Tool input arrives whole with the finished block; signatures are not for people.
  return null;
};

/** CC Personal emits native task lifecycle records alongside generic Agent tool calls. */
const extractClaudeTaskLifecycle = (event: Record<string, unknown>): ProgressChunk | null => {
  if (stringType(event) !== "system") return null;
  const subtype = typeof event.subtype === "string" ? event.subtype : "";
  if (subtype === "task_started") return claudeTaskStart(event);
  if (subtype === "task_progress") return claudeTaskProgress(event);
  if (subtype === "task_notification") return claudeTaskTerminal(event);
  return null;
};

const claudeTaskStart = (event: Record<string, unknown>): ProgressChunk => {
  const description = stringField(event, "description");
  return {
    kind: "tool",
    phase: "start",
    name: "Agent",
    itemId: claudeTaskItemId(event),
    ...(description ? { detail: description } : {}),
  };
};

const claudeTaskProgress = (event: Record<string, unknown>): ProgressChunk => {
  const description = stringField(event, "description");
  return {
    kind: "tool",
    phase: "update",
    name: "Agent",
    itemId: claudeTaskItemId(event),
    ...(description ? { detail: description } : {}),
  };
};

const claudeTaskTerminal = (event: Record<string, unknown>): ProgressChunk => {
  const summary = stringField(event, "summary");
  return {
    kind: "tool",
    phase: "done",
    name: "Agent",
    itemId: claudeTaskItemId(event),
    ...(summary ? { detail: summary } : {}),
    failed: stringField(event, "status") === "failed",
  };
};

const claudeTaskItemId = (event: Record<string, unknown>): string | undefined =>
  stringField(event, "tool_use_id") || stringField(event, "task_id") || undefined;

const stringField = (event: Record<string, unknown>, key: string): string => {
  const value = event[key];
  return typeof value === "string" ? value.trim() : "";
};

const CODEX_ITEM_EVENTS = new Set(["item.started", "item.completed", "item.updated"]);

/** Codex exec --json item lifecycle (tools + final agent messages). */
const extractCodexItem = (event: Record<string, unknown>): ProgressChunk | null => {
  if (!CODEX_ITEM_EVENTS.has(stringType(event)) || !isRecord(event.item)) return null;
  return mapCodexItem(stringType(event), event.item);
};

const mapCodexItem = (eventType: string, item: Record<string, unknown>): ProgressChunk | null => {
  const itemType = typeof item.type === "string" ? item.type : "";
  if (itemType === "agent_message") return codexAgentMessage(item);
  if (itemType === "command_execution") return formatCommandProgress(eventType, item);
  if (itemType === "error") return codexErrorThought(item);
  if (!itemType) return null;
  return codexGenericTool(eventType, itemType);
};

const codexAgentMessage = (item: Record<string, unknown>): ProgressChunk | null => {
  if (typeof item.text !== "string" || !item.text.trim()) return null;
  return { kind: "text", data: item.text };
};

const codexErrorThought = (item: Record<string, unknown>): ProgressChunk | null => {
  const message = typeof item.message === "string" ? item.message : "error";
  // Unstable-feature notices are noise for chat UX.
  if (message.includes("Under-development features")) return null;
  return { kind: "thought", data: message };
};

const codexGenericTool = (eventType: string, itemType: string): ProgressChunk | null => {
  const name = humanizeToolName(itemType);
  if (eventType === "item.started") return { kind: "tool", phase: "start", name };
  if (eventType === "item.completed") return { kind: "tool", phase: "done", name };
  return null;
};

const formatCommandProgress = (
  eventType: string,
  item: Record<string, unknown>,
): ProgressChunk | null => {
  const command = shortenCommand(typeof item.command === "string" ? item.command : "command");
  const itemId = typeof item.id === "string" ? item.id : undefined;
  if (eventType === "item.started" || item.status === "in_progress") {
    return { kind: "command", phase: "start", command, itemId };
  }
  if (eventType !== "item.completed") return null;
  const exitCode = typeof item.exit_code === "number" ? item.exit_code : null;
  return { kind: "command", phase: "done", command, itemId, exitCode };
};

const extractClaudeMessage = (event: Record<string, unknown>): ProgressChunk[] => {
  const type = stringType(event);
  if ((type !== "assistant" && type !== "user") || !isRecord(event.message)) return [];
  if (type === "assistant") return extractContentChunks(event.message.content);
  const replayed = replayedUuid(event);
  if (replayed) return [{ kind: "user-message", uuid: replayed }];
  return extractClaudeToolResults(event.message.content);
};

const extractClaudeToolResults = (content: unknown): ProgressChunk[] => {
  if (!Array.isArray(content)) return [];
  return content.flatMap((block): ProgressChunk[] => {
    if (!isRecord(block) || block.type !== "tool_result") return [];
    const itemId = typeof block.tool_use_id === "string" ? block.tool_use_id : undefined;
    if (!itemId) return [];
    return [{ kind: "tool", phase: "done", name: "Tool", itemId, failed: block.is_error === true }];
  });
};

const isShellToolName = (tool: string): boolean => {
  const t = tool.toLowerCase().replace(/[_-]+/g, "");
  return (
    t === "bash" ||
    t === "shell" ||
    t === "sh" ||
    t === "zsh" ||
    t === "terminal" ||
    t === "execcommand" ||
    t === "runterminalcmd"
  );
};

const extractPiUpdate = (event: Record<string, unknown>): ProgressChunk | null => {
  if (stringType(event) !== "message_update" || !isRecord(event.assistantMessageEvent)) return null;
  const update = event.assistantMessageEvent;
  // Prefer *_end blocks. PI also emits thinking_delta/text_delta; those are ignored
  // for now because *_end already carries the full block and mixing both duplicates.
  if (update.type === "thinking_end" && typeof update.content === "string" && update.content) {
    return { kind: "thought", data: update.content };
  }
  if (update.type === "text_end" && typeof update.content === "string" && update.content) {
    return { kind: "text", data: update.content };
  }
  return null;
};

/** Pi coding agent tool lifecycle. */
const extractPiToolExecution = (event: Record<string, unknown>): ProgressChunk | null => {
  const type = stringType(event);
  if (type !== "tool_execution_start" && type !== "tool_execution_end") return null;

  const rawTool = String(event.toolName ?? event.tool_name ?? "Tool");
  const label = piToolLabel(rawTool, event);
  const itemId = readPiToolCallId(event);
  const shell = isShellToolName(rawTool);
  if (type === "tool_execution_start") {
    return shell
      ? { kind: "command", phase: "start", command: label, itemId }
      : { kind: "tool", phase: "start", name: label };
  }

  const failed = event.isError === true || event.error != null;
  return shell
    ? { kind: "command", phase: "done", command: label, itemId, exitCode: failed ? 1 : 0 }
    : { kind: "tool", phase: "done", name: label, failed };
};

const readPiToolCallId = (event: Record<string, unknown>): string | undefined => {
  const id = event.toolCallId ?? event.tool_call_id;
  return typeof id === "string" && id.trim() ? id : undefined;
};

const piToolLabel = (rawTool: string, event: Record<string, unknown>): string => {
  const toolName = humanizeToolName(rawTool);
  const input = readPiToolInput(event);
  const shellCommand = readShellCommand(input);
  if (shellCommand) return shortenCommand(shellCommand);
  if (typeof input.path === "string") return `${toolName} ${input.path}`;
  return toolName;
};

/** PI uses `cmd`; Claude/Codex-style adapters often use `command`. */
const readShellCommand = (input: Record<string, unknown>): string | null => {
  if (typeof input.command === "string" && input.command.trim()) return input.command.trim();
  if (typeof input.cmd === "string" && input.cmd.trim()) return input.cmd.trim();
  return null;
};

const readPiToolInput = (event: Record<string, unknown>): Record<string, unknown> => {
  if (isRecord(event.args)) return event.args;
  if (isRecord(event.input)) return event.input;
  if (isRecord(event.arguments)) return event.arguments;
  return {};
};

const PI_MESSAGE_EVENTS = new Set(["message_end", "agent_end", "turn_end"]);

const extractPiMessage = (event: Record<string, unknown>): ProgressChunk | null => {
  if (!PI_MESSAGE_EVENTS.has(stringType(event))) return null;
  // PI emits message_end for many roles:
  // - user: full runtime prompt (platform instructions, ## Attached Images paths)
  // - toolResult: raw command output dumps (often multi-KB)
  // Only assistant-role messages belong in the live answer stream; otherwise the
  // UI flashes those blobs under Thinking until the final reply replaces them.
  // Thinking blocks are excluded too: message_update thinking_end already streams
  // them, and message_end/turn_end/agent_end re-carry the full message, so emitting
  // them again would duplicate the Thinking panel content.
  if (isRecord(event.message) && event.message.role === "assistant") {
    const fromMessage = extractFirstTextBlock(event.message.content);
    if (fromMessage) return fromMessage;
  }
  return extractFromPiMessagesArray(event.messages);
};

const extractFromPiMessagesArray = (messages: unknown): ProgressChunk | null => {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!isRecord(msg) || msg.role !== "assistant") continue;
    const fromMessage = extractFirstTextBlock(msg.content);
    if (fromMessage) return fromMessage;
  }
  return null;
};

const extractResultText = (event: Record<string, unknown>): ProgressChunk | null => {
  if (stringType(event) !== "result") return null;
  const subtype = String(event.subtype ?? "").toLowerCase();
  if (subtype && subtype !== "success" && subtype !== "completed") return null;
  if (typeof event.result === "string" && event.result.trim()) {
    return { kind: "text", data: event.result, final: true };
  }
  return null;
};

/** First text block in provider order; skips thinking blocks streamed via thinking_end. */
const extractFirstTextBlock = (content: unknown): ProgressChunk | null => {
  if (!Array.isArray(content)) return null;
  for (const block of content) {
    if (!isRecord(block) || block.type !== "text") continue;
    if (typeof block.text === "string" && block.text.trim()) {
      return { kind: "text", data: block.text };
    }
  }
  return null;
};

const extractContentChunks = (content: unknown): ProgressChunk[] =>
  Array.isArray(content) ? content.flatMap(classifyProgressContentBlock) : [];

const classifyProgressContentBlock = (block: unknown): ProgressChunk[] => {
  if (!isRecord(block)) return [];
  if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim()) {
    return [{ kind: "thought", data: block.thinking, whole: true }];
  }
  if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
    return [{ kind: "text", data: block.text, whole: true }];
  }
  return block.type === "tool_use" ? [claudeToolChunk(block)] : [];
};

const claudeToolChunk = (block: Record<string, unknown>): ProgressChunk => {
  const rawName = String(block.name ?? "Tool");
  const input = isRecord(block.input) ? block.input : {};
  const detail = formatToolInput(rawName, input);
  return {
    kind: "tool",
    phase: "start",
    name: humanizeToolName(rawName),
    ...(typeof block.id === "string" && block.id ? { itemId: block.id } : {}),
    ...(detail && detail !== "{}" ? { detail } : {}),
  };
};

const stringType = (event: Record<string, unknown>): string =>
  typeof event.type === "string" ? event.type : "";

/** How a tool is named in a turn's parts: `mcp__aop__aop_ask_user` is "mcp aop aop ask user". */
export const humanizeToolName = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) return "Tool";
  return trimmed
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const shortenCommand = (command: string): string => {
  const cleaned = command.replace(/^\/bin\/(?:ba|z)?sh\s+-lc\s+/, "").replace(/^["']|["']$/g, "");
  if (cleaned.length <= 80) return cleaned;
  return `${cleaned.slice(0, 77)}…`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
