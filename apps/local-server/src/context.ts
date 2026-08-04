import type { Kysely } from "kysely";
import { type AgentRepository, createAgentRepository } from "./agent/repository.ts";
import { type AgentService, createAgentService } from "./agent/service.ts";
import { type ChannelRepository, createChannelRepository } from "./channel/repository.ts";
import {
  type ChatCheckpointCleanupRepository,
  createChatCheckpointCleanupRepository,
} from "./chat-session/checkpoint-cleanup-repository.ts";
import {
  type ChatCheckpointRepository,
  createChatCheckpointRepository,
} from "./chat-session/checkpoint-repository.ts";
import {
  type ChatSessionRepository,
  createChatSessionRepository,
} from "./chat-session/repository.ts";
import {
  type ChatRevertRepository,
  createChatRevertRepository,
} from "./chat-session/revert-repository.ts";
import {
  createSessionMutationLock,
  type SessionMutationLock,
} from "./chat-session/session-mutation-lock.ts";
import {
  type ChatWorkLogRepository,
  createChatWorkLogRepository,
} from "./chat-session/work-log-repository.ts";
import type { Database } from "./db/schema.ts";
import {
  getLogBuffer,
  getTaskEventEmitter,
  type LogBuffer,
  type TaskEventEmitter,
} from "./events/index.ts";
import {
  createExecutionRepository,
  type ExecutionRepository,
} from "./executor/execution-repository.ts";
import { createLogFlusher, type LogFlusher } from "./executor/log-flusher.ts";
import {
  createExternalIssueStore,
  type ExternalIssueStore,
} from "./integrations/external-issues/store.ts";
import { createJiraOAuth } from "./integrations/jira/oauth.ts";
import {
  exchangeJiraCodeForTokens,
  testJiraOAuthConnection,
} from "./integrations/jira/oauth-api.ts";
import {
  createJiraOAuthHandlers,
  type JiraOAuthHandlers,
} from "./integrations/jira/oauth-handlers.ts";
import { refreshJiraTokens } from "./integrations/jira/oauth-token-refresh.ts";
import { createJiraTokenStore } from "./integrations/jira/oauth-token-store.ts";
import type { JiraTokenStore } from "./integrations/jira/oauth-types.ts";
import { createLinearHandlers, type LinearHandlers } from "./integrations/linear/handlers.ts";
import { createLinearOAuth } from "./integrations/linear/oauth.ts";
import { createLinearStore, type LinearStore } from "./integrations/linear/store.ts";
import { refreshLinearTokens } from "./integrations/linear/token-refresh.ts";
import { createLinearTokenStore } from "./integrations/linear/token-store.ts";
import type { LinearTokenStore } from "./integrations/linear/types.ts";
import { createRepoRepository, type RepoRepository } from "./repo/repository.ts";
import { projectRuntimeEventsForStep } from "./runtime-events/projector.ts";
import {
  createRuntimeEventRepository,
  type RuntimeEventRepository,
} from "./runtime-events/repository.ts";
import { createSchedulerRepository, type SchedulerRepository } from "./scheduler/repository.ts";
import {
  createSchedulerService,
  type SchedulerService,
  type TrackerReimporter,
} from "./scheduler/service.ts";
import { createTrackerReimporter } from "./scheduler/tracker-reimporter.ts";
import { createSettingsRepository, type SettingsRepository } from "./settings/repository.ts";
import { SettingKey } from "./settings/types.ts";
import { createTaskRepository, type TaskRepository } from "./task/repository.ts";
import {
  createTaskAssignmentRepository,
  type TaskAssignmentRepository,
} from "./task-assignment/repository.ts";
import { createWorkflowRepository, type WorkflowRepository } from "./workflow/repository.ts";
import { createLocalWorkflowService, type LocalWorkflowService } from "./workflow/service.ts";
import {
  createWorkflowSkillBlockRepository,
  type WorkflowSkillBlockRepository,
} from "./workflow/skill-block-repository.ts";

export interface LocalServerContext {
  db: Kysely<Database>;
  taskRepository: TaskRepository;
  taskAssignmentRepository: TaskAssignmentRepository;
  repoRepository: RepoRepository;
  agentRepository: AgentRepository;
  channelRepository: ChannelRepository;
  chatSessionRepository: ChatSessionRepository;
  chatCheckpointRepository: ChatCheckpointRepository;
  chatWorkLogRepository: ChatWorkLogRepository;
  chatRevertRepository: ChatRevertRepository;
  chatCheckpointCleanupRepository: ChatCheckpointCleanupRepository;
  /** Shared barrier so destructive maintenance cannot race chat mutations. */
  sessionMutationLock: SessionMutationLock;
  settingsRepository: SettingsRepository;
  executionRepository: ExecutionRepository;
  runtimeEventRepository: RuntimeEventRepository;
  workflowRepository: WorkflowRepository;
  workflowSkillBlockRepository: WorkflowSkillBlockRepository;
  agentService: AgentService;
  taskEventEmitter: TaskEventEmitter;
  logBuffer: LogBuffer;
  logFlusher: LogFlusher;
  workflowService: LocalWorkflowService;
  schedulerRepository: SchedulerRepository;
  schedulerService: SchedulerService;
  trackerReimporter: TrackerReimporter;
  linearHandlers: LinearHandlers;
  externalIssueStore: ExternalIssueStore;
  linearStore: LinearStore;
  linearTokenStore: LinearTokenStore;
  jiraOAuthHandlers: JiraOAuthHandlers;
  jiraTokenStore: JiraTokenStore;
}

