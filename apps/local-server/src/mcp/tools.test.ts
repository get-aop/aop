import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import { callAopMcpTool, isAopMcpTool, listAopMcpTools } from "./tools.ts";

describe("aop MCP tools", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ctx = createCommandContext(await createTestDb());
    db = ctx.db;
    cleanup = async () => {
      await db.destroy();
    };
    await createTestRepo(db, "repo-mcp-1", "mcp-repo");
  });

  afterEach(async () => {
    await cleanup();
  });

  test("lists only workflow, repo, and workspace tools", () => {
    const names = listAopMcpTools().map((tool) => tool.name);
    expect(names.sort()).toEqual([
      "aop_list_repos",
      "aop_list_workflows",
      "aop_set_chat_workspace",
    ]);
    expect(isAopMcpTool("aop_create_task")).toBe(false);
  });

  test("read tools return live catalog data from real services", async () => {
    const repos = await callAopMcpTool(ctx, "aop_list_repos", {});
    const repoList = (repos.content as { repos: Array<{ id: string }> }).repos;
    expect(repoList.some((repo) => repo.id === "repo-mcp-1")).toBe(true);

    const workflows = await callAopMcpTool(ctx, "aop_list_workflows", {});
    expect((workflows.content as { workflows: string[] }).workflows).toEqual([]);
  });
});
