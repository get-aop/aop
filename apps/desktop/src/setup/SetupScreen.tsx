import type { CSSProperties, ReactElement } from "react";
import { useEffect, useRef, useState } from "react";
import type { DesktopBackend } from "../backend/types";
import { type ConsentConfig, ConsentModal } from "./ConsentModal";
import { ExecHostMenu } from "./ExecHostMenu";
import { FinishCard } from "./FinishCard";
import { FinishedOverlay } from "./FinishedOverlay";
import {
  ArrowIcon,
  CheckIcon,
  GithubIcon,
  GitIcon,
  InstallGlyph,
  ReRunIcon,
  SpinnerIcon,
} from "./icons";
import { ProgressRing } from "./ProgressRing";
import type { TerminalLine } from "./parts";
import { type RequirementAction, RequirementCard } from "./RequirementCard";
import { type AgentTileProps, RuntimeCard, type RuntimeCardProps } from "./RuntimeCard";
import type { UiStatus } from "./setup-ui";
import { Toast } from "./Toast";
import { TopBar } from "./TopBar";
import type {
  DesktopSetupState,
  RuntimeId,
  RuntimeRequirement,
  SetupAction,
  SetupRequirement,
  SetupRequirementId,
  SetupRequirementStatus,
} from "./types";
import { useSetupTheme } from "./useSetupTheme";

/** Static agent metadata; commands/descriptions mirror the Rust installer registry. */
const AGENT_META: Record<RuntimeId, { name: string; tagline: string }> = {
  codex: { name: "Codex", tagline: "OpenAI" },
  claude: { name: "Claude Code", tagline: "Anthropic" },
  opencode: { name: "OpenCode", tagline: "Open source" },
  pi: { name: "Pi", tagline: "Pi.dev" },
};

const RUNTIME_IDS: RuntimeId[] = ["codex", "claude", "opencode", "pi"];

interface InstallState {
  which: string;
  lines: TerminalLine[];
}

type ToastTone = "ok" | "bad";

interface ToastState {
  message: string;
  tone: ToastTone;
}

interface SetupScreenProps {
  state: DesktopSetupState;
  appVersion: string;
  backend: DesktopBackend;
  onReScan: () => Promise<void>;
  onRunAction: (actionId: string) => Promise<void>;
  onOpenDashboard: () => Promise<void>;
  onOpenLogs: () => Promise<void>;
  onDeclineRequiredSetup: () => void;
}

