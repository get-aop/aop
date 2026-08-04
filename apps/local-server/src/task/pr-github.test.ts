import { describe, expect, test } from "bun:test";
import {
  type GhPullRequestCheck,
  listPullRequestChecks,
  mergePullRequest,
  summarizePullRequestChecks,
} from "./pr-github.ts";

describe("summarizePullRequestChecks", () => {
  test("reports pending when checks are still running", () => {
    const checks: GhPullRequestCheck[] = [
      {
        name: "ci",
        workflow: "AOP CI",
        state: "IN_PROGRESS",
        bucket: "pending",
        link: "",
        startedAt: null,
        completedAt: null,
        description: null,
      },
      {
        name: "e2e",
        workflow: "AOP E2E Tests",
        state: "SUCCESS",
        bucket: "pass",
        link: "",
        startedAt: null,
        completedAt: null,
        description: null,
      },
    ];

    expect(summarizePullRequestChecks(checks)).toEqual({
      state: "pending",
      pendingCount: 1,
      failingCount: 0,
      successfulCount: 1,
      headline: "Checks are running",
    });
  });

  test("reports failure when any check failed", () => {
    const checks: GhPullRequestCheck[] = [
      {
        name: "ci",
        workflow: "AOP CI",
        state: "FAILURE",
        bucket: "fail",
        link: "",
        startedAt: null,
        completedAt: null,
        description: null,
      },
      {
        name: "e2e",
        workflow: "AOP E2E Tests",
        state: "SUCCESS",
        bucket: "pass",
        link: "",
        startedAt: null,
        completedAt: null,
        description: null,
      },
    ];

    expect(summarizePullRequestChecks(checks)).toEqual({
      state: "failure",
      pendingCount: 0,
      failingCount: 1,
      successfulCount: 1,
      headline: "1 failing, 1 successful checks",
    });
  });
});

describe("listPullRequestChecks", () => {
  test("returns empty list when gh fails", async () => {
    const checks = await listPullRequestChecks(
      async () => ({ exitCode: 1, stdout: "", stderr: "missing" }),
      "/tmp/repo",
      "demo-branch",
    );
    expect(checks).toEqual([]);
  });
});

describe("mergePullRequest", () => {
  test("squash merges the pull request and deletes its branch", async () => {
    const calls: Array<{ args: string[]; cwd: string }> = [];

    const merged = await mergePullRequest(
      async (args, cwd) => {
        calls.push({ args, cwd });
        return { exitCode: 0, stdout: "", stderr: "" };
      },
      "/tmp/repo",
      42,
    );

    expect(merged).toEqual({ ok: true });
    expect(calls).toEqual([
      { args: ["pr", "merge", "42", "--squash", "--delete-branch"], cwd: "/tmp/repo" },
    ]);
  });

  test("merges with an explicit method and can keep the branch", async () => {
    const calls: Array<{ args: string[]; cwd: string }> = [];

    const merged = await mergePullRequest(
      async (args, cwd) => {
        calls.push({ args, cwd });
        return { exitCode: 0, stdout: "", stderr: "" };
      },
      "/tmp/repo",
      42,
      { method: "rebase", deleteBranch: false },
    );

    expect(merged).toEqual({ ok: true });
    expect(calls).toEqual([{ args: ["pr", "merge", "42", "--rebase"], cwd: "/tmp/repo" }]);
  });

  test("adds GitHub admin override when force merging", async () => {
    const calls: Array<{ args: string[]; cwd: string }> = [];

    const merged = await mergePullRequest(
      async (args, cwd) => {
        calls.push({ args, cwd });
        return { exitCode: 0, stdout: "", stderr: "" };
      },
      "/tmp/repo",
      42,
      { force: true },
    );

    expect(merged).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        args: ["pr", "merge", "42", "--squash", "--delete-branch", "--admin"],
        cwd: "/tmp/repo",
      },
    ]);
  });

  test("returns the stderr message when gh cannot merge the pull request", async () => {
    const merged = await mergePullRequest(
      async () => ({ exitCode: 1, stdout: "", stderr: "checks pending" }),
      "/tmp/repo",
      42,
    );

    expect(merged).toEqual({ ok: false, message: "checks pending" });
  });
});
