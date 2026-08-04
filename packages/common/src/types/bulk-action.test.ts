import { describe, expect, test } from "bun:test";
import { isRepoBulkAction, REPO_BULK_ACTIONS } from "./bulk-action.ts";

describe("bulk-action", () => {
  test("includes repo git pull as a repository action", () => {
    expect(REPO_BULK_ACTIONS).toContain("git-pull");
    expect(isRepoBulkAction("git-pull")).toBe(true);
  });
});
