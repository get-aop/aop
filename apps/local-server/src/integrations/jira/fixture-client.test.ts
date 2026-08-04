import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface FixtureClientModule {
  createJiraFixtureClient(options: { fixturesPath: string }): {
    getIssuesByKeys(keys: string[]): Promise<Array<{ key: string }>>;
    testConnection(): Promise<{
      ok: boolean;
      siteUrl: string;
      accountId: string;
      accountDisplayName: string;
      accountEmail: string;
    }>;
  };
}

const loadFixtureClientModule = async (): Promise<FixtureClientModule> =>
  (await import("./fixture-client.ts")) as FixtureClientModule;

describe("integrations/jira/fixture-client", () => {
  let tempDir: string;
  let fixturesPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "aop-jira-fixture-client-"));
    fixturesPath = join(tempDir, "fixtures.json");
    await writeFile(
      fixturesPath,
      JSON.stringify({
        connection: {
          siteUrl: "https://acme.atlassian.net",
          accountId: "acct-1",
          accountDisplayName: "Dev User",
          accountEmail: "dev@example.com",
        },
        issues: [
          {
            id: "10050",
            key: "GET-50",
            self: "https://acme.atlassian.net/rest/api/3/issue/10050",
            browseUrl: "https://acme.atlassian.net/browse/GET-50",
            fields: { summary: "First issue" },
          },
          {
            id: "10051",
            key: "GET-51",
            self: "https://acme.atlassian.net/rest/api/3/issue/10051",
            browseUrl: "https://acme.atlassian.net/browse/GET-51",
            fields: { summary: "Second issue" },
          },
        ],
      }),
    );
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("returns requested Jira issues by key in input order", async () => {
    const { createJiraFixtureClient } = await loadFixtureClientModule();
    const client = createJiraFixtureClient({ fixturesPath });

    const result = await client.getIssuesByKeys(["GET-51", "GET-50", "GET-404"]);

    expect(result.map((issue) => issue.key)).toEqual(["GET-51", "GET-50"]);
  });

  test("returns fixture connection metadata for status checks", async () => {
    const { createJiraFixtureClient } = await loadFixtureClientModule();
    const client = createJiraFixtureClient({ fixturesPath });

    await expect(client.testConnection()).resolves.toEqual({
      ok: true,
      siteUrl: "https://acme.atlassian.net",
      accountId: "acct-1",
      accountDisplayName: "Dev User",
      accountEmail: "dev@example.com",
    });
  });
});
