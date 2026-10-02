import { describe, expect, test } from "bun:test";
import { addNightlyBuild, parseNightlyIndex } from "./nightly-index.ts";

const build = (run: number, day = "20261002") => ({
  version: `0.10.7-nightly.${day}.${run}`,
  commit: `c${run}`,
  publishedAt: "2026-10-02T00:00:00Z",
});

describe("nightly index", () => {
  test("starts empty when nothing is published yet or the file is unreadable", () => {
    expect(parseNightlyIndex(null)).toEqual({ builds: [] });
    expect(parseNightlyIndex("<html>404</html>")).toEqual({ builds: [] });
    expect(parseNightlyIndex('{"builds":"nope"}')).toEqual({ builds: [] });
  });

  test("keeps the newest builds first and names the ones to delete", () => {
    let index = parseNightlyIndex(null);
    for (const run of [1, 2, 3]) index = addNightlyBuild(index, build(run), 2).index;

    const result = addNightlyBuild(index, build(1, "20261003"), 2);

    expect(result.index.builds.map((entry) => entry.version)).toEqual([
      "0.10.7-nightly.20261003.1",
      "0.10.7-nightly.20261002.3",
    ]);
    expect(result.prune).toEqual(["0.10.7-nightly.20261002.2"]);
  });

  test("publishing the same version again replaces it instead of listing it twice", () => {
    const once = addNightlyBuild({ builds: [] }, build(1)).index;
    const twice = addNightlyBuild(once, { ...build(1), commit: "again" });
    expect(twice.index.builds).toEqual([{ ...build(1), commit: "again" }]);
    expect(twice.prune).toEqual([]);
  });

  test("never lists or prunes a stable release", () => {
    expect(() => addNightlyBuild({ builds: [] }, { ...build(1), version: "0.10.7" })).toThrow(
      "Not a nightly version",
    );
    const mixed = { builds: [{ ...build(1), version: "0.10.6" }, build(2)] };
    expect(addNightlyBuild(mixed, build(3), 1).prune).toEqual(["0.10.7-nightly.20261002.2"]);
  });
});
