import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  type ChatAbortDisposition,
  type ChatActionPayload,
  type ChatDocumentAttachment,
  type ChatRuntimeActionIntent,
  type ChatRuntimeActionSelection,
  type ChatSessionLifecycle,
  type ChatSessionSettledOverride,
  type ChatSessionSummary,
  type ControlCommand,
  type CreateTaskImageAttachment,
  getDefaultRuntimeConfigurationModel,
  getDefaultWorkflowRuntimeModel,
  getDefaultWorkflowRuntimeReasoning,
  getWorkflowModelOptions,
  isWorkflowRuntimeProvider,
  parseControlCommand,
  parseRuntimeDelegation,
  type RuntimeConfigurationProvider,
  type RuntimeDelegation,
  resolveRuntimeConfigurationReasoning,
  runtimeConfigurationSupportsFastMode,
  type TerminalLine,
  type UpdateChatSessionInput,
  type WorkflowRuntimeProvider,
  type WorkflowRuntimeReasoning,
} from "@aop/common";
import { aopPaths, generateTypeId, resolveExecHost } from "@aop/infra";
import { getControlCapabilityUnsupportedReason } from "@aop/llm-provider";
import type { LocalServerContext } from "../context.ts";
import type {
  ChatContextStrategy,
  ChatMessage,
  ChatRun,
  ChatRunFailureKind,
  ChatRunInterruptionKind,
  ChatSession,
  Repo,
  Workflow,
} from "../db/schema.ts";
import {
  createRuntimeConfigurationRepository,
  type RuntimeConfigurationRepository,
} from "../runtime-configuration/repository.ts";
import {
  createRuntimeProfileRepository,
  type RuntimeProfileRepository,
} from "../runtime-profile/repository.ts";
import { isChatMidRunMode } from "../settings/types.ts";
import { createBackgroundTaskTracker } from "./background-task-tracker.ts";
import { waitForChatRunTerminal } from "./chat-run-recovery.ts";
import { processCheckpointCleanupJobs } from "./checkpoint-cleanup-service.ts";
import { executeChatCommand } from "./commands.ts";
import { prepareConversationPrompt } from "./conversation-history.ts";
import {
  delegationOutcomeFor,
  finishDelegationRun,
  relayDelegationProgress,
  startDelegationRun,
  withHostDelegationLock,
} from "./delegation-runs.ts";
import { prepareFreshRetry } from "./fresh-retry.ts";
import {
  allowedDirectoriesForChatAttachments,
  buildRuntimePrompt,
  type ChatMessageDocumentDto,
  type ChatMessageImageDto,
  decodeMessageContent,
  encodeMessageContent,
  expandStoredPastes,
  loadChatGlobalInstructions,
  materializeChatDocuments,
  materializeChatImages,
  type StoredChatArtifact,
  type StoredChatDocument,
  type StoredChatImage,
  type StoredChatPaste,
  validateChatDocumentAttachments,
  validateChatImageAttachments,
  validateChatPastes,
} from "./message-images.ts";
import { type FinalizeChatRunOutcome, persistFinalizedChatRun } from "./run-finalization.ts";
import { formatRuntimeActionReports, runRuntimeActionPlan } from "./runtime-action-runner.ts";
import {
  allocateFreshRuntimeSession,
  persistActiveRuntimeSession,
  retireStaleRuntimeSession,
} from "./runtime-binding.ts";
import { RUNTIME_DELEGATION_EXECUTION_CONTRACT } from "./runtime-delegation-contract.ts";
import {
  activeSessionRunIds,
  type CreateProviderFn,
  createSessionRunLogPath,
  interruptSessionRun,
  isGrokRuntime,
  isSessionRunActive,
  type RuntimeRunResult,
  registerPendingSessionRun,
  releaseSessionRunRegistration,
  runSessionPrompt,
  type SessionRunRegistration,
  sessionRunPhase,
} from "./runtime-engine.ts";
import { resolveChatRuntimeTimeoutPolicy } from "./runtime-timeout-policy.ts";
import { publishChatSessionEvent } from "./session-events.ts";
import { discoverRuntimeSkills } from "./skill-discovery.ts";
import {
  cancelQueuedSteers,
  claimNextQueuedSteer,
  isChatSessionBusy,
  storeSteerUserMessage,
} from "./steer-queue.ts";
import { finalizeActivityContent, type StreamProgressSnapshot } from "./stream-progress.ts";
import { runTerminalCommand } from "./terminal.ts";
import { nextChatTurnIndex } from "./turn-order.ts";
import { buildUpdatePatch } from "./update-patch.ts";
import {
  createWorkflowRunRecord,
  executeChatWorkflowRun,
  hasActiveWorkflowRun,
  interruptStaleWorkflowRuns,
} from "./workflow-run.ts";
import {
  resolveChatWorkspace,
  resolveSessionWorkspaceBinding,
  setSessionWorkspaceBinding,
  WorkspaceBindingError,
} from "./workspace-binding.ts";

const DEFAULT_RUNTIME: WorkflowRuntimeProvider = "claude-code";
const DEFAULT_EFFORT: WorkflowRuntimeReasoning = "medium";
const DEFAULT_TITLE = "New session";
const DEFAULT_GENERAL_TITLE = "New task";
const SNIPPET_MAX = 46;

/** The shared wire contract; kept as an alias so no app owns a private copy. */
export type ChatSessionDto = ChatSessionSummary;

export interface ChatMessageDto {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  action: ChatActionPayload | null;
  activity?: AssistantActivity | null;
  createdAt: string;
  /** User-attached images for this message (empty for assistant replies). */
  images: ChatMessageImageDto[];
  /** User-attached documents for this message (empty for assistant replies). */
  documents: ChatMessageDocumentDto[];
  /** Workspace files created or changed by the assistant runtime. */
  artifacts?: StoredChatArtifact[];
  runStatus?: ChatRun["status"];
  interruptionKind?: ChatRunInterruptionKind | null;
  failureKind?: ChatRunFailureKind | null;
  contextStrategy?: ChatRun["context_strategy"];
  workspacePath?: string | null;
  timeoutPolicy?: string | null;
  retryOfRunId?: string | null;
  disposition?: ChatMessage["disposition"];
  runId?: string;
}

interface AssistantActivity {
  thinking: string;
  content: string;
  commandGroups: StreamProgressSnapshot["commandGroups"];
}

export interface ChatSessionDetailDto extends ChatSessionDto {
  messages: ChatMessageDto[];
  assistantActive: boolean;
  /** Discoverable runtime actions for the Skills submenu and direct slash invocation. */
  skills: string[];
}

export type RunTerminalResult =
  | { success: true; lines: TerminalLine[] }
  | {
      success: false;
      error:
        | { code: "SESSION_NOT_FOUND" }
        | { code: "REPO_NOT_FOUND" }
        | { code: "INVALID_COMMAND" };
    };

export type CreateChatSessionResult =
  | { success: true; session: ChatSessionDto }
  | { success: false; error: { code: "INVALID_REPO" } | { code: "REPO_NOT_FOUND" } };

export type GetChatSessionResult =
  | { success: true; session: ChatSessionDetailDto }
  | { success: false; error: { code: "SESSION_NOT_FOUND" } | WorkspaceBindingFailure };

type WorkspaceBindingFailure = {
  code: "WORKSPACE_BINDING_ERROR";
  message: string;
  path: string | null;
  resettable: boolean;
};

export type AbortChatSessionResult =
  | { success: true; aborted: boolean; disposition: ChatAbortDisposition }
  | { success: false; error: { code: "SESSION_NOT_FOUND" } };

export type ResetRuntimeSessionResult =
  | { success: true; reset: true; clearedBinding: boolean; cancelledRun: boolean }
  | { success: false; error: { code: "SESSION_NOT_FOUND" } };
export type MarkChatSessionReadResult =
  | { success: true; session: ChatSessionDto }
  | { success: false; error: { code: "SESSION_NOT_FOUND" } };

export type UpdateChatWorkspaceResult =
  | { success: true; session: ChatSessionDto }
  | {
      success: false;
      error: { code: "SESSION_NOT_FOUND" } | WorkspaceBindingFailure;
    };
export type RetryFreshChatRunResult =
  | { success: true; message: ChatMessageDto; session: ChatSessionDto; existing: boolean }
  | {
      success: false;
      error:
        | { code: "SESSION_NOT_FOUND" }
        | { code: "RUN_NOT_RETRYABLE" }
        | { code: "CONFIRMATION_REQUIRED" }
        | { code: "RUN_IN_PROGRESS" };
    };
export type DeleteChatSessionResult =
  | { success: true }
  | {
      success: false;
      error: { code: "SESSION_NOT_FOUND" } | { code: "RUN_IN_PROGRESS" };
    };

export type UpdateChatSessionResult =
  | { success: true; session: ChatSessionDto }
  | {
      success: false;
      error:
        | { code: "SESSION_NOT_FOUND" }
        | { code: "INVALID_RUNTIME" }
        | { code: "INVALID_MODEL" }
        | { code: "INVALID_EFFORT" }
        | { code: "INVALID_FAST_MODE" }
        | { code: "INVALID_ACCESS_MODE" }
        | { code: "INVALID_SETTLED_OVERRIDE" }
        | { code: "INVALID_TITLE" }
        | { code: "RUNTIME_PROFILE_NOT_FOUND" }
        | { code: "RUNTIME_CONFIGURATION_NOT_FOUND" }
        | { code: "RUN_IN_PROGRESS" }
        | { code: "MODEL_LOCKED" }
        | { code: "REPOSITORY_REQUIRED" };
    };

export type SendChatMessageResult =
  | {
      success: true;
      message: ChatMessageDto;
      session: ChatSessionDto;
      /**
       * Mid-run handling when the assistant was already active:
       * - queued: wait for the current reply, then process this message
       * - steered: interrupt the current reply, then process this message
       */
      midRun?: "queued" | "steered";
      /** @deprecated Prefer midRun — kept for older clients. */
      queued?: boolean;
      steered?: boolean;
    }
  | {
      success: false;
      error:
        | { code: "SESSION_NOT_FOUND" }
        | { code: "INVALID_CONTENT"; message?: string }
        | { code: "INVALID_MID_RUN_MODE" }
        | { code: "INVALID_IMAGES"; message: string }
        | { code: "INVALID_DOCUMENTS"; message: string }
        | { code: "RUNTIME_CONFIGURATION_NOT_FOUND" }
        | { code: "INVALID_ORCHESTRATION"; message: string }
        | { code: "WORKFLOW_NOT_FOUND" }
        | { code: "WORKFLOW_RUN_IN_PROGRESS" }
        | { code: "REPOSITORY_REQUIRED" }
        | { code: "TOOL_INTERRUPT_CONFIRMATION_REQUIRED" }
        | { code: "RUN_IN_PROGRESS" };
    };

export interface SendChatMessageInput {
  content: unknown;
  imageAttachments?: unknown;
  documentAttachments?: unknown;
  /** Compact-token paste bodies; display text keeps `[paste #N +lines]`. */
  pastes?: unknown;
  midRunMode?: unknown;
  confirmToolInterrupt?: unknown;
  workflowId?: unknown;
  /** When true, the message triggers the armed chat workflow run instead of a normal reply. */
  workflowArmed?: unknown;
  runtimeActions?: unknown;
}

export interface ChatSessionServiceDeps {
  createProviderFn?: CreateProviderFn;
  recoveryPollIntervalMs?: number;
  /** Test seam for holding accepted work before provider preparation starts. */
  beforeAssistantReply?: (run: ChatRun) => Promise<void>;
  /** Test seam for observing queued lifecycle ownership before durable claim. */
  beforeQueuedRunClaim?: (sessionId: string) => Promise<void>;
}

interface CreateChatSessionInput {
  repoId?: unknown;
  scope?: unknown;
}

const updateChatWorkspace = async (
  ctx: LocalServerContext,
  sessionId: string,
  path: unknown,
): Promise<UpdateChatWorkspaceResult> => {
  ctx.sessionMutationLock.assertAllowed("workspace", { sessionId });
  try {
    const updated = await setSessionWorkspaceBinding(ctx, sessionId, normalizeWorkspacePath(path));
    if (!updated) return { success: false, error: { code: "SESSION_NOT_FOUND" } };
    return { success: true, session: await sessionDtoFor(ctx, updated) };
  } catch (error) {
    if (error instanceof WorkspaceBindingError) {
      return { success: false, error: workspaceBindingFailure(error) };
    }
    throw error;
  }
};

const normalizeWorkspacePath = (path: unknown): string | null => {
  if (path === null) return null;
  if (typeof path === "string" && path.trim()) return path.trim();
  throw new WorkspaceBindingError("An absolute workspace path is required");
};

