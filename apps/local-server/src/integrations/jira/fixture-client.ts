import { readFile } from "node:fs/promises";
import { normalizeJiraIssueKey } from "./input-parser.ts";
import type { JiraConnectionInfo, JiraIssueClient, JiraRawIssue } from "./types.ts";

interface JiraFixtureClientOptions {
  fixturesPath: string;
}

interface JiraFixtureData {
  connection?: Partial<Omit<JiraConnectionInfo, "ok">>;
  issues?: JiraRawIssue[];
}

export const createJiraFixtureClient = (options: JiraFixtureClientOptions): JiraIssueClient => ({
  getIssuesByKeys: async (keys) => {
    const fixtures = await loadFixtures(options.fixturesPath);
    const issuesByKey = new Map(
      fixtures.issues.map((issue) => [normalizeJiraIssueKey(issue.key), issue]),
    );

    return keys.flatMap((key) => {
      const issue = issuesByKey.get(normalizeJiraIssueKey(key));
      return issue ? [issue] : [];
    });
  },
  testConnection: async () => {
    const fixtures = await loadFixtures(options.fixturesPath);
    return fixtures.connection;
  },
});

const loadFixtures = async (
  fixturesPath: string,
): Promise<{ connection: JiraConnectionInfo; issues: JiraRawIssue[] }> => {
  const content = await readFile(fixturesPath, "utf-8");
  const parsed = JSON.parse(content) as JiraFixtureData;
  const connection = parsed.connection ?? {};

  return {
    connection: {
      ok: true,
      siteUrl: connection.siteUrl ?? "https://fixture.atlassian.net",
      accountId: connection.accountId ?? "fixture-account",
      accountDisplayName: connection.accountDisplayName ?? "Jira Fixture User",
      accountEmail: connection.accountEmail ?? "fixture@example.com",
    },
    issues: parsed.issues ?? [],
  };
};
