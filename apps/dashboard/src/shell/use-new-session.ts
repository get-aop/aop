import { useCallback } from "react";

import { openNewSessionDialog } from "./dialog-store";
import type { RailProps } from "./rail-store";

/**
 * New-session entry point (⌘N / rail row). Single-repo scope goes straight
 * into the draft; All/multi scope asks for the repo first (§6.5).
 */
export const useNewSession = (rail: RailProps | null) =>
  useCallback(() => {
    if (!rail) return;
    const repos = rail.groups;
    if (repos.length === 1) {
      const only = repos[0];
      if (only) {
        rail.onNewSession(only.repoId);
        return;
      }
    }
    if (repos.length === 0) {
      rail.onNewTask();
      return;
    }
    openNewSessionDialog();
  }, [rail]);
