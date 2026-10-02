import { VISUALIZE_TYPES, type VisualizeType } from "@aop/common";
import type { VisualizePhase } from "./visualize-job";

export const TYPE_LABELS: Record<VisualizeType, string> = {
  auto: "Best fit",
  flowchart: "Flowchart",
  sequence: "Sequence diagram",
  mindmap: "Mind map",
  timeline: "Timeline",
  table: "Table summary",
};

export const visualizeTypeOf = (value: string | null): VisualizeType =>
  VISUALIZE_TYPES.find((type) => type === value) ?? "auto";

/** The steps a run shows, in order; a run that needs no repair skips that one. */
export const PHASES: { phase: VisualizePhase; label: string }[] = [
  { phase: "cache", label: "Reading the reply" },
  { phase: "drawing", label: "Drawing the diagram with Haiku" },
  { phase: "checking", label: "Checking that it parses" },
  { phase: "repairing", label: "Repairing it" },
  { phase: "saving", label: "Saving it to the Library" },
];

/** What a run cost at list price, as the person reads it: on a Claude plan it counts toward usage. */
export const formatCost = (costUsd: number): string =>
  costUsd === 0
    ? "no model call"
    : `about $${costUsd < 0.01 ? costUsd.toFixed(4) : costUsd.toFixed(2)}`;