export const createChatSessionService = (
  ctx: LocalServerContext,
  deps: ChatSessionServiceDeps = {},
) => {
  void ensureAllChatRunRecoveries(ctx, deps);
  const runtimeProfiles = createRuntimeProfileRepository(ctx.db);
  const runtimeConfigurations = createRuntimeConfigurationRepository(ctx.db);

  return {
    create: async (input: CreateChatSessionInput): Promise<CreateChatSessionResult> => {
      const target = await resolveCreateSessionTarget(ctx, input);
      if (!target.success) return target;
      ctx.sessionMutationLock.assertAllowed("create", { repoId: target.repo?.id ?? null });

      const defaults = await resolveCreateSessionRuntimeDefaults(runtimeConfigurations);
      const now = new Date().toISOString();
      const workspacePath = target.repo
        ? await resolveChatWorkspace(target.repo.path, null)
        : await ensureGeneralChatWorkspace();
      const session = await ctx.chatSessionRepository.create({
        id: generateTypeId("isess"),
        repo_id: target.repo?.id ?? null,
        title: target.title,
        named: false,
        runtime: defaults.runtime,
        runtime_configuration_id: defaults.runtimeConfigurationId,
        model: defaults.model,
        reasoning_effort: defaults.reasoningEffort,
        runtime_alias: defaults.runtimeAlias,
        runtime_session_id: null,
        workspace_path: workspacePath,
        fast_mode: defaults.fastMode,
        runtime_access_mode: "full-access",
        default_worker_id: null,
        default_workflow_id: null,
        pinned: false,
        settled_override: null,
        settled_at: null,
        created_at: now,
        updated_at: now,
      });

      return {
        success: true,
        session: toSessionDto(session, {
          repo_name: target.repo?.name ?? null,
          repo_path: target.repo?.path ?? null,
          last_message_content: null,
          last_message_at: null,
        }),
      };
    },

    list: async (): Promise<{ sessions: ChatSessionDto[] }> => {
      const [rows, pendingApprovalSessionIds] = await Promise.all([
        ctx.chatSessionRepository.list(),
        listPendingApprovalSessionIds(ctx),
      ]);
      const locations = new Map<string, Promise<{ worktreePath: string; branch: string | null }>>();
      const sessions = await Promise.all(
        rows.map(async (row) => {
          const session = toSessionDto(row, row);
          const location =
            locations.get(session.workspacePath) ?? readSessionGitLocation(session.workspacePath);
          locations.set(session.workspacePath, location);
          const [lifecycle, gitLocation] = await Promise.all([
            resolveAssistantLifecycle(ctx, row.id),
            location,
          ]);
          return {
            ...session,
            branch: gitLocation.branch,
            hasPendingApproval: pendingApprovalSessionIds.has(row.id),
            assistantActive: lifecycle !== "idle",
            assistantLifecycle: lifecycle,
          };
        }),
      );
      return { sessions };
    },

    get: async (sessionId: string): Promise<GetChatSessionResult> => {
      const session = await ctx.chatSessionRepository.getById(sessionId);
      if (!session) return { success: false, error: { code: "SESSION_NOT_FOUND" } };
      return loadChatSessionDetail(ctx, session, deps);
    },

    location: async (sessionId: string) => {
      const session = await ctx.chatSessionRepository.getById(sessionId);
      if (!session) {
        return { success: false as const, error: { code: "SESSION_NOT_FOUND" as const } };
      }

      const workspaceResult = await resolveSessionWorkspaceResult(ctx, session);
      if (!workspaceResult.success) return workspaceResult;
      return {
        success: true as const,
        location: await readSessionGitLocation(workspaceResult.workspace ?? ""),
      };
    },

    setWorkspace: (sessionId: string, path: unknown): Promise<UpdateChatWorkspaceResult> =>
      updateChatWorkspace(ctx, sessionId, path),

    /** Existence check for SSE stream subscription — no business orchestration. */
    exists: async (sessionId: string): Promise<boolean> => {
      const session = await ctx.chatSessionRepository.getById(sessionId);
      return session !== null;
    },

    ensureRecovery: async (sessionId: string): Promise<void> => {
      await ensureSessionChatRunRecovery(ctx, sessionId, deps);
    },

    abort: async (sessionId: string): Promise<AbortChatSessionResult> => {
      const session = await ctx.chatSessionRepository.getById(sessionId);
      if (!session) return { success: false, error: { code: "SESSION_NOT_FOUND" } };

      // Stop ends the current reply only. Queued follow-ups survive so the drain
      // starts the next one — stopping steers the conversation, it does not purge
      // messages the user already committed to sending.
      const liveRunAborted = interruptSessionRun(sessionId, "abort");
      const pendingAccepted = pendingSessionReplies.has(sessionId);
      if (liveRunAborted || pendingAccepted) {
        abortRequestedSessions.add(sessionId);
        return { success: true, aborted: true, disposition: "interrupt_requested" };
      }

      const orphanedRun = await ctx.db
        .selectFrom("chat_runs")
        .selectAll()
        .where("session_id", "=", sessionId)
        .where("status", "=", "running")
        .executeTakeFirst();
      if (!orphanedRun) return { success: true, aborted: false, disposition: "none" };

      // Durable-only recovery: do not claim OS-level kill; cancel durable state only.
      await cancelChatRunRecovery(orphanedRun.id);
      await finalizeChatRunAndPublish(
        ctx,
        orphanedRun,
        "Stopped after the app restarted.",
        null,
        orphanedRun.runtime_session_id ?? session.runtime_session_id,
        { status: "cancelled", interruptionKind: "abort", errorMessage: null },
      );
      // No in-flight reply will reach its drain, so start the queue here instead.
      await drainQueuedSteers(ctx, sessionId, session.runtime, deps);
      return { success: true, aborted: true, disposition: "durable_cancelled" };
    },

    /** Stop active work if needed and clear the provider runtime binding. */
    resetRuntime: (sessionId: string): Promise<ResetRuntimeSessionResult> =>
      resetRuntimeSession(ctx, sessionId),
    retryFresh: async (
      sessionId: string,
      runId: string,
      confirmed: unknown,
    ): Promise<RetryFreshChatRunResult> => {
      ctx.sessionMutationLock.assertAllowed("retry", { sessionId });
      return retryFreshChatRun(ctx, deps, pendingSessionReplies, sessionId, runId, confirmed);
    },
    delete: async (sessionId: string): Promise<DeleteChatSessionResult> => {
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
    },

    runTerminal: async (sessionId: string, command: unknown): Promise<RunTerminalResult> => {
      const session = await ctx.chatSessionRepository.getById(sessionId);
      if (!session) {
        return { success: false, error: { code: "SESSION_NOT_FOUND" } };
      }
      const cmd = typeof command === "string" ? command : "";
      if (!cmd.trim()) {
        return { success: false, error: { code: "INVALID_COMMAND" } };
      }
      const workspace = await resolveSessionWorkspace(ctx, session);
      if (!workspace) {
        return { success: false, error: { code: "REPO_NOT_FOUND" } };
      }
      const lines = await runTerminalCommand({
        sessionId,
        cwd: workspace,
        command: cmd,
        publish: true,
      });
      return { success: true, lines };
    },

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

    sendMessage: async (
      sessionId: string,
      input: SendChatMessageInput,
    ): Promise<SendChatMessageResult> => {
      if (input.midRunMode !== undefined && !isChatMidRunMode(input.midRunMode)) {
        return { success: false, error: { code: "INVALID_MID_RUN_MODE" } };
      }
      ctx.sessionMutationLock.assertAllowed("send", { sessionId });
      // Mid-run: accept the user message now (queue or interrupt+steer per setting).
      if (await isChatSessionBusy(ctx, sessionId, pendingSessionReplies)) {
        return acceptMidRunMessage(ctx, runtimeConfigurations, sessionId, input, deps);
      }
      return acceptIdleSessionMessage(ctx, runtimeConfigurations, sessionId, input, deps);
    },
  };
};

