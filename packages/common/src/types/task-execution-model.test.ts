import { describe, expect, test } from "bun:test";
import {
  clampDeveloperExecutionSlots,
  INITIAL_TASK_EXECUTION_GUARDRAILS,
  TaskExecutionModelSchema,
} from "./task-execution-model.ts";

describe("task execution model", () => {
  test("accepts a valid architect-to-developer execution plan", () => {
    const result = TaskExecutionModelSchema.safeParse({
      version: 1,
      coordinationMode: "multi-repository",
      coordinationPhase: "developers-implementing",
      architect: {
        agentId: "architect-1",
        role: "architect",
        repositories: [
          { repoId: "aop-mono", assignment: "control-plane" },
          { repoId: "shared-ui", assignment: "review" },
        ],
      },
      developers: [
        {
          agentId: "developer-1",
          role: "developer",
          sliceId: "slice-runtime",
          lifecycle: "implementing",
          repositories: [
            { repoId: "aop-mono", assignment: "primary" },
            { repoId: "shared-ui", assignment: "supporting" },
          ],
        },
      ],
      guardrails: INITIAL_TASK_EXECUTION_GUARDRAILS,
    });

    expect(result.success).toBe(true);
  });

  test("rejects developer assignments without exactly one primary repository", () => {
    const result = TaskExecutionModelSchema.safeParse({
      version: 1,
      coordinationMode: "multi-repository",
      coordinationPhase: "developers-assigned",
      architect: {
        agentId: "architect-1",
        role: "architect",
        repositories: [{ repoId: "aop-mono", assignment: "control-plane" }],
      },
      developers: [
        {
          agentId: "developer-1",
          role: "developer",
          sliceId: "slice-runtime",
          lifecycle: "assigned",
          repositories: [
            { repoId: "aop-mono", assignment: "supporting" },
            { repoId: "shared-ui", assignment: "supporting" },
          ],
        },
      ],
      guardrails: INITIAL_TASK_EXECUTION_GUARDRAILS,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("exactly one primary repository");
    }
  });

  test("rejects single-repository mode when assignments span multiple repositories", () => {
    const result = TaskExecutionModelSchema.safeParse({
      version: 1,
      coordinationMode: "single-repository",
      coordinationPhase: "developers-assigned",
      architect: {
        agentId: "architect-1",
        role: "architect",
        repositories: [{ repoId: "aop-mono", assignment: "control-plane" }],
      },
      developers: [
        {
          agentId: "developer-1",
          role: "developer",
          sliceId: "slice-runtime",
          lifecycle: "assigned",
          repositories: [
            { repoId: "aop-mono", assignment: "primary" },
            { repoId: "shared-ui", assignment: "supporting" },
          ],
        },
      ],
      guardrails: INITIAL_TASK_EXECUTION_GUARDRAILS,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain("single-repository");
    }
  });

  test("clamps developer execution slots to the v1 five-developer cap", () => {
    expect(clampDeveloperExecutionSlots(2)).toBe(2);
    expect(clampDeveloperExecutionSlots(5)).toBe(5);
    expect(clampDeveloperExecutionSlots(9)).toBe(5);
  });
});
