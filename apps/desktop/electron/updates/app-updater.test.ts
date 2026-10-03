import { describe, expect, mock, test } from "bun:test";
import type { AppUpdateState } from "../../src/backend/types";
import { type AppUpdaterDeps, type AutoUpdaterPort, createAppUpdater } from "./app-updater";

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
  const port: AutoUpdaterPort = {
    listen: (given) => {
      handlers = given;
    },
    check: mock(async () => {}),
    quitAndInstall: mock(() => {}),
  };
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
    ...overrides,
  });
  return { updater, states, scheduled, fake, createAutoUpdater };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("notice mode (the macOS app until it is signed)", () => {
  test("says a newer release exists and offers the DMG, without loading electron-updater", async () => {
    const { updater, states, createAutoUpdater } = setup();

    updater.start();
    await settle();

    expect(states).toEqual([
      {
        status: "available",
        version: "0.10.0",
        releaseUrl: "https://getaop.com/releases/v0.10.0.md",
      },
    ]);
    expect(updater.downloadUrl()).toBe("https://dl.test/aop-macos-arm64.dmg");
    expect(createAutoUpdater).not.toHaveBeenCalled();
  });

  test("says nothing when the release is not newer, and looks again in six hours", async () => {
    const { updater, states, scheduled } = setup({
      fetch: async () => Response.json(release("v0.9.51")),
    });

    updater.start();
    await settle();

    expect(states).toEqual([]);
    expect(updater.downloadUrl()).toBeNull();
    expect(scheduled.map((entry) => entry.delayMs)).toEqual([6 * 60 * 60 * 1000]);
  });

  test("a feed that fails is logged and retried, never shown", async () => {
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
    expect(log).toHaveBeenCalledWith("update check failed", { message: "offline" });
    expect(scheduled).toHaveLength(1);
  });

  test("stopping cancels the next look", async () => {
    const { updater, scheduled } = setup();

    updater.start();
    await settle();
    updater.stop();

    expect(scheduled[0]?.cancelled).toBe(true);
  });
});

describe("auto mode (Windows, and macOS once signed)", () => {
  test("downloads in the background, then waits for a restart", async () => {
    const { updater, states, fake } = setup({ mode: "auto" });

    updater.start();
    await settle();
    fake.emit().available("0.10.0");
    fake.emit().progress(41.6);
    fake.emit().downloaded("0.10.0");

    expect(fake.port.check).toHaveBeenCalledTimes(1);
    expect(states).toEqual([
      { status: "downloading", version: "0.10.0", percent: 0 },
      { status: "downloading", version: "0.10.0", percent: 42 },
      { status: "ready", version: "0.10.0" },
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

  test("an updater error is logged and leaves the state alone", async () => {
    const log = mock(() => {});
    const { updater, states, fake } = setup({ mode: "auto", log });
    updater.start();
    await settle();

    fake.emit().failed("net::ERR_INTERNET_DISCONNECTED");

    expect(states).toEqual([]);
    expect(log).toHaveBeenCalledWith("update failed", {
      message: "net::ERR_INTERNET_DISCONNECTED",
    });
  });

  test("a download that fails stops saying it is downloading", async () => {
    const { updater, states, fake } = setup({ mode: "auto" });
    updater.start();
    await settle();

    fake.emit().available("0.10.0");
    fake.emit().progress(30);
    fake.emit().failed("net::ERR_CONNECTION_RESET");

    expect(updater.state()).toEqual({ status: "idle" });
    expect(states.at(-1)).toEqual({ status: "idle" });
  });

  test("a check after the download keeps the update ready to restart", async () => {
    const { updater, fake } = setup({ mode: "auto" });
    updater.start();
    await settle();
    fake.emit().available("0.10.0");
    fake.emit().downloaded("0.10.0");

    fake.emit().available("0.10.0");
    fake.emit().failed("a later check could not reach the feed");

    expect(updater.state()).toEqual({ status: "ready", version: "0.10.0" });
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
});

describe("off mode", () => {
  test("never looks", async () => {
    const fetch = mock(async () => Response.json(release("v0.10.0")));
    const { updater, createAutoUpdater, scheduled } = setup({ mode: "off", fetch });

    updater.start();
    await settle();

    expect(fetch).not.toHaveBeenCalled();
    expect(createAutoUpdater).not.toHaveBeenCalled();
    expect(scheduled).toEqual([]);
  });
});
