import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAuthenticatedMcpUrl,
  hasValidMcpAccess,
  mcpSecretPath,
  rotateMcpSecret,
} from "./auth.ts";
import { forgetMcpSecret } from "./secret.ts";

let home = "";
let previousHome: string | undefined;

beforeEach(() => {
  previousHome = process.env.AOP_HOME;
  home = mkdtempSync(join(tmpdir(), "aop-mcp-secret-"));
  process.env.AOP_HOME = home;
  forgetMcpSecret();
});

afterEach(() => {
  chmodSync(home, 0o700);
  rmSync(home, { recursive: true, force: true });
  if (previousHome === undefined) delete process.env.AOP_HOME;
  else process.env.AOP_HOME = previousHome;
  forgetMcpSecret();
});

const tokenOf = (sessionId: string): string =>
  new URL(createAuthenticatedMcpUrl("http://127.0.0.1:1/api/mcp", sessionId)).searchParams.get(
    "accessToken",
  ) ?? "";

/** What a new host process does first: it has no secret in memory and reads the file. */
const restartHost = (): void => forgetMcpSecret();

describe("the MCP secret", () => {
  test("is created on first use in the AOP home, readable by its owner only", () => {
    tokenOf("isess_a");

    const path = mcpSecretPath();
    expect(path).toBe(join(home, "mcp-secret"));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8").trim()).toMatch(/^[0-9a-f]{64}$/);
  });

  test("keeps a token valid across a host restart", () => {
    const token = tokenOf("isess_a");

    restartHost();

    expect(hasValidMcpAccess("isess_a", token)).toBe(true);
    expect(hasValidMcpAccess("isess_b", token)).toBe(false);
  });

  test("rotating it invalidates every token issued before, also after a restart", () => {
    const before = tokenOf("isess_a");

    rotateMcpSecret();
    const after = tokenOf("isess_a");
    restartHost();

    expect(after).not.toBe(before);
    expect(hasValidMcpAccess("isess_a", before)).toBe(false);
    expect(hasValidMcpAccess("isess_a", after)).toBe(true);
  });

  test("replaces a file that holds no secret", () => {
    writeFileSync(join(home, "mcp-secret"), "not a secret\n", { mode: 0o600 });

    const token = tokenOf("isess_a");
    restartHost();

    expect(readFileSync(mcpSecretPath(), "utf8").trim()).toMatch(/^[0-9a-f]{64}$/);
    expect(hasValidMcpAccess("isess_a", token)).toBe(true);
  });

  test("makes a secret others could read owner-only again, and keeps it", () => {
    const token = tokenOf("isess_a");
    chmodSync(mcpSecretPath(), 0o644);

    restartHost();

    expect(hasValidMcpAccess("isess_a", token)).toBe(true);
    expect(statSync(mcpSecretPath()).mode & 0o777).toBe(0o600);
  });

  test("falls back to a secret of the process when the home cannot be written", () => {
    const locked = join(home, "locked");
    mkdirSync(locked, { mode: 0o500 });
    process.env.AOP_HOME = locked;

    const token = tokenOf("isess_a");

    expect(hasValidMcpAccess("isess_a", token)).toBe(true);
    expect(() => statSync(join(locked, "mcp-secret"))).toThrow();
    chmodSync(locked, 0o700);
  });
});
