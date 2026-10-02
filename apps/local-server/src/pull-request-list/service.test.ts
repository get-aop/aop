import { describe, expect, test } from "bun:test";
import {
  type PullRequestListQueryInput,
  PullRequestListQuerySchema,
  type Thread,
  ThreadSchema,
} from "@aop/common";
import { makePrArtifact, makeThread } from "@aop/common/test-utils";
import { createGithubService } from "../github/service.ts";
import { gitWithRemotes } from "../github/test-utils.ts";
import { createPullRequestListService } from "./service.ts";
import { createFakeGithub, makeNode } from "./test-utils.ts";

const REMOTES: Record<string, string | undefined> = {
  "/r/shop": "git@github.com:acme/shop.git",
  "/r/docs": "https://github.com/acme/docs.git",
  "/r/local": "/srv/git/local.git",
};

/** A project over the given repositories (ids are their folder names), served by a fake GitHub. */
const setup = (
  options: { repos?: string[]; threads?: Thread[]; pageSize?: number; ghMissing?: boolean } = {},
) => {
  let at = Date.parse("2026-10-02T12:00:00Z");
  const fake = createFakeGithub({ pageSize: options.pageSize });
  const repoIds = options.repos ?? ["shop"];
  const ctx = {
    projectRepository: {
      getById: async (id: string) => (id === "proj_1" ? { repoIds } : null),
    },
    repoRepository: {
      getById: async (id: string) => ({ id, path: `/r/${id}` }),
    },
  } as unknown as Parameters<typeof createGithubService>[0];
  const github = createGithubService(ctx, {
    runGh: options.ghMissing
      ? async () => {
          throw new Error('Executable not found in $PATH: "gh"');
        }
      : fake.run,
    runGit: gitWithRemotes(REMOTES).run,
    now: () => at,
  });
  const service = createPullRequestListService({
    github,
    threads: { listByProject: async () => options.threads ?? [] },
    now: () => at,
  });
  const list = async (query: PullRequestListQueryInput = {}) =>
    service.list("proj_1", PullRequestListQuerySchema.parse(query));
  const ready = async (query: PullRequestListQueryInput = {}) => {
    const result = await list(query);
    if (result?.status !== "ready") throw new Error(`not ready: ${JSON.stringify(result)}`);
    return result;
  };
  return { fake, list, ready, service, advance: (ms: number) => (at += ms) };
};

const node = (number: number, overrides: Record<string, unknown> = {}) =>
  makeNode({
    number,
    title: `PR ${number}`,
    url: `https://github.com/acme/shop/pull/${number}`,
    updatedAt: `2026-09-${String(number).padStart(2, "0")}T00:00:00Z`,
    ...overrides,
  });

