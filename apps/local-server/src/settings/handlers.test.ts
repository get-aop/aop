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
        { key: "agent_cli_auto_update", value: "false" },
        { key: "agent_cli_check_interval_minutes", value: "60" },
        { key: "agent_cli_skip_permissions", value: "false" },
        { key: "chat_global_instructions", value: "" },
        { key: "display_name", value: "" },
        { key: "max_concurrent_runs", value: "4" },
        { key: "routine_max_active_per_project", value: "10" },
        { key: "routine_min_interval_minutes", value: "15" },
        { key: "update_check", value: "true" },
        { key: "update_auto_apply", value: "false" },
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
        { key: "max_concurrent_runs", value: "2" },
      ]);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.settings).toHaveLength(2);
      expect(await ctx.settingsRepository.get("chat_global_instructions")).toBe("be concise");
      expect(await ctx.settingsRepository.get("max_concurrent_runs")).toBe("2");
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

    test("max_concurrent_runs takes a whole number from 1 to 32 and nothing else", async () => {
      for (const value of ["1", "4", "32"]) {
        expect(await setSetting(ctx, "max_concurrent_runs", value)).toMatchObject({
          success: true,
          value,
        });
        expect(await ctx.settingsRepository.get(SettingKey.MAX_CONCURRENT_RUNS)).toBe(value);
      }
      for (const value of ["0", "33", "-1", "2.5", "many", "", " 3", "03", "1e1"]) {
        expect(await setSetting(ctx, "max_concurrent_runs", value)).toEqual({
          success: false,
          error: {
            code: "INVALID_VALUE",
            key: "max_concurrent_runs",
            message: "max_concurrent_runs must be a whole number from 1 to 32",
          },
        });
      }
      expect(await ctx.settingsRepository.get(SettingKey.MAX_CONCURRENT_RUNS)).toBe("32");
    });

    test("update_check is on until the person turns it off, and takes only true or false", async () => {
      expect(await ctx.settingsRepository.get(SettingKey.UPDATE_CHECK)).toBe("true");

      expect(await setSetting(ctx, "update_check", "false")).toMatchObject({ success: true });
      expect(await ctx.settingsRepository.get(SettingKey.UPDATE_CHECK)).toBe("false");
      expect(await setSetting(ctx, "update_check", "off")).toEqual({
        success: false,
        error: {
          code: "INVALID_VALUE",
          key: "update_check",
          message: 'update_check must be "true" or "false"',
        },
      });
      expect(await ctx.settingsRepository.get(SettingKey.UPDATE_CHECK)).toBe("false");
    });

    test("agent CLI checks run hourly by default, 0 turns them off, and the range is checked", async () => {
      expect(await ctx.settingsRepository.get(SettingKey.AGENT_CLI_CHECK_INTERVAL)).toBe("60");

      expect(await setSetting(ctx, "agent_cli_check_interval_minutes", "0")).toMatchObject({
        success: true,
      });
      expect(await setSetting(ctx, "agent_cli_check_interval_minutes", "1440")).toMatchObject({
        success: true,
      });
      for (const value of ["-5", "1441", "1.5", "hourly", ""]) {
        expect(await setSetting(ctx, "agent_cli_check_interval_minutes", value)).toEqual({
          success: false,
          error: {
            code: "INVALID_VALUE",
            key: "agent_cli_check_interval_minutes",
            message:
              "agent_cli_check_interval_minutes must be a whole number of minutes from 0 to 1440",
          },
        });
      }
      expect(await ctx.settingsRepository.get(SettingKey.AGENT_CLI_CHECK_INTERVAL)).toBe("1440");
    });

    test("agent CLI auto-update is off until the person turns it on, and takes only true or false", async () => {
      expect(await ctx.settingsRepository.get(SettingKey.AGENT_CLI_AUTO_UPDATE)).toBe("false");
      expect(await setSetting(ctx, "agent_cli_auto_update", "true")).toMatchObject({
        success: true,
      });
      expect(await setSetting(ctx, "agent_cli_auto_update", "yes")).toMatchObject({
        success: false,
        error: { message: 'agent_cli_auto_update must be "true" or "false"' },
      });
      expect(await ctx.settingsRepository.get(SettingKey.AGENT_CLI_AUTO_UPDATE)).toBe("true");
    });

    test("skipping permission checks is off until the owner turns it on, and takes only true or false", async () => {
      expect(await ctx.settingsRepository.get(SettingKey.AGENT_CLI_SKIP_PERMISSIONS)).toBe("false");
      expect(await setSetting(ctx, "agent_cli_skip_permissions", "on")).toMatchObject({
        success: false,
        error: { message: 'agent_cli_skip_permissions must be "true" or "false"' },
      });
      expect(await ctx.settingsRepository.get(SettingKey.AGENT_CLI_SKIP_PERMISSIONS)).toBe("false");
      expect(await setSetting(ctx, "agent_cli_skip_permissions", "true")).toMatchObject({
        success: true,
      });
      expect(await ctx.settingsRepository.get(SettingKey.AGENT_CLI_SKIP_PERMISSIONS)).toBe("true");
    });

    test("display_name is empty until the owner sets one, and takes any text", async () => {
      expect(await ctx.settingsRepository.get(SettingKey.DISPLAY_NAME)).toBe("");

      expect(await setSetting(ctx, "display_name", "Marcelo Ribeiro Mendes")).toEqual({
        success: true,
        key: "display_name",
        value: "Marcelo Ribeiro Mendes",
      });
      expect(await ctx.settingsRepository.get(SettingKey.DISPLAY_NAME)).toBe(
        "Marcelo Ribeiro Mendes",
      );
    });

    test("a batch with one bad value saves none of it", async () => {
      const result = await setAllSettings(ctx, [
        { key: "chat_global_instructions", value: "be concise" },
        { key: "max_concurrent_runs", value: "0" },
      ]);

      expect(result).toMatchObject({ success: false, error: { code: "INVALID_VALUE" } });
      expect(await ctx.settingsRepository.get("chat_global_instructions")).toBe("");
      expect(await ctx.settingsRepository.get("max_concurrent_runs")).toBe("4");
    });

    test("saving the run cap tells the server to start the turns that now have room", async () => {
      let started = 0;
      const effects = {
        runCapChanged: async () => {
          started += 1;
        },
      };

      await setSetting(ctx, "chat_global_instructions", "hi", effects);
      await setSetting(ctx, "max_concurrent_runs", "0", effects);
      expect(started).toBe(0);
      await setSetting(ctx, "max_concurrent_runs", "8", effects);
      await setAllSettings(ctx, [{ key: "max_concurrent_runs", value: "2" }], effects);

      expect(started).toBe(2);
    });
  });
});
