import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isPidAlive,
  listDescendantPids,
  needsControlProcessCleanup,
  startProcessTreeTracker,
  terminateProcessTree,
} from "./process-tree";

describe("process-tree", () => {
  test("needsControlProcessCleanup is true for browser or computer flags", () => {
    expect(needsControlProcessCleanup({})).toBe(false);
    expect(needsControlProcessCleanup({ browserControl: true })).toBe(true);
    expect(needsControlProcessCleanup({ computerControl: true })).toBe(true);
  });

  test("terminates detached descendants after the root exits", async () => {
    if (process.platform === "win32") return;

    const dir = await mkdtemp(join(tmpdir(), "aop-process-tree-"));
    const pidFile = join(dir, "child.pid");
    try {
      const script = [
        `const child = Bun.spawn(["sleep", "30"], { detached: true, stdout: "ignore", stderr: "ignore", stdin: "ignore" });`,
        `await Bun.write(${JSON.stringify(pidFile)}, String(child.pid));`,
        // Stay alive long enough for the tracker to observe the detached child.
        "await Bun.sleep(200);",
        "process.exit(0);",
      ].join("\n");
      const root = Bun.spawn([process.execPath, "-e", script], {
        detached: true,
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore",
      });
      const tracker = startProcessTreeTracker(root.pid);
      while (!(await Bun.file(pidFile).exists())) await Bun.sleep(10);
      const childPid = Number.parseInt(await readFile(pidFile, "utf8"), 10);
      expect(listDescendantPids(root.pid)).toContain(childPid);
      // Ensure at least one tracker snapshot after the child exists.
      await Bun.sleep(80);
      tracker.snapshot();

      await root.exited;
      await tracker.terminate();
      await Bun.sleep(30);

      expect(isPidAlive(childPid)).toBe(false);
      expect(isPidAlive(root.pid)).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("terminateProcessTree is a no-op for invalid pids", async () => {
    await terminateProcessTree(0);
    await terminateProcessTree(-1);
  });
});
