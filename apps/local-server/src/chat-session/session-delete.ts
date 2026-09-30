import { rm } from "node:fs/promises";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import { processCheckpointCleanupJobs } from "./checkpoint-cleanup-service.ts";
import { isSessionRunActive } from "./runtime-engine.ts";
import { hasRunningChatRun } from "./session-lifecycle.ts";
import type { DeleteChatSessionResult } from "./session-types.ts";

export const deleteChatSession = async (
  ctx: LocalServerContext,
  sessionId: string,
): Promise<DeleteChatSessionResult> => {
  const session = await ctx.chatSessionRepository.getById(sessionId);
  if (!session) return { success: false, error: { code: "SESSION_NOT_FOUND" } };
  if (isSessionRunActive(sessionId) || (await hasRunningChatRun(ctx, sessionId))) {
    return { success: false, error: { code: "RUN_IN_PROGRESS" } };
  }

  const deleted = await ctx.sessionMutationLock.withSessions([sessionId], () =>
    ctx.chatSessionRepository.deleteGraph(sessionId),
  );
  if (!deleted.deleted) return { success: false, error: { code: "SESSION_NOT_FOUND" } };

  await deleteSessionCheckpointRefs(ctx, deleted.cleanupJobIds);
  removeSessionArtifactDirs(sessionId);
  return { success: true };
};

/** Deletes the hidden refs now; anything left over is retried on next boot. */
const deleteSessionCheckpointRefs = async (
  ctx: LocalServerContext,
  cleanupJobIds: string[],
): Promise<void> => {
  if (cleanupJobIds.length === 0) return;
  await processCheckpointCleanupJobs(
    { repository: ctx.chatCheckpointCleanupRepository },
    { jobIds: cleanupJobIds, limit: cleanupJobIds.length, leaseMs: 0 },
  );
};

/** Best-effort cleanup of the session's runtime logs. */
const removeSessionArtifactDirs = (sessionId: string): void => {
  void rm(join(aopPaths.logs(), "chat-sessions", sessionId), {
    recursive: true,
    force: true,
  }).catch(() => undefined);
};
