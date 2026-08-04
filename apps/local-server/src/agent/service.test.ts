import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aopPaths, useTestAopHome } from "@aop/infra";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import { type AgentService, createAgentService } from "./service.ts";

describe("agent/service", () => {
  let cleanupAopHome: (() => void) | undefined;
  let originalHermesHome: string | undefined;
  let hermesHome: string;
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let service: AgentService;

  beforeEach(async () => {
    cleanupAopHome = useTestAopHome();
    originalHermesHome = process.env.HERMES_HOME;
    hermesHome = await mkdtemp(join(tmpdir(), "aop-hermes-home-"));
    process.env.HERMES_HOME = hermesHome;
    db = await createTestDb();
    ctx = createCommandContext(db);
    service = createAgentService(ctx);
    await seedWorkflow(db, "workflow-1");
    await seedWorkflow(db, "aop-default-gpt");
    await seedWorkflow(db, "simple");
    await createTestRepo(db, "repo-1", "/tmp/aop-agent-service-repo-1");
    await createTestRepo(db, "repo-2", "/tmp/aop-agent-service-repo-2");
  });

  afterEach(async () => {
    await db.destroy();
    await rm(hermesHome, { recursive: true, force: true });
    cleanupAopHome?.();
    if (originalHermesHome === undefined) delete process.env.HERMES_HOME;
    else process.env.HERMES_HOME = originalHermesHome;
  });

  test("can create an agent with a persisted workflow attachment", async () => {
    const result = await service.createAgent({
      name: "hermes-dev-1",
      role: "developer",
      runtimeProvider: "hermes",
      model: "gpt-5.4",
      workflowId: "workflow-1",
      repoIds: ["repo-1"],
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected createAgent to succeed");
    expect(result.agent.workflowId).toBe("workflow-1");
    expect(result.agent.repoIds).toEqual(["repo-1"]);
    const persisted = await db
      .selectFrom("agents")
      .select(["workflow_id", "provider", "source_kind"])
      .where("id", "=", result.agent.id)
      .executeTakeFirstOrThrow();
    expect(persisted.workflow_id).toBe("workflow-1");
    expect(persisted.provider).toBe("openai-codex");
    expect(persisted.source_kind).toBe("manual");
    expect(existsSync(join(aopPaths.agent(result.agent.id), "agent.json"))).toBe(true);
    const agentArtifact = JSON.parse(
      readFileSync(join(aopPaths.agent(result.agent.id), "agent.json"), "utf8"),
    ) as { workflowId: string };
    expect(agentArtifact.workflowId).toBe("workflow-1");
  });

  test("creates a worker profile without storing runtime execution options", async () => {
    const result = await service.createWorkerProfile({
      name: "K1",
      role: "developer",
      workflowId: "workflow-1",
      repoIds: ["repo-1", "repo-2"],
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected createWorkerProfile to succeed");
    expect(result.agent).toMatchObject({
      name: "K1",
      runtimeProvider: "opencode",
      provider: "opencode",
      model: "workflow-defined",
      workflowId: "workflow-1",
      sourceKind: "opencode-worker-profile",
      sourceRef: null,
      repoIds: ["repo-1", "repo-2"],
    });

    const agentDir = aopPaths.agent(result.agent.id);
    expect(await Bun.file(join(agentDir, "agent.json")).exists()).toBe(true);
    expect(await Bun.file(join(agentDir, "soul.md")).exists()).toBe(false);
    expect(await Bun.file(join(agentDir, "memory.md")).exists()).toBe(false);

    const runtimeSettings = (await Bun.file(
      join(agentDir, "runtime", "opencode", "settings.json"),
    ).json()) as Record<string, unknown>;
    expect(runtimeSettings).toMatchObject({
      provider: "opencode",
      model: "workflow-defined",
      profileName: null,
      reasoningEffort: null,
      fastMode: false,
    });
  });

  test("ignores stale worker runtime fields from older clients", async () => {
    const result = await service.createWorkerProfile({
      name: "Default OpenCode",
      role: "developer",
      runtimeProvider: "pi",
      workflowId: "workflow-1",
      repoIds: ["repo-1"],
      model: "google/gemini-3-pro",
      profileName: "default",
      reasoningEffort: "high",
      fastMode: true,
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected createWorkerProfile to succeed");
    expect(result.agent).toMatchObject({
      name: "Default OpenCode",
      runtimeProvider: "opencode",
      provider: "opencode",
      model: "workflow-defined",
      sourceKind: "opencode-worker-profile",
      sourceRef: null,
    });
  });

  test("persists autoDistributeDisabled when creating and updating a worker profile", async () => {
    const created = await service.createWorkerProfile({
      name: "Distribute Toggle",
      role: "developer",
      workflowId: "workflow-1",
      repoIds: ["repo-1"],
      autoDistributeDisabled: true,
    });

    expect(created.success).toBe(true);
    if (!created.success) throw new Error("expected createWorkerProfile to succeed");
    expect(created.agent.autoDistributeDisabled).toBe(true);

    const enabled = await service.updateAgent(created.agent.id, { autoDistributeDisabled: false });
    expect(enabled.success).toBe(true);
    if (!enabled.success) throw new Error("expected updateAgent to succeed");
    expect(enabled.agent.autoDistributeDisabled).toBe(false);

    const persisted = await db
      .selectFrom("agents")
      .select(["auto_distribute_disabled"])
      .where("id", "=", created.agent.id)
      .executeTakeFirstOrThrow();
    expect(persisted).toMatchObject({ auto_distribute_disabled: 0 });
  });

  test("preserves worker repo memberships when they change", async () => {
    const result = await service.createWorkerProfile({
      name: "K2",
      role: "developer",
      workflowId: "workflow-1",
      repoIds: ["repo-1"],
    });

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected createWorkerProfile to succeed");

    const replaced = await service.replaceAgentRepos(result.agent.id, ["repo-2"]);
    expect(replaced.success).toBe(true);

    const runtimeSettings = (await Bun.file(
      join(aopPaths.agent(result.agent.id), "runtime", "opencode", "settings.json"),
    ).json()) as Record<string, unknown>;
    expect(runtimeSettings).toMatchObject({
      model: "workflow-defined",
      profileName: null,
      reasoningEffort: null,
      fastMode: false,
    });
  });

  test("an agent can belong to multiple repos", async () => {
    const result = await service.createAgent({
      name: "multi-repo-agent",
      role: "developer",
      runtimeProvider: "hermes",
      model: "gpt-5.4",
      workflowId: "workflow-1",
      repoIds: ["repo-1", "repo-2"],
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected createAgent to succeed");
    const memberships = await db
      .selectFrom("agent_repo_memberships")
      .select(["repo_id", "membership_role"])
      .where("agent_id", "=", result.agent.id)
      .orderBy("repo_id")
      .execute();
    expect(memberships).toEqual([
      { repo_id: "repo-1", membership_role: "primary" },
      { repo_id: "repo-2", membership_role: "secondary" },
    ]);
  });

  test("bootstraps a private channel for the agent", async () => {
    const result = await service.createAgent({
      name: "channel-agent",
      role: "developer",
      runtimeProvider: "hermes",
      model: "gpt-5.4",
      workflowId: "workflow-1",
      repoIds: ["repo-1"],
    });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected createAgent to succeed");
    const channel = await db
      .selectFrom("channels")
      .select(["id", "kind", "owner_agent_id", "artifact_path"])
      .where("owner_agent_id", "=", result.agent.id)
      .executeTakeFirstOrThrow();
    expect(channel.kind).toBe("private");
    expect(channel.id).toBe(result.agent.privateChannelId);
    const memberships = await db
      .selectFrom("channel_memberships")
      .selectAll()
      .where("channel_id", "=", channel.id)
      .execute();
    expect(memberships).toHaveLength(1);
    expect(memberships[0]?.agent_id).toBe(result.agent.id);
  });

  test("creates the manual agent scaffold and persists the attached workflow", async () => {
    const result = await createAgentService(ctx).createManualAgent({
      name: "Manual Hermes",
      role: "developer",
      workflowId: "aop-default-gpt",
      runtimeProvider: "hermes",
      provider: "openai-codex",
      model: "gpt-5.4",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const agentDir = aopPaths.agent(result.agent.id);
    expect(await Bun.file(join(agentDir, "agent.json")).exists()).toBe(true);
    expect(await Bun.file(join(agentDir, "soul.md")).exists()).toBe(true);
    expect(await Bun.file(join(agentDir, "memory.md")).exists()).toBe(true);
    expect(await Bun.file(join(agentDir, "workflow.json")).exists()).toBe(true);
    expect(await Bun.file(join(agentDir, "runtime", "hermes", "profile.json")).exists()).toBe(true);
    expect(await Bun.file(join(agentDir, "runtime", "hermes", "settings.json")).exists()).toBe(
      true,
    );
  });

  test("resolves manual agent workflows by workflow name when the picker submits names", async () => {
    await seedWorkflow(db, "workflow-db-2", "aop-implement");

    const result = await createAgentService(ctx).createManualAgent({
      name: "Named Workflow Agent",
      role: "developer",
      workflowId: "aop-implement",
      runtimeProvider: "hermes",
      provider: "openai-codex",
      model: "gpt-5.4",
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.agent.workflowId).toBe("workflow-db-2");
  });

  test("updates an existing agent workflow by workflow name and persists the resolved workflow id", async () => {
    await seedWorkflow(db, "workflow-db-2", "aop-implement");

    const created = await service.createManualAgent({
      name: "Workflow Update Agent",
      role: "developer",
      workflowId: "aop-default-gpt",
      runtimeProvider: "hermes",
      provider: "openai-codex",
      model: "gpt-5.4",
    });

    expect(created.success).toBe(true);
    if (!created.success) return;

    const updated = await service.updateAgent(created.agent.id, {
      workflowId: "aop-implement",
    });

    expect(updated.success).toBe(true);
    if (!updated.success) return;
    expect(updated.agent.workflowId).toBe("workflow-db-2");

    const persisted = await db
      .selectFrom("agents")
      .select("workflow_id")
      .where("id", "=", created.agent.id)
      .executeTakeFirstOrThrow();
    expect(persisted.workflow_id).toBe("workflow-db-2");
  });

  test("hydrates workflowName for dashboard labels while workflowId stays the persisted key", async () => {
    await seedWorkflow(db, "wf-uuid-simple", "simple-labeled");

    const created = await service.createWorkerProfile({
      name: "Zed Label",
      role: "developer",
      workflowId: "simple-labeled",
      repoIds: ["repo-1"],
    });
    expect(created.success).toBe(true);
    if (!created.success) return;

    const listed = await service.listAgents();
    const agent = listed.find((entry) => entry.id === created.agent.id);
    expect(agent?.workflowId).toBe("wf-uuid-simple");
    expect(agent?.workflowName).toBe("simple-labeled");
  });

  test("discovers the default and named Hermes profiles", async () => {
    await seedHermesProfile(hermesHome, "default", {
      model: "gpt-5.4",
      provider: "openai-codex",
      cwd: "/workspace/default",
    });
    await seedHermesProfile(hermesHome, "jinwoo", {
      model: "claude-sonnet-4-6",
      provider: "anthropic",
      cwd: "/workspace/jinwoo",
    });
    const result = await createAgentService(ctx).listHermesProfiles();
    expect(result.map((profile) => profile.name)).toEqual(["default", "jinwoo"]);
  });

  test("imports a Hermes profile into AOP using a copied metadata snapshot", async () => {
    await seedHermesProfile(hermesHome, "jinwoo", {
      model: "gpt-5.4",
      provider: "openai-codex",
      cwd: "/workspace/jinwoo",
      soul: "You are Jinwoo.\n",
      memory: "# Memory\n- Keep architecture notes here.\n",
    });
    const result = await service.integrateHermesProfile({
      profileName: "jinwoo",
      role: "architect",
      workflowId: "simple",
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const agentDir = aopPaths.agent(result.agent.id);
    const importedSoul = await readFile(join(agentDir, "soul.md"), "utf-8");
    const importedMemory = await readFile(join(agentDir, "memory.md"), "utf-8");
    const runtimeProfile = (await Bun.file(
      join(agentDir, "runtime", "hermes", "profile.json"),
    ).json()) as Record<string, unknown>;
    expect(importedSoul).toBe("You are Jinwoo.\n");
    expect(importedMemory).toBe("# Memory\n- Keep architecture notes here.\n");
    expect(runtimeProfile.importStrategy).toBe("metadata-snapshot");
    expect(runtimeProfile.profileName).toBe("jinwoo");
    await writeFile(join(hermesHome, "profiles", "jinwoo", "SOUL.md"), "Mutated later\n");
    expect(await readFile(join(agentDir, "soul.md"), "utf-8")).toBe("You are Jinwoo.\n");
  });

  test("reclaims a worker name still held by a legacy archived profile", async () => {
    const created = await service.createWorkerProfile({
      name: "Neo",
      role: "developer",
      workflowId: "workflow-1",
      repoIds: ["repo-1"],
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error("expected createWorkerProfile to succeed");

    await db
      .updateTable("agents")
      .set({ status: "archived" })
      .where("id", "=", created.agent.id)
      .execute();

    const recreated = await service.createWorkerProfile({
      name: "Neo",
      role: "developer",
      workflowId: "workflow-1",
      repoIds: ["repo-1"],
    });
    expect(recreated.success).toBe(true);
    if (!recreated.success) throw new Error("expected createWorkerProfile to succeed");
    expect(recreated.agent.id).not.toBe(created.agent.id);

    const archivedRow = await db
      .selectFrom("agents")
      .select(["name", "status"])
      .where("id", "=", created.agent.id)
      .executeTakeFirstOrThrow();
    expect(archivedRow.status).toBe("archived");
    expect(archivedRow.name).toContain("__archived__");
  });

  test("allows reusing a worker name after the previous profile was archived", async () => {
    const created = await service.createWorkerProfile({
      name: "Atlas",
      role: "developer",
      workflowId: "workflow-1",
      repoIds: ["repo-1"],
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error("expected createWorkerProfile to succeed");

    const archived = await service.updateAgent(created.agent.id, { status: "archived" });
    expect(archived.success).toBe(true);

    const recreated = await service.createWorkerProfile({
      name: "Atlas",
      role: "developer",
      workflowId: "workflow-1",
      repoIds: ["repo-1"],
    });
    expect(recreated.success).toBe(true);
    if (!recreated.success) throw new Error("expected createWorkerProfile to succeed");
    expect(recreated.agent.id).not.toBe(created.agent.id);
  });
});

const seedWorkflow = async (db: Kysely<Database>, id: string, name = id): Promise<void> => {
  await db.insertInto("workflows").values({ id, name, definition: "{}" }).execute();
};

const seedHermesProfile = async (
  hermesHome: string,
  profileName: string,
  options: { model: string; provider: string; cwd: string; soul?: string; memory?: string },
): Promise<void> => {
  const profileRoot =
    profileName === "default" ? hermesHome : join(hermesHome, "profiles", profileName);
  await mkdir(join(profileRoot, "memories"), { recursive: true });
  await writeFile(
    join(profileRoot, "config.yaml"),
    [
      "model:",
      `  default: ${options.model}`,
      `  provider: ${options.provider}`,
      "agent:",
      "  reasoning_effort: medium",
      "terminal:",
      `  cwd: ${options.cwd}`,
      "",
    ].join("\n"),
  );
  await writeFile(join(profileRoot, "SOUL.md"), options.soul ?? `You are ${profileName}.\n`);
  await writeFile(
    join(profileRoot, "memories", "MEMORY.md"),
    options.memory ?? `# Memory\n- Imported from ${profileName}.\n`,
  );
};
