import { statSync } from "node:fs";
import { type FileHandle, open, readFile } from "node:fs/promises";

export interface LogFileSnapshot {
  lines: string[];
  lineCount: number;
}

/**
 * Byte/line position inside a log file. Readers advance it in place so each
 * poll only reads bytes appended since the last poll instead of the whole
 * (possibly hundreds of MB) file.
 */
export interface LogReadState {
  byteOffset: number;
  lineCount: number;
}

export const createLogReadState = (): LogReadState => ({ byteOffset: 0, lineCount: 0 });

/**
 * Reads complete lines appended after `state.byteOffset`. A trailing line
 * without a newline is held back until it completes; use `includePartial`
 * (final flush) to consume it anyway. Advances `state` in place.
 */
export const readLogLines = async (
  logFile: string,
  state: LogReadState,
  includePartial = false,
): Promise<LogFileSnapshot> => {
  let handle: FileHandle | null = null;
  try {
    handle = await open(logFile, "r");
  } catch {
    return { lines: [], lineCount: state.lineCount };
  }

  try {
    const { size } = await handle.stat();
    if (size <= state.byteOffset) {
      return { lines: [], lineCount: state.lineCount };
    }

    const chunk = Buffer.alloc(size - state.byteOffset);
    await handle.read(chunk, 0, chunk.length, state.byteOffset);

    const text = chunk.toString("utf8");
    const lastNl = text.lastIndexOf("\n");
    const completeEnd = includePartial ? text.length : lastNl + 1;
    const complete = completeEnd > 0 ? text.slice(0, completeEnd) : "";
    // "\n" is ASCII, so the character slice ends on a byte boundary.
    state.byteOffset += Buffer.byteLength(complete, "utf8");

    const lines = complete.split("\n").filter((line) => line.length > 0);
    state.lineCount += lines.length;
    return { lines, lineCount: state.lineCount };
  } finally {
    await handle?.close();
  }
};

/** One-time full read (initial replay, recovery, rotation checks). */
export const readAllLogLines = async (logFile: string): Promise<string[]> => {
  try {
    const content = await readFile(logFile, "utf-8");
    return content.split("\n").filter((line) => line.length > 0);
  } catch {
    return [];
  }
};

export const readLogLineCount = async (logFile: string): Promise<number> =>
  (await readAllLogLines(logFile)).length;

export const getFileSize = (logFile: string): number => {
  try {
    return statSync(logFile).size;
  } catch {
    return 0;
  }
};
