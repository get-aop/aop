/**
 * Ed25519 public key (SPKI DER, base64) for verifying AOP1 license keys in OSS builds.
 * The private half lives only in the LICENSE_SIGNING_PRIVATE_KEY secret — it must
 * never be committed, including in test fixtures (tests generate ephemeral pairs).
 */
export const EMBEDDED_LICENSE_PUBLIC_KEY_DER_B64 =
  "MCowBQYDK2VwAyEA6fbtq3AKcRk2zrGLn/5tuC73D1P9fRB+0gBDRC5JO8s=";
