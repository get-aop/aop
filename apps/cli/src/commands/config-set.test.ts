import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const mockFetchServer = mock();

mock.module("./client.ts", () => ({
  fetchServer: mockFetchServer,
}));

const { configSetCommand } = await import("./config-set.ts");

const originalExit = process.exit;

beforeEach(() => {
  mockFetchServer.mockReset();
  process.exit = mock(() => {
    throw new Error("process.exit");
  }) as never;
});

afterEach(() => {
  process.exit = originalExit;
});

describe("configSetCommand", () => {
  test("sends PUT with key and value", async () => {
    mockFetchServer.mockResolvedValue({
      ok: true,
      data: { ok: true, key: "chat_global_instructions", value: "Prefer small diffs" },
    });

    await configSetCommand("chat_global_instructions", "Prefer small diffs");
    expect(mockFetchServer).toHaveBeenCalledWith("/api/settings/chat_global_instructions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "Prefer small diffs" }),
    });
  });

  test("exits on invalid key with valid keys list", async () => {
    mockFetchServer.mockResolvedValue({
      ok: false,
      status: 400,
      error: {
        error: "Invalid key",
        validKeys: ["chat_global_instructions", "max_concurrent_runs"],
      },
    });

    await expect(configSetCommand("bad_key", "val")).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("exits on generic error", async () => {
    mockFetchServer.mockResolvedValue({
      ok: false,
      status: 500,
      error: { error: "Server error" },
    });

    await expect(configSetCommand("chat_global_instructions", "x")).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