export interface CreateCommandContextOptions {
  taskEventEmitter?: TaskEventEmitter;
  logBuffer?: LogBuffer;
  logFlusher?: LogFlusher;
}

export const createCommandContext = (
  db: Kysely<Database>,
  options: CreateCommandContextOptions = {},
): LocalServerContext => {
  const taskEventEmitter = options.taskEventEmitter ?? getTaskEventEmitter();
  const logBuffer = options.logBuffer ?? getLogBuffer();
  const repoRepository = createRepoRepository(db);
  const agentRepository = createAgentRepository(db);
  const taskAssignmentRepository = createTaskAssignmentRepository(db);
  const channelRepository = createChannelRepository(db);
  const chatSessionRepository = createChatSessionRepository(db);
  const chatCheckpointRepository = createChatCheckpointRepository(db);
  const chatWorkLogRepository = createChatWorkLogRepository(db);
  const chatRevertRepository = createChatRevertRepository(db);
  const chatCheckpointCleanupRepository = createChatCheckpointCleanupRepository(db);
  const sessionMutationLock = createSessionMutationLock();
  const settingsRepository = createSettingsRepository(db);
  const executionRepository = createExecutionRepository(db);
  const runtimeEventRepository = createRuntimeEventRepository(db);
  let context: LocalServerContext;
  const logFlusher =
    options.logFlusher ??
    createLogFlusher(executionRepository, {
      afterLogsSaved: (stepExecutionId) => projectRuntimeEventsForStep(context, stepExecutionId),
    });
  const externalIssueStore = createExternalIssueStore(db);
  const linearStore = createLinearStore(externalIssueStore);
  const tokenStore = createLinearTokenStore();
  const linearHandlers = createLinearHandlers({
    createAuth: createLinearOAuth,
    getConfig: async () => {
      const configuredClientId = await settingsRepository.get(SettingKey.LINEAR_CLIENT_ID);
      const configuredCallbackUrl = await settingsRepository.get(SettingKey.LINEAR_CALLBACK_URL);
      const redirectUri = resolveLinearCallbackUrl({
        configuredCallbackUrl,
        env: process.env,
      });

      if (configuredCallbackUrl !== redirectUri && configuredCallbackUrl.length > 0) {
        await settingsRepository.set(SettingKey.LINEAR_CALLBACK_URL, redirectUri);
      }

      const clientId = configuredClientId || process.env.AOP_LINEAR_CLIENT_ID || "";

      return {
        enabled: clientId.length > 0 && redirectUri.length > 0,
        clientId,
        redirectUri,
      };
    },
    tokenStore,
    exchangeCodeForTokens: ({ clientId, code, verifier, redirectUri }) =>
      exchangeLinearCodeForTokens({ clientId, code, verifier, redirectUri }),
    refreshTokens: ({ clientId, refreshToken }) => refreshLinearTokens({ clientId, refreshToken }),
    testConnectionWithToken: (accessToken) => testLinearConnection({ accessToken }),
  });

  const jiraTokenStore = createJiraTokenStore();
  const jiraOAuthHandlers = createJiraOAuthHandlers({
    createAuth: createJiraOAuth,
    getConfig: async () => {
      const [configuredClientId, configuredClientSecret, configuredCallbackUrl] = await Promise.all(
        [
          settingsRepository.get(SettingKey.JIRA_CLIENT_ID),
          settingsRepository.get(SettingKey.JIRA_CLIENT_SECRET),
          settingsRepository.get(SettingKey.JIRA_CALLBACK_URL),
        ],
      );
      const redirectUri = resolveJiraCallbackUrl({
        configuredCallbackUrl,
        env: process.env,
      });

      if (configuredCallbackUrl !== redirectUri && configuredCallbackUrl.length > 0) {
        await settingsRepository.set(SettingKey.JIRA_CALLBACK_URL, redirectUri);
      }

      const clientId = configuredClientId || process.env.AOP_JIRA_CLIENT_ID || "";
      const clientSecret = configuredClientSecret || process.env.AOP_JIRA_CLIENT_SECRET || "";

      return {
        enabled: clientId.length > 0 && clientSecret.length > 0 && redirectUri.length > 0,
        clientId,
        clientSecret,
        redirectUri,
      };
    },
    tokenStore: jiraTokenStore,
    exchangeCodeForTokens: ({ clientId, clientSecret, code, redirectUri }) =>
      exchangeJiraCodeForTokens({ clientId, clientSecret, code, redirectUri }),
    refreshTokens: ({ clientId, clientSecret, refreshToken }) =>
      refreshJiraTokens({ clientId, clientSecret, refreshToken }),
    testConnectionWithToken: (accessToken, cloudId) =>
      testJiraOAuthConnection({ accessToken, cloudId }),
  });

  context = {
    db,
    taskRepository: createTaskRepository(db, {
      eventEmitter: taskEventEmitter,
    }),
    taskAssignmentRepository,
    repoRepository,
    agentRepository,
    channelRepository,
    chatSessionRepository,
    chatCheckpointRepository,
    chatWorkLogRepository,
    chatRevertRepository,
    chatCheckpointCleanupRepository,
    sessionMutationLock,
    settingsRepository,
    executionRepository,
    runtimeEventRepository,
    workflowRepository: createWorkflowRepository(db),
    workflowSkillBlockRepository: createWorkflowSkillBlockRepository(db),
    schedulerRepository: createSchedulerRepository(db),
    schedulerService: undefined as unknown as SchedulerService,
    trackerReimporter: undefined as unknown as TrackerReimporter,
    agentService: undefined as unknown as AgentService,
    taskEventEmitter,
    logBuffer,
    logFlusher,
    linearHandlers,
    externalIssueStore,
    linearStore,
    linearTokenStore: tokenStore,
    jiraOAuthHandlers,
    jiraTokenStore,
  } as LocalServerContext;

  context.trackerReimporter = createTrackerReimporter({ ctx: context });
  context.workflowService = createLocalWorkflowService(context);
  context.schedulerService = createSchedulerService(context);
  context.agentService = createAgentService(context);

  return context;
};

