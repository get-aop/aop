import { afterEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { scratchDir, startFakeRelease } from "./test-utils.ts";
import { readCheckRecord, writeOutcomeRecord } from "./update-files.ts";
import { createUpdateService, type UpdateServiceDeps } from "./update-service.ts";

const stopAfter: Array<() => void> = [];
afterEach(() => {
  for (const stop of stopAfter.splice(0)) stop();
});

interface Harness {
  deps: UpdateServiceDeps;
  home: string;
  release: Awaited<ReturnType<typeof startFakeRelease>>;
  startedUpdaters: number;
  clock: { now: number };
  setEnabled: (enabled: boolean) => void;
}

const createHarness = async (
  options: {
    latest?: string;
    current?: string;
    supported?: boolean;
    startUpdater?: () => Promise<void>;
  } = {},
): Promise<Harness> => {
  const release = await startFakeRelease({ version: options.latest ?? "0.10.0" });
  stopAfter.push(release.stop);
  const home = await scratchDir("service");
  const clock = { now: Date.parse("2026-10-01T10:00:00Z") };
  let enabled = true;
  const harness: Harness = {
    deps: {} as UpdateServiceDeps,
    home,
    release,
    startedUpdaters: 0,
    clock,
    setEnabled: (value) => {
      enabled = value;
    },
  };
  harness.deps = {
    isEnabled: async () => enabled,
    unsupported:
      options.supported === false
        ? "This host runs from source and cannot update itself: pull and rebuild instead."
        : null,
    current: options.current ?? "0.9.51",
    feed: { origin: release.url, channel: "stable" as const, github: null },
    startUpdater:
      options.startUpdater ??
      (async () => {
        harness.startedUpdaters += 1;
      }),
    now: () => clock.now,
    home,
  };
  return harness;
};

describe("update service status", () => {
  test("knows nothing before the first check", async () => {
    const h = await createHarness();

    expect(await createUpdateService(h.deps).status()).toEqual({
      enabled: true,
      supported: true,
      current: "0.9.51",
      latest: null,
      available: false,
      releaseUrl: null,
      checkedAt: null,
      checkError: null,
      state: "idle",
      updateError: null,
    });
  });

  test("a check reports the newer release with its notes page and remembers it across restarts", async () => {
    const h = await createHarness();

    const status = await createUpdateService(h.deps).check();

    expect(status).toMatchObject({
      latest: "0.10.0",
      available: true,
      releaseUrl: `${h.release.url}/releases/v0.10.0.md`,
      checkError: null,
    });
    expect((await readCheckRecord(h.home))?.latest).toBe("0.10.0");
    const reborn = createUpdateService(h.deps);
    expect(await reborn.status()).toMatchObject({ latest: "0.10.0", available: true });
  });

  test("a release that is not newer is not announced, and a source checkout never has one", async () => {
    const same = await createHarness({ latest: "0.9.51" });
    const dev = await createHarness({ current: "dev", supported: false });

    expect((await createUpdateService(same.deps).check()).available).toBe(false);
    expect(await createUpdateService(dev.deps).check()).toMatchObject({
      available: false,
      supported: false,
    });
  });

  test("an unreachable feed is an error message, not a failure of the host", async () => {
    const h = await createHarness();
    h.deps.feed = { origin: "http://127.0.0.1:1", channel: "stable" as const, github: null };

    const status = await createUpdateService(h.deps).check();

    expect(status.checkError).toContain("Could not reach the release feed");
    expect(status.available).toBe(false);
  });

  test("asking again within half a minute does not ask the feed again", async () => {
    const h = await createHarness();
    const service = createUpdateService(h.deps);

    await service.check();
    await service.check();
    h.clock.now += 31_000;
    await service.check();

    expect(
      h.release.requests.filter((line) => line.startsWith("/releases/latest.json ")),
    ).toHaveLength(2);
  });

  test("follows the setting", async () => {
    const h = await createHarness();
    h.setEnabled(false);

    expect((await createUpdateService(h.deps).status()).enabled).toBe(false);
  });
});

describe("update service apply", () => {
  test("starts the updater and reports the update as running", async () => {
    const h = await createHarness();
    const service = createUpdateService(h.deps);

    expect(await service.apply()).toEqual({ ok: true });

    expect(h.startedUpdaters).toBe(1);
    expect((await service.status()).state).toBe("updating");
    expect(await service.apply()).toEqual({ ok: false, error: "An update is already running" });
    expect(h.startedUpdaters).toBe(1);
  });

  test("refuses when there is nothing newer", async () => {
    const h = await createHarness({ latest: "0.9.51" });

    expect(await createUpdateService(h.deps).apply()).toEqual({
      ok: false,
      error: "AOP is already up to date",
    });
    expect(h.startedUpdaters).toBe(0);
  });

  test("refuses on a host that runs from source", async () => {
    const h = await createHarness({ supported: false });

    const result = await createUpdateService(h.deps).apply();

    expect(result).toEqual({
      ok: false,
      error: "This host runs from source and cannot update itself: pull and rebuild instead.",
    });
  });

  test("reports an updater that could not be started and allows another try", async () => {
    const h = await createHarness({
      startUpdater: async () => {
        throw new Error("no such file");
      },
    });
    const service = createUpdateService(h.deps);

    expect(await service.apply()).toEqual({
      ok: false,
      error: "Could not start the update: no such file",
    });
    expect((await service.status()).state).toBe("idle");
  });

  test("shows why a run failed, even after the host restarted on the release it had", async () => {
    const h = await createHarness();
    const service = createUpdateService(h.deps);
    await service.apply();
    h.clock.now += 5_000;

    await writeOutcomeRecord(
      {
        at: new Date(h.clock.now).toISOString(),
        ok: false,
        from: "0.9.51",
        to: null,
        error: "AOP 0.10.0 did not start. Rolled back to 0.9.51.",
      },
      h.home,
    );

    const status = await service.status();
    expect(status).toMatchObject({
      state: "failed",
      updateError: "AOP 0.10.0 did not start. Rolled back to 0.9.51.",
    });
    // The host the rollback started knows nothing of the run, only of the record it left.
    expect(await createUpdateService(h.deps).status()).toMatchObject({ state: "failed" });
  });

  test("a failure from an older release is not shown once the host has moved on", async () => {
    const h = await createHarness({ current: "0.10.0", latest: "0.10.0" });
    await writeOutcomeRecord(
      {
        at: new Date(h.clock.now).toISOString(),
        ok: false,
        from: "0.9.51",
        to: null,
        error: "old",
      },
      h.home,
    );

    expect((await createUpdateService(h.deps).status()).state).toBe("idle");
  });

  test("a run that writes nothing for ten minutes is reported as lost", async () => {
    const h = await createHarness();
    const service = createUpdateService(h.deps);
    await service.apply();

    h.clock.now += 11 * 60 * 1000;

    expect(await service.status()).toMatchObject({
      state: "failed",
      updateError: "The update did not finish",
    });
  });
});

describe("the daily check", () => {
  test("checks once the first delay has passed, and not again within a day", async () => {
    const h = await createHarness();
    const service = createUpdateService(h.deps);
    const asks = () =>
      h.release.requests.filter((line) => line.startsWith("/releases/latest.json ")).length;

    await service.runDueCheck();
    await service.runDueCheck();
    expect(asks()).toBe(1);

    h.clock.now += 25 * 60 * 60 * 1000;
    await service.runDueCheck();
    expect(asks()).toBe(2);
  });

  test("does not look at the feed while the setting is off", async () => {
    const h = await createHarness();
    h.setEnabled(false);

    await createUpdateService(h.deps).runDueCheck();

    expect(h.release.requests).toEqual([]);
  });

  test("a corrupt record is treated as no record", async () => {
    const h = await createHarness();
    await writeFile(join(h.home, "update-check.json"), "{nope");

    expect((await createUpdateService(h.deps).status()).latest).toBeNull();
  });
});

describe("nightly auto-apply", () => {
  const nightlyHarness = async (state: { busy: boolean; enabled: boolean }) => {
    const h = await createHarness({
      latest: "0.10.7-nightly.20261002.15",
      current: "0.10.7-nightly.20261002.14",
    });
    h.deps.feed = { ...h.deps.feed, channel: "nightly" };
    h.deps.autoApply = { enabled: async () => state.enabled, busy: async () => state.busy };
    return h;
  };

  test("installs a newer nightly once no turn is running, and not while one runs", async () => {
    const state = { busy: true, enabled: true };
    const h = await nightlyHarness(state);
    const service = createUpdateService(h.deps);

    await service.runDueCheck();
    expect((await service.status()).available).toBe(true);
    await service.runAutoApply();
    expect(h.startedUpdaters).toBe(0);

    state.busy = false;
    await service.runAutoApply();
    expect(h.startedUpdaters).toBe(1);
    expect((await service.status()).state).toBe("updating");
  });

  test("does nothing when the setting is off, or for a stable host", async () => {
    const off = await nightlyHarness({ busy: false, enabled: false });
    const offService = createUpdateService(off.deps);
    await offService.runDueCheck();
    await offService.runAutoApply();
    expect(off.startedUpdaters).toBe(0);

    const stable = await createHarness();
    const stableService = createUpdateService(stable.deps);
    await stableService.runDueCheck();
    await stableService.runAutoApply();
    expect(stable.startedUpdaters).toBe(0);
    expect((await stableService.status()).available).toBe(true);
  });

  test("waits six hours after a build that failed to start before trying again by itself", async () => {
    const h = await nightlyHarness({ busy: false, enabled: true });
    const service = createUpdateService(h.deps);
    await service.runDueCheck();
    await writeOutcomeRecord(
      {
        at: new Date(h.clock.now - 60_000).toISOString(),
        ok: false,
        from: "0.10.7-nightly.20261002.14",
        to: null,
        error: "did not start",
      },
      h.home,
    );

    await service.runAutoApply();
    expect(h.startedUpdaters).toBe(0);

    h.clock.now += 6 * 60 * 60 * 1000;
    await service.runAutoApply();
    expect(h.startedUpdaters).toBe(1);
  });

  test("a nightly host checks hourly, not daily", async () => {
    const h = await nightlyHarness({ busy: true, enabled: true });
    const service = createUpdateService(h.deps);
    await service.runDueCheck();
    const first = (await readCheckRecord(h.home))?.checkedAt;

    h.clock.now += 61 * 60 * 1000;
    await service.runDueCheck();
    expect((await readCheckRecord(h.home))?.checkedAt).not.toBe(first);
  });
});
