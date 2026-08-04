import { describe, expect, test } from "bun:test";

interface RawJiraIssue {
  id: string;
  key: string;
  self: string;
  browseUrl?: string;
  fields?: Record<string, unknown>;
}

interface IssueResolverModule {
  createJiraIssueResolver(options: {
    client: {
      getIssuesByKeys(keys: string[]): Promise<RawJiraIssue[]>;
    };
  }): {
    resolve(input: string): Promise<unknown[]>;
  };
}

const loadIssueResolverModule = async (): Promise<IssueResolverModule> =>
  (await import("./issue-resolver.ts")) as IssueResolverModule;

describe("integrations/jira/issue-resolver", () => {
  test("resolves Jira input and normalizes metadata, ADF descriptions, and blockers", async () => {
    const { createJiraIssueResolver } = await loadIssueResolverModule();
    let seenKeys: string[] = [];
    const resolver = createJiraIssueResolver({
      client: {
        getIssuesByKeys: async (keys) => {
          seenKeys = keys;
          return [
            buildIssue({ id: "10051", key: "GET-51", summary: "Second issue" }),
            buildIssue({
              id: "10050",
              key: "get-50",
              summary: "Backlog Jira parity",
              description: {
                type: "doc",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "Add Jira ingestion." }] },
                ],
              },
              priority: { id: "2", name: "High" },
              status: {
                id: "3",
                name: "In Progress",
                statusCategory: { key: "indeterminate", name: "In Progress" },
              },
              project: { id: "10000", key: "GET", name: "Get AOP" },
              team: { id: "team-1", name: "Factory Team" },
              issueLinks: [
                {
                  id: "link-1",
                  type: { name: "Blocks", inward: "is blocked by", outward: "blocks" },
                  inwardIssue: buildLinkedIssue("10049", "GET-49", "Linear import first"),
                },
                {
                  id: "link-2",
                  type: { name: "Blocks", inward: "is blocked by", outward: "blocks" },
                  outwardIssue: buildLinkedIssue("10052", "GET-52", "Current issue blocks this"),
                },
                {
                  id: "link-3",
                  type: { name: "Relates", inward: "relates to", outward: "relates to" },
                  inwardIssue: buildLinkedIssue("10099", "GET-99", "Context only"),
                },
              ],
            }),
          ];
        },
      },
    });

    const issues = await resolver.resolve(
      "GET-50, https://acme.atlassian.net/browse/get-51, GET-50",
    );

    expect(seenKeys).toEqual(["GET-50", "GET-51"]);
    expect(issues).toEqual([
      {
        id: "10050",
        key: "GET-50",
        ref: "GET-50",
        title: "Backlog Jira parity",
        description: "Add Jira ingestion.",
        priority: { id: "2", name: "High" },
        status: { id: "3", name: "In Progress", category: "In Progress" },
        project: { id: "10000", key: "GET", name: "Get AOP" },
        team: { id: "team-1", name: "Factory Team" },
        url: "https://acme.atlassian.net/browse/GET-50",
        blocks: [
          {
            id: "10049",
            key: "GET-49",
            ref: "GET-49",
            title: "Linear import first",
            url: "https://acme.atlassian.net/browse/GET-49",
          },
        ],
      },
      {
        id: "10051",
        key: "GET-51",
        ref: "GET-51",
        title: "Second issue",
        description: null,
        priority: null,
        status: null,
        project: null,
        team: null,
        url: "https://acme.atlassian.net/browse/GET-51",
        blocks: [],
      },
    ]);
  });

  test("fails when Jira does not return every requested issue", async () => {
    const { createJiraIssueResolver } = await loadIssueResolverModule();
    const resolver = createJiraIssueResolver({
      client: {
        getIssuesByKeys: async () => [buildIssue({ id: "10050", key: "GET-50", summary: "First" })],
      },
    });

    await expect(resolver.resolve("GET-50, GET-51")).rejects.toThrow(
      "Jira issues not found: GET-51",
    );
  });
});

const buildIssue = (params: {
  id: string;
  key: string;
  summary: string;
  description?: unknown;
  priority?: unknown;
  status?: unknown;
  project?: unknown;
  team?: unknown;
  issueLinks?: unknown[];
}): RawJiraIssue => ({
  id: params.id,
  key: params.key,
  self: `https://acme.atlassian.net/rest/api/3/issue/${params.id}`,
  browseUrl: `https://acme.atlassian.net/browse/${params.key.toUpperCase()}`,
  fields: {
    summary: params.summary,
    description: params.description ?? null,
    priority: params.priority ?? null,
    status: params.status ?? null,
    project: params.project ?? null,
    team: params.team ?? null,
    issuelinks: params.issueLinks ?? [],
  },
});

const buildLinkedIssue = (id: string, key: string, summary: string): RawJiraIssue => ({
  id,
  key,
  self: `https://acme.atlassian.net/rest/api/3/issue/${id}`,
  fields: { summary },
});