export const SetupScreen = (props: SetupScreenProps): ReactElement => {
  const { state, appVersion, backend, onDeclineRequiredSetup, onOpenLogs } = props;
  const orchestration = useSetupOrchestration(props);
  const { theme, toggleTheme, scanning, install, consent, finished, dashboardError, toast } =
    orchestration;

  const wslReq = findRequirement(state, "wsl");
  const gitReq = findRequirement(state, "git");
  const githubReq = findRequirement(state, "github-cli");
  const runtimeReq = findRequirement(state, "runtime");
  const wslBlocked = wslReq !== undefined && wslReq.status !== "ready";
  const done = !wslBlocked && state.ready;
  const readyCount = wslBlocked ? 0 : readyCountOf(gitReq, githubReq, runtimeReq);
  const allChecksReady = readyCount === 3;

  const coreCards = buildCoreCards({
    gitReq,
    githubReq,
    scanning,
    install,
    openConsent: orchestration.openConsent,
  });
  const runtimeCardProps = buildRuntimeCard({
    runtimeReq,
    runtimes: state.runtimes,
    scanning,
    install,
    selectedRuntime: orchestration.selectedRuntime,
    pickerOverride: orchestration.pickerOverride,
    onSelectRuntime: orchestration.setSelectedRuntime,
    onInstall: orchestration.handleInstallRuntime,
    onChange: orchestration.showPicker,
  });

  return (
    <div data-theme={theme} style={rootStyle}>
      <TopBar version={appVersion} theme={theme} onToggleTheme={toggleTheme}>
        <ExecHostMenu backend={backend} onChanged={() => void orchestration.handleReScan()} />
      </TopBar>

      <div className="aop-scroll" style={contentScrollStyle}>
        <div style={contentInnerStyle}>
          <Hero
            done={done}
            scanning={scanning}
            readyCount={readyCount}
            title={heroTitle(done)}
            subtitle={heroSubtitle(done, allChecksReady)}
            segments={segmentsFor(gitReq, githubReq, runtimeReq)}
            onReRun={() => void orchestration.handleReScan()}
          />

          <RequirementsHeader />

          <SetupRequirements
            wslRequirement={wslReq}
            wslBlocked={wslBlocked}
            coreCards={coreCards}
            runtimeCardProps={runtimeCardProps}
            scanning={scanning}
            onReScan={orchestration.handleReScan}
          />

          {!wslBlocked && (state.automationActions?.length ?? 0) > 0 ? (
            <AutomationTools
              actions={state.automationActions ?? []}
              install={install}
              onSelect={orchestration.openConsent}
            />
          ) : null}

          <FinishCard
            done={done}
            finishTitle={done ? "You're ready to go" : "Almost there"}
            finishNote={finishNoteFor(done, 3 - readyCount, allChecksReady)}
            onQuit={onDeclineRequiredSetup}
            onOpenDashboard={() => void orchestration.handleOpenDashboard()}
          />

          <div style={privacyNoteStyle}>
            AOP runs locally · your code and credentials never leave your machine
          </div>
        </div>
      </div>

      <Overlays
        consent={consent}
        finished={finished}
        dashboardError={dashboardError}
        toast={toast}
        onCancelConsent={() => orchestration.setConsent(null)}
        onApproveConsent={() => void orchestration.handleApprove()}
        onBackFromOverlay={() => orchestration.clearFinished()}
        onOpenLogs={onOpenLogs}
      />
    </div>
  );
};

interface SetupRequirementsProps {
  wslRequirement: SetupRequirement | undefined;
  wslBlocked: boolean;
  coreCards: ReturnType<typeof buildCoreCards>;
  runtimeCardProps: RuntimeCardProps;
  scanning: boolean;
  onReScan: () => Promise<void>;
}

const SetupRequirements = ({
  wslRequirement,
  wslBlocked,
  coreCards,
  runtimeCardProps,
  scanning,
  onReScan,
}: SetupRequirementsProps): ReactElement => (
  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    {wslRequirement ? (
      <RequirementCard
        label={wslRequirement.label}
        icon={<InstallGlyph />}
        iconTint="var(--teal)"
        status={wslRequirement.status}
        message={wslRequirement.message}
        action={
          wslBlocked
            ? {
                label: "Check again",
                icon: <ReRunIcon />,
                onClick: () => void onReScan(),
              }
            : null
        }
        installing={scanning}
        installLines={[]}
      />
    ) : null}
    {wslBlocked
      ? null
      : coreCards.map((card) => <RequirementCard key={card.key} {...card.props} />)}
    {wslBlocked ? null : <RuntimeCard {...runtimeCardProps} />}
  </div>
);

const AutomationTools = ({
  actions,
  install,
  onSelect,
}: {
  actions: SetupAction[];
  install: InstallState | null;
  onSelect: (action: SetupAction) => void;
}): ReactElement => (
  <section style={{ marginTop: 30 }}>
    <div
      style={{
        font: "600 11px 'Geist Mono'",
        letterSpacing: ".18em",
        color: "var(--subtle)",
        marginBottom: 14,
      }}
    >
      AUTOMATION TOOLS · OPTIONAL
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {actions.map((action) => (
        <RequirementCard
          key={action.id}
          label={action.label}
          icon={<InstallGlyph />}
          iconTint="var(--teal)"
          status="ready"
          message={
            action.description ?? action.manualInstructions ?? "Optional runtime integration."
          }
          action={{
            label: action.label,
            icon: <InstallGlyph />,
            onClick: () => onSelect(action),
          }}
          installing={install?.which === installKey(action)}
          installLines={installLinesForCard(install, installKey(action))}
        />
      ))}
    </div>
  </section>
);

