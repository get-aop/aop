import { beforeEach, describe, expect, test } from "bun:test";
import {
  resetDefaultBranchCacheForTests,
  resolveDefaultBranch,
  resolveMergeBase,
} from "./git-helpers.ts";
import type { RunGit } from "./service.ts";

describe("resolveDefaultBranch", () => {
  beforeEach(() => resetDefaultBranchCacheForTests());

  test("resolves origin/HEAD in one process", async () => {
    const runGit: RunGit = async (args) => {
      expect(args[0]).toBe("for-each-ref");
      return {
        exitCode: 0,
        stdout:
          "refs/remotes/origin/HEAD\trefs/remotes/origin/main\nrefs/heads/main\t\nrefs/heads/master\t\n",
        stderr: "",
      };
    };
    expect(await resolveDefaultBranch(runGit, "/repo")).toBe("main");
  });

  test("prefers local main over master regardless of output order", async () => {
    const runGit: RunGit = async () => ({
      exitCode: 0,
      stdout: "refs/heads/master\t\nrefs/heads/main\t\n",
      stderr: "",
    });
    expect(await resolveDefaultBranch(runGit, "/repo")).toBe("main");
  });

  test("falls back to master when main is absent", async () => {
    const runGit: RunGit = async () => ({
      exitCode: 0,
      stdout: "refs/heads/master\t\n",
      stderr: "",
    });
    expect(await resolveDefaultBranch(runGit, "/repo")).toBe("master");
  });

  test("returns null when lookup fails or is empty", async () => {
    const failed: RunGit = async () => ({ exitCode: 1, stdout: "", stderr: "boom" });
    const empty: RunGit = async () => ({ exitCode: 0, stdout: "\n", stderr: "" });
    expect(await resolveDefaultBranch(failed, "/repo")).toBeNull();
    expect(await resolveDefaultBranch(empty, "/repo")).toBeNull();
  });

  test("reuses a recent default branch lookup for the same workspace", async () => {
    resetDefaultBranchCacheForTests();
    let calls = 0;
    const runGit: RunGit = async () => {
      calls += 1;
      return { exitCode: 0, stdout: "refs/heads/main\t\n", stderr: "" };
    };

    expect(await resolveDefaultBranch(runGit, "/repo")).toBe("main");
    expect(await resolveDefaultBranch(runGit, "/repo")).toBe("main");
    expect(calls).toBe(1);
    resetDefaultBranchCacheForTests();
  });
});

describe("resolveMergeBase", () => {
  test("uses the remote merge-base when available", async () => {
    const calls: string[][] = [];
    const runGit: RunGit = async (args) => {
      calls.push(args);
      if (args.join(" ") === "merge-base HEAD refs/remotes/origin/main") {
        return { exitCode: 0, stdout: "remote-merge-base\n", stderr: "" };
      }
      return { exitCode: 1, stdout: "", stderr: "unexpected command" };
    };

    const mergeBase = await resolveMergeBase(runGit, "/repo/worktree", "main");

    expect(mergeBase).toBe("remote-merge-base");
    expect(calls).toContainEqual(["merge-base", "HEAD", "refs/remotes/origin/main"]);
    expect(calls).not.toContainEqual(["merge-base", "HEAD", "main"]);
  });

  test("falls back to the local branch merge-base", async () => {
    const calls: string[][] = [];
    const runGit: RunGit = async (args) => {
      calls.push(args);
      if (args.join(" ") === "merge-base HEAD refs/remotes/origin/main") {
        return { exitCode: 1, stdout: "", stderr: "missing remote" };
      }
      if (args.join(" ") === "merge-base HEAD main") {
        return { exitCode: 0, stdout: "local-merge-base\n", stderr: "" };
      }
      return { exitCode: 1, stdout: "", stderr: "unexpected command" };
    };

    expect(await resolveMergeBase(runGit, "/repo", "main")).toBe("local-merge-base");
    expect(calls).toHaveLength(2);
  });

  test("returns null when remote and local merge-base both fail", async () => {
    const runGit: RunGit = async () => ({ exitCode: 1, stdout: "", stderr: "fail" });
    expect(await resolveMergeBase(runGit, "/repo", "main")).toBeNull();
  });
});
