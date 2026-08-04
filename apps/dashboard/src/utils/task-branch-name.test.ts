import { describe, expect, test } from "bun:test";
import { deriveTaskBranchName } from "./task-branch-name";

describe("deriveTaskBranchName", () => {
  test("uses the last path segment as the branch name", () => {
    expect(deriveTaskBranchName("docs/tasks/compact-unassigned-lane-task-cards", "task_123")).toBe(
      "compact-unassigned-lane-task-cards",
    );
  });

  test("falls back to task id when change path has no usable segment", () => {
    expect(deriveTaskBranchName("---", "task_abc")).toBe("task-abc");
  });
});
