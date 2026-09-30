import type { LocalServerContext } from "../context.ts";
import type { ChatRun, ChatSession } from "../db/schema.ts";
import { ensureSessionChatRunRecovery } from "./run-recovery.ts";
import {
  countUnreadAssistantMessages,
  findSessionRepo,
  toMessageDto,
  toSessionDto,
} from "./session-dto.ts";
import { resolveAssistantLifecycle, resolveAssistantLifecycles } from "./session-lifecycle.ts";
import type {
  ChatSessionDto,
  ChatSessionServiceDeps,
  GetChatSessionResult,
} from "./session-types.ts";
import { readSessionGitLocation, resolveSessionWorkspaceResult } from "./session-workspace.ts";
import { discoverRuntimeSkills } from "./skill-discovery.ts";

export const listChatSessions = async (
  ctx: LocalServerContext,
): Promise<{ sessions: ChatSessionDto[] }> => {
  const rows = await ctx.chatSessionRepository.list();
  const lifecycleBySession = await resolveAssistantLifecycles(
    ctx,
    rows.map((row) => row.id),
  );
  const locations = new Map<string, Promise<{ worktreePath: string; branch: string | null }>>();
  const sessions = await Promise.all(
    rows.map(async (row) => {
      const session = toSessionDto(row, row);
      const location =
        locations.get(session.workspacePath) ?? readSessionGitLocation(session.workspacePath);
      locations.set(session.workspacePath, location);
      const lifecycle = lifecycleBySession.get(row.id) ?? "idle";
      const gitLocation = await location;
      return {
        ...session,
        branch: gitLocation.branch,
        assistantActive: lifecycle !== "idle",
        assistantLifecycle: lifecycle,
      };
    }),
  );
  return { sessions };
};

export const getChatSession = async (
  ctx: LocalServerContext,
  sessionId: string,
  deps: ChatSessionServiceDeps,
): Promise<GetChatSessionResult> => {
  const session = await ctx.chatSessionRepository.getById(sessionId);
  if (!session) return { success: false, error: { code: "SESSION_NOT_FOUND" } };
  return loadChatSessionDetail(ctx, session, deps);
};

export const getChatSessionLocation = async (ctx: LocalServerContext, sessionId: string) => {
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
