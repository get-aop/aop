import {
  type AgentCliStatus,
  type AgentClisResponse,
  type AppUpdateState,
  buildChannel,
  type DesktopAppInfo,
  isNewerBuild,
  normalizeReleaseVersion,
  type UpdateStatus,
} from "@aop/common";

/**
 * One row of the Updates popover and of AOP settings › Updates, in the design's words: what it
 * is, which version it is on and which is out, a status word, one line on what happens, and the
 * actions this viewer may take. Pure, so every state can be tested without a screen.
 */
export interface UpdateRowView {
  id: string;
  title: string;
  /** "AOP Nightly for macOS · …1002.17 → …1003.4" */
  meta: string;
  link: { label: string; url: string } | null;
  status: string;
  tone: "quiet" | "news" | "busy" | "ok" | "bad";
  note: string | null;
  actions: UpdateAction[];
  /** Why this viewer has no button, in words that say where it can be changed. */
  blocked: string | null;
  /** The row has something to do or to say: the top-bar button shows while one does. */
  attention: boolean;
}

export type UpdateAction =
  | { kind: "update-host" | "update-host-now" | "cancel-queued" | "show-log"; label: string }
  | { kind: "restart-app" | "download-restart-app" | "download-app" | "check-app"; label: string }
  | { kind: "update-cli"; label: string; provider: string };

const PLATFORMS: Record<string, string> = {
  darwin: "macOS",
  linux: "Linux",
  win32: "Windows",
  android: "Android",
  ios: "iOS",
};

export const platformName = (platform: string | null | undefined): string | null =>
  platform ? (PLATFORMS[platform] ?? platform) : null;

/** "0.10.8-nightly.20261003.4" -> "…1003.4"; a stable release is short already. */
export const shortVersion = (version: string): string => {
  const nightly = /-nightly\.\d{4}(\d{4})\.(\d+)$/.exec(version);
  return nightly ? `…${nightly[1]}.${nightly[2]}` : version;
};

const versions = (current: string, next: string | null): string =>
  next && next !== current
    ? `${shortVersion(current)} → ${shortVersion(next)}`
    : shortVersion(current);

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

/** What a viewer who may not update the host is told, naming the host and where to change it. */
export const cannotUpdateReason = (hostName: string): string =>
  `Updates for this host can only be started on ${hostName || "the host"} itself (AOP settings › Updates › Who can update this host).`;

// ---- Host ----------------------------------------------------------------------------------

export interface HostRowInput {
  status: UpdateStatus;
  /** The release the page waits for the host to come back on, while it does. */
  target: string | null;
  /** The host's OS for the meta line, when known. */
  os: string | null;
  /** This app's version, inside the desktop app: says when the host is older than it. */
  appVersion: string | null;
}

export const hostRow = (input: HostRowInput): UpdateRowView => {
  const { status } = input;
  const base: UpdateRowView = {
    id: "host",
    title: `Host ${status.hostName}`,
    meta: [platformName(input.os), channelName(), versions(status.current, nextOf(status))]
      .filter(Boolean)
      .join(" · "),
    link:
      status.releaseUrl && status.available
        ? { label: "Release notes", url: status.releaseUrl }
        : null,
    status: "Up to date",
    tone: "ok",
    note: hostDriftNote(status, input.appVersion),
    actions: [],
    blocked: null,
    attention: false,
  };
  return { ...base, ...hostState(input, base) };
};

const nextOf = (status: UpdateStatus): string | null =>
  status.available ? status.latest : (status.queued?.version ?? null);

const channelName = (): string => (buildChannel().id === "nightly" ? "Nightly" : "Stable");

const hostDriftNote = (status: UpdateStatus, appVersion: string | null): string | null =>
  appVersion &&
  status.current !== "dev" &&
  isNewerBuild(normalizeReleaseVersion(appVersion), status.current, buildChannel().id)
    ? "Older than this app."
    : null;

type HostPatch = Partial<UpdateRowView>;

// The first state that applies wins: a special host, then what is going on, then what is out.
const hostState = (input: HostRowInput, base: UpdateRowView): HostPatch =>
  specialHost(input.status) ??
  runningHostUpdate(input) ??
  queuedHostUpdate(input.status) ??
  endedHostUpdate(input.status) ??
  availableHostUpdate(input.status) ??
  quietHost(input.status, base);

const specialHost = (status: UpdateStatus): HostPatch | null => {
  if (status.restart === "app") return { status: "Updates with this app", tone: "quiet" };
  if (status.restart === "source") {
    return { status: "Runs from source", note: "Pull and rebuild to update it.", tone: "quiet" };
  }
  return null;
};

