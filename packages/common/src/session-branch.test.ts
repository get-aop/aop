import { describe, expect, test } from "bun:test";
import { suggestSessionBranchName } from "./session-branch.ts";

describe("suggestSessionBranchName", () => {
  test("builds aop/<slug>-<shortid> from title and session id", () => {
    expect(suggestSessionBranchName("Fix Auth Flow!", "csess_abc123def456")).toBe(
      "aop/fix-auth-flow-def456",
    );
  });

  test("falls back when title is empty or punctuation-only", () => {
    expect(suggestSessionBranchName("!!!", "csess_abcdef")).toBe("aop/session-abcdef");
  });
});