export const resolveLinearCallbackUrl = ({
  configuredCallbackUrl,
  env,
}: {
  configuredCallbackUrl: string;
  env: NodeJS.ProcessEnv;
}): string => {
  if (!configuredCallbackUrl.length) {
    return getDefaultLinearCallbackUrl(env);
  }

  return isLegacyLinearCallbackUrl(configuredCallbackUrl)
    ? getDefaultLinearCallbackUrl(env)
    : configuredCallbackUrl;
};

const getDefaultLinearCallbackUrl = (env: NodeJS.ProcessEnv): string => {
  const callbackBase =
    env.AOP_LINEAR_CALLBACK_BASE ?? env.AOP_LOCAL_SERVER_URL ?? "http://127.0.0.1:4310";
  return new URL("/api/linear/callback", callbackBase).toString();
};

const isLegacyLinearCallbackUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      url.port === "4310" &&
      url.pathname === "/api/linear/callback"
    );
  } catch {
    return false;
  }
};

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";

export const exchangeLinearCodeForTokens = async (params: {
  clientId: string;
  code: string;
  verifier: string;
  redirectUri: string;
}) => {
  const requestBody = new URLSearchParams({
    client_id: params.clientId,
    code: params.code,
    code_verifier: params.verifier,
    grant_type: "authorization_code",
    redirect_uri: params.redirectUri,
  });

  const response = await fetch(LINEAR_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: requestBody.toString(),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    const suffix = errorBody ? `: ${errorBody}` : "";
    throw new Error(`Linear OAuth token exchange failed (${response.status})${suffix}`);
  }

  const body = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  if (!body.access_token || !body.refresh_token || typeof body.expires_in !== "number") {
    throw new Error("Linear OAuth token exchange returned an invalid payload");
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: new Date(Date.now() + body.expires_in * 1000).toISOString(),
  };
};

export const testLinearConnection = async ({ accessToken }: { accessToken: string }) => {
  const response = await fetch(LINEAR_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: `query ViewerStatus { viewer { id name email } organization { id name } }`,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    const suffix = errorBody ? `: ${errorBody}` : "";
    throw new Error(`Linear connection test failed (${response.status})${suffix}`);
  }

  const body = (await response.json()) as {
    data?: {
      viewer?: { name?: string | null; email?: string | null };
      organization?: { name?: string | null };
    };
    errors?: Array<{ message?: string }>;
  };

  if (body.errors?.length) {
    throw new Error(body.errors[0]?.message || "Linear connection test returned an error");
  }

  const organizationName = body.data?.organization?.name || "";
  const userName = body.data?.viewer?.name || "";
  const userEmail = body.data?.viewer?.email || "";

  return {
    ok: organizationName.length > 0,
    organizationName,
    userName,
    userEmail,
  };
};

export const resolveJiraCallbackUrl = ({
  configuredCallbackUrl,
  env,
}: {
  configuredCallbackUrl: string;
  env: NodeJS.ProcessEnv;
}): string => {
  if (!configuredCallbackUrl.length) {
    return getDefaultJiraCallbackUrl(env);
  }

  return isLegacyJiraCallbackUrl(configuredCallbackUrl)
    ? getDefaultJiraCallbackUrl(env)
    : configuredCallbackUrl;
};

const getDefaultJiraCallbackUrl = (env: NodeJS.ProcessEnv): string => {
  const callbackBase =
    env.AOP_JIRA_CALLBACK_BASE ?? env.AOP_LOCAL_SERVER_URL ?? "http://127.0.0.1:4310";
  return new URL("/api/jira/oauth/callback", callbackBase).toString();
};

const isLegacyJiraCallbackUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      url.port === "4310" &&
      url.pathname === "/api/jira/oauth/callback"
    );
  } catch {
    return false;
  }
};
