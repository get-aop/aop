import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useTestAopHome } from "@aop/infra";
import { createCommandContext } from "../context.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import { type RepoBulkActionDeps, runRepoBulkAction } from "./bulk-actions.ts";

const makeDeps = (overrides: Partial<RepoBulkActionDeps> = {}): RepoBulkActionDeps => ({
  runGit: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  ...overrides,
});

describe("runRepoBulkAction", () => {
  let cleanupAopHome: () => void;

  beforeEach(() => {
    cleanupAopHome = useTestAopHome();
  });

  afterEach(() => {
    cleanupAopHome();
  });

  test("git-pull fast-forwards the repository", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    await createTestRepo(db, "repo-1", "/tmp/aop-bulk-git-pull");

    const result = await runRepoBulkAction(
      ctx,
      "repo-1",
      "git-pull",
      makeDeps({
        runGit: async (args) => {
          expect(args).toEqual(["pull", "--ff-only"]);
          return { exitCode: 0, stdout: "Already up to date.\n", stderr: "" };
        },
      }),
    );

    expect(result).toEqual({
      action: "git-pull",
      total: 1,
      started: 1,
      skipped: 0,
      failed: 0,
      failures: [],
    });
  });

  test("git-pull reports failures without throwing", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    await createTestRepo(db, "repo-1", "/tmp/aop-bulk-git-pull-fail");

    const result = await runRepoBulkAction(
      ctx,
      "repo-1",
      "git-pull",
      makeDeps({
        runGit: async () => ({
          exitCode: 1,
          stdout: "",
          stderr: "fatal: Not possible to fast-forward",
        }),
      }),
    );

    expect(result.failed).toBe(1);
    expect(result.failures[0]?.error).toContain("fast-forward");
  });
});
