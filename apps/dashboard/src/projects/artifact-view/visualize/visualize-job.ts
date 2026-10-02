import type { ArtifactDetail, VisualizeCandidate, VisualizeType } from "@aop/common";
import type { VisualizeDrawn } from "../../../api/artifacts";

/** Where a Visualize run is, as the view shows it. */
export type VisualizePhase = "cache" | "drawing" | "checking" | "repairing" | "saving";

export type VisualizeJob =
  | { status: "running"; type: VisualizeType; phase: VisualizePhase; costUsd: number }
  | {
      status: "done";
      type: VisualizeType;
      artifact: ArtifactDetail;
      /** No valid diagram came back, so the reply's outline was kept instead. */
      fallback: boolean;
      /** The diagram was already made; nothing ran. */
      cached: boolean;
      costUsd: number;
    }
  | { status: "failed"; type: VisualizeType; error: string; costUsd: number };

/** What a run needs from the host and the browser; the store passes the real ones, tests fakes. */
export interface VisualizeSteps {
  existing: () => Promise<ArtifactDetail | null>;
  generate: (type: VisualizeType) => Promise<VisualizeDrawn>;
  repair: (type: VisualizeType, source: string, error: string) => Promise<VisualizeDrawn>;
  check: (source: string) => Promise<{ valid: true } | { valid: false; error: string }>;
  saveDiagram: (type: VisualizeType, candidate: VisualizeCandidate) => Promise<ArtifactDetail>;
  saveOutline: (type: VisualizeType) => Promise<ArtifactDetail>;
}

/**
 * One Visualize run: the diagram already made of the reply unless `fresh`; else a draw, checked
 * with Mermaid's own parser, one repair when it does not parse, and the outline when nothing
 * valid came back (or the model gave nothing). A Markdown table needs no check. `report` hears
 * every step; the run's end is its result.
 */
export const runVisualize = async (
  steps: VisualizeSteps,
  type: VisualizeType,
  fresh: boolean,
  report: (job: VisualizeJob) => void,
): Promise<VisualizeJob> => {
  let costUsd = 0;
  const at = (phase: VisualizePhase) => report({ status: "running", type, phase, costUsd });
  try {
    if (!fresh) {
      at("cache");
      const existing = await steps.existing();
      if (existing)
        return { status: "done", type, artifact: existing, fallback: false, cached: true, costUsd };
    }
    at("drawing");
    const drawn = await steps.generate(type).catch(() => null);
    costUsd += drawn?.costUsd ?? 0;
    const candidate = drawn
      ? await checked(steps, type, drawn.candidate, at, (cost) => (costUsd += cost))
      : null;
    at("saving");
    const artifact = candidate
      ? await steps.saveDiagram(type, candidate)
      : await steps.saveOutline(type);
    return { status: "done", type, artifact, fallback: candidate === null, cached: false, costUsd };
  } catch (error) {
    return {
      status: "failed",
      type,
      error: error instanceof Error ? error.message : String(error),
      costUsd,
    };
  }
};

// The candidate that parses, after one repair if it needs one; null when none does.
const checked = async (
  steps: VisualizeSteps,
  type: VisualizeType,
  candidate: VisualizeCandidate,
  at: (phase: VisualizePhase) => void,
  spent: (costUsd: number) => void,
): Promise<VisualizeCandidate | null> => {
  if (candidate.kind === "markdown") return candidate;
  at("checking");
  const first = await steps.check(candidate.source);
  if (first.valid) return candidate;
  at("repairing");
  const repaired = await steps.repair(type, candidate.source, first.error).catch(() => null);
  if (repaired?.candidate.kind !== "mermaid") return null;
  spent(repaired.costUsd ?? 0);
  at("checking");
  return (await steps.check(repaired.candidate.source)).valid ? repaired.candidate : null;
};
