import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import pkg from "../../../package.json";
import type { DesktopBackend, SidecarState } from "./backend/types";
import { SetupScreen } from "./setup/SetupScreen";
import type { DesktopSetupState } from "./setup/types";
import { DesktopShell } from "./shell/DesktopShell";
import { ShellStatus } from "./shell/ShellStatus";

type AppPhase = "loading-setup" | "setup" | "starting-dashboard" | "dashboard-error";

interface AppProps {
  backend: DesktopBackend;
  navigateToDashboard?: (url: string) => void;
}

const SETUP_SEEN_KEY = "aopDesktopSetupSeen";
const DASHBOARD_RECOVERY_DELAY_MS = 500;
const MAX_DASHBOARD_RECOVERY_ATTEMPTS = 3;

export const App = ({
  backend,
  navigateToDashboard = defaultNavigateToDashboard,
}: AppProps): ReactElement => {
  const [phase, setPhase] = useState<AppPhase>("loading-setup");
  const [setupState, setSetupState] = useState<DesktopSetupState | null>(null);
  const [sidecarState, setSidecarState] = useState<SidecarState | null>(null);
  const [dashboardRecoveryAttempts, setDashboardRecoveryAttempts] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const loadSetup = async () => {
      const nextSetupState = await backend.getSetupState();
      if (cancelled) return;
      setSetupState(nextSetupState);

      // An already-healthy machine skips the setup screen and boots straight into the
      // dashboard; everything else hands control to the redesigned SetupScreen.
      if (!nextSetupState.ready) {
        setPhase("setup");
        return;
      }

      if (!hasSeenDesktopSetup()) {
        setPhase("setup");
        return;
      }

      await enterDashboardOrError({
        backend,
        navigateToDashboard,
        setSidecarState,
        setPhase,
        isCancelled: () => cancelled,
      });
    };

    void loadSetup();

    return () => {
      cancelled = true;
    };
  }, [backend, navigateToDashboard]);

  useEffect(() => {
    if (!shouldRetryDashboardStart(phase, sidecarState, dashboardRecoveryAttempts)) return;

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      setDashboardRecoveryAttempts((attempts) => attempts + 1);
      void enterDashboardOrError({
        backend,
        navigateToDashboard,
        setSidecarState,
        setPhase,
        isCancelled: () => cancelled,
      });
    }, DASHBOARD_RECOVERY_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [backend, dashboardRecoveryAttempts, navigateToDashboard, phase, sidecarState]);

  const handleReScan = async (): Promise<void> => {
    setSetupState(await backend.getSetupState());
  };

  // Setup actions refresh state but never auto-launch: the redesigned screen shows
  // "Open dashboard" once every check passes, matching the AOP Desktop Setup design.
  const handleRunAction = async (actionId: string): Promise<void> => {
    setSetupState(await backend.runSetupAction(actionId));
  };

  const handleOpenDashboard = async (): Promise<void> => {
    markDesktopSetupSeen();
    await startDashboard(backend, navigateToDashboard, setSidecarState);
  };

  const handleDeclineRequiredSetup = (): Promise<void> => backend.quitApp();

  return (
    <DesktopShell>
      {phase === "loading-setup" ? <ShellStatus status="loading-setup" /> : null}
      {phase === "setup" && setupState ? (
        <SetupScreen
          state={setupState}
          appVersion={pkg.version}
          backend={backend}
          onReScan={handleReScan}
          onRunAction={handleRunAction}
          onOpenDashboard={handleOpenDashboard}
          onOpenLogs={backend.openLogsFolder}
          onDeclineRequiredSetup={() => void handleDeclineRequiredSetup()}
        />
      ) : null}
      {phase === "starting-dashboard" ? <ShellStatus status="starting-dashboard" /> : null}
      {phase === "dashboard-error" ? (
        <ShellStatus
          status="starting-dashboard"
          sidecar={sidecarState}
          onOpenLogs={backend.openLogsFolder}
        />
      ) : null}
    </DesktopShell>
  );
};

const defaultNavigateToDashboard = (url: string): void => {
  window.location.assign(url);
};

const hasSeenDesktopSetup = (): boolean => localStorage.getItem(SETUP_SEEN_KEY) === "true";

const markDesktopSetupSeen = (): void => {
  localStorage.setItem(SETUP_SEEN_KEY, "true");
};

const shouldRetryDashboardStart = (
  phase: AppPhase,
  sidecarState: SidecarState | null,
  attempts: number,
): boolean =>
  phase === "dashboard-error" &&
  attempts < MAX_DASHBOARD_RECOVERY_ATTEMPTS &&
  sidecarState?.status === "failed" &&
  isRecoverableSidecarFailure(sidecarState);

const isRecoverableSidecarFailure = (sidecarState: SidecarState): boolean =>
  Boolean(sidecarState.message?.includes("healthy"));

/**
 * Start the AOP sidecar and navigate once it is healthy. Updates sidecar state along the way
 * so callers can surface progress/failure. Resolves only after navigation; rejects (with
 * sidecar state already updated) if the sidecar never becomes healthy.
 */
const startDashboard = async (
  backend: DesktopBackend,
  navigateToDashboard: (url: string) => void,
  setSidecarState: (state: SidecarState) => void,
): Promise<void> => {
  setSidecarState({ status: "starting" });

  let nextSidecarState: SidecarState;
  try {
    nextSidecarState = await backend.startAopSidecar();
  } catch (error) {
    nextSidecarState = { status: "failed", message: errorMessage(error) };
  }
  setSidecarState(nextSidecarState);

  if (nextSidecarState.status === "ready" && nextSidecarState.dashboardUrl) {
    navigateToDashboard(nextSidecarState.dashboardUrl);
    return;
  }

  throw new Error(nextSidecarState.message ?? "The AOP local server did not become healthy.");
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

interface DashboardEntryArgs {
  backend: DesktopBackend;
  navigateToDashboard: (url: string) => void;
  setSidecarState: (state: SidecarState) => void;
  setPhase: (phase: AppPhase) => void;
  isCancelled: () => boolean;
}

/** Healthy-machine bootstrap: show the starting state, then start the sidecar. On success the
 * window navigates (so the caller never falls through); on failure flip to dashboard-error. */
const enterDashboardOrError = async (args: DashboardEntryArgs): Promise<void> => {
  args.setPhase("starting-dashboard");
  try {
    await startDashboard(args.backend, args.navigateToDashboard, args.setSidecarState);
  } catch {
    if (!args.isCancelled()) args.setPhase("dashboard-error");
  }
};
