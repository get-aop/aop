import { describe, expect, test } from "bun:test";
import { ArtifactSchema, PullRequestRefSchema } from "./artifact.ts";
import { makePrArtifact, parsed, rejectedPaths } from "./test-utils.ts";

describe("ArtifactSchema", () => {
  test("accepts a pull request item in each state", () => {
    for (const state of ["open", "merged", "closed"]) {
      expect(parsed(ArtifactSchema, makePrArtifact({ state }))).toEqual(makePrArtifact({ state }));
    }
  });

  test("accepts a document item", () => {
    const doc = { type: "doc", name: "Preset CTA Variants" };
    expect(parsed(ArtifactSchema, doc)).toEqual(doc);
  });

  test("rejects a pull request with a zero, negative, or fractional number", () => {
    for (const number of [0, -3, 4.5]) {
      expect(rejectedPaths(ArtifactSchema, makePrArtifact({ number }))).toEqual(["number"]);
    }
  });

  test.each(["pull/4821", "javascript:alert(1)", "data:text/html,<script>1</script>"])(
    "rejects pull request url %p, which is not a web link",
    (url) => {
      expect(rejectedPaths(ArtifactSchema, makePrArtifact({ url }))).toEqual(["url"]);
    },
  );

  test("rejects a pull request whose state is unknown", () => {
    expect(rejectedPaths(ArtifactSchema, makePrArtifact({ state: "draft" }))).toEqual(["state"]);
  });

  test("carries the checks summary the watcher read, and needs none", () => {
    const checks = { state: "failure", successful: 2, failing: 1, pending: 0 };
    expect(parsed(ArtifactSchema, makePrArtifact({ checks }))).toEqual(makePrArtifact({ checks }));
    expect(parsed(ArtifactSchema, makePrArtifact())).not.toHaveProperty("checks");
  });

  test("rejects checks whose state is unknown or whose count is negative or fractional", () => {
    const checks = { state: "failure", successful: 2, failing: 1, pending: 0 };
    expect(
      rejectedPaths(ArtifactSchema, makePrArtifact({ checks: { ...checks, state: "red" } })),
    ).toEqual(["checks.state"]);
    for (const failing of [-1, 1.5]) {
      expect(
        rejectedPaths(ArtifactSchema, makePrArtifact({ checks: { ...checks, failing } })),
      ).toEqual(["checks.failing"]);
    }
  });

  test("rejects an unknown type and a nameless document", () => {
    expect(rejectedPaths(ArtifactSchema, { type: "screenshot", name: "x" })).toEqual(["type"]);
    expect(rejectedPaths(ArtifactSchema, { type: "doc", name: "  " })).toEqual(["name"]);
  });
});

describe("PullRequestRefSchema", () => {
  test("describes the pull request without the artifact discriminator", () => {
    expect(PullRequestRefSchema.parse(makePrArtifact())).toEqual({
      number: 4821,
      url: "https://github.com/acme/checkout-service/pull/4821",
      state: "open",
    });
  });
});
