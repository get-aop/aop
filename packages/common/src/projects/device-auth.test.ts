import { describe, expect, test } from "bun:test";
import {
  AuthPrincipalSchema,
  PairDeviceRequestSchema,
  PairedDeviceSchema,
  PairingCodeSchema,
} from "./device-auth.ts";
import { AT, LATER, rejectedPaths } from "./test-utils.ts";

const device = { id: "dev_1", name: "Work Mac", createdAt: AT, lastSeenAt: null };

describe("AuthPrincipalSchema", () => {
  test("accepts the host owner and a paired device", () => {
    expect(AuthPrincipalSchema.parse({ kind: "owner" })).toEqual({ kind: "owner" });
    expect(AuthPrincipalSchema.parse({ kind: "device", device })).toEqual({
      kind: "device",
      device,
    });
  });

  test("a device principal needs its device and an owner carries none", () => {
    expect(AuthPrincipalSchema.safeParse({ kind: "device" }).success).toBe(false);
    expect(AuthPrincipalSchema.parse({ kind: "owner", device })).toEqual({ kind: "owner" });
    expect(AuthPrincipalSchema.safeParse({ kind: "admin" }).success).toBe(false);
  });
});

describe("PairDeviceRequestSchema", () => {
  test("trims the code and the device name", () => {
    expect(PairDeviceRequestSchema.parse({ code: " ABCD-2345 ", name: " Work Mac " })).toEqual({
      code: "ABCD-2345",
      name: "Work Mac",
    });
  });

  test("rejects a blank code and a blank or over-long name", () => {
    expect(rejectedPaths(PairDeviceRequestSchema, { code: " ", name: "Work Mac" })).toEqual([
      "code",
    ]);
    expect(rejectedPaths(PairDeviceRequestSchema, { code: "ABCD-2345", name: "" })).toEqual([
      "name",
    ]);
    expect(
      rejectedPaths(PairDeviceRequestSchema, { code: "ABCD-2345", name: "d".repeat(101) }),
    ).toEqual(["name"]);
  });
});

describe("PairedDeviceSchema", () => {
  test("carries the device and the one-time token", () => {
    expect(PairedDeviceSchema.parse({ device, token: "aop_secret" })).toEqual({
      device,
      token: "aop_secret",
    });
    expect(rejectedPaths(PairedDeviceSchema, { device, token: "" })).toEqual(["token"]);
  });
});

describe("PairingCodeSchema", () => {
  test("needs the code and an ISO expiry", () => {
    expect(PairingCodeSchema.parse({ code: "ABCD-2345", expiresAt: LATER }).code).toBe("ABCD-2345");
    expect(rejectedPaths(PairingCodeSchema, { code: "ABCD-2345", expiresAt: "soon" })).toEqual([
      "expiresAt",
    ]);
  });
});
