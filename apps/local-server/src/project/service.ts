import { rm } from "node:fs/promises";
import {
  type Message,
  type MessagePage,
  type Project,
  type ProjectPatch,
  type ProjectSettings,
  type ProjectStatus,
  UserMessageSchema,
} from "@aop/common";
import { aopPaths, generateTypeId } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { ThreadGit } from "../thread/git.ts";
import { createThreadRepository } from "../thread/repository.ts";
import { invalidMessage } from "../thread/spawn-target.ts";
import type { ThreadError } from "../thread/types.ts";
import {
  insertCoordinatorSession,
  prepareCoordinatorWorkspace,
  resolveCoordinatorRuntime,
  syncCoordinatorSession,
} from "./coordinator.ts";
import type { ChatEngine } from "./engine.ts";
import { recordProjectRemoved, recordProjectUpserted } from "./events.ts";
import { createProjectRepository } from "./repository.ts";
import { createProjectTeardown } from "./teardown.ts";
import { listWireMessages, type MessagePageRequest, UNKNOWN_PAGE_ANCHOR } from "./wire-messages.ts";

export type ProjectAction = "pause" | "resume" | "archive" | "restore";

export type ProjectError =
  | { code: "PROJECT_NOT_FOUND" }
  | { code: "REPO_NOT_FOUND"; repoId: string }
  | { code: "REPO_IN_USE"; repoId: string }
  | { code: "INVALID_TRANSITION"; action: ProjectAction; status: ProjectStatus }
  | { code: "SESSION_BUSY"; sessionId: string }
  | Extract<
      ThreadError,
      { code: "PROJECT_NOT_ACTIVE" | "INVALID_MESSAGE" | "SEND_FAILED" | "WORKTREE_FAILED" }
    >;

export type ProjectResult<T> = ({ success: true } & T) | { success: false; error: ProjectError };

export interface ProjectService {
  create: (settings: ProjectSettings) => Promise<ProjectResult<{ project: Project }>>;
  list: () => Promise<Project[]>;
  get: (projectId: string) => Promise<ProjectResult<{ project: Project }>>;
  update: (projectId: string, patch: ProjectPatch) => Promise<ProjectResult<{ project: Project }>>;
  /**
   * Pause and archive stop every running session; resume and restore only reopen the project.
   * Archive also releases the threads' worktrees, keeping their branches.
   */
  transition: (
    projectId: string,
    action: ProjectAction,
  ) => Promise<ProjectResult<{ project: Project }>>;
  /** Recycles the coordinator's runtime session; threads are not touched. */
  restartCoordinator: (projectId: string) => Promise<ProjectResult<{ project: Project }>>;
  remove: (projectId: string) => Promise<ProjectResult<Record<never, never>>>;
  sendToCoordinator: (
    projectId: string,
    text: string,
  ) => Promise<ProjectResult<{ message: Message }>>;
  /** The latest page of the coordinator chat, or the one before message `page.before`. */
  listMessages: (
    projectId: string,
    page?: MessagePageRequest,
  ) => Promise<ProjectResult<MessagePage>>;
}

const TRANSITIONS: Record<ProjectAction, { from: ProjectStatus[]; to: ProjectStatus }> = {
  pause: { from: ["active"], to: "paused" },
  resume: { from: ["paused"], to: "active" },
  archive: { from: ["active", "paused"], to: "archived" },
  restore: { from: ["archived"], to: "active" },
};

