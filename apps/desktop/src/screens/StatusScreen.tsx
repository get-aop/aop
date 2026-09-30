import type { ReactNode } from "react";
import { connectionLabel, hostName } from "../backend/connection-label";
import { hostVersionNotice } from "../backend/host-version";
import type {
  AppUpdateState,
  ConnectionState,
  DesktopBackend,
  DesktopState,
} from "../backend/types";
import { updateLabel } from "../backend/update-label";
import { Brand, Notice, StatusLine, type Tone } from "../ui";

interface StatusScreenProps {
  state: DesktopState;
  backend: DesktopBackend;
  update: AppUpdateState;
  onChangeHost: () => void;
}

/** How the app stands with its remote host, and what to do when it does not stand well. */
export const StatusScreen = ({ state, backend, update, onChangeHost }: StatusScreenProps) => {
  const { connection } = state;
  return (
    <main className="screen" data-testid="status-screen">
      <div className="card">
        <Brand
          title={state.remoteUrl ? hostName(state.remoteUrl) : "AOP"}
          subtitle="Your AOP host"
        />

        <StatusLine
          tone={toneOf(connection)}
          label={connectionLabel(connection)}
          testId="status-label"
        />
        <Explanation connection={connection} />
        <VersionNotices state={state} backend={backend} update={update} />

        <dl className="meta">
          {connection.status === "connected" ? (
            <>
              <dt>Host</dt>
              <dd data-testid="status-host-version">{connection.hostVersion}</dd>
            </>
          ) : null}
          <dt>App</dt>
          <dd>{state.appVersion}</dd>
        </dl>

        <div className="actions">
          {connection.status === "connected" ? (
            <button
              type="button"
              className="button button-primary"
              data-testid="status-open-dashboard"
              onClick={() => void backend.openDashboard()}
            >
              Open dashboard
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
          <button
            type="button"
            className="button button-danger"
            data-testid="status-disconnect"
            onClick={() => void backend.forgetHost()}
          >
            Disconnect
          </button>
        </div>
      </div>
    </main>
  );
};

/** Quiet notes beside the connection: the host is on another release, or this app can update. */
const VersionNotices = ({
  state,
  backend,
  update,
}: {
  state: DesktopState;
  backend: DesktopBackend;
  update: AppUpdateState;
}): ReactNode => {
  const { connection } = state;
  const drift =
    connection.status === "connected"
      ? hostVersionNotice(connection.hostVersion, state.appVersion)
      : null;
  const updateText = updateLabel(update);
  return (
    <>
      {drift ? (
        <Notice tone="info" testId="status-version-drift">
          {drift}
        </Notice>
      ) : null}
      {updateText ? (
        <Notice tone="info" testId="status-update">
          {updateText}
          {update.status === "available" ? (
            <>
              {" "}
              <button
                type="button"
                className="button"
                data-testid="status-update-download"
                onClick={() => void backend.openUpdateDownload()}
              >
                Download
              </button>
            </>
          ) : null}
          {update.status === "ready" ? (
            <>
              {" "}
              <button
                type="button"
                className="button"
                data-testid="status-update-restart"
                onClick={() => void backend.restartToUpdate()}
              >
                Restart to update
              </button>
            </>
          ) : null}
        </Notice>
      ) : null}
    </>
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
