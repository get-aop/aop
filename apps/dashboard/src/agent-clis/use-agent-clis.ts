import { useEffect } from "react";
import { type AgentClisState, refreshAgentClis, useAgentClis } from "./agent-cli-store";

const REFRESH_EVERY_MS = 5 * 60_000;

/**
 * The host's agent CLIs, read on mount and, for the surface that lives as long as the page
 * (`poll`), every five minutes and whenever the tab comes back to the front. The host does the
 * checking on its own schedule; this only re-reads what it found.
 */
export const useAgentCliStatus = ({ poll = false }: { poll?: boolean } = {}): AgentClisState => {
  useEffect(() => {
    void refreshAgentClis();
    if (!poll) return;

    const timer = window.setInterval(() => void refreshAgentClis(), REFRESH_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshAgentClis();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [poll]);

  return useAgentClis();
};
