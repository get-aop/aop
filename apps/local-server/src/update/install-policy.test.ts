import { afterEach, describe, expect, test } from "bun:test";
import { installsByItselfAt, localMinuteOfDay, parseInstallPolicy } from "./install-policy.ts";
import {
  createServiceHarness,
  type ServiceHarness,
  type ServiceHarnessOptions,
  serviceTurn as turn,
} from "./test-utils.ts";
import { readCheckRecord, writeOutcomeRecord } from "./update-files.ts";
import { createUpdateService } from "./update-service.ts";

const stopAfter: Array<() => void> = [];
afterEach(() => {
  for (const stop of stopAfter.splice(0)) stop();
});

const at = (hhmm: string): number => {
  const [h = 0, m = 0] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

describe("the install policy settings", () => {
  test("read the mode and the window, falling back to asking and the default hours", () => {
    expect(parseInstallPolicy("window", "22:30-05:00")).toEqual({
      mode: "window",
      window: [at("22:30"), at("05:00")],
    });
    expect(parseInstallPolicy("true", "nonsense")).toEqual({
      mode: "ask",
      window: [at("01:00"), at("06:00")],
    });
  });

  test("ask never installs by itself, idle always may, window only inside its hours", () => {
    const night = parseInstallPolicy("window", "01:00-06:00");
    const late = parseInstallPolicy("window", "22:00-02:00");

    expect(installsByItselfAt(parseInstallPolicy("ask", ""), at("03:00"))).toBe(false);
    expect(installsByItselfAt(parseInstallPolicy("idle", ""), at("14:00"))).toBe(true);
    expect(installsByItselfAt(night, at("00:59"))).toBe(false);
    expect(installsByItselfAt(night, at("01:00"))).toBe(true);
    expect(installsByItselfAt(night, at("05:59"))).toBe(true);
    expect(installsByItselfAt(night, at("06:00"))).toBe(false);
    expect(installsByItselfAt(late, at("23:30"))).toBe(true);
    expect(installsByItselfAt(late, at("01:30"))).toBe(true);
    expect(installsByItselfAt(late, at("12:00"))).toBe(false);
  });

  test("the window is in the host's own time", () => {
    const local = new Date(2026, 9, 3, 4, 30);

    expect(localMinuteOfDay(local.getTime())).toBe(at("04:30"));
  });
});

describe("installing by itself", () => {
  const harness = async (
    options: ServiceHarnessOptions & { mode: "ask" | "idle" | "window"; busy?: boolean },
  ): Promise<ServiceHarness> => {
    const h = await createServiceHarness(options, stopAfter);
    h.policy = parseInstallPolicy(options.mode, "01:00-06:00");
    if (options.busy) h.turns = [turn("r1"), turn("r2")];
    return h;
  };
  const nightly = {
    latest: "0.10.7-nightly.20261002.15",
    current: "0.10.7-nightly.20261002.14",
    channel: "nightly",
  } as const;

  test("ask leaves it to a person on either channel", async () => {
    for (const options of [{}, nightly]) {
      const h = await harness({ ...options, mode: "ask" });
      const service = createUpdateService(h.deps);

      await service.runDueCheck();
      await service.runAutoInstall();

      expect(h.startedUpdaters).toBe(0);
      expect(await service.status()).toMatchObject({ available: true, queued: null });
    }
  });

  test("idle installs a newer Stable release at once when no turn is running", async () => {
    const h = await harness({ mode: "idle" });
    const service = createUpdateService(h.deps);

    await service.runDueCheck();
    await service.runAutoInstall();

    expect(h.startedUpdaters).toBe(1);
    expect((await service.status()).state).toBe("updating");
  });

  test("idle on a host that is never idle installs once the turns running when it found the build have finished", async () => {
    const h = await harness({ ...nightly, mode: "idle", busy: true });
    const service = createUpdateService(h.deps);

    await service.runDueCheck();
    await service.runAutoInstall();
    expect(h.startedUpdaters).toBe(0);
    expect((await service.status()).queued).toMatchObject({ by: "auto", waitingFor: 2 });

    h.turns = [turn("r3")];
    await service.runQueued();
    expect(h.startedUpdaters).toBe(1);
  });

  test("window queues only inside its hours", async () => {
    const h = await harness({ mode: "window" });
    const service = createUpdateService(h.deps);
    await service.runDueCheck();

    h.minute.value = at("14:00");
    await service.runAutoInstall();
    expect(h.startedUpdaters).toBe(0);

    h.minute.value = at("02:00");
    await service.runAutoInstall();
    expect(h.startedUpdaters).toBe(1);
  });

  test("an install queued in the window does not start once the window has closed", async () => {
    const h = await harness({ mode: "window", busy: true });
    const service = createUpdateService(h.deps);
    h.minute.value = at("05:50");
    await service.runDueCheck();
    await service.runAutoInstall();
    expect((await service.status()).queued).toMatchObject({ by: "auto" });

    h.minute.value = at("06:10");
    h.turns = [];
    await service.runQueued();
    expect(h.startedUpdaters).toBe(0);
    expect((await service.status()).queued).toBeNull();

    // The next night it is queued again, and with no turn running it starts at once.
    h.minute.value = at("01:05");
    await service.runAutoInstall();
    expect(h.startedUpdaters).toBe(1);
  });

  test("switching to ask drops the install it had queued, but not one a person queued", async () => {
    const h = await harness({ ...nightly, mode: "idle", busy: true });
    const service = createUpdateService(h.deps);
    await service.runDueCheck();
    await service.runAutoInstall();

    h.policy = parseInstallPolicy("ask", "");
    await service.runQueued();
    expect((await service.status()).queued).toBeNull();

    await service.apply({ when: "idle" });
    await service.runQueued();
    expect((await service.status()).queued).toMatchObject({ by: "person" });
  });

  test("nothing installs by itself while update checks are off", async () => {
    const h = await harness({ mode: "idle" });
    const service = createUpdateService(h.deps);
    await service.runDueCheck();
    h.setEnabled(false);

    await service.runAutoInstall();

    expect(h.startedUpdaters).toBe(0);
  });

  test("waits six hours after a build that failed to start before trying again by itself", async () => {
    const h = await harness({ ...nightly, mode: "idle" });
    const service = createUpdateService(h.deps);
    await service.runDueCheck();
    await writeOutcomeRecord(
      {
        at: new Date(h.clock.now - 60_000).toISOString(),
        ok: false,
        from: nightly.current,
        to: null,
        error: "did not start",
      },
      h.home,
    );

    await service.runAutoInstall();
    expect(h.startedUpdaters).toBe(0);

    h.clock.now += 6 * 60 * 60 * 1000;
    await service.runAutoInstall();
    expect(h.startedUpdaters).toBe(1);
  });

  test("does not install again what a host started by hand already installed", async () => {
    const h = await harness({ mode: "idle" });
    const service = createUpdateService(h.deps);
    await service.runDueCheck();
    await writeOutcomeRecord(
      {
        at: new Date(h.clock.now).toISOString(),
        ok: true,
        from: "0.9.51",
        to: "0.10.0",
        error: null,
        restartNeeded: true,
      },
      h.home,
    );

    await service.runAutoInstall();

    expect(h.startedUpdaters).toBe(0);
  });

  test("a nightly host checks hourly, not daily", async () => {
    const h = await harness({ ...nightly, mode: "idle", busy: true });
    const service = createUpdateService(h.deps);
    await service.runDueCheck();
    const first = (await readCheckRecord(h.home))?.checkedAt;

    h.clock.now += 61 * 60 * 1000;
    await service.runDueCheck();
    expect((await readCheckRecord(h.home))?.checkedAt).not.toBe(first);
  });
});
