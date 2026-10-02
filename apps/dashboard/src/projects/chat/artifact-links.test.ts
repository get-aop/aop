import { describe, expect, test } from "bun:test";
import { artifactLinkOf, fileLinkOf, withArtifactLinks } from "./artifact-links";

describe("withArtifactLinks", () => {
  test("artifact links and file paths become addresses the renderer recognizes", () => {
    const out = withArtifactLinks(
      "See [the plan](artifact:lib_01abc), [plan](docs/plan.md), [abs](/Users/me/x.json) and [web](https://x.dev/a.md).",
    );
    const targets = [...out.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]);
    expect(targets.map((href) => artifactLinkOf(href))).toEqual(["lib_01abc", null, null, null]);
    expect(targets.map((href) => fileLinkOf(href))).toEqual([null, "docs/plan.md", "/Users/me/x.json", null]);
  });

  test("leaves code, anchors, folders and malformed ids alone", () => {
    const text = [
      "`[a](docs/a.md)`",
      "```md\n[b](docs/b.md)\n```",
      "[c](#heading)",
      "[d](src/)",
      "[e](artifact:bad id)",
      "[f](mailto:x@y.z)",
    ].join("\n");
    expect(withArtifactLinks(text)).toBe(text);
  });

  test("file: URLs and query strings are read as the path", () => {
    const out = withArtifactLinks("[r](file:///tmp/r.csv?x=1)");
    expect(fileLinkOf(/\]\(([^)]+)\)/.exec(out)?.[1])).toBe("/tmp/r.csv");
  });
});
