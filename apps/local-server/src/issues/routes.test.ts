import { describe, expect, test } from "bun:test";
import {
  type IssueListQuery,
  JIRA_NOT_CONNECTED,
  type JiraConnection,
  type LinearConnection,
  type Message,
} from "@aop/common";
import { makeUserMessage } from "@aop/common/test-utils";
import { Hono } from "hono";
import { createIssueRoutes } from "./routes.ts";
import type { IssueError, IssueService } from "./service.ts";
import { projectIssue } from "./test-utils.ts";

const connection: LinearConnection = {
  configured: true,
  scope: { kind: "team", id: "t1", name: "Eng" },
  workspace: "Acme",
  viewer: "sam",
};

const jira: JiraConnection = {
  configured: true,
  deployment: "cloud",
  siteUrl: "https://acme.atlassian.net",
  account: "Sam Rivera",
  filter: { projects: ["APP"], jql: null },
  linkPullRequests: true,
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
    detail: async (projectId, key) => {
      calls.push(["detail", projectId, key]);
      return answer({
        detail: { issue: projectIssue(), body: "b", sections: [], comments: [], commentCount: 0 },
      });
    },
    jiraConnection: {
      connection: async (projectId) => {
        calls.push(["jiraConnection", projectId]);
        return answer({ connection: JIRA_NOT_CONNECTED });
      },
      test: async (projectId, input) => {
        calls.push(["testJira", projectId, input]);
        return answer({
          result: { account: { displayName: "Sam", email: null, avatarUrl: null }, projects: [] },
        });
      },
      connect: async (projectId, input) => {
        calls.push(["connectJira", projectId, input]);
        return answer({ connection: jira });
      },
      disconnect: async (projectId) => {
        calls.push(["disconnectJira", projectId]);
        return answer({});
      },
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

  test("GET /issues/detail reads one issue by its key", async () => {
    const { send, calls } = setup();
    const res = await send("GET", `/p1/issues/detail?key=${encodeURIComponent("jira:APP-3")}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { detail: { body: string } }).detail.body).toBe("b");
    expect((await send("GET", "/p1/issues/detail")).status).toBe(400);
    expect(calls).toEqual([["detail", "p1", "jira:APP-3"]]);
  });

  test("the Jira routes take credentials and a filter, and answer the connection", async () => {
    const { send, calls } = setup();
    const credentials = {
      deployment: "cloud",
      siteUrl: "https://acme.atlassian.net/",
      email: "sam@acme.test",
      apiToken: "tok",
    };
    const filter = { projects: ["app"], jql: "" };
    const put = await send("PUT", "/p1/jira", { credentials, filter });
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ connection: jira });
    expect((await send("GET", "/p1/jira")).status).toBe(200);
    expect((await send("POST", "/p1/jira/test")).status).toBe(200);
    expect((await send("DELETE", "/p1/jira")).status).toBe(204);
    expect(calls).toEqual([
      [
        "connectJira",
        "p1",
        {
          credentials: { ...credentials, siteUrl: "https://acme.atlassian.net" },
          filter: { projects: ["APP"], jql: null },
          linkPullRequests: true,
        },
      ],
      ["jiraConnection", "p1"],
      ["testJira", "p1", {}],
      ["disconnectJira", "p1"],
    ]);
  });

  test("a Jira filter with nothing in it, or a site over plain http, is refused", async () => {
    const { send, calls } = setup();
    const credentials = { deployment: "datacenter", siteUrl: "https://jira.acme.test", token: "t" };
    const empty = await send("PUT", "/p1/jira", {
      credentials,
      filter: { projects: [], jql: " " },
    });
    expect(empty.status).toBe(400);
    const http = { ...credentials, siteUrl: "http://jira.acme.test" };
    expect((await send("POST", "/p1/jira/test", { credentials: http })).status).toBe(400);
    const local = { ...credentials, siteUrl: "http://127.0.0.1:25495" };
    expect((await send("POST", "/p1/jira/test", { credentials: local })).status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  test.each([
    [{ code: "JIRA_NOT_CONFIGURED" }, 409],
    [{ code: "JIRA_UNAUTHORIZED" }, 422],
    [{ code: "JIRA_BAD_FILTER", message: "Field 'x' does not exist." }, 422],
  ] as [IssueError, number][])("a Jira failure %o answers %d", async (failure, status) => {
    const { send } = setup(failure);
    const res = await send("PUT", "/p1/jira", { filter: { projects: ["APP"], jql: null } });
    expect(res.status).toBe(status);
    expect(((await res.json()) as { code: string }).code).toBe(failure.code);
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
