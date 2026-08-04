import { normalizeReleaseVersion } from "@aop/common";
import { ArrowDownToLineIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { useAopUpdateStatus } from "../hooks/useAopUpdateStatus";

const formatCurrentVersion = (currentVersion: string | undefined): string | null => {
  if (!currentVersion) {
    return null;
  }
  const core = normalizeReleaseVersion(currentVersion);
  if (!core) {
    return null;
  }
  return `v${core}${currentVersion.includes("dev") ? " (dev)" : ""}`;
};

interface UpdatePanelProps {
  latestVersion: string;
  installing: boolean;
  awaitingRestart: boolean;
  installError: string | null;
  installMessage: string | null;
  onInstall: () => void;
}

const UpdateAvailablePanel = ({
  latestVersion,
  installing,
  awaitingRestart,
  installError,
  installMessage,
  onInstall,
}: UpdatePanelProps) => {
  const label = awaitingRestart
    ? "Restarting AOP…"
    : installing
      ? "Updating AOP…"
      : "Update available";

  return (
    <>
      <button
        type="button"
        disabled={installing}
        onClick={onInstall}
        className="focus-ring flex w-full cursor-pointer items-center justify-between rounded-card border border-favorite/40 bg-favorite/10 px-3 py-2.5 text-left transition duration-200 hover:border-favorite hover:bg-favorite/15 disabled:cursor-not-allowed disabled:opacity-70"
      >
        <span>
          <span className="block text-sm font-medium text-text">{label}</span>
          <span className="mt-0.5 block text-[11.5px] text-favorite">v{latestVersion}</span>
        </span>
        <ArrowDownToLineIcon className="size-5 text-favorite" strokeWidth={1.7} />
      </button>
      {installMessage ? <p className="text-[13px] leading-5 text-ok">{installMessage}</p> : null}
      {installError ? <p className="text-[13px] leading-5 text-blocked">{installError}</p> : null}
    </>
  );
};

export const DashboardVersion = ({ poll = true }: { poll?: boolean } = {}) => {
  const { status, installing, awaitingRestart, installError, installMessage, install, refresh } =
    useAopUpdateStatus({ poll });
  const [checking, setChecking] = useState(false);

  const versionLabel = formatCurrentVersion(status?.currentVersion);
  const updateReady = Boolean(status?.updateAvailable && status?.latestVersion);
  const showCheckButton = !updateReady && Boolean(status?.canAutoUpdate);

  const handleCheck = async () => {
    setChecking(true);
    try {
      await refresh();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-2">
      {updateReady && status?.latestVersion ? (
        <UpdateAvailablePanel
          latestVersion={status.latestVersion}
          installing={installing}
          awaitingRestart={awaitingRestart}
          installError={installError}
          installMessage={installMessage}
          onInstall={() => void install()}
        />
      ) : null}

      <div className="flex items-center justify-between px-1">
        <span className="text-[11.5px] text-text-subtle">
          {versionLabel ?? "version unavailable"}
        </span>
        {showCheckButton ? (
          <button
            type="button"
            disabled={checking}
            onClick={() => void handleCheck()}
            className="focus-ring flex cursor-pointer items-center gap-1 rounded-control px-1.5 py-0.5 text-[11.5px] text-text-subtle transition-colors hover:text-text disabled:cursor-not-allowed disabled:opacity-70"
          >
            <RefreshCwIcon className="size-3" strokeWidth={1.7} />
            {checking ? "Checking…" : "Check for updates"}
          </button>
        ) : null}
      </div>
    </div>
  );
};
