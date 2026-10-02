import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { InstallLayout } from "./install-layout.ts";
import { LAUNCHD_LABEL } from "./restart.ts";
import {
  createInstall,
  FAKE_TOKEN,
  type FakeRelease,
  type FakeReleaseOptions,
  localStageTools,
  PLATFORM,
  scratchDir,
  startFakeRelease,
} from "./test-utils.ts";
import { type UpdateDeps, updateHost } from "./update-host.ts";

const stopAfter: Array<() => void> = [];
afterEach(() => {
  for (const stop of stopAfter.splice(0)) stop();
});

interface Harness {
  layout: InstallLayout;
  release: FakeRelease;
  deps: UpdateDeps;
  /** Every command the updater ran to restart the host. */
  commands: string[][];
  killed: number[];
  home: string;
}

const createHarness = async (
  release: FakeReleaseOptions,
  options: {
    current?: string;
    managed?: "launchd" | "background" | "none";
    comesBack?: boolean;
  } = {},
): Promise<Harness> => {
  const current = options.current ?? "0.9.51";
  const layout = await createInstall(current);
  const fake = await startFakeRelease(release);
  stopAfter.push(fake.stop);
  const home = await scratchDir("home");
  const commands: string[][] = [];
  const killed: number[] = [];
  const managed = options.managed ?? "launchd";
  if (managed === "launchd") await writePlist(home, layout);
  const pidFile = join(home, "server.pid");
  if (managed === "background") await writeFile(pidFile, "4242");
  const deps: UpdateDeps = {
    layout,
    platform: PLATFORM,
    currentVersion: current,
    // GitHub is only asked when the feed is down, which a test asks for with `feedDown`.
    feed: {
      origin: fake.url,
      channel: "stable" as const,
      github: { apiUrl: fake.url, repo: "get-aop/aop-mono", token: FAKE_TOKEN },
    },
    fetch: (url, init) => fetch(url, init),
    stageTools: localStageTools(),
    restartTools: {
      run: async (command) => {
        commands.push(command);
        return 0;
      },
      kill: (pid) => killed.push(pid),
      waitUntilDown: async () => true,
    },
    planInput: { home, os: "darwin", pidFile, port: 25999, runsBinary: () => true },
    waitForVersion: async () => options.comesBack ?? true,
    log: () => {},
  };
  return { layout, release: fake, deps, commands, killed, home };
};

const writePlist = async (home: string, layout: InstallLayout): Promise<void> => {
  const agents = join(home, "Library", "LaunchAgents");
  await mkdir(agents, { recursive: true });
  await writeFile(
    join(agents, `${LAUNCHD_LABEL}.plist`),
    `<array><string>${layout.binaryPath}</string><string>run</string></array>`,
  );
};

const installedVersion = async (layout: InstallLayout): Promise<string> => {
  const proc = Bun.spawn([layout.binaryPath, "--version"], { stdout: "pipe" });
  return (await new Response(proc.stdout).text()).trim();
};

const dashboardMarker = (layout: InstallLayout): Promise<string> =>
  readFile(join(layout.dashboardDir, "index.html"), "utf8");

