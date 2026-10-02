import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { graphqlQuery, restGet } from "./gh-api.ts";
import { fail, httpAnswer, ok, scriptedCommand } from "./test-utils.ts";

const Data = z.object({ viewer: z.object({ login: z.string() }) });

describe("graphqlQuery", () => {
  test("passes the query and types each variable, and returns the checked data", async () => {
    const gh = scriptedCommand(() => ok(JSON.stringify({ data: { viewer: { login: "ada" } } })));

    const read = await graphqlQuery(
      gh.run,
      "/tmp",
      "query { viewer { login } }",
      { owner: "get-aop", first: 50, draft: false, states: ["OPEN", "MERGED"], after: null },
      Data,
    );

    expect(read).toEqual({ ok: true, value: { viewer: { login: "ada" } } });
    expect(gh.calls[0]).toEqual([
      "api",
      "graphql",
      "-f",
      "query=query { viewer { login } }",
      "-f",
      "owner=get-aop",
      "-F",
      "first=50",
      "-F",
      "draft=false",
      "-f",
      "states[]=OPEN",
      "-f",
      "states[]=MERGED",
    ]);
  });

  test("GraphQL errors become the failure's message", async () => {
    const gh = scriptedCommand(() =>
      ok(JSON.stringify({ errors: [{ message: "Could not resolve to a Repository" }] })),
    );

    expect(await graphqlQuery(gh.run, "/tmp", "q", {}, Data)).toEqual({
      ok: false,
      message: "Could not resolve to a Repository",
      rateLimited: false,
    });
  });

  test("data of another shape is refused", async () => {
    const gh = scriptedCommand(() => ok(JSON.stringify({ data: { viewer: null } })));

    const read = await graphqlQuery(gh.run, "/tmp", "q", {}, Data);
    expect(read.ok).toBe(false);
  });

  test("a throttled gh says so", async () => {
    const gh = scriptedCommand(() => fail("gh: API rate limit exceeded for user"));

    const read = await graphqlQuery(gh.run, "/tmp", "q", {}, Data);
    expect(read).toMatchObject({ ok: false, rateLimited: true });
  });

  test("a gh that cannot start is a failure, not a throw", async () => {
    const read = await graphqlQuery(
      async () => {
        throw new Error("spawn gh ENOENT");
      },
      "/tmp",
      "q",
      {},
      Data,
    );
    expect(read).toEqual({ ok: false, message: "spawn gh ENOENT", rateLimited: false });
  });
});

describe("restGet", () => {
  test("returns the body and its ETag", async () => {
    const gh = scriptedCommand(() => httpAnswer(200, [{ number: 1 }], { Etag: 'W/"abc"' }));

    const read = await restGet(gh.run, "/tmp", "repos/o/r/pulls?per_page=1");

    expect(read).toEqual({
      ok: true,
      value: { notModified: false, etag: 'W/"abc"', body: [{ number: 1 }] },
    });
    expect(gh.calls[0]).toEqual(["api", "-i", "repos/o/r/pulls?per_page=1"]);
  });

  test("sends the ETag, and a 304 (which gh exits 1 on) reads as not modified", async () => {
    const gh = scriptedCommand(() => httpAnswer(304, undefined, { Etag: 'W/"abc"' }));

    const read = await restGet(gh.run, "/tmp", "repos/o/r/pulls", { etag: 'W/"abc"' });

    expect(read).toEqual({ ok: true, value: { notModified: true, etag: 'W/"abc"' } });
    expect(gh.calls[0]).toEqual(["api", "-i", "repos/o/r/pulls", "-H", 'If-None-Match: W/"abc"']);
  });

  test("an error status is a failure with GitHub's message", async () => {
    const gh = scriptedCommand(() => httpAnswer(404, { message: "Not Found" }));

    expect(await restGet(gh.run, "/tmp", "repos/o/missing/pulls")).toEqual({
      ok: false,
      message: "HTTP 404: Not Found",
      rateLimited: false,
    });
  });

  test("output with no status line fails with gh's own words", async () => {
    const gh = scriptedCommand(() => fail("gh: To get started with GitHub CLI, run gh auth login"));

    const read = await restGet(gh.run, "/tmp", "user");
    expect(read).toMatchObject({ ok: false, message: expect.stringContaining("gh auth login") });
  });
});
