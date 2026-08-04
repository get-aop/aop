import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { useTestAopHome } from "@aop/infra";
import { createCommandContext } from "../context.ts";
import { createTestDb, createTestRepo, createTestTask } from "../db/test-utils.ts";
import * as prGithub from "./pr-github.ts";

mock.module("./pr-github.ts", () => ({
  ...prGithub,
  isGhAuthenticated: async () => true,
}));

const { getTaskPullRequestStatus } = await import("./pull-request-checks.ts");

import type { RunGh } from "./pr-github.ts";

describe("getTaskPullRequestStatus", () => {
  let cleanupAopHome: () => void;

  beforeEach(() => {
    cleanupAopHome = useTestAopHome();
  });

  afterEach(() => {
    mock.restore();
    cleanupAopHome();
  });

  test("returns hasPullRequest false when no PR exists for the branch", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    await createTestRepo(db, "repo-1", "/tmp/aop-pr-status");
    await createTestTask(db, "task-1", "repo-1", "docs/tasks/demo-task", "DONE");

    const runGh: RunGh = async (args) => {
      if (args[0] === "pr" && args[1] === "list") {
        return { exitCode: 0, stdout: "[]", stderr: "" };
      }
      return { exitCode: 1, stdout: "", stderr: "unexpected gh call" };
    };

    const result = await getTaskPullRequestStatus(ctx, "task-1", runGh);
    expect(result).toEqual({
      success: true,
      branchName: "demo-task",
      hasPullRequest: false,
      pullRequestUrl: null,
      pullRequestNumber: null,
      pullRequestState: null,
      checksState: null,
      baseRefName: null,
      needsBranchUpdate: false,
      baseBehindCount: 0,
    });
  });

  test("returns hasPullRequest true when a PR exists for the branch", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    await createTestRepo(db, "repo-1", "/tmp/aop-pr-status-existing");
    await createTestTask(db, "task-1", "repo-1", "docs/tasks/demo-task", "DONE");

    const runGh: RunGh = async (args) => {
      if (args[0] === "pr" && args[1] === "list") {
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              number: 42,
              url: "https://github.com/get-aop/aop-mono/pull/42",
              state: "OPEN",
              title: "Demo Task",
            },
          ]),
          stderr: "",
        };
      }
      return { exitCode: 1, stdout: "", stderr: "unexpected gh call" };
    };

    const result = await getTaskPullRequestStatus(ctx, "task-1", runGh);
    expect(result).toEqual({
      success: true,
      branchName: "demo-task",
      hasPullRequest: true,
      pullRequestUrl: "https://github.com/get-aop/aop-mono/pull/42",
      pullRequestNumber: 42,
      pullRequestState: "OPEN",
      checksState: "pending",
      baseRefName: null,
      needsBranchUpdate: false,
      baseBehindCount: 0,
    });
  });

  test("returns failing checks state for an existing pull request", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    await createTestRepo(db, "repo-1", "/tmp/aop-pr-status-failing-checks");
    await createTestTask(db, "task-1", "repo-1", "docs/tasks/demo-task", "DONE");

    const runGh: RunGh = async (args) => {
      if (args[0] === "pr" && args[1] === "list") {
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              number: 42,
              url: "https://github.com/get-aop/aop-mono/pull/42",
              state: "OPEN",
              title: "Demo Task",
            },
          ]),
          stderr: "",
        };
      }
      if (args[0] === "pr" && args[1] === "checks") {
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              name: "test",
              workflow: "ci",
              state: "FAILURE",
              bucket: "fail",
              link: "https://github.com/get-aop/aop-mono/actions/runs/1",
              startedAt: null,
              completedAt: null,
              description: null,
            },
          ]),
          stderr: "",
        };
      }
      return { exitCode: 1, stdout: "", stderr: "unexpected gh call" };
    };

    const result = await getTaskPullRequestStatus(ctx, "task-1", runGh);
    expect(result).toMatchObject({
      success: true,
      hasPullRequest: true,
      checksState: "failure",
    });
  });

  test("reports when an open pull request branch is behind its base", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    await createTestRepo(db, "repo-1", "/tmp/aop-pr-status-behind-base");
    await createTestTask(db, "task-1", "repo-1", "docs/tasks/demo-task", "DONE");

    const runGh: RunGh = async (args) => {
      if (args[0] === "pr" && args[1] === "list") {
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              number: 42,
              url: "https://github.com/get-aop/aop-mono/pull/42",
              state: "OPEN",
              title: "Demo Task",
              baseRefName: "main",
              headRefName: "demo-task",
            },
          ]),
          stderr: "",
        };
      }
      if (args[0] === "pr" && args[1] === "checks") {
        return { exitCode: 0, stdout: "[]", stderr: "" };
      }
      return { exitCode: 1, stdout: "", stderr: "unexpected gh call" };
    };
    const runGit = mock(async (args: string[]) => {
      if (args[0] === "fetch") return { exitCode: 0, stdout: "", stderr: "" };
      if (args[0] === "rev-list") return { exitCode: 0, stdout: "2\n", stderr: "" };
      return { exitCode: 1, stdout: "", stderr: "unexpected git call" };
    });

    const result = await getTaskPullRequestStatus(ctx, "task-1", runGh, runGit);

    expect(result).toMatchObject({
      success: true,
      baseRefName: "main",
      needsBranchUpdate: true,
      baseBehindCount: 2,
    });
  });
});
