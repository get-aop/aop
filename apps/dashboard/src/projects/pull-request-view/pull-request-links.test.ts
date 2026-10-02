import { describe, expect, test } from "bun:test";
import { parsePullRequestUrl, targetOf } from "./pull-request-links";

const repos = [
  { repoId: "repo_1", name: "app", nameWithOwner: "acme/app" },
  { repoId: "repo_2", name: "local", nameWithOwner: null },
];

describe("pull request links", () => {
  test("reads owner/name and number from a GitHub pull request URL, and nothing else", () => {
    expect(parsePullRequestUrl("https://github.com/acme/app/pull/752")).toEqual({
      nameWithOwner: "acme/app",
      number: 752,
    });
    expect(parsePullRequestUrl("https://github.com/acme/app/pull/752/files#diff-1")?.number).toBe(
      752,
    );
    for (const url of [
      "https://github.com/acme/app/issues/3",
      "https://gitlab.com/acme/app/pull/1",
      "javascript:alert(1)",
      undefined,
    ]) {
      expect(parsePullRequestUrl(url)).toBeNull();
    }
  });

  test("a link opens the view when it is one of the project's repositories", () => {
    expect(targetOf("p1", repos, "https://github.com/ACME/App/pull/9")).toEqual({
      projectId: "p1",
      repoId: "repo_1",
      number: 9,
    });
    expect(targetOf("p1", repos, "https://github.com/other/repo/pull/9")).toBeNull();
  });

  test("a chip that knows its repository needs no lookup", () => {
    expect(targetOf("p1", [], "https://github.com/acme/app/pull/9", "repo_2")).toEqual({
      projectId: "p1",
      repoId: "repo_2",
      number: 9,
    });
  });
});
