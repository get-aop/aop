import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { resolve } from "node:path";

const mockFetchServer = mock();

mock.module("./client.ts", () => ({
  fetchServer: mockFetchServer,
}));

const { repoRemoveCommand } = await import("./repo-remove.ts");

const originalExit = process.exit;
const originalPrompt = globalThis.prompt;

beforeEach(() => {
  mockFetchServer.mockReset();
  process.exit = mock(() => {
    throw new Error("process.exit");
  }) as never;
  globalThis.prompt = mock(() => "project") as typeof globalThis.prompt;
});

afterEach(() => {
  process.exit = originalExit;
  globalThis.prompt = originalPrompt;
});

const repoPath = "/home/user/project";
const statusWithRepo = {
  ok: true,
  data: { repos: [{ id: "repo-1", path: repoPath }] },
};

describe("repoRemoveCommand", () => {
  test("exits when status fetch fails", async () => {
    mockFetchServer.mockResolvedValue({
      ok: false,
      status: 500,
      error: { error: "Server error" },
    });

    await expect(repoRemoveCommand(repoPath)).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("exits when repo not found in status", async () => {
    mockFetchServer.mockResolvedValue({
      ok: true,
      data: { repos: [] },
    });

    await expect(repoRemoveCommand(repoPath)).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("uses cwd when no path provided", async () => {
    const resolvedCwd = resolve(process.cwd());
    mockFetchServer.mockResolvedValue({
      ok: true,
      data: { repos: [{ id: "repo-1", path: resolvedCwd }] },
    });
    mockFetchServer.mockResolvedValueOnce({
      ok: true,
      data: { repos: [{ id: "repo-1", path: resolvedCwd }] },
    });
    mockFetchServer.mockResolvedValueOnce({
      ok: true,
      data: { ok: true, repoId: "repo-1", abortedTasks: 0 },
    });

    await repoRemoveCommand(undefined, { yes: true });
    expect(mockFetchServer).toHaveBeenCalledTimes(2);
  });

  test("sends DELETE without force param by default", async () => {
    mockFetchServer.mockResolvedValueOnce(statusWithRepo).mockResolvedValueOnce({
      ok: true,
      data: { ok: true, repoId: "repo-1", abortedTasks: 0 },
    });

    await repoRemoveCommand(repoPath);
    expect(mockFetchServer.mock.calls.at(1)?.at(0)).toBe("/api/repos/repo-1");
    expect(mockFetchServer.mock.calls.at(1)?.at(1)).toEqual({ method: "DELETE" });
  });

  test("sends DELETE with force param when option set", async () => {
    mockFetchServer.mockResolvedValueOnce(statusWithRepo).mockResolvedValueOnce({
      ok: true,
      data: { ok: true, repoId: "repo-1", abortedTasks: 2 },
    });

    await repoRemoveCommand(repoPath, { force: true });
    expect(mockFetchServer.mock.calls.at(1)?.at(0)).toBe("/api/repos/repo-1?force=true");
  });

  test("exits without deleting when typed confirmation does not match", async () => {
    globalThis.prompt = mock(() => "wrong") as typeof globalThis.prompt;
    mockFetchServer.mockResolvedValueOnce(statusWithRepo);

    await expect(repoRemoveCommand(repoPath)).rejects.toThrow("process.exit");

    expect(mockFetchServer).toHaveBeenCalledTimes(1);
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("skips typed confirmation with yes option", async () => {
    mockFetchServer.mockResolvedValueOnce(statusWithRepo).mockResolvedValueOnce({
      ok: true,
      data: { ok: true, repoId: "repo-1", abortedTasks: 0, factoryReset: false },
    });

    await repoRemoveCommand(repoPath, { yes: true });

    expect(globalThis.prompt).not.toHaveBeenCalled();
    expect(mockFetchServer.mock.calls.at(1)?.at(0)).toBe("/api/repos/repo-1");
  });

  test("exits when repo has working tasks without force", async () => {
    mockFetchServer.mockResolvedValueOnce(statusWithRepo).mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: { error: "Cannot remove repo with working tasks", count: 3 },
    });

    await expect(repoRemoveCommand(repoPath)).rejects.toThrow("process.exit");
    expect(process.exit).toHaveBeenCalledWith(1);
  });

  test("succeeds and reports aborted tasks count", async () => {
    mockFetchServer.mockResolvedValueOnce(statusWithRepo).mockResolvedValueOnce({
      ok: true,
      data: { ok: true, repoId: "repo-1", abortedTasks: 2 },
    });

    await repoRemoveCommand(repoPath, { force: true });
    expect(process.exit).not.toHaveBeenCalled();
  });

  test("succeeds with zero aborted tasks", async () => {
    mockFetchServer.mockResolvedValueOnce(statusWithRepo).mockResolvedValueOnce({
      ok: true,
      data: { ok: true, repoId: "repo-1", abortedTasks: 0 },
    });

    await repoRemoveCommand(repoPath);
    expect(process.exit).not.toHaveBeenCalled();
  });
});
