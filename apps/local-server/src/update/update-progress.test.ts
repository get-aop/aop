import { afterEach, describe, expect, test } from "bun:test";
import { createServiceHarness, type ServiceHarnessOptions } from "./test-utils.ts";
import { type OutcomeRecord, writeOutcomeRecord } from "./update-files.ts";
import { createUpdateService } from "./update-service.ts";

const stopAfter: Array<() => void> = [];
afterEach(() => {
  for (const stop of stopAfter.splice(0)) stop();
});

const createHarness = (options: ServiceHarnessOptions = {}) =>
  createServiceHarness(options, stopAfter);

const installedByHand = (at: string): OutcomeRecord => ({
  at,
  startedAt: new Date(Date.parse(at) - 9_000).toISOString(),
  ok: true,
  from: "0.9.51",
  to: "0.10.0",
  error: null,
  restartNeeded: true,
});

describe("installed, restart needed", () => {
  test("a host started by hand that swapped the new release in says to restart it, not that it failed", async () => {
    const h = await createHarness();
    const service = createUpdateService(h.deps);
    await service.apply();
    h.clock.now += 5_000;

    await writeOutcomeRecord(installedByHand(new Date(h.clock.now).toISOString()), h.home);

    expect(await service.status()).toMatchObject({
      state: "installed",
      updateError: "Restart the host to use 0.10.0: stop `aop run` and start it again",
    });
    // The run is over: Update host may run again.
    expect(await service.apply()).toEqual({ ok: true, queued: false, version: "0.10.0" });
  });

  test("stays so across a restart of the dashboard, and goes once the host runs the new release", async () => {
    const h = await createHarness();
    await writeOutcomeRecord(installedByHand(new Date(h.clock.now).toISOString()), h.home);

    expect((await createUpdateService(h.deps).status()).state).toBe("installed");

    h.deps.current = "0.10.0";
    expect((await createUpdateService(h.deps).status()).state).toBe("idle");
  });
});

describe("previous update", () => {
  test("is null before any update ran", async () => {
    const h = await createHarness();

    expect((await createUpdateService(h.deps).status()).previous).toBeNull();
  });

  test("tells when the last run ended, from what to what, how it went and how long it took", async () => {
    const h = await createHarness({ current: "0.10.0" });
    await writeOutcomeRecord(
      {
        at: "2026-10-02T22:45:09.000Z",
        startedAt: "2026-10-02T22:45:00.000Z",
        ok: true,
        from: "0.9.51",
        to: "0.10.0",
        error: null,
      },
      h.home,
    );

    expect((await createUpdateService(h.deps).status()).previous).toEqual({
      at: "2026-10-02T22:45:09.000Z",
      from: "0.9.51",
      to: "0.10.0",
      ok: true,
      seconds: 9,
      error: null,
    });
  });

  test("a record an older updater wrote has no duration", async () => {
    const h = await createHarness();
    await writeOutcomeRecord(
      { at: "2026-10-02T22:45:09.000Z", ok: false, from: "0.9.51", to: null, error: "boom" },
      h.home,
    );

    expect((await createUpdateService(h.deps).status()).previous).toMatchObject({
      ok: false,
      seconds: null,
      error: "boom",
    });
  });
});

describe("includes", () => {
  test("names the new CUA Driver only when the newer release pins another one", async () => {
    const h = await createHarness();
    h.deps.cuaDriverPin = "0.32.0";
    const service = createUpdateService(h.deps);
    await service.check();
    // The fake feed carries no pin, as feeds published before the field did not.
    expect((await service.status()).includes).toEqual({ cuaDriver: null });

    const record = Bun.file(`${h.home}/update-check.json`);
    const seen = await record.json();
    await Bun.write(record, JSON.stringify({ ...seen, cuaDriver: "0.33.0" }));
    expect((await createUpdateService(h.deps).status()).includes).toEqual({
      cuaDriver: { from: "0.32.0", to: "0.33.0" },
    });

    await Bun.write(record, JSON.stringify({ ...seen, cuaDriver: "0.32.0" }));
    expect((await createUpdateService(h.deps).status()).includes.cuaDriver).toBeNull();
  });

  test("a check records the pin the feed names", async () => {
    const h = await createHarness();
    h.deps.cuaDriverPin = "0.32.0";
    h.release.feedExtras.cuaDriver = "0.40.0";

    const status = await createUpdateService(h.deps).check();

    expect(status.includes.cuaDriver).toEqual({ from: "0.32.0", to: "0.40.0" });
  });
});
