import type { HostSetup } from "@aop/common";
import { useEffect } from "react";
import { Button } from "@/ui/button";
import { Card } from "@/ui/card";
import { refreshHostSetup, useHostSetup } from "../host-setup/host-setup-store";
import { SetupChecklist } from "../host-setup/SetupChecklist";
import { cannotUpdateReason, platformName } from "../updates/update-rows";
import { useUpdates } from "../updates/update-store";
import { useUpdateStatus } from "../updates/use-update-status";
import { HostDevices } from "./settings-devices";
import { useCurrentDeviceId } from "./use-host-owner";

/**
 * AOP settings › Host: what the host is and runs, the setup checklist (service, reachable,
 * Claude Code, GitHub, computer use, updates) with Fix and How to, and the paired devices. Every
 * command and fix runs on the host, whichever device shows this.
 */
export const SettingsHost = () => {
  const { setup, loading, error } = useHostSetup();
  useUpdateStatus();
  const status = useUpdates().status;
  const canManage = status?.canUpdate ?? false;
  const blockedReason = status ? cannotUpdateReason(status.hostName) : null;
  const currentDeviceId = useCurrentDeviceId();

  // Opening the page always looks again: a fix done in a terminal shows at once.
  useEffect(() => {
    void refreshHostSetup();
  }, []);

  return (
    <div data-testid="section-host" className="flex flex-col gap-4 p-4">
      <Card className="gap-2 px-4 py-3.5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 data-testid="host-title" className="text-[14px] font-semibold text-text">
              Host {setup?.hostName ?? status?.hostName ?? ""}
            </h2>
            {setup ? (
              <p data-testid="host-summary" className="text-[12px] text-text-subtle">
                {hostSummary(setup)}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            data-testid="host-check-again"
            disabled={loading}
            onClick={() => void refreshHostSetup()}
          >
            {loading ? "Checking…" : "Check again"}
          </Button>
        </div>
        {error ? (
          <p role="alert" data-testid="host-setup-error" className="text-[12px] text-blocked">
            {error}
          </p>
        ) : null}
        {setup ? (
          <SetupChecklist
            checks={setup.checks}
            canManage={canManage}
            blockedReason={blockedReason}
          />
        ) : (
          <p className="py-3 text-[12px] text-text-subtle">Checking the host…</p>
        )}
      </Card>
      <Card className="gap-2 px-4 py-3.5">
        {setup && setup.addresses.length > 0 ? (
          <p data-testid="host-addresses" className="text-[12px] text-text-subtle">
            Other devices reach this host at {setup.addresses.join(", ")}
          </p>
        ) : null}
        <HostDevices
          canManage={canManage}
          currentDeviceId={currentDeviceId}
          blockedReason={blockedReason}
        />
      </Card>
    </div>
  );
};

/** "Linux · AOP Nightly 0.10.8-nightly.20261002.17 · up 3 h · 5 of 6 ready". */
export const hostSummary = (setup: HostSetup): string =>
  [
    platformName(setup.os),
    `${setup.channel === "nightly" ? "AOP Nightly" : "AOP"} ${setup.version}`,
    `up ${formatUptime(setup.uptimeSeconds)}`,
    `${setup.ready} of ${setup.total} ready`,
  ]
    .filter(Boolean)
    .join(" · ");

const formatUptime = (seconds: number): string => {
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86_400)} d`;
};
