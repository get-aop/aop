type DesktopWindow = Window & {
  aopDesktop?: unknown;
};

const DESKTOP_QUERY_PARAM = "aopDesktop";
const DESKTOP_SESSION_KEY = "aopDesktopWebView";

export const isDesktopApp = (): boolean => {
  if (typeof window === "undefined") return false;

  if ((window as DesktopWindow).aopDesktop) return true;

  if (window.location.search.includes(`${DESKTOP_QUERY_PARAM}=1`)) {
    sessionStorage.setItem(DESKTOP_SESSION_KEY, "true");
    return true;
  }

  return sessionStorage.getItem(DESKTOP_SESSION_KEY) === "true";
};

export const nativeHtmlDragEnabled = (): boolean => !isDesktopApp();
