import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStatus } from "@aop/common";
import { resetTaskDocsForRetry } from "./reset-task-docs.ts";
import { parseTaskDoc, writeTaskDoc } from "./task.ts";

describe("resetTaskDocsForRetry", () => {
  let taskDir: string | undefined;

  afterEach(async () => {
    if (taskDir) {
      await rm(taskDir, { recursive: true, force: true });
      taskDir = undefined;
    }
  });

  test("resets task.md, issues.md, and plan.md checkboxes for retry", async () => {
    taskDir = await mkdtemp(join(tmpdir(), "aop-reset-docs-"));
    await writeTaskDoc(
      join(taskDir, "task.md"),
      {
        id: "task-1",
        title: "Retry task",
        status: TaskStatus.DONE,
        created: "2026-06-30T00:00:00.000Z",
        changePath: "docs/tasks/retry-task",
        priority: "high",
      },
      [
        "",
        "## Description",
        "Retry this work.",
        "",
        "## Requirements",
        "- Keep behavior",
        "",
        "## Acceptance Criteria",
        "- [x] First criterion",
        "- [x] Second criterion",
        "",
      ].join("\n"),
    );
    await Bun.write(
      join(taskDir, "issues.md"),
      [
        "---",
        "status: DONE",
        "task: retry-task",
        "created: 2026-06-30T00:00:00.000Z",
        "---",
        "# Issues",
        "",
        "## Agent Brief",
        "",
        "- [x] Implement retry behavior",
        "- [x] Verify retry behavior",
        "",
      ].join("\n"),
    );
    await Bun.write(join(taskDir, "plan.md"), "# Plan\n\n- [x] Add route\n- [x] Wire tests\n");

    await resetTaskDocsForRetry(taskDir);

    const taskDoc = await parseTaskDoc(join(taskDir, "task.md"));
    const issuesMd = await Bun.file(join(taskDir, "issues.md")).text();
    const planMd = await Bun.file(join(taskDir, "plan.md")).text();

    expect(taskDoc.status).toBe(TaskStatus.DRAFT);
    expect(taskDoc.acceptanceCriteria).toEqual([
      { text: "First criterion", checked: false },
      { text: "Second criterion", checked: false },
    ]);
    expect(issuesMd).toContain("status: INPROGRESS");
    expect(issuesMd).toContain("- [ ] Implement retry behavior");
    expect(issuesMd).toContain("- [ ] Verify retry behavior");
    expect(planMd).toBe("# Plan\n\n- [ ] Add route\n- [ ] Wire tests\n");
  });
});
