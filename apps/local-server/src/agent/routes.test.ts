import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useTestAopHome } from "@aop/infra";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb, createTestRepo } from "../db/test-utils.ts";
import { createAgentRoutes } from "./routes.ts";

describe("agent/routes", () => {
  let cleanupAopHome: (() => void) | undefined;
  let originalHermesHome: string | undefined;
  let hermesHome: string;
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let app: Hono;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    originalHermesHome = process.env.HERMES_HOME;
    hermesHome = await mkdtemp(join(tmpdir(), "aop-hermes-home-"));
    process.env.HERMES_HOME = hermesHome;

    db = await createTestDb();
    ctx = createCommandContext(db);
    app = new Hono();
    app.route("/api/agents", createAgentRoutes(ctx));

    await db
      .insertInto("workflows")
      .values({ id: "workflow-1", name: "workflow-1", definition: "{}" })
      .execute();
    await createTestRepo(db, "repo-1", "/tmp/aop-agent-routes-repo-1");
    await createTestRepo(db, "repo-2", "/tmp/aop-agent-routes-repo-2");
  });

  afterEach(async () => {
    await db.destroy();
    await rm(hermesHome, { recursive: true, force: true });
    cleanupAopHome?.();
    if (originalHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = originalHermesHome;
  });

  test("POST /api/agents creates an agent", async () => {
    const res = await app.request("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "routes-agent",
        role: "developer",
        runtimeProvider: "hermes",
        model: "gpt-5.4",
        workflowId: "workflow-1",
        repoIds: ["repo-1"],
      }),
    });
    const body: AnyJson = await res.json();
    expect(res.status).toBe(201);
    expect(body.agent.name).toBe("routes-agent");
    expect(body.agent.workflowId).toBe("workflow-1");
  });

  test("POST /api/agents creates an OpenCode worker runtime agent", async () => {
    const res = await app.request("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "opencode-k1",
        role: "developer",
        runtimeProvider: "opencode",
        model: "opencode-go/kimi-k2.7-code",
        workflowId: "workflow-1",
        repoIds: ["repo-1"],
      }),
    });
    const body: AnyJson = await res.json();

    expect(res.status).toBe(201);
    expect(body.agent).toEqual(
      expect.objectContaining({
        name: "opencode-k1",
        runtimeProvider: "opencode",
        provider: "opencode:opencode-go/kimi-k2.7-code",
        model: "opencode-go/kimi-k2.7-code",
        sourceKind: "opencode-worker-profile",
      }),
    );
  });

  test("GET /api/agents lists persisted agents", async () => {
    await app.request("/api/agents/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "list-agent",
        role: "developer",
        workflowId: "workflow-1",
        runtimeProvider: "hermes",
        provider: "openai-codex",
        model: "gpt-5.4",
      }),
    });

    const res = await app.request("/api/agents");
    const body: AnyJson = await res.json();
    expect(res.status).toBe(200);
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0]?.name).toBe("list-agent");
  });

  test("PUT /api/agents/:agentId/repos replaces repo memberships", async () => {
    const created = await app.request("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "membership-agent",
        role: "developer",
        runtimeProvider: "hermes",
        model: "gpt-5.4",
        workflowId: "workflow-1",
        repoIds: ["repo-1"],
      }),
    });
    const createdBody: AnyJson = await created.json();

    const res = await app.request(`/api/agents/${createdBody.agent.id}/repos`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoIds: ["repo-1", "repo-2"] }),
    });
    const body: AnyJson = await res.json();
    expect(res.status).toBe(200);
    expect(body.repoIds).toEqual(["repo-1", "repo-2"]);
  });

  test("POST /api/agents/workers registers a worker profile without runtime options", async () => {
    const response = await app.request("/api/agents/workers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "K1",
        role: "developer",
        workflowId: "workflow-1",
        repoIds: ["repo-1"],
      }),
    });
    const body: AnyJson = await response.json();

    expect(response.status).toBe(201);
    expect(body.agent).toEqual(
      expect.objectContaining({
        name: "K1",
        runtimeProvider: "opencode",
        provider: "opencode",
        model: "workflow-defined",
        sourceKind: "opencode-worker-profile",
        sourceRef: null,
        repoIds: ["repo-1"],
      }),
    );
  });

  test("POST /api/agents/workers ignores stale runtime fields", async () => {
    const response = await app.request("/api/agents/workers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "OpenCode K1",
        role: "developer",
        runtimeProvider: "pi",
        workflowId: "workflow-1",
        repoIds: ["repo-1"],
        model: "google/gemini-3-pro",
        profileName: "default",
        reasoningEffort: "low",
        fastMode: true,
      }),
    });
    const body: AnyJson = await response.json();

    expect(response.status).toBe(201);
    expect(body.agent).toEqual(
      expect.objectContaining({
        name: "OpenCode K1",
        runtimeProvider: "opencode",
        provider: "opencode",
        model: "workflow-defined",
        sourceKind: "opencode-worker-profile",
        sourceRef: null,
        repoIds: ["repo-1"],
      }),
    );
  });

  test("GET /api/agents/hermes/profiles returns discoverable Hermes profiles", async () => {
    await seedHermesProfile(hermesHome, "jon-snow");
    const response = await app.request("/api/agents/hermes/profiles");
    const body: AnyJson = await response.json();
    expect(response.status).toBe(200);
    expect(body.profiles).toEqual([
      expect.objectContaining({ name: "jon-snow", provider: "openai-codex", model: "gpt-5.4" }),
    ]);
  });

  test("POST /api/agents/manual creates a manual Hermes-backed agent scaffold", async () => {
    const response = await app.request("/api/agents/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Manual API Agent",
        role: "developer",
        workflowId: "workflow-1",
        runtimeProvider: "hermes",
        provider: "openai-codex",
        model: "gpt-5.4",
      }),
    });
    const body: AnyJson = await response.json();
    expect(response.status).toBe(201);
    expect(body.agent).toEqual(
      expect.objectContaining({ name: "Manual API Agent", sourceKind: "manual" }),
    );
  });

  test("POST /api/agents/hermes/import imports a selected Hermes profile into AOP", async () => {
    await seedHermesProfile(hermesHome, "jinwoo");
    const response = await app.request("/api/agents/hermes/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileName: "jinwoo", role: "architect", workflowId: "workflow-1" }),
    });
    const body: AnyJson = await response.json();
    expect(response.status).toBe(201);
    expect(body.agent).toEqual(
      expect.objectContaining({
        name: "jinwoo",
        sourceKind: "hermes-profile",
        sourceRef: "jinwoo",
      }),
    );
  });
});

const seedHermesProfile = async (hermesHome: string, profileName: string): Promise<void> => {
  const profileRoot = join(hermesHome, "profiles", profileName);
  await mkdir(join(profileRoot, "memories"), { recursive: true });
  await writeFile(
    join(profileRoot, "config.yaml"),
    [
      "model:",
      "  default: gpt-5.4",
      "  provider: openai-codex",
      "terminal:",
      "  cwd: /workspace",
      "",
    ].join("\n"),
  );
  await writeFile(join(profileRoot, "SOUL.md"), `You are ${profileName}.\n`);
  await writeFile(join(profileRoot, "memories", "MEMORY.md"), "# Memory\n");
};
