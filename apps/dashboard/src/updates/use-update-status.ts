import { useEffect } from "react";
import { refreshUpdates, type UpdatesState, useUpdates } from "./update-store";

const REFRESH_EVERY_MS = 10 * 60_000;

/**
 * The host's update state, read on mount and again every ten minutes and whenever the tab comes
 * back to the front. The host itself checks for releases once a day; this only re-reads what it
 * found. Only the surface that lives as long as the page turns `poll` on.
 */
export const useUpdateStatus = ({ poll = false }: { poll?: boolean } = {}): UpdatesState => {
  useEffect(() => {
    void refreshUpdates();
    if (!poll) return;

    const timer = window.setInterval(() => void refreshUpdates(), REFRESH_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshUpdates();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll]);

  return useUpdates();
};
