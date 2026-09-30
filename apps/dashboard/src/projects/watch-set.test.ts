import { describe, expect, test } from "bun:test";
import { MAX_LIVE_STREAMS, nextWatchSet } from "./watch-set";

describe("nextWatchSet", () => {
  test("stays under the browser's connection cap", () => {
    expect(MAX_LIVE_STREAMS).toBeLessThan(6);
  });

  test("watches every project while there are few", () => {
    expect(nextWatchSet([], ["a", "b"], null)).toEqual(["a", "b"]);
  });

  test("fills free slots with the most recent projects, and never exceeds the cap", () => {
    const eligible = ["a", "b", "c", "d", "e", "f"];
    expect(nextWatchSet([], eligible, null)).toEqual(["a", "b", "c", "d"]);
  });

  test("the open project always gets a stream, evicting the oldest-opened other one", () => {
    const eligible = ["a", "b", "c", "d", "e", "f"];
    expect(nextWatchSet(["a", "b", "c", "d"], eligible, "f")).toEqual(["b", "c", "d", "f"]);
  });

  test("the open project is never the one evicted", () => {
    const eligible = ["a", "b", "c", "d", "e"];
    expect(nextWatchSet(["a", "b", "c", "d"], eligible, "a", 4)).toEqual(["a", "b", "c", "d"]);
    expect(nextWatchSet(["a", "b", "c", "d"], eligible, "e", 4)).toEqual(["b", "c", "d", "e"]);
  });

  test("open streams survive changes elsewhere instead of churning", () => {
    // "z" became the most recent project, but nothing needs a slot.
    expect(nextWatchSet(["a", "b"], ["z", "a", "b"], null)).toEqual(["a", "b", "z"]);
    expect(nextWatchSet(["a", "b", "c", "d"], ["z", "a", "b", "c", "d"], null)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  test("drops streams of projects that are no longer eligible", () => {
    expect(nextWatchSet(["a", "gone"], ["a", "b"], null)).toEqual(["a", "b"]);
  });

  test("ignores a selection that is not eligible", () => {
    expect(nextWatchSet([], ["a"], "archived")).toEqual(["a"]);
  });
});
