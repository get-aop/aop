import type { ChatActionPayload, TurnPart } from "@aop/common";
import type { McpServerConfig, RunImage } from "@aop/llm-provider";
import type { LocalServerContext } from "../context.ts";
import type {
  ChatRun,
  ChatRunFailureKind,
  ChatRunInterruptionKind,
  ChatSession,
} from "../db/schema.ts";
import { loadProjectRunContext } from "../project/prompt-context.ts";
import type { RateLimitHit } from "../scheduling/rate-limit.ts";
import { executeChatCommand } from "./commands.ts";
import { prepareConversationPrompt } from "./conversation-history.ts";
import {
  allowedDirectoriesForChatAttachments,
  runImagesOf,
  type StoredChatArtifact,
  type StoredChatDocument,
  type StoredChatImage,
} from "./message-images.ts";
import { shouldSkipAssistantReply } from "./reply-state.ts";
import { inputChannelFor, recordRunInput, settleRunInput } from "./run-input.ts";
import { hostRunAccess } from "./run-permissions.ts";
import { recordChatRunPid } from "./run-process.ts";
import { persistActiveRuntimeSession, retireStaleRuntimeSession } from "./runtime-binding.ts";
import {
  type CreateProviderFn,
  type RunInput,
  type RuntimeRunResult,
  runSessionPrompt,
  type SessionRunRegistration,
} from "./runtime-engine.ts";
import { resolveSessionWorkspaceBinding } from "./workspace-binding.ts";

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
  /** What the turn produced so far, in order; null when no runtime ran (a local command). */
  parts: TurnPart[] | null;
  artifacts?: StoredChatArtifact[];
  /** Set when a rate or usage limit refused the run; the session waits and resumes. */
  rateLimit?: RateLimitHit;
}

export const produceAssistantReply = async (
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
      parts: null,
    };
  }

  let parts: TurnPart[] = [];
  const onProgress = (progress: TurnPart[]) => {
    parts = progress;
    if (chatRun) ctx.sessionHooks.onAssistantProgress(session, chatRun, progress);
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
  return toAssistantReply(run, null, parts);
};

const toAssistantReply = (
  run: RuntimeRunResult,
  action: ChatActionPayload | null,
  parts: TurnPart[],
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
    parts,
    artifacts: run.artifacts ?? [],
    rateLimit: run.rateLimit,
  };
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
      parts: null,
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
  onProgress?: (progress: TurnPart[]) => void;
  chatRun?: ChatRun;
  registration?: SessionRunRegistration;
};

const runRuntimeReply = async (input: RuntimeReplyInput) => {
  const { ctx, session, runtimePrompt } = input;
  const repoPath = await resolveSessionWorkspaceBinding(ctx, session);
  const attachmentDirectories = allowedDirectoriesForChatAttachments(
    session.id,
    input.images,
    input.documents,
  );
  const projectContext = await loadProjectRunContext(ctx, session);
  const allowedDirectories = [
    ...(attachmentDirectories ?? []),
    ...(projectContext?.readableDirectories ?? []),
  ];
  return runMainRuntimeReply(
    input,
    repoPath,
    {
      allowedDirectories: allowedDirectories.length > 0 ? allowedDirectories : undefined,
      images: runImagesOf(session.id, input.images),
      extraMcpServers: projectContext?.mcpServers,
    },
    // Read for every turn, resumed ones included: what the CLI was told before is not kept.
    projectContext?.systemPrompt,
    runtimePrompt,
  );
};

const runMainRuntimeReply = async (
  input: RuntimeReplyInput,
  repoPath: string,
  {
    allowedDirectories,
    images,
    extraMcpServers,
  }: {
    allowedDirectories?: string[];
    images: RunImage[];
    extraMcpServers?: Record<string, McpServerConfig>;
  },
  appendSystemPrompt: string | undefined,
  runtimePrompt: string,
): Promise<RuntimeRunResult> => {
  const { ctx, session } = input;
  const runInput = await openRunInput(ctx, session, input.chatRun);
  const run = await runSessionPrompt({
    session,
    repoPath,
    prompt: composeRuntimePrompt(runtimePrompt, input.runtimePromptPrefix),
    registration: input.registration,
    allowedDirectories,
    images,
    appendSystemPrompt,
    extraMcpServers,
    logFilePath: input.logFilePath,
    createProviderFn: input.createProviderFn,
    onProgress: input.onProgress,
    onRuntimeSession: input.chatRun
      ? (sessionId) => persistActiveRuntimeSession(ctx, input.chatRun?.id ?? "", sessionId)
      : undefined,
    onSpawn: chatRunPidRecorder(ctx, input.chatRun),
    input: runInput,
    hostAccess: hostRunAccess(ctx, session, input.chatRun),
  });
  if (!run.staleRuntimeSessionId || !input.chatRun) return run;

  await retireStaleRuntimeSession(ctx, input.chatRun.id, run.staleRuntimeSessionId);
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
    images,
    appendSystemPrompt,
    extraMcpServers,
    logFilePath: input.logFilePath,
    createProviderFn: input.createProviderFn,
    onProgress: input.onProgress,
    onRuntimeSession: (sessionId) =>
      persistActiveRuntimeSession(ctx, input.chatRun?.id ?? "", sessionId),
    onSpawn: chatRunPidRecorder(ctx, input.chatRun),
    input: runInput,
    hostAccess: hostRunAccess(ctx, freshSession, input.chatRun),
  });
};

/**
 * A chat run of a runtime that takes messages while it works gets an input of its own, recorded
 * before its CLI starts; its input ends once it has answered everything it was given.
 */
const openRunInput = async (
  ctx: LocalServerContext,
  session: ChatSession,
  chatRun: ChatRun | undefined,
): Promise<RunInput | undefined> => {
  const channel = chatRun ? inputChannelFor(session, chatRun) : null;
  if (!chatRun || !channel) return undefined;
  await recordRunInput(ctx, chatRun.id, channel);
  return { channel, onResult: () => void settleRunInput(ctx, chatRun.id) };
};

/** The CLI writing the chat run's own log records its pid on the run. */
const chatRunPidRecorder = (
  ctx: LocalServerContext,
  chatRun: ChatRun | undefined,
): ((pid: number) => Promise<void>) | undefined =>
  chatRun ? (pid) => recordChatRunPid(ctx, chatRun.id, pid) : undefined;

const composeRuntimePrompt = (prompt: string, prefix?: string): string =>
  prefix ? `${prefix}\n\n${prompt}` : prompt;
