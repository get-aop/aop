import type { ChatSessionSettledOverride, UpdateChatSessionInput } from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import type { ChatSession } from "../db/schema.ts";
import type { RuntimeConfigurationRepository } from "../runtime-configuration/repository.ts";
import { resolveSessionUpdatePatch } from "./runtime-configuration-patch.ts";
import { isSessionRunActive } from "./runtime-engine.ts";
import { sessionDtoFor } from "./session-dto.ts";
import { hasRunningChatRun } from "./session-lifecycle.ts";
import type { UpdateChatSessionResult } from "./session-types.ts";

export const updateChatSession = async (
  ctx: LocalServerContext,
  runtimeConfigurations: RuntimeConfigurationRepository,
  sessionId: string,
  input: UpdateChatSessionInput,
): Promise<UpdateChatSessionResult> => {
  const existing = await ctx.chatSessionRepository.getById(sessionId);
  if (!existing) return { success: false, error: { code: "SESSION_NOT_FOUND" } };

  const patch = await resolveSessionUpdatePatch(runtimeConfigurations, existing, input);
  if (!patch.success) return patch;

  const hasActiveRun = isSessionRunActive(sessionId) || (await hasRunningChatRun(ctx, sessionId));
  const blocked = await sessionUpdateBlocker(input, patch.patch, hasActiveRun);
  if (blocked) return blocked;

  const modelLocked = await startedSessionModelBlocker(ctx, existing, input);
  if (modelLocked) return modelLocked;

  const now = new Date().toISOString();
  const updated = await ctx.chatSessionRepository.update(sessionId, {
    ...patch.patch,
    ...settlementUpdatePatch(input.settledOverride, now),
    updated_at: now,
  });
  if (!updated) return { success: false, error: { code: "SESSION_NOT_FOUND" } };
  return { success: true, session: await sessionDtoFor(ctx, updated) };
};

const sessionUpdateBlocker = async (
  input: UpdateChatSessionInput,
  patch: Partial<ChatSession>,
  hasActiveRun: boolean,
): Promise<UpdateChatSessionResult | null> => {
  if (patch.runtime !== undefined && hasActiveRun) {
    return { success: false, error: { code: "RUN_IN_PROGRESS" } };
  }
  if (input.settledOverride !== "settled") return null;
  if (hasActiveRun) return { success: false, error: { code: "RUN_IN_PROGRESS" } };
  return null;
};

/**
 * Once the first message lands, the model is fixed for the session's lifetime.
 * Only model-picker inputs are rejected; effort, fast mode, access mode, title,
 * pin, settlement, runtime switches, and profile applies remain editable.
 */
const startedSessionModelBlocker = async (
  ctx: LocalServerContext,
  session: ChatSession,
  input: UpdateChatSessionInput,
): Promise<UpdateChatSessionResult | null> => {
  const changesModel = input.model !== undefined || input.runtimeConfigurationId !== undefined;
  if (!changesModel) return null;
  const messageCount = await ctx.chatSessionRepository.countMessages(session.id);
  if (messageCount === 0) return null;
  return { success: false, error: { code: "MODEL_LOCKED" } };
};

const settlementUpdatePatch = (
  override: ChatSessionSettledOverride | undefined,
  now: string,
): Partial<ChatSession> => {
  if (override === "settled") {
    return { settled_override: "settled", settled_at: now, pinned: false };
  }
  if (override === "active") {
    return { settled_override: "active", settled_at: null };
  }
  return {};
};
