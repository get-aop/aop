/**
 * Detached agent trees (Codex computer_use, Playwright MCP, tool subprocesses)
 * can outlive the root CLI. Interrupt paths already reap them; normal control
 * turn completion must too.
 */

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

export interface ProcessTreeTracker {
  snapshot: () => void;
  terminate: () => Promise<void>;
}

/**
 * Snapshot descendants while the root is still alive, then SIGTERM/SIGKILL the
 * process group and every pid observed. Detached helpers reparent to init after
 * the root exits, so mid-run snapshots are required.
 */
export const startProcessTreeTracker = (rootPid: number): ProcessTreeTracker => {
  const known = new Set<number>();
  const snapshot = () => {
    for (const pid of listDescendantPids(rootPid)) known.add(pid);
  };
  // Fast enough to catch short-lived control helpers before the root exits.
  const timer = setInterval(snapshot, 50);
  snapshot();

  return {
    snapshot,
    terminate: async () => {
      clearInterval(timer);
      snapshot();
      await terminateProcessTree(rootPid, known);
    },
  };
};

export const terminateProcessTree = async (
  rootPid: number,
  knownDescendants: Iterable<number> = [],
  options?: { graceMs?: number },
): Promise<void> => {
  if (!Number.isFinite(rootPid) || rootPid <= 0) return;
  const graceMs = options?.graceMs ?? 400;
  const pids = new Set<number>([...knownDescendants, ...listDescendantPids(rootPid)]);

  signalProcessTree(rootPid, pids, "SIGTERM");
  if (await waitUntilProcessTreeQuiet(rootPid, pids, graceMs)) return;
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

export const needsControlProcessCleanup = (options: {
  browserControl?: boolean;
  computerControl?: boolean;
}): boolean => Boolean(options.browserControl || options.computerControl);
