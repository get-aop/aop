import { parseRawJsonlContent } from "@aop/llm-provider";

/**
 * Reads what a Claude Code `--output-format stream-json` log really contains. Everything here is
 * defensive: the point of the harness is that the real CLI may differ from what the fake plays.
 */
export type Fields = Record<string, unknown>;

export const parseEvents = (log: string): Fields[] =>
  parseRawJsonlContent(log).entries.map((entry) => entry.event as Fields);

export const asFields = (value: unknown): Fields | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Fields)
    : undefined;

export interface InitFacts {
  tools: string[];
  mcpServers: { name: string; status: string }[];
  model: string | null;
  permissionMode: string | null;
  sessionId: string | null;
}

export const initOf = (events: readonly Fields[]): InitFacts | null => {
  const init = events.find((event) => event.type === "system" && event.subtype === "init");
  if (!init) return null;
  return {
    tools: Array.isArray(init.tools) ? init.tools.map(String) : [],
    mcpServers: (Array.isArray(init.mcp_servers) ? init.mcp_servers : []).flatMap((server) => {
      const fields = asFields(server);
      return fields ? [{ name: String(fields.name), status: String(fields.status) }] : [];
    }),
    model: typeof init.model === "string" ? init.model : null,
    permissionMode: typeof init.permissionMode === "string" ? init.permissionMode : null,
    sessionId: typeof init.session_id === "string" ? init.session_id : null,
  };
};

export interface ToolCall {
  id: string;
  name: string;
  input: Fields;
  /** Absent when the log ends before the tool returned. */
  result?: { isError: boolean; text: string };
}

/** Every tool call of the run, each joined with the result that answered it. */
export const toolCallsOf = (events: readonly Fields[]): ToolCall[] => {
  const calls = new Map<string, ToolCall>();
  for (const event of events) {
    for (const block of contentBlocks(event)) recordBlock(calls, event.type, block);
  }
  return [...calls.values()];
};

const recordBlock = (calls: Map<string, ToolCall>, eventType: unknown, block: Fields): void => {
  if (eventType === "assistant" && block.type === "tool_use") {
    const id = String(block.id);
    calls.set(id, { id, name: String(block.name), input: asFields(block.input) ?? {} });
  } else if (eventType === "user" && block.type === "tool_result") {
    attachResult(calls.get(String(block.tool_use_id)), block);
  }
};

const attachResult = (call: ToolCall | undefined, block: Fields): void => {
  if (call) call.result = { isError: block.is_error === true, text: textOf(block.content) };
};

export const resultOf = (events: readonly Fields[]): Fields | null =>
  [...events].reverse().find((event) => event.type === "result") ?? null;

/** The assistant's text, in order, as the reply a person reads. */
export const assistantText = (events: readonly Fields[]): string =>
  events
    .filter((event) => event.type === "assistant")
    .flatMap(contentBlocks)
    .filter((block) => block.type === "text")
    .map((block) => String(block.text))
    .join("\n");

export const rateLimitEvents = (events: readonly Fields[]): Fields[] =>
  events.filter((event) => event.type === "rate_limit_event");

/** The tool names the run tried that were denied by permissions, from the result's `permission_denials`. */
export const permissionDenials = (events: readonly Fields[]): Fields[] => {
  const denials = resultOf(events)?.permission_denials;
  return fieldsList(denials);
};

/** Where `flag` sits in an argv, or -1. */
export const flagValue = (argv: readonly string[], flag: string): string | null => {
  const at = argv.indexOf(flag);
  return at === -1 ? null : (argv[at + 1] ?? null);
};

/**
 * The structure of a value with its leaf types instead of its contents, so a report can show
 * what the real CLI returns without copying prompts or answers. Keys of `modelUsage` are models,
 * so objects keep their key names.
 */
export const shapeOf = (value: unknown, depth = 4): unknown => {
  if (Array.isArray(value)) {
    return value.length === 0 || depth === 0 ? [] : [shapeOf(value[0], depth - 1)];
  }
  const fields = asFields(value);
  if (!fields) return value === null ? "null" : typeof value;
  if (depth === 0) return "{...}";
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, shapeOf(v, depth - 1)]));
};

const fieldsList = (value: unknown): Fields[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): Fields[] => {
    const fields = asFields(entry);
    return fields ? [fields] : [];
  });
};

const contentBlocks = (event: Fields): Fields[] => fieldsList(asFields(event.message)?.content);

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => asFields(part))
    .map((part) => (typeof part?.text === "string" ? part.text : ""))
    .join("\n");
};
