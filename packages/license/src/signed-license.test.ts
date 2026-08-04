import { describe, expect, test } from "bun:test";
import { generateLicenseSigningKeyPair } from "./keygen.ts";
import {
  buildSignedLicensePayload,
  signLicenseKey,
  verifySignedLicenseKey,
} from "./signed-license.ts";

// Tests sign with an ephemeral keypair; the production private key is never
// in the repo. The env override routes verification to the ephemeral pair.
const TEST_KEYPAIR = generateLicenseSigningKeyPair();
process.env.AOP_LICENSE_PUBLIC_KEY = TEST_KEYPAIR.publicDerB64;
const DEV_PRIVATE_KEY_DER_B64 = TEST_KEYPAIR.privateDerB64;

describe("signed-license", () => {
  test("signs and verifies a team license key", () => {
    const payload = buildSignedLicensePayload("team", null);
    const key = signLicenseKey(payload, DEV_PRIVATE_KEY_DER_B64);
    const entitlement = verifySignedLicenseKey(key);

    expect(entitlement).toEqual({
      plan: "team",
      maxActiveWorkers: null,
      expiresAt: null,
      licenseKeyLast4: key.slice(-4),
      source: "signed",
    });
  });

  test("rejects expired license keys", () => {
    const payload = buildSignedLicensePayload("pro", "2020-01-01T00:00:00.000Z");
    const key = signLicenseKey(payload, DEV_PRIVATE_KEY_DER_B64);
    expect(verifySignedLicenseKey(key)).toBeNull();
  });
});
