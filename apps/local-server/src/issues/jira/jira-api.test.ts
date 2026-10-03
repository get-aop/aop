import { describe, expect, test } from "bun:test";
import type { JiraCredentials } from "@aop/common";
import { authorizationOf, createJiraApi, retryAfterOf } from "./jira-api.ts";
import { cloudCredentials, JIRA_TOKEN } from "./test-utils.ts";

const dataCenter: JiraCredentials = {
  deployment: "datacenter",
  siteUrl: "https://jira.acme.test",
  token: JIRA_TOKEN,
};

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch that answers from a queue (the last answer repeats) and records what it was sent. */
const scriptedFetch = (...answers: (() => Response)[]) => {
  const sent: Sent[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    sent.push({
      url,
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const answer = answers[Math.min(sent.length - 1, answers.length - 1)];
    return answer ? answer() : new Response(null, { status: 500 });
  };
  return { fetch, sent };
};

const json =
  (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  () =>
    Response.json(body, { status, headers });

const noSleep = () => {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
};

describe("the Jira API client", () => {
  test("Cloud signs in with Basic email:token on API v3, Data Center with a Bearer PAT on v2", async () => {
    const cloud = scriptedFetch(json({ displayName: "Sam", emailAddress: "sam@acme.test" }));
    const server = scriptedFetch(json({ displayName: "Sam DC", name: "sam" }));
    const cloudRead = await createJiraApi({ fetch: cloud.fetch }).myself(cloudCredentials());
    const serverRead = await createJiraApi({ fetch: server.fetch }).myself(dataCenter);

    expect(cloud.sent[0]?.url).toBe("https://acme.atlassian.net/rest/api/3/myself");
    expect(cloud.sent[0]?.headers.Authorization).toBe(
      `Basic ${Buffer.from(`sam@acme.test:${JIRA_TOKEN}`).toString("base64")}`,
    );
    expect(server.sent[0]?.url).toBe("https://jira.acme.test/rest/api/2/myself");
    expect(server.sent[0]?.headers.Authorization).toBe(`Bearer ${JIRA_TOKEN}`);
    expect(cloudRead).toEqual({
      ok: true,
      value: { displayName: "Sam", email: "sam@acme.test", avatarUrl: null },
    });
    expect(serverRead).toMatchObject({ ok: true, value: { displayName: "Sam DC", email: null } });
    expect(authorizationOf(dataCenter)).toBe(`Bearer ${JIRA_TOKEN}`);
  });

  test("Cloud pages with nextPageToken (none on the first page) until isLast", async () => {
    const { fetch, sent } = scriptedFetch(
      json({ issues: [{ id: "1", key: "APP-1" }], nextPageToken: "t2", isLast: false }),
      json({ issues: [{ id: "2", key: "APP-2" }], isLast: true }),
    );
    const api = createJiraApi({ fetch });
    const request = { jql: "project = APP", fields: ["summary"], maxResults: 100 };
    const first = await api.searchPage(cloudCredentials(), { ...request, cursor: null });
    const second = await api.searchPage(cloudCredentials(), { ...request, cursor: "t2" });

    expect(sent[0]?.url).toBe("https://acme.atlassian.net/rest/api/3/search/jql");
    expect(sent[0]?.body).toEqual({ jql: "project = APP", fields: ["summary"], maxResults: 100 });
    expect(sent[1]?.body).toMatchObject({ nextPageToken: "t2" });
    expect(first).toEqual({ ok: true, value: { issues: [{ id: "1", key: "APP-1" }], next: "t2" } });
    expect(second).toEqual({
      ok: true,
      value: { issues: [{ id: "2", key: "APP-2" }], next: null },
    });
  });

  test("a token on an empty page ends the list, so an endless token cannot loop", async () => {
    const { fetch } = scriptedFetch(json({ issues: [], nextPageToken: "again", isLast: false }));
    const page = await createJiraApi({ fetch }).searchPage(cloudCredentials(), {
      jql: "x",
      fields: [],
      maxResults: 100,
      cursor: "again",
    });
    expect(page).toEqual({ ok: true, value: { issues: [], next: null } });
  });

  test("Data Center pages with startAt against the total", async () => {
    const { fetch, sent } = scriptedFetch(
      json({
        issues: [
          { id: "1", key: "OPS-1" },
          { id: "2", key: "OPS-2" },
        ],
        total: 3,
      }),
      json({ issues: [{ id: "3", key: "OPS-3" }], total: 3 }),
    );
    const api = createJiraApi({ fetch });
    const request = { jql: "project = OPS", fields: ["summary"], maxResults: 2 };
    const first = await api.searchPage(dataCenter, { ...request, cursor: null });
    const second = await api.searchPage(dataCenter, { ...request, cursor: "2" });

    expect(sent[0]?.url).toBe("https://jira.acme.test/rest/api/2/search");
    expect(sent[1]?.body).toMatchObject({ startAt: 2, maxResults: 2 });
    expect(first.ok && first.value.next).toBe("2");
    expect(second.ok && second.value.next).toBe(null);
  });

  test("a 401, and Server's 403 for a refused login, are unauthorized; no answer has the token", async () => {
    const unauthorized = scriptedFetch(
      json({ errorMessages: ["Client must be authenticated to access this resource."] }, 401),
    );
    const seraph = scriptedFetch(json({}, 403, { "X-Seraph-LoginReason": "AUTHENTICATED_FAILED" }));
    const forbidden = scriptedFetch(json({ errorMessages: ["You do not have permission"] }, 403));
    const a = await createJiraApi({ fetch: unauthorized.fetch }).myself(cloudCredentials());
    const b = await createJiraApi({ fetch: seraph.fetch }).myself(dataCenter);
    const c = await createJiraApi({ fetch: forbidden.fetch }).myself(dataCenter);

    expect(a).toEqual({
      ok: false,
      failure: {
        kind: "unauthorized",
        message: "Jira refused the token: it may have expired or been revoked",
      },
    });
    expect(b).toMatchObject({ ok: false, failure: { kind: "unauthorized" } });
    expect(c).toEqual({
      ok: false,
      failure: {
        kind: "error",
        message: "Jira answered with an error: You do not have permission",
      },
    });
    for (const read of [a, b, c]) expect(JSON.stringify(read)).not.toContain(JIRA_TOKEN);
  });

  test("a short Retry-After is waited out, at most twice; a long one fails as rate-limited", async () => {
    const limited = json({ errorMessages: ["Rate limit exceeded."] }, 429, { "Retry-After": "2" });
    const recovers = scriptedFetch(limited, json({ displayName: "Sam" }));
    const persists = scriptedFetch(limited);
    const long = scriptedFetch(json({}, 429, { "Retry-After": "120" }));
    const waiting = noSleep();
    const api = (fetch: typeof recovers.fetch) =>
      createJiraApi({ fetch, sleep: waiting.sleep, maxWaitMs: 5_000 });

    expect(await api(recovers.fetch).myself(cloudCredentials())).toMatchObject({ ok: true });
    expect(waiting.waits).toEqual([2000]);
    const stuck = await api(persists.fetch).myself(cloudCredentials());
    expect(persists.sent).toHaveLength(3);
    expect(stuck).toMatchObject({
      ok: false,
      failure: { kind: "rate-limited", retryAfterMs: 2000 },
    });
    const later = await api(long.fetch).myself(cloudCredentials());
    expect(long.sent).toHaveLength(1);
    expect(later).toEqual({
      ok: false,
      failure: {
        kind: "rate-limited",
        message: "Jira asked AOP to slow down; it tries again in 120 s",
        retryAfterMs: 120_000,
      },
    });
  });

  test("Retry-After is seconds or an HTTP date; a minute when missing or unreadable", () => {
    const now = Date.parse("2026-10-03T10:00:00Z");
    expect(retryAfterOf("3", now)).toBe(3000);
    expect(retryAfterOf("Sat, 03 Oct 2026 10:00:30 GMT", now)).toBe(30_000);
    expect(retryAfterOf(null, now)).toBe(60_000);
    expect(retryAfterOf("soon", now)).toBe(60_000);
  });

  test("a bad JQL is a bad request with Jira's words; an unreachable site names its host only", async () => {
    const bad = scriptedFetch(
      json(
        {
          errorMessages: ["Field 'bogus' does not exist or you do not have permission to view it."],
        },
        400,
      ),
    );
    const read = await createJiraApi({ fetch: bad.fetch }).searchPage(cloudCredentials(), {
      jql: "bogus = 1",
      fields: [],
      maxResults: 1,
      cursor: null,
    });
    expect(read).toEqual({
      ok: false,
      failure: {
        kind: "bad-request",
        message: "Field 'bogus' does not exist or you do not have permission to view it.",
      },
    });

    const down = createJiraApi({
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(await down.myself(cloudCredentials())).toEqual({
      ok: false,
      failure: {
        kind: "error",
        message: "Jira could not be reached at acme.atlassian.net (TypeError)",
      },
    });
  });

  test("an issue is read with every field and their names; an unknown key is null", async () => {
    const found = scriptedFetch(
      json({ id: "1", key: "APP-1", fields: { summary: "S" }, names: { summary: "Summary" } }),
    );
    const missing = scriptedFetch(json({ errorMessages: ["Issue does not exist"] }, 404));
    expect(await createJiraApi({ fetch: found.fetch }).issue(cloudCredentials(), "APP-1")).toEqual({
      ok: true,
      value: {
        issue: { id: "1", key: "APP-1", fields: { summary: "S" } },
        names: { summary: "Summary" },
      },
    });
    expect(found.sent[0]?.url).toBe(
      "https://acme.atlassian.net/rest/api/3/issue/APP-1?fields=*all&expand=names",
    );
    expect(
      await createJiraApi({ fetch: missing.fetch }).issue(cloudCredentials(), "APP-9"),
    ).toEqual({
      ok: true,
      value: null,
    });
  });

  test("Cloud lists projects page by page; Data Center in one answer", async () => {
    const cloud = scriptedFetch(
      json({ values: [{ key: "APP", name: "Mobile App" }], isLast: false }),
      json({ values: [{ key: "OPS", name: "Operations" }], isLast: true }),
    );
    const server = scriptedFetch(json([{ key: "WEB", name: "Website" }]));
    expect(await createJiraApi({ fetch: cloud.fetch }).projects(cloudCredentials())).toEqual({
      ok: true,
      value: [
        { key: "APP", name: "Mobile App" },
        { key: "OPS", name: "Operations" },
      ],
    });
    expect(cloud.sent[1]?.url).toContain("startAt=1");
    expect(await createJiraApi({ fetch: server.fetch }).projects(dataCenter)).toEqual({
      ok: true,
      value: [{ key: "WEB", name: "Website" }],
    });
  });
});
