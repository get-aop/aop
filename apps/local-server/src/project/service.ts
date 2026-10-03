import { rm } from "node:fs/promises";
import {
  type ComputerUseOption,
  ComputerUseSchema,
  type Message,
  type MessagePage,
  type Project,
  type ProjectPatch,
  type ProjectSettings,
  type ProjectStatus,
} from "@aop/common";
import { aopPaths, generateTypeId } from "@aop/infra";
import { discardStagedImages } from "../attachment/service.ts";
import type { MessageOrigin } from "../chat-session/message-origin.ts";
import type { ChatMidRunMode } from "../chat-session/mid-run-mode.ts";
import type { SteerInterruptResult } from "../chat-session/steer-interrupt.ts";
import type { LocalServerContext } from "../context.ts";
import type { ChatSession } from "../db/schema.ts";
import { removeProjectConnections } from "../issues/connection-store.ts";
import { readDefaultRuntimeId } from "../runtime-configuration/default-runtime.ts";
import { createRuntimeConfigurationRepository } from "../runtime-configuration/repository.ts";
import type { ThreadGit } from "../thread/git.ts";
import { createThreadRepository } from "../thread/repository.ts";
import { readMessageInput } from "../thread/spawn-target.ts";
import type { ThreadError } from "../thread/types.ts";
import {
  insertCoordinatorSession,
  prepareCoordinatorWorkspace,
  resolveCoordinatorRuntime,
  syncCoordinatorSession,
} from "./coordinator.ts";
import type { ChatEngine } from "./engine.ts";
import { recordProjectRemoved, recordProjectUpserted } from "./events.ts";
import { type ProjectKickoff, recordKickoff } from "./kickoff.ts";
import { createProjectRepository } from "./repository.ts";
import { chooseRuntime, isRuntimeChoiceError, type RuntimeChoiceError } from "./runtime-choice.ts";
import { createProjectTeardown } from "./teardown.ts";
import {
  getWireMessage,
  listWireMessages,
  type MessagePageRequest,
  UNKNOWN_PAGE_ANCHOR,
} from "./wire-messages.ts";

export type ProjectAction = "pause" | "resume" | "archive" | "restore";

export type ProjectError =
  | { code: "PROJECT_NOT_FOUND" }
  | { code: "REPO_NOT_FOUND"; repoId: string }
  | { code: "REPO_IN_USE"; repoId: string }
  | { code: "INVALID_TRANSITION"; action: ProjectAction; status: ProjectStatus }
  | { code: "SESSION_BUSY"; sessionId: string }
  | { code: "COMPUTER_USE_UNAVAILABLE"; option: ComputerUseOption }
  | Extract<SteerInterruptResult, { success: false }>["error"]
  | RuntimeChoiceError
  | Extract<
      ThreadError,
      { code: "PROJECT_NOT_ACTIVE" | "INVALID_MESSAGE" | "SEND_FAILED" | "WORKTREE_FAILED" }
    >;

export type ProjectResult<T> = ({ success: true } & T) | { success: false; error: ProjectError };

