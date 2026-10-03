import { describe, expect, test } from "bun:test";
import { scriptedIssueService } from "../test-utils.ts";
import { cloudCredentials, JIRA_TOKEN, jiraConnection } from "./test-utils.ts";

const query = { state: "open" as const, limit: 100, refresh: false };
const connected = { jira: { proj_1: jiraConnection() } };

describe("Jira issues in a project's list", () => {
  test("joins GitHub's, newest update first, with Jira's status named by its site", async () => {
    const { service } = scriptedIssueService(connected);
    const result = await service.list("proj_1", query);
    if (!result.success) throw new Error("expected a list");
    expect(result.list.issues.map((issue) => issue.key)).toEqual([
      "jira:APP-3",
      "github:acme/app#12",
    ]);
    expect(result.list.sources.at(-1)).toMatchObject({
      source: "jira",
      id: "jira",
      name: "acme.atlassian.net",
      status: "ok",
    });
  });

  test("a refused token is unauthorized, and no answer carries the token or the email", async () => {
    const { service } = scriptedIssueService({
      jira: {
        proj_1: jiraConnection({ credentials: cloudCredentials({ apiToken: "tok_revoked_123" }) }),
      },
    });
    const result = await service.list("proj_1", query);
    if (!result.success) throw new Error("expected a list");
    expect(result.list.sources.at(-1)).toMatchObject({ source: "jira", status: "unauthorized" });
    const connection = await service.jiraConnection.connection("proj_1");
    for (const answer of [result, connection]) {
      expect(JSON.stringify(answer)).not.toContain("tok_revoked_123");
      expect(JSON.stringify(answer)).not.toContain("sam@acme.test");
    }
  });
});

describe("a Jira issue read whole and started from", () => {
  test("the issue view gets its row, description, acceptance criteria and comments", async () => {
    const { service } = scriptedIssueService(connected);
    const result = await service.detail("proj_1", "jira:APP-3");
    if (!result.success) throw new Error("expected the issue");
    expect(result.detail).toMatchObject({
      issue: { key: "jira:APP-3", commentCount: 1 },
      body: "Users sign in with \\*\\*SSO\\*\\*.",
      sections: [{ title: "Acceptance criteria", body: "Signs in with Okta" }],
      commentCount: 1,
    });
    expect(result.detail.comments[0]).toMatchObject({
      body: "On it",
      author: { login: "Sam Rivera" },
    });
  });

  test("starting a thread sends the key, link, description, criteria and the pull request's key", async () => {
    const { service, sent } = scriptedIssueService(connected);
    expect((await service.startThread("proj_1", "jira:APP-3")).success).toBe(true);
    expect(sent[0]).toContain("this Jira issue");
    expect(sent[0]).toContain("APP-3: Sign in with SSO\nhttps://acme.atlassian.net/browse/APP-3");
    expect(sent[0]).toContain(
      "<<< acceptance criteria\nSigns in with Okta\nacceptance criteria >>>",
    );
    expect(sent[0]).toContain("start its title with APP-3");

    const quiet = scriptedIssueService({
      jira: { proj_1: jiraConnection({ linkPullRequests: false }) },
    });
    await quiet.service.startThread("proj_1", "jira:APP-3");
    expect(quiet.sent[0]).not.toContain("pull request");
  });

  test("GitHub and Linear issues read whole too", async () => {
    const { service } = scriptedIssueService();
    const result = await service.detail("proj_1", "github:acme/app#12");
    if (!result.success) throw new Error("expected the issue");
    expect(result.detail).toMatchObject({
      issue: { key: "github:acme/app#12", priority: null },
      body: "Steps to reproduce.",
      comments: [{ id: "IC_1", body: "Seen on CI too.", author: { login: "bo" } }],
    });
  });

  test("without a connection, with a refused token, or for an unknown key", async () => {
    const none = scriptedIssueService();
    expect(await none.service.detail("proj_1", "jira:APP-3")).toEqual({
      success: false,
      error: { code: "JIRA_NOT_CONFIGURED" },
    });
    const refused = scriptedIssueService({
      jira: { proj_1: jiraConnection({ credentials: cloudCredentials({ apiToken: "x" }) }) },
    });
    expect(await refused.service.startThread("proj_1", "jira:APP-3")).toEqual({
      success: false,
      error: { code: "JIRA_UNAUTHORIZED" },
    });
    const { service } = scriptedIssueService(connected);
    expect(await service.detail("proj_1", "jira:APP-99")).toEqual({
      success: false,
      error: { code: "ISSUE_NOT_FOUND", key: "jira:APP-99" },
    });
  });
});