const useSetupOrchestration = (props: SetupScreenProps) => {
  const { state, backend, onReScan, onRunAction, onOpenDashboard } = props;
  const { theme, toggleTheme } = useSetupTheme();
  const [scanning, setScanning] = useState(false);
  const [install, setInstall] = useState<InstallState | null>(null);
  const [consent, setConsent] = useState<SetupAction | null>(null);
  const [pickerOverride, setPickerOverride] = useState(false);
  const [selectedRuntime, setSelectedRuntime] = useState<RuntimeId>(() => initialRuntime(state));
  const [finished, setFinished] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (message: string, tone: ToastTone = "ok") => {
    setToast({ message, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  };

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const handleReScan = async () => {
    if (scanning || install) return;
    setScanning(true);
    try {
      await onReScan();
    } finally {
      setScanning(false);
    }
  };

  const runDirectAction = async (action: SetupAction) => {
    try {
      await backend.openSetupGuide(action.id);
      showToast("Opened installation guide");
    } catch {
      showToast("Could not open installation guide", "bad");
    }
  };

  const openConsent = (action: SetupAction) => {
    if (install) {
      showToast("Finish the current step first", "bad");
      return;
    }
    if (!action.requiresConsent) {
      void runDirectAction(action);
      return;
    }
    setConsent(action);
  };

  const handleApprove = async () => {
    const action = consent;
    setConsent(null);
    if (!action) return;

    // Manual actions (browser auth, missing tooling, WSL-only installs) are steps AOP can't
    // run itself — don't fake an install. Just re-probe so the new state speaks for itself.
    if (action.manual) {
      try {
        await onRunAction(action.id);
        showToast("Re-checked setup");
      } catch {
        showToast("Re-check failed — try again", "bad");
      }
      return;
    }

    setInstall({ which: installKey(action), lines: installLinesFor(action) });
    try {
      await onRunAction(action.id);
      showToast(successToast(action));
    } catch {
      // The dashboard stays gated; surface the failure without leaving setup.
      showToast("Setup action failed — try again", "bad");
    } finally {
      setInstall(null);
    }
  };

  const runtimeReq = findRequirement(state, "runtime");
  const handleInstallRuntime = () => {
    const action =
      runtimeReq?.actions?.find((candidate) => candidate.runtimeId === selectedRuntime) ??
      runtimeActionFor(selectedRuntime);
    if (selectedRuntimeIsReady(state.runtimes, selectedRuntime)) {
      setPickerOverride(false);
      showToast(`${AGENT_META[selectedRuntime].name} selected`);
      return;
    }
    openConsent(action);
  };

  const handleOpenDashboard = async () => {
    if (!state.ready || finished) return;
    setDashboardError(null);
    setFinished(true);
    try {
      await onOpenDashboard();
    } catch (error) {
      setFinished(false);
      setDashboardError(errorMessage(error));
    }
  };

  return {
    theme,
    toggleTheme,
    scanning,
    install,
    consent,
    pickerOverride,
    selectedRuntime,
    setSelectedRuntime,
    finished,
    dashboardError,
    toast,
    setConsent,
    showPicker: () => setPickerOverride(true),
    clearFinished: () => {
      setFinished(false);
      setDashboardError(null);
    },
    handleReScan,
    handleApprove,
    openConsent,
    handleInstallRuntime,
    handleOpenDashboard,
  };
};

interface HeroProps {
  done: boolean;
  scanning: boolean;
  readyCount: number;
  title: string;
  subtitle: string;
  segments: [string, string, string];
  onReRun: () => void;
}

const Hero = ({
  done,
  scanning,
  readyCount,
  title,
  subtitle,
  segments,
  onReRun,
}: HeroProps): ReactElement => (
  <div style={{ display: "flex", alignItems: "center", gap: 28, flexWrap: "wrap" }}>
    <div style={{ flex: 1, minWidth: 290 }}>
      <div style={{ font: "600 11px 'Geist Mono'", letterSpacing: ".2em", color: "var(--subtle)" }}>
        DESKTOP SETUP
      </div>
      <h1 style={heroTitleStyle}>{title}</h1>
      <p style={heroSubtitleStyle}>{subtitle}</p>
      <HeroActions done={done} scanning={scanning} readyCount={readyCount} onReRun={onReRun} />
    </div>
    <ProgressRing segments={segments} center={ringCenter(done, readyCount)} />
  </div>
);

interface HeroActionsProps {
  done: boolean;
  scanning: boolean;
  readyCount: number;
  onReRun: () => void;
}

const HeroActions = ({
  done,
  scanning,
  readyCount,
  onReRun,
}: HeroActionsProps): ReactElement | null => {
  if (scanning) {
    return (
      <div style={heroActionsStyle}>
        <button type="button" disabled style={scanningButtonStyle}>
          <SpinnerIcon />
          Checking your machine…
        </button>
      </div>
    );
  }
  if (done) return null;
  return (
    <div style={heroActionsStyle}>
      <button type="button" onClick={onReRun} className="aop-h" style={secondaryButtonStyle}>
        <ReRunIcon />
        Re-run checks
      </button>
      <span style={{ font: "600 12.5px 'Geist Mono'", color: "var(--subtle)" }}>
        {readyCount} of 3 ready
      </span>
    </div>
  );
};

const RequirementsHeader = (): ReactElement => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      margin: "32px 0 14px",
    }}
  >
    <div style={{ font: "600 11px 'Geist Mono'", letterSpacing: ".18em", color: "var(--subtle)" }}>
      REQUIREMENTS
    </div>
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        fontSize: 12,
        color: "var(--subtle)",
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--teal)"
        strokeWidth="1.7"
        aria-hidden="true"
      >
        <path d="M12 3l7 2.5v5.5c0 4.3-3 7-7 8.5-4-1.5-7-4.2-7-8.5V5.5z" />
        <path d="M9 12l2 2 4-4.5" />
      </svg>
      Nothing runs without your approval
    </div>
  </div>
);

