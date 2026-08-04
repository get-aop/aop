import { beforeEach, describe, expect, mock, test } from "bun:test";

const mockFetchServer = mock();
mock.module("./client.ts", () => ({ fetchServer: mockFetchServer }));
const { sessionWorkspaceResetCommand, sessionWorkspaceSetCommand } = await import(
  "./session-workspace.ts"
);

beforeEach(() => mockFetchServer.mockReset());

describe("session workspace commands", () => {
  test("sets and resets through the chat workspace HTTP service", async () => {
    mockFetchServer.mockResolvedValue({
      ok: true,
      data: { session: { workspacePath: "/tmp/wt" } },
    });
    await sessionWorkspaceSetCommand("isess_1", "/tmp/wt");
    expect(mockFetchServer).toHaveBeenCalledWith("/api/chat-sessions/isess_1/workspace", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/tmp/wt" }),
    });

    await sessionWorkspaceResetCommand("isess_1");
    expect(mockFetchServer).toHaveBeenLastCalledWith("/api/chat-sessions/isess_1/workspace", {
      method: "DELETE",
    });
  });
});
