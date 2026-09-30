import type { UpdateChatSessionInput } from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import { createRuntimeConfigurationRepository } from "../runtime-configuration/repository.ts";
import { createRuntimeProfileRepository } from "../runtime-profile/repository.ts";
import { ensureAllChatRunRecoveries, ensureSessionChatRunRecovery } from "./run-recovery.ts";
import { retryFreshChatRun, sendChatMessage } from "./send-message.ts";
import { abortChatSession, resetRuntimeSession } from "./session-control.ts";
import { createChatSession } from "./session-create.ts";
import { deleteChatSession } from "./session-delete.ts";
import { sessionDtoFor } from "./session-dto.ts";
import { getChatSession, getChatSessionLocation, listChatSessions } from "./session-read.ts";
import type {
  ChatSessionServiceDeps,
  CreateChatSessionInput,
  MarkChatSessionReadResult,
  SendChatMessageInput,
  UpdateChatSessionResult,
} from "./session-types.ts";
import { updateChatSession } from "./session-update.ts";
import { updateChatWorkspace } from "./session-workspace.ts";

export { waitForPendingChatReplies } from "./reply-state.ts";
export {
  forceAbortChatSessionsForPurge,
  shutdownChatSessions,
} from "./session-control.ts";
export { deriveAutoTitle } from "./session-dto.ts";
export { resolveAssistantLifecycles } from "./session-lifecycle.ts";
export type * from "./session-types.ts";

/** The chat engine's public surface; each method delegates to one focused module. */
export const createChatSessionService = (
  ctx: LocalServerContext,
  deps: ChatSessionServiceDeps = {},
) => {
  void ensureAllChatRunRecoveries(ctx, deps);
  const runtimeProfiles = createRuntimeProfileRepository(ctx.db);
  const runtimeConfigurations = createRuntimeConfigurationRepository(ctx.db);

  return {
    create: (input: CreateChatSessionInput) => createChatSession(ctx, runtimeConfigurations, input),

    list: () => listChatSessions(ctx),

    get: (sessionId: string) => getChatSession(ctx, sessionId, deps),

    location: (sessionId: string) => getChatSessionLocation(ctx, sessionId),

    setWorkspace: (sessionId: string, path: unknown) => updateChatWorkspace(ctx, sessionId, path),

    /** Existence check for SSE stream subscription — no business orchestration. */
    exists: async (sessionId: string): Promise<boolean> => {
      const session = await ctx.chatSessionRepository.getById(sessionId);
      return session !== null;
    },

    /** A project's coordinator and threads are served by the project and thread routes, not the chat routes. */
    belongsToProject: async (sessionId: string): Promise<boolean> => {
      const session = await ctx.chatSessionRepository.getById(sessionId);
      return session?.project_id != null;
    },

    ensureRecovery: (sessionId: string) => ensureSessionChatRunRecovery(ctx, sessionId, deps),

    abort: (sessionId: string) => abortChatSession(ctx, sessionId, deps),

    /** Stop active work if needed and clear the provider runtime binding. */
    resetRuntime: (sessionId: string) => resetRuntimeSession(ctx, sessionId),

    retryFresh: async (sessionId: string, runId: string, confirmed: unknown) => {
      ctx.sessionMutationLock.assertAllowed("retry", { sessionId });
      return retryFreshChatRun(ctx, deps, sessionId, runId, confirmed);
    },

    delete: (sessionId: string) => deleteChatSession(ctx, sessionId),

    update: (sessionId: string, input: UpdateChatSessionInput): Promise<UpdateChatSessionResult> =>
      updateChatSession(ctx, runtimeProfiles, runtimeConfigurations, sessionId, input),

    markRead: async (sessionId: string): Promise<MarkChatSessionReadResult> => {
      const updated = await ctx.chatSessionRepository.update(sessionId, {
        last_read_at: new Date().toISOString(),
      });
      if (!updated) {
        return { success: false, error: { code: "SESSION_NOT_FOUND" } };
      }
      return { success: true, session: await sessionDtoFor(ctx, updated) };
    },

    sendMessage: (sessionId: string, input: SendChatMessageInput) =>
      sendChatMessage(ctx, runtimeConfigurations, sessionId, input, deps),
  };
};