interface OverlaysProps {
  consent: SetupAction | null;
  finished: boolean;
  dashboardError: string | null;
  toast: ToastState | null;
  onCancelConsent: () => void;
  onApproveConsent: () => void;
  onBackFromOverlay: () => void;
  onOpenLogs: () => Promise<void>;
}

const Overlays = ({
  consent,
  finished,
  dashboardError,
  toast,
  onCancelConsent,
  onApproveConsent,
  onBackFromOverlay,
  onOpenLogs,
}: OverlaysProps): ReactElement => (
  <>
    <ConsentModal
      consent={consent ? consentConfigFor(consent) : null}
      onCancel={onCancelConsent}
      onApprove={onApproveConsent}
    />
    {finished ? (
      <FinishedOverlay
        onBack={onBackFromOverlay}
        error={
          dashboardError ? { message: dashboardError, onOpenLogs: () => void onOpenLogs() } : null
        }
      />
    ) : null}
    <Toast message={toast?.message ?? null} tone={toast?.tone} />
  </>
);

interface CoreCardBuildInput {
  gitReq: SetupRequirement | undefined;
  githubReq: SetupRequirement | undefined;
  scanning: boolean;
  install: InstallState | null;
  openConsent: (action: SetupAction) => void;
}

interface BuiltCoreCard {
  key: string;
  props: {
    label: string;
    icon: ReactElement;
    iconTint: string;
    status: UiStatus;
    message: string;
    action: RequirementAction | null;
    installing: boolean;
    installLines: TerminalLine[];
  };
}

const buildCoreCards = (input: CoreCardBuildInput): BuiltCoreCard[] => [
  {
    key: "git",
    props: {
      label: "Git",
      icon: <GitIcon />,
      iconTint: "var(--teal)",
      status: uiStatus(input.gitReq?.status, input.scanning),
      message: input.gitReq?.message ?? "",
      action: coreAction(input.gitReq, input.openConsent, <InstallGlyph />),
      installing: input.install?.which === "git",
      installLines: installLinesForCard(input.install, "git"),
    },
  },
  {
    key: "github",
    props: {
      label: "GitHub CLI",
      icon: <GithubIcon />,
      iconTint: "var(--sky)",
      status: uiStatus(input.githubReq?.status, input.scanning),
      message: input.githubReq?.message ?? "",
      action: coreAction(input.githubReq, input.openConsent, githubActionIcon(input.githubReq)),
      installing: input.install?.which === "github",
      installLines: installLinesForCard(input.install, "github"),
    },
  },
];

