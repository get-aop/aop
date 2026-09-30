import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { getProject, listProjects, listThreads } from "../api/projects";
import { createLiveProjects, type LiveProjects } from "./live-projects";
import type { ProjectEntry, ProjectsState } from "./projects-state";

const LiveProjectsContext = createContext<LiveProjects | null>(null);

/**
 * Owns the page's view of every project: the list, each project's threads, and the streams
 * that keep them current. Mount it once, inside the authentication gate, since it starts
 * calling the host as soon as it mounts. `live` lets a test bring its own.
 */
export const ProjectsProvider = ({
  live: provided,
  children,
}: {
  live?: LiveProjects;
  children: ReactNode;
}) => {
  const [live] = useState(
    () => provided ?? createLiveProjects({ api: { listProjects, getProject, listThreads } }),
  );

  useEffect(() => {
    live.start();
    // A laptop that slept, or a tab that was in the background, catches up as soon as it is looked at.
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void live.refresh();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      live.stop();
    };
  }, [live]);

  return <LiveProjectsContext.Provider value={live}>{children}</LiveProjectsContext.Provider>;
};

/** The controls: select a project, refetch, hear a stream's raw events. */
export const useLiveProjects = (): LiveProjects => {
  const live = useContext(LiveProjectsContext);
  if (!live) throw new Error("useLiveProjects must be used inside <ProjectsProvider>");
  return live;
};

export const useProjectsState = (): ProjectsState => {
  const live = useLiveProjects();
  return useSyncExternalStore(live.subscribe, live.getState);
};

/** One project, or undefined when it is unknown (not loaded yet, or deleted). */
export const useProjectEntry = (projectId: string): ProjectEntry | undefined => {
  const live = useLiveProjects();
  return useSyncExternalStore(live.subscribe, () => live.getState().byId[projectId]);
};
