import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PairedDeviceSchema } from "@aop/common";
import type { Kysely } from "kysely";
import { createApp } from "../app.ts";
import { routeAccess } from "../auth/route-policy.ts";
import { LOOPBACK_PEER, REMOTE_PEER } from "../auth/test-utils.ts";
import type { CommandResult } from "../command-runner.ts";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb } from "../db/test-utils.ts";
import { createGithubService } from "../github/service.ts";
import { fail, gitWithRemotes, httpAnswer, ok, scriptedCommand } from "../github/test-utils.ts";
import { projectSettings } from "../project/test-utils.ts";
import { createPullRequestViewService } from "./service.ts";
import { checkRun, rawPullRequest, rawRepo } from "./test-utils.ts";

const PR = "/api/projects/proj_1/github/repos/repo_a/pulls/7";
const SHA = "a".repeat(40);
const JSON_HEADERS = { "content-type": "application/json" };

describe("the PR View routes", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let app: ReturnType<typeof createApp>;
  /** What the scripted `gh` answers; a test overrides one kind of call. */
  let answers: {
    signedIn: boolean;
    graphql: () => CommandResult;
    files: (page: string, etag: string | null) => CommandResult;
    write: (args: string[]) => CommandResult;
  };
  let gh: ReturnType<typeof scriptedCommand>;

  const graphqlCalls = () => gh.calls.filter((args) => args[1] === "graphql");

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    await ctx.repoRepository.create({ id: "repo_a", path: "/r/a", name: "a", remote_origin: null });
    await ctx.repoRepository.create({ id: "repo_b", path: "/r/b", name: "b", remote_origin: null });
    await ctx.repoRepository.create({ id: "repo_c", path: "/r/c", name: "c", remote_origin: null });
    await ctx.projectRepository.create({
      id: "proj_1",
      ...projectSettings({ repoIds: ["repo_a", "repo_b"] }),
    });
    answers = {
      signedIn: true,
      graphql: () =>
        ok(
          JSON.stringify({ data: { repository: { ...rawRepo(), pullRequest: rawPullRequest() } } }),
        ),
      files: (page) =>
        httpAnswer(
          200,
          page === "1"
            ? [
                {
                  filename: "a.ts",
                  status: "modified",
                  additions: 1,
                  deletions: 0,
                  patch: "@@ -1 +1 @@\n-a\n+b",
                },
              ]
            : [],
          { ETag: `"files-${page}"` },
        ),
      write: () => ok("{}"),
    };
    gh = scriptedCommand((args) => {
      if (args[0] === "api" && args[1] === "user") return userAnswer();
      if (args[1] === "graphql") return answers.graphql();
      if (args[1] === "-i") return restAnswer(args);
      return answers.write(args);
    });
    const github = createGithubService(ctx, {
      runGh: gh.run,
      runGit: gitWithRemotes({ "/r/a": "git@github.com:acme/app.git" }).run,
    });
    app = createApp({
      ctx,
      startTimeMs: Date.now(),
      github,
      pullRequestView: createPullRequestViewService({ github, runGh: gh.run }),
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  const userAnswer = () =>
    answers.signedIn
      ? ok("ada\n")
      : fail("To get started with GitHub CLI, please run:  gh auth login");

  const RULES = [
    {
      type: "required_status_checks",
      parameters: { required_status_checks: [{ context: "test" }] },
    },
  ];

  const restAnswer = (args: string[]) => {
    const path = args.find((arg) => arg.startsWith("repos/")) ?? "";
    const etag = args.find((arg) => arg.startsWith("If-None-Match: "))?.slice(15) ?? null;
    if (path.includes("/rules/branches/")) return httpAnswer(200, RULES, { ETag: '"rules"' });
    return answers.files(new URL(`https://x/${path}`).searchParams.get("page") ?? "", etag);
  };

  const local = (path: string, init: RequestInit = {}) =>
    app.request(`http://127.0.0.1:25150${path}`, init, LOOPBACK_PEER);
  const remote = (path: string, init: RequestInit = {}) =>
    app.request(`https://mac.tail1234.ts.net${path}`, init, REMOTE_PEER);
  const send = (
    method: string,
    body: unknown,
    headers: Record<string, string> = {},
  ): RequestInit => ({
    method,
    headers: { ...JSON_HEADERS, ...headers },
    body: JSON.stringify(body),
  });
  const pairDevice = async (): Promise<string> => {
    const code = (
      (await (await local("/api/auth/pairing-codes", { method: "POST" })).json()) as AnyJson
    ).code;
    const res = await remote("/api/auth/pair", send("POST", { code, name: "Laptop" }));
    return PairedDeviceSchema.parse(await res.json()).token;
  };

  describe("reads", () => {
    test("the page: one GraphQL read, the base branch's rules, and what the host owner may do", async () => {
      const res = await local(PR);
      expect(res.status).toBe(200);
      const body = (await res.json()) as AnyJson;
      expect(body).toMatchObject({
        nameWithOwner: "acme/app",
        number: 7,
        state: "open",
        merge: { status: "ready", missingRequiredChecks: [] },
        viewer: { canWrite: true, readOnlyReason: null, login: "ada" },
      });
      expect(graphqlCalls()).toHaveLength(1);
      expect(graphqlCalls()[0]).toContain("number=7");
      expect(gh.calls.some((args) => args.includes("repos/acme/app/rules/branches/main"))).toBe(
        true,
      );
    });

    test("an unchanged page answers 304 to its ETag, and a burst of reads costs GitHub one call", async () => {
      const first = await local(PR);
      const etag = first.headers.get("ETag") ?? "";
      expect(etag).toMatch(/^".+"$/);
      const again = await local(PR, { headers: { "If-None-Match": etag } });
      expect(again.status).toBe(304);
      expect(graphqlCalls()).toHaveLength(1);

      // Refresh skips the cache, and an unchanged answer still matches the ETag.
      const refreshed = await local(`${PR}?refresh=1`, { headers: { "If-None-Match": etag } });
      expect(refreshed.status).toBe(304);
      expect(graphqlCalls()).toHaveLength(2);
    });

    test("checks: the polled part, with the merge box", async () => {
      answers.graphql = () =>
        ok(
          JSON.stringify({
            data: {
              repository: {
                ...rawRepo(),
                pullRequest: rawPullRequest({
                  mergeStateStatus: "BLOCKED",
                  contexts: [checkRun("test", "IN_PROGRESS", null, { isRequired: true })],
                }),
              },
            },
          }),
        );
      const res = await local(`${PR}/checks`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        state: "open",
        headSha: SHA,
        checks: { state: "pending", pending: 1 },
        merge: { status: "blocked", blockers: [{ kind: "checks_pending" }] },
      });
      expect(graphqlCalls()[0]?.join(" ")).toContain("query PullRequestChecks");
    });

    test("files: each page conditional on its ETag, the kept answer reused on a 304", async () => {
      answers.files = (page, etag) =>
        etag === `"files-${page}"`
          ? httpAnswer(304, undefined, { ETag: etag })
          : httpAnswer(
              200,
              [{ filename: `p${page}.ts`, status: "added", additions: 2, deletions: 0 }],
              { ETag: `"files-${page}"` },
            );
      answers.graphql = () =>
        ok(
          JSON.stringify({
            data: {
              repository: { ...rawRepo(), pullRequest: rawPullRequest({ changedFiles: 150 }) },
            },
          }),
        );

      const first = (await (await local(`${PR}/files`)).json()) as AnyJson;
      expect(first.files.map((file: AnyJson) => file.path)).toEqual(["p1.ts", "p2.ts"]);
      const second = (await (await local(`${PR}/files`)).json()) as AnyJson;
      expect(second).toEqual(first);
      const conditional = gh.calls.filter((args) =>
        args.some((arg) => arg.startsWith("If-None-Match")),
      );
      expect(conditional).toHaveLength(2);
      expect(first.files[0]).toEqual({
        path: "p1.ts",
        previousPath: null,
        status: "added",
        additions: 2,
        deletions: 0,
        patch: null,
      });
    });

    test("a files page GitHub answered with something other than a list fails the read, instead of hiding files", async () => {
      answers.files = (page) =>
        httpAnswer(
          200,
          page === "1"
            ? [{ filename: "a.ts", status: "added", additions: 1, deletions: 0 }]
            : { truncated: "garbage" },
          {},
        );
      answers.graphql = () =>
        ok(
          JSON.stringify({
            data: {
              repository: { ...rawRepo(), pullRequest: rawPullRequest({ changedFiles: 150 }) },
            },
          }),
        );
      const res = await local(`${PR}/files`);
      expect(res.status).toBe(502);
      expect(((await res.json()) as AnyJson).error).toBe(
        "GitHub sent a list of files AOP could not read",
      );
    });

    test("a paired device reads the page, read-only", async () => {
      const token = await pairDevice();
      const res = await remote(PR, { headers: { authorization: `Bearer ${token}` } });
      expect(res.status).toBe(200);
      expect(((await res.json()) as AnyJson).viewer).toEqual({
        canWrite: false,
        readOnlyReason:
          "This device can read pull requests; only the host machine's owner can act on them.",
        login: "ada",
      });
    });

    test("a host account without write access is read-only too", async () => {
      answers.graphql = () =>
        ok(
          JSON.stringify({
            data: {
              repository: {
                ...rawRepo({ viewerPermission: "READ" }),
                pullRequest: rawPullRequest(),
              },
            },
          }),
        );
      const body = (await (await local(PR)).json()) as AnyJson;
      expect(body.viewer).toEqual({
        canWrite: false,
        readOnlyReason: "ada cannot write to acme/app.",
        login: "ada",
      });
    });
  });

  describe("errors", () => {
    const errorOf = async (path: string) => {
      const res = await local(path);
      return { status: res.status, ...((await res.json()) as AnyJson) };
    };

    test("not signed in to GitHub", async () => {
      answers.signedIn = false;
      expect(await errorOf(PR)).toMatchObject({ status: 503, code: "GITHUB_NOT_CONNECTED" });
    });

    test("a repository without a GitHub remote, or not in the project", async () => {
      expect(await errorOf(PR.replace("repo_a", "repo_b"))).toMatchObject({
        status: 409,
        code: "NO_GITHUB_REMOTE",
        error: "b has no GitHub remote, so it has no pull requests to show",
      });
      expect(await errorOf(PR.replace("repo_a", "repo_c"))).toMatchObject({
        status: 404,
        code: "REPO_NOT_IN_PROJECT",
      });
      expect(await errorOf(PR.replace("proj_1", "proj_x"))).toMatchObject({
        status: 404,
        code: "PROJECT_NOT_FOUND",
      });
    });

    test("no such pull request", async () => {
      answers.graphql = () =>
        ok(
          JSON.stringify({
            data: { repository: null },
            errors: [{ message: "Could not resolve to a PullRequest with the number of 7." }],
          }),
        );
      expect(await errorOf(PR)).toMatchObject({
        status: 404,
        code: "PULL_REQUEST_NOT_FOUND",
        error: "acme/app has no pull request #7",
      });
    });

    test("GitHub throttling", async () => {
      answers.graphql = () => fail("gh: API rate limit exceeded for user ID 1. (HTTP 403)");
      expect(await errorOf(PR)).toMatchObject({ status: 429, code: "GITHUB_RATE_LIMITED" });
    });

    test("a number that is not one is no route", async () => {
      expect((await local(PR.replace("/7", "/0"))).status).toBe(404);
      expect((await local(PR.replace("/7", "/x"))).status).toBe(404);
    });
  });

  describe("writes", () => {
    test("comment, review, merge, rename, close and draft each make one gh call", async () => {
      const writes = [
        ["POST", "/comments", { body: "Ship it" }],
        ["POST", "/reviews", { event: "APPROVE", body: "LGTM" }],
        ["POST", "/merge", { method: "squash", expectedHeadSha: SHA }],
        ["PATCH", "", { title: "Faster checkout" }],
        ["PATCH", "", { state: "closed" }],
        ["PATCH", "", { draft: true }],
        ["PATCH", "", { draft: false }],
      ] as const;
      for (const [method, suffix, body] of writes) {
        const res = await local(`${PR}${suffix}`, send(method, body));
        expect({ suffix, body, status: res.status }).toEqual({ suffix, body, status: 200 });
      }
      const made = gh.calls
        .filter((args) => args[1] === "-X" || args[0] === "pr")
        .map((args) => args.join(" "));
      expect(made).toEqual([
        "api -X POST repos/acme/app/issues/7/comments -f body=Ship it",
        "api -X POST repos/acme/app/pulls/7/reviews -f event=APPROVE -f body=LGTM",
        `api -X PUT repos/acme/app/pulls/7/merge -f merge_method=squash -f sha=${SHA}`,
        "api -X PATCH repos/acme/app/pulls/7 -f title=Faster checkout",
        "api -X PATCH repos/acme/app/pulls/7 -f state=closed",
        "pr ready 7 -R acme/app --undo",
        "pr ready 7 -R acme/app",
      ]);
      expect(made.some((call) => call.includes("--admin"))).toBe(false);
    });

    test("a merge GitHub refuses comes back with GitHub's reason, and is never forced", async () => {
      answers.write = () => fail('gh: Required status check "ci" is expected. (HTTP 405)');
      const res = await local(
        `${PR}/merge`,
        send("POST", { method: "merge", expectedHeadSha: SHA }),
      );
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({
        code: "GITHUB_REFUSED",
        error: 'GitHub refused: Required status check "ci" is expected.',
      });
      expect(gh.calls.filter((args) => args.includes("--admin"))).toEqual([]);
    });

    test("a write makes the next read ask GitHub again", async () => {
      await local(PR);
      await local(`${PR}/comments`, send("POST", { body: "One more thing" }));
      await local(PR);
      expect(graphqlCalls()).toHaveLength(2);
      await local(PR);
      expect(graphqlCalls()).toHaveLength(2);
    });

    test("bad bodies are turned away before GitHub is asked", async () => {
      for (const [method, suffix, body] of [
        ["POST", "/comments", { body: "  " }],
        ["POST", "/reviews", { event: "MERGE" }],
        ["POST", "/merge", { method: "squash", expectedHeadSha: "abc" }],
        ["PATCH", "", {}],
      ] as const) {
        expect((await local(`${PR}${suffix}`, send(method, body))).status).toBe(400);
      }
      expect(gh.calls.filter((args) => args[1] === "-X")).toEqual([]);
    });

    test("only the host owner may write: a paired device is refused before anything runs", async () => {
      const token = await pairDevice();
      const auth = { authorization: `Bearer ${token}` };
      for (const [method, suffix, body] of [
        ["POST", "/comments", { body: "hi" }],
        ["POST", "/reviews", { event: "APPROVE" }],
        ["POST", "/merge", { method: "squash", expectedHeadSha: SHA }],
        ["PATCH", "", { state: "closed" }],
      ] as const) {
        const res = await remote(`${PR}${suffix}`, send(method, body, auth));
        expect({ suffix, status: res.status, code: ((await res.json()) as AnyJson).code }).toEqual({
          suffix,
          status: 403,
          code: "HOST_ONLY",
        });
      }
      expect(gh.calls.filter((args) => args[1] === "-X" || args[0] === "pr")).toEqual([]);
    });

    test("the policy names the writes owner-only and leaves the reads to devices", () => {
      expect(routeAccess("POST", `${PR}/comments`)).toBe("owner");
      expect(routeAccess("POST", `${PR}/reviews`)).toBe("owner");
      expect(routeAccess("POST", `${PR}/merge`)).toBe("owner");
      expect(routeAccess("PATCH", PR)).toBe("owner");
      expect(routeAccess("GET", PR)).toBe("device");
      expect(routeAccess("GET", `${PR}/files`)).toBe("device");
      expect(routeAccess("GET", `${PR}/checks`)).toBe("device");
    });
  });
});
