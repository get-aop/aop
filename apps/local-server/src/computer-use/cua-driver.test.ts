import { describe, expect, test } from "bun:test";
import { probeCua } from "./cua-driver.ts";
import { CUA_PATH, fakeCua } from "./test-utils.ts";

describe("probeCua", () => {
  test("is ready when the daemon reports both macOS permissions", async () => {
    const deps = fakeCua();

    expect(await probeCua(deps)).toEqual({
      state: "ready",
      usable: true,
      path: CUA_PATH,
      version: "0.32.0",
      detail: "CUA Driver 0.32.0 is installed and has its macOS permissions.",
      fix: [],
    });
    // Read-only commands only: nothing that could raise a permission prompt.
    expect(deps.calls).toEqual([
      [CUA_PATH, "--version"],
      [CUA_PATH, "permissions", "status", "--json"],
    ]);
  });

  test("says how to install it when there is none", async () => {
    const status = await probeCua(fakeCua(undefined, { locate: () => null }));

    expect(status).toMatchObject({ state: "not-installed", usable: false, path: null });
    expect(status.fix[0]).toContain("https://cua.ai/driver/install.sh");
  });

  test("names the permission that is missing and how to grant it", async () => {
    const status = await probeCua(
      fakeCua(JSON.stringify({ accessibility: true, screen_recording: false })),
    );

    expect(status).toMatchObject({ state: "missing-permissions", usable: false });
    expect(status.detail).toContain("Screen Recording permission");
    expect(status.detail).not.toContain("Accessibility");
    expect(status.fix).toEqual([
      "cua-driver permissions grant",
      "Or in System Settings › Privacy & Security › Screen Recording, turn on Cua Driver",
    ]);
  });

  test("still serves a thread when the app is not running, since it starts on first use", async () => {
    const status = await probeCua(
      fakeCua(JSON.stringify({ daemon_running: false, status: "unknown" })),
    );

    expect(status).toMatchObject({ state: "not-running", usable: true, path: CUA_PATH });
    expect(status.fix).toEqual(["open -n -g -a CuaDriver --args serve"]);
  });

  test("reports a driver that does not answer, or answers with something else", async () => {
    const hung = await probeCua(
      fakeCua(undefined, {
        run: async () => {
          throw new Error("`cua-driver --version` did not finish within 5s");
        },
      }),
    );
    const garbled = await probeCua(fakeCua("not json"));

    expect(hung).toMatchObject({ state: "error", usable: false, path: CUA_PATH });
    expect(hung.detail).toContain("did not finish");
    expect(garbled).toMatchObject({ state: "error", usable: false, version: "0.32.0" });
  });

  test("needs no grants off macOS", async () => {
    const deps = fakeCua("not asked", { platform: "linux" });

    expect(await probeCua(deps)).toMatchObject({ state: "ready", usable: true });
    expect(deps.calls).toEqual([[CUA_PATH, "--version"]]);
  });
});
