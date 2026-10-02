export type DiffLine =
  | { type: "same"; text: string; before: number; after: number }
  | { type: "added"; text: string; after: number }
  | { type: "removed"; text: string; before: number };

/** Lines past this many on either side are compared as one block, so a huge file stays fast. */
const MAX_LINES = 4_000;

/**
 * The lines that turn `before` into `after`, from their longest common subsequence: what both
 * keep, what went and what came, in reading order with each side's line numbers (from 1).
 */
export const diffLines = (before: string, after: string): DiffLine[] => {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length > MAX_LINES || b.length > MAX_LINES) return wholeChange(a, b);
  const common = commonLengths(a, b);
  const lines: DiffLine[] = [];
  const at = { i: 0, j: 0 };
  while (at.i < a.length || at.j < b.length) lines.push(takeStep(a, b, at, common));
  return lines;
};

// The next line of the diff, moving past it on the side (or sides) it came from.
const takeStep = (
  a: readonly string[],
  b: readonly string[],
  at: { i: number; j: number },
  common: (i: number, j: number) => number,
): DiffLine => {
  const step = nextStep(a, b, at.i, at.j, common);
  if (step === "same") {
    at.i += 1;
    at.j += 1;
    return { type: "same", text: a[at.i - 1] ?? "", before: at.i, after: at.j };
  }
  if (step === "added") {
    at.j += 1;
    return { type: "added", text: b[at.j - 1] ?? "", after: at.j };
  }
  at.i += 1;
  return { type: "removed", text: a[at.i - 1] ?? "", before: at.i };
};

export const diffStats = (lines: readonly DiffLine[]): { added: number; removed: number } => ({
  added: lines.filter((line) => line.type === "added").length,
  removed: lines.filter((line) => line.type === "removed").length,
});

const nextStep = (
  a: readonly string[],
  b: readonly string[],
  i: number,
  j: number,
  common: (i: number, j: number) => number,
): DiffLine["type"] => {
  if (i < a.length && j < b.length && a[i] === b[j]) return "same";
  // A changed line reads as the old one going, then the new one coming.
  if (i < a.length && (j === b.length || common(i + 1, j) >= common(i, j + 1))) return "removed";
  return "added";
};

const splitLines = (text: string): string[] =>
  text === "" ? [] : text.replace(/\r\n/g, "\n").split("\n");

// The longest common subsequence of a[i..] and b[j..], for every i and j, in one flat array.
const commonLengths = (
  a: readonly string[],
  b: readonly string[],
): ((i: number, j: number) => number) => {
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  const at = (i: number, j: number): number => table[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  return at;
};

const wholeChange = (a: readonly string[], b: readonly string[]): DiffLine[] => [
  ...a.map((text, index) => ({ type: "removed" as const, text, before: index + 1 })),
  ...b.map((text, index) => ({ type: "added" as const, text, after: index + 1 })),
];
