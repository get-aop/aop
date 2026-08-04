import { ExternalLinkIcon } from "lucide-react";

import { Button } from "@/ui/button";
import { Progress } from "@/ui/progress";
import { DashboardVersion } from "../components/DashboardVersion";
import { useAopUpdateStatus } from "../hooks/useAopUpdateStatus";

/** Settings §About — version/build row + Install update + release notes. */
export const SettingsAbout = () => {
  const update = useAopUpdateStatus();
  const status = update.status;

  return (
    <div data-testid="section-about" className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-3 rounded-row border border-border bg-raised px-3 py-2.5">
        <span className="text-[13px] font-semibold text-text">AOP</span>
        <DashboardVersion />
        <span className="ml-auto font-mono text-[11px] text-text-subtle">
          v{status?.currentVersion ?? "—"}
        </span>
      </div>

      {status?.updateAvailable ? (
        <UpdateCard update={update} latestVersion={status.latestVersion ?? ""} />
      ) : null}

      <a
        href="https://github.com/aop/aop/releases"
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1.5 rounded-row px-1 text-[12.5px] text-running hover:underline"
      >
        Release notes
        <ExternalLinkIcon className="size-3" />
      </a>
    </div>
  );
};

const UpdateCard = ({
  update,
  latestVersion,
}: {
  update: ReturnType<typeof useAopUpdateStatus>;
  latestVersion: string;
}) => {
  const installLabel = update.installing
    ? "Installing…"
    : update.awaitingRestart
      ? "Restarting…"
      : "Install";
  return (
    <div
      data-testid="about-update-card"
      className="flex flex-col gap-2 rounded-row border border-border bg-raised px-3 py-2.5"
    >
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[12.5px] text-text">Update available — v{latestVersion}</span>
        <Button
          size="sm"
          onClick={() => void update.install()}
          disabled={update.installing || update.awaitingRestart}
        >
          {installLabel}
        </Button>
      </div>
      {update.installing ? (
        <Progress value={undefined} className="h-1" data-testid="about-update-progress" />
      ) : null}
      {update.installError ? (
        <p className="text-[12px] text-blocked">{update.installError}</p>
      ) : null}
      {update.installMessage ? (
        <p className="text-[12px] text-text-muted">{update.installMessage}</p>
      ) : null}
    </div>
  );
};
