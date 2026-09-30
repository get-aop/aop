import { extractAssistantTextFromRawEvent, isFailureMarker } from "./normalize";
import { parseRawJsonlContent } from "./parser";
import type {
  AssistantSignalText,
  InferredRunOutcome,
  ParsedRawJsonl,
  ParsedRawLogEntry,
  PlanMarkdownSignal,
  PlanMarkdownSource,
  RawProviderEvent,
} from "./types";

interface InferOutcomeOptions {
  requireCompleteLine?: boolean;
}

interface AssistantTextOptions {
  requireCompleteLine?: boolean;
}

const isExplicitSuccess = (event: RawProviderEvent): boolean => {
  if (event.type === "turn.completed") return true;
  if (event.type !== "result") return false;
  const subtype = String(event.subtype ?? event.status ?? "").toLowerCase();
  return subtype === "success" || subtype === "completed";
};

const isExplicitFailure = (event: RawProviderEvent): boolean => {
  if (event.type === "turn.failed" || event.type === "error") return true;
  if (event.type !== "result") return false;
  const subtype = String(event.subtype ?? event.status ?? "").toLowerCase();
  return subtype === "error" || subtype === "failure" || subtype === "failed";
};

const resolveEntries = (input: ParsedRawJsonl | ParsedRawLogEntry[]): ParsedRawLogEntry[] => {
  return Array.isArray(input) ? input : input.entries;
};

const hasTrailingPartial = (input: ParsedRawJsonl | ParsedRawLogEntry[]): boolean => {
  return Array.isArray(input) ? false : input.hasTrailingPartial;
};

const buildInferredOutcome = (
  outcome: InferredRunOutcome["outcome"],
  reason: InferredRunOutcome["reason"],
  sawEvents: boolean,
  hasTrailingPartial: boolean,
): InferredRunOutcome => {
  return {
    outcome,
    reason,
    sawEvents,
    hasTrailingPartial,
  };
};

const inferExplicitOutcome = (event: RawProviderEvent): InferredRunOutcome["outcome"] | null => {
  if (isExplicitSuccess(event)) return "success";
  if (isExplicitFailure(event)) return "failure";
  return null;
};

const scanEntriesForOutcomeSignals = (entries: ParsedRawLogEntry[]) => {
  let explicitOutcome: InferredRunOutcome["outcome"] | null = null;
  let sawFailureMarker = false;

  for (const entry of entries) {
    explicitOutcome = inferExplicitOutcome(entry.event) ?? explicitOutcome;
    sawFailureMarker = sawFailureMarker || isFailureMarker(entry.event);
  }

  return {
    explicitOutcome,
    sawFailureMarker,
  };
};

const extractAssistantSignalText = (entries: ParsedRawLogEntry[]): string =>
  entries
    .map((entry) => extractAssistantTextFromRawEvent(entry.event))
    .filter((text) => text.trim().length > 0)
    .join("\n");

export const inferRunOutcomeFromEntries = (
  input: ParsedRawJsonl | ParsedRawLogEntry[],
  options: InferOutcomeOptions = {},
): InferredRunOutcome => {
  const entries = resolveEntries(input);
  const trailingPartial = hasTrailingPartial(input);
  const requireCompleteLine = options.requireCompleteLine ?? true;
  const sawEvents = entries.length > 0;

  if (requireCompleteLine && trailingPartial) {
    return buildInferredOutcome("unknown", "trailing-partial-json-line", sawEvents, true);
  }

  const { explicitOutcome, sawFailureMarker } = scanEntriesForOutcomeSignals(entries);

  if (explicitOutcome) {
    return buildInferredOutcome(
      explicitOutcome,
      "explicit-result-event",
      sawEvents,
      trailingPartial,
    );
  }

  if (sawFailureMarker) {
    return buildInferredOutcome("failure", "failure-marker", sawEvents, trailingPartial);
  }

  if (sawEvents) {
    return buildInferredOutcome("success", "implicit-success-stream", true, trailingPartial);
  }

  return buildInferredOutcome("unknown", "no-events", false, trailingPartial);
};

