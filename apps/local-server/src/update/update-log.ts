import { open } from "node:fs/promises";
import { join } from "node:path";
import type { UpdateLog } from "@aop/common";
import { aopPaths } from "@aop/infra";

/** How many lines "Show log" gets: a whole update run, and the one before it. */
export const UPDATE_LOG_LINES = 200;
/** Only the end of the file is read, so a log that grew over many updates costs nothing. */
const TAIL_BYTES = 64 * 1024;

/** Where the update run writes (spawn-updater.ts), under the host's data folder. */
export const updateLogPath = (): string => join(aopPaths.logs(), "update.log");

/** The last `UPDATE_LOG_LINES` lines of the update log; none when no update has run yet. */
export const readUpdateLog = async (path: string = updateLogPath()): Promise<UpdateLog> => {
  const text = await readTail(path);
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return { path, lines: lines.slice(-UPDATE_LOG_LINES) };
};

const readTail = async (path: string): Promise<string> => {
  let file: Awaited<ReturnType<typeof open>>;
  try {
    file = await open(path, "r");
  } catch {
    return "";
  }
  try {
    const { size } = await file.stat();
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    await file.read(buffer, 0, length, size - length);
    const text = buffer.toString("utf8");
    // A read that starts mid-file starts mid-line: that first piece is dropped.
    return length < size ? text.slice(text.indexOf("\n") + 1) : text;
  } finally {
    await file.close();
  }
};
