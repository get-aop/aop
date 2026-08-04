import { createHash } from "node:crypto";
import { hostname } from "node:os";

/** Stable per-machine id for license activation (no account required). */
export const getMachineId = (): string => {
  const seed = [hostname(), process.env.USER ?? "", process.env.HOME ?? ""].join("|");
  return createHash("sha256").update(seed).digest("hex").slice(0, 32);
};
