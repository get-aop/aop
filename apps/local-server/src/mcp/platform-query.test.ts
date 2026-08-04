import { describe, expect, test } from "bun:test";
import { createCommandContext } from "../context.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import { getPlatformRepo, listPlatformRepos } from "./platform-query.ts";

describe("mcp platform-query", () => {
  test("lists repos without tools importing repositories", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    await createTestRepo(db, "repo_mcp_1", "/tmp/mcp-repo");

    const repos = await listPlatformRepos(ctx);
    expect(repos.some((repo) => repo.id === "repo_mcp_1")).toBe(true);

    const one = await getPlatformRepo(ctx, "repo_mcp_1");
    expect(one?.id).toBe("repo_mcp_1");

    await db.destroy();
  });
});
