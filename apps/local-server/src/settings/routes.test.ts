import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb } from "../db/test-utils.ts";
import { createSettingsRoutes } from "./routes.ts";
import { VALID_KEYS } from "./types.ts";

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
    test("returns all settings with defaults", async () => {
      const res = await app.request("/api/settings");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.settings).toBeInstanceOf(Array);
      expect(body.settings.length).toBe(VALID_KEYS.length);

      const maxConcurrent = body.settings.find(
        (s: { key: string }) => s.key === "max_concurrent_tasks",
      );
      expect(maxConcurrent).toBeDefined();
      expect(maxConcurrent.value).toBe("5");

      expect(
        body.settings.find((s: { key: string }) => s.key === "quick_fix_agent_provider"),
      ).toBeUndefined();

      const chatMidRun = body.settings.find((s: { key: string }) => s.key === "chat_mid_run_mode");
      expect(chatMidRun).toEqual({ key: "chat_mid_run_mode", value: "queue" });

      const globalInstructions = body.settings.find(
        (s: { key: string }) => s.key === "chat_global_instructions",
      );
      expect(globalInstructions).toEqual({ key: "chat_global_instructions", value: "" });

      expect(
        body.settings.find((s: { key: string }) => s.key === "pool_observability_only"),
      ).toBeUndefined();
    });

    test("accepts free-text chat_global_instructions", async () => {
      const put = await app.request("/api/settings/chat_global_instructions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "Be concise. No jargon." }),
      });
      expect(put.status).toBe(200);
      expect(await ctx.settingsRepository.get("chat_global_instructions")).toBe(
        "Be concise. No jargon.",
      );
    });

    test("normalizes legacy chat_mid_run_mode steer values to queue", async () => {
      const steer = await app.request("/api/settings/chat_mid_run_mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "steer" }),
      });
      expect(steer.status).toBe(200);
      expect(await steer.json()).toEqual({ ok: true, key: "chat_mid_run_mode", value: "queue" });
      expect(await ctx.settingsRepository.get("chat_mid_run_mode")).toBe("queue");

      await ctx.settingsRepository.set("chat_mid_run_mode", "steer");
      const read = await app.request("/api/settings/chat_mid_run_mode");
      expect(await read.json()).toEqual({ key: "chat_mid_run_mode", value: "queue" });

      const invalid = await app.request("/api/settings/chat_mid_run_mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "interrupt-only" }),
      });
      expect(invalid.status).toBe(400);
    });

    test("masks Jira API tokens", async () => {
      await ctx.settingsRepository.set("jira_api_token", "saved-token");

      const res = await app.request("/api/settings");
      const body: AnyJson = await res.json();
      const token = body.settings.find((s: { key: string }) => s.key === "jira_api_token");

      expect(res.status).toBe(200);
      expect(token).toEqual({ key: "jira_api_token", value: "********" });
    });
  });

  describe("GET /api/settings/:key", () => {
    test("returns setting value for valid key", async () => {
      const res = await app.request("/api/settings/max_concurrent_tasks");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.key).toBe("max_concurrent_tasks");
      expect(body.value).toBe("5");
    });

    test("masks a single Jira API token setting", async () => {
      await ctx.settingsRepository.set("jira_api_token", "saved-token");

      const res = await app.request("/api/settings/jira_api_token");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ key: "jira_api_token", value: "********" });
    });

    test("returns 400 for invalid key", async () => {
      const res = await app.request("/api/settings/invalid_key");
      const body: AnyJson = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Invalid key");
      expect(body.key).toBe("invalid_key");
      expect(body.validKeys).toEqual(VALID_KEYS);
    });
  });

  describe("PUT /api/settings/:key", () => {
    test("updates setting value for valid key", async () => {
      const res = await app.request("/api/settings/max_concurrent_tasks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "5" }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.key).toBe("max_concurrent_tasks");
      expect(body.value).toBe("5");

      const getRes = await app.request("/api/settings/max_concurrent_tasks");
      const getBody: AnyJson = await getRes.json();
      expect(getBody.value).toBe("5");
    });

    test("rejects removed quick-fix settings", async () => {
      const res = await app.request("/api/settings/quick_fix_agent_model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "openai-codex/gpt-5.5" }),
      });
      expect(res.status).toBe(400);
    });

    test("stores but does not echo a Jira API token", async () => {
      const res = await app.request("/api/settings/jira_api_token", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "secret-token" }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ ok: true, key: "jira_api_token", value: "********" });
      expect(await ctx.settingsRepository.get("jira_api_token")).toBe("secret-token");
    });

    test("returns 400 for invalid key", async () => {
      const res = await app.request("/api/settings/invalid_key", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: "test" }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Invalid key");
    });

    test("returns 400 when value is missing", async () => {
      const res = await app.request("/api/settings/max_concurrent_tasks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Missing required field: value");
    });
  });

  describe("PUT /api/settings (bulk)", () => {
    test("saves multiple settings", async () => {
      const res = await app.request("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: [
            { key: "max_concurrent_tasks", value: "10" },
            { key: "agent_timeout_secs", value: "600" },
          ],
        }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.settings).toHaveLength(2);

      const getRes = await app.request("/api/settings/max_concurrent_tasks");
      const getBody: AnyJson = await getRes.json();
      expect(getBody.value).toBe("10");
    });

    test("does not echo Jira API tokens in bulk responses", async () => {
      const res = await app.request("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: [
            { key: "jira_site_url", value: "https://acme.atlassian.net" },
            { key: "jira_api_token", value: "bulk-secret-token" },
          ],
        }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(200);
      expect(body.settings).toContainEqual({ key: "jira_api_token", value: "********" });
      expect(await ctx.settingsRepository.get("jira_api_token")).toBe("bulk-secret-token");
    });

    test("returns 400 when settings field is missing", async () => {
      const res = await app.request("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Missing required field: settings");
    });

    test("returns 400 when any key is invalid", async () => {
      const res = await app.request("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: [
            { key: "max_concurrent_tasks", value: "5" },
            { key: "not_a_real_key", value: "bad" },
          ],
        }),
      });
      const body: AnyJson = await res.json();

      expect(res.status).toBe(400);
      expect(body.error).toBe("Invalid key");
      expect(body.key).toBe("not_a_real_key");
    });
  });

  describe("POST /api/settings/cleanup-worktrees", () => {
    test("does not register the removed cleanup route", async () => {
      const res = await app.request("/api/settings/cleanup-worktrees", { method: "POST" });

      expect(res.status).toBe(404);
    });
  });
});
