import { describe, expect, mock, test } from "bun:test";
import type { AppUpdateState } from "@aop/common";
import { type AppUpdaterDeps, type AutoUpdaterPort, createAppUpdater } from "./app-updater";

const NOW = new Date("2026-10-03T10:00:00.000Z");
const NOTES = "https://getaop.com/releases/v0.10.0.md";

const release = (tag: string) => ({
  schemaVersion: 1,
  version: tag.replace(/^v/, ""),
  publishedAt: "2026-10-02T00:00:00Z",
  notes: "",
  notesUrl: `https://getaop.com/releases/${tag}.md`,
  files: [
    {
      name: "aop-macos-arm64.dmg",
      kind: "desktop",
      url: "https://dl.test/aop-macos-arm64.dmg",
      sha256: "c".repeat(64),
      size: 1,
    },
  ],
});

const fakePort = () => {
  let handlers: Parameters<AutoUpdaterPort["listen"]>[0] | null = null;
  const port = {
    listen: (given: Parameters<AutoUpdaterPort["listen"]>[0]) => {
      handlers = given;
    },
    setAutoDownload: mock((_enabled: boolean) => {}),
    check: mock(async () => {}),
    download: mock(async () => {}),
    quitAndInstall: mock(() => {}),
  } satisfies AutoUpdaterPort;
  return {
    port,
    emit: () => {
      if (!handlers) throw new Error("the updater is not listening");
      return handlers;
    },
  };
};

