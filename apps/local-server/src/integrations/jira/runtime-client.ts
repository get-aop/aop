import { type CreateJiraClientOptions, createJiraClient } from "./client.ts";
import { createJiraFixtureClient } from "./fixture-client.ts";

export type CreateRuntimeJiraClientOptions = CreateJiraClientOptions;

export const createRuntimeJiraClient = (options: CreateRuntimeJiraClientOptions = {}) => {
  const fixturesPath = process.env.AOP_TEST_JIRA_FIXTURES_PATH?.trim();
  if (process.env.AOP_TEST_MODE === "true" && fixturesPath) {
    return createJiraFixtureClient({ fixturesPath });
  }

  return createJiraClient({
    siteUrl: options.siteUrl ?? process.env.AOP_JIRA_SITE_URL ?? process.env.JIRA_SITE_URL,
    email: options.email ?? process.env.AOP_JIRA_EMAIL ?? process.env.JIRA_EMAIL,
    apiToken: options.apiToken ?? process.env.AOP_JIRA_API_TOKEN ?? process.env.JIRA_API_TOKEN,
    accessToken: options.accessToken,
    cloudId: options.cloudId,
    fetch: options.fetch,
  });
};
