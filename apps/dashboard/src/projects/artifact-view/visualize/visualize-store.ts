import type { VisualizeType } from "@aop/common";
import { useSyncExternalStore } from "react";
import {
  generateVisualization,
  getVisualized,
  repairVisualization,
  saveVisualization,
} from "../../../api/artifacts";
import { checkMermaid } from "../mermaid";
import { runVisualize, type VisualizeJob, type VisualizeSteps } from "./visualize-job";

/**
 * Visualize runs, one per reply, kept outside any component: closing the view or switching
 * screens does not stop a run, and opening the reply's view again shows where it is.
 */
const jobs = new Map<string, VisualizeJob>();
const listeners = new Set<() => void>();

const set = (messageId: string, job: VisualizeJob): void => {
  jobs.set(messageId, job);
  for (const listener of listeners) listener();
};

/**
 * Starts a run for the reply unless one is running. Without `fresh` it opens the diagram already
 * made; with it (Regenerate, Different type) it draws a new version.
 */
export const startVisualize = (
  projectId: string,
  messageId: string,
  type: VisualizeType = "auto",
  fresh = false,
): void => {
  if (jobs.get(messageId)?.status === "running") return;
  void runVisualize(hostSteps(projectId, messageId), type, fresh, (job) =>
    set(messageId, job),
  ).then((job) => set(messageId, job));
};

export const useVisualizeJob = (messageId: string | null): VisualizeJob | undefined =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (messageId ? jobs.get(messageId) : undefined),
  );

/** Test seam: forgets every run. */
export const resetVisualizeJobs = (): void => {
  jobs.clear();
};

const hostSteps = (projectId: string, messageId: string): VisualizeSteps => ({
  existing: () => getVisualized(projectId, messageId),
  generate: (type) => generateVisualization(projectId, { messageId, type }),
  repair: (type, source, error) =>
    repairVisualization(projectId, { messageId, type, source, error: error.slice(0, 2_000) }),
  check: checkMermaid,
  saveDiagram: (type, candidate) =>
    saveVisualization(projectId, { messageId, type, result: "diagram", candidate }),
  saveOutline: (type) => saveVisualization(projectId, { messageId, type, result: "outline" }),
});
