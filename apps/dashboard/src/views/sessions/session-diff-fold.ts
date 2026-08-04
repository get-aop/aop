import type { SessionDiffLine } from "../../api/client";

const FOLD_THRESHOLD = 8;
const FOLD_EDGE = 3;

export type FoldSegment =
  | { kind: "lines"; lines: SessionDiffLine[] }
  | { kind: "fold"; id: number; lines: SessionDiffLine[] };

export const foldUnmodifiedRegions = (lines: SessionDiffLine[]): FoldSegment[] => {
  const segments: FoldSegment[] = [];
  let index = 0;
  let foldId = 0;
  while (index < lines.length) {
    const next = takeNextSegment(lines, index, foldId);
    segments.push(next.segment);
    index = next.nextIndex;
    foldId = next.nextFoldId;
  }
  return segments;
};

const takeNextSegment = (
  lines: SessionDiffLine[],
  index: number,
  foldId: number,
): { segment: FoldSegment; nextIndex: number; nextFoldId: number } => {
  if (lines[index]?.type !== "context") {
    return takeNonContextRun(lines, index, foldId);
  }
  return takeContextRun(lines, index, foldId);
};

const takeNonContextRun = (
  lines: SessionDiffLine[],
  start: number,
  foldId: number,
): { segment: FoldSegment; nextIndex: number; nextFoldId: number } => {
  let index = start;
  const run: SessionDiffLine[] = [];
  while (index < lines.length && lines[index]?.type !== "context") {
    const line = lines[index];
    if (line) run.push(line);
    index += 1;
  }
  return { segment: { kind: "lines", lines: run }, nextIndex: index, nextFoldId: foldId };
};

const takeContextRun = (
  lines: SessionDiffLine[],
  start: number,
  foldId: number,
): { segment: FoldSegment; nextIndex: number; nextFoldId: number } => {
  let index = start;
  while (index < lines.length && lines[index]?.type === "context") index += 1;
  const contextRun = lines.slice(start, index);
  if (contextRun.length <= FOLD_THRESHOLD) {
    return {
      segment: { kind: "lines", lines: contextRun },
      nextIndex: index,
      nextFoldId: foldId,
    };
  }
  // Caller flattens multi-part folds via expandContextFold
  return {
    segment: {
      kind: "fold",
      id: foldId,
      lines: contextRun,
    },
    nextIndex: index,
    nextFoldId: foldId + 1,
  };
};

/** Expand a folded context run into head / fold / tail segments. */
export const expandContextFold = (segment: FoldSegment): FoldSegment[] => {
  if (segment.kind !== "fold" || segment.lines.length <= FOLD_THRESHOLD) {
    return [segment];
  }
  const head = segment.lines.slice(0, FOLD_EDGE);
  const middle = segment.lines.slice(FOLD_EDGE, -FOLD_EDGE);
  const tail = segment.lines.slice(-FOLD_EDGE);
  const parts: FoldSegment[] = [];
  if (head.length) parts.push({ kind: "lines", lines: head });
  if (middle.length) parts.push({ kind: "fold", id: segment.id, lines: middle });
  if (tail.length) parts.push({ kind: "lines", lines: tail });
  return parts;
};

export const foldUnmodifiedRegionsWithEdges = (lines: SessionDiffLine[]): FoldSegment[] =>
  foldUnmodifiedRegions(lines).flatMap((segment) => expandContextFold(segment));
