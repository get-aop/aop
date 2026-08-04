import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const mockFetchServer = mock();
const mockRequireServer = mock();

mock.module("./client.ts", () => ({
  fetchServer: mockFetchServer,
  requireServer: mockRequireServer,
}));

const { jiraStatusCommand } = await import("./jira-status.ts");

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

describe("jiraStatusCommand", () => {
  test("reads only configuration status when Jira is not configured", async () => {
    mockFetchServer.mockResolvedValueOnce({
      ok: true,
      data: { configured: false, siteUrl: null, email: null },
    });

    await jiraStatusCommand();

    expect(mockRequireServer).toHaveBeenCalled();
    expect(mockFetchServer).toHaveBeenCalledTimes(1);
    expect(mockFetchServer).toHaveBeenCalledWith("/api/jira/status");
  });

  test("loads account details when Jira is configured", async () => {
    mockFetchServer
      .mockResolvedValueOnce({
        ok: true,
        data: {
          configured: true,
          siteUrl: "https://acme.atlassian.net",
          email: "dev@example.com",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          ok: true,
          siteUrl: "https://acme.atlassian.net",
          accountId: "acct-1",
          accountDisplayName: "Dev User",
          accountEmail: "dev@example.com",
        },
      });

    await jiraStatusCommand();

    expect(mockFetchServer).toHaveBeenNthCalledWith(1, "/api/jira/status");
    expect(mockFetchServer).toHaveBeenNthCalledWith(2, "/api/jira/test-connection", {
      method: "POST",
    });
  });

  test("exits when loading configuration status fails", async () => {
    mockFetchServer.mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: { error: "boom" },
    });

    await expect(jiraStatusCommand()).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
