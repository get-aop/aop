type TauriWindow = Window & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
};

const DESKTOP_QUERY_PARAM = "aopDesktop";
const DESKTOP_SESSION_KEY = "aopDesktopWebView";

export const isTauriWebView = (): boolean => {
  if (typeof window === "undefined") return false;

  const currentWindow = window as TauriWindow;
  if (currentWindow.__TAURI__ || currentWindow.__TAURI_INTERNALS__) return true;

  if (window.location.search.includes(`${DESKTOP_QUERY_PARAM}=1`)) {
    sessionStorage.setItem(DESKTOP_SESSION_KEY, "true");
    return true;
  }

  return sessionStorage.getItem(DESKTOP_SESSION_KEY) === "true";
};

export const nativeHtmlDragEnabled = (): boolean => !isTauriWebView();
