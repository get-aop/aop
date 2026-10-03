import { describe, expect, test } from "bun:test";
import type { Device } from "@aop/common";
import { requestClient, sameClient, withClientStatus } from "./client-info.ts";

const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

const device = (client: Device["client"]): Device => ({
  id: "d1",
  name: "Work Mac",
  createdAt: "2026-10-01T09:00:00.000Z",
  lastSeenAt: null,
  client,
});

describe("requestClient", () => {
  test("reads the desktop app from its header", () => {
    expect(
      requestClient({ client: "desktop; version=0.10.8; platform=darwin", userAgent: MAC_SAFARI }),
    ).toEqual({ app: "desktop", version: "0.10.8", platform: "darwin" });
  });

  test("takes anything without the header for a browser, on the platform its User-Agent names", () => {
    expect(requestClient({ userAgent: MAC_SAFARI })).toEqual({
      app: "browser",
      version: null,
      platform: "darwin",
    });
    expect(requestClient({ client: "something else" })).toEqual({
      app: "browser",
      version: null,
      platform: null,
    });
  });
});

describe("sameClient", () => {
  test("compares app, version and platform", () => {
    const mac = { app: "desktop", version: "0.10.8", platform: "darwin" } as const;
    expect(sameClient(mac, { ...mac })).toBe(true);
    expect(sameClient(mac, { ...mac, version: "0.10.9" })).toBe(false);
    expect(sameClient(null, mac)).toBe(false);
  });
});

describe("withClientStatus", () => {
  const nightlyHost = { version: "0.10.8-nightly.20261003.4", channel: "nightly" } as const;

  test("flags a desktop app older than the host on the same channel", () => {
    const old = device({
      app: "desktop",
      version: "0.10.8-nightly.20261002.17",
      platform: "darwin",
    });
    const current = device({
      app: "desktop",
      version: "0.10.8-nightly.20261003.4",
      platform: "darwin",
    });

    expect(withClientStatus(old, nightlyHost).outOfDate).toBe(true);
    expect(withClientStatus(current, nightlyHost).outOfDate).toBe(false);
  });

  test("never flags a browser, an app of another channel, an unknown version or a source host", () => {
    const stableApp = device({ app: "desktop", version: "0.10.6", platform: "win32" });
    const browser = device({ app: "browser", version: null, platform: "linux" });
    const unknown = device({ app: "desktop", version: null, platform: "darwin" });

    expect(withClientStatus(stableApp, nightlyHost).outOfDate).toBe(false);
    expect(withClientStatus(browser, nightlyHost).outOfDate).toBe(false);
    expect(withClientStatus(unknown, nightlyHost).outOfDate).toBe(false);
    expect(withClientStatus(stableApp, { version: "dev", channel: "stable" }).outOfDate).toBe(
      false,
    );
    expect(withClientStatus(stableApp, { version: "0.10.8", channel: "stable" }).outOfDate).toBe(
      true,
    );
  });

  test("a device that never said keeps a null client", () => {
    const legacy: Device = {
      id: "d1",
      name: "Old",
      createdAt: "2026-10-01T09:00:00.000Z",
      lastSeenAt: null,
    };
    expect(withClientStatus(legacy, nightlyHost)).toMatchObject({ client: null, outOfDate: false });
  });
});