export const createProjectService = (
  ctx: LocalServerContext,
  chat: ChatEngine,
  git: ThreadGit,
): ProjectService => {
  const notFound = { success: false, error: { code: "PROJECT_NOT_FOUND" } } as const;

  const teardown = createProjectTeardown(ctx, chat, git);

  // What a status implies for the work a project holds: paused and archived projects run
  // nothing, and an archived one keeps its threads' branches but not their checkouts.
  const enforceStatus = async (project: Project): Promise<void> => {
    if (project.status === "active") return;
    await teardown.stopSessions(await ctx.chatSessionRepository.listByProject(project.id));
    if (project.status === "archived") await teardown.parkThreads(project.id);
  };

  const missingRepo = async (repoIds: readonly string[]): Promise<string | null> => {
    for (const repoId of repoIds) {
      if (!(await ctx.repoRepository.getById(repoId))) return repoId;
    }
    return null;
  };

  // Repos must be registered, and one a thread still works in cannot leave the project: the
  // thread's repo would no longer be one of the project's repos.
  const refuseRepoChange = async (
    project: Project,
    repoIds: readonly string[] | undefined,
  ): Promise<ProjectError | null> => {
    if (!repoIds) return null;
    const unknown = await missingRepo(repoIds);
    if (unknown) return { code: "REPO_NOT_FOUND", repoId: unknown };
    const removed = project.repoIds.filter((repoId) => !repoIds.includes(repoId));
    if (removed.length === 0) return null;
    const threads = await ctx.threadRepository.listByProject(project.id);
    const inUse = removed.find((repoId) => threads.some((thread) => thread.repoId === repoId));
    return inUse ? { code: "REPO_IN_USE", repoId: inUse } : null;
  };

  const applyUpdate = (projectId: string, patch: ProjectPatch): Promise<Project | null> =>
    ctx.eventPublisher.transaction(async (tx) => {
      const updated = await createProjectRepository(tx.db).update(projectId, patch);
      if (!updated) return null;
      if (patch.threadAccess) {
        await createThreadRepository(tx.db).setAccessForProject(projectId, patch.threadAccess);
      }
      await recordProjectUpserted(tx, updated);
      return updated;
    });

  return {
    create: async (settings) => {
      const unknown = await missingRepo(settings.repoIds);
      if (unknown) return { success: false, error: { code: "REPO_NOT_FOUND", repoId: unknown } };

      const projectId = generateTypeId("proj");
      const workspace = await prepareCoordinatorWorkspace(projectId);
      const runtime = await resolveCoordinatorRuntime(ctx, settings.coordinator);
      const project = await ctx.eventPublisher.transaction(async (tx) => {
        const created = await createProjectRepository(tx.db).create({ id: projectId, ...settings });
        await insertCoordinatorSession(tx.db, {
          projectId,
          name: created.name,
          runtime,
          workspace,
        });
        await recordProjectUpserted(tx, created);
        return created;
      });
      return { success: true, project };
    },

    list: () => ctx.projectRepository.list(),

    get: async (projectId) => {
      const project = await ctx.projectRepository.getById(projectId);
      return project ? { success: true, project } : notFound;
    },

    update: async (projectId, patch) => {
      const current = await ctx.projectRepository.getById(projectId);
      if (!current) return notFound;
      const refused = await refuseRepoChange(current, patch.repoIds);
      if (refused) return { success: false, error: refused };

      const project = await applyUpdate(projectId, patch);
      if (!project) return notFound;
      if (patch.name !== undefined || patch.coordinator !== undefined) {
        await syncCoordinatorSession(ctx, project);
      }
      return { success: true, project };
    },

    transition: async (projectId, action) => {
      const current = await ctx.projectRepository.getById(projectId);
      if (!current) return notFound;
      const { from, to } = TRANSITIONS[action];
      if (current.status === to) {
        // The same again finishes what an interrupted call left undone.
        await enforceStatus(current);
        return { success: true, project: current };
      }
      if (!from.includes(current.status)) {
        return {
          success: false,
          error: { code: "INVALID_TRANSITION", action, status: current.status },
        };
      }
      const project = await ctx.eventPublisher.transaction(async (tx) => {
        const updated = await createProjectRepository(tx.db).setStatus(projectId, to);
        if (updated) await recordProjectUpserted(tx, updated);
        return updated;
      });
      if (!project) return notFound;
      await enforceStatus(project);
      return { success: true, project };
    },

    restartCoordinator: async (projectId) => {
      const project = await ctx.projectRepository.getById(projectId);
      const coordinator = project
        ? await ctx.chatSessionRepository.getCoordinator(projectId)
        : null;
      if (!project || !coordinator) return notFound;
      await chat.resetRuntime(coordinator.id);
      await syncCoordinatorSession(ctx, project);
      return { success: true, project };
    },

    remove: async (projectId) => {
      if (!(await ctx.projectRepository.getById(projectId))) return notFound;
      // Threads first: they own worktrees and processes the database cannot clean up.
      const sessions = (await ctx.chatSessionRepository.listByProject(projectId)).sort(
        (a, b) => Number(a.kind === "coordinator") - Number(b.kind === "coordinator"),
      );
      const deleted = await teardown.deleteSessions(sessions);
      if (!deleted.success) return deleted;
      await ctx.eventPublisher.transaction(async (tx) => {
        await createProjectRepository(tx.db).remove(projectId);
        await recordProjectRemoved(tx, projectId);
      });
      await rm(aopPaths.projectDir(projectId), { recursive: true, force: true });
      return { success: true };
    },

    sendToCoordinator: async (projectId, text) => {
      const project = await ctx.projectRepository.getById(projectId);
      if (!project) return notFound;
      if (project.status !== "active") {
        return {
          success: false,
          error: { code: "PROJECT_NOT_ACTIVE", status: project.status },
        };
      }
      const invalid = invalidMessage(text);
      if (invalid?.code === "INVALID_MESSAGE") return { success: false, error: invalid };
      const coordinator = await ctx.chatSessionRepository.getCoordinator(projectId);
      if (!coordinator) return notFound;

      const sent = await chat.sendMessage(coordinator.id, { content: text });
      if (!sent.success) {
        return { success: false, error: { code: "SEND_FAILED", reason: sent.error.code } };
      }
      const message = UserMessageSchema.parse({
        id: sent.message.id,
        projectId,
        threadId: null,
        role: "user",
        text: sent.message.content,
        createdAt: sent.message.createdAt,
      });
      return { success: true, message };
    },

    listMessages: async (projectId, page) => {
      const coordinator = await ctx.chatSessionRepository.getCoordinator(projectId);
      if (!coordinator) return notFound;
      const listed = await listWireMessages(ctx.db, coordinator, page);
      return listed
        ? { success: true, ...listed }
        : { success: false, error: { code: "INVALID_MESSAGE", message: UNKNOWN_PAGE_ANCHOR } };
    },
  };
};