describe("the pull request list", () => {
  test("lists the open pull requests of every GitHub repository, and marks a thread's", async () => {
    const thread = ThreadSchema.parse(
      makeThread({
        id: "thread_1",
        repoId: "shop",
        status: "ready-for-review",
        artifacts: [makePrArtifact({ number: 2, url: "https://github.com/acme/shop/pull/2" })],
      }),
    );
    const { fake, ready } = setup({ repos: ["shop", "docs", "local"], threads: [thread] });
    fake.setPulls("acme/shop", [node(1), node(2), node(3, { state: "MERGED" })]);
    fake.setPulls("acme/docs", [node(5, { url: "https://github.com/acme/docs/pull/5" })]);

    const result = await ready();

    expect(result.viewerLogin).toBe("ada");
    expect(result.items.map((item) => [item.repo, item.number, item.threadId])).toEqual([
      ["acme/docs", 5, null],
      ["acme/shop", 2, "thread_1"],
      ["acme/shop", 1, null],
    ]);
    expect(result.total).toBe(3);
    expect(result.repos).toEqual([
      { repoId: "shop", name: "shop", nameWithOwner: "acme/shop", error: null, truncated: false },
      { repoId: "docs", name: "docs", nameWithOwner: "acme/docs", error: null, truncated: false },
      { repoId: "local", name: "local", nameWithOwner: null, error: null, truncated: false },
    ]);
    expect(result.fetchedAt).toBe("2026-10-02T12:00:00.000Z");
  });

  test("closed and merged come from their own read, and all has both once", async () => {
    const { fake, ready } = setup();
    fake.setPulls("acme/shop", [
      node(1),
      node(2, { state: "CLOSED" }),
      node(3, { state: "MERGED" }),
    ]);

    expect((await ready({ state: "closed" })).items.map((item) => item.number)).toEqual([2]);
    expect((await ready({ state: "merged" })).items.map((item) => item.number)).toEqual([3]);
    expect((await ready({ state: "all" })).items.map((item) => item.number)).toEqual([3, 2, 1]);
  });

  describe("when it cannot list", () => {
    test("a project with no repositories says so", async () => {
      expect(await setup({ repos: [] }).list()).toEqual({
        status: "unavailable",
        reason: "no-repos",
        message: "This project has no repositories.",
        repos: [],
      });
    });

    test("a project with no GitHub repository says so, without asking gh", async () => {
      const { fake, list } = setup({ repos: ["local"] });
      expect(await list()).toMatchObject({ status: "unavailable", reason: "no-github-repos" });
      expect(fake.calls).toHaveLength(0);
    });

    test("a signed-out gh says to sign in", async () => {
      const { fake, list } = setup();
      fake.state.signedOut = true;
      expect(await list()).toMatchObject({
        status: "unavailable",
        reason: "signed-out",
        message: expect.stringContaining("gh auth login"),
      });
    });

    test("a host without gh says so", async () => {
      expect(await setup({ ghMissing: true }).list()).toMatchObject({ reason: "gh-missing" });
    });

    test("a project that does not exist is null", async () => {
      const { service } = setup();
      expect(await service.list("nope", PullRequestListQuerySchema.parse({}))).toBeNull();
    });
  });

  describe("paging", () => {
    test("reads every page from GitHub, and hands the list out in pages", async () => {
      const { fake, ready } = setup({ pageSize: 2 });
      fake.setPulls(
        "acme/shop",
        [1, 2, 3, 4, 5].map((n) => node(n)),
      );

      const first = await ready({ limit: 3 });
      const second = await ready({ limit: 3, cursor: first.nextCursor ?? undefined });

      expect(fake.graphqlCalls()).toBe(3);
      expect(first.items.map((item) => item.number)).toEqual([5, 4, 3]);
      expect(first.total).toBe(5);
      expect(second.items.map((item) => item.number)).toEqual([2, 1]);
      expect(second.nextCursor).toBeNull();
    });

    test("stops at the cap and says the oldest are left out", async () => {
      const { fake, ready } = setup({ pageSize: 1 });
      fake.setPulls(
        "acme/shop",
        [1, 2, 3, 4, 5, 6].map((n) => node(n, { state: "CLOSED" })),
      );

      const result = await ready({ state: "closed" });

      expect(fake.graphqlCalls()).toBe(3);
      expect(result.total).toBe(3);
      expect(result.repos[0]?.truncated).toBe(true);
    });
  });

  describe("staying within GitHub's rate limits", () => {
    test("a read answers for 30 seconds", async () => {
      const { fake, ready, advance } = setup();
      fake.setPulls("acme/shop", [node(1)]);
      await ready();
      const calls = fake.calls.length;

      advance(29_000);
      await ready({ q: "PR" });
      expect(fake.calls.length).toBe(calls);
    });

    test("after that an unchanged list is confirmed by a free 304, not read again", async () => {
      const { fake, ready, advance } = setup();
      fake.setPulls("acme/shop", [node(1)]);
      await ready();
      const graphql = fake.graphqlCalls();

      advance(31_000);
      const result = await ready();

      expect(fake.graphqlCalls()).toBe(graphql);
      expect(fake.calls.at(-1)).toEqual([
        "api",
        "-i",
        "repos/acme/shop/pulls?state=all&sort=updated&direction=desc&per_page=1",
        "-H",
        'If-None-Match: W/"v2"',
      ]);
      expect(result.fetchedAt).toBe("2026-10-02T12:00:31.000Z");
    });

    test("a change on GitHub is read again", async () => {
      const { fake, ready, advance } = setup();
      fake.setPulls("acme/shop", [node(1)]);
      await ready();

      fake.setPulls("acme/shop", [node(1), node(2)]);
      advance(31_000);

      expect((await ready()).total).toBe(2);
    });

    test("checks still running are read again without asking the probe", async () => {
      const { fake, ready, advance } = setup();
      const running = {
        nodes: [{ commit: { statusCheckRollup: { state: "PENDING", contexts: null } } }],
      };
      fake.setPulls("acme/shop", [node(1, { commits: running })]);
      await ready();
      const probes = fake.probes();

      advance(31_000);
      await ready();

      expect(fake.graphqlCalls()).toBe(2);
      expect(fake.probes()).toBe(probes + 1);
    });

    test("no read is reused for more than five minutes", async () => {
      const { fake, ready, advance } = setup();
      fake.setPulls("acme/shop", [node(1)]);
      await ready();

      advance(5 * 60_000);
      await ready();

      expect(fake.graphqlCalls()).toBe(2);
    });

    test("Refresh reads again, but a burst of them costs one read", async () => {
      const { fake, ready, advance } = setup();
      fake.setPulls("acme/shop", [node(1)]);
      await ready();

      advance(1_000);
      await ready({ refresh: true });
      expect(fake.graphqlCalls()).toBe(1);

      advance(3_000);
      await Promise.all([ready({ refresh: true }), ready({ refresh: true })]);
      expect(fake.graphqlCalls()).toBe(2);
    });

    test("a failed read keeps the last good list, says why, and is tried again next time", async () => {
      const { fake, ready, advance } = setup();
      fake.setPulls("acme/shop", [node(1)]);
      await ready();

      fake.state.failing = "gh: API rate limit exceeded";
      advance(5 * 60_000);
      const failed = await ready();
      expect(failed.items.map((item) => item.number)).toEqual([1]);
      expect(failed.repos[0]?.error).toBe("gh: API rate limit exceeded");
      expect(failed.fetchedAt).toBe("2026-10-02T12:00:00.000Z");

      fake.state.failing = null;
      expect((await ready()).repos[0]?.error).toBeNull();
    });
  });
});
