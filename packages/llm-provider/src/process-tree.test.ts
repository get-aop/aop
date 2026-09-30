import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isPidAlive, listDescendantPids, terminateProcessTree } from "./process-tree";

describe("process-tree", () => {
  test("terminates the root and a detached descendant", async () => {
    if (process.platform === "win32") return;

    const dir = await mkdtemp(join(tmpdir(), "aop-process-tree-"));
    const pidFile = join(dir, "child.pid");
    try {
      const script = [
        `const child = Bun.spawn(["sleep", "30"], { detached: true, stdout: "ignore", stderr: "ignore", stdin: "ignore" });`,
        `await Bun.write(${JSON.stringify(pidFile)}, String(child.pid));`,
        "await Bun.sleep(30000);",
      ].join("\n");
      const root = Bun.spawn([process.execPath, "-e", script], {
        detached: true,
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore",
      });
      while (!(await Bun.file(pidFile).exists())) await Bun.sleep(10);
      const childPid = Number.parseInt(await readFile(pidFile, "utf8"), 10);
      expect(listDescendantPids(root.pid)).toContain(childPid);

      await terminateProcessTree(root.pid);
      await root.exited;
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
