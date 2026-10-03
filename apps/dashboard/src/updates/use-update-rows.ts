import { useEffect } from "react";
import { checkForCliUpdates } from "../agent-clis/agent-cli-store";
import { useAgentCliStatus } from "../agent-clis/use-agent-clis";
import { useHostSetupOs } from "../host-setup/host-setup-store";
import { checkForAppUpdate, startAppUpdates, useAppUpdates } from "./app-update-store";
import { appRow, cliRows, hostRow, type UpdateRowView } from "./update-rows";
import { checkForHostUpdate, getUpdates, type UpdatesState } from "./update-store";
import { useUpdateStatus } from "./use-update-status";

export interface UpdateRows {
  host: UpdatesState;
  /** This app first (desktop only), then the host, then the host's agent CLIs. */
  rows: UpdateRowView[];
  checking: boolean;
}

/** Every update this viewer can see, as rows. `poll` belongs to the surface mounted for good. */
export const useUpdateRows = ({ poll = false }: { poll?: boolean } = {}): UpdateRows => {
  const host = useUpdateStatus({ poll });
  const app = useAppUpdates();
  const clis = useAgentCliStatus({ poll });
  const os = useHostSetupOs();

  useEffect(() => {
    void startAppUpdates();
  }, []);

  const rows: UpdateRowView[] = [];
  if (app.info) rows.push(appRow(app.info, app.update, host.status));
  if (host.status) {
    rows.push(
      hostRow({
        status: host.status,
        target: host.target,
        os,
        appVersion: app.info?.version ?? null,
      }),
    );
  }
  rows.push(...cliRows(clis.data, host.status));
  return {
    host,
    rows,
    checking: host.checking || clis.checking || app.update?.status === "checking",
  };
};

/** "Check for updates": asks every feed now, the app's, the host's and the agent CLIs'. */
export const checkEverything = async (): Promise<void> => {
  const canUpdate = getUpdates().status?.canUpdate ?? false;
  await Promise.all([
    checkForAppUpdate(),
    canUpdate ? checkForHostUpdate() : Promise.resolve(),
    canUpdate ? checkForCliUpdates() : Promise.resolve(),
  ]);
};
