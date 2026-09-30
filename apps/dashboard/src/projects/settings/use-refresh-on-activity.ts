import { useEffect } from "react";
import { useLiveProjects } from "../ProjectsProvider";

const REFRESH_AFTER_MESSAGE_MS = 600;

/**
 * Runs `refresh` when the person comes back to the tab, and shortly after a chat message
 * arrives on the project's stream: a coordinator or thread turn has usually just saved a
 * memory file or finished a run by then. Neither has an event of its own.
 */
export const useRefreshOnActivity = (projectId: string, refresh: () => void): void => {
  const live = useLiveProjects();

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = live.subscribeEvents(projectId, (event) => {
      if (event.kind !== "entry" || event.entry.type !== "message.created") return;
      clearTimeout(timer);
      timer = setTimeout(refresh, REFRESH_AFTER_MESSAGE_MS);
    });
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(timer);
      unsubscribe();
    };
  }, [live, projectId, refresh]);
};
