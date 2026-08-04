import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const mockFetchServer = mock();
const mockRequireServer = mock();

mock.module("./client.ts", () => ({
  fetchServer: mockFetchServer,
  requireServer: mockRequireServer,
}));

const { jiraConfigureCommand } = await import("./jira-configure.ts");

const originalExit = process.exit;

beforeEach(() => {
  mockFetchServer.mockReset();
  mockRequireServer.mockReset();
  process.exit = mock(() => {
    throw new Error("process.exit");
  }) as never;
});

afterEach(() => {
  process.exit = originalExit;
});

describe("jiraConfigureCommand", () => {
  test("saves Jira Cloud credentials together", async () => {
    mockFetchServer.mockResolvedValue({
      ok: true,
      data: {
        ok: true,
        settings: [
          { key: "jira_site_url", value: "https://acme.atlassian.net" },
          { key: "jira_email", value: "dev@example.com" },
          { key: "jira_api_token", value: "jira-token" },
        ],
      },
    });

    await jiraConfigureCommand({
      siteUrl: "https://acme.atlassian.net",
      email: "dev@example.com",
      apiToken: "jira-token",
    });

    expect(mockRequireServer).toHaveBeenCalled();
    expect(mockFetchServer).toHaveBeenCalledWith("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: [
          { key: "jira_site_url", value: "https://acme.atlassian.net" },
          { key: "jira_email", value: "dev@example.com" },
          { key: "jira_api_token", value: "jira-token" },
        ],
      }),
    });
  });

  test("exits when no options are provided", async () => {
    await expect(jiraConfigureCommand({})).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
