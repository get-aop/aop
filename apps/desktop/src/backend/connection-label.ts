import type { ConnectionState, IncompatibleReason } from "./types";

/** One line saying how the app stands with its host: the window title, the menu, the status screen. */
export const connectionLabel = (connection: ConnectionState): string => {
  switch (connection.status) {
    case "unconfigured":
      return "No host chosen";
    case "connecting":
      return `Connecting to ${hostName(connection.host)}…`;
    case "connected":
      return `Connected to ${hostName(connection.host)}`;
    case "unreachable":
      return `Cannot reach ${hostName(connection.host)}`;
    case "unauthorized":
      return `${hostName(connection.host)} does not accept this device`;
    case "incompatible":
      return `${hostName(connection.host)} needs ${incompatibleFix(connection.reason)}`;
  }
};

/** `notes` are short asides after the connection, such as an available update. */
export const windowTitle = (connection: ConnectionState, notes: (string | null)[] = []): string =>
  [
    connection.status === "unconfigured" ? "AOP" : `AOP · ${connectionLabel(connection)}`,
    ...notes.filter((note) => note !== null),
  ].join(" · ");

/** The host's name and port, without the scheme: what a person recognises their host by. */
export const hostName = (hostUrl: string): string => {
  try {
    return new URL(hostUrl).host;
  } catch {
    return hostUrl;
  }
};

const incompatibleFix = (reason: IncompatibleReason): string => {
  switch (reason) {
    case "client-too-old":
      return "a newer AOP app";
    case "host-too-old":
      return "an update";
    case "not-aop":
      return "an AOP host";
  }
};
