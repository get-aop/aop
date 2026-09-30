import { describe, expect, test } from "bun:test";
import type { SessionDiffLine } from "@aop/common";
import { type FoldSegment, foldUnmodifiedRegionsWithEdges } from "./diff-fold";

const context = (count: number, from = 1): SessionDiffLine[] =>
  Array.from({ length: count }, (_, index) => ({
    type: "context" as const,
    oldNo: from + index,
    newNo: from + index,
    text: `line ${from + index}`,
  }));

const added = (text: string, newNo: number): SessionDiffLine => ({
  type: "add",
  oldNo: null,
  newNo,
  text,
});

/** "3 lines, 6 folded, 3 lines": the shape of a hunk without its text. */
const shape = (segments: FoldSegment[]): string[] =>
  segments.map((segment) => `${segment.kind}:${segment.lines.length}`);

describe("foldUnmodifiedRegionsWithEdges", () => {
  test("folds a long run of unchanged lines, keeping three at each edge in view", () => {
    const segments = foldUnmodifiedRegionsWithEdges(context(12));

    expect(shape(segments)).toEqual(["lines:3", "fold:6", "lines:3"]);
    const fold = segments.find((segment) => segment.kind === "fold");
    expect(fold?.lines.map((line) => line.newNo)).toEqual([4, 5, 6, 7, 8, 9]);
  });

  test("keeps short runs of unchanged lines expanded", () => {
    const segments = foldUnmodifiedRegionsWithEdges([
      { type: "context", oldNo: 1, newNo: 1, text: "a" },
      added("b", 2),
    ]);

    expect(segments.every((segment) => segment.kind === "lines")).toBe(true);
  });

  test("a run of exactly eight is not folded, and nine is", () => {
    expect(shape(foldUnmodifiedRegionsWithEdges(context(8)))).toEqual(["lines:8"]);
    expect(shape(foldUnmodifiedRegionsWithEdges(context(9)))).toEqual([
      "lines:3",
      "fold:3",
      "lines:3",
    ]);
  });

  test("an empty hunk has no segments", () => {
    expect(foldUnmodifiedRegionsWithEdges([])).toEqual([]);
  });

  test("a hunk that is all unchanged lines folds its middle, and loses none of its lines", () => {
    const lines = context(20);
    const segments = foldUnmodifiedRegionsWithEdges(lines);

    expect(shape(segments)).toEqual(["lines:3", "fold:14", "lines:3"]);
    expect(segments.flatMap((segment) => segment.lines)).toEqual(lines);
  });

  test("changed lines stay outside every fold, in their place between the runs around them", () => {
    const lines = [...context(10), added("new", 11), ...context(10, 12)];

    const segments = foldUnmodifiedRegionsWithEdges(lines);

    expect(shape(segments)).toEqual([
      "lines:3",
      "fold:4",
      "lines:3",
      "lines:1",
      "lines:3",
      "fold:4",
      "lines:3",
    ]);
    expect(segments.flatMap((segment) => segment.lines)).toEqual(lines);
    const folded = segments.filter((segment) => segment.kind === "fold");
    expect(folded.flatMap((segment) => segment.lines).some((line) => line.type !== "context")).toBe(
      false,
    );
  });

  test("each fold has an id of its own, so opening one leaves the others shut", () => {
    const lines = [...context(10), added("new", 11), ...context(10, 12)];

    const ids = foldUnmodifiedRegionsWithEdges(lines).flatMap((segment) =>
      segment.kind === "fold" ? [segment.id] : [],
    );

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