const updateChatSession = async (
  ctx: LocalServerContext,
  runtimeProfiles: RuntimeProfileRepository,
  runtimeConfigurations: RuntimeConfigurationRepository,
  sessionId: string,
  input: UpdateChatSessionInput,
): Promise<UpdateChatSessionResult> => {
  const existing = await ctx.chatSessionRepository.getById(sessionId);
  if (!existing) return { success: false, error: { code: "SESSION_NOT_FOUND" } };

  const patch = await resolveSessionUpdatePatch(
    runtimeProfiles,
    runtimeConfigurations,
    existing,
    input,
  );
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

type CreateSessionTargetResult =
  | { success: true; repo: Repo | null; title: string }
  | { success: false; error: { code: "INVALID_REPO" } | { code: "REPO_NOT_FOUND" } };

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

/** Best-effort cleanup of main, delegated, and control runtime artifacts. */
const removeSessionArtifactDirs = (sessionId: string): void => {
  const artifactRoot = join(aopPaths.logs(), "chat-sessions");
  for (const suffix of ["", "-delegate", "-control"]) {
    void rm(join(artifactRoot, `${sessionId}${suffix}`), {
      recursive: true,
      force: true,
    }).catch(() => undefined);
  }
};

const resolveCreateSessionTarget = async (
  ctx: LocalServerContext,
  input: CreateChatSessionInput,
): Promise<CreateSessionTargetResult> => {
  if (input.scope === "general") {
    await ensureGeneralChatWorkspace();
    return { success: true, repo: null, title: DEFAULT_GENERAL_TITLE };
  }
  if (typeof input.repoId !== "string" || !input.repoId.trim()) {
    return { success: false, error: { code: "INVALID_REPO" } };
  }
  const repo = await ctx.repoRepository.getById(input.repoId.trim());
  if (!repo) return { success: false, error: { code: "REPO_NOT_FOUND" } };
  return { success: true, repo, title: DEFAULT_TITLE };
};

const acceptIdleSessionMessage = async (
  ctx: LocalServerContext,
  runtimeConfigurations: RuntimeConfigurationRepository,
  sessionId: string,
  input: SendChatMessageInput,
  deps: ChatSessionServiceDeps,
): Promise<SendChatMessageResult> => {
  const existing = await ctx.chatSessionRepository.getById(sessionId);
  if (!existing) return { success: false, error: { code: "SESSION_NOT_FOUND" } };

  // Register lifecycle ownership before durable insert/background so abort/steer
  // can cancel pending work without falling back to "no conversation".
  const registration = registerPendingSessionRun(sessionId, existing.runtime);
  if (!registration) {
    return { success: false, error: { code: "RUN_IN_PROGRESS" } };
  }

  let transferredRegistration = false;
  try {
    const prepared = await prepareSend(ctx, runtimeConfigurations, sessionId, input, deps);
    if (!prepared.success) return prepared;

    if (prepared.workflowRunStarted) {
      // The armed workflow runs under its own lock; no chat-run lifecycle here.
      releaseSessionRunRegistration(registration);
      abortRequestedSessions.delete(sessionId);
      const sessionDto = await sessionDtoFor(ctx, prepared.session, prepared.displayText);
      publishChatSessionEvent({ type: "session-updated", sessionId, session: sessionDto });
      return {
        success: true,
        message: toMessageDto(prepared.message),
        session: sessionDto,
      };
    }

    pendingSessionReplies.add(sessionId);

    trackBackgroundReply(
      completeAssistantReplyInBackground({
        ctx,
        sessionId,
        session: prepared.session,
        displayText: prepared.displayText,
        runtimePrompt: prepared.runtimePrompt,
        images: prepared.images,
        documents: prepared.documents,
        run: prepared.run,
        registration,
        createProviderFn: deps.createProviderFn,
        beforeAssistantReply: deps.beforeAssistantReply,
        beforeQueuedRunClaim: deps.beforeQueuedRunClaim,
      }),
    );
    transferredRegistration = true;
    // Accept immediately; finish the assistant reply in the background so multi-minute
    // Grok/Codex runs do not hit Bun.serve idleTimeout (502 / request failed).
    const sessionDto = await sessionDtoFor(
      ctx,
      prepared.session,
      prepared.displayText || "(image attachment)",
      prepared.userMessage.created_at,
    );
    publishChatSessionEvent({ type: "session-updated", sessionId, session: sessionDto });
    return {
      success: true,
      message: toMessageDto(prepared.userMessage, prepared.run),
      session: sessionDto,
    };
  } finally {
    if (!transferredRegistration) {
      releaseSessionRunRegistration(registration);
      abortRequestedSessions.delete(sessionId);
    }
  }
};

const retryFreshChatRun = async (
  ctx: LocalServerContext,
  deps: ChatSessionServiceDeps,
  pendingSessionReplies: Set<string>,
  sessionId: string,
  runId: string,
  confirmed: unknown,
): Promise<RetryFreshChatRunResult> => {
  if (confirmed !== true) {
    return { success: false, error: { code: "CONFIRMATION_REQUIRED" } };
  }
  const session = await ctx.chatSessionRepository.getById(sessionId);
  if (!session) return { success: false, error: { code: "SESSION_NOT_FOUND" } };
  const registration = registerPendingSessionRun(sessionId, session.runtime);
  if (!registration) {
    return { success: false, error: { code: "RUN_IN_PROGRESS" } };
  }

  let transferredRegistration = false;
  try {
    const prepared = await prepareFreshRetry(ctx, sessionId, runId, confirmed);
    if (!prepared.success) return prepared;
    if (prepared.existing) {
      return {
        success: true,
        message: toMessageDto(prepared.message, prepared.run),
        session: await sessionDtoFor(ctx, prepared.session),
        existing: true,
      };
    }

    pendingSessionReplies.add(sessionId);
    trackBackgroundReply(
      completeAssistantReplyInBackground({
        ctx,
        sessionId,
        session: prepared.session,
        displayText: prepared.displayText,
        runtimePrompt: prepared.runtimePrompt,
        images: prepared.images,
        documents: prepared.documents,
        run: prepared.run,
        registration,
        createProviderFn: deps.createProviderFn,
        beforeAssistantReply: deps.beforeAssistantReply,
        beforeQueuedRunClaim: deps.beforeQueuedRunClaim,
      }),
    );
    transferredRegistration = true;
    return {
      success: true,
      message: toMessageDto(prepared.message, prepared.run),
      session: await sessionDtoFor(ctx, prepared.session),
      existing: false,
    };
  } finally {
    if (!transferredRegistration) {
      releaseSessionRunRegistration(registration);
      abortRequestedSessions.delete(sessionId);
    }
  }
};

const findSessionRepo = async (
  ctx: LocalServerContext,
  session: ChatSession,
): Promise<Repo | null> => {
  if (!session.repo_id) return null;
  return ctx.repoRepository.getById(session.repo_id);
};

const loadChatSessionDetail = async (
  ctx: LocalServerContext,
  session: ChatSession,
  deps: ChatSessionServiceDeps,
): Promise<GetChatSessionResult> => {
  void ensureSessionChatRunRecovery(ctx, session.id, deps);
  const workspaceResult = await resolveSessionWorkspaceResult(ctx, session);
  if (!workspaceResult.success) return workspaceResult;

  const [repo, messages, runs, skills, lifecycle] = await Promise.all([
    findSessionRepo(ctx, session),
    ctx.chatSessionRepository.listMessages(session.id),
    ctx.db.selectFrom("chat_runs").selectAll().where("session_id", "=", session.id).execute(),
    discoverRuntimeSkills(session.runtime, workspaceResult.workspace ?? ""),
    resolveAssistantLifecycle(ctx, session.id),
  ]);
  const runsByMessage = indexRunsByMessage(runs);
  const last = messages.at(-1) ?? null;
  return {
    success: true,
    session: {
      ...toSessionDto(session, {
        repo_name: repo?.name ?? null,
        repo_path: repo?.path ?? null,
        last_message_content: last?.content ?? null,
        last_message_at: last?.created_at ?? null,
        unread_count: countUnreadAssistantMessages(messages, session.last_read_at),
      }),
      messages: messages.map((message) => toMessageDto(message, runsByMessage.get(message.id))),
      assistantActive: lifecycle !== "idle",
      assistantLifecycle: lifecycle,
      skills,
    },
  };
};

const indexRunsByMessage = (runs: ChatRun[]): Map<string, ChatRun> => {
  const byMessage = new Map<string, ChatRun>();
  for (const run of runs) {
    byMessage.set(run.user_message_id, run);
    byMessage.set(run.assistant_message_id, run);
  }
  return byMessage;
};

const resolveSessionWorkspaceResult = async (
  ctx: LocalServerContext,
  session: ChatSession,
): Promise<
  { success: true; workspace: string | null } | { success: false; error: WorkspaceBindingFailure }
> => {
  try {
    return { success: true, workspace: await resolveSessionWorkspace(ctx, session) };
  } catch (error) {
    if (error instanceof WorkspaceBindingError) {
      return { success: false, error: workspaceBindingFailure(error) };
    }
    throw error;
  }
};

const resolveSessionWorkspace = async (
  ctx: LocalServerContext,
  session: ChatSession,
): Promise<string | null> => {
  return resolveSessionWorkspaceBinding(ctx, session);
};

const workspaceBindingFailure = (error: WorkspaceBindingError): WorkspaceBindingFailure => ({
  code: "WORKSPACE_BINDING_ERROR",
  message: error.message,
  path: error.path,
  resettable: error.resettable,
});

const readSessionGitLocation = async (
  workspacePath: string,
): Promise<{ worktreePath: string; branch: string | null }> => {
  if (!workspacePath) return { worktreePath: "", branch: null };

  try {
    const proc = resolveExecHost().spawn({
      cmd: ["git", "rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"],
      cwd: workspacePath,
      stdout: "pipe",
      stderr: "pipe",
    });
    const outputPromise =
      proc.stdout instanceof ReadableStream
        ? new Response(proc.stdout).text()
        : Promise.resolve("");
    const [exitCode, output] = await Promise.all([proc.exited, outputPromise]);
    if (exitCode !== 0) return { worktreePath: workspacePath, branch: null };

    const [worktreePath, branch] = output.trim().split(/\r?\n/);
    return {
      worktreePath: worktreePath?.trim() || workspacePath,
      branch: branch?.trim() || null,
    };
  } catch {
    return { worktreePath: workspacePath, branch: null };
  }
};

const acceptMidRunMessage = async (
  ctx: LocalServerContext,
  runtimeConfigurations: RuntimeConfigurationRepository,
  sessionId: string,
  input: SendChatMessageInput,
  deps: ChatSessionServiceDeps,
): Promise<SendChatMessageResult> => {
  const stored = await storeValidatedMidRunMessage(
    ctx,
    runtimeConfigurations,
    sessionId,
    input,
    "queued",
  );
  if (!stored.success) return stored;

  // Slash commands never wait on an LLM — execute immediately even mid-run.
  const immediate = await tryImmediateMidRunSlash(ctx, sessionId, stored);
  if (immediate) return immediate;

  const sessionDto = await sessionDtoFor(
    ctx,
    stored.session,
    stored.displayText || "(image attachment)",
    stored.userMessage.created_at,
  );
  publishChatSessionEvent({ type: "session-updated", sessionId, session: sessionDto });

  // Drain only if the active run already finished while this message was stored.
  void drainQueuedSteers(ctx, sessionId, stored.session.runtime, deps);

  return {
    success: true,
    message: toMessageDto(stored.userMessage),
    session: sessionDto,
    midRun: "queued",
    queued: true,
    steered: false,
  };
};

const storeValidatedMidRunMessage = async (
  ctx: LocalServerContext,
  runtimeConfigurations: RuntimeConfigurationRepository,
  sessionId: string,
  input: SendChatMessageInput,
  disposition: "queued" | "steered",
) => {
  const session = await ctx.chatSessionRepository.getById(sessionId);
  if (!session) return { success: false as const, error: { code: "SESSION_NOT_FOUND" as const } };
  const orchestration = await resolveMessageOrchestration(
    ctx,
    runtimeConfigurations,
    session,
    input,
  );
  if (!orchestration.success) return orchestration;
  return storeSteerUserMessage(
    ctx,
    sessionId,
    { ...input, action: orchestration.action },
    disposition,
  );
};

/**
 * Deterministic slash commands must not queue as LLM prompts. Claim the
 * user message with a completed run and publish the command reply immediately.
 */
const tryImmediateMidRunSlash = async (
  ctx: LocalServerContext,
  sessionId: string,
  stored: {
    session: ChatSession;
    userMessage: ChatMessage;
    displayText: string;
  },
): Promise<SendChatMessageResult | null> => {
  const text = stored.displayText.trim();
  if (!text.startsWith("/")) return null;

  const command = await executeChatCommand(ctx, stored.session, text || "(image attachment)");
  if (!command || command.forwardToRuntime) return null;

  let nextSession = stored.session;
  if (command.sessionPatch) {
    nextSession =
      (await ctx.chatSessionRepository.update(sessionId, {
        ...command.sessionPatch,
        updated_at: new Date().toISOString(),
      })) ?? stored.session;
  }

  const assistantMessageId = generateTypeId("smsg");
  const runId = generateTypeId("crun");
  const now = new Date().toISOString();
  const logFilePath = await createSessionRunLogPath(sessionId);
  const turnIndex = stored.userMessage.turn_index;

  await ctx.db.transaction().execute(async (trx) => {
    await trx
      .insertInto("chat_runs")
      .values({
        id: runId,
        session_id: sessionId,
        user_message_id: stored.userMessage.id,
        assistant_message_id: assistantMessageId,
        runtime: nextSession.runtime,
        log_file_path: logFilePath,
        status: "completed",
        runtime_session_id: nextSession.runtime_session_id,
        resume_session_id: nextSession.runtime_session_id,
        failure_kind: null,
        interruption_kind: null,
        context_strategy: nextSession.runtime_session_id ? "native_resume" : "fresh",
        workspace_path: nextSession.workspace_path,
        timeout_policy: null,
        retry_of_run_id: null,
        runtime_session_state: nextSession.runtime_session_id ? "confirmed" : null,
        error_message: null,
        created_at: now,
        updated_at: now,
      })
      .execute();
    await trx
      .insertInto("chat_messages")
      .values({
        id: assistantMessageId,
        session_id: sessionId,
        role: "assistant",
        content: command.text,
        action: command.action ? JSON.stringify(command.action) : null,
        activity: null,
        turn_index: turnIndex,
        disposition: "immediate",
        created_at: now,
      })
      .execute();
    if (command.action) {
    }
  });

  const assistantMessage: ChatMessage = {
    id: assistantMessageId,
    session_id: sessionId,
    role: "assistant",
    content: command.text,
    action: command.action ? JSON.stringify(command.action) : null,
    activity: null,
    turn_index: turnIndex,
    disposition: "immediate",
    created_at: now,
  };
  const sessionDto = await sessionDtoFor(ctx, nextSession, command.text, now);
  publishChatSessionEvent({
    type: "assistant-final",
    sessionId,
    sessionTitle: nextSession.title,
    message: toMessageDto(assistantMessage),
  });
  publishChatSessionEvent({ type: "session-updated", sessionId, session: sessionDto });

  return {
    success: true,
    message: toMessageDto(stored.userMessage),
    session: sessionDto,
  };
};

const drainQueuedSteers = async (
  ctx: LocalServerContext,
  sessionId: string,
  runtime: string,
  deps: ChatSessionServiceDeps,
): Promise<void> => {
  let registration: SessionRunRegistration | null = null;
  try {
    if (abortRequestedSessions.has(sessionId)) return;
    registration = registerPendingSessionRun(sessionId, runtime);
    if (!registration) return;
    await deps.beforeQueuedRunClaim?.(sessionId);
    const claimed = await claimNextQueuedSteer(ctx, sessionId, pendingSessionReplies, registration);
    if (!claimed.success) return;
    pendingSessionReplies.add(sessionId);
    trackBackgroundReply(
      completeAssistantReplyInBackground({
        ctx,
        sessionId,
        session: claimed.session,
        displayText: claimed.displayText,
        runtimePrompt: claimed.runtimePrompt,
        images: claimed.images,
        documents: claimed.documents,
        run: claimed.run,
        registration,
        createProviderFn: deps.createProviderFn,
        beforeAssistantReply: deps.beforeAssistantReply,
        beforeQueuedRunClaim: deps.beforeQueuedRunClaim,
      }),
    );
    registration = null;
  } catch (error) {
    // Teardown / server stop can race with post-reply drain.
    if (isDbClosedError(error)) return;
    throw error;
  } finally {
    if (registration) {
      releaseSessionRunRegistration(registration);
      abortRequestedSessions.delete(sessionId);
    }
  }
};

const resolveSessionUpdatePatch = async (
  runtimeProfiles: RuntimeProfileRepository,
  runtimeConfigurations: RuntimeConfigurationRepository,
  existing: ChatSession,
  input: UpdateChatSessionInput,
) => {
  // Explicit provider switch clears any configuration binding via buildUpdatePatch.
  if (input.runtime !== undefined) return buildUpdatePatch(existing, input);
  if (input.runtimeProfileId) return resolveRuntimeProfilePatch(runtimeProfiles, existing, input);

  const runtimeConfigurationId = resolveUpdateRuntimeConfigurationId(existing, input);
  if (!runtimeConfigurationId) return buildUpdatePatch(existing, input);

  return mergeConfigurationSessionPatch(
    runtimeConfigurations,
    existing,
    input,
    runtimeConfigurationId,
  );
};

const mergeConfigurationSessionPatch = async (
  runtimeConfigurations: RuntimeConfigurationRepository,
  existing: ChatSession,
  input: UpdateChatSessionInput,
  runtimeConfigurationId: string,
) => {
  const configPatch = await resolveRuntimeConfigurationPatch(
    runtimeConfigurations,
    existing,
    {
      ...input,
      runtimeConfigurationId,
      model:
        input.model ?? (input.runtimeConfigurationId === undefined ? existing.model : undefined),
    },
    {
      // User-facing PATCH must reject invalid model/effort; re-apply may fall back.
      strictModel: input.model !== undefined,
      strictEffort: input.reasoningEffort !== undefined,
    },
  );
  if (!configPatch.success) {
    const reapplyingLegacyBinding =
      input.runtimeConfigurationId === undefined &&
      configPatch.error.code === "RUNTIME_CONFIGURATION_NOT_FOUND";
    if (!reapplyingLegacyBinding) return configPatch;

    const legacyPatch = buildUpdatePatch(existing, input);
    if (!legacyPatch.success) return legacyPatch;
    return {
      success: true as const,
      patch: { ...legacyPatch.patch, runtime_configuration_id: null },
    };
  }

  const nonRuntime = buildUpdatePatch(existing, nonRuntimeUpdateInput(input));
  if (!nonRuntime.success) return nonRuntime;

  return {
    success: true as const,
    patch: {
      ...nonRuntime.patch,
      ...configPatch.patch,
    },
  };
};

/** Only re-apply a bound configuration when selecting one or editing runtime fields. */
const resolveUpdateRuntimeConfigurationId = (
  existing: ChatSession,
  input: UpdateChatSessionInput,
): string | undefined => {
  if (input.runtimeConfigurationId) return input.runtimeConfigurationId;
  if (!existing.runtime_configuration_id) return undefined;
  const editsBoundRuntime =
    input.model !== undefined ||
    input.reasoningEffort !== undefined ||
    input.fastMode !== undefined;
  return editsBoundRuntime ? existing.runtime_configuration_id : undefined;
};

const nonRuntimeUpdateInput = (input: UpdateChatSessionInput): UpdateChatSessionInput => ({
  title: input.title,
  named: input.named,
  pinned: input.pinned,
  settledOverride: input.settledOverride,
  runtimeAccessMode: input.runtimeAccessMode,
  defaultWorkerId: input.defaultWorkerId,
  defaultWorkflowId: input.defaultWorkflowId,
});

const resolveRuntimeProfilePatch = async (
  runtimeProfiles: RuntimeProfileRepository,
  existing: ChatSession,
  input: UpdateChatSessionInput,
) => {
  const profile = await runtimeProfiles.get(input.runtimeProfileId ?? "");
  if (!profile) {
    return { success: false as const, error: { code: "RUNTIME_PROFILE_NOT_FOUND" as const } };
  }

  const nonRuntime = buildUpdatePatch(existing, nonRuntimeUpdateInput(input));
  if (!nonRuntime.success) return nonRuntime;

  return {
    success: true as const,
    patch: {
      ...nonRuntime.patch,
      runtime: profile.baseProvider,
      runtime_configuration_id: null,
      model: profile.model,
      reasoning_effort: profile.reasoning,
      runtime_alias: profile.command,
      runtime_session_id: null,
      fast_mode: profile.fastMode,
    },
  };
};

const resolveRuntimeConfigurationPatch = async (
  runtimeConfigurations: RuntimeConfigurationRepository,
  existing: ChatSession,
  input: UpdateChatSessionInput,
  options: { strictModel?: boolean; strictEffort?: boolean } = {},
) => {
  const configuration = await runtimeConfigurations.get(input.runtimeConfigurationId ?? "");
  if (!configuration || configuration.driver === "custom") {
    return { success: false as const, error: { code: "RUNTIME_CONFIGURATION_NOT_FOUND" as const } };
  }

  const model = pickRuntimeConfigurationModel(
    configuration.models,
    input.model,
    options.strictModel,
  );
  if (!model) {
    return { success: false as const, error: { code: "INVALID_MODEL" as const } };
  }
  // Prefer configured default thinking when the bound runtime or model actually changes.
  const modelChanged =
    model.model !== existing.model ||
    (input.runtimeConfigurationId !== undefined &&
      input.runtimeConfigurationId !== existing.runtime_configuration_id);
  const effort = resolveRuntimeConfigurationEffort(
    model.thinkingLevels,
    existing.reasoning_effort,
    input.reasoningEffort,
    options.strictEffort === true,
    model.defaultThinkingLevel,
    modelChanged,
  );
  if (!effort.success) return effort;

  return {
    success: true as const,
    patch: {
      runtime: configuration.driver,
      runtime_configuration_id: configuration.id,
      model: model.model,
      reasoning_effort: effort.effort,
      runtime_alias: configuration.command,
      runtime_session_id: null,
      fast_mode: resolveConfigurationFastMode(
        runtimeConfigurationSupportsFastMode(configuration, model.model),
        existing,
        input,
      ),
    },
  };
};

const pickRuntimeConfigurationModel = <Model extends { model: string; isDefault: boolean }>(
  models: Model[],
  requestedModel: string | undefined,
  strictModel: boolean | undefined,
): Model | undefined => {
  if (requestedModel !== undefined) {
    const matched = models.find((item) => item.model === requestedModel);
    if (matched || strictModel) return matched;
  }
  return getDefaultRuntimeConfigurationModel(models);
};

const resolveConfigurationFastMode = (
  supportsFastMode: boolean,
  existing: ChatSession,
  input: UpdateChatSessionInput,
): boolean => {
  if (!supportsFastMode) return false;
  return input.fastMode !== undefined ? input.fastMode : Boolean(existing.fast_mode);
};

const resolveRuntimeConfigurationEffort = (
  levels: string[],
  existingEffort: string,
  requestedEffort: string | undefined,
  strict: boolean,
  defaultThinkingLevel: string | null = null,
  preferDefault = false,
): { success: true; effort: string } | { success: false; error: { code: "INVALID_EFFORT" } } => {
  if (requestedEffort !== undefined) {
    if (levels.includes(requestedEffort)) return { success: true, effort: requestedEffort };
    if (strict) return { success: false, error: { code: "INVALID_EFFORT" } };
  } else if (!preferDefault && levels.includes(existingEffort)) {
    // Keep sticky effort for non-model edits (e.g. fast mode toggle).
    return { success: true, effort: existingEffort };
  }
  return {
    success: true,
    effort: pickConfiguredEffort(levels, existingEffort, defaultThinkingLevel),
  };
};

const pickConfiguredEffort = (
  levels: string[],
  existingEffort: string,
  defaultThinkingLevel: string | null,
): string => {
  if (defaultThinkingLevel && levels.includes(defaultThinkingLevel)) return defaultThinkingLevel;
  if (levels.includes(existingEffort)) return existingEffort;
  return levels[0] ?? DEFAULT_EFFORT;
};

/** In-flight reply work claimed before the provider run starts (closes the accept→run gap). */
const pendingSessionReplies = new Set<string>();
const abortRequestedSessions = new Set<string>();
const backgroundReplyTasks = new Set<Promise<void>>();
const recoveryTasks = new Map<string, Promise<void>>();
const recoveryAbortControllers = new Map<string, AbortController>();

const cancelChatRunRecovery = async (runId: string): Promise<void> => {
  recoveryAbortControllers.get(runId)?.abort();
  const recovery = recoveryTasks.get(runId);
  if (recovery) await recovery;
};

/** Await in-flight background replies and restart recoveries (tests). */
export const waitForPendingChatReplies = async (): Promise<void> => {
  while (backgroundReplyTasks.size > 0 || recoveryTasks.size > 0) {
    await Promise.allSettled([...backgroundReplyTasks, ...recoveryTasks.values()]);
  }
};

/** Stop current-process chat work before the local server releases its database. */
export const shutdownChatSessions = async (ctx: LocalServerContext): Promise<void> => {
  for (const controller of recoveryAbortControllers.values()) controller.abort();
  const sessionIds = new Set([...activeSessionRunIds(), ...pendingSessionReplies]);
  for (const sessionId of sessionIds) {
    abortRequestedSessions.add(sessionId);
    interruptSessionRun(sessionId, "abort");
    const session = await ctx.chatSessionRepository.getById(sessionId);
    if (session) await cancelQueuedSteers(ctx, sessionId, session.runtime, "abort");
  }
  while (backgroundReplyTasks.size > 0) {
    await Promise.allSettled(backgroundReplyTasks);
  }
  await Promise.allSettled(recoveryTasks.values());
};

/**
 * Force-stop chat runtimes before a hard repo purge.
 * Interrupts live processes, cancels queued steers, waits for background finalizers,
 * then cancels any still-running durable rows so no provider keeps working on a gone repo.
 */
export const forceAbortChatSessionsForPurge = async (
  ctx: LocalServerContext,
  sessionIds: string[],
): Promise<void> => {
  if (sessionIds.length === 0) return;
  for (const sessionId of sessionIds) {
    await interruptChatSessionForPurge(ctx, sessionId);
  }
  await waitForPendingChatReplies();
  for (const sessionId of sessionIds) {
    await cancelOrphanedChatRunsForPurge(ctx, sessionId);
  }
};

const interruptChatSessionForPurge = async (
  ctx: LocalServerContext,
  sessionId: string,
): Promise<void> => {
  const session = await ctx.chatSessionRepository.getById(sessionId);
  if (!session) return;
  if (interruptSessionRun(sessionId, "abort")) {
    abortRequestedSessions.add(sessionId);
  }
  await cancelQueuedSteers(ctx, sessionId, session.runtime, "abort");
};

const cancelOrphanedChatRunsForPurge = async (
  ctx: LocalServerContext,
  sessionId: string,
): Promise<void> => {
  const orphanedRuns = await ctx.db
    .selectFrom("chat_runs")
    .selectAll()
    .where("session_id", "=", sessionId)
    .where("status", "=", "running")
    .execute();
  for (const orphanedRun of orphanedRuns) {
    await cancelChatRunRecovery(orphanedRun.id);
    await finalizeChatRunAndPublish(
      ctx,
      orphanedRun,
      "Stopped because the repository was unregistered.",
      null,
      null,
      {
        status: "cancelled",
        interruptionKind: "abort",
        errorMessage: null,
        bindingPolicy: "clear",
      },
    );
  }
};

const trackBackgroundReply = (task: Promise<void>): void => {
  backgroundReplyTasks.add(task);
  void task.finally(() => backgroundReplyTasks.delete(task));
};

const ensureAllChatRunRecoveries = async (
  ctx: LocalServerContext,
  deps: ChatSessionServiceDeps,
): Promise<void> => {
  const runs = await ctx.db
    .selectFrom("chat_runs")
    .selectAll()
    .where("status", "=", "running")
    .execute()
    .catch(() => []);
  for (const run of runs) {
    void startChatRunRecovery(ctx, run, deps);
  }
};

const ensureSessionChatRunRecovery = async (
  ctx: LocalServerContext,
  sessionId: string,
  deps: ChatSessionServiceDeps,
): Promise<void> => {
  if (isSessionRunActive(sessionId) || pendingSessionReplies.has(sessionId)) return;
  const run = await ctx.db
    .selectFrom("chat_runs")
    .selectAll()
    .where("session_id", "=", sessionId)
    .where("status", "=", "running")
    .executeTakeFirst();
  if (run) await startChatRunRecovery(ctx, run, deps);
};

const startChatRunRecovery = (
  ctx: LocalServerContext,
  run: ChatRun,
  deps: ChatSessionServiceDeps,
): Promise<void> => {
  const existing = recoveryTasks.get(run.id);
  if (existing) return existing;

  const controller = new AbortController();
  recoveryAbortControllers.set(run.id, controller);
  const task = recoverChatRun(ctx, run, deps, controller.signal).finally(() => {
    recoveryTasks.delete(run.id);
    if (recoveryAbortControllers.get(run.id) === controller) {
      recoveryAbortControllers.delete(run.id);
    }
  });
  recoveryTasks.set(run.id, task);
  return task;
};

const recoverChatRun = async (
  ctx: LocalServerContext,
  run: ChatRun,
  deps: ChatSessionServiceDeps,
  signal: AbortSignal,
): Promise<void> => {
  let activity: AssistantActivity | null = null;
  let recovered: Awaited<ReturnType<typeof waitForChatRunTerminal>>;
  try {
    recovered = await waitForChatRunTerminal({
      run,
      pollIntervalMs: deps.recoveryPollIntervalMs,
      signal,
      onProgress: (progress) => {
        activity = progress;
        publishChatSessionEvent({
          type: "assistant-progress",
          sessionId: run.session_id,
          thinking: progress.thinking,
          content: progress.content,
          commandGroups: progress.commandGroups,
        });
      },
    });
  } catch (error) {
    if (signal.aborted) return;
    throw error;
  }
  if (signal.aborted) return;
  await finalizeChatRunAndPublish(
    ctx,
    run,
    recovered.text,
    null,
    recovered.runtimeSessionId,
    {
      status: recovered.status,
      errorMessage: recovered.status === "failed" ? recovered.text : null,
      failureKind: recovered.failureKind ?? null,
      runtimeSessionState: recovered.runtimeSessionState,
    },
    // Same stacking merge as the normal reply path so recovered activity keeps history.
    finalizeAssistantActivity(activity, {
      text: recovered.text,
      failed: recovered.status === "failed",
    }),
  );
  if (signal.aborted) return;
  // Server restart recovery: also drain steers queued while the recovered run was live.
  void drainQueuedSteers(ctx, run.session_id, run.runtime, deps);
};

const hasRunningChatRun = async (ctx: LocalServerContext, sessionId: string): Promise<boolean> => {
  const run = await ctx.db
    .selectFrom("chat_runs")
    .select("id")
    .where("session_id", "=", sessionId)
    .where("status", "=", "running")
    .executeTakeFirst();
  return Boolean(run);
};

const listPendingApprovalSessionIds = async (ctx: LocalServerContext): Promise<Set<string>> => {
  const rows = await ctx.db
    .selectFrom("tasks")
    .select("origin_chat_session_id")
    .where("origin_chat_session_id", "is not", null)
    .where("handoff_pending_approval", "=", true)
    .execute();
  return new Set(
    rows
      .map((row) => row.origin_chat_session_id)
      .filter((sessionId): sessionId is string => sessionId !== null),
  );
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

/**
 * Resolve the session-scoped lifecycle used by list/detail/send/SSE.
 * Current-process ownership beats durable-only recovery for stop/steer accuracy.
 */
const resolveAssistantLifecycle = async (
  ctx: LocalServerContext,
  sessionId: string,
): Promise<ChatSessionLifecycle> => {
  const phase = sessionRunPhase(sessionId);
  if (phase === "cancelling") return "cancelling";
  if (phase === "running" || phase === "spawning") return "running";
  if (phase === "pending" || pendingSessionReplies.has(sessionId)) return "pending";

  const durableRunning = await hasRunningChatRun(ctx, sessionId);
  if (!durableRunning) return "idle";
  // Durable row without a live handle cannot be OS-stopped safely after restart.
  return "uncontrollable";
};

const completeAssistantReplyInBackground = async (input: {
  ctx: LocalServerContext;
  sessionId: string;
  session: ChatSession;
  displayText: string;
  runtimePrompt: string;
  images: StoredChatImage[];
  documents: StoredChatDocument[];
  run: ChatRun;
  registration: SessionRunRegistration;
  createProviderFn?: CreateProviderFn;
  beforeAssistantReply?: (run: ChatRun) => Promise<void>;
  beforeQueuedRunClaim?: (sessionId: string) => Promise<void>;
}): Promise<void> => {
  try {
    await input.beforeAssistantReply?.(input.run);
    if (await shouldSkipAssistantReply(input.ctx, input.sessionId, input.run.id)) {
      await finalizeSuppressedReply(input);
      return;
    }
    await runAndPublishAssistantReply(input);
  } catch (error) {
    if (isDbClosedError(error)) return;
    await publishReplyFailure(input, error);
  } finally {
    releaseSessionRunRegistration(input.registration);
    pendingSessionReplies.delete(input.sessionId);
    // Clear the abort flag first: it suppresses the turn the user stopped, not the
    // queue behind it. Shutdown and runtime reset cancel their queues explicitly,
    // so this drain finds nothing to start for them.
    abortRequestedSessions.delete(input.sessionId);
    // Auto-start the next mid-run steer message, if any. Await claim+track so
    // waitForPendingChatReplies still sees the follow-up background task.
    await drainQueuedSteers(input.ctx, input.sessionId, input.session.runtime, {
      createProviderFn: input.createProviderFn,
      beforeQueuedRunClaim: input.beforeQueuedRunClaim,
    });
  }
};

const shouldSkipAssistantReply = async (
  ctx: LocalServerContext,
  sessionId: string,
  runId: string,
): Promise<boolean> => {
  // Abort/reset suppress provider launch. Steer keeps ownership and must settle through
  // runSessionPrompt so interruptionKind stays "steer" rather than a cancelled abort.
  if (abortRequestedSessions.has(sessionId)) return true;
  const run = await ctx.db
    .selectFrom("chat_runs")
    .select("status")
    .where("id", "=", runId)
    .executeTakeFirst();
  return run?.status !== "running";
};

const finalizeSuppressedReply = async (input: {
  ctx: LocalServerContext;
  sessionId: string;
  session: ChatSession;
  run: ChatRun;
}): Promise<void> => {
  const current = await input.ctx.db
    .selectFrom("chat_runs")
    .selectAll()
    .where("id", "=", input.run.id)
    .executeTakeFirst();
  if (current?.status !== "running") return;
  await finalizeChatRunAndPublish(
    input.ctx,
    current,
    "Conversation stopped.",
    null,
    input.session.runtime_session_id,
    { status: "cancelled", interruptionKind: "abort", errorMessage: null },
  );
};

const runAndPublishAssistantReply = async (input: {
  ctx: LocalServerContext;
  sessionId: string;
  session: ChatSession;
  displayText: string;
  runtimePrompt: string;
  images: StoredChatImage[];
  documents: StoredChatDocument[];
  run: ChatRun;
  registration: SessionRunRegistration;
  createProviderFn?: CreateProviderFn;
}): Promise<void> => {
  const reply = await produceAssistantReply(
    input.ctx,
    input.session,
    input.run.user_message_id,
    input.displayText,
    input.runtimePrompt,
    input.images,
    input.documents,
    input.run.log_file_path,
    input.createProviderFn,
    input.run,
    input.registration,
  );
  await finalizeChatRunAndPublish(
    input.ctx,
    input.run,
    reply.text,
    reply.action,
    reply.runtimeSessionId,
    reply.interrupted
      ? reply.aborted
        ? {
            status: "cancelled",
            interruptionKind: reply.interruptionKind ?? "abort",
            errorMessage: null,
            failureKind: null,
            runtimeSessionState: reply.runtimeSessionState,
            bindingPolicy: reply.bindingPolicy,
          }
        : {
            status: "interrupted",
            interruptionKind: "steer",
            errorMessage: null,
            failureKind: null,
            runtimeSessionState: reply.runtimeSessionState,
            bindingPolicy: reply.bindingPolicy,
          }
      : reply.failed
        ? {
            status: "failed",
            errorMessage: reply.text,
            failureKind: reply.failureKind ?? null,
            runtimeSessionState: reply.runtimeSessionState,
          }
        : undefined,
    reply.activity,
    reply.artifacts ?? [],
  );
};

const publishReplyFailure = async (
  input: {
    ctx: LocalServerContext;
    sessionId: string;
    session: ChatSession;
    run: ChatRun;
  },
  error: unknown,
): Promise<void> => {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await finalizeChatRunAndPublish(
      input.ctx,
      input.run,
      `Runtime error: ${message}`,
      null,
      input.session.runtime_session_id,
      { status: "failed", errorMessage: message },
    );
  } catch (persistError) {
    if (!isDbClosedError(persistError)) throw persistError;
  }
};

const resetRuntimeSession = async (
  ctx: LocalServerContext,
  sessionId: string,
): Promise<ResetRuntimeSessionResult> => {
  const session = await ctx.chatSessionRepository.getById(sessionId);
  if (!session) return { success: false, error: { code: "SESSION_NOT_FOUND" } };

  const hadBinding = Boolean(session.runtime_session_id);
  const liveRunAborted = interruptSessionRun(sessionId, "reset");
  if (liveRunAborted) abortRequestedSessions.add(sessionId);
  await cancelQueuedSteers(ctx, sessionId, session.runtime, "reset");

  const runningRun = await ctx.db
    .selectFrom("chat_runs")
    .selectAll()
    .where("session_id", "=", sessionId)
    .where("status", "=", "running")
    .executeTakeFirst();

  let cancelledRun = false;
  if (runningRun) {
    // Claim cancellation + clear binding so normal completion cannot write it back.
    await cancelChatRunRecovery(runningRun.id);
    await finalizeChatRunAndPublish(
      ctx,
      runningRun,
      "Runtime session reset. The next message will start a fresh runtime session.",
      null,
      null,
      {
        status: "cancelled",
        errorMessage: null,
        failureKind: null,
        interruptionKind: "reset",
        bindingPolicy: "clear",
      },
    );
    cancelledRun = true;
  }

  await ensureRuntimeBindingCleared(ctx, sessionId);

  return {
    success: true,
    reset: true,
    clearedBinding: hadBinding || cancelledRun,
    cancelledRun: cancelledRun || liveRunAborted,
  };
};

const ensureRuntimeBindingCleared = async (
  ctx: LocalServerContext,
  sessionId: string,
): Promise<void> => {
  const latest = await ctx.chatSessionRepository.getById(sessionId);
  if (!latest?.runtime_session_id) return;
  const now = new Date().toISOString();
  await ctx.db
    .updateTable("chat_sessions")
    .set({ runtime_session_id: null, updated_at: now })
    .where("id", "=", sessionId)
    .execute();
  const updated = await ctx.chatSessionRepository.getById(sessionId);
  if (!updated) return;
  const sessionDto = await sessionDtoFor(ctx, updated, null, now);
  publishChatSessionEvent({ type: "session-updated", sessionId, session: sessionDto });
};

const finalizeChatRunAndPublish = async (
  ctx: LocalServerContext,
  run: ChatRun,
  text: string,
  action: ChatActionPayload | null,
  runtimeSessionId: string | null,
  outcome: FinalizeChatRunOutcome = {
    status: "completed",
    errorMessage: null,
  },
  activity: AssistantActivity | null = null,
  artifacts: StoredChatArtifact[] = [],
): Promise<void> => {
  // Same per-host lock as start/note/finish so cascade sees the latest specialist
  // rows and late writes cannot resurrect them as active after the host claims.
  const finalized = await withHostDelegationLock(run.id, () =>
    ctx.db
      .transaction()
      .execute((trx) =>
        persistFinalizedChatRun(
          trx,
          run,
          text,
          action,
          runtimeSessionId,
          outcome,
          activity,
          artifacts,
        ),
      ),
  );
  if (!finalized) return;

  if (action) {
  }

  const session = await ctx.chatSessionRepository.getById(run.session_id);
  if (!session) return;
  const sessionDto = await sessionDtoFor(ctx, session, finalized.content, finalized.created_at);
  publishChatSessionEvent({
    type: "assistant-final",
    sessionId: run.session_id,
    sessionTitle: session.title,
    message: toMessageDto(
      finalized,
      await ctx.db.selectFrom("chat_runs").selectAll().where("id", "=", run.id).executeTakeFirst(),
    ),
  });
  publishChatSessionEvent({
    type: "session-updated",
    sessionId: run.session_id,
    session: sessionDto,
  });
};

const isDbClosedError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("destroyed") || message.includes("Database has been closed");
};

