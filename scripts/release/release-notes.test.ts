import { describe, expect, test } from "bun:test";
import { generateNotesArgs, previousReleaseTag } from "./release-notes.ts";

describe("previousReleaseTag", () => {
  test("is the newest published release older than the tag, by version not by list order", () => {
    const tags = ["v0.10.4", "v0.9.51", "v0.10.10", "v0.10.3", "v0.10.11"];
    expect(previousReleaseTag(tags, "v0.10.11")).toBe("v0.10.10");
    expect(previousReleaseTag(tags, "v0.10.5")).toBe("v0.10.4");
  });

  test("skips the tag itself (a rerun after the release exists) and anything that is not a release", () => {
    expect(previousReleaseTag(["v0.10.5", "nightly", "0.10.4", "v0.10.3"], "v0.10.5")).toBe(
      "v0.10.3",
    );
  });

  test("is null for the first release", () => {
    expect(previousReleaseTag([], "v0.10.5")).toBeNull();
    expect(previousReleaseTag(["v0.10.6"], "v0.10.5")).toBeNull();
  });
});

describe("generateNotesArgs", () => {
  test("names the previous tag so GitHub does not guess an older one", () => {
    expect(generateNotesArgs("get-aop/aop-mono", "v0.10.5", "v0.10.4")).toEqual([
      "api",
      "repos/get-aop/aop-mono/releases/generate-notes",
      "-f",
      "tag_name=v0.10.5",
      "-f",
      "previous_tag_name=v0.10.4",
      "--jq",
      ".body",
    ]);
    expect(generateNotesArgs("o/r", "v1.0.0", null)).not.toContain("previous_tag_name");
  });
});
