import { describe, expect, test } from "bun:test";
import {
  isWithinOfflineGrace,
  LICENSE_OFFLINE_GRACE_MS,
  LICENSE_VALIDATION_CACHE_MS,
  shouldRefreshLicenseValidation,
} from "./validation-policy.ts";

describe("validation-policy", () => {
  const now = Date.parse("2026-05-25T12:00:00.000Z");

  test("requires refresh when never validated", () => {
    expect(shouldRefreshLicenseValidation(null, now)).toBe(true);
  });

  test("skips refresh inside cache window", () => {
    const validatedAt = new Date(now - LICENSE_VALIDATION_CACHE_MS + 60_000).toISOString();
    expect(shouldRefreshLicenseValidation(validatedAt, now)).toBe(false);
  });

  test("refreshes after cache window", () => {
    const validatedAt = new Date(now - LICENSE_VALIDATION_CACHE_MS - 1).toISOString();
    expect(shouldRefreshLicenseValidation(validatedAt, now)).toBe(true);
  });

  test("offline grace applies only after a successful validation", () => {
    expect(isWithinOfflineGrace(null, now)).toBe(false);
    const validatedAt = new Date(now - LICENSE_OFFLINE_GRACE_MS + 60_000).toISOString();
    expect(isWithinOfflineGrace(validatedAt, now)).toBe(true);
  });
});