const isActiveChatRunConflict = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("uq_chat_runs_running_session") ||
    message.includes("UNIQUE constraint failed: chat_runs.session_id")
  );
};

const validateSendContent = (
  input: SendChatMessageInput,
):
  | {
      success: true;
      text: string;
      images: CreateTaskImageAttachment[];
      documents: ChatDocumentAttachment[];
      pastes: StoredChatPaste[];
    }
  | Extract<SendChatMessageResult, { success: false }> => {
  const text = typeof input.content === "string" ? input.content.trim() : "";
  const imagesResult = validateChatImageAttachments(input.imageAttachments);
  if (!imagesResult.success) {
    return {
      success: false,
      error: { code: "INVALID_IMAGES", message: imagesResult.error },
    };
  }
  const documentsResult = validateChatDocumentAttachments(input.documentAttachments);
  if (!documentsResult.success) {
    return {
      success: false,
      error: { code: "INVALID_DOCUMENTS", message: documentsResult.error },
    };
  }
  const pastesResult = validateChatPastes(input.pastes);
  if (!pastesResult.success) {
    return {
      success: false,
      error: { code: "INVALID_CONTENT", message: pastesResult.error },
    };
  }
  return text || imagesResult.images.length > 0 || documentsResult.documents.length > 0
    ? {
        success: true,
        text,
        images: imagesResult.images,
        documents: documentsResult.documents,
        pastes: pastesResult.pastes,
      }
    : { success: false, error: { code: "INVALID_CONTENT" } };
};

