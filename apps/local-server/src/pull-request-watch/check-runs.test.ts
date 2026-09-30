import { describe, expect, test } from "bun:test";
import type { PullRequestChecks } from "@aop/common";
import type { GhPullRequestCheck } from "../github-cli/index.ts";
import { sameChecks, summarizeChecks } from "./check-runs.ts";

const check = (name: string, bucket: string, state: string): GhPullRequestCheck => ({
  name,
  workflow: "ci",
  state,
  bucket,
  link: "https://github.com/acme/widget/actions/runs/1/job/1",
  startedAt: null,
  completedAt: null,
  description: null,
});

describe("summarizeChecks", () => {
  test("adds up a round that is still running, failed or passed", () => {
    const passing = check("build", "pass", "SUCCESS");
    const failing = check("test", "fail", "FAILURE");
    const running = check("lint", "pending", "IN_PROGRESS");

    expect(summarizeChecks({ reported: true, checks: [passing, running] })).toEqual({
      state: "pending",
      successful: 1,
      failing: 0,
      pending: 1,
    });
    expect(summarizeChecks({ reported: true, checks: [passing, failing] })).toEqual({
      state: "failure",
      successful: 1,
      failing: 1,
      pending: 0,
    });
    expect(summarizeChecks({ reported: true, checks: [passing] })).toEqual({
      state: "success",
      successful: 1,
      failing: 0,
      pending: 0,
    });
  });

  test("has no summary for a repository that runs no checks", () => {
    expect(summarizeChecks({ reported: false, checks: [] })).toBeNull();
    expect(summarizeChecks({ reported: true, checks: [] })).toBeNull();
  });
});

describe("sameChecks", () => {
  const failing: PullRequestChecks = { state: "failure", successful: 1, failing: 1, pending: 0 };

  test("compares what was published with what was read, including the absence of both", () => {
    expect(sameChecks(undefined, null)).toBe(true);
    expect(sameChecks(failing, { ...failing })).toBe(true);
    expect(sameChecks(undefined, failing)).toBe(false);
    expect(sameChecks(failing, null)).toBe(false);
    expect(sameChecks(failing, { ...failing, successful: 2 })).toBe(false);
    expect(sameChecks(failing, { ...failing, state: "pending" })).toBe(false);
  });
});
