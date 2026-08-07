import { useEffect, useState } from "react";

const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.7;
const MAX_ZOOM = 1.5;

export const useAppZoom = (): void => {
  const [zoomLevel, setZoomLevel] = useState(1);

  useEffect(() => {
    void setDesktopZoom(zoomLevel, desktopBridge());
  }, [zoomLevel]);

  useEffect(() => {
    if (!desktopBridge()) return;

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

interface DesktopZoomBridge {
  setZoom: (zoomFactor: number) => Promise<void>;
}

const desktopBridge = (): DesktopZoomBridge | null => {
  const bridge = (window as Window & { aopDesktop?: Partial<DesktopZoomBridge> }).aopDesktop;
  return typeof bridge?.setZoom === "function" ? (bridge as DesktopZoomBridge) : null;
};

export const setDesktopZoom = async (
  zoomLevel: number,
  bridge: DesktopZoomBridge | null,
): Promise<void> => {
  await bridge?.setZoom(zoomLevel).catch(() => undefined);
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
