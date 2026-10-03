import { useEffect } from "react";
import { openSettingsDialog } from "./dialog-store";

interface DesktopSettingsBridge {
  onOpenSettings: (listener: () => void) => () => void;
  onOpenHostSetup: (listener: () => void) => () => void;
}

/**
 * In the desktop app, the Mac's app menu has AOP → Settings… (⌘,) and the Host menu has Host
 * Setup…. The menu takes the keystroke before the page sees it, so the app tells the page to
 * open the AOP settings (or its Host page) instead.
 */
export const useDesktopSettingsMenu = (): void => {
  useEffect(() => {
    const bridge = desktopBridge();
    const stops = [
      bridge?.onOpenSettings?.(() => openSettingsDialog("general")),
      bridge?.onOpenHostSetup?.(() => openSettingsDialog("host")),
    ];
    return () => {
      for (const stop of stops) stop?.();
    };
  }, []);
};

const desktopBridge = (): Partial<DesktopSettingsBridge> | null =>
  (window as Window & { aopDesktop?: Partial<DesktopSettingsBridge> }).aopDesktop ?? null;
