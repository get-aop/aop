import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { getAllSettings, getSetting, setAllSettings, setSetting } from "./handlers.ts";
import { DEFAULT_SETTINGS, SettingKey } from "./types.ts";

describe("settings/handlers", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  describe("getAllSettings", () => {
    test("lists exactly the keys live code reads, with their defaults", async () => {
      const result = await getAllSettings(ctx);

      expect(result.settings).toEqual([
        { key: "remote_exec_hosts_json", value: "" },
        { key: "chat_global_instructions", value: "" },
      ]);
      expect(result.settings.map(({ key }) => key).sort()).toEqual(
        Object.keys(DEFAULT_SETTINGS).sort(),
      );
    });

    test("returns a saved value over the default", async () => {
      await ctx.settingsRepository.set(SettingKey.CHAT_GLOBAL_INSTRUCTIONS, "be concise");

      const result = await getAllSettings(ctx);

      expect(result.settings).toContainEqual({
        key: "chat_global_instructions",
        value: "be concise",
      });
    });

    test("ignores stored rows for keys that no longer exist", async () => {
      await db.insertInto("settings").values({ key: "jira_api_token", value: "secret" }).execute();

      const result = await getAllSettings(ctx);

      expect(result.settings.some(({ key }) => key === "jira_api_token")).toBe(false);
    });
  });

  describe("setAllSettings", () => {
    test("saves multiple settings at once", async () => {
      const result = await setAllSettings(ctx, [
        { key: "chat_global_instructions", value: "be concise" },
        { key: "remote_exec_hosts_json", value: "[]" },
      ]);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.settings).toHaveLength(2);
      expect(await ctx.settingsRepository.get("chat_global_instructions")).toBe("be concise");
      expect(await ctx.settingsRepository.get("remote_exec_hosts_json")).toBe("[]");
    });

    test("rejects the batch without writing when any key is invalid", async () => {
      const result = await setAllSettings(ctx, [
        { key: "chat_global_instructions", value: "be concise" },
        { key: "bogus_key", value: "nope" },
      ]);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe("INVALID_KEY");
      expect(result.error.key).toBe("bogus_key");
      expect(await ctx.settingsRepository.get("chat_global_instructions")).toBe("");
    });

    test("handles empty array", async () => {
      const result = await setAllSettings(ctx, []);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.settings).toHaveLength(0);
    });
  });

  describe("setSetting and getSetting", () => {
    test("rejects removed integration, budget, scheduler, and control keys", async () => {
      const removed = [
        "max_concurrent_tasks",
        "fast_mode",
        "agent_timeout_secs",
        "chat_mid_run_mode",
        "linear_client_id",
        "linear_callback_url",
        "jira_site_url",
        "jira_api_token",
        "github_app_private_key",
        "budget_cost_usd",
        "scheduler_enabled",
        "handoff_requires_approval",
        "quick_fix_agent_provider",
        "control_claude_model",
      ];
      for (const key of removed) {
        const setResult = await setSetting(ctx, key, "x");
        expect(setResult).toMatchObject({ success: false, error: { code: "INVALID_KEY", key } });
        expect(await getSetting(ctx, key)).toMatchObject({
          success: false,
          error: { code: "INVALID_KEY", key },
        });
      }
    });

    test("stores remote_exec_hosts_json as a plain setting", async () => {
      const payload = JSON.stringify([
        {
          id: "ehost_1",
          name: "Desktop",
          host: "192.168.1.10",
          remoteRoot: "/tmp/aop",
        },
      ]);
      const setResult = await setSetting(ctx, SettingKey.REMOTE_EXEC_HOSTS, payload);
      expect(setResult).toEqual({
        success: true,
        key: SettingKey.REMOTE_EXEC_HOSTS,
        value: payload,
      });
      expect(await ctx.settingsRepository.get(SettingKey.REMOTE_EXEC_HOSTS)).toBe(payload);

      const getResult = await getSetting(ctx, SettingKey.REMOTE_EXEC_HOSTS);
      expect(getResult).toEqual({
        success: true,
        key: SettingKey.REMOTE_EXEC_HOSTS,
        value: payload,
      });
    });
  });
});
