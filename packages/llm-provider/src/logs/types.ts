export type RawProviderEvent = Record<string, unknown>;

export type LogProvider =
  | "claude-code"
  | "codex"
  | "codex-cli"
  | "grok-build"
  | "hermes"
  | "pi"
  | "opencode"
  | "openclaw"
  | "unknown";

export interface ParsedRawLogEntry {
  index: number;
  raw: string;
  event: RawProviderEvent;
  provider: LogProvider;
}

export interface ParsedRawJsonl {
  entries: ParsedRawLogEntry[];
  ignoredLineCount: number;
  hasTrailingPartial: boolean;
}

export type LogStream = "stdout" | "stderr";

export interface RenderedLogLine {
  stream: LogStream;
  content: string;
  timestamp: string;
}

export type NormalizedLogEvent =
  | {
      kind: "assistant_text";
      provider: LogProvider;
      text: string;
    }
  | {
      kind: "tool_started";
      provider: LogProvider;
      toolName: string;
      primaryInput: string;
      description?: string;
    }
  | {
      kind: "tool_completed";
      provider: LogProvider;
      toolName: string;
      message?: string;
      success: boolean;
    }
  | {
      kind: "result_success";
      provider: LogProvider;
      text?: string;
    }
  | {
      kind: "result_error";
      provider: LogProvider;
      text: string;
    }
  | {
      kind: "error";
      provider: LogProvider;
      text: string;
    }
  | {
      kind: "noise";
      provider: LogProvider;
      reason: string;
    };

export type RunOutcome = "success" | "failure" | "unknown";

export interface InferredRunOutcome {
  outcome: RunOutcome;
  reason: string;
  sawEvents: boolean;
  hasTrailingPartial: boolean;
}

export interface AssistantSignalText {
  text: string;
  isComplete: boolean;
  hasTrailingPartial: boolean;
}

/** Which channel of the raw stream a plan markdown was recovered from. */
export type PlanMarkdownSource = "plan-artifact" | "final-message" | "longest-message";

export interface PlanMarkdownSignal extends AssistantSignalText {
  source: PlanMarkdownSource;
}
