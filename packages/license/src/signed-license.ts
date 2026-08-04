import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { z } from "zod";
import type { LicensePlan } from "./plans.ts";
import { LicensePlanSchema, resolveMaxActiveWorkers } from "./plans.ts";
import { EMBEDDED_LICENSE_PUBLIC_KEY_DER_B64 } from "./signing-public-key.ts";
import type { LicenseEntitlement } from "./types.ts";

const LICENSE_PREFIX = "AOP1";

const SignedLicensePayloadSchema = z.object({
  v: z.literal(1),
  plan: LicensePlanSchema.exclude(["free"]),
  exp: z.string().datetime().nullable(),
  iat: z.string().datetime(),
});

export type SignedLicensePayload = z.infer<typeof SignedLicensePayloadSchema>;

const toBase64Url = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");

const fromBase64Url = (value: string): Buffer => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + "=".repeat(padLength), "base64");
};

export const isSignedLicenseKey = (licenseKey: string): boolean =>
  licenseKey.trim().startsWith(`${LICENSE_PREFIX}.`);

export const resolveLicensePublicKeyDer = (): Buffer => {
  const override = process.env.AOP_LICENSE_PUBLIC_KEY?.trim();
  const derB64 = override && override.length > 0 ? override : EMBEDDED_LICENSE_PUBLIC_KEY_DER_B64;
  return Buffer.from(derB64, "base64");
};

export const signLicenseKey = (payload: SignedLicensePayload, privateKeyDerB64: string): string => {
  const privateKey = createPrivateKey({
    format: "der",
    type: "pkcs8",
    key: Buffer.from(privateKeyDerB64, "base64"),
  });
  const payloadBytes = Buffer.from(JSON.stringify(payload), "utf8");
  const signature = sign(null, payloadBytes, privateKey);
  return `${LICENSE_PREFIX}.${toBase64Url(payloadBytes)}.${toBase64Url(signature)}`;
};

const decodeSignedLicensePayload = (
  licenseKey: string,
): { payloadBytes: Buffer; trimmed: string } | null => {
  const trimmed = licenseKey.trim();
  if (!isSignedLicenseKey(trimmed)) {
    return null;
  }

  const parts = trimmed.split(".");
  if (parts.length !== 3 || parts[0] !== LICENSE_PREFIX) {
    return null;
  }

  const payloadPart = parts[1];
  const signaturePart = parts[2];
  if (!payloadPart || !signaturePart) {
    return null;
  }

  const payloadBytes = fromBase64Url(payloadPart);
  const signatureBytes = fromBase64Url(signaturePart);
  const publicKey = createPublicKey({
    format: "der",
    type: "spki",
    key: resolveLicensePublicKeyDer(),
  });

  const valid = verify(null, payloadBytes, publicKey, signatureBytes);
  if (!valid) {
    return null;
  }

  return { payloadBytes, trimmed };
};

export const verifySignedLicenseKey = (licenseKey: string): LicenseEntitlement | null => {
  const decoded = decodeSignedLicensePayload(licenseKey);
  if (!decoded) {
    return null;
  }

  const parsed = SignedLicensePayloadSchema.safeParse(
    JSON.parse(decoded.payloadBytes.toString("utf8")),
  );
  if (!parsed.success) {
    return null;
  }

  if (parsed.data.exp) {
    const expiresAt = new Date(parsed.data.exp);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      return null;
    }
  }

  return entitlementFromSignedPayload(parsed.data, decoded.trimmed);
};

const entitlementFromSignedPayload = (
  payload: SignedLicensePayload,
  licenseKey: string,
): LicenseEntitlement => ({
  plan: payload.plan,
  maxActiveWorkers: resolveMaxActiveWorkers(payload.plan),
  expiresAt: payload.exp,
  licenseKeyLast4: licenseKey.slice(-4),
  source: "signed",
});

export const buildSignedLicensePayload = (
  plan: Exclude<LicensePlan, "free">,
  expiresAt: string | null,
): SignedLicensePayload => ({
  v: 1,
  plan,
  exp: expiresAt,
  iat: new Date().toISOString(),
});