const runningHostUpdate = ({ status, target }: HostRowInput): HostPatch | null => {
  if (status.state !== "updating" && target === null) return null;
  const version = target ?? status.latest ?? "";
  return {
    status: "Updating host…",
    tone: "busy",
    note: `Restarting to ${version}: downloaded and checked, waiting for the host to answer.`,
    attention: true,
  };
};

const queuedHostUpdate = (status: UpdateStatus): HostPatch | null => {
  const { queued } = status;
  if (!queued) return null;
  const turns = plural(queued.waitingFor, "turn");
  return {
    status: queued.expired ? `Still waiting for ${turns}` : `Waiting for ${turns}`,
    tone: "busy",
    note: queued.expired
      ? `Waited 6 h for ${turns} to finish. Update now restarts the host under ${queued.waitingFor === 1 ? "it" : "them"}.`
      : `Updates to ${shortVersion(queued.version)} once ${queued.waitingFor === 1 ? "it finishes" : "they finish"}. New turns can still start.`,
    ...guarded(status, [
      { kind: "update-host-now", label: "Update now" },
      { kind: "cancel-queued", label: "Cancel" },
    ]),
    attention: true,
  };
};

const endedHostUpdate = (status: UpdateStatus): HostPatch | null => {
  if (status.state === "installed") {
    return {
      status: "Installed, restart needed",
      tone: "news",
      note: status.updateError,
      attention: true,
    };
  }
  if (status.state !== "failed") return null;
  return {
    status: "Update failed",
    tone: "bad",
    note: status.updateError ?? "The update failed.",
    ...guarded(status, [
      { kind: "show-log", label: "Show log" },
      ...(status.available ? [{ kind: "update-host" as const, label: "Try again" }] : []),
    ]),
    attention: true,
  };
};

const availableHostUpdate = (status: UpdateStatus): HostPatch | null => {
  if (!status.enabled || !status.available || !status.latest) return null;
  return {
    status: "Update available",
    tone: "news",
    note: availableNote(status),
    ...guarded(status, [{ kind: "update-host", label: "Update host" }]),
    attention: true,
  };
};

const availableNote = (status: UpdateStatus): string => {
  const driver = status.includes.cuaDriver;
  return [
    driver ? `Includes CUA Driver ${driver.from} → ${driver.to}.` : null,
    status.download.state === "ready" && status.download.version === status.latest
      ? "Downloaded."
      : null,
    "Restarts the host. Every device reconnects on its own.",
  ]
    .filter(Boolean)
    .join(" ");
};

const quietHost = (status: UpdateStatus, base: UpdateRowView): HostPatch => {
  if (!status.enabled) return { status: "Update checks are off", tone: "quiet" };
  if (status.checkError) {
    return { status: "Could not check", tone: "bad", note: status.checkError };
  }
  return { note: base.note };
};

// A viewer who may not update the host gets the reason in place of the buttons.
const guarded = (status: UpdateStatus, actions: UpdateAction[]): HostPatch =>
  status.canUpdate ? { actions } : { blocked: cannotUpdateReason(status.hostName) };

// ---- This app ------------------------------------------------------------------------------

export const appRow = (
  info: DesktopAppInfo,
  update: AppUpdateState | null,
  host: UpdateStatus | null,
): UpdateRowView => {
  const next = update && "version" in update ? update.version : null;
  const base: UpdateRowView = {
    id: "app",
    title: "This app",
    meta: [
      `${info.name} for ${platformName(info.platform) ?? info.platform}`,
      versions(info.version, next),
    ]
      .filter(Boolean)
      .join(" · "),
    link:
      update && "releaseUrl" in update && update.releaseUrl
        ? { label: "Release notes", url: update.releaseUrl }
        : null,
    status: "Up to date",
    tone: "ok",
    note: appDriftNote(info, host),
    actions: [],
    blocked: null,
    attention: false,
  };
  return { ...base, ...appState(update, info) };
};

const appDriftNote = (info: DesktopAppInfo, host: UpdateStatus | null): string | null =>
  host &&
  host.current !== "dev" &&
  isNewerBuild(host.current, normalizeReleaseVersion(info.version), buildChannel().id)
    ? `${host.hostName} runs ${host.current}; this app is older.`
    : null;

