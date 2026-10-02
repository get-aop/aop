import { describe, expect, test } from "bun:test";
import type { IssueListQuery, LinearConnection, Message } from "@aop/common";
import { makeUserMessage } from "@aop/common/test-utils";
import { Hono } from "hono";
import { createIssueRoutes } from "./routes.ts";
import type { IssueError, IssueService } from "./service.ts";

const connection: LinearConnection = {
  configured: true,
  scope: { kind: "team", id: "t1", name: "Eng" },
  workspace: "Acme",
  viewer: "sam",
};

/** Routes over a service that records its calls and answers `failure` when one is set. */
const setup = (failure: IssueError | null = null) => {
  const calls: unknown[][] = [];
  const answer = <T>(value: T) =>
    failure ? { success: false as const, error: failure } : { success: true as const, ...value };
  const service: IssueService = {
    list: async (projectId, query: IssueListQuery) => {
      calls.push(["list", projectId, query]);
      return answer({ list: { issues: [], sources: [] } });
    },
    startThread: async (projectId, key) => {
      calls.push(["startThread", projectId, key]);
      return answer({ message: makeUserMessage({ text: "brief" }) as Message });
    },
    linearConnection: async (projectId) => {
      calls.push(["linearConnection", projectId]);
      return answer({ connection });
    },
    connectLinear: async (projectId, input) => {
      calls.push(["connectLinear", projectId, input]);
      return answer({ connection });
    },
    disconnectLinear: async (projectId) => {
      calls.push(["disconnectLinear", projectId]);
      return answer({});
    },
    linearCatalog: async (projectId, input) => {
      calls.push(["linearCatalog", projectId, input]);
      return answer({ catalog: { workspace: "Acme", viewer: "sam", teams: [], projects: [] } });
    },
  };
  const app = new Hono().route("/api/projects", createIssueRoutes(service));
  const send = (method: string, path: string, body?: unknown) =>
    app.request(`/api/projects${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return { send, calls };
};

describe("the issues routes", () => {
  test("GET /issues parses the state, limit and refresh, with defaults", async () => {
    const { send, calls } = setup();
    expect((await send("GET", "/p1/issues")).status).toBe(200);
    expect((await send("GET", "/p1/issues?state=all&limit=300&refresh=1")).status).toBe(200);
    expect(calls).toEqual([
      ["list", "p1", { state: "open", limit: 100, refresh: false }],
      ["list", "p1", { state: "all", limit: 300, refresh: true }],
    ]);
  });

  test("a bad query is a 400 with a sentence", async () => {
    const { send, calls } = setup();
    const res = await send("GET", "/p1/issues?state=everything");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/\w/);
    expect((await send("GET", "/p1/issues?limit=5000")).status).toBe(400);
    expect(calls).toEqual([]);
  });

  test("POST /issues/start-thread answers 201 with the message sent", async () => {
    const { send, calls } = setup();
    const res = await send("POST", "/p1/issues/start-thread", { key: "github:acme/app#1" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { message: { text: string } }).message.text).toBe("brief");
    expect(calls).toEqual([["startThread", "p1", "github:acme/app#1"]]);
    expect((await send("POST", "/p1/issues/start-thread", {})).status).toBe(400);
  });

  test("the Linear routes take and answer the connection, never a key", async () => {
    const { send, calls } = setup();
    const scope = { kind: "team", id: "t1", name: "Eng" };
    const put = await send("PUT", "/p1/linear", { apiKey: "lin_api_x", scope });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ connection });
    expect((await send("GET", "/p1/linear")).status).toBe(200);
    expect((await send("DELETE", "/p1/linear")).status).toBe(204);
    expect((await send("POST", "/p1/linear/catalog")).status).toBe(200);
    expect(
      (await send("PUT", "/p1/linear", { scope: { kind: "org", id: "x", name: "y" } })).status,
    ).toBe(400);
    expect(calls).toEqual([
      ["connectLinear", "p1", { apiKey: "lin_api_x", scope }],
      ["linearConnection", "p1"],
      ["disconnectLinear", "p1"],
      ["linearCatalog", "p1", {}],
    ]);
  });

  test.each([
    [{ code: "PROJECT_NOT_FOUND" }, 404],
    [{ code: "ISSUE_NOT_FOUND", key: "k" }, 404],
    [{ code: "LINEAR_NOT_CONFIGURED" }, 409],
    [{ code: "LINEAR_UNAUTHORIZED" }, 422],
    [{ code: "SOURCE_FAILED", message: "HTTP 502" }, 502],
    [{ code: "PROJECT_ERROR", error: { code: "PROJECT_NOT_ACTIVE" } }, 409],
  ] as [IssueError, number][])("%o answers %d", async (failure, status) => {
    const { send } = setup(failure);
    const res = await send("POST", "/p1/issues/start-thread", { key: "k" });
    expect(res.status).toBe(status);
    expect(((await res.json()) as { code: string }).code).toBe(
      failure.code === "PROJECT_ERROR" ? failure.error.code : failure.code,
    );
  });
});
