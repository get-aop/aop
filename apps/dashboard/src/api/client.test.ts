import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type * as SessionsApi from "./sessions";
import type * as SettingsApi from "./settings";

// Import from the domain modules directly (query-string instances) so
// mock.module registrations for the hub in other test files can never leak
// into these unit tests (bun's mock.module is process-wide).
// No query instance for request: ApiError identity must match the module the
// domain functions throw (request.ts is never mock.module'd by other files).
const { ApiError } = await import("./request");
const { abortChatSession, resetChatSessionRuntime, sendChatMessage } = (await import(
  "./sessions" + "?dashboard-client-test"
)) as typeof SessionsApi;
const { getRepos, getSettings, listDirectories, registerRepo, updateSettings } = (await import(
  "./settings" + "?dashboard-client-test"
)) as typeof SettingsApi;

const originalFetch = globalThis.fetch;
const mockFetch = mock(() => Promise.resolve(new Response()));

beforeEach(() => {
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockClear();
});

afterEach(() => {
  mockFetch.mockReset();
  globalThis.fetch = originalFetch;
});

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("ApiError", () => {
  test("creates error with status, code, and message", () => {
    const error = new ApiError(404, "NOT_FOUND", "Resource not found");
    expect(error.status).toBe(404);
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("Resource not found");
    expect(error.name).toBe("ApiError");
  });
});

describe("abortChatSession", () => {
  test("posts to the active session abort endpoint", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ aborted: true }));

    await expect(abortChatSession("session-1")).resolves.toEqual({ aborted: true });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/chat-sessions/session-1/abort",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("resetChatSessionRuntime", () => {
  test("posts to the reset-runtime endpoint", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ reset: true, clearedBinding: true, cancelledRun: false }),
    );

    await expect(resetChatSessionRuntime("session-1")).resolves.toEqual({
      reset: true,
      clearedBinding: true,
      cancelledRun: false,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/chat-sessions/session-1/reset-runtime",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("getRepos", () => {
  test("returns only the registered repos from the status snapshot", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        ready: true,
        globalCapacity: { working: 1, max: 3 },
        swimlanes: [],
        repos: [
          {
            id: "repo-1",
            name: "my-repo",
            path: "/path/to/repo",
            tasks: [
              {
                id: "task-1",
                repoId: "repo-1",
                status: "DRAFT",
                changePath: "changes/feat-1",
                baseBranch: null,
                preferredProvider: null,
                preferredWorkflow: null,
                createdAt: "2024-01-01T00:00:00Z",
                updatedAt: "2024-01-01T00:00:00Z",
              },
            ],
          },
          { id: "repo-2", name: null, path: "/path/to/other", tasks: [] },
        ],
      }),
    );

    const repos = await getRepos();

    expect(repos).toEqual([
      { id: "repo-1", name: "my-repo", path: "/path/to/repo" },
      { id: "repo-2", name: null, path: "/path/to/other" },
    ]);
    expect(mockFetch).toHaveBeenCalledWith("/api/status", expect.any(Object));
  });

  test("throws ApiError on failure", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: "Server error" }, 500));

    await expect(getRepos()).rejects.toThrow(ApiError);
    await expect(
      getRepos().catch((e) => {
        expect(e.status).toBe(500);
        expect(e.code).toBe("Server error");
        throw e;
      }),
    ).rejects.toThrow();
  });

  test("handles unknown error code", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 500));

    await expect(
      getRepos().catch((e) => {
        expect(e.code).toBe("UNKNOWN");
        throw e;
      }),
    ).rejects.toThrow();
  });
});

describe("sendChatMessage", () => {
  test("posts only the composer payload the dashboard still produces", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ message: { id: "m1" }, session: { id: "s1" } }));

    await sendChatMessage("session-1", "hello", undefined, undefined, "steer", true, [
      { index: 1, lineCount: 5, content: "a\nb" },
    ]);

    const [url, init] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/chat-sessions/session-1/messages");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      content: "hello",
      midRunMode: "steer",
      confirmToolInterrupt: true,
      pastes: [{ index: 1, lineCount: 5, content: "a\nb" }],
    });
  });

  test("omits empty attachment lists from the body", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ message: { id: "m1" }, session: { id: "s1" } }));

    await sendChatMessage("session-1", "hi", [], []);

    const [, init] = mockFetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ content: "hi" });
  });
});

describe("listDirectories", () => {
  test("lists directories without path", async () => {
    const response = {
      path: "/home/user",
      directories: ["projects", "documents"],
      parent: "/home",
      isGitRepo: false,
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(response));

    const result = await listDirectories();

    expect(result).toEqual(response);
    expect(mockFetch).toHaveBeenCalledWith("/api/fs/directories", expect.any(Object));
  });

  test("lists directories with path", async () => {
    const response = {
      path: "/home/user/projects",
      directories: ["repo1", "repo2"],
      parent: "/home/user",
      isGitRepo: false,
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(response));

    const result = await listDirectories("/home/user/projects");

    expect(result).toEqual(response);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/fs/directories?path=%2Fhome%2Fuser%2Fprojects",
      expect.any(Object),
    );
  });

  test("lists directories with hidden flag", async () => {
    const response = {
      path: "/home/user",
      directories: [".config", ".local", "projects"],
      parent: "/home",
      isGitRepo: false,
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(response));

    const result = await listDirectories("/home/user", true);

    expect(result).toEqual(response);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/fs/directories?path=%2Fhome%2Fuser&hidden=true",
      expect.any(Object),
    );
  });
});

describe("registerRepo", () => {
  test("registers a new repository", async () => {
    const response = { ok: true, repoId: "repo-123", alreadyExists: false };
    mockFetch.mockResolvedValueOnce(jsonResponse(response));

    const result = await registerRepo("/path/to/repo");

    expect(result).toEqual(response);
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/repos",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ path: "/path/to/repo" }),
      }),
    );
  });

  test("handles already existing repository", async () => {
    const response = { ok: true, repoId: "repo-123", alreadyExists: true };
    mockFetch.mockResolvedValueOnce(jsonResponse(response));

    const result = await registerRepo("/path/to/repo");

    expect(result.alreadyExists).toBe(true);
  });
});

describe("getSettings", () => {
  test("fetches settings", async () => {
    const settings = [
      { key: "theme", value: "dark" },
      { key: "maxConcurrent", value: "3" },
    ];
    mockFetch.mockResolvedValueOnce(jsonResponse({ settings }));

    const result = await getSettings();

    expect(result).toEqual(settings);
    expect(mockFetch).toHaveBeenCalledWith("/api/settings", expect.any(Object));
  });
});

describe("updateSettings", () => {
  test("updates settings", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ ok: true }));

    const settings = [{ key: "theme", value: "light" }];
    await updateSettings(settings);

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ settings }),
      }),
    );
  });
});
