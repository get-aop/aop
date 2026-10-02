import { describe, expect, test } from "bun:test";
import { createGithubIssueLoader } from "./github-issues.ts";
import { githubNodes, scriptedGithub } from "./test-utils.ts";

const request = { nameWithOwner: "acme/app", state: "open" as const, limit: 100, refresh: false };

describe("the GitHub issue loader", () => {
  test("reads a page, then answers from what it holds within the reuse window", async () => {
    let now = 0;
    const { github, calls } = scriptedGithub({ issues: githubNodes(30) });
    const loader = createGithubIssueLoader(github, { now: () => now });

    const first = await loader.load(request);
    now += 10_000;
    const second = await loader.load(request);

    expect(first.nodes).toHaveLength(30);
    expect(second.nodes).toHaveLength(30);
    expect(first.failure).toBeNull();
    expect(calls).toEqual([
      "probe repos/acme/app/issues?state=all&sort=updated&direction=desc&per_page=1 -",
      "graphql after=0",
    ]);
  });

  test("past the window an unchanged probe (304) serves the held issues without a GraphQL read", async () => {
    let now = 0;
    const { github, calls } = scriptedGithub({ issues: githubNodes(3) });
    const loader = createGithubIssueLoader(github, { now: () => now });

    await loader.load(request);
    now += 60_000;
    const again = await loader.load(request);

    expect(again.nodes).toHaveLength(3);
    expect(again.fetchedAt).toBe(0);
    expect(calls.filter((call) => call.startsWith("graphql"))).toHaveLength(1);
    expect(calls.at(-1)).toContain(" v1");
  });

  test("a changed ETag reads the issues again", async () => {
    let now = 0;
    const state = { issues: githubNodes(3), etag: "v1" };
    const { github, calls } = scriptedGithub(state);
    const loader = createGithubIssueLoader(github, { now: () => now });

    await loader.load(request);
    state.etag = "v2";
    state.issues = githubNodes(4, 900);
    now += 1_000;
    const fresh = await loader.load({ ...request, refresh: true });

    expect(fresh.nodes.map((node) => node.number)).toEqual([900, 899, 898, 897]);
    expect(calls.filter((call) => call.startsWith("graphql"))).toHaveLength(2);
  });

  test("an unchanged answer older than the max age is read again, for the checks it cannot see", async () => {
    let now = 0;
    const { github, calls } = scriptedGithub({ issues: githubNodes(2) });
    const loader = createGithubIssueLoader(github, { now: () => now, maxAgeMs: 300_000 });

    await loader.load(request);
    now += 301_000;
    await loader.load(request);

    expect(calls.filter((call) => call.startsWith("graphql"))).toHaveLength(2);
  });

  test("a larger limit pages on from the held cursor and says when older issues remain", async () => {
    const { github, calls } = scriptedGithub({ issues: githubNodes(230) });
    const loader = createGithubIssueLoader(github);

    const first = await loader.load(request);
    const more = await loader.load({ ...request, limit: 200 });

    expect(first.nodes).toHaveLength(100);
    expect(first.hasMore).toBe(true);
    expect(more.nodes).toHaveLength(200);
    expect(more.hasMore).toBe(true);
    expect(calls.filter((call) => call.startsWith("graphql"))).toEqual([
      "graphql after=0",
      "graphql after=100",
    ]);
  });

  test("a failed read keeps the issues held, and says why", async () => {
    let now = 0;
    const state: { issues: ReturnType<typeof githubNodes>; fail?: string | null } = {
      issues: githubNodes(2),
    };
    const { github } = scriptedGithub(state);
    const loader = createGithubIssueLoader(github, { now: () => now });

    await loader.load(request);
    state.fail = "HTTP 502";
    now += 60_000;
    const read = await loader.load(request);

    expect(read.failure).toBe("HTTP 502");
    expect(read.nodes).toHaveLength(2);
    expect(read.fetchedAt).toBe(0);
  });

  test("two loads of the same list at once share one read", async () => {
    const { github, calls } = scriptedGithub({ issues: githubNodes(2) });
    const loader = createGithubIssueLoader(github);

    await Promise.all([loader.load(request), loader.load(request)]);

    expect(calls).toHaveLength(2);
  });

  test("each state filter is held on its own", async () => {
    const { github, calls } = scriptedGithub({ issues: githubNodes(2) });
    const loader = createGithubIssueLoader(github);

    await loader.load(request);
    await loader.load({ ...request, state: "closed" });

    expect(calls.filter((call) => call.startsWith("graphql"))).toHaveLength(2);
  });
});

describe("a repository name read from a git remote", () => {
  test("is refused before any request when it is not GitHub's shape", async () => {
    const { github, calls } = scriptedGithub({ issues: githubNodes(1) });
    const loader = createGithubIssueLoader(github);

    const read = await loader.load({ ...request, nameWithOwner: "acme/app?per_page=100&x=1" });

    expect(read.failure).toContain("Not a GitHub repository name");
    expect(calls).toEqual([]);
  });
});
