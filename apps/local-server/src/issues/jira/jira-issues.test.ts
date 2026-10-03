import { describe, expect, test } from "bun:test";
import { createJiraIssueLoader } from "./jira-issues.ts";
import { jiraConnection, jiraNode, scriptedJira } from "./test-utils.ts";

const nodes = (count: number) =>
  Array.from({ length: count }, (_, index) => jiraNode(`APP-${count - index}`));

const setup = (count = 3) => {
  const jira = scriptedJira(nodes(count));
  let now = 1_000_000;
  const loader = createJiraIssueLoader(jira.api, { now: () => now });
  const load = (
    overrides: {
      limit?: number;
      refresh?: boolean;
      connection?: ReturnType<typeof jiraConnection>;
    } = {},
  ) =>
    loader.load({
      projectId: "proj_1",
      connection: overrides.connection ?? jiraConnection(),
      state: "open",
      limit: overrides.limit ?? 100,
      refresh: overrides.refresh ?? false,
    });
  return { jira, loader, load, advance: (ms: number) => (now += ms) };
};

describe("the Jira issue loader", () => {
  test("reads the saved filter's open issues, newest first, and reuses them for a minute", async () => {
    const { jira, load, advance } = setup();
    const first = await load();
    expect(first.issues.map((issue) => issue.identifier)).toEqual(["APP-3", "APP-2", "APP-1"]);
    expect(first).toMatchObject({ hasMore: false, failure: null, fetchedAt: 1_000_000 });
    expect(jira.calls).toEqual([
      'search (project in ("APP")) AND (statusCategory != Done) ORDER BY updated DESC cursor=-',
    ]);
    await load();
    advance(59_000);
    await load();
    expect(jira.calls).toHaveLength(1);
    await load({ refresh: true });
    advance(61_000);
    await load();
    expect(jira.calls).toHaveLength(3);
  });

  test("pages until the limit, and says there are more", async () => {
    const { jira, load } = setup(230);
    const read = await load({ limit: 150 });
    expect(read.issues).toHaveLength(150);
    expect(read.hasMore).toBe(true);
    expect(jira.calls.map((call) => call.split("cursor=")[1])).toEqual(["-", "100"]);
    const more = await load({ limit: 300 });
    expect(more.issues).toHaveLength(230);
    expect(more.hasMore).toBe(false);
  });

  test("two loads at once share one read; a changed filter reads again", async () => {
    const { jira, load } = setup();
    await Promise.all([load(), load()]);
    expect(jira.calls).toHaveLength(1);
    await load({ connection: jiraConnection({ filter: { projects: ["OPS"], jql: null } }) });
    expect(jira.calls).toHaveLength(2);
  });

  test("a failure keeps the issues read last, marked by the failure", async () => {
    const { jira, load } = setup();
    await load();
    jira.state.failNext = { kind: "unauthorized", message: "Jira refused the token" };
    const failed = await load({ refresh: true });
    expect(failed.issues).toHaveLength(3);
    expect(failed.failure).toEqual({ kind: "unauthorized", message: "Jira refused the token" });
  });

  test("after a 429, Jira is left alone until its Retry-After has passed, Refresh included", async () => {
    const { jira, load, advance } = setup();
    jira.state.failNext = {
      kind: "rate-limited",
      message: "Jira asked AOP to slow down; it tries again in 30 s",
      retryAfterMs: 30_000,
    };
    expect((await load()).failure?.kind).toBe("rate-limited");
    advance(10_000);
    const quiet = await load({ refresh: true });
    expect(quiet.failure?.kind).toBe("rate-limited");
    expect(jira.calls).toHaveLength(1);
    advance(21_000);
    const back = await load({ refresh: true });
    expect(back.failure).toBeNull();
    expect(back.issues).toHaveLength(3);
    expect(jira.calls).toHaveLength(2);
  });

  test("forgetting a project drops its issues and its quiet time", async () => {
    const { jira, loader, load } = setup();
    jira.state.failNext = { kind: "rate-limited", message: "slow down", retryAfterMs: 60_000 };
    await load();
    loader.forget("proj_1");
    expect((await load()).failure).toBeNull();
  });

  test("Load older issues during a smaller read gets its own read", async () => {
    const { jira, load } = setup(230);
    const [small, large] = await Promise.all([load({ limit: 100 }), load({ limit: 200 })]);
    expect(small.issues).toHaveLength(100);
    expect(large.issues).toHaveLength(200);
    expect(jira.calls.length).toBeGreaterThan(1);
  });

  test("a read that started before the connection changed is not kept", async () => {
    const { loader, load } = setup();
    const reading = load();
    loader.forget("proj_1");
    expect((await reading).failure?.message).toContain("connection changed");
    expect((await load()).failure).toBeNull();
  });
});
