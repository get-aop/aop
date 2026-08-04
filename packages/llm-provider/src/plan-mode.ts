export type RunMode = "execute" | "plan";

export class UnsupportedPlanModeError extends Error {
  readonly providerName: string;

  constructor(providerName: string) {
    super(`Provider "${providerName}" does not support native CLI plan mode.`);
    this.name = "UnsupportedPlanModeError";
    this.providerName = providerName;
  }
}

const PLAN_MODE_PROVIDERS = new Set(["claude-code", "codex-cli", "grok-build", "opencode"]);

export const supportsNativePlanMode = (providerName: string): boolean =>
  PLAN_MODE_PROVIDERS.has(providerName);

export const assertNativePlanModeSupported = (
  providerName: string,
  mode: RunMode | undefined,
): void => {
  if (mode === "plan" && !supportsNativePlanMode(providerName)) {
    throw new UnsupportedPlanModeError(providerName);
  }
};
