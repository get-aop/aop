import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The lock directory threads took by hand before the host enforced the computer-use lease
 * (`mkdir /tmp/aop-cua.lock`, the thread's title in `owner`, `touch heartbeat` every few minutes,
 * stale after 15 minutes without one). The lease honours it in both directions while threads
 * that follow the old convention still run: a lock someone else holds keeps the lease waiting,
 * and the host takes the directory itself while a thread of its own holds the lease, so those
 * threads wait too. A file `aop-host` with a per-process token marks the host's own copy.
 *
 * `AOP_CUA_LOCK_DIR` moves it (an isolated stack on its own display); `off` turns it off.
 */
export interface ExternalLock {
  path: string;
  inspect: () => ExternalLockState;
  /** Takes the directory for the host. False when someone else got it first. */
  take: (owner: string) => boolean;
  heartbeat: () => void;
  /** Removes the directory only when it is the host's own. */
  release: () => void;
  /** Removes a stale directory, whoever made it. */
  clearStale: () => void;
}

export type ExternalLockState =
  | { kind: "free" }
  | { kind: "ours" }
  | { kind: "held"; owner: string | null; heartbeatAt: number }
  | { kind: "stale"; owner: string | null; heartbeatAt: number };

export const DEFAULT_LOCK_DIR = "/tmp/aop-cua.lock";
export const STALE_AFTER_MS = 15 * 60_000;
const MARKER = "aop-host";

export const createExternalLock = (
  path: string,
  now: () => number = Date.now,
  token: string = `${process.pid}:${randomUUID()}`,
): ExternalLock => {
  const file = (name: string) => join(path, name);

  const inspect = (): ExternalLockState => {
    const dir = mtimeOf(path);
    if (dir === null) return { kind: "free" };
    if (readText(file(MARKER)) === token) return { kind: "ours" };
    const heartbeatAt = mtimeOf(file("heartbeat")) ?? mtimeOf(file("owner")) ?? dir;
    const owner = readText(file("owner"));
    return now() - heartbeatAt > STALE_AFTER_MS
      ? { kind: "stale", owner, heartbeatAt }
      : { kind: "held", owner, heartbeatAt };
  };

  return {
    path,
    inspect,
    take: (owner) => {
      try {
        mkdirSync(path);
      } catch {
        return false;
      }
      writeFileSync(file("owner"), `${owner}\n`);
      writeFileSync(file(MARKER), token);
      writeFileSync(file("heartbeat"), "");
      return true;
    },
    heartbeat: () => {
      if (inspect().kind !== "ours") return;
      const at = new Date(now());
      try {
        utimesSync(file("heartbeat"), at, at);
      } catch {
        writeFileSync(file("heartbeat"), "");
      }
    },
    release: () => {
      if (inspect().kind === "ours") rmSync(path, { recursive: true, force: true });
    },
    clearStale: () => {
      if (inspect().kind === "stale") rmSync(path, { recursive: true, force: true });
    },
  };
};

/** The host's lock directory, or null when `AOP_CUA_LOCK_DIR=off`. */
export const hostExternalLock = (): ExternalLock | null => {
  const configured = process.env.AOP_CUA_LOCK_DIR?.trim();
  if (configured === "off") return null;
  return createExternalLock(configured || DEFAULT_LOCK_DIR);
};

/**
 * Whether a lock's owner text names this thread: a thread that took the old lock itself and then
 * calls CUA must not wait for its own lock.
 */
export const lockNamesThread = (owner: string | null, title: string): boolean => {
  const a = normalize(owner ?? "");
  const b = normalize(title);
  return a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
};

const normalize = (text: string): string => text.trim().replace(/\s+/g, " ").toLowerCase();

const mtimeOf = (target: string): number | null => {
  try {
    return statSync(target).mtimeMs;
  } catch {
    return null;
  }
};

const readText = (target: string): string | null => {
  try {
    return readFileSync(target, "utf8").trim() || null;
  } catch {
    return null;
  }
};
