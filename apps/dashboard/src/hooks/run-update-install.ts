import { installUpdate } from "../api/client";
import { waitForUpdateRestart } from "./update-restart";

export const runUpdateInstall = async (
  watchId: number,
  isActiveWatch: (watchId: number) => boolean,
  handlers: {
    onStarted: (message: string) => void;
    onTimeout: () => void;
    onError: (message: string) => void;
  },
): Promise<void> => {
  try {
    const result = await installUpdate();
    handlers.onStarted(
      `${result.message} This page will reload automatically when the update finishes.`,
    );

    const reloaded = await waitForUpdateRestart(result.targetVersion);
    if (!isActiveWatch(watchId)) {
      return;
    }

    if (!reloaded) {
      handlers.onTimeout();
    }
  } catch (error) {
    if (!isActiveWatch(watchId)) {
      return;
    }

    handlers.onError(error instanceof Error ? error.message : "Failed to start update");
  }
};
