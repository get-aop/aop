import { useEffect } from "react";
import { openSettingsDialog } from "./dialog-store";

interface DesktopSettingsBridge {
  onOpenSettings: (listener: () => void) => () => void;
}

/**
 * In the desktop app, the Mac's app menu has AOP → Settings… (⌘,). The menu takes the keystroke
 * before the page sees it, so the app tells the page to open the AOP settings instead.
 */
export const useDesktopSettingsMenu = (): void => {
  useEffect(() => {
    const bridge = desktopBridge();
    return bridge?.onOpenSettings(() => openSettingsDialog("general"));
  }, []);
};

const desktopBridge = (): DesktopSettingsBridge | null => {
  const bridge = (window as Window & { aopDesktop?: Partial<DesktopSettingsBridge> }).aopDesktop;
  return typeof bridge?.onOpenSettings === "function" ? (bridge as DesktopSettingsBridge) : null;
};
