import { describe, expect, test } from "bun:test";
import {
  API_VERSION,
  checkHostCompatibility,
  DESKTOP_APP_ORIGIN,
  HostHealthSchema,
  MIN_CLIENT_API_VERSION,
} from "./host-api.ts";

describe("host API version", () => {
  test("a host accepts the clients built for its own version", () => {
    expect(MIN_CLIENT_API_VERSION).toBeLessThanOrEqual(API_VERSION);
    expect(
      checkHostCompatibility({
        apiVersion: API_VERSION,
        minClientApiVersion: MIN_CLIENT_API_VERSION,
      }),
    ).toEqual({ status: "compatible" });
  });

  test("tells a client that is older than the host allows to update the app", () => {
    expect(checkHostCompatibility({ apiVersion: 5, minClientApiVersion: 4 }, 3)).toEqual({
      status: "client-too-old",
    });
  });

  test("tells a client that is newer than the host to update the host", () => {
    expect(checkHostCompatibility({ apiVersion: 2, minClientApiVersion: 1 }, 3)).toEqual({
      status: "host-too-old",
    });
  });

  test("accepts every client between the oldest allowed and the host's own version", () => {
    for (const client of [2, 3, 4]) {
      expect(checkHostCompatibility({ apiVersion: 4, minClientApiVersion: 2 }, client)).toEqual({
        status: "compatible",
      });
    }
  });
});

describe("HostHealthSchema", () => {
  test("reads the fields a client needs and ignores the rest", () => {
    const parsed = HostHealthSchema.parse({
      ok: true,
      service: "aop",
      version: "0.9.51",
      apiVersion: 1,
      minClientApiVersion: 1,
      uptime: 12,
      db: { connected: true },
    });

    expect(parsed).toEqual({
      service: "aop",
      version: "0.9.51",
      apiVersion: 1,
      minClientApiVersion: 1,
    });
  });

  test("rejects an answer from something that is not an AOP host or is too old to report versions", () => {
    expect(HostHealthSchema.safeParse({ ok: true, service: "aop", uptime: 1 }).success).toBe(false);
    expect(
      HostHealthSchema.safeParse({
        service: "nginx",
        version: "1",
        apiVersion: 1,
        minClientApiVersion: 1,
      }).success,
    ).toBe(false);
  });
});

describe("DESKTOP_APP_ORIGIN", () => {
  test("is the origin of a custom scheme, so no web page can hold it", () => {
    expect(DESKTOP_APP_ORIGIN).toBe("app://aop");
    expect(DESKTOP_APP_ORIGIN.startsWith("http")).toBe(false);
  });
});
