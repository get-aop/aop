import {
  extractToolDescription,
  formatToolInput,
  getOpenCodeToolContext,
  normalizeToolName,
} from "./tools";
import type { NormalizedLogEvent, ParsedRawLogEntry, RawProviderEvent } from "./types";

interface ContentBlock {
  type: string;
  text?: string;
}

interface AssistantMessage {
  content?: ContentBlock[];
}

interface CodexItemMessage {
  type?: string;
  text?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === "object" && !Array.isArray(value);
};

const findNestedText = (
  source: Record<string, unknown>,
  keys: string[],
  depth: number,
): string | undefined => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  if (depth <= 0) return undefined;

  for (const nestedValue of Object.values(source)) {
    if (!isRecord(nestedValue)) continue;
    const found = findNestedText(nestedValue, keys, depth - 1);
    if (found) return found;
  }

  return undefined;
};

const toTextLines = (text: string): string[] => {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

const extractClaudeAssistantText = (event: RawProviderEvent): string[] => {
  if (event.type !== "assistant") return [];

  const message = event.message;
  if (typeof message === "string") return toTextLines(message);
  if (!isRecord(message)) return [];

  const assistant = message as AssistantMessage;
  return (assistant.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .flatMap((block) => toTextLines(block.text ?? ""));
};

const normalizeResultEvent = (
  provider: ParsedRawLogEntry["provider"],
  event: RawProviderEvent,
): NormalizedLogEvent[] => {
  if (event.type !== "result") return [];

  const subtype = typeof event.subtype === "string" ? event.subtype.toLowerCase() : "";
  const text = typeof event.result === "string" ? event.result : "";

  if (subtype === "success") {
    return [{ kind: "result_success", provider, text: text || undefined }];
  }

  if (subtype === "error" || subtype === "failure") {
    return [{ kind: "result_error", provider, text: text || "Unknown error" }];
  }

  return [];
};

const normalizeClaudeEvent = (entry: ParsedRawLogEntry): NormalizedLogEvent[] => {
  const { event, provider } = entry;

  const resultEvents = normalizeResultEvent(provider, event);
  if (resultEvents.length > 0) return resultEvents;

  if (event.type === "tool_use") {
    const toolName = normalizeToolName(String(event.tool_name ?? event.name ?? "Tool"));
    const input = isRecord(event.input) ? event.input : {};
    return [
      {
        kind: "tool_started",
        provider,
        toolName,
        primaryInput: formatToolInput(toolName, input),
        description: extractToolDescription(input),
      },
    ];
  }

  if (event.type === "result" && typeof event.result === "string") {
    return [{ kind: "result_success", provider, text: event.result }];
  }

  const textLines = extractClaudeAssistantText(event);
  if (textLines.length > 0) {
    return textLines.map((text) => ({ kind: "assistant_text", provider, text }));
  }

  return [{ kind: "noise", provider, reason: "claude-unhandled" }];
};

const normalizeCodexEvent = (entry: ParsedRawLogEntry): NormalizedLogEvent[] => {
  const { event, provider } = entry;

  if (
    event.type === "item.completed" &&
    isRecord(event.item) &&
    (event.item as CodexItemMessage).type === "agent_message" &&
    typeof (event.item as CodexItemMessage).text === "string"
  ) {
    return toTextLines((event.item as CodexItemMessage).text ?? "").map((text) => ({
      kind: "assistant_text",
      provider,
      text,
    }));
  }

  if (event.type === "turn.completed") {
    const message = event["last-assistant-message"];
    const assistantEvents: NormalizedLogEvent[] =
      typeof message === "string"
        ? toTextLines(message).map((text) => ({ kind: "assistant_text", provider, text }))
        : [];

    return [
      ...assistantEvents,
      {
        kind: "result_success",
        provider,
      },
    ];
  }

  if (event.type === "turn.failed" || event.type === "error") {
    return [
      {
        kind: "error",
        provider,
        text: failureMessage(event),
      },
    ];
  }

  return [{ kind: "noise", provider, reason: "codex-unhandled" }];
};

const OPEN_CODE_SUCCESS_STATUSES = ["completed", "complete", "done", "success"];
const OPEN_CODE_FAILURE_STATUSES = ["error", "failed", "failure"];

const normalizeOpenCodeToolEvent = (
  provider: ParsedRawLogEntry["provider"],
  tool: NonNullable<ReturnType<typeof getOpenCodeToolContext>>,
): NormalizedLogEvent[] => {
  const toolName = normalizeToolName(tool.toolName);
  const status = tool.status?.toLowerCase();

  if (status && OPEN_CODE_SUCCESS_STATUSES.includes(status)) {
    return [
      {
        kind: "tool_started",
        provider,
        toolName,
        primaryInput: formatToolInput(toolName, tool.input),
        description: tool.description,
      },
    ];
  }

  if (status && OPEN_CODE_FAILURE_STATUSES.includes(status)) {
    return [
      {
        kind: "tool_completed",
        provider,
        toolName,
        success: false,
        message: tool.message ?? `${toolName} failed`,
      },
    ];
  }

  return [
    {
      kind: "tool_started",
      provider,
      toolName,
      primaryInput: formatToolInput(toolName, tool.input),
      description: tool.description,
    },
  ];
};

const normalizeOpenCodeEvent = (entry: ParsedRawLogEntry): NormalizedLogEvent[] => {
  const { event, provider } = entry;

  if (event.type === "text" && isRecord(event.part) && typeof event.part.text === "string") {
    return toTextLines(event.part.text).map((text) => ({ kind: "assistant_text", provider, text }));
  }

  const tool = getOpenCodeToolContext(event);
  if (tool) return normalizeOpenCodeToolEvent(provider, tool);

  const resultEvents = normalizeResultEvent(provider, event);
  if (resultEvents.length > 0) return resultEvents;

  return [{ kind: "noise", provider, reason: "opencode-unhandled" }];
};

const normalizeGrokBuildEvent = (entry: ParsedRawLogEntry): NormalizedLogEvent[] => {
  const { event, provider } = entry;
  const text = extractGrokTextChunk(event);

  if (text.trim().length > 0) {
    return toTextLines(text).map((line) => ({ kind: "assistant_text", provider, text: line }));
  }

  const type = String(event.type ?? "unknown");
  return [{ kind: "noise", provider, reason: `grok-${type}` }];
};

const normalizePiRuntimeToolExecutionEvent = (entry: ParsedRawLogEntry): NormalizedLogEvent[] => {
  const { event, provider } = entry;
  const type = String(event.type ?? "");
  if (type !== "tool_execution_start" && type !== "tool_execution_end") return [];

  const toolName = normalizeToolName(String(event.toolName ?? event.tool_name ?? "Tool"));

  if (type === "tool_execution_start") {
    const input = getPiRuntimeToolInput(event);
    return [
      {
        kind: "tool_started",
        provider,
        toolName,
        primaryInput: formatPiRuntimeToolInput(toolName, input),
        description: extractToolDescription(input, event),
      },
    ];
  }

  const failed = event.isError === true || isFailureMarker(event);
  return [
    {
      kind: "tool_completed",
      provider,
      toolName,
      success: !failed,
      ...(failed ? { message: failureMessage(event) } : {}),
    },
  ];
};

const getPiRuntimeToolInput = (event: RawProviderEvent): Record<string, unknown> => {
  if (isRecord(event.args)) return event.args;
  if (isRecord(event.arguments)) return event.arguments;
  return {};
};

const formatPiRuntimeToolInput = (toolName: string, input: Record<string, unknown>): string => {
  const formatted = formatToolInput(toolName, input);
  if (formatted) return formatted;

  const fallback = findNestedText(input, ["path", "file_path", "command", "input", "query"], 2);
  return fallback ? fallback.replace(/\s+/g, " ").trim().slice(0, 200) : "";
};

export const normalizeRawEvent = (entry: ParsedRawLogEntry): NormalizedLogEvent[] => {
  if (entry.event.type === "aop_cli_prompt" && typeof entry.event.prompt === "string") {
    return [
      {
        kind: "assistant_text",
        provider: entry.provider,
        text: `[AOP -> CLI prompt]\n${entry.event.prompt}`,
      },
    ];
  }

  if (isFailureMarker(entry.event)) {
    return [
      {
        kind: "error",
        provider: entry.provider,
        text: failureMessage(entry.event),
      },
    ];
  }

  switch (entry.provider) {
    case "codex":
    case "codex-cli":
      return normalizeCodexEvent(entry);
    case "opencode":
      return normalizeOpenCodeEvent(entry);
    case "grok-build":
      return normalizeGrokBuildEvent(entry);
    case "openclaw":
      return normalizeClaudeEvent(entry);
    case "pi":
      return normalizePiRuntimeEvent(entry);
    case "claude-code":
      return normalizeClaudeEvent(entry);
    default:
      return normalizeClaudeEvent(entry);
  }
};

const normalizePiRuntimeEvent = (entry: ParsedRawLogEntry): NormalizedLogEvent[] => {
  const { event, provider } = entry;

  const toolExecutionEvents = normalizePiRuntimeToolExecutionEvent(entry);
  if (toolExecutionEvents.length > 0) return toolExecutionEvents;

  const text = extractPiAssistantMessageText(event);
  if (text) {
    return toTextLines(text).map((line) => ({ kind: "assistant_text", provider, text: line }));
  }

  if (event.type === "assistant") {
    return [{ kind: "noise", provider, reason: "pi-stream-fragment" }];
  }

  return normalizeClaudeEvent(entry);
};

export const normalizeRawEvents = (entries: ParsedRawLogEntry[]): NormalizedLogEvent[] => {
  const normalized: NormalizedLogEvent[] = [];
  let grokText = "";

  const flushGrokText = () => {
    if (grokText.trim().length > 0) {
      normalized.push(
        ...toTextLines(grokText).map((text) => ({
          kind: "assistant_text" as const,
          provider: "grok-build" as const,
          text,
        })),
      );
    }
    grokText = "";
  };

  for (const entry of entries) {
    if (
      entry.provider === "grok-build" &&
      entry.event.type === "text" &&
      typeof entry.event.data === "string"
    ) {
      grokText += entry.event.data;
      continue;
    }

    flushGrokText();
    normalized.push(...normalizeRawEvent(entry));
  }

  flushGrokText();
  return normalized;
};

const extractCompletedCodexMessageText = (event: RawProviderEvent): string => {
  if (
    event.type === "item.completed" &&
    isRecord(event.item) &&
    event.item.type === "agent_message" &&
    typeof event.item.text === "string"
  ) {
    return event.item.text;
  }

  return "";
};

const extractTurnCompletedText = (event: RawProviderEvent): string => {
  if (event.type === "turn.completed" && typeof event["last-assistant-message"] === "string") {
    return event["last-assistant-message"];
  }

  return "";
};

const extractTextPart = (event: RawProviderEvent): string => {
  if (event.type === "text" && isRecord(event.part) && typeof event.part.text === "string") {
    return event.part.text;
  }

  return "";
};

const extractGrokTextChunk = (event: RawProviderEvent): string => {
  if (event.type === "text" && typeof event.data === "string") {
    return event.data;
  }

  return "";
};

const extractResultSuccessText = (event: RawProviderEvent): string => {
  if (event.type === "result" && event.subtype === "success") {
    return typeof event.result === "string" ? event.result : "";
  }

  return "";
};

const extractClaudeAssistantMessageText = (event: RawProviderEvent): string => {
  if (event.type !== "assistant") return "";
  return extractAssistantMessageText(event.message);
};

const extractPiAssistantMessageText = (event: RawProviderEvent): string => {
  const type = String(event.type ?? "");

  if ((type === "message_end" || type === "turn_end") && isAssistantMessage(event.message)) {
    return extractAssistantMessageText(event.message);
  }

  if (type === "message_update") {
    return extractPiTextUpdate(event);
  }

  if (type !== "agent_end" || !Array.isArray(event.messages)) {
    return "";
  }

  const assistantMessage = [...event.messages].reverse().find(isAssistantMessage);
  return extractAssistantMessageText(assistantMessage);
};

const extractAssistantMessageText = (message: unknown): string => {
  if (typeof message === "string") return message;
  if (!isRecord(message)) return "";
  return extractContentText(message.content);
};

const extractContentText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  return content
    .filter((block): block is ContentBlock => isRecord(block) && block.type === "text")
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .filter((text) => text.length > 0)
    .join("\n");
};

const isAssistantMessage = (message: unknown): message is Record<string, unknown> =>
  isRecord(message) && message.role === "assistant";

const extractPiTextUpdate = (event: RawProviderEvent): string => {
  const update = event.assistantMessageEvent;
  if (!isRecord(update) || update.type !== "text_end") return "";
  return typeof update.content === "string" ? update.content : "";
};

export const extractAssistantTextFromRawEvent = (event: RawProviderEvent): string => {
  return (
    extractCompletedCodexMessageText(event) ||
    extractTurnCompletedText(event) ||
    extractTextPart(event) ||
    extractGrokTextChunk(event) ||
    extractResultSuccessText(event) ||
    extractPiAssistantMessageText(event) ||
    extractClaudeAssistantMessageText(event)
  );
};

const isOneOf = (value: string, candidates: string[]): boolean => {
  return candidates.includes(value);
};

const hasFailureSubtype = (value: unknown): boolean => {
  return isOneOf(String(value ?? "").toLowerCase(), ["error", "failure", "failed"]);
};

const hasTopLevelFailure = (event: RawProviderEvent): boolean => {
  const type = String(event.type ?? "").toLowerCase();
  if (isOneOf(type, ["error", "fatal"])) return true;
  if (String(event.level ?? "").toLowerCase() === "error") return true;
  if (hasFailureSubtype(event.subtype)) return true;
  return hasFailureSubtype(event.status);
};

const hasToolUseFailure = (event: RawProviderEvent): boolean => {
  if (event.type !== "tool_use" || !isRecord(event.part) || !isRecord(event.part.state)) {
    return false;
  }

  return hasFailureSubtype(event.part.state.status) || event.part.state.error !== undefined;
};

export const isFailureMarker = (event: RawProviderEvent): boolean => {
  return hasTopLevelFailure(event) || hasToolUseFailure(event) || event.error !== undefined;
};

const failureMessage = (event: RawProviderEvent): string => {
  const candidates = [event.result, event.error, event.message];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  const nested = findNestedText(event, ["error", "message", "result", "reason"], 3);
  if (nested) {
    return nested;
  }

  return "Unknown error";
};
