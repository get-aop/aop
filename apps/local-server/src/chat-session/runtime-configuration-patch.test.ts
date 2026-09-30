import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { RuntimeConfigurationModel } from "@aop/common";
import type { Kysely } from "kysely";
import type { ChatSession, Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createRuntimeConfigurationRepository } from "../runtime-configuration/repository.ts";
import { resolveRuntimeConfigurationPatch } from "./runtime-configuration-patch.ts";
import { NO_PROJECT_COLUMNS } from "./test-utils.ts";

let db: Kysely<Database>;
let world: Awaited<ReturnType<typeof setup>>;

beforeEach(async () => {
  db = await createTestDb();
  world = await setup();
});

afterEach(async () => {
  await db.destroy();
});

const session = (overrides: Partial<ChatSession> = {}): ChatSession => ({
  id: "isess_patch",
  repo_id: null,
  title: "Thread",
  named: true,
  runtime: "claude-code",
  runtime_configuration_id: null,
  model: null,
  reasoning_effort: null,
  runtime_alias: null,
  runtime_session_id: "native-1",
  workspace_path: null,
  fast_mode: false,
  runtime_access_mode: "auto-accept-edits",
  pinned: false,
  settled_override: null,
  settled_at: null,
  last_read_at: null,
  created_at: "2026-09-30T09:00:00.000Z",
  updated_at: "2026-09-30T09:00:00.000Z",
  ...NO_PROJECT_COLUMNS,
  ...overrides,
});

// A runtime configuration with a default model that offers three effort levels, and a second model.
const setup = async () => {
  const configurations = createRuntimeConfigurationRepository(db);
  const provider = await configurations.createProvider({
    name: "My claude",
    command: "/opt/bin/my-claude",
    driver: "claude-code",
  });
  const create = async (
    model: string,
    thinkingLevels: RuntimeConfigurationModel["thinkingLevels"],
  ) => configurations.createModel(provider.id, { description: model, model, thinkingLevels });
  await create("model-a", ["low", "medium", "high"]);
  await create("model-b", ["low"]);
  return { configurations, configurationId: provider.id };
};

// What the engine does on every send: hand the session's own values back and take the result.
const reapply = async (row: ChatSession) => {
  const { configurations, configurationId } = world;
  const result = await resolveRuntimeConfigurationPatch(configurations, row, {
    runtimeConfigurationId: configurationId,
    model: row.model ?? undefined,
    reasoningEffort: row.reasoning_effort ?? undefined,
  });
  if (!result.success) throw new Error(`re-apply failed: ${result.error.code}`);
  return { patch: result.patch, configurationId };
};

describe("re-applying a session's runtime configuration on a send", () => {
  test("a session on the CLI's default model and effort stays there, and takes only the command", async () => {
    const { patch, configurationId } = await reapply(session());

    expect(patch).toMatchObject({
      runtime_configuration_id: configurationId,
      runtime_alias: "/opt/bin/my-claude",
      model: null,
      reasoning_effort: null,
    });
  });

  test("a named model is kept while the effort stays on default", async () => {
    const { patch } = await reapply(session({ model: "model-b", reasoning_effort: null }));

    expect(patch).toMatchObject({ model: "model-b", reasoning_effort: null });
  });

  test("a named effort with no model is judged against the configuration's default model", async () => {
    const kept = await reapply(session({ model: null, reasoning_effort: "high" }));
    const notOffered = await reapply(session({ model: null, reasoning_effort: "max" }));

    expect(kept.patch).toMatchObject({ model: null, reasoning_effort: "high" });
    expect(notOffered.patch.model).toBeNull();
    // Not one of model-a's levels, so it falls back to a level the model has.
    expect(["low", "medium", "high"]).toContain(notOffered.patch.reasoning_effort as string);
  });

  test("a model and an effort that are both named are kept, as before", async () => {
    const { patch } = await reapply(session({ model: "model-a", reasoning_effort: "medium" }));

    expect(patch).toMatchObject({ model: "model-a", reasoning_effort: "medium" });
  });

  test("a named model the configuration no longer offers falls back to its default model", async () => {
    const { patch } = await reapply(session({ model: "gone", reasoning_effort: null }));

    expect(patch).toMatchObject({ model: "model-a", reasoning_effort: null });
  });
});

describe("asking a session on default for a model or an effort", () => {
  test("names it, and leaves the other on default", async () => {
    const { configurations, configurationId } = world;
    const row = session();

    const model = await resolveRuntimeConfigurationPatch(
      configurations,
      row,
      { runtimeConfigurationId: configurationId, model: "model-b" },
      { strictModel: true },
    );
    const effort = await resolveRuntimeConfigurationPatch(
      configurations,
      row,
      { runtimeConfigurationId: configurationId, reasoningEffort: "medium" },
      { strictEffort: true },
    );

    expect(model.success && model.patch).toMatchObject({
      model: "model-b",
      reasoning_effort: null,
    });
    expect(effort.success && effort.patch).toMatchObject({
      model: null,
      reasoning_effort: "medium",
    });
  });

  test("refuses an effort the configuration's default model does not offer", async () => {
    const { configurations, configurationId } = world;

    const refused = await resolveRuntimeConfigurationPatch(
      configurations,
      session(),
      { runtimeConfigurationId: configurationId, reasoningEffort: "max" },
      { strictEffort: true },
    );

    expect(refused).toEqual({ success: false, error: { code: "INVALID_EFFORT" } });
  });
});
