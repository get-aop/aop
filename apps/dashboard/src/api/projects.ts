import type {
  ComputerUseOption,
  CreateProjectInput,
  Project,
  ProjectPatch,
  Thread,
} from "@aop/common";
import { request } from "./request";

/** What a project's lifecycle buttons post to: `POST /projects/:id/<action>`. */
export type ProjectAction = "pause" | "resume" | "archive" | "restore";

export const listProjects = async (): Promise<Project[]> =>
  (await request<{ projects: Project[] }>("/projects")).projects;

export const getProject = async (projectId: string): Promise<Project> =>
  (await request<{ project: Project }>(`/projects/${encodeURIComponent(projectId)}`)).project;

export const listThreads = async (projectId: string): Promise<Thread[]> =>
  (await request<{ threads: Thread[] }>(`/projects/${encodeURIComponent(projectId)}/threads`))
    .threads;

export const createProject = async (input: CreateProjectInput): Promise<Project> =>
  (
    await request<{ project: Project }>("/projects", {
      method: "POST",
      body: JSON.stringify(input),
    })
  ).project;

export const patchProject = async (projectId: string, patch: ProjectPatch): Promise<Project> =>
  (
    await request<{ project: Project }>(`/projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    })
  ).project;

/** Host owner only. Where threads get computer and browser use from, from their next turn. */
export const setProjectComputerUse = async (
  projectId: string,
  computerUse: ComputerUseOption,
): Promise<Project> =>
  (
    await request<{ project: Project }>(`/projects/${encodeURIComponent(projectId)}/computer-use`, {
      method: "PUT",
      body: JSON.stringify({ computerUse }),
    })
  ).project;

export const transitionProject = async (
  projectId: string,
  action: ProjectAction,
): Promise<Project> =>
  (
    await request<{ project: Project }>(`/projects/${encodeURIComponent(projectId)}/${action}`, {
      method: "POST",
    })
  ).project;

/** Recycles the coordinator's runtime session; the project's threads are not touched. */
export const restartCoordinator = async (projectId: string): Promise<Project> =>
  (
    await request<{ project: Project }>(
      `/projects/${encodeURIComponent(projectId)}/coordinator/restart`,
      { method: "POST" },
    )
  ).project;

export const deleteProject = async (projectId: string): Promise<void> => {
  await request<unknown>(`/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
};