const CHAT_RUNTIME_ACTION_INTENTS = new Set<ChatRuntimeActionIntent>([
  "implement",
  "review",
  "audit",
  "test",
  "security",
]);

const resolveMessageOrchestration = async (
  ctx: LocalServerContext,
  configurations: RuntimeConfigurationRepository,
  session: ChatSession,
  input: SendChatMessageInput,
): Promise<
  | { success: true; action: ChatActionPayload | null }
  | Extract<SendChatMessageResult, { success: false }>
> => {
  const workflowId = typeof input.workflowId === "string" ? input.workflowId.trim() : "";
  const hasRuntimeActions = Array.isArray(input.runtimeActions) && input.runtimeActions.length > 0;
  const content = typeof input.content === "string" ? input.content : "";
  if ((workflowId || hasRuntimeActions) && hasLegacyOrchestrationMarker(content)) {
    return {
      success: false,
      error: { code: "INVALID_ORCHESTRATION", message: "Choose one orchestration mode" },
    };
  }
  if (workflowId && hasRuntimeActions) {
    return {
      success: false,
      error: { code: "INVALID_ORCHESTRATION", message: "Choose one orchestration mode" },
    };
  }
  if (workflowId) return resolveWorkflowAction(ctx, session, workflowId);
  if (!hasRuntimeActions) return { success: true, action: null };

  return resolveRuntimeActions(configurations, input.runtimeActions as unknown[]);
};

const hasLegacyOrchestrationMarker = (content: string): boolean => {
  const delegation = parseRuntimeDelegation(content);
  const control = parseControlCommand(content);
  return (
    Boolean(delegation && !("error" in delegation)) || Boolean(control && "command" in control)
  );
};

const resolveWorkflowAction = async (
  ctx: LocalServerContext,
  session: ChatSession,
  workflowId: string,
): Promise<
  { success: true; action: ChatActionPayload } | Extract<SendChatMessageResult, { success: false }>
> => {
  if (!session.repo_id) return { success: false, error: { code: "REPOSITORY_REQUIRED" } };
  const workflow = await ctx.workflowRepository.findById(workflowId);
  if (!workflow?.active) return { success: false, error: { code: "WORKFLOW_NOT_FOUND" } };
  const stepCount = workflowStepCount(workflow.definition);
  return {
    success: true,
    action: {
      type: "workflow-run",
      id: workflow.id,
      label: "Workflow",
      sub: workflow.name,
      meta: `${stepCount} steps`,
      status: "proposed",
      proposal: { workflowId: workflow.id, workflowName: workflow.name, stepCount },
    },
  };
};

const resolveRuntimeActions = async (
  configurations: RuntimeConfigurationRepository,
  rawActions: unknown[],
): Promise<
  { success: true; action: ChatActionPayload } | Extract<SendChatMessageResult, { success: false }>
> => {
  const providers = await configurations.list();
  const normalized: ChatRuntimeActionSelection[] = [];
  const combinations = new Set<string>();
  for (const raw of rawActions) {
    const action = normalizeRuntimeAction(raw, providers);
    if (!action) return invalidRuntimeActions();
    const key = runtimeActionKey(action);
    if (combinations.has(key)) return invalidRuntimeActions();
    combinations.add(key);
    normalized.push(action);
  }
  if (normalized.filter((action) => action.phase === "writer").length > 1) {
    return invalidRuntimeActions();
  }
  normalized.sort((left, right) =>
    left.phase === right.phase ? 0 : left.phase === "writer" ? -1 : 1,
  );
  return {
    success: true,
    action: {
      type: "runtime-actions",
      label: "Runtime actions",
      sub: normalized
        .map((action) => `${action.runtimeConfigurationName ?? action.provider} ${action.intent}`)
        .join(" · "),
      meta: `${normalized.length} actions`,
      status: "live",
      proposal: { actions: normalized },
    },
  };
};

const normalizeRuntimeAction = (
  raw: unknown,
  providers: RuntimeConfigurationProvider[],
): ChatRuntimeActionSelection | null => {
  const candidate = runtimeActionCandidate(raw);
  if (!candidate) return null;
  const configuration = providers.find(
    (provider) => provider.id === candidate.runtimeConfigurationId,
  );
  if (!configuration || !isWorkflowRuntimeProvider(configuration.driver)) return null;
  const model =
    configuration.models.find((item) => item.model === candidate.model) ??
    getDefaultRuntimeConfigurationModel(configuration.models);
  if (!model) return null;
  return {
    id: runtimeActionId(candidate.id),
    intent: candidate.intent,
    runtimeConfigurationId: configuration.id,
    runtimeConfigurationName: configuration.name,
    provider: configuration.driver,
    model: model.model,
    reasoning: resolveRuntimeConfigurationReasoning(
      model.thinkingLevels,
      candidate.reasoning,
      model.defaultThinkingLevel,
    ),
    fastMode:
      runtimeConfigurationSupportsFastMode(configuration, model.model) &&
      candidate.fastMode === true,
    phase: candidate.intent === "implement" ? "writer" : "post-work",
  };
};

const runtimeActionCandidate = (
  raw: unknown,
): (Partial<ChatRuntimeActionSelection> & { intent: ChatRuntimeActionIntent }) | null => {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<ChatRuntimeActionSelection>;
  return candidate.intent && CHAT_RUNTIME_ACTION_INTENTS.has(candidate.intent)
    ? (candidate as Partial<ChatRuntimeActionSelection> & { intent: ChatRuntimeActionIntent })
    : null;
};

const runtimeActionId = (candidateId: unknown): string =>
  typeof candidateId === "string" && candidateId ? candidateId : randomUUID();

const runtimeActionKey = (action: ChatRuntimeActionSelection): string =>
  `${action.intent}:${action.runtimeConfigurationId}:${action.model}:${action.reasoning}:${action.fastMode}`;

const invalidRuntimeActions = (): Extract<SendChatMessageResult, { success: false }> => ({
  success: false,
  error: { code: "INVALID_ORCHESTRATION", message: "Runtime actions are invalid" },
});

type PreparedSendResult =
  | {
      success: true;
      workflowRunStarted: true;
      session: ChatSession;
      message: ChatMessage;
      displayText: string;
    }
  | {
      success: true;
      workflowRunStarted: false;
      session: ChatSession;
      displayText: string;
      runtimePrompt: string;
      images: StoredChatImage[];
      documents: StoredChatDocument[];
      userMessage: ChatMessage;
      run: ChatRun;
    }
  | Extract<SendChatMessageResult, { success: false }>;

const workflowStepCount = (definition: string): number => {
  try {
    const parsed = JSON.parse(definition) as { steps?: Record<string, unknown> };
    return parsed.steps ? Object.keys(parsed.steps).length : 0;
  } catch {
    return 0;
  }
};

const isWorkflowArmed = (input: SendChatMessageInput): boolean =>
  input.workflowArmed === true || input.workflowArmed === "true";

/**
 * Armed-message path: persist the user message, create the workflow run, and
 * kick off the sequential background execution. The composer stays locked
 * until the run reaches a terminal state.
 */
const resolveWorkflowRunGate = async (
  ctx: LocalServerContext,
  sessionId: string,
  input: SendChatMessageInput,
): Promise<{ armed: boolean; error?: Extract<SendChatMessageResult, { success: false }> }> => {
  if (!isWorkflowArmed(input)) {
    if (await hasActiveWorkflowRun(ctx, sessionId)) {
      return {
        armed: false,
        error: { success: false, error: { code: "WORKFLOW_RUN_IN_PROGRESS" } },
      };
    }
    return { armed: false };
  }
  if (await hasRunningChatRun(ctx, sessionId)) {
    return { armed: true, error: { success: false, error: { code: "RUN_IN_PROGRESS" } } };
  }
  if (await hasActiveWorkflowRun(ctx, sessionId)) {
    return { armed: true, error: { success: false, error: { code: "WORKFLOW_RUN_IN_PROGRESS" } } };
  }
  return { armed: true };
};

const resolveWorkflowRunTarget = async (
  ctx: LocalServerContext,
  session: ChatSession,
  input: SendChatMessageInput,
): Promise<
  { workflow: Workflow } | { error: Extract<SendChatMessageResult, { success: false }>["error"] }
> => {
  const workflowId = typeof input.workflowId === "string" ? input.workflowId.trim() : "";
  if (!workflowId) return { error: { code: "WORKFLOW_NOT_FOUND" } };
  const workflow = await ctx.workflowRepository.findById(workflowId);
  if (!workflow?.active) return { error: { code: "WORKFLOW_NOT_FOUND" } };
  const workspacePath = await resolveSessionWorkspace(ctx, session);
  if (!workspacePath) return { error: { code: "REPOSITORY_REQUIRED" } };
  return { workflow };
};

const startWorkflowRunForSession = async (
  ctx: LocalServerContext,
  session: ChatSession,
  input: SendChatMessageInput,
  text: string,
  createProviderFn?: CreateProviderFn,
): Promise<PreparedSendResult> => {
  const target = await resolveWorkflowRunTarget(ctx, session, input);
  if ("error" in target) return { success: false, error: target.error };
  const { workflow } = target;

  await interruptStaleWorkflowRuns(ctx, session.id);

  const now = new Date().toISOString();
  const messageId = generateTypeId("smsg");
  const turnIndex = await nextChatTurnIndex(ctx.db, session.id);
  await ctx.db
    .insertInto("chat_messages")
    .values({
      id: messageId,
      session_id: session.id,
      role: "user",
      content: text,
      action: null,
      activity: null,
      turn_index: turnIndex,
      disposition: "immediate",
      created_at: now,
    })
    .execute();

  const run = await createWorkflowRunRecord(ctx, {
    sessionId: session.id,
    workflowId: workflow.id,
    workflowName: workflow.name,
    request: text,
    userMessageId: messageId,
  });

  publishChatSessionEvent({
    type: "workflow-run-started",
    sessionId: session.id,
    runId: run.id,
    workflowName: workflow.name,
    stepCount: workflowStepCount(workflow.definition),
  });

  void executeChatWorkflowRun(
    ctx,
    run.id,
    createProviderFn ? (agent) => createProviderFn(agent.provider) : undefined,
  );

  const storedMessage = await ctx.db
    .selectFrom("chat_messages")
    .selectAll()
    .where("id", "=", messageId)
    .executeTakeFirstOrThrow();
  return {
    success: true,
    workflowRunStarted: true,
    session,
    message: storedMessage,
    displayText: text,
  };
};

const resolvePreparedSendSession = async (
  ctx: LocalServerContext,
  runtimeConfigurations: RuntimeConfigurationRepository,
  sessionId: string,
): Promise<PreparedSendResult | { session: ChatSession }> => {
  const storedSession = await ctx.chatSessionRepository.getById(sessionId);
  if (!storedSession) return { success: false, error: { code: "SESSION_NOT_FOUND" } };
  const resolved = await resolveCurrentSessionRuntimeConfiguration(
    ctx,
    runtimeConfigurations,
    storedSession,
  );
  if (!resolved.success) return resolved;
  return { session: resolved.session };
};

const prepareSend = async (
  ctx: LocalServerContext,
  runtimeConfigurations: RuntimeConfigurationRepository,
  sessionId: string,
  input: SendChatMessageInput,
  deps: ChatSessionServiceDeps,
): Promise<PreparedSendResult> => {
  const resolved = await resolvePreparedSendSession(ctx, runtimeConfigurations, sessionId);
  if (!("session" in resolved)) return resolved;
  const session = resolved.session;

  const sendInput = validatePreparedSendInput(sessionId, input);
  if (!sendInput.success) return sendInput;

  const workflowGate = await resolveWorkflowRunGate(ctx, sessionId, input);
  if (workflowGate.error) return workflowGate.error;
  if (workflowGate.armed) {
    return startWorkflowRunForSession(ctx, session, input, sendInput.text, deps.createProviderFn);
  }

  const orchestration = await resolveMessageOrchestration(
    ctx,
    runtimeConfigurations,
    session,
    input,
  );
  if (!orchestration.success) return orchestration;

  return prepareRuntimeSend(ctx, session, sendInput, orchestration);
};