describe("updateHost", () => {
  test("leaves everything alone when the newest release is not newer", async () => {
    const h = await createHarness({ version: "0.9.51" });

    const result = await updateHost(h.deps);

    expect(result).toEqual({ status: "up-to-date", current: "0.9.51", latest: "0.9.51" });
    expect(h.release.requests.filter((path) => path.startsWith("/download"))).toEqual([]);
    expect(h.commands).toEqual([]);
  });

  test("downloads the release, swaps the binary and dashboard in, and restarts the service", async () => {
    const h = await createHarness({ version: "0.10.0" });

    const result = await updateHost(h.deps);

    expect(result).toEqual({ status: "updated", from: "0.9.51", to: "0.10.0", restarted: true });
    expect(await installedVersion(h.layout)).toBe("aop/0.10.0+abc1234 darwin-arm64 bun-v1.0.0");
    expect(await dashboardMarker(h.layout)).toBe("dashboard 0.10.0");
    const plist = join(h.home, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
    expect(h.commands).toEqual([
      ["launchctl", "unload", plist],
      ["launchctl", "load", "-w", plist],
    ]);
    // The old copies and the staging folder are gone once the new host has proven itself.
    expect((await readdir(h.layout.installDir)).sort()).toEqual(["aop", "dashboard"]);
  });

  test("restarts a host started with `aop run --background` by stopping it and starting it again", async () => {
    const h = await createHarness({ version: "0.10.0" }, { managed: "background" });

    await updateHost(h.deps);

    expect(h.killed).toEqual([4242]);
    expect(h.commands).toEqual([[h.layout.binaryPath, "run", "--background", "--port", "25999"]]);
  });

  test("installs but does not restart a host that nothing supervises", async () => {
    const h = await createHarness({ version: "0.10.0" }, { managed: "none" });

    const result = await updateHost(h.deps);

    expect(result).toEqual({ status: "updated", from: "0.9.51", to: "0.10.0", restarted: false });
    expect(await installedVersion(h.layout)).toBe("aop/0.10.0+abc1234 darwin-arm64 bun-v1.0.0");
    expect(h.commands).toEqual([]);
  });

  test("refuses a binary whose checksum does not match and changes nothing", async () => {
    const h = await createHarness({ version: "0.10.0", corruptBinary: true });

    await expect(updateHost(h.deps)).rejects.toThrow(
      "Checksum verification failed for aop-darwin-arm64",
    );

    expect(await installedVersion(h.layout)).toBe("aop/0.9.51+abc1234 darwin-arm64 bun-v1.0.0");
    expect(await dashboardMarker(h.layout)).toBe("dashboard 0.9.51");
    expect(h.commands).toEqual([]);
    expect((await readdir(h.layout.installDir)).sort()).toEqual(["aop", "dashboard"]);
  });

  test("refuses a file the checksums do not list (the GitHub fallback, which lists no digests)", async () => {
    const h = await createHarness({ version: "0.10.0", omitBinaryChecksum: true, feedDown: true });

    await expect(updateHost(h.deps)).rejects.toThrow("No checksum for aop-darwin-arm64");

    expect(await installedVersion(h.layout)).toBe("aop/0.9.51+abc1234 darwin-arm64 bun-v1.0.0");
  });

  test("refuses a downloaded binary that does not run", async () => {
    const h = await createHarness({ version: "0.10.0", brokenBinary: true });

    await expect(updateHost(h.deps)).rejects.toThrow("does not run");

    expect(await installedVersion(h.layout)).toBe("aop/0.9.51+abc1234 darwin-arm64 bun-v1.0.0");
    expect(h.commands).toEqual([]);
  });

  test("puts the old binary and dashboard back and starts them when the new host does not come up", async () => {
    const h = await createHarness({ version: "0.10.0" }, { comesBack: false });

    await expect(updateHost(h.deps)).rejects.toThrow("Rolled back to 0.9.51");

    expect(await installedVersion(h.layout)).toBe("aop/0.9.51+abc1234 darwin-arm64 bun-v1.0.0");
    expect(await dashboardMarker(h.layout)).toBe("dashboard 0.9.51");
    // Started onto the new release, then again onto the restored one.
    expect(h.commands.filter((command) => command[1] === "load")).toHaveLength(2);
    expect((await readdir(h.layout.installDir)).sort()).toEqual(["aop", "dashboard"]);
  });

  test("a background host whose new binary dies on start is started again on the old one", async () => {
    const h = await createHarness({ version: "0.10.0" }, { managed: "background" });
    let starts = 0;
    // Once the old host is stopped there is no process left for the pid file to name.
    h.deps.planInput.runsBinary = () => starts === 0;
    h.deps.restartTools.run = async (command) => {
      h.commands.push(command);
      starts += 1;
      return starts === 1 ? 1 : 0;
    };

    await expect(updateHost(h.deps)).rejects.toThrow("Rolled back to 0.9.51");

    const start = [h.layout.binaryPath, "run", "--background", "--port", "25999"];
    expect(h.commands).toEqual([start, start]);
    expect(await installedVersion(h.layout)).toBe("aop/0.9.51+abc1234 darwin-arm64 bun-v1.0.0");
  });

  test("a failed restart rolls back too", async () => {
    const h = await createHarness({ version: "0.10.0" });
    let loads = 0;
    h.deps.restartTools.run = async (command) => {
      if (command[1] === "load") loads += 1;
      return command[1] === "load" && loads === 1 ? 1 : 0;
    };

    await expect(updateHost(h.deps)).rejects.toThrow("launchctl load failed");

    expect(await installedVersion(h.layout)).toBe("aop/0.9.51+abc1234 darwin-arm64 bun-v1.0.0");
    expect(existsSync(`${h.layout.binaryPath}.previous`)).toBe(false);
  });

  test("never touches the data folder", async () => {
    const h = await createHarness({ version: "0.10.0" });
    const data = join(h.home, ".aop");
    await mkdir(data);
    await writeFile(join(data, "projects.sqlite"), "my projects");

    await updateHost(h.deps);

    expect(await readFile(join(data, "projects.sqlite"), "utf8")).toBe("my projects");
  });
});
