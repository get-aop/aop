import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aopPaths, useTestAopHome } from "@aop/infra";
import { hasTaskSpec, parseTaskProgress, readTaskProgress } from "./progress.ts";

describe("parseTaskProgress", () => {
  test("all incomplete", () => {
    const content = "## Tasks\n- [ ] Task A\n- [ ] Task B\n- [ ] Task C";
    expect(parseTaskProgress(content)).toEqual({ completed: 0, total: 3 });
  });

  test("mixed completion", () => {
    const content = "## Tasks\n- [x] Task A\n- [ ] Task B\n- [x] Task C";
    expect(parseTaskProgress(content)).toEqual({ completed: 2, total: 3 });
  });

  test("all complete", () => {
    const content = "- [x] Task 1\n- [x] Task 2\n- [x] Task 3\n- [x] Task 4\n- [x] Task 5";
    expect(parseTaskProgress(content)).toEqual({ completed: 5, total: 5 });
  });

  test("empty file", () => {
    expect(parseTaskProgress("")).toEqual({ completed: 0, total: 0 });
  });

  test("no checkboxes", () => {
    const content = "## Design\nSome text\n- bullet point\n- another bullet";
    expect(parseTaskProgress(content)).toEqual({ completed: 0, total: 0 });
  });

  test("handles uppercase X", () => {
    const content = "- [X] Task A\n- [ ] Task B";
    expect(parseTaskProgress(content)).toEqual({ completed: 1, total: 2 });
  });

  test("ignores non-checkbox lines with brackets", () => {
    const content = "Some [text] here\n- [x] Real task\n[not a task]";
    expect(parseTaskProgress(content)).toEqual({ completed: 1, total: 1 });
  });

  test("handles indented checkboxes", () => {
    const content = "## Section\n  - [x] Sub-task A\n  - [ ] Sub-task B\n- [x] Top-level";
    expect(parseTaskProgress(content)).toEqual({ completed: 2, total: 3 });
  });
});

describe("readTaskProgress", () => {
  let cleanupAopHome: (() => void) | undefined;
  const repoPath = join(process.cwd(), `tmp-progress-${Date.now()}`);
  const changePath = join(aopPaths.relativeTaskDocs(), "test-change");
  const changeDir = join(repoPath, changePath);

  beforeEach(() => {
    cleanupAopHome = useTestAopHome();
    mkdirSync(changeDir, { recursive: true });
  });

  afterEach(() => {
    cleanupAopHome?.();
    rmSync(repoPath, { recursive: true, force: true });
  });

  test("reads progress from numbered subtask files", () => {
    writeFileSync(join(changeDir, "001-first.md"), "---\nstatus: DONE\n---\n");
    writeFileSync(join(changeDir, "002-second.md"), "---\nstatus: PENDING\n---\n");
    writeFileSync(join(changeDir, "003-third.md"), "---\nstatus: DONE\n---\n");
    expect(readTaskProgress("repo-1", repoPath, changePath)).toEqual({ completed: 2, total: 3 });
  });

  test("returns undefined when no subtask files exist", () => {
    expect(readTaskProgress("repo-1", repoPath, changePath)).toBeUndefined();
  });

  test("returns undefined for nonexistent repo", () => {
    expect(readTaskProgress("repo-1", "/nonexistent-repo", changePath)).toBeUndefined();
  });
});

describe("hasTaskSpec", () => {
  let cleanupAopHome: (() => void) | undefined;
  const repoPath = join(process.cwd(), `tmp-spec-${Date.now()}`);
  const changePath = join(aopPaths.relativeTaskDocs(), "test-change");
  const changeDir = join(repoPath, changePath);

  beforeEach(() => {
    cleanupAopHome = useTestAopHome();
    mkdirSync(changeDir, { recursive: true });
  });

  afterEach(() => {
    cleanupAopHome?.();
    rmSync(repoPath, { recursive: true, force: true });
  });

  test.each(["issues.md", "prd.md", "plan.md"])("returns true when %s exists", (fileName) => {
    writeFileSync(join(changeDir, fileName), "# Spec\n");

    expect(hasTaskSpec("repo-1", repoPath, changePath)).toBe(true);
  });

  test("returns false when no spec docs exist", () => {
    writeFileSync(join(changeDir, "task.md"), "# Task\n");

    expect(hasTaskSpec("repo-1", repoPath, changePath)).toBe(false);
  });
});
