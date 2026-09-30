/** Detached agent trees (tool subprocesses) can outlive the root CLI, so a stop reaps the whole tree. */

export const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Depth-first children of rootPid via a process table snapshot (unix only). */
export const listDescendantPids = (rootPid: number): number[] => {
  if (process.platform === "win32" || !Number.isFinite(rootPid) || rootPid <= 0) return [];
  const snapshot = Bun.spawnSync(["ps", "-axo", "pid=,ppid="], {
    stdout: "pipe",
    stderr: "ignore",
  });
  if (snapshot.exitCode !== 0) return [];

  const children = new Map<number, number[]>();
  for (const line of snapshot.stdout.toString().split("\n")) {
    const [pidText, parentText] = line.trim().split(/\s+/);
    const pid = Number.parseInt(pidText ?? "", 10);
    const parent = Number.parseInt(parentText ?? "", 10);
    if (!Number.isFinite(pid) || !Number.isFinite(parent)) continue;
    children.set(parent, [...(children.get(parent) ?? []), pid]);
  }

  const descendants: number[] = [];
  const visit = (parent: number) => {
    for (const child of children.get(parent) ?? []) {
      visit(child);
      descendants.push(child);
    }
  };
  visit(rootPid);
  return descendants;
};

const TERMINATE_GRACE_MS = 400;

/** SIGTERM the root's process group and every descendant, then SIGKILL what is still alive after a short grace. */
export const terminateProcessTree = async (rootPid: number): Promise<void> => {
  if (!Number.isFinite(rootPid) || rootPid <= 0) return;
  const pids = new Set<number>(listDescendantPids(rootPid));

  signalProcessTree(rootPid, pids, "SIGTERM");
  if (await waitUntilProcessTreeQuiet(rootPid, pids, TERMINATE_GRACE_MS)) return;
  signalProcessTree(rootPid, pids, "SIGKILL");
};

const signalProcessTree = (rootPid: number, pids: Set<number>, signal: NodeJS.Signals): void => {
  for (const pid of listDescendantPids(rootPid)) pids.add(pid);
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // exited between discovery and signal
    }
  }
  try {
    process.kill(-rootPid, signal);
  } catch {
    try {
      process.kill(rootPid, signal);
    } catch {
      // root already gone
    }
  }
};

const waitUntilProcessTreeQuiet = async (
  rootPid: number,
  pids: Set<number>,
  graceMs: number,
): Promise<boolean> => {
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!processTreeHasAliveMembers(rootPid, pids)) return true;
    await Bun.sleep(25);
  }
  return !processTreeHasAliveMembers(rootPid, pids);
};

const processTreeHasAliveMembers = (rootPid: number, pids: Set<number>): boolean =>
  [...pids].some((pid) => isPidAlive(pid)) ||
  listDescendantPids(rootPid).some((pid) => isPidAlive(pid)) ||
  isPidAlive(rootPid);
