import type { UpdateStatus } from "@aop/common";
import { useEffect } from "react";
import { refreshUpdates, type UpdatesState, useUpdates } from "./update-store";

const QUIET_MS = 10 * 60_000;
const AVAILABLE_MS = 60_000;
const QUEUED_MS = 10_000;

/**
 * The host's update state, read on mount, whenever the tab comes back to the front, and again
 * on a cadence that follows what is going on: every ten minutes when nothing is, every minute
 * once an update is out (so every device sees "Updating host…" when someone starts it), and
 * every ten seconds while one waits for turns to finish. Only the surface that lives as long as
 * the page turns `poll` on.
 */
export const useUpdateStatus = ({ poll = false }: { poll?: boolean } = {}): UpdatesState => {
  const updates = useUpdates();
  const every = pollInterval(updates.status);

  useEffect(() => {
    void refreshUpdates();
  }, []);

  useEffect(() => {
    if (!poll) return;
    const timer = window.setInterval(() => void refreshUpdates(), every);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshUpdates();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll, every]);

  return updates;
};

export const pollInterval = (status: UpdateStatus | null): number => {
  if (status?.queued) return QUEUED_MS;
  return status?.available ? AVAILABLE_MS : QUIET_MS;
};
