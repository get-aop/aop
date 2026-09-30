import type { RawProviderEvent } from "@aop/llm-provider";

export const isProviderFailureEvent = (runtime: string, event: RawProviderEvent): boolean => {
  const type = stringValue(event.type);
  if (type === "turn.failed" || type === "error") return true;

  const resultState = stringValue(event.subtype ?? event.status);
  if (type === "result" && /error|fail/.test(resultState)) return true;

  if (!isProviderTerminalEvent(runtime, type)) return false;
  return /error|fail/.test(stringValue(event.stopReason));
};

export const isProviderSuccessEvent = (runtime: string, event: RawProviderEvent): boolean => {
  const type = stringValue(event.type);
  if (isProviderFailureEvent(runtime, event)) return false;
  if (runtime === "codex-cli") return type === "turn.completed";
  if (runtime === "claude-code") {
    return type === "result" && ["success", "completed"].includes(stringValue(event.subtype));
  }
  if (runtime === "pi") return type === "agent_end" || type === "turn_end";
  return type === "turn.completed";
};

const isProviderTerminalEvent = (runtime: string, type: string): boolean =>
  runtime === "pi" && (type === "agent_end" || type === "turn_end");

const stringValue = (value: unknown): string =>
  typeof value === "string" ? value.toLowerCase() : "";