describe("the Jira connection", () => {
  const credentials = cloudCredentials();
  const filter = { projects: ["APP"], jql: null };

  test("connecting signs in, runs the filter once, keeps the token on the host and answers without it", async () => {
    const { service, jiraStore, jiraCalls } = scriptedIssueService();
    const result = await service.jiraConnection.connect("proj_1", {
      credentials,
      filter,
      linkPullRequests: true,
    });
    expect(result).toEqual({
      success: true,
      connection: {
        configured: true,
        deployment: "cloud",
        siteUrl: "https://acme.atlassian.net",
        account: "Sam Rivera",
        filter,
        linkPullRequests: true,
      },
    });
    expect(jiraStore.held.get("proj_1")?.credentials).toEqual(credentials);
    expect(jiraCalls).toEqual([
      "myself",
      'search (project in ("APP")) AND (statusCategory != Done) ORDER BY updated DESC cursor=-',
    ]);
  });

  test("a refused token or a filter Jira cannot run is not kept", async () => {
    const { service, jiraStore } = scriptedIssueService();
    const refused = await service.jiraConnection.connect("proj_1", {
      credentials: cloudCredentials({ apiToken: "wrong" }),
      filter,
      linkPullRequests: true,
    });
    expect(refused).toEqual({ success: false, error: { code: "JIRA_UNAUTHORIZED" } });
    const bad = await service.jiraConnection.connect("proj_1", {
      credentials,
      filter: { projects: [], jql: "bogus = 1" },
      linkPullRequests: true,
    });
    expect(bad).toEqual({
      success: false,
      error: { code: "JIRA_BAD_FILTER", message: "Field 'bogus' does not exist." },
    });
    const unbounded = await service.jiraConnection.connect("proj_1", {
      credentials,
      filter: { projects: [], jql: "ORDER BY created DESC" },
      linkPullRequests: true,
    });
    expect(unbounded).toEqual({
      success: false,
      error: { code: "JIRA_BAD_FILTER", message: "Pick a project or give the query a condition" },
    });
    expect(jiraStore.held.size).toBe(0);
  });

  test("a new filter without credentials keeps the stored ones; with none stored it is refused", async () => {
    const empty = scriptedIssueService();
    expect(
      await empty.service.jiraConnection.connect("proj_1", { filter, linkPullRequests: false }),
    ).toEqual({ success: false, error: { code: "JIRA_NOT_CONFIGURED" } });

    const { service, jiraStore } = scriptedIssueService(connected);
    const changed = await service.jiraConnection.connect("proj_1", {
      filter: { projects: [], jql: "assignee = currentUser()" },
      linkPullRequests: false,
    });
    expect(changed.success).toBe(true);
    expect(jiraStore.held.get("proj_1")).toMatchObject({
      credentials: { apiToken: JIRA_TOKEN },
      filter: { projects: [], jql: "assignee = currentUser()" },
      linkPullRequests: false,
    });
  });

  test("testing names the account and its projects; disconnecting removes the token", async () => {
    const { service, jiraStore } = scriptedIssueService(connected);
    expect(await service.jiraConnection.test("proj_1", {})).toEqual({
      success: true,
      result: {
        account: { displayName: "Sam Rivera", email: "sam@acme.test", avatarUrl: null },
        projects: [{ key: "APP", name: "Mobile App" }],
      },
    });
    expect(
      await service.jiraConnection.test("proj_1", {
        credentials: cloudCredentials({ apiToken: "nope" }),
      }),
    ).toEqual({ success: false, error: { code: "JIRA_UNAUTHORIZED" } });
    expect(await service.jiraConnection.disconnect("proj_1")).toEqual({ success: true });
    expect(jiraStore.held.size).toBe(0);
    expect(await service.jiraConnection.test("proj_1", {})).toEqual({
      success: false,
      error: { code: "JIRA_NOT_CONFIGURED" },
    });
  });

  test("every Jira call on an unknown project is not found", async () => {
    const { service } = scriptedIssueService();
    const notFound = { success: false, error: { code: "PROJECT_NOT_FOUND" } } as const;
    expect(await service.jiraConnection.connection("nope")).toEqual(notFound);
    expect(await service.jiraConnection.test("nope", { credentials })).toEqual(notFound);
    expect(
      await service.jiraConnection.connect("nope", { credentials, filter, linkPullRequests: true }),
    ).toEqual(notFound);
    expect(await service.jiraConnection.disconnect("nope")).toEqual(notFound);
  });
});