const setup = (overrides: Partial<AppUpdaterDeps> = {}) => {
  const states: AppUpdateState[] = [];
  const scheduled: { run: () => void; delayMs: number; cancelled: boolean }[] = [];
  const fake = fakePort();
  const createAutoUpdater = mock((_feedOrigin?: string) => fake.port);
  const updater = createAppUpdater({
    mode: "notice",
    appVersion: "0.9.51",
    arch: "arm64",
    autoDownload: true,
    fetch: async () => Response.json(release("v0.10.0")),
    createAutoUpdater,
    schedule: (run, delayMs) => {
      const entry = { run, delayMs, cancelled: false };
      scheduled.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    onChange: (state) => states.push(state),
    log: () => {},
    now: () => NOW,
    ...overrides,
  });
  return { updater, states, scheduled, fake, createAutoUpdater };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("notice mode (an unsigned macOS app)", () => {
  test("says a newer release exists and offers the DMG, without loading electron-updater", async () => {
    const { updater, states, createAutoUpdater } = setup();

    updater.start();
    await settle();

    expect(states).toEqual([
      { status: "available", version: "0.10.0", releaseUrl: NOTES, mode: "notice" },
    ]);
    expect(updater.downloadUrl()).toBe("https://dl.test/aop-macos-arm64.dmg");
    expect(createAutoUpdater).not.toHaveBeenCalled();
  });

  test("says when it last looked, and looks again in six hours", async () => {
    const { updater, states, scheduled } = setup({
      fetch: async () => Response.json(release("v0.9.51")),
    });

    updater.start();
    await settle();

    expect(states).toEqual([{ status: "idle", checkedAt: NOW.toISOString() }]);
    expect(updater.downloadUrl()).toBeNull();
    expect(scheduled.map((entry) => entry.delayMs)).toEqual([6 * 60 * 60 * 1000]);
  });

  test("a background look that fails is logged and retried, not shown", async () => {
    const log = mock(() => {});
    const { updater, states, scheduled } = setup({
      fetch: async () => {
        throw new Error("offline");
      },
      log,
    });

    updater.start();
    await settle();

    expect(states).toEqual([]);
    expect(updater.state()).toEqual({ status: "idle", checkedAt: null });
    expect(log).toHaveBeenCalledWith("update check failed", { message: "offline" });
    expect(scheduled).toHaveLength(1);
  });

  test("Check for updates shows checking, then the answer", async () => {
    const { updater, states } = setup();

    const result = await updater.check();

    expect(states).toEqual([
      { status: "checking" },
      { status: "available", version: "0.10.0", releaseUrl: NOTES, mode: "notice" },
    ]);
    expect(result).toEqual(states[1] as AppUpdateState);
  });

  test("a check the person asked for that fails says so, on one line", async () => {
    const { updater } = setup({
      fetch: async () => new Response("<html>\nbad gateway\n</html>", { status: 502 }),
    });

    const result = await updater.check();

    expect(result).toEqual({
      status: "error",
      message: "The release feed answered 502.",
      version: null,
    });
  });

  test("the next look that works clears the failure", async () => {
    let fail = true;
    const { updater, scheduled } = setup({
      fetch: async () => {
        if (fail) throw new Error("offline");
        return Response.json(release("v0.9.51"));
      },
    });
    updater.start();
    await settle();
    await updater.check();
    expect(updater.state().status).toBe("error");

    fail = false;
    scheduled[0]?.run();
    await settle();

    expect(updater.state()).toEqual({ status: "idle", checkedAt: NOW.toISOString() });
  });

  test("stopping cancels the next look", async () => {
    const { updater, scheduled } = setup();

    updater.start();
    await settle();
    updater.stop();

    expect(scheduled[0]?.cancelled).toBe(true);
  });
});

describe("auto mode (Windows, and a signed macOS app)", () => {
  test("downloads in the background, then waits for a restart", async () => {
    const { updater, states, fake } = setup({ mode: "auto" });

    updater.start();
    await settle();
    fake.emit().available("0.10.0");
    fake.emit().progress(41.6);
    fake.emit().downloaded("0.10.0");

    expect(fake.port.check).toHaveBeenCalledTimes(1);
    expect(fake.port.setAutoDownload).toHaveBeenCalledWith(true);
    expect(states).toEqual([
      { status: "idle", checkedAt: NOW.toISOString() },
      { status: "downloading", version: "0.10.0", percent: 0 },
      { status: "downloading", version: "0.10.0", percent: 42 },
      { status: "ready", version: "0.10.0", releaseUrl: NOTES },
    ]);
    expect(updater.downloadUrl()).toBeNull();
  });

  test("hands electron-updater the feed override, so a test feed serves latest.yml too", async () => {
    const { updater, createAutoUpdater } = setup({
      mode: "auto",
      feedOrigin: "http://127.0.0.1:9",
    });

    updater.start();
    await settle();

    expect(createAutoUpdater).toHaveBeenCalledWith("http://127.0.0.1:9");
  });

  test("restarts into the update only once it is downloaded", async () => {
    const { updater, fake } = setup({ mode: "auto" });
    updater.start();
    await settle();

    updater.restartToUpdate();
    expect(fake.port.quitAndInstall).not.toHaveBeenCalled();

    fake.emit().downloaded("0.10.0");
    updater.restartToUpdate();
    expect(fake.port.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  test("a download that fails ends in an error naming the version, never stuck downloading", async () => {
    const { updater, fake } = setup({ mode: "auto" });
    updater.start();
    await settle();

    fake.emit().available("0.10.0");
    fake.emit().progress(30);
    fake.emit().failed("net::ERR_CONNECTION_RESET");

    expect(updater.state()).toEqual({
      status: "error",
      message: "net::ERR_CONNECTION_RESET",
      version: "0.10.0",
    });
  });

  test("an updater error outside a download leaves the state alone", async () => {
    const log = mock(() => {});
    const { updater, fake } = setup({ mode: "auto", log });
    updater.start();
    await settle();

    fake.emit().failed("net::ERR_INTERNET_DISCONNECTED");

    expect(updater.state()).toEqual({ status: "idle", checkedAt: NOW.toISOString() });
    expect(log).toHaveBeenCalledWith("update failed", {
      message: "net::ERR_INTERNET_DISCONNECTED",
    });
  });

  test("a check after the download keeps the update ready to restart", async () => {
    const { updater, fake } = setup({ mode: "auto" });
    updater.start();
    await settle();
    fake.emit().available("0.10.0");
    fake.emit().downloaded("0.10.0");

    fake.emit().available("0.10.0");
    fake.emit().failed("a later check could not reach the feed");
    await updater.check();

    expect(updater.state()).toEqual({ status: "ready", version: "0.10.0", releaseUrl: NOTES });
    updater.restartToUpdate();
    expect(fake.port.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  test("a newer release than the one downloaded is downloaded in its turn", async () => {
    const { updater, fake } = setup({ mode: "auto" });
    updater.start();
    await settle();
    fake.emit().downloaded("0.10.0");

    fake.emit().available("0.10.1");

    expect(updater.state()).toEqual({ status: "downloading", version: "0.10.1", percent: 0 });
  });

  test("Check for updates that finds nothing says up to date", async () => {
    const { updater, fake } = setup({ mode: "auto" });
    updater.start();
    await settle();

    const result = await updater.check();

    expect(fake.port.check).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ status: "idle", checkedAt: NOW.toISOString() });
  });

  test("a check that electron-updater rejects shows the error", async () => {
    const { updater, fake } = setup({ mode: "auto" });
    updater.start();
    await settle();
    fake.port.check.mockImplementationOnce(async () => {
      throw new Error("Cannot find latest.yml\nHttpError: 404");
    });

    expect(await updater.check()).toEqual({
      status: "error",
      message: "Cannot find latest.yml",
      version: null,
    });
  });
});

describe("auto mode with automatic download off", () => {
  const found = async (overrides: Partial<AppUpdaterDeps> = {}) => {
    const context = setup({ mode: "auto", autoDownload: false, ...overrides });
    context.updater.start();
    await settle();
    context.fake.emit().available("0.10.0");
    return context;
  };

  test("offers the release instead of fetching it", async () => {
    const { updater, fake } = await found();

    expect(fake.port.setAutoDownload).toHaveBeenCalledWith(false);
    expect(updater.state()).toEqual({
      status: "available",
      version: "0.10.0",
      releaseUrl: NOTES,
      mode: "auto",
    });
  });

  test("a later check that sees the same release keeps offering it", async () => {
    const { updater, fake } = await found();
    fake.port.check.mockImplementationOnce(async () => fake.emit().available("0.10.0"));

    await updater.check();

    expect(updater.state()).toMatchObject({ status: "available", mode: "auto" });
  });

  test("Download and restart downloads, then restarts onto the new build", async () => {
    const { updater, fake } = await found();
    fake.port.download.mockImplementationOnce(async () => {
      fake.emit().progress(50);
      fake.emit().downloaded("0.10.0");
    });

    await updater.downloadAndRestart();

    expect(fake.port.download).toHaveBeenCalledTimes(1);
    expect(fake.port.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  test("a download that fails says so and does not restart later", async () => {
    const { updater, fake } = await found();
    fake.port.download.mockImplementationOnce(async () => {
      throw new Error("net::ERR_CONNECTION_RESET");
    });

    await updater.downloadAndRestart();
    fake.emit().downloaded("0.10.0");

    expect(fake.port.quitAndInstall).not.toHaveBeenCalled();
    expect(updater.state()).toMatchObject({ status: "ready" });
  });

  test("switching automatic download on fetches the waiting release, without restarting", async () => {
    const { updater, fake } = await found();

    updater.setAutoDownload(true);
    await settle();
    fake.emit().downloaded("0.10.0");

    expect(fake.port.setAutoDownload).toHaveBeenLastCalledWith(true);
    expect(fake.port.download).toHaveBeenCalledTimes(1);
    expect(fake.port.quitAndInstall).not.toHaveBeenCalled();
  });

  test("does nothing for Download and restart before there is a release", async () => {
    const { updater, fake } = setup({ mode: "auto", autoDownload: false });
    updater.start();
    await settle();

    await updater.downloadAndRestart();

    expect(fake.port.download).not.toHaveBeenCalled();
  });
});

describe("off mode (Linux, a development run)", () => {
  test("says so, and never looks", async () => {
    const fetch = mock(async () => Response.json(release("v0.10.0")));
    const { updater, createAutoUpdater, scheduled } = setup({ mode: "off", fetch });

    updater.start();
    await settle();

    expect(updater.state()).toEqual({ status: "off" });
    expect(await updater.check()).toEqual({ status: "off" });
    expect(fetch).not.toHaveBeenCalled();
    expect(createAutoUpdater).not.toHaveBeenCalled();
    expect(scheduled).toEqual([]);
  });
});
