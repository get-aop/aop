import { beforeEach, describe, expect, test } from "bun:test";
import {
  buildSignedLicensePayload,
  generateLicenseSigningKeyPair,
  signLicenseKey,
} from "@aop/license";
import type { Kysely } from "kysely";
import { createAgentRepository } from "../agent/repository.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createSettingsRepository } from "../settings/repository.ts";
import { createLicenseService } from "./service.ts";
import { createLicenseStorage } from "./storage.ts";

// Ephemeral signing keypair: the production private key is never committed.
const TEST_KEYPAIR = generateLicenseSigningKeyPair();
process.env.AOP_LICENSE_PUBLIC_KEY = TEST_KEYPAIR.publicDerB64;
const DEV_PRIVATE_KEY_DER_B64 = TEST_KEYPAIR.privateDerB64;

describe("license/service", () => {
  let db: Kysely<Database>;

  beforeEach(async () => {
    db = await createTestDb();
  });

  test("defaults to free tier with six workers", async () => {
    const service = createLicenseService(
      createLicenseStorage(createSettingsRepository(db)),
      createAgentRepository(db),
    );

    expect(await service.getMaxActiveWorkers()).toBe(4);
    const status = await service.getStatus(0);
    expect(status.plan).toBe("free");
    expect(status.maxActiveWorkers).toBe(4);
  });

  test("activates a signed team license for unlimited workers", async () => {
    const service = createLicenseService(
      createLicenseStorage(createSettingsRepository(db)),
      createAgentRepository(db),
    );
    const licenseKey = signLicenseKey(
      buildSignedLicensePayload("team", null),
      DEV_PRIVATE_KEY_DER_B64,
    );

    const result = await service.activate(licenseKey);
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("expected activation to succeed");
    }

    expect(result.status.plan).toBe("team");
    expect(result.status.maxActiveWorkers).toBeNull();
    expect(await service.getMaxActiveWorkers()).toBeNull();
  });
});
