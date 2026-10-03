import type { InboxSources } from "@aop/common";
import { useCallback, useEffect, useState } from "react";
import { getInboxSources } from "../../api/inbox";
import { refreshInboxSummary } from "../../inbox/inbox-summary-store";

/**
 * The Slack connection as the host reports it (never its tokens), read again on demand and
 * every few seconds while `watching` (waiting for the person to click Allow in Slack, or for the
 * feed to come up).
 */
export const useSlackConnection = (watching: boolean) => {
  const [sources, setSources] = useState<InboxSources | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setSources(await getInboxSources());
      setError(null);
      void refreshInboxSummary();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void reload();
    if (!watching) return;
    const timer = window.setInterval(() => void reload(), 2_000);
    return () => window.clearInterval(timer);
  }, [reload, watching]);

  return { sources, error, reload };
};
