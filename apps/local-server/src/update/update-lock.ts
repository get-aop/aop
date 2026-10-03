import { closeSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";

/** A run that has held the lock this long without finishing is taken to be dead. */
const STALE_AFTER_MS = 15 * 60 * 1000;

/**
 * One update run at a time per install, across processes: the dashboard's run and a terminal's
 * `aop update` both swap the same files, and two at once could leave a broken release behind.
 * Returns the release function, or null while another live run holds the lock.
 */
export const acquireUpdateLock = (
  home: string = aopPaths.home(),
  now: () => number = Date.now,
): (() => void) | null => {
  const path = join(home, "update.lock");
  if (!tryCreate(path, now())) {
    if (!isStale(path, now())) return null;
    rmSync(path, { force: true });
    if (!tryCreate(path, now())) return null;
  }
  return () => rmSync(path, { force: true });
};

const tryCreate = (path: string, at: number): boolean => {
  try {
    const fd = openSync(path, "wx");
    writeSync(fd, JSON.stringify({ pid: process.pid, at }));
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
};

// Held by a process that is gone, or for longer than any run takes.
const isStale = (path: string, nowMs: number): boolean => {
  try {
    const { pid, at } = JSON.parse(readFileSync(path, "utf8")) as { pid: number; at: number };
    return nowMs - at > STALE_AFTER_MS || !isAlive(pid);
  } catch {
    return true;
  }
};

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