const installLinesForCard = (install: InstallState | null, key: string): TerminalLine[] =>
  install?.which === key ? install.lines : [];

const coreAction = (
  requirement: SetupRequirement | undefined,
  openConsent: (action: SetupAction) => void,
  icon: ReactElement,
): RequirementAction | null => {
  const action = requirement?.actions?.[0];
  if (!action) return null;
  return { label: action.label, icon, onClick: () => openConsent(action) };
};

const githubActionIcon = (requirement: SetupRequirement | undefined): ReactElement =>
  requirement?.actions?.[0]?.id === "auth-github-cli" ? <ArrowIcon /> : <InstallGlyph />;

interface RuntimeCardBuildInput {
  runtimeReq: SetupRequirement | undefined;
  runtimes: RuntimeRequirement[];
  scanning: boolean;
  install: InstallState | null;
  selectedRuntime: RuntimeId;
  pickerOverride: boolean;
  onSelectRuntime: (id: RuntimeId) => void;
  onInstall: () => void;
  onChange: () => void;
}

const buildRuntimeCard = (input: RuntimeCardBuildInput): RuntimeCardProps => {
  const ready = input.runtimeReq?.status === "ready";
  const installing = isRuntimeInstall(input.install);
  const recommendedId = input.runtimes.find((runtime) => runtime.recommended)?.id ?? "codex";
  const readyName = readyRuntimeName(input.runtimes);

  return {
    status: runtimeStatus(ready, input.scanning),
    message: runtimeMessage(ready, input.scanning, readyName),
    agents: RUNTIME_IDS.map((id) =>
      buildAgentTile(
        id,
        input.runtimes,
        input.selectedRuntime,
        recommendedId,
        input.onSelectRuntime,
      ),
    ),
    selectedName: AGENT_META[input.selectedRuntime].name,
    installLabel: runtimeInstallLabel(input.runtimes, input.selectedRuntime),
    onInstall: input.onInstall,
    confirm: ready && !input.pickerOverride,
    showPicker: (!ready || input.pickerOverride) && !installing,
    onChange: input.onChange,
    installing,
    installLines: installing ? (input.install?.lines ?? []) : [],
  };
};

const buildAgentTile = (
  id: RuntimeId,
  runtimes: RuntimeRequirement[],
  selectedRuntime: RuntimeId,
  recommendedId: RuntimeId,
  onSelect: (id: RuntimeId) => void,
): AgentTileProps => {
  const runtime = runtimes.find((candidate) => candidate.id === id);
  const agentReady = runtime?.status === "ready";
  const selectedActive = selectedRuntime === id && !agentReady;
  return {
    id,
    name: AGENT_META[id].name,
    tagline: AGENT_META[id].tagline,
    tint: runtimeTint(id),
    recommended: recommendedId === id,
    ready: agentReady,
    selectedActive,
    statusLabel: agentStatusLabel(agentReady, recommendedId === id),
    statusFg: agentStatusFg(agentReady, selectedActive),
    onSelect: () => onSelect(id),
  };
};

const agentStatusLabel = (ready: boolean, recommended: boolean): string => {
  if (ready) return "Installed";
  return recommended ? "Recommended" : "Available";
};

const agentStatusFg = (ready: boolean, selectedActive: boolean): string => {
  if (ready) return "var(--ok)";
  return selectedActive ? "var(--teal)" : "var(--subtle)";
};

const runtimeStatus = (ready: boolean, scanning: boolean): UiStatus => {
  if (scanning) return "checking";
  return ready ? "ready" : "missing";
};

