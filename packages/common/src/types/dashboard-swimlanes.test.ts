import { describe, expect, test } from "bun:test";
import { DEFAULT_DASHBOARD_SWIMLANES, resolveTaskSwimlane } from "./dashboard-swimlanes.ts";
import { INITIAL_TASK_EXECUTION_GUARDRAILS } from "./task-execution-model.ts";

const executionModel = {
  version: 1 as const,
  coordinationMode: "single-repository" as const,
  coordinationPhase: "developers-assigned" as const,
  architect: {
    agentId: "architect-1",
    role: "architect" as const,
    repositories: [{ repoId: "repo-1", assignment: "control-plane" as const }],
  },
  developers: [
    {
      agentId: "developer-2",
      role: "developer" as const,
      sliceId: "slice-runtime",
      lifecycle: "implementing" as const,
      repositories: [{ repoId: "repo-1", assignment: "primary" as const }],
    },
  ],
  guardrails: INITIAL_TASK_EXECUTION_GUARDRAILS,
};

describe("dashboard swimlanes", () => {
  test("uses Pi-first default lane labels", () => {
    expect(DEFAULT_DASHBOARD_SWIMLANES.map((lane) => lane.title)).toEqual([
      "Control Plane",
      "Pi Worker Execution",
      "Completed",
    ]);
  });

  test("keeps live working tasks in the developer execution lane even before task docs advance coordination metadata", () => {
    expect(resolveTaskSwimlane("WORKING", executionModel)).toEqual({
      laneId: "developer-execution",
      phaseLabel: "Implementing",
      ownerLabel: "developer-2",
      ownerRole: "developer",
    });
  });
});
