import { APP_SCHEME, DASHBOARD_HOST, SHELL_HOST } from "./app-protocol";

/** Where the connect screen is served from while developing it with Vite. */
const DEV_SHELL_ORIGIN = "http://127.0.0.1:25170";

/** The connect screen may change which host the app talks to, so only it may call those channels. */
export const isShellSender = (rawUrl: string, development: boolean): boolean => {
  const url = parseUrl(rawUrl);
  if (!url) return false;
  if (url.protocol === `${APP_SCHEME}:` && url.hostname === SHELL_HOST) return true;
  return development && url.origin === DEV_SHELL_ORIGIN;
};

/** The bundled dashboard: it may ask which host to use and report a refused token, nothing more. */
export const isDashboardSender = (rawUrl: string): boolean => {
  const url = parseUrl(rawUrl);
  return url?.protocol === `${APP_SCHEME}:` && url.hostname === DASHBOARD_HOST;
};

/**
 * The window shows only the app's own two pages. Everything else, a link in a message or a
 * pull request, opens in the person's browser instead of taking the window away from the app.
 */
export const isAllowedNavigation = (rawUrl: string, development: boolean): boolean =>
  isShellSender(rawUrl, development) || isDashboardSender(rawUrl);

export const isSafeExternalUrl = (rawUrl: string): boolean => {
  const url = parseUrl(rawUrl);
  return url?.protocol === "https:" || url?.protocol === "http:";
};

/**
 * The link an update offers comes from the release feed, so it is opened only if it is https.
 * A test feed (`AOP_RELEASE_FEED_URL` set) runs on this computer over plain http, which is allowed
 * for loopback and only then.
 */
export const isSafeUpdateUrl = (rawUrl: string, testFeedConfigured: boolean): boolean => {
  const url = parseUrl(rawUrl);
  if (url?.protocol === "https:") return true;
  return (
    testFeedConfigured &&
    url?.protocol === "http:" &&
    (url.hostname === "127.0.0.1" || url.hostname === "localhost")
  );
};

const parseUrl = (rawUrl: string): URL | null => {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
};
