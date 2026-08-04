import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface RuntimeClientModule {
  createRuntimeJiraClient(options?: {
    siteUrl?: string;
    email?: string;
    apiToken?: string;
    fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  }): {
    getIssuesByKeys(keys: string[]): Promise<Array<{ key: string }>>;
  };
}

const loadRuntimeClientModule = async (): Promise<RuntimeClientModule> =>
  (await import("./runtime-client.ts")) as RuntimeClientModule;

describe("integrations/jira/runtime-client", () => {
  const originalEnv = { ...process.env };
  let tempDir: string;
  let fixturesPath: string;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    tempDir = await mkdtemp(join(tmpdir(), "aop-jira-runtime-client-"));
    fixturesPath = join(tempDir, "fixtures.json");
    await writeFile(
      fixturesPath,
      JSON.stringify({
        issues: [
          {
            id: "10050",
            key: "GET-50",
            self: "https://acme.atlassian.net/rest/api/3/issue/10050",
            browseUrl: "https://acme.atlassian.net/browse/GET-50",
            fields: { summary: "Fixture issue" },
          },
        ],
      }),
    );
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await rm(tempDir, { recursive: true, force: true });
  });

  test("uses Jira fixtures in test mode", async () => {
    process.env.AOP_TEST_MODE = "true";
    process.env.AOP_TEST_JIRA_FIXTURES_PATH = fixturesPath;
    const { createRuntimeJiraClient } = await loadRuntimeClientModule();

    const client = createRuntimeJiraClient();
    const result = await client.getIssuesByKeys(["GET-50"]);

    expect(result.map((issue) => issue.key)).toEqual(["GET-50"]);
  });

  test("reads Jira Cloud credentials from the environment", async () => {
    process.env.AOP_JIRA_SITE_URL = "https://acme.atlassian.net";
    process.env.AOP_JIRA_EMAIL = "dev@example.com";
    process.env.AOP_JIRA_API_TOKEN = "secret-token";
    const { createRuntimeJiraClient } = await loadRuntimeClientModule();
    let requestedUrl = "";

    const client = createRuntimeJiraClient({
      fetch: async (input) => {
        requestedUrl = input.toString();
        return Response.json({
          id: "10050",
          key: "GET-50",
          self: "https://acme.atlassian.net/rest/api/3/issue/10050",
          fields: { summary: "Env issue" },
        });
      },
    });

    const result = await client.getIssuesByKeys(["GET-50"]);

    expect(result.map((issue) => issue.key)).toEqual(["GET-50"]);
    expect(requestedUrl).toStartWith("https://acme.atlassian.net/rest/api/3/issue/GET-50");
  });
});