const prepareRuntimeSend = async (
  ctx: LocalServerContext,
  session: ChatSession,
  sendInput: Extract<Awaited<ReturnType<typeof validatePreparedSendInput>>, { success: true }>,
  orchestration: Extract<
    Awaited<ReturnType<typeof resolveMessageOrchestration>>,
    { success: true }
  >,
): Promise<PreparedSendResult> => {
  const { text, images, documents, pastes, displayText } = sendInput;
  const sessionId = session.id;
  const messageId = generateTypeId("smsg");
  const assistantMessageId = generateTypeId("smsg");
  const runId = generateTypeId("crun");
  const logFilePath = await createSessionRunLogPath(sessionId);
  const storedImages = await materializeChatImages(sessionId, messageId, images);
  const storedDocuments = await materializeChatDocuments(sessionId, messageId, documents);
  // Store compact tokens + paste bodies; API DTOs and runtime prompts expand.
  const storedContent = encodeMessageContent(text, storedImages, storedDocuments, [], pastes);
  const now = new Date().toISOString();
  const workspacePath = await resolveSessionWorkspace(ctx, session);
  if (!workspacePath) return { success: false, error: { code: "SESSION_NOT_FOUND" } };
  const globalInstructions = await loadChatGlobalInstructions(ctx.settingsRepository);
  const baseRuntimePrompt = buildRuntimePrompt(
    text,
    sessionId,
    storedImages,
    storedDocuments,
    pastes,
    globalInstructions,
  );
  const context = await prepareConversationPrompt({
    ctx,
    session,
    currentUserMessageId: messageId,
    currentPrompt: baseRuntimePrompt,
  });
  const allocatedSessionId =
    !session.runtime_session_id && isGrokRuntime(session.runtime) ? randomUUID() : null;
  const timeoutPolicy = resolveChatRuntimeTimeoutPolicy(session.runtime);

  let prepared: { session: ChatSession; userMessage: ChatMessage; run: ChatRun };
  try {
    prepared = await persistPreparedSend(ctx, {
      session,
      sessionId,
      messageId,
      assistantMessageId,
      runId,
      logFilePath,
      storedContent,
      displayText,
      workspacePath,
      contextStrategy: context.strategy,
      allocatedSessionId,
      timeoutPolicy: timeoutPolicy.policyName,
      now,
      action: orchestration.action,
    });
  } catch (error) {
    if (isActiveChatRunConflict(error)) {
      return { success: false, error: { code: "RUN_IN_PROGRESS" } };
    }
    throw error;
  }

  return {
    success: true,
    workflowRunStarted: false,
    session: prepared.session,
    displayText,
    runtimePrompt: context.prompt,
    images: storedImages,
    documents: storedDocuments,
    userMessage: prepared.userMessage,
    run: prepared.run,
  };
};

const validatePreparedSendInput = (
  sessionId: string,
  input: SendChatMessageInput,
):
  | {
      success: true;
      text: string;
      images: Parameters<typeof materializeChatImages>[2];
      documents: Parameters<typeof materializeChatDocuments>[2];
      pastes: StoredChatPaste[];
      displayText: string;
    }
  | Extract<SendChatMessageResult, { success: false }> => {
  const content = validateSendContent(input);
  if (!content.success) return content;
  // pendingSessionReplies covers accepted background work. isSessionRunActive is not
  // checked here because sendMessage registers lifecycle ownership before prepareSend.
  if (pendingSessionReplies.has(sessionId)) {
    return { success: false, error: { code: "RUN_IN_PROGRESS" } };
  }
  const delegation = parseRuntimeDelegation(content.text);
  // Persist transport markers for history badges while keeping user-facing text clean.
  const displayText = delegation && !("error" in delegation) ? delegation.prompt : content.text;
  return { ...content, displayText };
};

const persistPreparedSend = async (
  ctx: LocalServerContext,
  input: {
    session: ChatSession;
    sessionId: string;
    messageId: string;
    assistantMessageId: string;
    runId: string;
    logFilePath: string;
    storedContent: string;
    displayText: string;
    workspacePath: string;
    contextStrategy: ChatContextStrategy;
    allocatedSessionId: string | null;
    timeoutPolicy: string;
    now: string;
    action: ChatActionPayload | null;
  },
): Promise<{ session: ChatSession; userMessage: ChatMessage; run: ChatRun }> =>
  ctx.db.transaction().execute(async (trx) => {
    const turnIndex = await nextChatTurnIndex(trx, input.sessionId);
    const existing = await trx
      .selectFrom("chat_messages")
      .select("id")
      .where("session_id", "=", input.sessionId)
      .limit(1)
      .executeTakeFirst();
    await trx
      .insertInto("chat_messages")
      .values({
        id: input.messageId,
        session_id: input.sessionId,
        role: "user",
        content: input.storedContent,
        action: input.action ? JSON.stringify(input.action) : null,
        turn_index: turnIndex,
        disposition: "immediate",
        created_at: input.now,
      })
      .execute();
    await trx
      .insertInto("chat_runs")
      .values({
        id: input.runId,
        session_id: input.sessionId,
        user_message_id: input.messageId,
        assistant_message_id: input.assistantMessageId,
        runtime: input.session.runtime,
        log_file_path: input.logFilePath,
        status: "running",
        runtime_session_id: input.allocatedSessionId ?? input.session.runtime_session_id,
        resume_session_id: input.session.runtime_session_id,
        failure_kind: null,
        interruption_kind: null,
        context_strategy: input.contextStrategy,
        workspace_path: input.workspacePath,
        timeout_policy: input.timeoutPolicy,
        retry_of_run_id: null,
        runtime_session_state: runtimeSessionState(input),
        error_message: null,
        created_at: input.now,
        updated_at: input.now,
      })
      .execute();
    const titlePatch = existing ? {} : deriveAutoTitle(input.session, input.displayText);
    await trx
      .updateTable("chat_sessions")
      .set({
        ...titlePatch,
        settled_override: null,
        settled_at: null,
        updated_at: input.now,
      })
      .where("id", "=", input.sessionId)
      .execute();

    const [session, userMessage, run] = await Promise.all([
      trx
        .selectFrom("chat_sessions")
        .selectAll()
        .where("id", "=", input.sessionId)
        .executeTakeFirstOrThrow(),
      trx
        .selectFrom("chat_messages")
        .selectAll()
        .where("id", "=", input.messageId)
        .executeTakeFirstOrThrow(),
      trx
        .selectFrom("chat_runs")
        .selectAll()
        .where("id", "=", input.runId)
        .executeTakeFirstOrThrow(),
    ]);
    return { session, userMessage, run };
  });

const runtimeSessionState = (input: {
  allocatedSessionId: string | null;
  session: ChatSession;
}): "allocated" | "confirmed" | null => {
  if (input.allocatedSessionId) return "allocated";
  return input.session.runtime_session_id ? "confirmed" : null;
};

const resolveCurrentSessionRuntimeConfiguration = async (
  ctx: LocalServerContext,
  runtimeConfigurations: RuntimeConfigurationRepository,
  session: ChatSession,
): Promise<
  | { success: true; session: ChatSession }
  | { success: false; error: { code: "RUNTIME_CONFIGURATION_NOT_FOUND" } }
> => {
  if (!session.runtime_configuration_id) return { success: true, session };

  const resolution = await resolveRuntimeConfigurationPatch(runtimeConfigurations, session, {
    runtimeConfigurationId: session.runtime_configuration_id,
    model: session.model,
    reasoningEffort: session.reasoning_effort,
  });
  if (!resolution.success) {
    return { success: false, error: { code: "RUNTIME_CONFIGURATION_NOT_FOUND" } };
  }
  const updated = await ctx.chatSessionRepository.update(session.id, {
    ...resolution.patch,
    runtime_session_id: session.runtime_session_id,
    updated_at: new Date().toISOString(),
  });
  return updated
    ? { success: true, session: updated }
    : { success: false, error: { code: "RUNTIME_CONFIGURATION_NOT_FOUND" } };
};

interface AssistantReply {
  text: string;
  action: ChatActionPayload | null;
  runtimeSessionId: string | null;
  failed: boolean;
  aborted: boolean;
  interrupted: boolean;
  interruptionKind?: ChatRunInterruptionKind;
  failureKind?: ChatRunFailureKind | null;
  runtimeSessionState?: ChatRun["runtime_session_state"];
  bindingPolicy?: "clear";
  activity: AssistantActivity | null;
  artifacts?: StoredChatArtifact[];
}

const produceAssistantReply = async (
  ctx: LocalServerContext,
  session: ChatSession,
  userMessageId: string,
  displayText: string,
  runtimePrompt: string,
  images: StoredChatImage[],
  documents: StoredChatDocument[],
  logFilePath: string,
  createProviderFn?: CreateProviderFn,
  chatRun?: ChatRun,
  registration?: SessionRunRegistration,
): Promise<AssistantReply> => {
  const command = await executeLocalChatCommand(ctx, session, displayText);
  if (command.reply) return command.reply;

  if (chatRun && (await shouldSkipAssistantReply(ctx, session.id, chatRun.id))) {
    return {
      text: "Conversation stopped.",
      action: null,
      runtimeSessionId: session.runtime_session_id,
      failed: false,
      aborted: true,
      interrupted: true,
      interruptionKind: "abort",
      activity: null,
    };
  }

  publishChatSessionEvent({ type: "assistant-typing", sessionId: session.id, userMessageId });
  let activity: AssistantActivity | null = null;
  const trackBackgroundTasks =
    chatRun != null
      ? createBackgroundTaskTracker({
          ctx,
          hostRun: chatRun,
          session,
        })
      : null;
  const onProgress = (progress: StreamProgressSnapshot) => {
    activity = progress;
    publishControlProgress(session.id, progress);
    trackBackgroundTasks?.(progress);
  };
  const run = await runRuntimeReply({
    ctx,
    session,
    userMessageId,
    runtimePrompt,
    images,
    documents,
    logFilePath,
    createProviderFn,
    runtimePromptPrefix: command.runtimePromptPrefix,
    onProgress,
    chatRun,
    registration,
  });
  const action: ChatActionPayload | null = null;

  // Finalization cascades active background tasks to the host's terminal state.
  // Drain queued progress first so no late tracker write can recreate a running card.
  await trackBackgroundTasks?.flush();

  return toAssistantReply(run, action, activity);
};

const toAssistantReply = (
  run: RuntimeRunResult,
  action: ChatActionPayload | null,
  activity: AssistantActivity | null,
): AssistantReply => {
  return {
    text: run.text,
    action,
    runtimeSessionId: run.runtimeSessionId,
    failed: run.failed === true,
    aborted: run.aborted === true,
    interrupted: run.interrupted === true,
    interruptionKind: run.interruptionKind,
    failureKind: run.failureKind ?? null,
    runtimeSessionState: run.runtimeSessionState,
    bindingPolicy: run.bindingPolicy,
    activity: finalizeAssistantActivity(activity, run),
    artifacts: run.artifacts ?? [],
  };
};

const finalizeAssistantActivity = (
  activity: AssistantActivity | null,
  run: { text: string; failed?: boolean; aborted?: boolean; interrupted?: boolean },
): AssistantActivity | null => {
  if (!activity) return null;
  const failed = run.failed === true || run.aborted === true || run.interrupted === true;
  return {
    ...activity,
    // Keep intermediate status paragraphs from the live stream; only the
    // persisted assistant message body uses the provider's final text alone.
    content: finalizeActivityContent(activity.content, run.text, run.interrupted === true),
    commandGroups: finalizeCommandGroups(activity.commandGroups, failed),
  };
};

const finalizeCommandGroups = (
  commandGroups: AssistantActivity["commandGroups"],
  failed: boolean,
): AssistantActivity["commandGroups"] => {
  const status = failed ? "failed" : "done";
  const exitCode = failed ? 1 : 0;
  return commandGroups.map((group) => ({
    ...group,
    commands: group.commands.map((command) =>
      command.status === "running" ? { ...command, status, exitCode } : command,
    ),
  }));
};

const executeLocalChatCommand = async (
  ctx: LocalServerContext,
  session: ChatSession,
  displayText: string,
): Promise<{
  reply: AssistantReply | null;
  runtimePromptPrefix?: string;
}> => {
  const command = await executeChatCommand(ctx, session, displayText || "(image attachment)");
  if (!command) return { reply: null };
  if (command.forwardToRuntime) {
    return { reply: null, runtimePromptPrefix: command.runtimePromptPrefix };
  }

  const next = command.sessionPatch
    ? ((await ctx.chatSessionRepository.update(session.id, {
        ...command.sessionPatch,
        updated_at: new Date().toISOString(),
      })) ?? session)
    : session;
  return {
    reply: {
      text: command.text,
      action: command.action ?? null,
      runtimeSessionId: next.runtime_session_id,
      failed: false,
      aborted: false,
      interrupted: false,
      activity: null,
    },
  };
};

type RuntimeReplyInput = {
  ctx: LocalServerContext;
  session: ChatSession;
  userMessageId: string;
  runtimePrompt: string;
  images: StoredChatImage[];
  documents: StoredChatDocument[];
  logFilePath: string;
  createProviderFn?: CreateProviderFn;
  runtimePromptPrefix?: string;
  onProgress?: (progress: StreamProgressSnapshot) => void;
  chatRun?: ChatRun;
  registration?: SessionRunRegistration;
};

const runRuntimeReply = async (input: RuntimeReplyInput) => {
  const { ctx, session, runtimePrompt } = input;
  const currentUserText = await loadCurrentUserText(ctx, input.userMessageId);
  const runtimeActions = await loadCurrentRuntimeActions(ctx, input.userMessageId);
  if (runtimeActions.length > 0) {
    return runStructuredRuntimeActions(input, currentUserText, runtimeActions);
  }
  const runtimeDelegation = parseRuntimeDelegation(currentUserText);
  const delegatedResult = await handleRuntimeDelegation(input, runtimeDelegation);
  if (delegatedResult) return delegatedResult;
  const controlRequest = parseControlCommand(currentUserText);
  const controlError = controlRequestError(controlRequest, session.runtime_session_id);
  if (controlError) return controlError;

  const repoPath = await resolveSessionWorkspace(ctx, session);
  const allowedDirectories = allowedDirectoriesForChatAttachments(
    session.id,
    input.images,
    input.documents,
  );
  const controlled = await runControlRequestIfPresent(
    input,
    controlRequest,
    repoPath ?? "",
    allowedDirectories,
  );
  if (controlled) return controlled;

  return runMainRuntimeReply(input, repoPath ?? "", allowedDirectories, runtimePrompt);
};

const runStructuredRuntimeActions = async (
  input: RuntimeReplyInput,
  request: string,
  actions: ChatRuntimeActionSelection[],
): Promise<RuntimeRunResult> => {
  const repoPath = (await resolveSessionWorkspace(input.ctx, input.session)) ?? "";
  const hasWriterAction = actions.some((action) => action.phase === "writer");
  return runRuntimeActionPlan({
    ctx: input.ctx,
    session: input.session,
    request,
    repoPath,
    actions,
    createProviderFn: input.createProviderFn,
    chatRun: input.chatRun,
    registration: input.registration,
    consolidate: (main, reports) =>
      runMainRuntimeReply(
        {
          ...input,
          session:
            main.runtimeSessionId && !hasWriterAction
              ? { ...input.session, runtime_session_id: main.runtimeSessionId }
              : input.session,
        },
        repoPath,
        undefined,
        formatRuntimeActionReports(main, reports, hasWriterAction),
      ),
  });
};

const loadCurrentRuntimeActions = async (
  ctx: LocalServerContext,
  userMessageId: string,
): Promise<ChatRuntimeActionSelection[]> => {
  const message = await ctx.db
    .selectFrom("chat_messages")
    .select("action")
    .where("id", "=", userMessageId)
    .executeTakeFirst();
  const action = parseAction(message?.action ?? null);
  return action?.type === "runtime-actions"
    ? ((action.proposal as import("@aop/common").RuntimeActionsFields | undefined)?.actions ?? [])
    : [];
};

