import { afterEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HostManagement } from "@aop/common";
import type { RunningTurnRef } from "./queued-update.ts";
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
  /** The turns the host is running; tests change it as turns start and end. */
  turns: RunningTurnRef[];
  management: { setting: HostManagement };
}

const turn = (runId: string, title = `Thread ${runId}`): RunningTurnRef => ({
  runId,
  title,
  kind: "thread",
});

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
    turns: [],
    management: { setting: "devices" },
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
    hostName: "soulf",
    restart: async () => "service",
    runningTurns: async () => harness.turns,
    hostManagement: async () => harness.management.setting,
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
      hostName: "soulf",
      canUpdate: true,
      owner: true,
      hostManagement: "devices",
      restart: "service",
      runningTurns: [],
      queued: null,
      download: { state: "idle", version: null, error: null },
      previous: null,
      includes: { cuaDriver: null },
    });
  });

  test("says whether the caller may update: devices by default, only the host machine when narrowed, never an agent", async () => {
    const h = await createHarness();
    const service = createUpdateService(h.deps);
    const device = { kind: "device", agent: false } as const;
    const owner = { kind: "owner", agent: false } as const;
    const agent = { kind: "owner", agent: true } as const;

    expect(await service.status(device)).toMatchObject({ canUpdate: true, owner: false });
    expect(await service.status(agent)).toMatchObject({ canUpdate: false, owner: false });

    h.management.setting = "owner";
    expect(await service.status(device)).toMatchObject({
      canUpdate: false,
      hostManagement: "owner",
    });
    expect(await service.status(owner)).toMatchObject({ canUpdate: true, owner: true });
    expect((await service.check(device)).canUpdate).toBe(false);
  });

  test("names the turns an update would restart under", async () => {
    const h = await createHarness();
    h.turns = [
      turn("r1", "Design: one clear UX"),
      { runId: "r2", title: "aop coordinator", kind: "coordinator" },
    ];

    expect((await createUpdateService(h.deps).status()).runningTurns).toEqual([
      { title: "Design: one clear UX", kind: "thread" },
      { title: "aop coordinator", kind: "coordinator" },
    ]);
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

    expect(await service.apply()).toEqual({ ok: true, queued: false });

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

describe("update when the turns finish", () => {
  test("starts at once when no turn is running", async () => {
    const h = await createHarness();
    const service = createUpdateService(h.deps);

    expect(await service.apply({ when: "idle" })).toEqual({ ok: true, queued: false });
    expect(h.startedUpdaters).toBe(1);
  });

  test("waits for the turns running when it was asked, and not for turns started later", async () => {
    const h = await createHarness();
    const service = createUpdateService(h.deps);
    h.turns = [turn("r1"), turn("r2")];

    expect(await service.apply({ when: "idle" })).toEqual({ ok: true, queued: true });
    expect(h.startedUpdaters).toBe(0);
    expect((await service.status()).queued).toMatchObject({
      version: "0.10.0",
      waitingFor: 2,
      by: "person",
      expired: false,
    });

    h.turns = [turn("r2"), turn("r3")];
    await service.runQueued();
    expect(h.startedUpdaters).toBe(0);
    expect((await service.status()).queued?.waitingFor).toBe(1);

    // The host is never idle: r3 and r4 still run, but every turn it waited for has finished.
    h.turns = [turn("r3"), turn("r4")];
    await service.runQueued();
    expect(h.startedUpdaters).toBe(1);
    expect(await service.status()).toMatchObject({ state: "updating", queued: null });
  });

  test("Cancel drops it, and Update now starts at once instead", async () => {
    const h = await createHarness();
    const service = createUpdateService(h.deps);
    h.turns = [turn("r1")];

    await service.apply({ when: "idle" });
    await service.cancel();
    h.turns = [];
    await service.runQueued();
    expect(h.startedUpdaters).toBe(0);
    expect((await service.status()).queued).toBeNull();

    h.turns = [turn("r2")];
    await service.apply({ when: "idle" });
    expect(await service.apply({ when: "now" })).toEqual({ ok: true, queued: false });
    expect(h.startedUpdaters).toBe(1);
    expect((await service.status()).queued).toBeNull();
  });

  test("after six hours it asks again instead of forcing the restart, and still installs once the turns end", async () => {
    const h = await createHarness();
    const service = createUpdateService(h.deps);
    h.turns = [turn("r1")];
    await service.apply({ when: "idle" });

    h.clock.now += 6 * 60 * 60 * 1000;
    await service.runQueued();
    expect(h.startedUpdaters).toBe(0);
    expect((await service.status()).queued).toMatchObject({ expired: true, waitingFor: 1 });

    h.turns = [];
    await service.runQueued();
    expect(h.startedUpdaters).toBe(1);
  });

  test("a queued update that cannot start says why", async () => {
    const h = await createHarness({
      startUpdater: async () => {
        throw new Error("no such file");
      },
    });
    const service = createUpdateService(h.deps);
    h.turns = [turn("r1")];
    await service.apply({ when: "idle" });

    h.turns = [];
    await service.runQueued();

    expect(await service.status()).toMatchObject({
      state: "failed",
      updateError: "Could not start the update: no such file",
      queued: null,
    });
  });

  test("refuses to queue what it could not install", async () => {
    const h = await createHarness({ latest: "0.9.51" });
    h.turns = [turn("r1")];

    expect(await createUpdateService(h.deps).apply({ when: "idle" })).toEqual({
      ok: false,
      error: "AOP is already up to date",
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
    h.deps.autoApply = { enabled: async () => state.enabled };
    if (state.busy) h.turns = [turn("r1"), turn("r2")];
    return h;
  };

  test("installs a newer nightly at once when no turn is running", async () => {
    const h = await nightlyHarness({ busy: false, enabled: true });
    const service = createUpdateService(h.deps);

    await service.runDueCheck();
    await service.runAutoApply();
    expect(h.startedUpdaters).toBe(1);
    expect((await service.status()).state).toBe("updating");
  });

  test("on a host that is never idle, installs once the turns running when it found the build have finished", async () => {
    const h = await nightlyHarness({ busy: true, enabled: true });
    const service = createUpdateService(h.deps);

    await service.runDueCheck();
    expect((await service.status()).available).toBe(true);
    await service.runAutoApply();
    expect(h.startedUpdaters).toBe(0);
    expect((await service.status()).queued).toMatchObject({ by: "auto", waitingFor: 2 });

    h.turns = [turn("r3")];
    await service.runQueued();
    expect(h.startedUpdaters).toBe(1);
  });

  test("turning the setting off drops the install it had queued", async () => {
    const state = { busy: true, enabled: true };
    const h = await nightlyHarness(state);
    const service = createUpdateService(h.deps);
    await service.runDueCheck();
    await service.runAutoApply();

    state.enabled = false;
    h.turns = [];
    await service.runQueued();

    expect(h.startedUpdaters).toBe(0);
    expect((await service.status()).queued).toBeNull();
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
