import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createCommandContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb } from "../db/test-utils.ts";
import { createRuntimeProfileRoutes } from "./routes.ts";

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
      name: " Work Codex ",
      baseProvider: "codex-cli",
      command: "cdx",
      model: "vendor/custom-model:v2",
      reasoning: "high",
      fastMode: true,
    });
    expect(createResponse.status).toBe(201);
    const created: AnyJson = await createResponse.json();
    expect(created.profile).toMatchObject({ name: "Work Codex", command: "cdx" });

    const listResponse = await app.request("/api/runtime-profiles");
    expect(((await listResponse.json()) as AnyJson).profiles).toHaveLength(1);

    const patchResponse = await request(`/api/runtime-profiles/${created.profile.id}`, "PATCH", {
      model: "gpt-5.5",
    });
    expect(patchResponse.status).toBe(200);
    expect(((await patchResponse.json()) as AnyJson).profile).toMatchObject({
      name: "Work Codex",
      model: "gpt-5.5",
      fastMode: true,
    });

    expect(
      (await app.request(`/api/runtime-profiles/${created.profile.id}`, { method: "DELETE" }))
        .status,
    ).toBe(204);
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
      name: "Remote Codex",
      baseProvider: "codex-cli",
      command: "codex",
      model: "gpt-5.5",
      reasoning: "high",
      fastMode: false,
      execHostId: "ehost_desktop",
    });
    expect(createResponse.status).toBe(201);
    const created: AnyJson = await createResponse.json();
    expect(created.profile).toMatchObject({
      name: "Remote Codex",
      execHostId: "ehost_desktop",
    });

    const listResponse = await app.request("/api/runtime-profiles");
    expect(((await listResponse.json()) as AnyJson).profiles[0]).toMatchObject({
      execHostId: "ehost_desktop",
    });
  });

  test("rejects a profile bound to an unknown execution host", async () => {
    const response = await request("/api/runtime-profiles", "POST", {
      name: "Missing Host",
      baseProvider: "codex-cli",
      command: "codex",
      model: "gpt-5.5",
      reasoning: "high",
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
      name: "Claude",
      baseProvider: "claude-code",
      command: "claude --flag",
      model: "claude-opus-4-8",
      reasoning: "high",
      fastMode: true,
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: "INVALID_RUNTIME_PROFILE" });

    const input = {
      name: "Codex",
      baseProvider: "codex-cli",
      command: "codex",
      model: "gpt-5.5",
      reasoning: "medium",
      fastMode: false,
    };
    expect((await request("/api/runtime-profiles", "POST", input)).status).toBe(201);
    expect(
      (await request("/api/runtime-profiles", "POST", { ...input, name: "codex" })).status,
    ).toBe(409);
  });

  const request = (path: string, method: string, body: unknown) =>
    app.request(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
});
