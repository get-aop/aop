import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../../context.ts";
import type { Database } from "../../db/schema.ts";
import { createTestDb } from "../../db/test-utils.ts";

interface JiraConfigModule {
  getJiraConfig(ctx: LocalServerContext): Promise<{
    siteUrl: string;
    email: string;
    apiToken: string;
    configured: boolean;
  }>;
  getJiraStatus(ctx: LocalServerContext): Promise<{
    configured: boolean;
    siteUrl: string | null;
    email: string | null;
  }>;
}

const loadConfigModule = async (): Promise<JiraConfigModule> =>
  (await import("./config.ts")) as JiraConfigModule;

describe("integrations/jira/config", () => {
  const originalEnv = { ...process.env };
  let db: Kysely<Database>;
  let ctx: LocalServerContext;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    db = await createTestDb();
    ctx = createCommandContext(db);
  });

  afterEach(async () => {
    await db.destroy();
    process.env = { ...originalEnv };
  });

  test("resolves Jira credentials from saved settings before environment variables", async () => {
    const { getJiraConfig, getJiraStatus } = await loadConfigModule();
    process.env.AOP_JIRA_SITE_URL = "https://env.atlassian.net";
    process.env.AOP_JIRA_EMAIL = "env@example.com";
    process.env.AOP_JIRA_API_TOKEN = "env-token";
    await ctx.settingsRepository.set("jira_site_url", "https://acme.atlassian.net/");
    await ctx.settingsRepository.set("jira_email", "dev@example.com");
    await ctx.settingsRepository.set("jira_api_token", "saved-token");

    await expect(getJiraConfig(ctx)).resolves.toEqual({
      siteUrl: "https://acme.atlassian.net",
      email: "dev@example.com",
      apiToken: "saved-token",
      configured: true,
    });
    await expect(getJiraStatus(ctx)).resolves.toEqual({
      configured: true,
      siteUrl: "https://acme.atlassian.net",
      email: "dev@example.com",
    });
  });

  test("falls back to AOP Jira environment variables", async () => {
    const { getJiraConfig } = await loadConfigModule();
    process.env.AOP_JIRA_SITE_URL = "https://env.atlassian.net";
    process.env.AOP_JIRA_EMAIL = "env@example.com";
    process.env.AOP_JIRA_API_TOKEN = "env-token";

    await expect(getJiraConfig(ctx)).resolves.toMatchObject({
      siteUrl: "https://env.atlassian.net",
      email: "env@example.com",
      apiToken: "env-token",
      configured: true,
    });
  });
});
