import { type AppUpdateState, buildChannel } from "@aop/common";
import { useState } from "react";
import type {
  DesktopBackend,
  DesktopState,
  HostProcessState,
  PairingCodeResult,
} from "../backend/types";
import { Brand, CommandBlock, Notice, StatusLine, Switch, type Tone } from "../ui";
import { AppUpdateRow } from "./AppUpdateRow";

interface HostModeScreenProps {
  state: DesktopState;
  backend: DesktopBackend;
  update: AppUpdateState | null;
  onChangeHost: () => void;
}

/**
 * This Mac as the host. The app starts the server and keeps it running, bound to this computer
 * only. Other devices reach it through `tailscale serve`, which the person runs; the app shows
 * the command and hands out pairing codes. The dashboard here is the owner's own, so it needs no token.
 */
export const HostModeScreen = ({ state, backend, update, onChangeHost }: HostModeScreenProps) => {
  const { hostProcess } = state;
  const running = hostProcess.status === "running";
  const busy = hostProcess.status === "starting" || hostProcess.status === "stopping";
  const active =
    running || hostProcess.status === "starting" || hostProcess.status === "restarting";
  // Stopping a host the app did not start would only make the app forget it while it keeps serving.
  const adopted = running && hostProcess.ownership === "adopted";

  return (
    <main className="screen" data-testid="host-screen">
      <div className="card">
        <Brand
          title="AOP on this Mac"
          subtitle="This computer keeps your projects, and other devices connect to it."
        />

        <div className="stack">
          <StatusLine
            tone={toneOf(hostProcess)}
            label={describe(hostProcess, state.localPort)}
            testId="host-status"
          />
          {hostProcess.status === "failed" ? (
            <Notice tone="error" testId="host-error">
              {hostProcess.message}
            </Notice>
          ) : null}
        </div>

        {adopted ? <ManagedElsewhere /> : null}

        <div className="actions">
          {adopted ? null : active ? (
            <button
              type="button"
              className="button"
              data-testid="host-stop"
              disabled={busy}
              onClick={() => void backend.stopHostMode()}
            >
              Stop host
            </button>
          ) : (
            <button
              type="button"
              className="button button-primary"
              data-testid="host-start"
              disabled={busy}
              onClick={() => void backend.startHostMode()}
            >
              Start host
            </button>
          )}
          {running && state.connection.status === "connected" ? (
            <button
              type="button"
              className="button button-primary"
              data-testid="host-open-dashboard"
              onClick={() => void backend.openDashboard()}
            >
              Open dashboard
            </button>
          ) : null}
          <button
            type="button"
            className="button"
            data-testid="host-open-logs"
            onClick={() => void backend.openLogsFolder()}
          >
            Open logs
          </button>
        </div>

        <ReachFromOtherDevices state={state} backend={backend} />

        <div className="stack">
          <AppUpdateRow state={state} update={update} backend={backend} />
          {/* The host here is the one inside the app, so it never has an update of its own. */}
          <p className="subtle" data-testid="host-updates-with-app">
            The host on this Mac updates with this app.
          </p>
        </div>

        <button type="button" className="link" data-testid="host-change" onClick={onChangeHost}>
          Change host…
        </button>
      </div>
    </main>
  );
};

const ManagedElsewhere = () => (
  <div className="stack" data-testid="host-managed-elsewhere">
    <Notice tone="info">
      This host runs outside the app, for example as a background service, so the app does not start
      or stop it. To stop a background service, run this in Terminal.
    </Notice>
    <CommandBlock command={STOP_SERVICE_COMMAND} testId="host-stop-command" />
    <p className="subtle">
      If you started it by hand in a terminal, stop it there with Control-C. Quit the app any time;
      the host keeps running.
    </p>
  </div>
);

const ReachFromOtherDevices = ({
  state,
  backend,
}: {
  state: DesktopState;
  backend: DesktopBackend;
}) => {
  const [pairing, setPairing] = useState<PairingCodeResult | null>(null);
  const running = state.hostProcess.status === "running";
  const { tailscale, serveOverTailscale } = state;

  return (
    <section className="stack" aria-labelledby="reach-title">
      <h2 id="reach-title">Use it from other devices</h2>
      <div className="option">
        <p className="muted">
          Serve over Tailscale, so your other computers reach this host over HTTPS.
        </p>
        <Switch
          checked={serveOverTailscale}
          onChange={(next) => void backend.setServeOverTailscale(next)}
          label="Serve over Tailscale"
          testId="host-tailscale-toggle"
        />
      </div>

      {serveOverTailscale ? (
        <div className="stack" data-testid="host-tailscale-steps">
          <p className="muted">
            Sign in to Tailscale on this Mac and your other devices, and turn on HTTPS certificates
            in the Tailscale admin console. Then run this in Terminal. The host stays on this Mac;
            Tailscale puts HTTPS in front of it.
          </p>
          <CommandBlock command={tailscale.serveCommand} testId="host-tailscale-command" />
          <p className="subtle">
            To stop sharing, run {tailscale.resetCommand}. Never use tailscale funnel for this host.
          </p>
        </div>
      ) : null}

      <div className="stack">
        <div className="actions">
          <button
            type="button"
            className="button"
            data-testid="host-pairing-create"
            disabled={!running}
            onClick={() => void backend.createPairingCode().then(setPairing)}
          >
            Pair another device
          </button>
        </div>
        <PairingResult result={pairing} />
      </div>
    </section>
  );
};

const PairingResult = ({ result }: { result: PairingCodeResult | null }) => {
  if (!result) return null;
  if (!result.ok) {
    return (
      <Notice tone="error" testId="host-pairing-error">
        {result.message}
      </Notice>
    );
  }
  return (
    <div className="stack" data-testid="host-pairing-result">
      <p className="code-large" data-testid="host-pairing-code">
        {result.code}
      </p>
      <p className="subtle">
        Enter it on the other device with this host's https:// address. It works once and expires at{" "}
        {new Date(result.expiresAt).toLocaleTimeString()}.
      </p>
    </div>
  );
};

const STOP_SERVICE_COMMAND = `launchctl unload ~/Library/LaunchAgents/${buildChannel().launchdLabel}.plist`;

const describe = (hostProcess: HostProcessState, port: number): string => {
  switch (hostProcess.status) {
    case "stopped":
      return "Not running";
    case "starting":
      return "Starting…";
    case "running":
      return hostProcess.ownership === "adopted"
        ? `Running on port ${port} (running outside the app)`
        : `Running on port ${port}`;
    case "restarting":
      return `Restarting after it stopped (attempt ${hostProcess.attempt})…`;
    case "stopping":
      return "Stopping…";
    case "failed":
      return "Could not start";
  }
};

const toneOf = (hostProcess: HostProcessState): Tone => {
  switch (hostProcess.status) {
    case "running":
      return "ok";
    case "starting":
    case "stopping":
    case "restarting":
      return "busy";
    case "failed":
      return "error";
    case "stopped":
      return "idle";
  }
};
