import { describe, expect, test } from "bun:test";
import { CuaStatusSchema } from "@aop/common";
import { probeCua } from "./cua-driver.ts";
import { CHECKED_AT, CUA_PATH, fakeCua } from "./test-utils.ts";

const checkOf = async (deps: ReturnType<typeof fakeCua>, id: string) =>
  (await probeCua(deps)).checks.find((check) => check.id === id);

describe("probeCua on the host", () => {
  test("ready: installed, answers, running, both grants", async () => {
    const deps = fakeCua();
    const status = await probeCua(deps);

    expect(CuaStatusSchema.parse(status)).toEqual(status);
    expect(status).toMatchObject({
      status: "ready",
      reason: "ready",
      detail: "CUA Driver 0.32.0 is ready on this host.",
      path: CUA_PATH,
      version: "0.32.0",
      latestVersion: "0.32.0",
      host: { name: "Studio Mac", platform: "darwin" },
      checkedAt: CHECKED_AT,
    });
    expect(status.checks.map(({ id, ok }) => [id, ok])).toEqual([
      ["installed", true],
      ["answers", true],
      ["running", true],
      ["accessibility", true],
      ["screen-recording", true],
      ["direct-capture", null],
      ["up-to-date", true],
    ]);
    // Read-only commands only: nothing that could raise a permission prompt or start the app.
    expect(deps.calls.map((argv) => argv.slice(1).join(" ")).sort()).toEqual([
      "--version",
      "check-update --json",
      "permissions status --json",
    ]);
  });

  test("not installed: no driver on the host, and nothing is run", async () => {
    const deps = fakeCua({}, { locate: () => null });
    const status = await probeCua(deps);

    expect(status).toMatchObject({
      status: "not-installed",
      reason: "not-installed",
      path: null,
      version: null,
      host: { name: "Studio Mac" },
    });
    expect(deps.calls).toEqual([]);
  });

  test("not ready: the driver does not answer", async () => {
    const hung = await probeCua(fakeCua({ version: new Error("did not finish within 5s") }));
    const silent = await probeCua(fakeCua({ version: "" }));

    expect(hung).toMatchObject({ status: "not-ready", reason: "no-answer", version: null });
    expect(hung.detail).toContain("did not finish within 5s");
    expect(silent).toMatchObject({ status: "not-ready", reason: "no-answer" });
  });

  test("not ready: its app is not running, so the grants cannot be read", async () => {
    const status = await probeCua(
      fakeCua({ permissions: JSON.stringify({ daemon_running: false, status: "unknown" }) }),
    );

    expect(status).toMatchObject({ status: "not-ready", reason: "not-running", version: "0.32.0" });
    expect(status.checks.map((check) => check.id)).not.toContain("accessibility");
  });

  test("not ready: a missing grant, named", async () => {
    const status = await probeCua(
      fakeCua({ permissions: JSON.stringify({ accessibility: true, screen_recording: false }) }),
    );

    expect(status).toMatchObject({ status: "not-ready", reason: "missing-permissions" });
    expect(status.detail).toBe("CUA Driver lacks the macOS Screen Recording permission.");
  });

  test("not ready: no permission report at all", async () => {
    const garbled = await probeCua(fakeCua({ permissions: "not json" }));
    const failed = await probeCua(fakeCua({ permissions: new Error("socket closed") }));

    expect(garbled).toMatchObject({ status: "not-ready", reason: "not-running" });
    expect(failed).toMatchObject({ status: "not-ready", reason: "not-running" });
  });

  test("an update is reported but does not make it unready, nor does being offline", async () => {
    const behind = fakeCua({ latest: "0.33.1" });
    const offline = fakeCua({ latest: null });

    expect(await probeCua(behind)).toMatchObject({ status: "ready", latestVersion: "0.33.1" });
    expect(await checkOf(behind, "up-to-date")).toMatchObject({
      ok: false,
      detail: "0.33.1 is out.",
    });
    expect(await probeCua(offline)).toMatchObject({ status: "ready", latestVersion: null });
    expect(await checkOf(offline, "up-to-date")).toMatchObject({ ok: null });
  });

  test("Tahoe's direct capture consent counts once the daemon says it is ready", async () => {
    const deps = fakeCua({
      permissions: JSON.stringify({
        accessibility: true,
        screen_recording: true,
        direct_capture_status: "ready",
      }),
    });

    expect(await checkOf(deps, "direct-capture")).toMatchObject({ ok: true, required: false });
  });

  test("off macOS there are no grants to read", async () => {
    const deps = fakeCua({}, { platform: "linux" });

    expect(await probeCua(deps)).toMatchObject({ status: "ready", host: { platform: "linux" } });
    expect(deps.calls.some((argv) => argv[1] === "permissions")).toBe(false);
  });

  test("falls back to the network host name when the host's name cannot be read", async () => {
    const status = await probeCua(
      fakeCua({}, { hostName: () => Promise.reject(new Error("no scutil")) }),
    );

    expect(status.host.name.length).toBeGreaterThan(0);
  });
});
