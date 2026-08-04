import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  buildSignedLicensePayload,
  freeEntitlement,
  generateLicenseSigningKeyPair,
  signLicenseKey,
} from "@aop/license";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createSettingsRepository } from "../settings/repository.ts";
import { assertWithinWorkerLimitWithRefresh, refreshPaidEntitlement } from "./refresh.ts";
import { createLicenseStorage } from "./storage.ts";

// Ephemeral signing keypair: the production private key is never committed.
const TEST_KEYPAIR = generateLicenseSigningKeyPair();
process.env.AOP_LICENSE_PUBLIC_KEY = TEST_KEYPAIR.publicDerB64;
const DEV_PRIVATE_KEY_DER_B64 = TEST_KEYPAIR.privateDerB64;

const resolveFetchUrl = (input: string | URL | { url: string }): string => {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
};

const mockLicenseServerValidateFetch = (): typeof fetch =>
  (async (input: string | URL | { url: string }) => {
    if (resolveFetchUrl(input).includes("/v1/validate")) {
      return Response.json({
        entitlement: {
          plan: "pro",
          maxActiveWorkers: 4,
          expiresAt: null,
          source: "lemonsqueezy",
        },
        lemonInstanceId: "inst-123",
      });
    }
    return Response.json({ error: "unexpected" }, { status: 404 });
  }) as unknown as typeof fetch;

