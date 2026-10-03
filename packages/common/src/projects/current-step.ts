import type { ToolPart, TurnPart } from "./blocks.ts";

/**
 * The step a turn being written is on: the tool calls running now. Claude Code hands a message
 * sent meanwhile to the model once every call of the step has ended, so the one that started
 * first is the one it waits on; `others` is how many more run alongside it. Null while the model
 * writes (prose, reasoning, or a call it has not finished asking for).
 */
export interface CurrentStep {
  tool: ToolPart;
  others: number;
}

const DETAIL_SHOWN = 60;

export const currentStepOf = (parts: readonly TurnPart[]): CurrentStep | null => {
  const running = parts.filter(
    (part): part is ToolPart => part.type === "tool" && part.status === "running",
  );
  const [tool] = running;
  return tool ? { tool, others: running.length - 1 } : null;
};

/** "Bash `bun test`", "Agent `Review the diff` and 2 more": the step, as one short line. */
export const describeStep = ({ tool, others }: CurrentStep): string => {
  const detail = tool.detail?.replace(/\s+/g, " ").trim();
  const shown = detail
    ? ` \`${detail.length > DETAIL_SHOWN ? `${detail.slice(0, DETAIL_SHOWN - 1)}…` : detail}\``
    : "";
  return `${tool.name}${shown}${others > 0 ? ` and ${others} more` : ""}`;
};

/** "12s", "3m 05s", "1h 02m": how long something has run, from `sinceIso` to `now` (ms). */
export const formatElapsed = (sinceIso: string, now: number): string => {
  const since = Date.parse(sinceIso);
  if (!Number.isFinite(since)) return "";
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return minutes < 60
    ? `${minutes}m ${rest}s`
    : `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
};
