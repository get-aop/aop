import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { useTestAopHome } from "@aop/infra";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb, createTestRepo } from "../db/test-utils.ts";
import * as bulkActions from "./bulk-actions.ts";

const realRunRepoBulkAction = bulkActions.runRepoBulkAction;

const mockRunRepoBulkAction = mock();
mock.module("./bulk-actions.ts", () => ({
  runRepoBulkAction: mockRunRepoBulkAction,
}));

const { createRepoRoutes } = await import("../repo/routes.ts");

afterAll(() => {
  mock.module("./bulk-actions.ts", () => ({ runRepoBulkAction: realRunRepoBulkAction }));
});

describe("task/routes bulk action wiring", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let app: Hono;
  let cleanupAopHome: () => void;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    db = await createTestDb();
    ctx = createCommandContext(db);
    app = new Hono();
    app.route("/api/repos", createRepoRoutes(ctx));
    mockRunRepoBulkAction.mockReset();
  });

  afterEach(async () => {
    await db.destroy();
    cleanupAopHome();
  });

  test("accepts git-pull as a repo action", async () => {
    await createTestRepo(db, "repo-1", "/path/to/repo");
    const result = {
      action: "git-pull",
      total: 1,
      started: 1,
      skipped: 0,
      failed: 0,
      failures: [],
    };
    mockRunRepoBulkAction.mockResolvedValue(result);

    const res = await app.request("/api/repos/repo-1/tasks/bulk/git-pull", { method: "POST" });
    const body: AnyJson = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual(result);
    expect(mockRunRepoBulkAction).toHaveBeenCalledWith(ctx, "repo-1", "git-pull");
  });

  test("rejects removed PR bulk actions", async () => {
    await createTestRepo(db, "repo-1", "/path/to/repo");

    const res = await app.request("/api/repos/repo-1/tasks/bulk/merge", { method: "POST" });
    const body: AnyJson = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("action");
    expect(mockRunRepoBulkAction).not.toHaveBeenCalled();
  });
});
