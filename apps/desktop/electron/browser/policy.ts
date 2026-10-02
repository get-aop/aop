import { basename, extname } from "node:path";
import { AOP_BROWSER_PARTITION, type BrowserAsk } from "@aop/common";

/**
 * What a page in the AOP Browser may do. Pages are strangers: they run in their own sandboxed
 * renderer, on their own session, with no preload and so no way to reach the app's IPC. These
 * rules are pure so each one can be tested without Electron.
 */

/** The `webPreferences` keys a guest is attached with, as far as the app pins them. */
export interface GuestPreferences {
  preload?: string;
  preloadURL?: string;
  nodeIntegration?: boolean;
  nodeIntegrationInSubFrames?: boolean;
  nodeIntegrationInWorker?: boolean;
  contextIsolation?: boolean;
  sandbox?: boolean;
  webSecurity?: boolean;
  allowRunningInsecureContent?: boolean;
  webviewTag?: boolean;
  experimentalFeatures?: boolean;
  enableBlinkFeatures?: string;
  navigateOnDragDrop?: boolean;
  safeDialogs?: boolean;
}

/**
 * Only the bundled dashboard may attach a guest, only on the browser's partition, and only to a
 * web address. Anything else (a webview the dashboard did not mean to create, or one asking for
 * the dashboard's own session) is refused.
 */
export const isGuestAttachAllowed = (
  params: { src?: string; partition?: string },
  fromDashboard: boolean,
): boolean =>
  fromDashboard &&
  params.partition === AOP_BROWSER_PARTITION &&
  (!params.src || params.src === "about:blank" || isWebUrl(params.src));

/** Pins the guest's preferences whatever the element asked for: sandboxed, isolated, no Node. */
export const hardenGuestPreferences = (preferences: GuestPreferences): void => {
  delete preferences.preload;
  delete preferences.preloadURL;
  delete preferences.enableBlinkFeatures;
  preferences.nodeIntegration = false;
  preferences.nodeIntegrationInSubFrames = false;
  preferences.nodeIntegrationInWorker = false;
  preferences.contextIsolation = true;
  preferences.sandbox = true;
  preferences.webSecurity = true;
  preferences.allowRunningInsecureContent = false;
  preferences.webviewTag = false;
  preferences.experimentalFeatures = false;
  preferences.navigateOnDragDrop = false;
  preferences.safeDialogs = true;
};

export const isWebUrl = (rawUrl: string): boolean => {
  const protocol = protocolOf(rawUrl);
  return protocol === "http:" || protocol === "https:";
};

// Schemes a page must never navigate to: the machine's files, the app's own pages, and
// Chromium's internals. Other unknown schemes go to the person as "open in another app".
const BLOCKED_SCHEMES = new Set([
  "file:",
  "app:",
  "chrome:",
  "chrome-extension:",
  "chrome-untrusted:",
  "devtools:",
  "javascript:",
  "view-source:",
]);

/** A navigation a page started that the app stops outright. */
export const isBlockedNavigation = (rawUrl: string): boolean => {
  const protocol = protocolOf(rawUrl);
  return protocol === null || BLOCKED_SCHEMES.has(protocol);
};

export type PopupDecision = "popup" | "tab" | "deny";

/**
 * A page's `window.open` or `target=_blank`. A scripted popup (`new-window`, opened with
 * features) gets a real window, because sign-in flows post their result back to the opener; a
 * plain new-tab link opens as a tab of the AOP Browser. Anything that is not a web address is
 * refused. (T3 Code makes the same split.)
 */
export const popupDecision = (details: { url: string; disposition: string }): PopupDecision => {
  const web = isWebUrl(details.url);
  if (details.disposition === "new-window") {
    return web || details.url === "about:blank" ? "popup" : "deny";
  }
  return web ? "tab" : "deny";
};

export type PermissionDecision =
  | { decision: "allow" }
  | { decision: "deny" }
  | { decision: "ask"; ask: BrowserAsk };

// Harmless and expected by ordinary pages: copy buttons, video players, games.
const ALLOWED_PERMISSIONS = new Set(["clipboard-sanitized-write", "fullscreen", "pointerLock"]);

/**
 * A page's permission request. Devices, location, notifications and other apps' links are the
 * person's call; a few harmless ones are granted; everything else (USB, MIDI, screen capture,
 * reading the clipboard, local fonts…) is denied.
 */
export const permissionDecision = (
  permission: string,
  details: { mediaTypes?: readonly string[]; externalURL?: string } = {},
): PermissionDecision => {
  if (ALLOWED_PERMISSIONS.has(permission)) return { decision: "allow" };
  if (permission === "geolocation") return { decision: "ask", ask: "geolocation" };
  if (permission === "notifications") return { decision: "ask", ask: "notifications" };
  if (permission === "media") return mediaDecision(details.mediaTypes ?? []);
  if (permission === "openExternal") {
    const url = details.externalURL ?? "";
    return isBlockedNavigation(url) || isWebUrl(url)
      ? { decision: "deny" }
      : { decision: "ask", ask: "open-external" };
  }
  return { decision: "deny" };
};

const mediaDecision = (types: readonly string[]): PermissionDecision => {
  const video = types.includes("video");
  const audio = types.includes("audio");
  if (video && audio) return { decision: "ask", ask: "camera-and-microphone" };
  if (video) return { decision: "ask", ask: "camera" };
  if (audio) return { decision: "ask", ask: "microphone" };
  return { decision: "deny" };
};

/**
 * A synchronous permission check (`navigator.permissions.query`, the `Notification.permission`
 * getter): granted only when it is always allowed, or the person already allowed it for this
 * origin while the app has been running.
 */
export const permissionCheck = (
  permission: string,
  mediaType: string | undefined,
  granted: (ask: BrowserAsk) => boolean,
): boolean => {
  if (ALLOWED_PERMISSIONS.has(permission)) return true;
  if (permission === "geolocation" || permission === "notifications") return granted(permission);
  if (permission === "media") {
    if (mediaType === "video") return granted("camera") || granted("camera-and-microphone");
    if (mediaType === "audio") return granted("microphone") || granted("camera-and-microphone");
  }
  return false;
};

/**
 * The name a download is saved under in the Downloads folder: the page's suggestion without any
 * folder in it, and " (1)", " (2)"… before the extension when the name is taken.
 */
export const downloadFileName = (suggested: string, taken: (name: string) => boolean): string => {
  const clean = [...basename(suggested.replace(/\\/g, "/"))]
    .filter((char) => char !== ":" && char.charCodeAt(0) > 0x1f && char.charCodeAt(0) !== 0x7f)
    .join("")
    .replace(/^\.+/, "")
    .trim();
  const name = clean || "download";
  if (!taken(name)) return name;
  const extension = extname(name);
  const stem = name.slice(0, name.length - extension.length);
  for (let copy = 1; ; copy += 1) {
    const candidate = `${stem} (${copy})${extension}`;
    if (!taken(candidate)) return candidate;
  }
};

const protocolOf = (rawUrl: string): string | null => {
  try {
    return new URL(rawUrl).protocol;
  } catch {
    return null;
  }
};
