import { type AppUpdateState, buildChannel } from "@aop/common";
import { hostShortName } from "../backend/connection-label";
import { appBehindHostNote, displayVersion } from "../backend/host-version";
import type { AppUpdateBackend, DesktopState } from "../backend/types";

interface AppUpdateRowProps {
  state: DesktopState;
  /** Null until the app has said; the row waits rather than guess. */
  update: AppUpdateState | null;
  backend: AppUpdateBackend;
}

/**
 * "This app": the same row the dashboard's Updates popover has, on the app's own screens,
 * because they show before the dashboard loads. One line of versions, one line of state in the
 * design's words, and at most one action.
 */
export const AppUpdateRow = ({ state, update, backend }: AppUpdateRowProps) => {
  if (!update) return null;
  const next = nextVersion(update);
  const notes = releaseNotes(update);
  const { connection } = state;
  const drift =
    connection.status === "connected"
      ? appBehindHostNote(hostShortName(connection.host), connection.hostVersion, state.appVersion)
      : null;

  return (
    <section className="app-update" data-testid="app-update" aria-labelledby="app-update-title">
      <div className="app-update-text">
        <h2 id="app-update-title">This app</h2>
        <p className="subtle" data-testid="app-update-versions">
          {buildChannel().productName} for {platformName(state.platform)} ·{" "}
          {displayVersion(state.appVersion)}
          {next ? ` → ${displayVersion(next)}` : ""}
          {notes ? (
            <>
              {" · "}
              <a href={notes} target="_blank" rel="noreferrer" data-testid="app-update-notes">
                Release notes
              </a>
            </>
          ) : null}
        </p>
        <p
          className="app-update-status"
          data-testid="app-update-status"
          data-status={update.status}
          role={update.status === "error" ? "alert" : undefined}
        >
          {statusText(update)}
        </p>
        {drift ? (
          <p className="subtle" data-testid="app-update-drift">
            {drift}
          </p>
        ) : null}
      </div>
      <UpdateAction update={update} backend={backend} />
    </section>
  );
};

/** The one thing to do next, if there is one. */
const UpdateAction = ({
  update,
  backend,
}: {
  update: AppUpdateState;
  backend: AppUpdateBackend;
}) => {
  const action = actionFor(update, backend);
  if (!action) return null;
  return (
    <button
      type="button"
      className={action.primary ? "button button-primary" : "button"}
      data-testid="app-update-action"
      onClick={() => void action.run()}
    >
      {action.label}
    </button>
  );
};

const actionFor = (
  update: AppUpdateState,
  backend: AppUpdateBackend,
): { label: string; primary: boolean; run: () => Promise<unknown> } | null => {
  switch (update.status) {
    case "ready":
      return { label: "Restart to update", primary: true, run: backend.restartToUpdate };
    case "available":
      return update.mode === "notice"
        ? { label: "Download", primary: true, run: backend.openUpdateDownload }
        : { label: "Download and restart", primary: true, run: backend.downloadAndRestart };
    case "idle":
    case "error":
      return { label: "Check for updates", primary: false, run: backend.checkForUpdates };
    default:
      return null;
  }
};

const statusText = (update: AppUpdateState): string => {
  switch (update.status) {
    case "off":
      return "This build does not update itself.";
    case "idle":
      return "Up to date";
    case "checking":
      return "Checking for updates…";
    case "available":
      return update.mode === "notice"
        ? `Update available. Download it, then quit ${buildChannel().productName} and replace the app in Applications.`
        : "Update available";
    case "downloading":
      return `Downloading… ${update.percent}%`;
    case "ready":
      return "Downloaded. Restarting takes a few seconds.";
    case "error":
      return `Update failed: ${update.message}`;
  }
};

// A failed update keeps the version it was after, when it knew one.
const nextVersion = (update: AppUpdateState): string | null =>
  "version" in update ? update.version : null;

const releaseNotes = (update: AppUpdateState): string | null =>
  update.status === "available" || update.status === "ready" ? update.releaseUrl : null;

const PLATFORM_NAMES: Record<string, string> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

const platformName = (platform: string): string => PLATFORM_NAMES[platform] ?? platform;