export const inferRunOutcomeFromRawJsonl = (
  content: string,
  options: InferOutcomeOptions = {},
): InferredRunOutcome => {
  const parsed = parseRawJsonlContent(content);
  return inferRunOutcomeFromEntries(parsed, options);
};

export const extractAssistantSignalTextFromEntries = (
  input: ParsedRawJsonl | ParsedRawLogEntry[],
  options: AssistantTextOptions = {},
): AssistantSignalText => {
  const entries = resolveEntries(input);
  const trailingPartial = hasTrailingPartial(input);
  const requireCompleteLine = options.requireCompleteLine ?? true;

  if (requireCompleteLine && trailingPartial) {
    return {
      text: "",
      isComplete: false,
      hasTrailingPartial: true,
    };
  }

  const text = extractAssistantSignalText(entries);

  return {
    text,
    isComplete: true,
    hasTrailingPartial: trailingPartial,
  };
};

export const extractAssistantSignalTextFromRawJsonl = (
  content: string,
  options: AssistantTextOptions = {},
): AssistantSignalText => {
  const parsed = parseRawJsonlContent(content);
  return extractAssistantSignalTextFromEntries(parsed, options);
};

/**
 * Returns only the final assistant message instead of the whole transcript.
 *
 * Plan mode emits several assistant messages (early "thinking out loud"
 * narration, then the committed plan). Concatenating them leaks reasoning into
 * the plan, so we walk the raw events in reverse and return the last complete
 * assistant message. Each raw event already carries a full message, and
 * `extractAssistantTextFromRawEvent` resolves it per provider (e.g. codex
 * `turn.completed.last-assistant-message`, claude `result`),
 * so no provider-specific final-message signal is lost.
 */
export const extractFinalAssistantTextFromEntries = (
  input: ParsedRawJsonl | ParsedRawLogEntry[],
  options: AssistantTextOptions = {},
): AssistantSignalText => {
  const entries = resolveEntries(input);
  const trailingPartial = hasTrailingPartial(input);
  const requireCompleteLine = options.requireCompleteLine ?? true;

  if (requireCompleteLine && trailingPartial) {
    return { text: "", isComplete: false, hasTrailingPartial: true };
  }

  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (!entry) {
      continue;
    }
    const text = extractAssistantTextFromRawEvent(entry.event).trim();
    if (text.length > 0) {
      return { text, isComplete: true, hasTrailingPartial: trailingPartial };
    }
  }

  return { text: "", isComplete: true, hasTrailingPartial: trailingPartial };
};

export const extractFinalAssistantTextFromRawJsonl = (
  content: string,
  options: AssistantTextOptions = {},
): AssistantSignalText => {
  const parsed = parseRawJsonlContent(content);
  return extractFinalAssistantTextFromEntries(parsed, options);
};

interface PlanMarkdownOptions extends AssistantTextOptions {
  /**
   * Below this length the final message is treated as a hand-off note rather
   * than the plan, and the longest assistant message is used instead. Observed
   * hand-offs ("The plan is written and ready for your review…") run 90–400
   * chars; real plans for even trivial tasks exceed it.
   */
  minPlausibleLength?: number;
}

const DEFAULT_MIN_PLAUSIBLE_PLAN_LENGTH = 400;

/** Claude Code plan mode writes the plan file into a `plans/` config directory. */
const PLAN_FILE_PATH_PATTERN = /[/\\]plans[/\\][^/\\]+\.md$/;

