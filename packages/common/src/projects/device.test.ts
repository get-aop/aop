import { describe, expect, test } from "bun:test";
import { DeviceSchema } from "./device.ts";
import { AT, LATER, rejectedPaths } from "./test-utils.ts";

const makeDevice = (overrides: Record<string, unknown> = {}) => ({
  id: "dev_1",
  name: "Marcelo's MacBook",
  createdAt: AT,
  lastSeenAt: LATER,
  ...overrides,
});

describe("DeviceSchema", () => {
  test("accepts a paired device", () => {
    expect(DeviceSchema.parse(makeDevice())).toEqual(makeDevice());
  });

  test("accepts a device that has never connected since pairing", () => {
    expect(DeviceSchema.parse(makeDevice({ lastSeenAt: null })).lastSeenAt).toBeNull();
  });

  test("strips a token hash instead of passing it through", () => {
    const parsed = DeviceSchema.parse(makeDevice({ tokenHash: "sha256:abc", token: "aop_secret" }));
    expect(parsed).toEqual(makeDevice());
    expect(Object.keys(parsed)).not.toContain("tokenHash");
    expect(Object.keys(parsed)).not.toContain("token");
  });

  test("rejects a blank or over-long name", () => {
    expect(rejectedPaths(DeviceSchema, makeDevice({ name: " " }))).toEqual(["name"]);
    expect(rejectedPaths(DeviceSchema, makeDevice({ name: "d".repeat(101) }))).toEqual(["name"]);
  });

  test("rejects timestamps that are not ISO instants", () => {
    expect(rejectedPaths(DeviceSchema, makeDevice({ lastSeenAt: "yesterday" }))).toEqual([
      "lastSeenAt",
    ]);
  });
});