export interface ProjectService {
  /**
   * With `lookAround`, the project's first open runs by itself: a welcome, and with a repository
   * a read-only survey thread whose report makes the coordinator propose threads (kickoff.ts).
   */
  create: (
    settings: ProjectSettings,
    options?: { lookAround?: boolean },
  ) => Promise<ProjectResult<{ project: Project }>>;
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
  /**
   * Where threads get computer and browser use from, from their next turn. Only the host owner
   * reaches it (auth/route-policy.ts). Options that are named but not built yet are refused.
   */
  setComputerUse: (
    projectId: string,
    option: ComputerUseOption,
  ) => Promise<ProjectResult<{ project: Project }>>;
  /** Recycles the coordinator's runtime session; threads are not touched. */
  restartCoordinator: (projectId: string) => Promise<ProjectResult<{ project: Project }>>;
  remove: (projectId: string) => Promise<ProjectResult<Record<never, never>>>;
  /**
   * `origin` marks a message the person did not type as such, as when Memory settings frame
   * their request for the coordinator; the message returned shows what the chat will show.
   * `images` are the ids of images uploaded to the project for this message, in order.
   */
  sendToCoordinator: (
    projectId: string,
    text: string,
    options?: { origin?: MessageOrigin; images?: readonly string[]; midRunMode?: ChatMidRunMode },
  ) => Promise<ProjectResult<{ message: Message }>>;
  /**
   * "Interrupt now" for a message sent to the coordinator or a thread while it works: the step it
   * is on stops and it reads the message at once (see chat-session/steer-interrupt.ts).
   */
  interruptForMessage: (
    projectId: string,
    messageId: string,
  ) => Promise<ProjectResult<{ outcome: "interrupted" | "delivered" }>>;
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
  kickoff: ProjectKickoff,
): ProjectService => {
  const notFound = { success: false, error: { code: "PROJECT_NOT_FOUND" } } as const;

  const teardown = createProjectTeardown(ctx, chat, git);

  // Only an active project's coordinator takes a message.
  const activeCoordinator = async (
    projectId: string,
  ): Promise<ChatSession | { error: ProjectError }> => {
    const project = await ctx.projectRepository.getById(projectId);
    if (project && project.status !== "active") {
      return { error: { code: "PROJECT_NOT_ACTIVE", status: project.status } };
    }
    const coordinator = project && (await ctx.chatSessionRepository.getCoordinator(projectId));
    return coordinator ?? { error: notFound.error };
  };

  // What a status implies for the work a project holds: paused and archived projects run
  // nothing, and an archived one keeps its threads' branches but not their checkouts.
  const enforceStatus = async (project: Project): Promise<void> => {
    if (project.status === "active") return;
    await teardown.stopSessions(await ctx.chatSessionRepository.listByProject(project.id));
    if (project.status === "archived") await teardown.parkThreads(project.id);
  };

  const configurations = createRuntimeConfigurationRepository(ctx.db);

  // A new project's roles run on the runtime the client named, or on the host's default.
  const withRuntimes = async (
    sent: ProjectSettings,
    defaultRuntimeId: string,
  ): Promise<(ProjectSettings & Pick<Project, "coordinator" | "thread">) | RuntimeChoiceError> => {
    const coordinator = await chooseRuntime(configurations, sent.coordinator, defaultRuntimeId);
    if (isRuntimeChoiceError(coordinator)) return coordinator;
    const thread = await chooseRuntime(configurations, sent.thread, defaultRuntimeId);
    if (isRuntimeChoiceError(thread)) return thread;
    return { ...sent, coordinator, thread };
  };

  // A changed role keeps the runtime it has unless the change names another one.
  const patchRuntimes = async (
    sent: ProjectPatch,
    current: Project,
  ): Promise<ProjectPatch | RuntimeChoiceError> => {
    const patch = { ...sent };
    for (const role of ["coordinator", "thread"] as const) {
      const preference = sent[role];
      if (!preference) continue;
      const chosen = await chooseRuntime(configurations, preference, current[role].runtimeId);
      if (isRuntimeChoiceError(chosen)) return chosen;
      patch[role] = chosen;
    }
    return patch;
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

  // What a saved change sets going outside the project's row.
  const followUpdate = async (
    before: Project,
    project: Project,
    patch: ProjectPatch,
  ): Promise<void> => {
    if (patch.name !== undefined || patch.coordinator !== undefined) {
      await syncCoordinatorSession(ctx, project);
    }
    // Threads that waited past their reset while it was off resume now, the rest at their reset.
    if (project.autoContinue && !before.autoContinue) await chat.rearmResumes(project.id);
  };

  return {
    create: async (sent, options = {}) => {
      const unknown = await missingRepo(sent.repoIds);
      if (unknown) return { success: false, error: { code: "REPO_NOT_FOUND", repoId: unknown } };
      const settings = await withRuntimes(sent, await readDefaultRuntimeId(ctx, configurations));
      if ("code" in settings) return { success: false, error: settings };

      const projectId = generateTypeId("proj");
      const workspace = await prepareCoordinatorWorkspace(projectId);
      const runtime = await resolveCoordinatorRuntime(ctx, settings.coordinator);
      const { project, surveying } = await ctx.eventPublisher.transaction(async (tx) => {
        const created = await createProjectRepository(tx.db).create({ id: projectId, ...settings });
        await insertCoordinatorSession(tx.db, {
          projectId,
          name: created.name,
          runtime,
          workspace,
        });
        await recordProjectUpserted(tx, created);
        return {
          project: created,
          surveying: options.lookAround ? await recordKickoff(tx, created) : false,
        };
      });
      // The survey needs a worktree, which takes a while: the project is answered without it.
      if (surveying) void kickoff.start(projectId);
      return { success: true, project };
    },

    list: () => ctx.projectRepository.list(),

    get: async (projectId) => {
      const project = await ctx.projectRepository.getById(projectId);
      return project ? { success: true, project } : notFound;
    },

    update: async (projectId, sent) => {
      const current = await ctx.projectRepository.getById(projectId);
      if (!current) return notFound;
      const refused = await refuseRepoChange(current, sent.repoIds);
      if (refused) return { success: false, error: refused };
      const patch = await patchRuntimes(sent, current);
      if ("code" in patch) return { success: false, error: patch };

      const project = await applyUpdate(projectId, patch);
      if (!project) return notFound;
      await followUpdate(current, project, patch);
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

    setComputerUse: async (projectId, option) => {
      const available = ComputerUseSchema.safeParse(option);
      if (!available.success) {
        return { success: false, error: { code: "COMPUTER_USE_UNAVAILABLE", option } };
      }
      const project = await ctx.eventPublisher.transaction(async (tx) => {
        const updated = await createProjectRepository(tx.db).setComputerUse(
          projectId,
          available.data,
        );
        if (updated) await recordProjectUpserted(tx, updated);
        return updated;
      });
      return project ? { success: true, project } : notFound;
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
      // The project's Linear key and Jira token are kept outside its directory; they go with it.
      await removeProjectConnections(projectId);
      return { success: true };
    },

    sendToCoordinator: async (projectId, text, { origin, images = [], midRunMode } = {}) => {
      const coordinator = await activeCoordinator(projectId);
      if ("error" in coordinator) return { success: false, error: coordinator.error };
      const input = await readMessageInput(projectId, text, images);
      if ("error" in input) return { success: false, error: input.error };

      const sent = await chat.sendMessage(coordinator.id, {
        content: text,
        origin,
        imageAttachments: input.images,
        midRunMode,
      });
      if (!sent.success) {
        return { success: false, error: { code: "SEND_FAILED", reason: sent.error.code } };
      }
      await discardStagedImages(projectId, images);
      const message = await getWireMessage(ctx.db, coordinator, sent.message.id);
      if (!message) throw new Error(`Message ${sent.message.id} was stored with nothing to show`);
      return { success: true, message };
    },

    interruptForMessage: async (projectId, messageId) => {
      const result = await chat.interruptForMessage(projectId, messageId);
      return result.success ? { success: true, outcome: result.outcome } : result;
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
