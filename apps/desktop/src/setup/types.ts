export type SetupRequirementId = "wsl" | "git" | "github-cli" | "runtime";

export type RuntimeId = "codex" | "claude" | "opencode" | "pi";

export type SetupRequirementStatus = "ready" | "missing" | "needs-auth" | "installing" | "failed";

export interface SetupAction {
  id: string;
  label: string;
  requirementId: SetupRequirementId;
  requiresConsent: boolean;
  runtimeId?: RuntimeId;
  description?: string;
  commandPreview?: string;
  manualInstructions?: string;
  /** True when AOP cannot run this action itself (browser auth, missing tooling, WSL-only
   * installs). The UI shows instructions + re-checks instead of faking a run. */
  manual?: boolean;
}

export interface SetupRequirement {
  id: SetupRequirementId;
  status: SetupRequirementStatus;
  label: string;
  message: string;
  actions?: SetupAction[];
}

export interface RuntimeRequirement {
  id: RuntimeId;
  status: SetupRequirementStatus;
  label: string;
  message: string;
  recommended?: boolean;
}

export interface SetupProbeState {
  git: SetupRequirement;
  githubCli: SetupRequirement;
  runtimes: RuntimeRequirement[];
}

export interface SetupResolutionOptions {
  declinedRequiredSetup?: boolean;
}

export interface DesktopSetupState {
  ready: boolean;
  requirements: SetupRequirement[];
  runtimes: RuntimeRequirement[];
  blockingRequirements: Array<SetupRequirementId | "user-consent">;
  automationActions?: SetupAction[];
}
