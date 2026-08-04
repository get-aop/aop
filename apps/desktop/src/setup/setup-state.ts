import type {
  DesktopSetupState,
  RuntimeId,
  RuntimeRequirement,
  SetupAction,
  SetupProbeState,
  SetupRequirement,
  SetupRequirementId,
  SetupResolutionOptions,
} from "./types";

const RUNTIME_REQUIREMENT: SetupRequirement = {
  id: "runtime",
  status: "missing",
  label: "Agent runtime",
  message: "Install and sign in to Codex, Claude Code, OpenCode, or Pi.",
};

const RUNTIME_LABELS: Record<RuntimeId, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  pi: "Pi",
};

export const resolveSetupState = (
  probe: SetupProbeState,
  options: SetupResolutionOptions = {},
): DesktopSetupState => {
  const runtimeRequirement = resolveRuntimeRequirement(probe.runtimes);
  const requirements = [probe.git, probe.githubCli, runtimeRequirement];
  const blockingRequirements = resolveBlockingRequirements(requirements, options);

  return {
    ready: blockingRequirements.length === 0,
    requirements,
    runtimes: probe.runtimes,
    blockingRequirements,
  };
};

export const shouldEnterDashboard = (state: DesktopSetupState): boolean => state.ready;

export const getRecommendedRuntimeAction = (state: DesktopSetupState): SetupAction | null => {
  if (state.runtimes.some((runtime) => runtime.status === "ready")) {
    return null;
  }

  const runtime = state.runtimes.find((candidate) => candidate.recommended) ?? state.runtimes[0];
  if (!runtime) return null;

  return buildRuntimeInstallAction(runtime.id);
};

const resolveRuntimeRequirement = (runtimes: RuntimeRequirement[]): SetupRequirement => {
  if (runtimes.some((runtime) => runtime.status === "ready")) {
    return {
      ...RUNTIME_REQUIREMENT,
      status: "ready",
      message: "At least one supported coding runtime is installed.",
    };
  }

  return {
    ...RUNTIME_REQUIREMENT,
    actions: runtimes.map((runtime) => buildRuntimeInstallAction(runtime.id)),
  };
};

const resolveBlockingRequirements = (
  requirements: SetupRequirement[],
  options: SetupResolutionOptions,
): Array<SetupRequirementId | "user-consent"> => {
  const blocking: Array<SetupRequirementId | "user-consent"> = requirements
    .filter((requirement) => requirement.id !== "github-cli" && requirement.status !== "ready")
    .map((requirement) => requirement.id);

  if (options.declinedRequiredSetup) {
    blocking.push("user-consent");
  }

  return blocking;
};

const buildRuntimeInstallAction = (runtimeId: RuntimeId): SetupAction => ({
  id: `install-runtime-${runtimeId}`,
  label: `Install ${RUNTIME_LABELS[runtimeId]}`,
  requirementId: "runtime",
  requiresConsent: false,
  runtimeId,
});