const appState = (update: AppUpdateState | null, info: DesktopAppInfo): HostPatch => {
  switch (update?.status) {
    case "off":
      return { status: "Doesn't update itself here", tone: "quiet" };
    case "checking":
      return { status: "Checking…", tone: "busy" };
    case "available":
      return appAvailable(update.mode, info);
    case "downloading":
      return {
        status: `Downloading… ${Math.round(update.percent)}%`,
        tone: "busy",
        attention: true,
      };
    case "ready":
      return {
        status: "Ready",
        tone: "news",
        note: "Downloaded. Restarting takes a few seconds; your turns keep running on the host.",
        actions: [{ kind: "restart-app", label: "Restart to update" }],
        attention: true,
      };
    case "error":
      return {
        status: "Update failed",
        tone: "bad",
        note: update.message,
        actions: [{ kind: "check-app", label: "Try again" }],
        attention: true,
      };
    default:
      return {};
  }
};

const appAvailable = (mode: "auto" | "notice", info: DesktopAppInfo): HostPatch =>
  mode === "notice"
    ? {
        status: "Update available",
        tone: "news",
        note: `Download the new ${info.name}, quit this one and replace it in Applications.`,
        actions: [{ kind: "download-app", label: "Download" }],
        attention: true,
      }
    : {
        status: "Update available",
        tone: "news",
        note: "Downloads, then restarts this app. Your turns keep running on the host.",
        actions: [{ kind: "download-restart-app", label: "Download and restart" }],
        attention: true,
      };

// ---- Agent CLIs ----------------------------------------------------------------------------

const CHANGELOGS: Record<string, string> = {
  "claude-code": "https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md",
};

export const cliRows = (
  data: AgentClisResponse | null,
  host: Pick<UpdateStatus, "canUpdate" | "hostName"> | null,
): UpdateRowView[] =>
  (data?.clis ?? [])
    .filter((cli) => cli.installed)
    .map((cli) => cliRow(cli, host?.canUpdate ?? false, host?.hostName ?? ""));

const cliRow = (cli: AgentCliStatus, canUpdate: boolean, hostName: string): UpdateRowView => {
  const changelog = CHANGELOGS[cli.provider];
  const base: UpdateRowView = {
    id: `cli:${cli.provider}`,
    title: cli.label,
    meta: [
      `Agent CLI on ${hostName || "the host"}`,
      cli.version ? versions(cli.version, cli.updateAvailable ? cli.latest : null) : null,
    ]
      .filter(Boolean)
      .join(" · "),
    link: changelog && cli.updateAvailable ? { label: "Changelog", url: changelog } : null,
    status: "Up to date",
    tone: "ok",
    note: null,
    actions: [],
    blocked: null,
    attention: false,
  };
  return { ...base, ...cliState(cli, canUpdate, hostName) };
};

const cliState = (cli: AgentCliStatus, canUpdate: boolean, hostName: string): HostPatch => {
  const { update } = cli;
  if (update.state === "waiting") {
    return {
      status: `Waiting for ${plural(update.deferredFor, "turn")}`,
      tone: "busy",
      note: `Waiting for ${plural(update.deferredFor, "turn")} to finish: this install is replaced in place.`,
      attention: true,
    };
  }
  if (update.state === "updating") {
    return {
      status: "Updating…",
      tone: "busy",
      note: "New turns wait for it; turns in flight carry on.",
      attention: true,
    };
  }
  if (update.state === "failed" && cli.updateAvailable) {
    return {
      status: "Update failed",
      tone: "bad",
      note: [
        update.error,
        update.manualCommand && `Run it yourself on the host: ${update.manualCommand}`,
      ]
        .filter(Boolean)
        .join(" "),
      ...cliAction(cli, canUpdate, hostName, "Try again"),
      attention: true,
    };
  }
  if (!cli.updateAvailable) {
    return cli.checkError ? { status: "Could not check", tone: "bad", note: cli.checkError } : {};
  }
  return {
    status: "Update available",
    tone: "news",
    note: "No restart. The next turn uses it.",
    ...cliAction(cli, canUpdate, hostName, "Update"),
    attention: true,
  };
};

const cliAction = (
  cli: AgentCliStatus,
  canUpdate: boolean,
  hostName: string,
  label: string,
): HostPatch =>
  canUpdate
    ? { actions: [{ kind: "update-cli", label, provider: cli.provider }] }
    : { blocked: cannotUpdateReason(hostName) };

/**
 * What is new, as one string: the popover's dot shows while it differs from what the person saw
 * when they last opened it.
 */
export const newsSignature = (rows: readonly UpdateRowView[]): string =>
  rows
    .filter((row) => row.attention)
    .map((row) => `${row.id}:${row.meta}:${row.status}`)
    .join("|");
