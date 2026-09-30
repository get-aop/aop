import { createHash, randomInt, timingSafeEqual } from "node:crypto";

// No I, O, 0 or 1, so a code read off one screen and typed into another survives a glance.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
const DEFAULT_TTL_MS = 10 * 60_000;

export interface PairingCodeGrant {
  /** Shown to the host owner as `XXXX-XXXX`. */
  code: string;
  expiresAt: Date;
}

export interface PairingCodes {
  /** Replaces any code that is still waiting: one pairing is open at a time. */
  issue: () => PairingCodeGrant;
  /** True at most once per issued code, and never after it expires. */
  consume: (input: string) => boolean;
}

export interface PairingCodesOptions {
  ttlMs?: number;
  now?: () => Date;
}

/**
 * Codes live in memory on purpose. They are short-lived, and a host restart should close
 * an open pairing rather than resurrect a code somebody may have photographed.
 */
export const createPairingCodes = (options: PairingCodesOptions = {}): PairingCodes => {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = options.now ?? (() => new Date());
  let pending: { digest: Buffer; expiresAt: Date } | null = null;

  return {
    issue: () => {
      const normalized = generateNormalizedCode();
      const expiresAt = new Date(now().getTime() + ttlMs);
      pending = { digest: digestOf(normalized), expiresAt };
      return { code: format(normalized), expiresAt };
    },

    consume: (input) => {
      if (!pending) return false;
      if (now() >= pending.expiresAt) {
        pending = null;
        return false;
      }
      if (!timingSafeEqual(pending.digest, digestOf(normalize(input)))) return false;
      pending = null;
      return true;
    },
  };
};

const generateNormalizedCode = (): string =>
  Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

const format = (normalized: string): string => `${normalized.slice(0, 4)}-${normalized.slice(4)}`;

const normalize = (input: string): string => input.toUpperCase().replace(/[^A-Z0-9]/g, "");

// Digests are fixed-length, so the constant-time comparison never sees mismatched sizes.
const digestOf = (normalized: string): Buffer => createHash("sha256").update(normalized).digest();
