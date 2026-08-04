import { useEffect, useState } from "react";

const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 1.5;

export const useAppZoom = (): void => {
  const [zoomLevel, setZoomLevel] = useState(1);

  useEffect(() => {
    void setNativeWebviewZoom(zoomLevel);
  }, [zoomLevel]);

  useEffect(() => {
    if (!tauriInvoke()) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      setZoomLevel((current) => {
        const next = applyZoomShortcut(current, event);
        if (next === null) return current;

        event.preventDefault();
        return next;
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
};

type TauriInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

const tauriInvoke = (): TauriInvoke | null => {
  const internals = (window as Window & { __TAURI_INTERNALS__?: { invoke?: TauriInvoke } })
    .__TAURI_INTERNALS__;
  return typeof internals?.invoke === "function" ? internals.invoke.bind(internals) : null;
};

const setNativeWebviewZoom = async (zoomLevel: number): Promise<void> => {
  const invoke = tauriInvoke();
  if (!invoke) return;
  await invoke("plugin:webview|set_webview_zoom", {
    label: "main",
    value: zoomLevel,
  }).catch(() => undefined);
};

export const applyZoomShortcut = (current: number, event: KeyboardEvent): number | null => {
  if (!event.metaKey && !event.ctrlKey) return null;

  if (event.key === "+" || event.key === "=") {
    return clampZoom(current + ZOOM_STEP);
  }
  if (event.key === "-") {
    return clampZoom(current - ZOOM_STEP);
  }

  return null;
};

const clampZoom = (zoom: number): number =>
  Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom)) * 10) / 10;