const runtimeMessage = (ready: boolean, scanning: boolean, readyName: string): string => {
  if (ready) return `${readyName} is installed and signed in.`;
  if (scanning) return "Looking for an installed agent…";
  return "Install and sign in to one — you only need a single agent.";
};

const readyRuntimeName = (runtimes: RuntimeRequirement[]): string => {
  const readyId = runtimes.find((runtime) => runtime.status === "ready")?.id;
  return readyId ? AGENT_META[readyId].name : "";
};

const runtimeInstallLabel = (
  runtimes: RuntimeRequirement[],
  selectedRuntime: RuntimeId,
): string => {
  const name = AGENT_META[selectedRuntime].name;
  return selectedRuntimeIsReady(runtimes, selectedRuntime) ? `Use ${name}` : `Install ${name}`;
};

const ringCenter = (done: boolean, readyCount: number): ReactElement => {
  if (done) {
    return (
      <span className="aop-pop" style={{ color: "var(--ok)", display: "inline-flex" }}>
        <CheckIcon size={40} strokeWidth={2.6} />
      </span>
    );
  }
  return (
    <span>
      <span style={{ font: "600 34px 'Jura',sans-serif", display: "block", lineHeight: 1 }}>
        {readyCount}
      </span>
      <span
        style={{ font: "600 11px 'Geist Mono'", color: "var(--subtle)", letterSpacing: ".08em" }}
      >
        OF 3
      </span>
    </span>
  );
};

const readyCountOf = (
  gitReq: SetupRequirement | undefined,
  githubReq: SetupRequirement | undefined,
  runtimeReq: SetupRequirement | undefined,
): number =>
  [gitReq?.status, githubReq?.status, runtimeReq?.status].filter((status) => status === "ready")
    .length;

const segmentsFor = (
  gitReq: SetupRequirement | undefined,
  githubReq: SetupRequirement | undefined,
  runtimeReq: SetupRequirement | undefined,
): [string, string, string] => [
  gitReq?.status === "ready" ? "var(--ok)" : "var(--border)",
  githubReq?.status === "ready" ? "var(--ok)" : "var(--border)",
  runtimeReq?.status === "ready" ? "var(--ok)" : "var(--border)",
];

const heroTitle = (done: boolean): string => (done ? "You're all set" : "Let's get AOP ready");

const heroSubtitle = (done: boolean, allChecksReady: boolean): string => {
  if (!done)
    return "AOP runs local coding agents on your machine. Three quick checks, then you're in.";
  if (allChecksReady) return "All three checks passed. Your workers are ready to run.";
  return "Required checks passed. GitHub sign-in is optional and can be completed later.";
};

const finishNoteFor = (done: boolean, remaining: number, allChecksReady: boolean): string => {
  if (done && allChecksReady) return "Everything checks out — jump into your workspace.";
  if (done) return "AOP is ready. Sign in to GitHub later to enable pull-request actions.";
  if (remaining === 1) return "1 check left before you can open the dashboard.";
  return `${remaining} checks left before you can open the dashboard.`;
};

const findRequirement = (
  state: DesktopSetupState,
  id: SetupRequirementId,
): SetupRequirement | undefined => state.requirements.find((requirement) => requirement.id === id);

const uiStatus = (status: SetupRequirementStatus | undefined, scanning: boolean): UiStatus => {
  if (scanning) return "checking";
  if (!status) return "unknown";
  return status;
};

const isRuntimeInstall = (install: InstallState | null): boolean =>
  install?.which !== undefined && isRuntimeId(install.which);

const selectedRuntimeIsReady = (runtimes: RuntimeRequirement[], id: RuntimeId): boolean =>
  runtimes.find((runtime) => runtime.id === id)?.status === "ready";

const initialRuntime = (state: DesktopSetupState): RuntimeId => {
  const ready = state.runtimes.find((runtime) => runtime.status === "ready")?.id;
  if (ready) return ready;
  return state.runtimes.find((runtime) => runtime.recommended)?.id ?? "codex";
};

