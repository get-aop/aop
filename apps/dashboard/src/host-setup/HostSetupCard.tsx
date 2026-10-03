import { setupIsComplete } from "@aop/common";
import { useState } from "react";
import { Button } from "@/ui/button";
import { openSettingsDialog } from "../shell/dialog-store";
import { cannotUpdateReason } from "../updates/update-rows";
import { useUpdates } from "../updates/update-store";
import { refreshHostSetup, useHostSetup } from "./host-setup-store";
import { SetupChecklist } from "./SetupChecklist";

const HIDDEN_KEY = "aop:host-setup-hidden:v1";

/**
 * "Set up this host" on the home page, while a setup check still needs doing: the same checklist
 * as AOP settings › Host. "Hide setup" folds it to one line; it is always on that settings page,
 * and the switcher's "AOP settings" keeps its dot.
 */
export const HostSetupCard = () => {
  const { setup, loading } = useHostSetup();
  const status = useUpdates().status;
  const [hidden, setHidden] = useState(readHidden);
  if (!setup || setupIsComplete(setup)) return null;

  const summary = `${setup.hostName} runs AOP. ${setup.ready} of ${setup.total} ready.`;
  if (hidden) {
    return (
      <div
        data-testid="host-setup-card-hidden"
        className="mx-6 mb-4 flex items-center gap-2 text-[12.5px] text-text-subtle"
      >
        <span className="size-1.5 rounded-full bg-waiting" />
        <span>Host setup: {summary}</span>
        <button
          type="button"
          data-testid="host-setup-show"
          className="text-running hover:underline"
          onClick={() => setHidden(writeHidden(false))}
        >
          Show setup
        </button>
      </div>
    );
  }

  return (
    <section
      data-testid="host-setup-card"
      className="mx-6 mb-4 flex flex-col gap-2 rounded-card border border-border bg-raised px-4 py-3.5"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold text-text">Set up this host</h2>
          <p data-testid="host-setup-summary" className="text-[12.5px] text-text-subtle">
            {summary}
          </p>
        </div>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={loading}
          onClick={() => void refreshHostSetup()}
        >
          {loading ? "Checking…" : "Check again"}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          data-testid="host-setup-hide"
          onClick={() => setHidden(writeHidden(true))}
        >
          Hide setup
        </Button>
      </div>
      <SetupChecklist
        checks={setup.checks}
        canManage={status?.canUpdate ?? false}
        blockedReason={status ? cannotUpdateReason(status.hostName) : null}
      />
      <button
        type="button"
        className="w-fit text-[12px] text-running hover:underline"
        onClick={() => openSettingsDialog("host")}
      >
        Open AOP settings › Host
      </button>
    </section>
  );
};

const readHidden = (): boolean => {
  try {
    return window.localStorage.getItem(HIDDEN_KEY) === "true";
  } catch {
    return false;
  }
};

const writeHidden = (hidden: boolean): boolean => {
  try {
    if (hidden) window.localStorage.setItem(HIDDEN_KEY, "true");
    else window.localStorage.removeItem(HIDDEN_KEY);
  } catch {
    // Without storage it folds for this visit only.
  }
  return hidden;
};
