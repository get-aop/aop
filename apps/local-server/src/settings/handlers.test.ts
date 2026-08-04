import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { getAllSettings, getSetting, setAllSettings, setSetting } from "./handlers.ts";
import { SettingKey } from "./types.ts";

describe("settings/handlers", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  const originalLocalServerUrl = process.env.AOP_LOCAL_SERVER_URL;

  beforeEach(async () => {
    process.env.AOP_LOCAL_SERVER_URL = "http://127.0.0.1:25150";
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
    if (originalLocalServerUrl === undefined) {
      delete process.env.AOP_LOCAL_SERVER_URL;
      return;
    }
    process.env.AOP_LOCAL_SERVER_URL = originalLocalServerUrl;
  });

  describe("getAllSettings", () => {
    test("defaults max_concurrent_tasks to five", async () => {
      const result = await getAllSettings(ctx);
      const capacitySetting = result.settings.find(
        (setting) => setting.key === "max_concurrent_tasks",
      );

      expect(capacitySetting).toEqual({
        key: "max_concurrent_tasks",
        value: "5",
      });
    });

    test("does not expose a global default workflow setting", async () => {
      const result = await getAllSettings(ctx);
      const workflowSetting = result.settings.find((setting) => setting.key === "default_workflow");

      expect(workflowSetting).toBeUndefined();
    });

    test("keeps global fast_mode off by default", async () => {
      const result = await getAllSettings(ctx);
      const fastModeSetting = result.settings.find((setting) => setting.key === "fast_mode");

      expect(fastModeSetting).toEqual({
        key: "fast_mode",
        value: "false",
      });
    });

    test("does not expose removed control runtime settings", async () => {
      const result = await getAllSettings(ctx);
      expect(result.settings.some((setting) => setting.key.startsWith("control_"))).toBe(false);
    });

    test("normalizes the legacy Linear callback url for source installs", async () => {
      await ctx.settingsRepository.set(
        "linear_callback_url",
        "http://127.0.0.1:4310/api/linear/callback",
      );

      const result = await getAllSettings(ctx);
      const callbackSetting = result.settings.find(
        (setting) => setting.key === "linear_callback_url",
      );

      expect(callbackSetting).toEqual({
        key: "linear_callback_url",
        value: "http://127.0.0.1:25150/api/linear/callback",
      });
    });

    test("masks saved Jira API tokens", async () => {
      await ctx.settingsRepository.set("jira_api_token", "saved-token");

      const result = await getAllSettings(ctx);
      const tokenSetting = result.settings.find((setting) => setting.key === "jira_api_token");

      expect(tokenSetting).toEqual({ key: "jira_api_token", value: "********" });
    });

    test("masks saved GitHub App private keys", async () => {
      await ctx.settingsRepository.set("github_app_private_key", "saved-private-key");

      const result = await getAllSettings(ctx);
      const privateKeySetting = result.settings.find(
        (setting) => setting.key === "github_app_private_key",
      );

      expect(privateKeySetting).toEqual({ key: "github_app_private_key", value: "********" });
    });
  });

  describe("setAllSettings", () => {
    test("saves multiple settings at once", async () => {
      const result = await setAllSettings(ctx, [
        { key: "max_concurrent_tasks", value: "5" },
        { key: "agent_timeout_secs", value: "900" },
      ]);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.settings).toHaveLength(2);

      const stored = await ctx.settingsRepository.get("max_concurrent_tasks");
      expect(stored).toBe("5");
      const stored2 = await ctx.settingsRepository.get("agent_timeout_secs");
      expect(stored2).toBe("900");
    });

    test("rejects if any key is invalid", async () => {
      const result = await setAllSettings(ctx, [
        { key: "max_concurrent_tasks", value: "5" },
        { key: "bogus_key", value: "nope" },
      ]);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe("INVALID_KEY");
      expect(result.error.key).toBe("bogus_key");
    });

    test("handles empty array", async () => {
      const result = await setAllSettings(ctx, []);
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.settings).toHaveLength(0);
    });

    test("saves Linear OAuth settings", async () => {
      const result = await setAllSettings(ctx, [
        { key: "linear_client_id", value: "linear-client-id" },
        { key: "linear_callback_url", value: "http://127.0.0.1:4310/api/linear/callback" },
      ]);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(await ctx.settingsRepository.get("linear_client_id")).toBe("linear-client-id");
      expect(await ctx.settingsRepository.get("linear_callback_url")).toBe(
        "http://127.0.0.1:4310/api/linear/callback",
      );
    });

    test("saves GitHub App credentials without echoing the private key", async () => {
      const result = await setAllSettings(ctx, [
        { key: "github_app_id", value: "12345" },
        { key: "github_app_private_key", value: "github-private-key" },
        { key: "github_app_installation_id", value: "98765" },
        { key: "github_app_user_login", value: "get-aop-user" },
      ]);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.settings).toContainEqual({ key: "github_app_private_key", value: "********" });
      expect(await ctx.settingsRepository.get("github_app_id")).toBe("12345");
      expect(await ctx.settingsRepository.get("github_app_private_key")).toBe("github-private-key");
      expect(await ctx.settingsRepository.get("github_app_installation_id")).toBe("98765");
      expect(await ctx.settingsRepository.get("github_app_user_login")).toBe("get-aop-user");
    });

    test("saves Jira Cloud credentials without echoing the API token", async () => {
      const result = await setAllSettings(ctx, [
        { key: "jira_site_url", value: "https://acme.atlassian.net" },
        { key: "jira_email", value: "dev@example.com" },
        { key: "jira_api_token", value: "jira-token" },
      ]);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.settings).toContainEqual({ key: "jira_api_token", value: "********" });
      expect(await ctx.settingsRepository.get("jira_site_url")).toBe("https://acme.atlassian.net");
      expect(await ctx.settingsRepository.get("jira_email")).toBe("dev@example.com");
      expect(await ctx.settingsRepository.get("jira_api_token")).toBe("jira-token");
    });

    test("rejects an invalid Linear callback URL", async () => {
      const result = await setAllSettings(ctx, [
        { key: "linear_callback_url", value: "not-a-url" },
      ]);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe("INVALID_VALUE");
      expect(result.error.key).toBe("linear_callback_url");
    });

    test("rejects an invalid Jira site URL", async () => {
      const result = await setAllSettings(ctx, [{ key: "jira_site_url", value: "not-a-url" }]);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe("INVALID_VALUE");
      expect(result.error.key).toBe("jira_site_url");
    });

    test("rejects Jira site URLs outside HTTPS Jira Cloud", async () => {
      for (const value of ["http://acme.atlassian.net", "https://jira.example.com"]) {
        const result = await setAllSettings(ctx, [{ key: "jira_site_url", value }]);

        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.code).toBe("INVALID_VALUE");
        expect(result.error.key).toBe("jira_site_url");
      }
    });
  });

  describe("setSetting", () => {
    test("rejects removed quick-fix and control setting keys", async () => {
      for (const key of ["quick_fix_agent_provider", "control_claude_model"]) {
        const result = await setSetting(ctx, key, "pi");
        expect(result.success).toBe(false);
        if (result.success) return;
        expect(result.error.code).toBe("INVALID_KEY");
      }
    });

    test("stores but never returns a raw Jira API token", async () => {
      const setResult = await setSetting(ctx, "jira_api_token", "new-token");

      expect(setResult.success).toBe(true);
      if (!setResult.success) return;
      expect(setResult.value).toBe("********");
      expect(await ctx.settingsRepository.get("jira_api_token")).toBe("new-token");

      const getResult = await getSetting(ctx, "jira_api_token");
      expect(getResult).toEqual({ success: true, key: "jira_api_token", value: "********" });
    });

    test("stores but never returns a raw GitHub App private key", async () => {
      const setResult = await setSetting(ctx, "github_app_private_key", "new-private-key");

      expect(setResult.success).toBe(true);
      if (!setResult.success) return;
      expect(setResult.value).toBe("********");
      expect(await ctx.settingsRepository.get("github_app_private_key")).toBe("new-private-key");

      const getResult = await getSetting(ctx, "github_app_private_key");
      expect(getResult).toEqual({
        success: true,
        key: "github_app_private_key",
        value: "********",
      });
    });

    test("accepts an empty Linear callback URL to clear the override", async () => {
      const result = await setSetting(ctx, "linear_callback_url", "");

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.value).toBe("");
    });

    test("stores remote_exec_hosts_json as a non-secret setting", async () => {
      const payload = JSON.stringify([
        {
          id: "ehost_1",
          name: "Desktop",
          host: "192.168.1.10",
          remoteRoot: "/tmp/aop",
        },
      ]);
      const setResult = await setSetting(ctx, SettingKey.REMOTE_EXEC_HOSTS, payload);
      expect(setResult.success).toBe(true);
      if (!setResult.success) return;
      expect(setResult.value).toBe(payload);
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
