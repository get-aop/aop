import { describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommandContext } from "../context.ts";
import type { ChatSession } from "../db/schema.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import { executeChatCommand, slashCommandMayReachRuntime } from "./commands.ts";

const baseSession = (repoId: string): ChatSession => ({
  id: "isess_test",
  repo_id: repoId,
  title: "New session",
  named: false,
  runtime: "claude-code",
  runtime_configuration_id: null,
  model: "claude-opus-4-8",
  reasoning_effort: "medium",
  runtime_alias: null,
  runtime_session_id: null,
  workspace_path: null,
  fast_mode: false,
  runtime_access_mode: "full-access",
  default_worker_id: null,
  default_workflow_id: null,
  pinned: false,
  settled_override: null,
  settled_at: null,
  last_read_at: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

describe("executeChatCommand", () => {
  test("returns null for plain messages", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    expect(await executeChatCommand(ctx, baseSession("r1"), "hello there")).toBeNull();
    await db.destroy();
  });

  test("forwards provider-native slash actions to the runtime", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const result = await executeChatCommand(ctx, baseSession("r1"), "/review");
    expect(result?.forwardToRuntime).toBe(true);
    await db.destroy();
  });

  test("does not intercept provider actions that only share an AOP command prefix", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const result = await executeChatCommand(ctx, baseSession("r1"), "/tasking");
    expect(result?.forwardToRuntime).toBe(true);
    await db.destroy();
  });

  test("/alias directs users to Runtime configuration", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const result = await executeChatCommand(ctx, baseSession("r1"), "/alias");
    expect(result?.text).toContain("Runtime configuration");
    expect(result?.forwardToRuntime).toBeUndefined();
    await db.destroy();
  });

  test("/workflow unknown lists available; valid returns card", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const usage = await executeChatCommand(ctx, baseSession("r1"), "/workflow");
    expect(usage?.text).toContain("Usage:");

    const unknown = await executeChatCommand(ctx, baseSession("r1"), "/workflow run no-such-flow");
    expect(unknown?.text).toContain("Unknown workflow");

    await db.destroy();
  });

  test("/skill without name lists discovered skills (none)", async () => {
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const repoPath = join(tmpdir(), `aop-cmd-skill-${crypto.randomUUID()}`);
    await mkdir(repoPath, { recursive: true });
    await createTestRepo(db, "repo_cmd_skill", repoPath);

    const result = await executeChatCommand(ctx, baseSession("repo_cmd_skill"), "/skill");
    expect(result?.text).toMatch(/No discoverable skills|Skills on/);
    expect(result?.forwardToRuntime).toBeUndefined();

    await db.destroy();
  });

  test("slashCommandMayReachRuntime admits unknown and /skill commands", () => {
    expect(slashCommandMayReachRuntime("/review")).toBe(true);
    expect(slashCommandMayReachRuntime("/skill tdd")).toBe(true);
    expect(slashCommandMayReachRuntime("/clear")).toBe(false);
    expect(slashCommandMayReachRuntime("/workflow run ship-it")).toBe(false);
    expect(slashCommandMayReachRuntime("/alias")).toBe(false);
  });
});
