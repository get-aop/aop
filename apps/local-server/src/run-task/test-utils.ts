import { createSessionMutationLock } from "../chat-session/session-mutation-lock.ts";
import type { LocalServerContext } from "../context.ts";

export const createMockContext = (): LocalServerContext => {
  return {
    db: {} as LocalServerContext["db"],
    taskAssignmentRepository: {
      getCurrentByTaskId: async () => null,
      getCurrentWithAgentNameByTaskIds: async () => new Map(),
      clearCurrentByTaskId: async () => {},
      upsertCurrent: async () => {
        throw new Error("taskAssignmentRepository.upsertCurrent not implemented in mock context");
      },
    },
    executionRepository: {} as LocalServerContext["executionRepository"],
    runtimeEventRepository: {
      insertMany: async () => {},
      listByExecutionId: async () => [],
      listByTaskId: async () => [],
      getActivitySummary: async () => undefined,
      listStepLogs: async () => [],
    },
    logBuffer: {} as LocalServerContext["logBuffer"],
    logFlusher: {} as LocalServerContext["logFlusher"],
    repoRepository: {
      create: async () => {
        throw new Error("repoRepository.create not implemented in mock context");
      },
      getByPath: async () => null,
      getById: async () => null,
      getAll: async () => [],
      remove: async () => false,
    },
    agentRepository: {
      create: async () => {
        throw new Error("agentRepository.create not implemented in mock context");
      },
      getById: async () => null,
      getByName: async () => null,
      findByName: async () => null,
      findAnyByName: async () => null,
      list: async () => [],
      listActive: async () => [],
      update: async () => null,
      countActive: async () => 0,
      listRepoMemberships: async () => [],
      replaceRepoMemberships: async () => {},
    },
    channelRepository: {
      create: async () => {
        throw new Error("channelRepository.create not implemented in mock context");
      },
      getById: async () => null,
      getPrivateByAgentId: async () => null,
      createMembership: async () => {},
      listMemberships: async () => [],
      updateName: async () => {},
      listMessages: async () => [],
      createMessage: async () => {
        throw new Error("channelRepository.createMessage not implemented in mock context");
      },
    },
    chatSessionRepository: {
      create: async () => {
        throw new Error("chatSessionRepository.create not implemented in mock context");
      },
      getById: async () => null,
      list: async () => [],
      update: async () => null,
      delete: async () => false,
      deleteGraph: async () => ({ deleted: false, cleanupJobIds: [] }),
      listMessages: async () => [],
      countUnreadAssistantMessages: async () => 0,
      createMessage: async () => {
        throw new Error("chatSessionRepository.createMessage not implemented in mock context");
      },
    },
    chatCheckpointRepository: {} as LocalServerContext["chatCheckpointRepository"],
    chatWorkLogRepository: {} as LocalServerContext["chatWorkLogRepository"],
    chatRevertRepository: {} as LocalServerContext["chatRevertRepository"],
    chatCheckpointCleanupRepository: {} as LocalServerContext["chatCheckpointCleanupRepository"],
    sessionMutationLock: createSessionMutationLock(),
    settingsRepository: {} as LocalServerContext["settingsRepository"],
    workflowRepository: {} as LocalServerContext["workflowRepository"],
    workflowSkillBlockRepository: {} as LocalServerContext["workflowSkillBlockRepository"],
    agentService: {
      createAgent: async () => ({
        success: false,
        error: { code: "AGENT_NOT_FOUND", agentId: "" },
      }),
      createManualAgent: async () => ({
        success: false,
        error: { code: "INVALID_INPUT", message: "agentService.createManualAgent not implemented" },
      }),
      createWorkerProfile: async () => ({
        success: false,
        error: {
          code: "INVALID_INPUT",
          message: "agentService.createWorkerProfile not implemented",
        },
      }),
      integrateHermesProfile: async () => ({
        success: false,
        error: {
          code: "INVALID_INPUT",
          message: "agentService.integrateHermesProfile not implemented",
        },
      }),
      listAgents: async () => [],
      listHermesProfiles: async () => [],
      getAgent: async () => null,
      updateAgent: async () => ({
        success: false,
        error: { code: "AGENT_NOT_FOUND", agentId: "" },
      }),
      listAgentRepoIds: async () => null,
      replaceAgentRepos: async () => ({
        success: false,
        error: { code: "AGENT_NOT_FOUND", agentId: "" },
      }),
    },
    taskEventEmitter: {} as LocalServerContext["taskEventEmitter"],
    linearHandlers: {
      connect: async () => ({ authorizeUrl: "" }),
      callback: async () => ({ connected: false }),
      getStatus: async () => ({ connected: false, locked: true }),
      unlock: async () => {},
      disconnect: async () => {},
      testConnection: async () => ({
        ok: false,
        organizationName: "",
        userName: "",
        userEmail: "",
      }),
    },
    externalIssueStore: {
      upsertTaskSource: async () => {},
      getTaskSourceByExternalId: async () => null,
      getTaskSourceByExternalRef: async () => null,
      getTaskSourceByTaskId: async () => null,
      listTaskSourcesByRepo: async () => [],
      replaceTaskDependencies: async () => {},
      replaceTaskDependencyEdges: async () => {},
      listTaskDependencies: async () => [],
    },
    linearStore: {
      upsertTaskSource: async () => {},
      getTaskSourceByExternalId: async () => null,
      getTaskSourceByExternalRef: async () => null,
      replaceTaskDependencies: async () => {},
      listTaskDependencies: async () => [],
    },
    linearTokenStore: {
      save: async () => {},
      getStatus: async () => ({ connected: false, locked: true }),
      unlock: async () => {},
      read: async () => {
        throw new Error("linearTokenStore.read not implemented in mock context");
      },
      lock: async () => {},
      disconnect: async () => {},
    },
    jiraOAuthHandlers: {
      connect: async () => ({ authorizeUrl: "" }),
      callback: async () => ({ connected: false }),
      getStatus: async () => ({ connected: false, locked: true }),
      unlock: async () => {},
      disconnect: async () => {},
      testConnection: async () => ({
        ok: false,
        siteName: "",
        siteUrl: "",
        accountId: "",
        accountDisplayName: "",
        accountEmail: "",
      }),
    },
    jiraTokenStore: {
      save: async () => {},
      getStatus: async () => ({ connected: false, locked: true }),
      unlock: async () => {},
      read: async () => {
        throw new Error("jiraTokenStore.read not implemented in mock context");
      },
      lock: async () => {},
      disconnect: async () => {},
    },
    workflowService: {
      listWorkflows: async () => [],
      listWorkflowDetails: async () => [],
      listStepLibrary: async () => [],
      createSkillBlock: async (input) => ({
        ...input,
        source: "user",
      }),
      createWorkflowFromSteps: async (input) => ({
        id: "workflow-custom",
        name: input.name,
        version: 1,
        active: true,
        source: "user",
        stepCount: 0,
        steps: [],
      }),
      deleteSkillBlock: async () => undefined,
      deleteWorkflow: async () => undefined,
      startTask: async () => ({ status: "READY" }),
      completeStep: async () => ({ taskStatus: "DONE", step: null }),
      resumeTask: async () => ({ taskStatus: "DONE", step: null }),
    },
    taskRepository: {
      refresh: async () => {},
      create: async () => {
        throw new Error("taskRepository.create not implemented in mock context");
      },
      createIdempotent: async () => null,
      createIdempotentRecordOnly: async () => null,
      get: async () => null,
      getByChangePath: async () => null,
      update: async () => null,
      markRemoved: async () => false,
      deleteByRepoId: async () => {},
      list: async () => [],
      findCreatedSince: async () => [],
      countWorking: async () => 0,
      getDependencyState: async () => ({
        dependencyState: "ready",
        blockedByTaskIds: [],
        blockedByRefs: [],
      }),
      getNextExecutable: async () => null,
      getNextResumable: async () => null,
      resetStaleWorkingTasks: async () => 0,
      getMetrics: async () => ({
        total: 0,
        byStatus: {
          DRAFT: 0,
          READY: 0,
          RESUMING: 0,
          WORKING: 0,
          PAUSED: 0,
          BLOCKED: 0,
          DONE: 0,
          REMOVED: 0,
        },
        successRate: 0,
        avgDurationMs: 0,
        avgFailedDurationMs: 0,
      }),
    },
    schedulerRepository: {
      create: async () => {
        throw new Error("not implemented in mock context");
      },
      getById: async () => null,
      listByRepoId: async () => [],
      listAll: async () => [],
      update: async () => null,
      delete: async () => false,
    },
    schedulerService: {
      createTrigger: async () => {
        throw new Error("not implemented in mock context");
      },
      updateTrigger: async () => null,
      deleteTrigger: async () => false,
      getTrigger: async () => null,
      listTriggers: async () => [],
      runTrigger: async () => ({
        triggerId: "",
        action: "",
        promoted: 0,
        skipped: 0,
      }),
      getDueTriggers: async () => [],
      processOnce: async () => 0,
    },
    trackerReimporter: {
      reimportRepo: async () => ({ imported: 0, skipped: 0, failures: [] }),
    },
  };
};