describe("license/refresh", () => {
  let db: Kysely<Database>;
  const originalFetch = globalThis.fetch;
  const originalLemonApiKey = process.env.LEMON_SQUEEZY_API_KEY;

  beforeEach(async () => {
    db = await createTestDb();
    delete process.env.LEMON_SQUEEZY_API_KEY;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalLemonApiKey === undefined) {
      delete process.env.LEMON_SQUEEZY_API_KEY;
    } else {
      process.env.LEMON_SQUEEZY_API_KEY = originalLemonApiKey;
    }
  });

  test("allows free tier without calling license server", async () => {
    const storage = createLicenseStorage(createSettingsRepository(db));
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return Response.json({});
    }) as unknown as typeof fetch;

    const result = await assertWithinWorkerLimitWithRefresh({
      storage,
      activeCount: 2,
      resolveServerUrl: async () => "https://license.example.com",
      resolveMachineId: async () => "machine-1",
    });

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.entitlement.plan).toBe("free");
    }
    expect(fetchCalls).toBe(0);
  });

  test("uses offline grace when validation fails but cache is recent", async () => {
    const storage = createLicenseStorage(createSettingsRepository(db));
    await storage.setLicenseKey("LS-OFFLINE");
    await storage.setEntitlementJson(
      JSON.stringify({
        plan: "pro",
        maxActiveWorkers: 4,
        expiresAt: null,
        source: "lemonsqueezy",
      }),
    );
    await storage.setValidatedAt(new Date().toISOString());

    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const result = await assertWithinWorkerLimitWithRefresh({
      storage,
      activeCount: 2,
      resolveServerUrl: async () => "https://license.example.com",
      resolveMachineId: async () => "machine-1",
    });

    expect(result.allowed).toBe(true);
  });

  test("rejects stale paid license when validation fails outside grace", async () => {
    const storage = createLicenseStorage(createSettingsRepository(db));
    await storage.setLicenseKey("LS-EXPIRED");
    await storage.setEntitlementJson(
      JSON.stringify({
        plan: "pro",
        maxActiveWorkers: 4,
        expiresAt: null,
        source: "lemonsqueezy",
      }),
    );
    await storage.setValidatedAt("2020-01-01T00:00:00.000Z");

    globalThis.fetch = (async () =>
      Response.json({ error: "License is not valid" }, { status: 400 })) as unknown as typeof fetch;

    const result = await assertWithinWorkerLimitWithRefresh({
      storage,
      activeCount: 2,
      resolveServerUrl: async () => "https://license.example.com",
      resolveMachineId: async () => "machine-1",
    });

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("license_invalid");
    }
  });

  test("enforces worker limit after refresh", async () => {
    const storage = createLicenseStorage(createSettingsRepository(db));
    await storage.setLicenseKey("LS-LIMIT");
    await storage.setEntitlementJson(JSON.stringify(freeEntitlement()));
    await storage.setValidatedAt(new Date().toISOString());

    const result = await assertWithinWorkerLimitWithRefresh({
      storage,
      activeCount: 4,
      resolveServerUrl: async () => "https://license.example.com",
      resolveMachineId: async () => "machine-1",
    });

    expect(result.allowed).toBe(false);
    if (!result.allowed && result.reason === "limit") {
      expect(result.limit).toBe(4);
    }
  });

  test("ignores tampered maxActiveWorkers on cached Lemon entitlements", async () => {
    const storage = createLicenseStorage(createSettingsRepository(db));
    await storage.setLicenseKey("LS-TAMPER");
    await storage.setEntitlementJson(
      JSON.stringify({
        plan: "pro",
        maxActiveWorkers: null,
        expiresAt: null,
        licenseKeyLast4: "MPER",
        source: "lemonsqueezy",
      }),
    );
    await storage.setValidatedAt(new Date().toISOString());

    const result = await assertWithinWorkerLimitWithRefresh({
      storage,
      activeCount: 8,
      resolveServerUrl: async () => "https://license.example.com",
      resolveMachineId: async () => "machine-1",
    });

    expect(result.allowed).toBe(false);
    if (!result.allowed && result.reason === "limit") {
      expect(result.limit).toBe(8);
    }
  });

  test("refreshPaidEntitlement stores signed license entitlement", async () => {
    const storage = createLicenseStorage(createSettingsRepository(db));
    const licenseKey = signLicenseKey(
      buildSignedLicensePayload("team", null),
      DEV_PRIVATE_KEY_DER_B64,
    );
    await storage.setLicenseKey(licenseKey);

    const result = await refreshPaidEntitlement({
      storage,
      resolveServerUrl: async () => "https://license.example.com",
      resolveMachineId: async () => "machine-1",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entitlement.plan).toBe("team");
      expect(result.entitlement.source).toBe("signed");
    }
    expect(await storage.getValidatedAt()).not.toBeNull();
  });

  test("refreshPaidEntitlement rejects invalid signed license keys", async () => {
    const storage = createLicenseStorage(createSettingsRepository(db));
    await storage.setLicenseKey("AOP1.invalid.payload.signature");

    const result = await refreshPaidEntitlement({
      storage,
      resolveServerUrl: async () => "https://license.example.com",
      resolveMachineId: async () => "machine-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("Invalid or expired");
    }
  });

  test("refreshPaidEntitlement validates through license server and stores lemon instance id", async () => {
    const storage = createLicenseStorage(createSettingsRepository(db));
    await storage.setLicenseKey("LS-VALID");
    await storage.setValidatedAt("2020-01-01T00:00:00.000Z");

    globalThis.fetch = mockLicenseServerValidateFetch();

    const result = await refreshPaidEntitlement({
      storage,
      resolveServerUrl: async () => "https://license.example.com",
      resolveMachineId: async () => "machine-1",
    });

    expect(result.ok).toBe(true);
    expect(await storage.getLemonInstanceId()).toBe("inst-123");
  });

  test("refreshPaidEntitlement skips remote validation when cache is still fresh", async () => {
    const storage = createLicenseStorage(createSettingsRepository(db));
    await storage.setLicenseKey("LS-FRESH");
    await storage.setEntitlementJson(
      JSON.stringify({
        plan: "pro",
        maxActiveWorkers: 4,
        expiresAt: null,
        source: "lemonsqueezy",
      }),
    );
    await storage.setValidatedAt(new Date().toISOString());

    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return Response.json({});
    }) as unknown as typeof fetch;

    const result = await refreshPaidEntitlement({
      storage,
      resolveServerUrl: async () => "https://license.example.com",
      resolveMachineId: async () => "machine-1",
    });

    expect(result.ok).toBe(true);
    expect(fetchCalls).toBe(0);
  });

  test("uses offline grace when remote validation returns an error", async () => {
    const storage = createLicenseStorage(createSettingsRepository(db));
    await storage.setLicenseKey("LS-GRACE");
    await storage.setEntitlementJson(
      JSON.stringify({
        plan: "pro",
        maxActiveWorkers: 4,
        expiresAt: null,
        source: "lemonsqueezy",
      }),
    );
    await storage.setValidatedAt(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString());

    globalThis.fetch = (async () =>
      Response.json(
        { error: "License server unavailable" },
        { status: 503 },
      )) as unknown as typeof fetch;

    const result = await refreshPaidEntitlement({
      storage,
      resolveServerUrl: async () => "https://license.example.com",
      resolveMachineId: async () => "machine-1",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entitlement.plan).toBe("pro");
    }
  });
});
