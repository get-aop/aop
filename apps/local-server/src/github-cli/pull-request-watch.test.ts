import { describe, expect, test } from "bun:test";
import { readPullRequestChecks } from "./checks.ts";
import {
  listPullRequestReviews,
  listReviewComments,
  readPullRequestHead,
} from "./pull-request-watch.ts";
import type { CommandResult, RunGh } from "./run-gh.ts";

const ok = (stdout: string, exitCode = 0): CommandResult => ({ exitCode, stdout, stderr: "" });
const fail = (stderr: string, exitCode = 1): CommandResult => ({ exitCode, stdout: "", stderr });

/** A `gh` that answers every call with `result`, and remembers what it was asked. */
const scripted = (result: CommandResult | (() => Promise<CommandResult>)) => {
  const calls: { args: string[]; cwd: string; timeoutMs?: number }[] = [];
  const run: RunGh = async (args, cwd, options) => {
    calls.push({ args, cwd, timeoutMs: options?.timeoutMs });
    return typeof result === "function" ? result() : result;
  };
  return { run, calls };
};

describe("readPullRequestHead", () => {
  test("asks gh for the state, the merge state and the head commit of one pull request", async () => {
    const gh = scripted(
      ok('{"state":"OPEN","mergeable":"CONFLICTING","headRefOid":"abc123","baseRefName":"main"}\n'),
    );

    const read = await readPullRequestHead(gh.run, "/repo", 7);

    expect(read).toEqual({
      ok: true,
      value: { state: "OPEN", mergeable: "CONFLICTING", headSha: "abc123", baseRefName: "main" },
    });
    expect(gh.calls[0]).toMatchObject({
      args: ["pr", "view", "7", "--json", "state,mergeable,headRefOid,baseRefName"],
      cwd: "/repo",
    });
    // A read that hangs must not hold the watcher's slot for good.
    expect(gh.calls[0]?.timeoutMs).toBeGreaterThan(0);
  });

  test("takes a merge state gh has not worked out yet as unknown", async () => {
    const gh = scripted(ok('{"state":"MERGED","headRefOid":"abc123"}'));

    expect(await readPullRequestHead(gh.run, "/repo", 7)).toMatchObject({
      ok: true,
      value: { state: "MERGED", mergeable: "UNKNOWN", baseRefName: "" },
    });
  });

  test("says why it could not read, and whether GitHub is throttling", async () => {
    expect(await readPullRequestHead(scripted(fail("HTTP 502")).run, "/repo", 7)).toEqual({
      ok: false,
      message: "HTTP 502",
      rateLimited: false,
    });
    expect(
      await readPullRequestHead(
        scripted(fail("gh: API rate limit exceeded (HTTP 403)")).run,
        "/repo",
        7,
      ),
    ).toMatchObject({ ok: false, rateLimited: true });
    expect(await readPullRequestHead(scripted(ok("not json")).run, "/repo", 7)).toMatchObject({
      ok: false,
      message: "GitHub CLI returned malformed pull request JSON",
    });
    expect(
      await readPullRequestHead(scripted(ok('{"state":"DRAFT"}')).run, "/repo", 7),
    ).toMatchObject({
      ok: false,
    });
  });

  test("a gh that cannot be started or times out is a failed read, not an exception", async () => {
    const missing = scripted(async () => {
      throw new Error("spawn gh ENOENT");
    });

    expect(await readPullRequestHead(missing.run, "/repo", 7)).toEqual({
      ok: false,
      message: "spawn gh ENOENT",
      rateLimited: false,
    });
  });
});

describe("readPullRequestChecks", () => {
  const rows = JSON.stringify([
    { name: "test", state: "FAILURE", bucket: "fail", workflow: "ci", link: "https://x/1" },
  ]);

  test("returns the checks even when gh exits non-zero for them, as it does for failing or pending ones", async () => {
    for (const exitCode of [0, 1, 8]) {
      const read = await readPullRequestChecks(scripted(ok(rows, exitCode)).run, "/repo", "7");

      expect(read).toMatchObject({
        ok: true,
        value: { reported: true, checks: [{ name: "test" }] },
      });
    }
  });

  test("a repository without checks reports none, which is not a failed read", async () => {
    const gh = scripted(fail("no checks reported on the 'aop/x' branch"));

    expect(await readPullRequestChecks(gh.run, "/repo", "7")).toEqual({
      ok: true,
      value: { reported: false, checks: [] },
    });
  });

  test("an answer gh never gave is a failed read, so its checks are not taken for gone", async () => {
    expect(await readPullRequestChecks(scripted(fail("HTTP 401")).run, "/repo", "7")).toEqual({
      ok: false,
      message: "HTTP 401",
      rateLimited: false,
    });
    expect(
      await readPullRequestChecks(scripted(fail("API rate limit exceeded")).run, "/repo", "7"),
    ).toMatchObject({ ok: false, rateLimited: true });
  });
});

describe("listPullRequestReviews", () => {
  test("reads every page of the reviews of the pull request, oldest first, keeping what the watcher needs", async () => {
    const page1 = [
      {
        id: 12,
        state: "CHANGES_REQUESTED",
        body: "Fix it",
        user: { login: "bob" },
        author_association: "MEMBER",
        extra: true,
      },
    ];
    const page2 = [{ id: 10, state: "COMMENTED", body: null, user: null }, { id: "broken" }];
    const gh = scripted(ok(`${JSON.stringify(page1)}\n${JSON.stringify(page2)}\n`));

    const read = await listPullRequestReviews(gh.run, "/repo", 7);

    expect(read).toEqual({
      ok: true,
      value: [
        { id: 10, state: "COMMENTED", body: "", author: "someone", association: "NONE" },
        {
          id: 12,
          state: "CHANGES_REQUESTED",
          body: "Fix it",
          author: "bob",
          association: "MEMBER",
        },
      ],
    });
    // gh fills in the repository from the checkout it runs in.
    expect(gh.calls[0]?.args).toEqual([
      "api",
      "repos/{owner}/{repo}/pulls/7/reviews?per_page=100",
      "--paginate",
    ]);
  });

  test("a failed or malformed answer is a failed read", async () => {
    expect(await listPullRequestReviews(scripted(fail("HTTP 404")).run, "/repo", 7)).toMatchObject({
      ok: false,
      message: "HTTP 404",
    });
    expect(
      await listPullRequestReviews(scripted(ok('{"message":"Not Found"}')).run, "/repo", 7),
    ).toEqual({ ok: false, message: "GitHub CLI returned malformed JSON", rateLimited: false });
  });
});

describe("listReviewComments", () => {
  test("reads the line comments with the review each was made in", async () => {
    const gh = scripted(
      ok(
        JSON.stringify([
          {
            id: 5,
            pull_request_review_id: 12,
            path: "src/a.ts",
            line: null,
            original_line: 9,
            body: "Why?",
            user: { login: "bob" },
          },
          { id: 4, pull_request_review_id: null, path: "b.ts", line: 3, body: "Nit", user: null },
        ]),
      ),
    );

    expect(await listReviewComments(gh.run, "/repo", 7)).toEqual({
      ok: true,
      value: [
        { id: 4, reviewId: null, path: "b.ts", line: 3, body: "Nit", author: "someone" },
        { id: 5, reviewId: 12, path: "src/a.ts", line: 9, body: "Why?", author: "bob" },
      ],
    });
    expect(gh.calls[0]?.args[1]).toBe("repos/{owner}/{repo}/pulls/7/comments?per_page=100");
  });
});
