import { randomBytes } from "node:crypto";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { getLogger } from "@aop/infra";

const logger = getLogger("mcp-secret");

const SECRET_BYTES = 32;
const SECRET_PATTERN = /^[0-9a-f]{64}$/;
const OWNER_ONLY = 0o600;

/**
 * The secret MCP URL tokens are signed with, kept in one file so it outlives the host process:
 * a run the host started keeps calling its tools after the host restarts. Created on first use,
 * readable by its owner only. Token checks are synchronous and frequent, so the secret is read
 * once per path and held. When the file cannot be read or written (a read-only home, a file
 * owned by someone else), the host signs with a secret of its own process instead, as it did
 * before the secret was kept: tokens work until the host restarts.
 */
let held: { path: string; secret: Buffer } | null = null;

export const readMcpSecret = (path: string): Buffer => {
  if (held?.path !== path) held = { path, secret: loadOrCreate(path) };
  return held.secret;
};

/** Writes a new secret over the old one; tokens signed with the old one stop matching. */
export const rotateMcpSecretFile = (path: string): void => {
  const secret = randomBytes(SECRET_BYTES);
  replaceFile(path, secret);
  held = { path, secret };
  logger.info("Rotated the MCP secret; tokens issued before no longer work");
};

/** Forgets the held secret, so the next read goes to the file again (tests simulate a restart). */
export const forgetMcpSecret = (): void => {
  held = null;
};

const loadOrCreate = (path: string): Buffer => {
  try {
    return readExisting(path) ?? createExclusive(path);
  } catch (error) {
    logger.warn(
      "Cannot keep the MCP secret in {path}: tokens will stop working when the host restarts ({error})",
      { path, error: String(error) },
    );
    return randomBytes(SECRET_BYTES);
  }
};

// Null when there is no usable secret yet. A file that holds something else is replaced: nothing
// could have been signed with it.
const readExisting = (path: string): Buffer | null => {
  let text: string;
  try {
    text = readFileSync(path, "utf8").trim();
  } catch (error) {
    if (isCode(error, "ENOENT")) return null;
    throw error;
  }
  if (!SECRET_PATTERN.test(text)) {
    logger.warn("The MCP secret in {path} is not valid; writing a new one", { path });
    const secret = randomBytes(SECRET_BYTES);
    replaceFile(path, secret);
    return secret;
  }
  keepOwnerOnly(path);
  return Buffer.from(text, "hex");
};

// Written to a file of its own and linked into place, which fails if another process got there
// first: two hosts starting together end up with one secret, and nobody reads a half-written file.
const createExclusive = (path: string): Buffer => {
  const secret = randomBytes(SECRET_BYTES);
  const staged = writeStaged(path, secret);
  try {
    linkSync(staged, path);
    return secret;
  } catch (error) {
    if (!isCode(error, "EEXIST")) throw error;
    const existing = readExisting(path);
    if (!existing) throw error;
    return existing;
  } finally {
    unlinkSync(staged);
  }
};

const replaceFile = (path: string, secret: Buffer): void => {
  renameSync(writeStaged(path, secret), path);
};

const writeStaged = (path: string, secret: Buffer): string => {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const staged = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(staged, `${secret.toString("hex")}\n`, { mode: OWNER_ONLY, flag: "wx" });
  return staged;
};

// A secret others can read lets them sign tokens; tighten a file someone loosened.
const keepOwnerOnly = (path: string): void => {
  const mode = statSync(path).mode & 0o777;
  if ((mode & 0o077) === 0) return;
  chmodSync(path, OWNER_ONLY);
  logger.warn("The MCP secret in {path} was readable by others; made it owner-only", { path });
};

const isCode = (error: unknown, code: string): boolean =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
