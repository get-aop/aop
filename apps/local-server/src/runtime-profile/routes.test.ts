import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createCommandContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb } from "../db/test-utils.ts";
import { createRuntimeProfileRoutes } from "./routes.ts";

const claudeProfile = {
  name: "Work Claude",
  baseProvider: "claude-code",
  command: "cpe",
  model: "claude-opus-5",
  reasoning: "high",
  fastMode: true,
};

describe("runtime profile routes", () => {
  let db: Kysely<Database>;
  let app: Hono;
  let ctx: ReturnType<typeof createCommandContext>;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    app = new Hono();
    app.route("/api/runtime-profiles", createRuntimeProfileRoutes(ctx));
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("creates, lists, partially updates, and deletes a profile", async () => {
    const createResponse = await request("/api/runtime-profiles", "POST", {
      ...claudeProfile,
      name: " Work Claude ",
    });
    expect(createResponse.status).toBe(201);
    const created: AnyJson = await createResponse.json();
    expect(created.profile).toMatchObject({ name: "Work Claude", command: "cpe" });

    const listResponse = await app.request("/api/runtime-profiles");
    expect(((await listResponse.json()) as AnyJson).profiles).toHaveLength(1);

    const patchResponse = await request(`/api/runtime-profiles/${created.profile.id}`, "PATCH", {
      reasoning: "max",
    });
    expect(patchResponse.status).toBe(200);
    expect(((await patchResponse.json()) as AnyJson).profile).toMatchObject({
      name: "Work Claude",
      model: "claude-opus-5",
      reasoning: "max",
      fastMode: true,
    });

    expect(
      (await app.request(`/api/runtime-profiles/${created.profile.id}`, { method: "DELETE" }))
        .status,
    ).toBe(204);
  });

  test("rejects a model change that leaves Fast mode on an unsupported model", async () => {
    const created: AnyJson = await (
      await request("/api/runtime-profiles", "POST", claudeProfile)
    ).json();
    const path = `/api/runtime-profiles/${created.profile.id}`;

    const rejected = await request(path, "PATCH", { model: "claude-opus-4-8" });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({
      code: "INVALID_RUNTIME_PROFILE",
      field: "fastMode",
    });

    const accepted = await request(path, "PATCH", { model: "claude-opus-4-8", fastMode: false });
    expect(accepted.status).toBe(200);
    expect(((await accepted.json()) as AnyJson).profile).toMatchObject({
      model: "claude-opus-4-8",
      fastMode: false,
    });
  });

  test("saves and loads a profile bound to an execution host", async () => {
    await ctx.settingsRepository.set(
      "remote_exec_hosts_json",
      JSON.stringify([
        {
          id: "ehost_desktop",
          name: "Desktop",
          host: "192.168.1.10",
          remoteRoot: "/tmp/aop",
        },
      ]),
    );

    const createResponse = await request("/api/runtime-profiles", "POST", {
      ...claudeProfile,
      name: "Remote Claude",
      command: "claude",
      fastMode: false,
      execHostId: "ehost_desktop",
    });
    expect(createResponse.status).toBe(201);
    const created: AnyJson = await createResponse.json();
    expect(created.profile).toMatchObject({
      name: "Remote Claude",
      execHostId: "ehost_desktop",
    });

    const listResponse = await app.request("/api/runtime-profiles");
    expect(((await listResponse.json()) as AnyJson).profiles[0]).toMatchObject({
      execHostId: "ehost_desktop",
    });
  });

  test("rejects a profile bound to an unknown execution host", async () => {
    const response = await request("/api/runtime-profiles", "POST", {
      ...claudeProfile,
      name: "Missing Host",
      command: "claude",
      fastMode: false,
      execHostId: "ehost_missing",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "UNKNOWN_EXEC_HOST",
      field: "execHostId",
    });
  });

  test("returns field validation errors and duplicate conflicts", async () => {
    const invalid = await request("/api/runtime-profiles", "POST", {
      ...claudeProfile,
      name: "Claude",
      command: "claude --flag",
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: "INVALID_RUNTIME_PROFILE" });

    const input = { ...claudeProfile, name: "Claude", command: "claude", fastMode: false };
    expect((await request("/api/runtime-profiles", "POST", input)).status).toBe(201);
    expect(
      (await request("/api/runtime-profiles", "POST", { ...input, name: "claude" })).status,
    ).toBe(409);
  });

  test.each(["codex-cli", "pi", "grok-build", "opencode"])(
    "rejects a profile with the %s base provider",
    async (baseProvider) => {
      const response = await request("/api/runtime-profiles", "POST", {
        ...claudeProfile,
        baseProvider,
        fastMode: false,
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: "INVALID_RUNTIME_PROFILE",
        field: "baseProvider",
      });
      expect(
        ((await (await app.request("/api/runtime-profiles")).json()) as AnyJson).profiles,
      ).toEqual([]);
    },
  );

  const request = (path: string, method: string, body: unknown) =>
    app.request(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
});
