import { createHash, randomBytes } from "node:crypto";

const TOKEN_PREFIX = "aop_";

/** 256 random bits behind a fixed prefix, so a leaked token is recognizable to secret scanners. */
export const generateDeviceToken = (): string =>
  `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;

/**
 * SHA-256 is enough at rest because a token is 256 bits of randomness: there is no
 * dictionary to walk, so a slow password hash would only cost every request time.
 */
export const hashDeviceToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");