const runControlRequestIfPresent = async (
  input: RuntimeReplyInput,
  controlRequest: ReturnType<typeof parseControlCommand>,
  repoPath: string,
  allowedDirectories: string[] | undefined,
): Promise<RuntimeRunResult | null> => {
  if (!controlRequest || !("command" in controlRequest)) return null;
  return runControlRequest({
    ctx: input.ctx,
    session: input.session,
    request: {
      ...controlRequest,
      prompt: composeRuntimePrompt(controlRequest.prompt, input.runtimePromptPrefix),
    },
    userMessageId: input.userMessageId,
    repoPath,
    allowedDirectories,
    logFilePath: input.logFilePath,
    createProviderFn: input.createProviderFn,
    onProgress: input.onProgress,
    registration: input.registration,
  });
};

const runMainRuntimeReply = async (
  input: RuntimeReplyInput,
  repoPath: string,
  allowedDirectories: string[] | undefined,
  runtimePrompt: string,
): Promise<RuntimeRunResult> => {
  const { ctx, session } = input;
  const run = await runSessionPrompt({
    session,
    repoPath,
    prompt: composeRuntimePrompt(runtimePrompt, input.runtimePromptPrefix),
    registration: input.registration,
    allowedDirectories,
    logFilePath: input.logFilePath,
    createProviderFn: input.createProviderFn,
    onProgress: input.onProgress,
    newSessionId:
      input.chatRun?.runtime_session_state === "allocated" && !session.runtime_session_id
        ? (input.chatRun.runtime_session_id ?? undefined)
        : undefined,
    onRuntimeSession: input.chatRun
      ? (sessionId) => persistActiveRuntimeSession(ctx, input.chatRun?.id ?? "", sessionId)
      : undefined,
  });
  if (shouldRetrySilentGrokResume(session, run, input.chatRun)) {
    const staleRuntimeSessionId = session.runtime_session_id;
    if (!staleRuntimeSessionId || !input.chatRun) return run;
    await retireStaleRuntimeSession(ctx, input.chatRun.id, staleRuntimeSessionId);
    const freshSessionId = randomUUID();
    await allocateFreshRuntimeSession(ctx, input.chatRun.id, freshSessionId);
    const freshSession = { ...session, runtime_session_id: null };
    const freshContext = await prepareConversationPrompt({
      ctx,
      session: freshSession,
      currentUserMessageId: input.userMessageId,
      currentPrompt: runtimePrompt,
    });
    return runSessionPrompt({
      session: freshSession,
      repoPath,
      prompt: composeRuntimePrompt(freshContext.prompt, input.runtimePromptPrefix),
      registration: input.registration,
      allowedDirectories,
      logFilePath: input.logFilePath,
      createProviderFn: input.createProviderFn,
      onProgress: input.onProgress,
      newSessionId: freshSessionId,
      onRuntimeSession: (sessionId) =>
        persistActiveRuntimeSession(ctx, input.chatRun?.id ?? "", sessionId),
    });
  }
  if (!run.staleRuntimeSessionId || !input.chatRun) return run;

  await retireStaleRuntimeSession(ctx, input.chatRun.id, run.staleRuntimeSessionId);
  const freshSessionId = await allocateReplacementGrokSession(
    ctx,
    input.chatRun.id,
    session.runtime,
  );
  const freshSession = { ...session, runtime_session_id: null };
  const freshContext = await prepareConversationPrompt({
    ctx,
    session: freshSession,
    currentUserMessageId: input.userMessageId,
    currentPrompt: runtimePrompt,
  });
  return runSessionPrompt({
    session: freshSession,
    repoPath,
    prompt: composeRuntimePrompt(freshContext.prompt, input.runtimePromptPrefix),
    registration: input.registration,
    allowedDirectories,
    logFilePath: input.logFilePath,
    createProviderFn: input.createProviderFn,
    onProgress: input.onProgress,
    newSessionId: freshSessionId,
    onRuntimeSession: (sessionId) =>
      persistActiveRuntimeSession(ctx, input.chatRun?.id ?? "", sessionId),
  });
};

const allocateReplacementGrokSession = async (
  ctx: LocalServerContext,
  runId: string,
  runtime: string,
): Promise<string | undefined> => {
  if (!isGrokRuntime(runtime)) return undefined;
  const sessionId = randomUUID();
  await allocateFreshRuntimeSession(ctx, runId, sessionId);
  return sessionId;
};

const shouldRetrySilentGrokResume = (
  session: ChatSession,
  run: RuntimeRunResult,
  chatRun: ChatRun | undefined,
): boolean =>
  Boolean(
    chatRun &&
      isGrokRuntime(session.runtime) &&
      session.runtime_session_id &&
      run.failed &&
      run.failureKind === "startup_timeout",
  );

const loadCurrentUserText = async (
  ctx: LocalServerContext,
  userMessageId: string,
): Promise<string> => {
  const message = await ctx.db
    .selectFrom("chat_messages")
    .select(["content", "session_id"])
    .where("id", "=", userMessageId)
    .executeTakeFirst();
  return message ? decodeMessageContent(message.content, message.session_id).text : "";
};

const handleRuntimeDelegation = async (
  input: {
    ctx: LocalServerContext;
    session: ChatSession;
    userMessageId: string;
    images: StoredChatImage[];
    documents: StoredChatDocument[];
    logFilePath: string;
    createProviderFn?: CreateProviderFn;
    onProgress?: (progress: StreamProgressSnapshot) => void;
    chatRun?: ChatRun;
    registration?: SessionRunRegistration;
  },
  delegation: ReturnType<typeof parseRuntimeDelegation>,
): Promise<RuntimeRunResult | null> => {
  if (!delegation) return null;
  if ("error" in delegation) {
    return {
      text: delegation.error,
      runtimeSessionId: input.session.runtime_session_id,
      failed: false,
    };
  }
  if (!delegation.prompt) {
    return {
      text: "Add the task you want the delegated runtime to complete.",
      runtimeSessionId: input.session.runtime_session_id,
      failed: false,
    };
  }
  const repoPath = await resolveSessionWorkspace(input.ctx, input.session);
  return runRuntimeDelegation({
    ctx: input.ctx,
    session: input.session,
    delegation,
    userMessageId: input.userMessageId,
    repoPath: repoPath ?? "",
    allowedDirectories: allowedDirectoriesForChatAttachments(
      input.session.id,
      input.images,
      input.documents,
    ),
    logFilePath: input.logFilePath,
    createProviderFn: input.createProviderFn,
    onProgress: input.onProgress,
    chatRun: input.chatRun,
    registration: input.registration,
  });
};

type ParsedRuntimeDelegation = RuntimeDelegation & {
  prompt: string;
  model?: string;
  reasoning?: WorkflowRuntimeReasoning;
  fastMode?: boolean;
  runtimeConfigurationId?: string;
};

const runRuntimeDelegation = async (input: {
  ctx: LocalServerContext;
  session: ChatSession;
  delegation: ParsedRuntimeDelegation;
  userMessageId: string;
  repoPath: string;
  allowedDirectories?: string[];
  logFilePath: string;
  createProviderFn?: CreateProviderFn;
  onProgress?: (progress: StreamProgressSnapshot) => void;
  chatRun?: ChatRun;
  registration?: SessionRunRegistration;
}) => {
  const specialistSession = await createRuntimeDelegationSession(
    input.ctx,
    input.session,
    input.delegation,
  );
  const specialist = await runDelegationSpecialist(input, specialistSession);
  if (specialist.interrupted || specialist.aborted) {
    return { ...specialist, runtimeSessionId: input.session.runtime_session_id };
  }

  return runSessionPrompt({
    session: input.session,
    repoPath: input.repoPath,
    prompt: buildRuntimeDelegationHandoffPrompt(input.delegation, specialist),
    registration: input.registration,
    allowedDirectories: input.allowedDirectories,
    logFilePath: input.logFilePath,
    createProviderFn: input.createProviderFn,
    onProgress: input.onProgress,
    newSessionId:
      input.chatRun?.runtime_session_state === "allocated" && !input.session.runtime_session_id
        ? (input.chatRun.runtime_session_id ?? undefined)
        : undefined,
    onRuntimeSession: input.chatRun
      ? (sessionId) => persistActiveRuntimeSession(input.ctx, input.chatRun?.id ?? "", sessionId)
      : undefined,
  });
};

const runDelegationSpecialist = async (
  input: Parameters<typeof runRuntimeDelegation>[0],
  specialistSession: ChatSession,
): Promise<RuntimeRunResult> => {
  const delegateLogPath = await createSessionRunLogPath(`${input.session.id}-delegate`);
  const delegationRun = input.chatRun
    ? await startDelegationRun(input.ctx, input.chatRun, {
        kind: "delegation",
        label: await resolveDelegationRunLabel(
          input.ctx,
          specialistSession,
          input.delegation.label,
        ),
        runtime: specialistSession.runtime,
        runtimeAlias: specialistSession.runtime_alias,
        runtimeConfigurationId: specialistSession.runtime_configuration_id,
        model: specialistSession.model,
        reasoning: specialistSession.reasoning_effort,
        fastMode: specialistSession.fast_mode,
        logFilePath: delegateLogPath,
      })
    : null;
  const specialist = await runSessionPrompt({
    session: specialistSession,
    repoPath: input.repoPath,
    prompt: buildRuntimeDelegationSpecialistPrompt(
      input.delegation,
      await compactControlContext(input.ctx, input.session.id, input.userMessageId),
    ),
    registration: input.registration,
    allowedDirectories: input.allowedDirectories,
    logFilePath: delegateLogPath,
    createProviderFn: input.createProviderFn,
    onProgress:
      delegationRun && input.chatRun
        ? // Specialist output streams to the card surface only; the host thread
          // shows a specialist indicator until the handoff reply begins.
          relayDelegationProgress(input.ctx, input.chatRun, delegationRun.id)
        : input.onProgress,
  });
  if (delegationRun && input.chatRun) {
    await finishDelegationRun(
      input.ctx,
      input.chatRun.id,
      delegationRun.id,
      delegationOutcomeFor(specialist),
    );
  }
  return specialist;
};

const resolveDelegationRunLabel = async (
  ctx: LocalServerContext,
  specialistSession: ChatSession,
  fallback: string,
): Promise<string> => {
  if (!specialistSession.runtime_configuration_id) return fallback;
  const configuration = await createRuntimeConfigurationRepository(ctx.db).get(
    specialistSession.runtime_configuration_id,
  );
  return configuration?.name ?? fallback;
};

const createRuntimeDelegationSession = async (
  ctx: LocalServerContext,
  session: ChatSession,
  delegation: ParsedRuntimeDelegation,
): Promise<ChatSession> => {
  if (delegation.runtimeConfigurationId) {
    const configured = await bindDelegationToConfiguration(ctx, session, delegation);
    if (configured) return configured;
  }
  return bindDelegationToCatalog(session, delegation);
};

const bindDelegationToConfiguration = async (
  ctx: LocalServerContext,
  session: ChatSession,
  delegation: ParsedRuntimeDelegation,
): Promise<ChatSession | null> => {
  const configuration = await createRuntimeConfigurationRepository(ctx.db).get(
    delegation.runtimeConfigurationId ?? "",
  );
  if (!configuration || !isWorkflowRuntimeProvider(configuration.driver)) return null;
  const driver = configuration.driver;
  return applyDelegationConfiguration(session, delegation, configuration, driver);
};

const applyDelegationConfiguration = (
  session: ChatSession,
  delegation: ParsedRuntimeDelegation,
  configuration: RuntimeConfigurationProvider,
  driver: WorkflowRuntimeProvider,
): ChatSession => {
  const model =
    configuration.models.find((item) => item.model === delegation.model) ??
    getDefaultRuntimeConfigurationModel(configuration.models);
  const levels = model?.thinkingLevels ?? [];
  const effort =
    delegation.reasoning && levels.includes(delegation.reasoning)
      ? delegation.reasoning
      : resolveRuntimeConfigurationReasoning(levels, null, model?.defaultThinkingLevel ?? null);
  return {
    ...session,
    runtime: driver,
    runtime_configuration_id: configuration.id,
    model: model?.model ?? delegation.model ?? firstModelFor(driver),
    reasoning_effort: effort,
    runtime_alias: configuration.command,
    runtime_session_id: null,
    fast_mode:
      runtimeConfigurationSupportsFastMode(configuration, model?.model ?? delegation.model ?? "") &&
      delegation.fastMode === true,
  };
};

const bindDelegationToCatalog = (
  session: ChatSession,
  delegation: ParsedRuntimeDelegation,
): ChatSession => ({
  ...session,
  runtime: delegation.runtime,
  runtime_configuration_id: null,
  model: delegation.model ?? firstModelFor(delegation.runtime),
  reasoning_effort: delegation.reasoning ?? DEFAULT_EFFORT,
  runtime_alias: delegation.runtimeAlias,
  runtime_session_id: null,
  fast_mode: delegation.fastMode === true,
});

const buildRuntimeDelegationSpecialistPrompt = (
  delegation: ParsedRuntimeDelegation,
  context: string,
): string =>
  [
    `You are a dedicated ${delegation.label} specialist working behind an AOP orchestration.`,
    RUNTIME_DELEGATION_EXECUTION_CONTRACT,
    "Complete the requested work in the repository. Return a concise, factual result for the orchestrating runtime, including changes, evidence, and blockers.",
    "## Compact orchestration context",
    context,
    "## Delegated task",
    delegation.prompt,
  ].join("\n\n");

const buildRuntimeDelegationHandoffPrompt = (
  delegation: ParsedRuntimeDelegation,
  result: RuntimeRunResult,
): string =>
  [
    result.failed
      ? `A dedicated ${delegation.label} specialist failed while working on the delegated request.`
      : `A dedicated ${delegation.label} specialist completed the delegated request.`,
    result.failed
      ? "Explain the failure honestly and give the user the best next step."
      : "Use the specialist result to produce the final response. Do not claim you personally performed the delegated work.",
    "## Original request",
    delegation.prompt,
    `## ${delegation.label} specialist ${result.failed ? "error" : "result"}`,
    result.text,
  ].join("\n\n");

const controlRequestError = (
  request: ReturnType<typeof parseControlCommand>,
  runtimeSessionId: string | null,
): RuntimeRunResult | null => {
  if (request && "error" in request) {
    return { text: request.error, runtimeSessionId, failed: false };
  }
  if (request && !request.prompt) {
    return {
      text: "Add the task you want the control session to complete after the command.",
      runtimeSessionId,
      failed: false,
    };
  }
  if (request && "command" in request) {
    const unsupportedReason = getControlCapabilityUnsupportedReason(
      request.command.provider,
      request.command.capability,
    );
    if (!unsupportedReason) return null;
    return {
      text: unsupportedReason,
      runtimeSessionId,
      failed: false,
    };
  }
  return null;
};