const runtimeTint = (id: RuntimeId): string =>
  id === "codex"
    ? "var(--teal)"
    : id === "claude"
      ? "var(--amber)"
      : id === "opencode"
        ? "var(--lav)"
        : "var(--bad)";

const isRuntimeId = (key: string): boolean =>
  key === "codex" || key === "claude" || key === "opencode" || key === "pi";

const installKey = (action: SetupAction): string => {
  if (action.runtimeId) return action.runtimeId;
  if (action.requirementId === "github-cli") return "github";
  return action.requirementId;
};

const targetFor = (action: SetupAction): string => {
  if (action.runtimeId) return AGENT_META[action.runtimeId].name;
  if (action.requirementId === "git") return "Git";
  if (action.requirementId === "github-cli") return "GitHub CLI";
  return action.label;
};

const verbFor = (action: SetupAction): string =>
  action.id === "auth-github-cli" ? "sign in to" : "install";

const workingPhrase = (action: SetupAction): string => {
  if (action.runtimeId) return `Installing ${AGENT_META[action.runtimeId].name}`;
  if (action.id === "auth-github-cli") return "Signing in to GitHub";
  if (action.id === "install-github-cli") return "Installing GitHub CLI";
  if (action.id === "install-git") return "Installing Git";
  return action.label;
};

const successToast = (action: SetupAction): string => {
  if (action.runtimeId) return `${AGENT_META[action.runtimeId].name} is ready`;
  if (action.id === "auth-github-cli" || action.id === "install-github-cli") {
    return "GitHub CLI authenticated";
  }
  if (action.id === "install-git") return "Git installed";
  return "Done";
};

const installLinesFor = (action: SetupAction): TerminalLine[] => [
  { text: `$ ${action.commandPreview ?? action.manualInstructions ?? ""}` },
  { text: `› ${workingPhrase(action)}…` },
];

const consentConfigFor = (action: SetupAction): ConsentConfig => ({
  target: targetFor(action),
  verb: verbFor(action),
  description: action.description ?? "",
  command: action.commandPreview ?? action.manualInstructions ?? "",
  manual: action.manual === true,
});

/** Build a runtime install action when the requirement is already satisfied (empty action
 * list) but the user still wants to add another agent via "Change". */
const runtimeActionFor = (id: RuntimeId): SetupAction => ({
  id: `install-runtime-${id}`,
  label: `Install ${AGENT_META[id].name}`,
  requirementId: "runtime",
  requiresConsent: false,
  runtimeId: id,
});

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

const rootStyle: CSSProperties = {
  position: "relative",
  display: "flex",
  flexDirection: "column",
  height: "100vh",
  width: "100%",
  background: "var(--canvas)",
  color: "var(--text)",
  overflow: "hidden",
};

const contentScrollStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  background:
    "radial-gradient(820px 440px at 50% -10%,color-mix(in srgb,var(--teal) 7%,transparent),transparent)",
};

const contentInnerStyle: CSSProperties = {
  maxWidth: 760,
  margin: "0 auto",
  padding: "38px 28px 64px",
};

const privacyNoteStyle: CSSProperties = {
  textAlign: "center",
  marginTop: 26,
  fontSize: 12,
  color: "var(--subtle)",
};

const heroTitleStyle: CSSProperties = {
  margin: "9px 0 0",
  font: "600 33px 'Jura',sans-serif",
  letterSpacing: "-.01em",
  lineHeight: 1.08,
};

const heroSubtitleStyle: CSSProperties = {
  margin: "11px 0 0",
  fontSize: 15,
  color: "var(--muted)",
  lineHeight: 1.55,
  maxWidth: 450,
};

const heroActionsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 13,
  marginTop: 20,
  flexWrap: "wrap",
};

const scanningButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 9,
  whiteSpace: "nowrap",
  background: "var(--raised)",
  color: "var(--muted)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "12px 19px",
  font: "600 14px 'Instrument Sans'",
  cursor: "default",
};

const secondaryButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  whiteSpace: "nowrap",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  borderRadius: 12,
  padding: "11px 16px",
  font: "600 13.5px 'Instrument Sans'",
  cursor: "pointer",
};
