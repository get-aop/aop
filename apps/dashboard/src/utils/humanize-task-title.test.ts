import { describe, expect, test } from "bun:test";
import { humanizeTaskTitle } from "./humanize-task-title";

describe("humanizeTaskTitle", () => {
  test("strips the trailing hash and renders sentence case", () => {
    expect(humanizeTaskTitle("add-icons-on-every-sidebar-item-and-make-collapse--054b1045")).toBe(
      "Add icons on every sidebar item and make collapse",
    );
  });

  test("handles a single trailing dash before the hash", () => {
    expect(humanizeTaskTitle("fix-login-flow-9f3a2b1c")).toBe("Fix login flow");
  });

  test("uses only the last path segment", () => {
    expect(humanizeTaskTitle("docs/tasks/refactor-executor-abcdef12")).toBe("Refactor executor");
  });

  test("keeps all-letter words that are coincidentally hex", () => {
    expect(humanizeTaskTitle("build-a-facade")).toBe("Build a facade");
  });

  test("leaves an already-clean slug humanized", () => {
    expect(humanizeTaskTitle("metrics-overview")).toBe("Metrics overview");
  });

  test("does not strip short hex-like trailing tokens", () => {
    expect(humanizeTaskTitle("update-ab12")).toBe("Update ab12");
  });
});