const runControlRequest = async (input: {
  ctx: LocalServerContext;
  session: ChatSession;
  request: Exclude<ReturnType<typeof parseControlCommand>, null | { error: string }>;
  userMessageId: string;
  repoPath: string;
  allowedDirectories?: string[];
  logFilePath: string;
  createProviderFn?: CreateProviderFn;
  onProgress?: (progress: StreamProgressSnapshot) => void;
  registration?: SessionRunRegistration;
}) => {
  const { ctx, session, request } = input;
  const controlConfig = await resolveControlRuntimeSettings(ctx, request.command);
  if (session.runtime === request.command.provider) {
    return runSessionPrompt({
      session: createControlSession(session, request.command, controlConfig),
      repoPath: input.repoPath,
      prompt: request.prompt,
      registration: input.registration,
      control: request.command,
      allowedDirectories: input.allowedDirectories,
      logFilePath: input.logFilePath,
      createProviderFn: input.createProviderFn,
      onProgress: input.onProgress,
    });
  }

  const specialist = await runSessionPrompt({
    session: createControlSession(session, request.command, controlConfig),
    repoPath: input.repoPath,
    prompt: buildControlSpecialistPrompt(
      request.command,
      request.prompt,
      await compactControlContext(ctx, session.id, input.userMessageId),
    ),
    registration: input.registration,
    control: request.command,
    allowedDirectories: input.allowedDirectories,
    logFilePath: await createSessionRunLogPath(`${session.id}-control`),
    createProviderFn: input.createProviderFn,
    onProgress: input.onProgress,
  });
  if (specialist.interrupted || specialist.aborted) {
    return { ...specialist, runtimeSessionId: session.runtime_session_id };
  }

  const handoffPrompt = specialist.failed
    ? buildControlFailureHandoffPrompt(request.command, request.prompt, specialist.text)
    : buildControlHandoffPrompt(request.command, request.prompt, specialist.text);

  return runSessionPrompt({
    session,
    repoPath: input.repoPath,
    prompt: handoffPrompt,
    registration: input.registration,
    allowedDirectories: input.allowedDirectories,
    logFilePath: input.logFilePath,
    createProviderFn: input.createProviderFn,
    onProgress: input.onProgress,
  });
};

type ControlRuntimeSettings = {
  model: string;
  reasoning: string;
  fastMode: boolean;
  runtimeConfigurationId: string | null;
  runtimeAlias: string | null;
};

const resolveControlRuntimeSettings = async (
  ctx: LocalServerContext,
  command: Extract<ReturnType<typeof parseControlCommand>, { command: unknown }>["command"],
): Promise<ControlRuntimeSettings> => {
  if (command.runtimeConfigurationId) {
    const configured = await resolveControlSettingsFromConfiguration(ctx, command);
    if (configured) return configured;
  }
  return resolveControlSettingsFromCatalog(command);
};

const resolveControlSettingsFromConfiguration = async (
  ctx: LocalServerContext,
  command: Extract<ReturnType<typeof parseControlCommand>, { command: unknown }>["command"],
): Promise<ControlRuntimeSettings | null> => {
  const configuration = await createRuntimeConfigurationRepository(ctx.db).get(
    command.runtimeConfigurationId ?? "",
  );
  if (!configuration || !isWorkflowRuntimeProvider(configuration.driver)) return null;
  const driver = configuration.driver;
  const modelRecord =
    configuration.models.find((item) => item.model === command.model) ??
    getDefaultRuntimeConfigurationModel(configuration.models);
  const levels = modelRecord?.thinkingLevels ?? [];
  const reasoning =
    command.reasoning && levels.includes(command.reasoning)
      ? command.reasoning
      : resolveRuntimeConfigurationReasoning(
          levels,
          null,
          modelRecord?.defaultThinkingLevel ?? null,
        );
  return {
    model: modelRecord?.model ?? command.model ?? firstModelFor(driver),
    reasoning,
    fastMode:
      runtimeConfigurationSupportsFastMode(
        configuration,
        configuredModelName(modelRecord, command.model),
      ) && command.fastMode === true,
    runtimeConfigurationId: configuration.id,
    runtimeAlias: configuration.command,
  };
};

const configuredModelName = (
  model: { model: string } | undefined,
  fallback: string | undefined,
): string => model?.model ?? fallback ?? "";

const resolveControlSettingsFromCatalog = (
  command: Extract<ReturnType<typeof parseControlCommand>, { command: unknown }>["command"],
): ControlRuntimeSettings => {
  const model = command.model?.trim() || getDefaultWorkflowRuntimeModel(command.provider, "");
  const reasoning =
    command.reasoning ?? getDefaultWorkflowRuntimeReasoning(command.provider, model, "medium");
  return {
    model,
    reasoning,
    fastMode: command.fastMode === true && command.provider === "codex-cli",
    runtimeConfigurationId: null,
    runtimeAlias: null,
  };
};

const createControlSession = (
  session: ChatSession,
  command: Pick<ControlCommand, "provider" | "capability">,
  config: {
    model: string;
    reasoning: string;
    fastMode: boolean;
    runtimeConfigurationId: string | null;
    runtimeAlias: string | null;
  },
): ChatSession => ({
  ...session,
  runtime: command.provider,
  runtime_configuration_id: config.runtimeConfigurationId,
  model: config.model,
  reasoning_effort: config.reasoning,
  runtime_alias: config.runtimeAlias,
  runtime_session_id: null,
  fast_mode: config.fastMode,
});

const compactControlContext = async (
  ctx: LocalServerContext,
  sessionId: string,
  currentUserMessageId: string,
): Promise<string> => {
  const messages = await ctx.chatSessionRepository.listMessages(sessionId);
  const recent = messages.filter((message) => message.id !== currentUserMessageId).slice(-6);
  if (recent.length === 0) return "No earlier conversation context.";
  return recent
    .map(
      (message) =>
        `${message.role === "assistant" ? "Assistant" : "User"}: ${compactControlText(message.content)}`,
    )
    .join("\n")
    .slice(-6_000);
};

const compactControlText = (content: string): string =>
  decodeMessageContent(content, "").text.replace(/\s+/g, " ").trim().slice(0, 1_000);

const buildControlSpecialistPrompt = (
  command: Pick<ControlCommand, "provider" | "capability">,
  request: string,
  context: string,
): string =>
  [
    `You are the dedicated ${controlProviderLabel(command.provider)} ${command.capability} control operator for an AOP orchestration.`,
    `Complete the control task using your native ${command.capability} capability.`,
    "Return a concise factual result for the orchestrating runtime, including relevant outcomes and blockers.",
    "## Compact orchestration context",
    context,
    "## Control task",
    request,
  ].join("\n\n");

const buildControlHandoffPrompt = (
  command: Pick<ControlCommand, "provider" | "capability">,
  request: string,
  result: string,
): string =>
  [
    `A dedicated ${controlProviderLabel(command.provider)} control session completed the requested ${command.capability} work.`,
    "Use its result as orchestration evidence and give the user the next useful answer. Do not claim you directly performed the control action.",
    "## Original request",
    request,
    `## ${controlProviderLabel(command.provider)} control result`,
    result,
  ].join("\n\n");

const buildControlFailureHandoffPrompt = (
  command: Pick<ControlCommand, "provider" | "capability">,
  request: string,
  error: string,
): string =>
  [
    `A dedicated ${controlProviderLabel(command.provider)} ${command.capability} control attempt failed.`,
    "Explain the failure honestly and help the user choose a safe next step. Do not claim the control action completed.",
    "## Original request",
    request,
    `## ${controlProviderLabel(command.provider)} control error`,
    error,
  ].join("\n\n");

const controlProviderLabel = (provider: ControlCommand["provider"]): string =>
  provider === "claude-code" ? "Claude" : "Codex";

const publishControlProgress = (sessionId: string, progress: StreamProgressSnapshot): void => {
  publishChatSessionEvent({
    type: "assistant-progress",
    sessionId,
    thinking: progress.thinking,
    content: progress.content,
    commandGroups: progress.commandGroups,
  });
};

const composeRuntimePrompt = (prompt: string, prefix?: string): string =>
  prefix ? `${prefix}\n\n${prompt}` : prompt;

const sessionDtoFor = async (
  ctx: LocalServerContext,
  session: ChatSession,
  lastContent?: string | null,
  lastAt?: string | null,
): Promise<ChatSessionDto> => {
  const [repo, lifecycle, unreadCount, messages] = await Promise.all([
    findSessionRepo(ctx, session),
    resolveAssistantLifecycle(ctx, session.id),
    ctx.chatSessionRepository.countUnreadAssistantMessages(session.id, session.last_read_at),
    lastContent === undefined ? ctx.chatSessionRepository.listMessages(session.id) : null,
  ]);
  const last = messages?.at(-1) ?? null;
  return {
    ...toSessionDto(session, {
      repo_name: repo?.name ?? null,
      repo_path: repo?.path ?? null,
      last_message_content: lastContent === undefined ? (last?.content ?? null) : lastContent,
      last_message_at: lastContent === undefined ? (last?.created_at ?? null) : (lastAt ?? null),
      unread_count: unreadCount,
    }),
    assistantActive: lifecycle !== "idle",
    assistantLifecycle: lifecycle,
  };
};

const firstModelFor = (runtime: WorkflowRuntimeProvider): string =>
  getWorkflowModelOptions(runtime)[0] ?? "default";

/** Prefer the first ordered runtime configuration; fall back to Claude Code catalog defaults. */
const resolveCreateSessionRuntimeDefaults = async (
  runtimeConfigurations: RuntimeConfigurationRepository,
): Promise<{
  runtime: WorkflowRuntimeProvider;
  runtimeConfigurationId: string | null;
  model: string;
  reasoningEffort: WorkflowRuntimeReasoning;
  runtimeAlias: string | null;
  fastMode: boolean;
}> => {
  const preferred = firstPreferredRuntimeConfiguration(await runtimeConfigurations.list());
  if (!preferred) {
    return {
      runtime: DEFAULT_RUNTIME,
      runtimeConfigurationId: null,
      model: firstModelFor(DEFAULT_RUNTIME),
      reasoningEffort: DEFAULT_EFFORT,
      runtimeAlias: null,
      fastMode: false,
    };
  }

  const model = getDefaultRuntimeConfigurationModel(preferred.models);
  const runtime = preferred.driver;
  return {
    runtime,
    runtimeConfigurationId: preferred.id,
    model: model?.model ?? firstModelFor(runtime),
    reasoningEffort: resolveRuntimeConfigurationReasoning(
      model?.thinkingLevels ?? [],
      null,
      model?.defaultThinkingLevel ?? null,
    ),
    runtimeAlias: preferred.command,
    fastMode: false,
  };
};

const firstPreferredRuntimeConfiguration = (
  configurations: RuntimeConfigurationProvider[],
): (RuntimeConfigurationProvider & { driver: WorkflowRuntimeProvider }) | undefined => {
  for (const configuration of configurations) {
    if (!isWorkflowRuntimeProvider(configuration.driver) || configuration.models.length === 0) {
      continue;
    }
    return { ...configuration, driver: configuration.driver };
  }
  return undefined;
};

export const deriveAutoTitle = (
  session: Pick<ChatSession, "named" | "title">,
  text: string,
): { title?: string } => {
  if (session.named) {
    return {};
  }

  const stripped = text
    .replace(/^\/\w+\s*(run\s+)?/i, "")
    .replace(/@\S+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 34);

  if (!stripped) {
    return {};
  }

  return { title: stripped };
};

const toBool = (value: boolean | number | null | undefined): boolean => Boolean(value);

const truncateSnippet = (content: string | null | undefined): string | null => {
  if (!content) return null;
  // Snippets are list previews — drop image metadata and any leaked runtime
  // "Attached Images" path block so the rail never shows absolute disk paths.
  let display = decodeMessageContent(content, "").text;
  display = stripTransportMarkers(display);
  display = display.replace(/\n*## Attached Images[\s\S]*$/i, "").trim();
  const collapsed =
    display.replace(/\s+/g, " ").trim() ||
    (content.includes("aop-chat-images") ? "Image attachment" : "");
  if (!collapsed) return null;
  if (collapsed.length <= SNIPPET_MAX) return collapsed;
  return `${collapsed.slice(0, SNIPPET_MAX - 1)}…`;
};

const stripTransportMarkers = (content: string): string => {
  let display = content;
  const delegation = parseRuntimeDelegation(display);
  if (delegation && !("error" in delegation)) display = delegation.prompt;
  const control = parseControlCommand(display);
  if (control && !("error" in control)) display = control.prompt;
  return display;
};

const toSessionDto = (
  session: ChatSession,
  extras: {
    repo_name: string | null;
    repo_path: string | null;
    last_message_content: string | null;
    last_message_at: string | null;
    unread_count?: number;
  },
): ChatSessionDto => ({
  id: session.id,
  scope: session.repo_id ? "repository" : "general",
  repoId: session.repo_id,
  repoName: session.repo_id
    ? (extras.repo_name ?? extras.repo_path?.split("/").pop() ?? session.repo_id)
    : "Tasks",
  repoPath: extras.repo_path ?? aopPaths.generalChatWorkspace(),
  title: session.title,
  named: toBool(session.named),
  runtime: session.runtime as WorkflowRuntimeProvider,
  runtimeConfigurationId: session.runtime_configuration_id,
  model: session.model,
  reasoningEffort: session.reasoning_effort as WorkflowRuntimeReasoning,
  runtimeAlias: session.runtime_alias,
  runtimeSessionId: session.runtime_session_id,
  workspacePath: session.workspace_path ?? extras.repo_path ?? aopPaths.generalChatWorkspace(),
  fastMode: toBool(session.fast_mode),
  runtimeAccessMode: session.runtime_access_mode ?? "full-access",
  defaultWorkerId: session.default_worker_id,
  defaultWorkflowId: session.default_workflow_id,
  pinned: toBool(session.pinned),
  settledOverride: session.settled_override,
  settledAt: session.settled_at,
  lastActivityAt: extras.last_message_at,
  hasPendingApproval: false,
  assistantActive: false,
  assistantLifecycle: "idle",
  snippet: truncateSnippet(extras.last_message_content),
  unreadCount: extras.unread_count ?? 0,
  updatedAt: session.updated_at,
  createdAt: session.created_at,
});

const countUnreadAssistantMessages = (
  messages: Array<{ role: string; created_at: string }>,
  lastReadAt: string | null,
): number =>
  messages.filter(
    (message) => message.role === "assistant" && message.created_at > (lastReadAt ?? ""),
  ).length;

const ensureGeneralChatWorkspace = async (): Promise<string> => {
  const workspace = aopPaths.generalChatWorkspace();
  await mkdir(workspace, { recursive: true });
  return workspace;
};

const toMessageDto = (message: ChatMessage, run?: ChatRun): ChatMessageDto => {
  const decoded = decodeMessageContent(message.content, message.session_id);
  return {
    id: message.id,
    sessionId: message.session_id,
    role: message.role,
    // Composer stores compact `[paste #N]` tokens + bodies; chat UI shows full text.
    content: expandStoredPastes(decoded.text, decoded.pastes),
    action: parseAction(message.action),
    activity: parseActivity(message.activity),
    createdAt: message.created_at,
    images: decoded.images,
    documents: decoded.documents,
    artifacts: decoded.artifacts,
    disposition: message.disposition,
    ...(run
      ? {
          runStatus: run.status,
          interruptionKind: run.interruption_kind,
          failureKind: run.failure_kind,
          contextStrategy: run.context_strategy,
          workspacePath: run.workspace_path,
          timeoutPolicy: run.timeout_policy,
          retryOfRunId: run.retry_of_run_id,
          runId: run.id,
        }
      : {}),
  };
};

const parseActivity = (raw: string | null): AssistantActivity | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AssistantActivity;
  } catch {
    return null;
  }
};

const parseAction = (raw: string | null): ChatActionPayload | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ChatActionPayload;
  } catch {
    return null;
  }
};
