#!/usr/bin/env bun
import { buildSignedLicensePayload, type LicensePlan, signLicenseKey } from "@aop/license";

const USAGE = `Usage:
  bun run license:issue -- --plan <pro|team> [--days <positive-integer>]

Examples:
  bun run license:issue -- --plan team
  bun run license:issue -- --plan pro --days 365
`;

const fail = (message: string): never => {
  process.stderr.write(`Error: ${message}\n\n${USAGE}`);
  process.exit(1);
};

const readArg = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
};

const readSigningPrivateKey = (): string => {
  const privateKeyDerB64 = process.env.LICENSE_SIGNING_PRIVATE_KEY?.trim();
  if (privateKeyDerB64) {
    return privateKeyDerB64;
  }
  return fail(
    "LICENSE_SIGNING_PRIVATE_KEY is required. Generate a keypair with `bun run license:keygen`, then keep only the private key in your secret manager.",
  );
};

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const planArg = readArg("--plan");
if (planArg !== "pro" && planArg !== "team") {
  fail("--plan must be either pro or team");
}

const daysArg = readArg("--days");
const signingPrivateKeyDerB64 = readSigningPrivateKey();

const parseExpiresAt = (days: string | undefined): string | null => {
  if (days === undefined) {
    return null;
  }

  if (!/^[1-9]\d*$/u.test(days)) {
    fail("--days must be a positive integer");
  }

  return new Date(Date.now() + Number.parseInt(days, 10) * 86_400_000).toISOString();
};

const expiresAt = parseExpiresAt(daysArg);

const payload = buildSignedLicensePayload(planArg as Exclude<LicensePlan, "free">, expiresAt);
const licenseKey = signLicenseKey(payload, signingPrivateKeyDerB64);
process.stdout.write(`${licenseKey}\n`);
