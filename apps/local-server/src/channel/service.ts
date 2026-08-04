import { join } from "node:path";
import { aopPaths, generateTypeId, resolveExecHost } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { Channel, ChannelMessage, RuntimeProvider } from "../db/schema.ts";

const MAX_MESSAGE_LENGTH = 16_000;
const FACTORY_CHANNEL_NAME = "Factory floor";

type FollowUpRuntimeProvider = Extract<RuntimeProvider, "pi">;

export interface ChannelDto {
  id: string;
  repoId: string | null;
  ownerAgentId: string | null;
  kind: Channel["kind"];
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelMessageDto {
  id: string;
  channelId: string;
  authorType: ChannelMessage["author_type"];
  authorAgentId: string | null;
  content: string;
  createdAt: string;
}

export interface RuntimeFollowUpInput {
  agentId: string;
  channelId: string;
  message: string;
  runtimeProvider: FollowUpRuntimeProvider;
  sessionId: string;
  taskId: string;
  stepExecutionId: string;
  cwd: string | null;
}

export type DeliverRuntimeFollowUp = (input: RuntimeFollowUpInput) => Promise<void>;

export interface ChannelServiceDeps {
  deliverFollowUp?: DeliverRuntimeFollowUp;
}

export type ListChannelMessagesResult =
  | { success: true; messages: ChannelMessageDto[] }
  | { success: false; error: { code: "CHANNEL_NOT_FOUND" } };

export type SendChannelMessageResult =
  | { success: true; message: ChannelMessageDto }
  | { success: false; error: { code: "CHANNEL_NOT_FOUND" } | { code: "INVALID_CONTENT" } };

export const createChannelService = (ctx: LocalServerContext, deps: ChannelServiceDeps = {}) => {
  const deliverFollowUp = deps.deliverFollowUp ?? deliverRuntimeFollowUp;

  return {
    getFactoryChannel: async (): Promise<{ channel: ChannelDto }> => {
      const channel = await ensureFactoryChannel(ctx);
      await syncFactoryChannelMemberships(ctx, channel.id);
      return { channel: toChannelDto(channel) };
    },

    listMessages: async (channelId: string): Promise<ListChannelMessagesResult> => {
      const channel = await ctx.channelRepository.getById(channelId);
      if (!channel) {
        return { success: false, error: { code: "CHANNEL_NOT_FOUND" } };
      }

      const messages = await ctx.channelRepository.listMessages(channelId);
      return { success: true, messages: messages.map(toMessageDto) };
    },

    sendUserMessage: async (
      channelId: string,
      content: unknown,
    ): Promise<SendChannelMessageResult> => {
      const channel = await ctx.channelRepository.getById(channelId);
      if (!channel) {
        return { success: false, error: { code: "CHANNEL_NOT_FOUND" } };
      }

      const messageContent = normalizeContent(content);
      if (!messageContent) {
        return { success: false, error: { code: "INVALID_CONTENT" } };
      }

      const message = await ctx.channelRepository.createMessage({
        id: generateTypeId("cmsg"),
        channel_id: channelId,
        author_type: "user",
        author_agent_id: null,
        content: messageContent,
        created_at: new Date().toISOString(),
      });

      await maybeDeliverFollowUp(ctx, channel, messageContent, deliverFollowUp);

      return { success: true, message: toMessageDto(message) };
    },
  };
};

const ensureFactoryChannel = async (ctx: LocalServerContext): Promise<Channel> => {
  const existing = await readFactoryChannel(ctx);
  if (existing) return existing;

  try {
    return await createFactoryChannel(ctx);
  } catch (error) {
    const channel = await readFactoryChannel(ctx);
    if (channel) return channel;
    throw error;
  }
};

const readFactoryChannel = async (ctx: LocalServerContext): Promise<Channel | null> => {
  const channel = await ctx.db
    .selectFrom("channels")
    .selectAll()
    .where("kind", "=", "group")
    .where("repo_id", "is", null)
    .where("name", "=", FACTORY_CHANNEL_NAME)
    .executeTakeFirst();

  return channel ?? null;
};

const createFactoryChannel = async (ctx: LocalServerContext): Promise<Channel> => {
  const now = new Date().toISOString();
  return ctx.channelRepository.create({
    id: generateTypeId("chan"),
    repo_id: null,
    owner_agent_id: null,
    kind: "group",
    name: FACTORY_CHANNEL_NAME,
    artifact_path: join(aopPaths.home(), "chats", "factory-floor"),
    created_at: now,
    updated_at: now,
  });
};

const syncFactoryChannelMemberships = async (
  ctx: LocalServerContext,
  channelId: string,
): Promise<void> => {
  const activeAgents = await ctx.agentRepository.listActive();
  await Promise.all(
    activeAgents.map((agent) =>
      ctx.channelRepository.createMembership({
        channel_id: channelId,
        agent_id: agent.id,
        created_at: new Date().toISOString(),
      }),
    ),
  );
};

const maybeDeliverFollowUp = async (
  ctx: LocalServerContext,
  channel: Channel,
  message: string,
  deliverFollowUp: DeliverRuntimeFollowUp,
): Promise<void> => {
  const targetAgentIds = await resolveTargetAgentIds(ctx, channel);
  for (const agentId of targetAgentIds) {
    await deliverToAgent(ctx, channel.id, agentId, message, deliverFollowUp);
  }
};

const resolveTargetAgentIds = async (
  ctx: LocalServerContext,
  channel: Channel,
): Promise<string[]> => {
  if (channel.kind === "private") {
    return channel.owner_agent_id ? [channel.owner_agent_id] : [];
  }

  const memberships = await ctx.channelRepository.listMemberships(channel.id);
  return memberships.map((membership) => membership.agent_id);
};

const deliverToAgent = async (
  ctx: LocalServerContext,
  channelId: string,
  agentId: string,
  message: string,
  deliverFollowUp: DeliverRuntimeFollowUp,
): Promise<void> => {
  const agent = await ctx.agentRepository.getById(agentId);
  if (agent?.status !== "active" || !isFollowUpRuntime(agent.runtime_provider)) {
    return;
  }

  const activeSession = await findActiveRuntimeSession(ctx, agent.id);
  if (!activeSession?.sessionId) {
    return;
  }

  try {
    await deliverFollowUp({
      agentId: agent.id,
      channelId,
      message,
      sessionId: activeSession.sessionId,
      runtimeProvider: agent.runtime_provider,
      taskId: activeSession.taskId,
      stepExecutionId: activeSession.stepExecutionId,
      cwd: activeSession.repoPath,
    });
  } catch {
    // Chat messages are AOP product state. Runtime delivery is best-effort and
    // must not roll back operator history.
  }
};

const findActiveRuntimeSession = async (
  ctx: LocalServerContext,
  agentId: string,
): Promise<{
  sessionId: string | null;
  stepExecutionId: string;
  taskId: string;
  repoPath: string | null;
} | null> => {
  const row = await ctx.db
    .selectFrom("task_assignments")
    .innerJoin("executions", "executions.task_id", "task_assignments.task_id")
    .innerJoin("step_executions", "step_executions.execution_id", "executions.id")
    .leftJoin("repos", "repos.id", "task_assignments.repo_id")
    .select([
      "step_executions.id as step_execution_id",
      "step_executions.session_id as session_id",
      "task_assignments.task_id as task_id",
      "repos.path as repo_path",
    ])
    .where("task_assignments.agent_id", "=", agentId)
    .where("task_assignments.is_current", "=", true)
    .where("executions.status", "=", "running")
    .where("step_executions.status", "=", "running")
    .orderBy("step_executions.started_at", "desc")
    .executeTakeFirst();

  return row
    ? {
        sessionId: row.session_id,
        stepExecutionId: row.step_execution_id,
        taskId: row.task_id,
        repoPath: row.repo_path,
      }
    : null;
};

const deliverRuntimeFollowUp: DeliverRuntimeFollowUp = async ({ cwd, message, sessionId }) => {
  // The message is a trailing positional; a leading "-" could be parsed as a
  // pi CLI flag, so pad it with a space the model will ignore.
  const positionalMessage = message.startsWith("-") ? ` ${message}` : message;
  resolveExecHost().spawn({
    cmd: ["pi", "--mode", "json", "--print", "--session", sessionId, positionalMessage],
    cwd: cwd ?? process.cwd(),
    env: {
      ...process.env,
      PI_CODING_AGENT_SESSION_DIR:
        process.env.PI_CODING_AGENT_SESSION_DIR ?? join(aopPaths.home(), "pi-sessions"),
    },
    stdout: "ignore",
    stderr: "ignore",
    unref: true,
  });
};

const isFollowUpRuntime = (
  runtimeProvider: RuntimeProvider,
): runtimeProvider is FollowUpRuntimeProvider => runtimeProvider === "pi";

const normalizeContent = (content: unknown): string | null => {
  if (typeof content !== "string") {
    return null;
  }

  const trimmedContent = content.trim();
  if (!trimmedContent || trimmedContent.length > MAX_MESSAGE_LENGTH) {
    return null;
  }

  return trimmedContent;
};

const toChannelDto = (channel: Channel): ChannelDto => ({
  id: channel.id,
  repoId: channel.repo_id,
  ownerAgentId: channel.owner_agent_id,
  kind: channel.kind,
  name: channel.name,
  createdAt: channel.created_at,
  updatedAt: channel.updated_at,
});

const toMessageDto = (message: ChannelMessage): ChannelMessageDto => ({
  id: message.id,
  channelId: message.channel_id,
  authorType: message.author_type,
  authorAgentId: message.author_agent_id,
  content: message.content,
  createdAt: message.created_at,
});
