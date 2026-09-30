import type { CreateProjectInput, NotificationLevel, Project } from "@aop/common";
import { useMemo } from "react";
import { toast } from "sonner";
import {
  createProject,
  deleteProject,
  type ProjectAction,
  patchProject,
  transitionProject,
} from "../api/projects";
import { requestConfirmation } from "../components/ConfirmationHost";
import { navigate, parseRoute, projectsPath, routeProjectId } from "../shell/router";
import { useLiveProjects } from "./ProjectsProvider";

export interface ProjectActions {
  create: (input: CreateProjectInput) => Promise<Project>;
  transition: (project: Project, action: ProjectAction) => Promise<void>;
  setNotifications: (project: Project, level: NotificationLevel) => Promise<void>;
  /** Asks first; deletes the project, its threads and its memory for good. */
  remove: (project: Project) => Promise<void>;
}

/**
 * Everything a person can do to a project from the shell. Each result is handed to the live
 * state at once, so the page does not wait for the stream to say what it just did; the entry
 * the host publishes afterwards repeats it harmlessly. Failures reach the person as a toast.
 */
export const useProjectActions = (): ProjectActions => {
  const live = useLiveProjects();

  return useMemo<ProjectActions>(
    () => ({
      create: async (input) => {
        const project = await createProject(input);
        live.adopt(project);
        return project;
      },
      transition: (project, action) =>
        attempt(async () => live.adopt(await transitionProject(project.id, action))),
      setNotifications: (project, level) =>
        attempt(async () =>
          live.adopt(await patchProject(project.id, { notificationLevel: level })),
        ),
      remove: async (project) => {
        const confirmed = await requestConfirmation({
          title: `Delete “${project.name}”?`,
          message:
            "Its threads, chat and memory are deleted for good. Repositories stay attached to AOP. This cannot be undone.",
          confirmLabel: "Delete project",
          destructive: true,
        });
        if (!confirmed) return;
        await attempt(async () => {
          await deleteProject(project.id);
          live.forget(project.id);
          const current = parseRoute(window.location.pathname);
          if (current && routeProjectId(current) === project.id) navigate(projectsPath());
        });
      },
    }),
    [live],
  );
};

const attempt = async (run: () => Promise<void>): Promise<void> => {
  try {
    await run();
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Something went wrong");
  }
};
