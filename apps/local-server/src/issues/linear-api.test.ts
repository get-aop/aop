import { describe, expect, test } from "bun:test";
import { createLinearApi, issueFilter, type LinearFetch, mapLinearIssue } from "./linear-api.ts";
import { linearNode } from "./test-utils.ts";

const scope = { kind: "team" as const, id: "team-1", name: "Engineering" };

/** A fetch that answers `body` with `status`, and records what it was sent. */
const fakeFetch = (body: unknown, status = 200) => {
  const sent: { url: string; init: RequestInit }[] = [];
  const fetch: LinearFetch = async (url, init) => {
    sent.push({ url, init });
    return Response.json(body, { status });
  };
  return { fetch, sent };
};

describe("mapLinearIssue", () => {
  test("a Linear issue keeps its identifier, workflow state and colours", () => {
    const issue = mapLinearIssue(linearNode(), scope);
    expect(issue).toMatchObject({
      key: "linear:ENG-7",
      source: "linear",
      repoId: null,
      container: "Engineering",
      identifier: "ENG-7",
      state: "open",
      stage: "started",
      stateName: "In Progress",
      stateColor: "f2c94c",
      labels: [{ name: "Feature", color: "bb87fc" }],
      assignees: [{ login: "sam", name: "Sam Rivera", avatarUrl: null }],
      author: { login: "ana", name: "Ana", avatarUrl: "https://avatars.example/ana" },
      milestone: "Cycle 14",
      commentCount: 2,
      linkedPullRequests: [],
    });
  });

  test("completed and canceled work is closed; an unknown state type reads as not started", () => {
    const done = mapLinearIssue(linearNode({ state: { name: "Done", type: "completed" } }), scope);
    const canceled = mapLinearIssue(
      linearNode({ state: { name: "Canceled", type: "canceled" } }),
      scope,
    );
    const odd = mapLinearIssue(linearNode({ state: { name: "Odd", type: "weird" } }), scope);
    expect([done.state, done.stage]).toEqual(["closed", "completed"]);
    expect([canceled.state, canceled.stage]).toEqual(["closed", "canceled"]);
    expect([odd.state, odd.stage]).toEqual(["open", "unstarted"]);
  });

  test("a project milestone wins over the cycle, and no assignee is an empty list", () => {
    const issue = mapLinearIssue(
      linearNode({ projectMilestone: { name: "Beta" }, assignee: null }),
      scope,
    );
    expect(issue.milestone).toBe("Beta");
    expect(issue.assignees).toEqual([]);
  });
});

describe("issueFilter", () => {
  test("scopes to the team or project, and maps open and closed to workflow types", () => {
    expect(issueFilter(scope, "all")).toEqual({ team: { id: { eq: "team-1" } } });
    expect(issueFilter({ ...scope, kind: "project" }, "open")).toEqual({
      project: { id: { eq: "team-1" } },
      state: { type: { nin: ["completed", "canceled"] } },
    });
    expect(issueFilter(scope, "closed").state).toEqual({ type: { in: ["completed", "canceled"] } });
  });
});

describe("the Linear API", () => {
  test("sends the key in the Authorization header only, and reads a page", async () => {
    const { fetch, sent } = fakeFetch({
      data: {
        issues: { pageInfo: { hasNextPage: true, endCursor: "c2" }, nodes: [linearNode()] },
      },
    });
    const api = createLinearApi({ fetch, url: "https://linear.test/graphql" });

    const read = await api.issuePage("lin_api_secret", {
      scope,
      state: "open",
      first: 50,
      after: null,
    });

    expect(read.ok && read.value.issues.map((issue) => issue.identifier)).toEqual(["ENG-7"]);
    expect(read.ok && read.value.hasNextPage).toBe(true);
    const [{ url, init }] = sent as [{ url: string; init: RequestInit }];
    expect(url).toBe("https://linear.test/graphql");
    expect((init.headers as Record<string, string>).Authorization).toBe("lin_api_secret");
    expect(String(init.body)).not.toContain("lin_api_secret");
  });

  test("a refused key is told apart from other failures, and no message carries the key", async () => {
    const refused = createLinearApi({
      fetch: fakeFetch(
        {
          errors: [
            { message: "Authentication required", extensions: { type: "authentication error" } },
          ],
        },
        400,
      ).fetch,
    });
    const broken = createLinearApi({
      fetch: fakeFetch({ errors: [{ message: "Query too complex" }] }).fetch,
    });
    const offline = createLinearApi({
      fetch: async () => {
        throw new TypeError("fetch failed lin_api_secret");
      },
    });

    const a = await refused.catalog("lin_api_secret");
    const b = await broken.catalog("lin_api_secret");
    const c = await offline.catalog("lin_api_secret");

    expect(a).toEqual({ ok: false, unauthorized: true, message: "Linear refused the API key" });
    expect(b).toMatchObject({ ok: false, unauthorized: false });
    expect(!b.ok && b.message).toContain("Query too complex");
    expect(c).toMatchObject({ ok: false, unauthorized: false });
    for (const read of [a, b, c]) expect(JSON.stringify(read)).not.toContain("lin_api_secret");
  });

  test("the catalog lists the workspace, the key's user, teams and projects", async () => {
    const api = createLinearApi({
      fetch: fakeFetch({
        data: {
          viewer: { name: "Sam Rivera", displayName: "sam" },
          organization: { name: "Acme" },
          teams: { nodes: [{ id: "t1", key: "ENG", name: "Engineering" }] },
          projects: { nodes: [{ id: "p1", name: "Beta", teams: { nodes: [{ key: "ENG" }] } }] },
        },
      }).fetch,
    });
    expect(await api.catalog("lin_api_secret")).toEqual({
      ok: true,
      value: {
        workspace: "Acme",
        viewer: "sam",
        teams: [{ id: "t1", key: "ENG", name: "Engineering" }],
        projects: [{ id: "p1", name: "Beta", teams: ["ENG"] }],
      },
    });
  });

  test("an issue's description is read for its brief; an unknown one is null", async () => {
    const found = createLinearApi({
      fetch: fakeFetch({
        data: { issue: { title: "T", url: "https://linear.app/x", description: null } },
      }).fetch,
    });
    const missing = createLinearApi({ fetch: fakeFetch({ data: { issue: null } }).fetch });
    expect(await found.issueBody("k", "ENG-1")).toEqual({
      ok: true,
      value: { title: "T", url: "https://linear.app/x", body: "" },
    });
    expect(await missing.issueBody("k", "ENG-1")).toEqual({ ok: true, value: null });
  });
});
