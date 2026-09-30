import type { ChatActionPayload, CliProvider, ReasoningEffort } from "@aop/common";
import { aopPaths } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { ChatMessage, ChatRun, ChatSession, Repo } from "../db/schema.ts";
import { decodeMessageContent, expandStoredPastes } from "./message-images.ts";
import { resolveAssistantLifecycle } from "./session-lifecycle.ts";
import type { AssistantActivity, ChatMessageDto, ChatSessionDto } from "./session-types.ts";

const SNIPPET_MAX = 46;

export const sessionDtoFor = async (
  ctx: LocalServerContext,
  session: ChatSession,
  lastContent?: string | null,
  lastAt?: string | null,
): Promise<ChatSessionDto> => {
  const [repo, lifecycle, unreadCount, lastMessage] = await Promise.all([
    findSessionRepo(ctx, session),
    resolveAssistantLifecycle(ctx, session.id),
    ctx.chatSessionRepository.countUnreadAssistantMessages(session.id, session.last_read_at),
    lastContent === undefined ? ctx.chatSessionRepository.getLastMessage(session.id) : null,
  ]);
  return {
    ...toSessionDto(session, {
      repo_name: repo?.name ?? null,
      repo_path: repo?.path ?? null,
      last_message_content:
        lastContent === undefined ? (lastMessage?.content ?? null) : lastContent,
      last_message_at:
        lastContent === undefined ? (lastMessage?.created_at ?? null) : (lastAt ?? null),
      unread_count: unreadCount,
    }),
    assistantActive: lifecycle !== "idle",
    assistantLifecycle: lifecycle,
  };
};

export const findSessionRepo = async (
  ctx: LocalServerContext,
  session: ChatSession,
): Promise<Repo | null> => {
  if (!session.repo_id) return null;
  return ctx.repoRepository.getById(session.repo_id);
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
  const display = decodeMessageContent(content, "")
    .text.replace(/\n*## Attached Images[\s\S]*$/i, "")
    .trim();
  const collapsed =
    display.replace(/\s+/g, " ").trim() ||
    (content.includes("aop-chat-images") ? "Image attachment" : "");
  if (!collapsed) return null;
  if (collapsed.length <= SNIPPET_MAX) return collapsed;
  return `${collapsed.slice(0, SNIPPET_MAX - 1)}…`;
};

export const toSessionDto = (
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
  runtime: session.runtime as CliProvider,
  runtimeConfigurationId: session.runtime_configuration_id,
  model: session.model,
  reasoningEffort: session.reasoning_effort as ReasoningEffort | null,
  runtimeAlias: session.runtime_alias,
  runtimeSessionId: session.runtime_session_id,
  workspacePath: session.workspace_path ?? extras.repo_path ?? aopPaths.generalChatWorkspace(),
  fastMode: toBool(session.fast_mode),
  runtimeAccessMode: session.runtime_access_mode ?? "full-access",
  pinned: toBool(session.pinned),
  settledOverride: session.settled_override,
  settledAt: session.settled_at,
  lastActivityAt: extras.last_message_at,
  assistantActive: false,
  assistantLifecycle: "idle",
  snippet: truncateSnippet(extras.last_message_content),
  unreadCount: extras.unread_count ?? 0,
  updatedAt: session.updated_at,
  createdAt: session.created_at,
});

export const countUnreadAssistantMessages = (
  messages: Array<{ role: string; created_at: string }>,
  lastReadAt: string | null,
): number =>
  messages.filter(
    (message) => message.role === "assistant" && message.created_at > (lastReadAt ?? ""),
  ).length;

export const toMessageDto = (message: ChatMessage, run?: ChatRun): ChatMessageDto => {
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