/**
 * Recovers the committed plan markdown from a plan-mode stream.
 *
 * Where the plan lands differs per provider. Claude Code's plan-mode protocol
 * delivers it as a tool artifact — the `ExitPlanMode` input and/or a `Write`
 * into the harness `plans/` directory — and ends the turn with a short
 * hand-off message, so the final assistant text is never the plan. Codex
 * answers in chat, so the final message normally is the plan. We therefore prefer the largest tool artifact over the final
 * message, and when both are implausibly short we salvage the longest
 * assistant message (e.g. a model that printed the plan mid-turn and closed
 * with "the document above is the deliverable").
 */
export const extractPlanMarkdownFromEntries = (
  input: ParsedRawJsonl | ParsedRawLogEntry[],
  options: PlanMarkdownOptions = {},
): PlanMarkdownSignal => {
  const entries = resolveEntries(input);
  const trailingPartial = hasTrailingPartial(input);
  const requireCompleteLine = options.requireCompleteLine ?? true;

  if (requireCompleteLine && trailingPartial) {
    return { text: "", isComplete: false, hasTrailingPartial: true, source: "final-message" };
  }

  const candidates = collectPlanCandidates(entries);
  const finalMessage = extractFinalAssistantTextFromEntries(entries).text;
  const minPlausibleLength = options.minPlausibleLength ?? DEFAULT_MIN_PLAUSIBLE_PLAN_LENGTH;
  const { text, source } = choosePlanMarkdown(candidates, finalMessage, minPlausibleLength);

  return { text, isComplete: true, hasTrailingPartial: trailingPartial, source };
};

interface PlanCandidates {
  artifact: string;
  longestMessage: string;
}

const collectPlanCandidates = (entries: ParsedRawLogEntry[]): PlanCandidates => {
  let artifact = "";
  let longestMessage = "";
  for (const entry of entries) {
    if (!entry) continue;
    artifact = preferLonger(artifact, extractPlanArtifactFromEvent(entry.event).trim());
    longestMessage = preferLonger(
      longestMessage,
      extractAssistantTextFromRawEvent(entry.event).trim(),
    );
  }
  return { artifact, longestMessage };
};

/** Later candidates win ties so the most recent committed value is kept. */
const preferLonger = (current: string, candidate: string): string =>
  candidate.length > 0 && candidate.length >= current.length ? candidate : current;

const choosePlanMarkdown = (
  candidates: PlanCandidates,
  finalMessage: string,
  minPlausibleLength: number,
): { text: string; source: PlanMarkdownSource } => {
  const preferArtifact = candidates.artifact.length > finalMessage.length;
  const text = preferArtifact ? candidates.artifact : finalMessage;
  const source: PlanMarkdownSource = preferArtifact ? "plan-artifact" : "final-message";

  if (text.length < minPlausibleLength && candidates.longestMessage.length > text.length) {
    return { text: candidates.longestMessage, source: "longest-message" };
  }

  return { text, source };
};

export const extractPlanMarkdownFromRawJsonl = (
  content: string,
  options: PlanMarkdownOptions = {},
): PlanMarkdownSignal => {
  const parsed = parseRawJsonlContent(content);
  return extractPlanMarkdownFromEntries(parsed, options);
};

const extractPlanArtifactFromEvent = (event: RawProviderEvent): string => {
  if (event.type !== "assistant" || !isObjectRecord(event.message)) return "";
  const content = event.message.content;
  if (!Array.isArray(content)) return "";

  let artifact = "";
  for (const block of content) {
    if (!isObjectRecord(block) || block.type !== "tool_use") continue;
    const candidate = readPlanArtifactInput(block.name, block.input);
    if (candidate.length > artifact.length) {
      artifact = candidate;
    }
  }
  return artifact;
};

const readPlanArtifactInput = (name: unknown, input: unknown): string => {
  if (!isObjectRecord(input)) return "";

  if (name === "ExitPlanMode" && typeof input.plan === "string") {
    return input.plan;
  }

  if (
    name === "Write" &&
    typeof input.file_path === "string" &&
    PLAN_FILE_PATH_PATTERN.test(input.file_path) &&
    typeof input.content === "string"
  ) {
    return input.content;
  }

  return "";
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
