import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aopPaths, useTestAopHome } from "@aop/infra";
import { scaffoldTaskFromBrainstorm } from "./scaffold.ts";

describe("task-docs/scaffold", () => {
  let cleanupAopHome: (() => void) | undefined;
  let repoRoot: string;

  beforeEach(() => {
    cleanupAopHome = useTestAopHome();
    repoRoot = join(tmpdir(), `aop-scaffold-${Date.now()}`);
    mkdirSync(repoRoot, { recursive: true });
  });

  afterEach(() => {
    cleanupAopHome?.();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  test("creates task.md and plan.md in the canonical .aop repo task directory", async () => {
    const result = await scaffoldTaskFromBrainstorm("repo-1", repoRoot, "auth-flow", {
      title: "Auth Flow",
      description: "Restore the auth workflow",
      requirements: ["Build login handler", "Wire session storage"],
      acceptanceCriteria: ["User can log in", "Session persists"],
    });

    expect(result.taskName).toBe("auth-flow");
    expect(result.taskPath).toBe(aopPaths.repoTask("repo-1", "auth-flow"));
    expect(result.createdFiles.at(-2)).toBe(join(result.taskPath, "task.md"));
    expect(result.createdFiles.at(-1)).toBe(join(result.taskPath, "plan.md"));
    expect(await Bun.file(join(result.taskPath, "task.md")).exists()).toBe(true);
    expect(await Bun.file(join(result.taskPath, "plan.md")).exists()).toBe(true);
    expect(await Bun.file(join(result.taskPath, "prd.md")).exists()).toBe(false);
    expect(await Bun.file(join(result.taskPath, "issues.md")).exists()).toBe(false);
    expect(await Bun.file(join(result.taskPath, "001-auth-flow.md")).exists()).toBe(false);
    expect(
      await Bun.file(join(repoRoot, aopPaths.relativeTaskDocs(), "auth-flow", "task.md")).exists(),
    ).toBe(false);
  });

  test("writes a simple task plan without numbered subtask files", async () => {
    const result = await scaffoldTaskFromBrainstorm("repo-1", repoRoot, "disable-submit", {
      title: "Disable submit button",
      description: "Hide the submit control on the draft form",
      requirements: [
        "Remove submit button from draft form",
        "Keep save as draft available",
        "Update component tests",
      ],
      acceptanceCriteria: ["Submit button is not visible on draft form", "Save draft still works"],
    });

    const files = readdirSync(result.taskPath).sort();
    const planMarkdown = await Bun.file(join(result.taskPath, "plan.md")).text();
    expect(files).toEqual(["plan.md", "task.md"]);
    expect(planMarkdown).toContain("## Plan");
    expect(planMarkdown).toContain("Disable submit button");
  });

  test("writes multi-area scope into plan.md without numbered subtask files", async () => {
    const result = await scaffoldTaskFromBrainstorm("repo-1", repoRoot, "eav-mvp", {
      title: "EAV MVP: Pending Sort DESC and Disable Reviewed Tab",
      description: "Adjust pending sort and hide the reviewed tab for MVP.",
      requirements: [
        "Change the default pending list sort from addressCreatedAt ascending to descending",
        "Preserve deterministic pagination with a stable property ID tiebreaker",
        "Hide or disable the EAV Reviewed tab in the Command Center UI for MVP",
        "Keep MVP API surface limited to the pending workflow",
        "Update address-validation tests and API documentation",
      ],
      acceptanceCriteria: ["Pending list defaults to newest-first"],
    });

    const files = readdirSync(result.taskPath).sort();
    const planMarkdown = await Bun.file(join(result.taskPath, "plan.md")).text();

    expect(files).toEqual(["plan.md", "task.md"]);
    expect(planMarkdown).toContain("## Plan");
    expect(planMarkdown).toContain("Update backend");
    expect(planMarkdown).toContain("Update frontend");
  });
});
