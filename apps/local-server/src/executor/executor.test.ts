import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StepCommand } from "@aop/common/protocol";
import type { WorktreeInfo } from "@aop/git-manager";
import { buildPromptForExecution } from "./executor.ts";
import type { ExecutorContext } from "./types.ts";

const worktreeInfo: WorktreeInfo = {
  path: "/repo/.worktrees/task-1",
  branch: "aop/task-1",
  baseBranch: "main",
  baseCommit: "abc123",
};

const stepCommand = (promptTemplate: string): StepCommand => ({
  id: "implement",
  type: "implement",
  promptTemplate,
  attempt: 1,
  iteration: 0,
});

const executorCtx = (docsDir: string): ExecutorContext =>
  ({
    task: { id: "task-1", change_path: "docs/tasks/task-1" },
    changePath: docsDir,
    repositories: [],
  }) as unknown as ExecutorContext;

describe("buildPromptForExecution", () => {
  test("lists image files from the task attachments dir as #imageN in order", async () => {
    const docsDir = await mkdtemp(join(tmpdir(), "aop-executor-attachments-"));
    await mkdir(join(docsDir, "attachments"), { recursive: true });
    await Bun.write(join(docsDir, "attachments", "task-image-2.png"), "b");
    await Bun.write(join(docsDir, "attachments", "task-image-1.png"), "a");
    await Bun.write(join(docsDir, "attachments", "notes.txt"), "not an image");

    const prompt = await buildPromptForExecution({
      executorCtx: executorCtx(docsDir),
      worktreeInfo,
      stepCommand: stepCommand("{{#each task.attachments}}{{this.label}}={{this.path}};{{/each}}"),
    });

    expect(prompt).toBe(
      `#image1=${join(docsDir, "attachments", "task-image-1.png")};#image2=${join(
        docsDir,
        "attachments",
        "task-image-2.png",
      )};`,
    );
  });

  test("renders no attachments when the directory does not exist", async () => {
    const docsDir = await mkdtemp(join(tmpdir(), "aop-executor-no-attachments-"));

    const prompt = await buildPromptForExecution({
      executorCtx: executorCtx(docsDir),
      worktreeInfo,
      stepCommand: stepCommand("{{#if task.attachments.length}}has-images{{else}}no-images{{/if}}"),
    });

    expect(prompt).toBe("no-images");
  });

  test("appends the canonical signals section when the template omits it", async () => {
    const docsDir = await mkdtemp(join(tmpdir(), "aop-executor-signals-"));

    const prompt = await buildPromptForExecution({
      executorCtx: executorCtx(docsDir),
      worktreeInfo,
      stepCommand: {
        ...stepCommand("Review the diff and report issues."),
        signals: [
          { name: "REVIEW_PASSED", description: "review found no blocking issues" },
          { name: "REVIEW_FAILED", description: "blocking issues were found" },
        ],
      },
    });

    expect(prompt).toContain("Review the diff and report issues.");
    expect(prompt).toContain("## Signals (REQUIRED)");
    expect(prompt).toContain("`<aop>REVIEW_PASSED</aop>` — review found no blocking issues");
    expect(prompt).toContain("`<aop>REVIEW_FAILED</aop>` — blocking issues were found");
    expect(prompt).toContain("DO NOT FINISH THE SESSION WITHOUT SIGNALING.");
  });

  test("does not duplicate a signals section the template already renders", async () => {
    const docsDir = await mkdtemp(join(tmpdir(), "aop-executor-signals-existing-"));

    const prompt = await buildPromptForExecution({
      executorCtx: executorCtx(docsDir),
      worktreeInfo,
      stepCommand: {
        ...stepCommand(
          "Custom step.\n\n## Signals (REQUIRED)\n{{#each signals}}- `<aop>{{this.name}}</aop>`\n{{/each}}",
        ),
        signals: [{ name: "DONE_SIGNAL", description: "all done" }],
      },
    });

    expect(prompt.match(/## Signals \(REQUIRED\)/g)).toHaveLength(1);
    expect(prompt).toContain("`<aop>DONE_SIGNAL</aop>`");
  });

  test("leaves templates without signals untouched", async () => {
    const docsDir = await mkdtemp(join(tmpdir(), "aop-executor-no-signals-"));

    const prompt = await buildPromptForExecution({
      executorCtx: executorCtx(docsDir),
      worktreeInfo,
      stepCommand: stepCommand("Just do the work."),
    });

    expect(prompt).toBe("Just do the work.");
  });
});
