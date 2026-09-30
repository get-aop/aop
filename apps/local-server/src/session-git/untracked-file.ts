import type { SessionDiffFile, SessionDiffFileStatus, SessionDiffLine } from "@aop/common";

/*
 * An untracked file has no blob for git to diff, so the host reads it itself: whole when the file
 * is opened, and only far enough to count it for the summary. Both go through `looksBinary` and
 * `addedLines`, so a folded row shows the count the opened file will.
 */

/**
 * Counting reads every byte, and the summary is read after every turn, so a bigger file is not
 * counted there: it keeps 0 and its count comes when it is opened.
 */
export const UNTRACKED_COUNT_CAP_BYTES = 1024 * 1024;

export interface UntrackedCount {
  status: Extract<SessionDiffFileStatus, "added" | "binary">;
  additions: number;
}

const UNCOUNTED: UntrackedCount = { status: "added", additions: 0 };

/** The summary's count of an untracked file, reading at most one byte past the cap. */
export const countUntrackedFile = async (
  workspace: string,
  relativePath: string,
): Promise<UntrackedCount> => {
  try {
    const file = Bun.file(`${workspace}/${relativePath}`);
    // A link to a pipe or a device is listed too, and reading it might never end.
    if (!(await file.stat()).isFile()) return UNCOUNTED;
    // The byte past the cap tells a file at the cap from a bigger one without reading the rest.
    const bytes = new Uint8Array(await file.slice(0, UNTRACKED_COUNT_CAP_BYTES + 1).arrayBuffer());
    if (looksBinary(bytes)) return { status: "binary", additions: 0 };
    if (bytes.length > UNTRACKED_COUNT_CAP_BYTES) return UNCOUNTED;
    return { status: "added", additions: addedLines(bytes).length };
  } catch {
    // Deleted or unreadable since git listed it: listed without a count, not a failed summary.
    return UNCOUNTED;
  }
};

/** An untracked file as a whole-file add. */
export const readUntrackedFileDiff = async (
  workspace: string,
  relativePath: string,
): Promise<SessionDiffFile> => {
  try {
    const bytes = new Uint8Array(await Bun.file(`${workspace}/${relativePath}`).arrayBuffer());
    if (looksBinary(bytes)) return untrackedFileDiff(relativePath, "binary", []);
    const lines: SessionDiffLine[] = addedLines(bytes).map((text, index) => ({
      type: "add",
      oldNo: null,
      newNo: index + 1,
      text,
    }));
    return untrackedFileDiff(relativePath, "added", lines);
  } catch {
    return untrackedFileDiff(relativePath, "added", []);
  }
};

const untrackedFileDiff = (
  path: string,
  status: UntrackedCount["status"],
  lines: SessionDiffLine[],
): SessionDiffFile => ({
  path,
  oldPath: null,
  status,
  additions: lines.length,
  deletions: 0,
  truncated: false,
  hunks: lines.length > 0 ? [{ oldStart: 0, newStart: 1, lines }] : [],
});

/** Git's own test: a NUL byte in the first 8000 bytes, so a prefix is enough to tell. */
const looksBinary = (bytes: Uint8Array): boolean =>
  bytes.subarray(0, Math.min(bytes.length, 8000)).includes(0);

/** A final newline ends the last line; it does not start an empty one. */
const addedLines = (bytes: Uint8Array): string[] => {
  const text = new TextDecoder().decode(bytes);
  return text.length === 0 ? [] : text.replace(/\n$/, "").split("\n");
};
