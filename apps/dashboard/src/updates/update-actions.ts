import { useSyncExternalStore } from "react";
import { startCliUpdate } from "../agent-clis/agent-cli-store";
import { requestConfirmation } from "../components/ConfirmationHost";
import {
  checkForAppUpdate,
  downloadAndRestartApp,
  openAppDownload,
  restartAppToUpdate,
} from "./app-update-store";
import type { UpdateAction } from "./update-rows";
import { cancelQueued, getUpdates, startUpdate } from "./update-store";

/** Which of the update dialogs is open: one at a time, mounted once by UpdateDialogs. */
export type UpdateDialog = "turns" | "log" | null;

let dialog: UpdateDialog = null;
const listeners = new Set<() => void>();

export const useUpdateDialog = (): UpdateDialog =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => dialog,
  );

export const openUpdateDialog = (next: UpdateDialog): void => {
  dialog = next;
  for (const listener of listeners) listener();
};

/** Does what a row's button says. Every surface (popover, settings page) goes through here. */
export const runUpdateAction = async (action: UpdateAction): Promise<void> => {
  switch (action.kind) {
    case "update-host":
      // A restart never surprises a running turn: with turns running, the person chooses.
      if ((getUpdates().status?.runningTurns.length ?? 0) > 0) openUpdateDialog("turns");
      else await startUpdate("now");
      return;
    case "update-host-now":
      return startUpdate("now");
    case "cancel-queued":
      return cancelQueued();
    case "show-log":
      openUpdateDialog("log");
      return;
    case "update-cli":
      return startCliUpdate(action.provider);
    default:
      return runAppAction(action);
  }
};

const runAppAction = async (action: UpdateAction): Promise<void> => {
  if (action.kind === "download-app") return openAppDownload();
  if (action.kind === "check-app") return checkForAppUpdate();
  if (!(await confirmAppRestart())) return;
  if (action.kind === "restart-app") return restartAppToUpdate();
  if (action.kind === "download-restart-app") return downloadAndRestartApp();
};

/**
 * An app restart never touches turns, which live on the host; it only asks when a composer holds
 * text not yet sent, which a restart would put at risk.
 */
const confirmAppRestart = async (): Promise<boolean> =>
  !hasUnsentText() ||
  requestConfirmation({
    title: "Restart to update this app?",
    message:
      "A message you haven't sent is still in a composer. This app closes and reopens; your turns run on the host, so nothing stops.",
    confirmLabel: "Restart to update",
  });

// Composers keep unsent text under aop:draft:v1:* (projects/chat/use-draft.ts).
export const hasUnsentText = (): boolean => {
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith("aop:draft:v1:") && window.localStorage.getItem(key)) return true;
    }
  } catch {
    // No storage, no drafts.
  }
  return false;
};
