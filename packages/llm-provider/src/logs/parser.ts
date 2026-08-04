import type { LogProvider, ParsedRawJsonl, ParsedRawLogEntry, RawProviderEvent } from "./types";

const isPotentialJsonStart = (line: string): boolean => {
  return line.startsWith("{") || line.startsWith("[");
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> => {
  return !!value && typeof value === "object" && !Array.isArray(value);
};

const detectProvider = (event: RawProviderEvent): LogProvider => {
  if (event.provider === "openclaw") return "openclaw";
  if (event.provider === "grok-build" || event.provider === "grok") return "grok-build";
  if (event.provider === "pi") return "pi";
  if (isPiRuntimeEvent(event)) return "pi";
  if ("part" in event) return "opencode";
  if (isGrokBuildEvent(event)) return "grok-build";
  if (isCodexEvent(event)) return "codex";

  const type = typeof event.type === "string" ? event.type : "";
  if (["assistant", "tool_use", "tool_result", "result", "system", "user"].includes(type)) {
    return "claude-code";
  }

  return "unknown";
};

const isPiRuntimeEvent = (event: RawProviderEvent): boolean => {
  const type = typeof event.type === "string" ? event.type : "";
  return [
    "agent_start",
    "agent_end",
    "extension_ui_request",
    "message_end",
    "message_start",
    "message_update",
    "tool_execution_end",
    "tool_execution_start",
    "turn_end",
    "turn_start",
  ].includes(type);
};

const isGrokBuildEvent = (event: RawProviderEvent): boolean => {
  const type = typeof event.type === "string" ? event.type : "";
  if (type === "end") return true;
  return (type === "text" || type === "thought") && typeof event.data === "string";
};

const isCodexEvent = (event: RawProviderEvent): boolean => {
  const type = typeof event.type === "string" ? event.type : "";
  return (
    type.startsWith("thread.") ||
    type.startsWith("turn.") ||
    type.startsWith("item.") ||
    type === "error"
  );
};

const parseCandidate = (candidate: string): RawProviderEvent | null => {
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return isObjectRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const parseRawJsonlContent = (content: string): ParsedRawJsonl => {
  const entries: ParsedRawLogEntry[] = [];
  let ignoredLineCount = 0;
  let entryIndex = 0;
  let buffer = "";

  for (const rawLine of content.split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const candidate = buffer ? `${buffer}\n${trimmed}` : trimmed;
    const parsed = parseCandidate(candidate);
    if (parsed) {
      entries.push({
        index: entryIndex,
        raw: candidate,
        event: parsed,
        provider: detectProvider(parsed),
      });
      entryIndex += 1;
      buffer = "";
      continue;
    }

    if (buffer || isPotentialJsonStart(trimmed)) {
      buffer = candidate;
      continue;
    }

    ignoredLineCount += 1;
  }

  return {
    entries,
    ignoredLineCount,
    hasTrailingPartial: buffer.trim().length > 0,
  };
};
