import { describe, expect, test } from "bun:test";
import type { PullRequestListQuery } from "@aop/common";
import { Hono } from "hono";
import { createPullRequestListRoutes } from "./routes.ts";
import type { PullRequestListService } from "./service.ts";

/** The route over a service that records the query it was given. */
const mount = () => {
  const queries: PullRequestListQuery[] = [];
  const service: PullRequestListService = {
    list: async (projectId, query) => {
      queries.push(query);
      if (projectId !== "proj_1") return null;
      return { status: "unavailable", reason: "no-repos", message: "none", repos: [] };
    },
  };
  const app = new Hono().route("/api/projects", createPullRequestListRoutes(service));
  return { request: (path: string) => app.request(path), queries };
};

describe("GET /api/projects/:projectId/github/pulls", () => {
  test("reads repeated filters, flags and paging from the query", async () => {
    const { request, queries } = mount();

    const res = await request(
      "/api/projects/proj_1/github/pulls?state=merged&author=ada&author=grace&label=good%2C%20first&assignee=ken&q=%20checkout%20&sort=oldest&involves=1&cursor=50&limit=25&refresh=true",
    );

    expect(res.status).toBe(200);
    expect(queries[0]).toEqual({
      state: "merged",
      author: ["ada", "grace"],
      label: ["good, first"],
      assignee: ["ken"],
      q: "checkout",
      sort: "oldest",
      involves: true,
      cursor: "50",
      limit: 25,
      refresh: true,
    });
  });

  test("an empty query asks for the open pull requests, most recently updated first", async () => {
    const { request, queries } = mount();

    await request("/api/projects/proj_1/github/pulls");

    expect(queries[0]).toEqual({
      state: "open",
      author: [],
      label: [],
      assignee: [],
      q: "",
      sort: "updated",
      involves: false,
      limit: 50,
      refresh: false,
    });
  });

  test.each([
    ["state=draft", "state"],
    ["sort=stars", "sort"],
    ["limit=500", "limit"],
  ])("refuses %s with a sentence naming the field", async (query, field) => {
    const res = await mount().request(`/api/projects/proj_1/github/pulls?${query}`);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe("INVALID_QUERY");
    expect(body.error.toLowerCase()).toContain(field);
  });

  test("404 for a project that does not exist", async () => {
    const res = await mount().request("/api/projects/missing/github/pulls");

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });
});
