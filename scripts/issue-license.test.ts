import { describe, expect, test } from "bun:test";
import { generateLicenseSigningKeyPair, verifySignedLicenseKey } from "@aop/license";

const ISSUE_LICENSE_SCRIPT = "./scripts/issue-license.ts";

const runIssueLicense = (options: { args: string[]; env?: Record<string, string | undefined> }) => {
  const proc = Bun.spawnSync({
    cmd: ["bun", "run", ISSUE_LICENSE_SCRIPT, ...options.args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      LICENSE_SIGNING_PRIVATE_KEY: undefined,
      AOP_LICENSE_PUBLIC_KEY: undefined,
      ...options.env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
};

describe("issue-license", () => {
  test("prints a helpful error when the signing private key is missing", () => {
    const result = runIssueLicense({ args: ["--plan", "team"] });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("LICENSE_SIGNING_PRIVATE_KEY is required");
    expect(result.stderr).toContain("bun run license:keygen");
    expect(result.stdout).toBe("");
  });

  test("issues a signed team key that verifies as unlimited", () => {
    const keypair = generateLicenseSigningKeyPair();
    const result = runIssueLicense({
      args: ["--plan", "team"],
      env: {
        LICENSE_SIGNING_PRIVATE_KEY: keypair.privateDerB64,
        AOP_LICENSE_PUBLIC_KEY: keypair.publicDerB64,
      },
    });

    process.env.AOP_LICENSE_PUBLIC_KEY = keypair.publicDerB64;
    const entitlement = verifySignedLicenseKey(result.stdout.trim());
    delete process.env.AOP_LICENSE_PUBLIC_KEY;

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim().startsWith("AOP1.")).toBe(true);
    expect(entitlement?.plan).toBe("team");
    expect(entitlement?.maxActiveWorkers).toBeNull();
  });

  test("rejects invalid expiration day counts before signing", () => {
    const keypair = generateLicenseSigningKeyPair();
    const result = runIssueLicense({
      args: ["--plan", "team", "--days", "forever"],
      env: { LICENSE_SIGNING_PRIVATE_KEY: keypair.privateDerB64 },
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--days must be a positive integer");
    expect(result.stdout).toBe("");
  });
});
