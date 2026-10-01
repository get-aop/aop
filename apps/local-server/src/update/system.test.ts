import { describe, expect, test } from "bun:test";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createSystemUpdateDeps, runsBinary } from "./system.ts";
import { createInstall, scratchDir } from "./test-utils.ts";

// The service managers are tripwires: `launchctl` and `systemctl` are scripts that only write
// down how they were called, and they are the only ones on PATH, so a test that reaches for the
// real service manager finds nothing to run and cannot stop the host of the person running it.
const createTripwires = async () => {
  const dir = await scratchDir("tripwire");
  const log = join(dir, "calls.log");
  for (const name of ["launchctl", "systemctl"]) {
    await writeFile(join(dir, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n`);
    await chmod(join(dir, name), 0o755);
  }
  return { dir, calls: async () => (await readFile(log, "utf8").catch(() => "")).trim() };
};

describe("createSystemUpdateDeps", () => {
  test("restarts through the service manager on PATH", async () => {
    const tripwires = await createTripwires();
    const layout = await createInstall("0.9.51");
    const deps = createSystemUpdateDeps(layout, "0.9.51", () => {}, {
      PATH: tripwires.dir,
    });

    await deps.restartTools.run(["launchctl", "load", "-w", "/scratch/x.plist"]);
    await deps.restartTools.run(["systemctl", "--user", "restart", "aop-local-server.service"]);

    expect(await tripwires.calls()).toBe(
      "launchctl load -w /scratch/x.plist\nsystemctl --user restart aop-local-server.service",
    );
  });

  test("reads the feed and port from the environment", async () => {
    const layout = await createInstall("0.9.51");

    const deps = createSystemUpdateDeps(layout, "0.9.51", () => {}, {
      AOP_RELEASE_FEED_URL: "http://127.0.0.1:1",
      AOP_LOCAL_SERVER_PORT: "26001",
    });

    expect(deps.feed).toEqual({ origin: "http://127.0.0.1:1", github: null });
    expect(deps.planInput.port).toBe(26001);
  });

  test("proves a downloaded binary by running it for --version", async () => {
    const layout = await createInstall("0.9.51");
    const deps = createSystemUpdateDeps(layout, "0.9.51", () => {}, {});

    expect(await deps.stageTools.probeVersion(layout.binaryPath)).toBe(
      "aop/0.9.51+abc1234 darwin-arm64 bun-v1.0.0",
    );
    await expect(
      deps.stageTools.probeVersion(join(layout.installDir, "missing")),
    ).rejects.toThrow();
  });

  test("recognises the process that runs a binary, and not a process that merely has its pid", () => {
    const child = Bun.spawn(["/bin/sleep", "30"]);
    try {
      expect(runsBinary(child.pid, "/bin/sleep")).toBe(true);
      expect(runsBinary(child.pid, "/somewhere/else/aop")).toBe(false);
    } finally {
      child.kill();
    }
    expect(runsBinary(2 ** 22 + 12345, "/bin/sleep")).toBe(false);
  });
});
