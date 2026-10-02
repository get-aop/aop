import { describe, expect, test } from "bun:test";
import { githubNameWithOwner } from "./remote.ts";

describe("githubNameWithOwner", () => {
  test.each([
    ["https://github.com/get-aop/aop.git", "get-aop/aop"],
    ["https://github.com/get-aop/aop", "get-aop/aop"],
    ["https://token@github.com/get-aop/aop.git\n", "get-aop/aop"],
    ["git@github.com:get-aop/aop.git", "get-aop/aop"],
    ["ssh://git@github.com/get-aop/aop", "get-aop/aop"],
    ["ssh://git@github.com:22/get-aop/my.repo.git", "get-aop/my.repo"],
    ["HTTPS://GitHub.com/Org/Repo/", "Org/Repo"],
  ])("reads %s", (url, expected) => {
    expect(githubNameWithOwner(url)).toBe(expected);
  });

  test.each([
    "https://gitlab.com/get-aop/aop.git",
    "/srv/git/aop.git",
    "https://github.com/get-aop",
    "https://notgithub.com/a/b",
    "",
  ])("is null for %p", (url) => {
    expect(githubNameWithOwner(url)).toBeNull();
  });
});
