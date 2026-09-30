import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb } from "../db/test-utils.ts";
import { createSettingsRoutes } from "./routes.ts";
import { VALID_KEYS } from "./types.ts";

const putJson = (app: Hono, path: string, body: unknown) =>
  app.request(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("settings/routes", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let app: Hono;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    app = new Hono();
    app.route("/api/settings", createSettingsRoutes(ctx));
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("GET /api/settings", () => {
    test("returns every live setting with its default", async () => {
      const res = await app.request("/api/settings");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.settings).toEqual([
        { key: "chat_global_instructions", value: "" },
        { key: "max_concurrent_runs", value: "4" },
        { key: "update_check", value: "true" },
      ]);
      expect(body.settings).toHaveLength(VALID_KEYS.length);
    });

    test("accepts free-text chat_global_instructions", async () => {
      const put = await putJson(app, "/api/settings/chat_global_instructions", {
        value: "Be concise. No jargon.",
      });
      expect(put.status).toBe(200);
      expect(await ctx.settingsRepository.get("chat_global_instructions")).toBe(
        "Be concise. No jargon.",
      );
    });
  });

  describe("GET /api/settings/:key", () => {
    test("returns setting value for valid key", async () => {
      await ctx.settingsRepository.set("chat_global_instructions", "Be concise.");

      const res = await app.request("/api/settings/chat_global_instructions");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ key: "chat_global_instructions", value: "Be concise." });
    });

    test("returns 400 for invalid key", async () => {
      const res = await app.request("/api/settings/invalid_key");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Invalid key");
      expect(body.key).toBe("invalid_key");
      expect(body.validKeys).toEqual(VALID_KEYS);
    });

    test("returns 400 for a removed key", async () => {
      const res = await app.request("/api/settings/max_concurrent_tasks");

      expect(res.status).toBe(400);
    });
  });

  describe("PUT /api/settings/:key", () => {
    test("updates setting value for valid key", async () => {
      const res = await putJson(app, "/api/settings/chat_global_instructions", { value: "Hi" });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ ok: true, key: "chat_global_instructions", value: "Hi" });

      const getRes = await app.request("/api/settings/chat_global_instructions");
      expect(((await getRes.json()) as AnyJson).value).toBe("Hi");
    });

    test("saves the run cap and starts the turns that now have room", async () => {
      let started = 0;
      const withEffect = new Hono();
      withEffect.route(
        "/api/settings",
        createSettingsRoutes(ctx, {
          runCapChanged: async () => {
            started += 1;
          },
        }),
      );

      const res = await putJson(withEffect, "/api/settings/max_concurrent_runs", { value: "2" });

      expect(res.status).toBe(200);
      expect(await ctx.settingsRepository.get("max_concurrent_runs")).toBe("2");
      expect(started).toBe(1);
    });

    test("refuses a run cap that is not a whole number from 1 to 32, keeping the old one", async () => {
      for (const value of ["0", "99", "lots"]) {
        const res = await putJson(app, "/api/settings/max_concurrent_runs", { value });
        const body: AnyJson = await res.json();

        expect(res.status).toBe(400);
        expect(body).toEqual({
          error: "Invalid value",
          key: "max_concurrent_runs",
          message: "max_concurrent_runs must be a whole number from 1 to 32",
        });
      }
      const bulk = await putJson(app, "/api/settings", {
        settings: [{ key: "max_concurrent_runs", value: "0" }],
      });
      expect(bulk.status).toBe(400);
      expect(((await bulk.json()) as AnyJson).error).toBe("Invalid value");
      expect(await ctx.settingsRepository.get("max_concurrent_runs")).toBe("4");
    });

    test("rejects removed keys such as Jira credentials", async () => {
      const res = await putJson(app, "/api/settings/jira_api_token", { value: "secret" });

      expect(res.status).toBe(400);
      expect(await ctx.settingsRepository.getAll()).not.toContainEqual({
        key: "jira_api_token",
        value: "secret",
      });
    });

    test("returns 400 for invalid key", async () => {
      const res = await putJson(app, "/api/settings/invalid_key", { value: "test" });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Invalid key");
    });

    test("returns 400 when value is missing", async () => {
      const res = await putJson(app, "/api/settings/chat_global_instructions", {});
      const body: AnyJson = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Missing required field: value");
    });
  });

  describe("PUT /api/settings (bulk)", () => {
    test("saves multiple settings", async () => {
      const res = await putJson(app, "/api/settings", {
        settings: [
          { key: "chat_global_instructions", value: "Hi" },
          { key: "max_concurrent_runs", value: "2" },
        ],
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.settings).toHaveLength(2);
      expect(await ctx.settingsRepository.get("chat_global_instructions")).toBe("Hi");
    });

    test("returns 400 when settings field is missing", async () => {
      const res = await putJson(app, "/api/settings", {});
      const body: AnyJson = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Missing required field: settings");
    });

    test("returns 400 and writes nothing when any key is invalid", async () => {
      const res = await putJson(app, "/api/settings", {
        settings: [
          { key: "chat_global_instructions", value: "Hi" },
          { key: "not_a_real_key", value: "bad" },
        ],
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Invalid key");
      expect(body.key).toBe("not_a_real_key");
      expect(await ctx.settingsRepository.get("chat_global_instructions")).toBe("");
    });
  });

  describe("POST /api/settings/cleanup-worktrees", () => {
    test("does not register the removed cleanup route", async () => {
      const res = await app.request("/api/settings/cleanup-worktrees", { method: "POST" });

      expect(res.status).toBe(404);
    });
  });
});
