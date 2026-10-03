import type { AppUpdateState } from "@aop/common";
import { type ReactNode, useState } from "react";
import { connectionLabel, hostName, hostShortName } from "../backend/connection-label";
import { hostBehindAppNote } from "../backend/host-version";
import type { ConnectionState, DesktopBackend, DesktopState } from "../backend/types";
import { Brand, Notice, StatusLine, type Tone } from "../ui";
import { AppUpdateRow } from "./AppUpdateRow";

interface StatusScreenProps {
  state: DesktopState;
  backend: DesktopBackend;
  update: AppUpdateState | null;
  onChangeHost: () => void;
}

/** How the app stands with its remote host, and what to do when it does not stand well. */
export const StatusScreen = ({ state, backend, update, onChangeHost }: StatusScreenProps) => {
  const { connection } = state;
  const host = state.remoteUrl ? hostShortName(state.remoteUrl) : null;
  return (
    <main className="screen" data-testid="status-screen">
      <div className="card">
        <Brand
          title={host ? `Host ${host}` : "AOP"}
          subtitle={state.remoteUrl ? hostName(state.remoteUrl) : undefined}
        />

        <StatusLine
          tone={toneOf(connection)}
          label={connectionLabel(connection)}
          testId="status-label"
        />
        <Explanation connection={connection} />

        {connection.status === "connected" ? (
          <dl className="meta">
            <dt>Host version</dt>
            <dd data-testid="status-host-version">
              {connection.hostVersion}
              <HostDrift hostVersion={connection.hostVersion} appVersion={state.appVersion} />
            </dd>
          </dl>
        ) : null}

        <AppUpdateRow state={state} update={update} backend={backend} />

        <div className="actions">
          {connection.status === "connected" ? (
            <button
              type="button"
              className="button button-primary"
              data-testid="status-open-dashboard"
              onClick={() => void backend.openDashboard()}
            >
              Show dashboard
            </button>
          ) : null}
          {connection.status === "unauthorized" ? (
            <button
              type="button"
              className="button button-primary"
              data-testid="status-pair-again"
              onClick={onChangeHost}
            >
              Pair again
            </button>
          ) : (
            <button
              type="button"
              className="button"
              data-testid="status-retry"
              onClick={() => void backend.reconnect()}
            >
              Check again
            </button>
          )}
          <button
            type="button"
            className="button"
            data-testid="status-change-host"
            onClick={onChangeHost}
          >
            Change host
          </button>
        </div>

        <Disconnect host={host ?? "this host"} backend={backend} />
      </div>
    </main>
  );
};

const HostDrift = ({ hostVersion, appVersion }: { hostVersion: string; appVersion: string }) => {
  const note = hostBehindAppNote(hostVersion, appVersion);
  return note ? (
    <span className="subtle" data-testid="status-host-drift">
      {" "}
      · {note}
    </span>
  ) : null;
};

/** Disconnecting forgets the pairing, which only a new code from the host gives back, so it asks first. */
const Disconnect = ({ host, backend }: { host: string; backend: DesktopBackend }) => {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <div className="actions">
        <button
          type="button"
          className="button button-danger"
          data-testid="status-disconnect"
          onClick={() => setAsking(true)}
        >
          Disconnect
        </button>
      </div>
    );
  }
  return (
    <div className="confirm" data-testid="status-disconnect-confirm">
      <Notice tone="warning">
        Disconnect from {host}? This app forgets it and removes itself from the host's devices. To
        connect again you need a new pairing code.
      </Notice>
      <div className="actions">
        <button
          type="button"
          className="button"
          data-testid="status-disconnect-cancel"
          onClick={() => setAsking(false)}
        >
          Cancel
        </button>
        <button
          type="button"
          className="button button-danger"
          data-testid="status-disconnect-confirm-button"
          onClick={() => void backend.forgetHost()}
        >
          Disconnect
        </button>
      </div>
    </div>
  );
};

const Explanation = ({ connection }: { connection: ConnectionState }): ReactNode => {
  switch (connection.status) {
    case "unreachable":
      return (
        <Notice tone="warning" testId="status-explanation">
          {connection.message} The app keeps trying and opens the dashboard when the host answers.
        </Notice>
      );
    case "unauthorized":
      return (
        <Notice tone="warning" testId="status-explanation">
          The host does not know this device: it was removed there, or its token was refused. Pair
          again with a new code from the host.
        </Notice>
      );
    case "incompatible":
      return (
        <Notice tone="error" testId="status-explanation">
          {incompatibleText(connection)}
        </Notice>
      );
    default:
      return null;
  }
};

const incompatibleText = (
  connection: Extract<ConnectionState, { status: "incompatible" }>,
): string => {
  switch (connection.reason) {
    case "client-too-old":
      return "This host needs a newer AOP app than this one. Update the app.";
    case "host-too-old":
      return "This app is newer than the host. Update AOP on the host.";
    case "not-aop":
      return "That address answers, but not as an AOP host it can pair with.";
  }
};

const toneOf = (connection: ConnectionState): Tone => {
  switch (connection.status) {
    case "connected":
      return "ok";
    case "connecting":
      return "busy";
    case "unreachable":
    case "unauthorized":
      return "warning";
    case "incompatible":
      return "error";
    case "unconfigured":
      return "idle";
  }
};
