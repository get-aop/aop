// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: agent service maps validation branches to explicit API errors.
import { rm } from "node:fs/promises";
import { aopPaths, generateTypeId } from "@aop/infra";
import { createChannelRepository } from "../channel/repository.ts";
import type { LocalServerContext } from "../context.ts";
import type {
  Agent,
  AgentProvider,
  AgentRole,
  AgentSourceKind,
  AgentStatus,
  MembershipRole,
  RuntimeProvider,
} from "../db/schema.ts";
import {
  AgentNameSchema,
  HermesAgentImportInputSchema,
  type HermesProfileSummary,
  ManualAgentInputSchema,
  WorkerProfileInputSchema,
} from "./contracts.ts";
import {
  listHermesProfiles as discoverHermesProfiles,
  isSupportedHermesProvider,
  readHermesProfile,
  readHermesProfileText,
} from "./hermes.ts";
import { createAgentRepository } from "./repository.ts";
import { normalizeAgentRoleLane } from "./roles.ts";
import { scaffoldAgentArtifacts, writeAgentScaffold } from "./scaffold.ts";

export interface AgentRecord {
  id: string;
  name: string;
  role: AgentRole;
  runtimeProvider: RuntimeProvider;
  provider: AgentProvider;
  model: string;
  /** When true, backlog auto-distribution skips this worker. */
  autoDistributeDisabled: boolean;
  workflowId: string;
  /** Resolved workflow name for UI labels; workflowId remains the persisted id or name key. */
  workflowName: string;
  /** Free-text "what this worker focuses on", shown on the board. */
  focus: string | null;
  status: AgentStatus;
  artifactPath: string;
  sourceKind: AgentSourceKind;
  sourceRef: string | null;
  repoIds: string[];
  privateChannelId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentInput {
  name: string;
  role: AgentRole;
  runtimeProvider: RuntimeProvider;
  model: string;
  workflowId?: string;
  repoIds: string[];
  autoDistributeDisabled?: boolean;
  focus?: string | null;
}

export interface UpdateAgentInput {
  name?: string;
  role?: AgentRole;
  model?: string;
  workflowId?: string;
  status?: AgentStatus;
  autoDistributeDisabled?: boolean;
  focus?: string | null;
}

export type AgentServiceError =
  | { code: "AGENT_NOT_FOUND"; agentId: string }
  | { code: "INVALID_WORKFLOW"; workflowId: string }
  | { code: "UNKNOWN_REPOS"; repoIds: string[] }
  | { code: "DUPLICATE_NAME"; name: string }
  | { code: "INVALID_INPUT"; message: string }
  | { code: "HERMES_PROFILE_NOT_FOUND"; message: string }
  | { code: "UNSUPPORTED_PROVIDER_MODEL"; message: string };

export type AgentServiceResult<T> =
  | { success: true; agent: T }
  | { success: false; error: AgentServiceError };

export type ReplaceAgentReposResult =
  | { success: true; repoIds: string[] }
  | { success: false; error: AgentServiceError };

const WORKFLOW_DEFINED_WORKER_RUNTIME_PROVIDER = "opencode";
const WORKFLOW_DEFINED_WORKER_MODEL = "workflow-defined";

export interface AgentService {
  createAgent: (input: CreateAgentInput) => Promise<AgentServiceResult<AgentRecord>>;
  createManualAgent: (input: unknown) => Promise<AgentServiceResult<AgentRecord>>;
  createWorkerProfile: (input: unknown) => Promise<AgentServiceResult<AgentRecord>>;
  integrateHermesProfile: (input: unknown) => Promise<AgentServiceResult<AgentRecord>>;
  listAgents: () => Promise<AgentRecord[]>;
  listHermesProfiles: () => Promise<HermesProfileSummary[]>;
  getAgent: (agentId: string) => Promise<AgentRecord | null>;
  updateAgent: (
    agentId: string,
    input: UpdateAgentInput,
  ) => Promise<AgentServiceResult<AgentRecord>>;
  listAgentRepoIds: (agentId: string) => Promise<string[] | null>;
  replaceAgentRepos: (agentId: string, repoIds: string[]) => Promise<ReplaceAgentReposResult>;
}

class ActiveWorkerLimitError extends Error {
  constructor(readonly limitResult: AgentServiceResult<never>) {
    super("Active worker limit reached");
  }
}

export const createAgentService = (ctx: LocalServerContext): AgentService => {
  const agentRepository = createAgentRepository(ctx.db);

  return {
    createAgent: async (input) => {
      const repoIds = normalizeRepoIds(input.repoIds);
      const workflowId = await resolveWorkflowId(ctx, input.workflowId);
      if (!workflowId) {
        return {
          success: false,
          error: { code: "INVALID_WORKFLOW", workflowId: input.workflowId ?? "" },
        };
      }

      const unknownRepoIds = await findUnknownRepoIds(ctx, repoIds);
      if (unknownRepoIds.length > 0) {
        return { success: false, error: { code: "UNKNOWN_REPOS", repoIds: unknownRepoIds } };
      }

      const nameConflict = await reserveAgentNameForCreate(ctx, agentRepository, input.name);
      if (nameConflict) {
        return nameConflict;
      }

      return createPersistedAgent(ctx, {
        name: input.name,
        role: normalizeAgentRoleLane(input.role),
        runtimeProvider: input.runtimeProvider,
        provider: providerForRuntime(input.runtimeProvider, input.model),
        model: input.model,
        autoDistributeDisabled: input.autoDistributeDisabled,
        workflowId,
        repoIds,
        sourceKind: sourceKindForRuntime(input.runtimeProvider),
        sourceRef: null,
        soul: isWorkerRuntime(input.runtimeProvider) ? null : `# Soul\n- Agent ${input.name}\n`,
        memory: isWorkerRuntime(input.runtimeProvider)
          ? null
          : `# Memory\n- Workflow: ${workflowId}\n`,
        runtime: {
          importStrategy: isWorkerRuntime(input.runtimeProvider)
            ? workerImportStrategy(input.runtimeProvider)
            : "manual",
          profileName: null,
          sourcePath: null,
          configPath: null,
          soulPath: null,
          memoryPath: null,
          cwd: null,
          reasoningEffort: null,
          fastMode: false,
        },
      });
    },

    createManualAgent: async (input) => {
      const parsed = ManualAgentInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          success: false,
          error: {
            code: "INVALID_INPUT",
            message: parsed.error.issues[0]?.message ?? "Invalid manual agent input",
          },
        };
      }

      const workflowId = await resolveWorkflowId(ctx, parsed.data.workflowId);
      if (!workflowId) {
        return {
          success: false,
          error: { code: "INVALID_WORKFLOW", workflowId: parsed.data.workflowId },
        };
      }

      const nameConflict = await reserveAgentNameForCreate(ctx, agentRepository, parsed.data.name);
      if (nameConflict) {
        return nameConflict;
      }

      return createPersistedAgent(ctx, {
        name: parsed.data.name,
        role: normalizeAgentRoleLane(parsed.data.role),
        runtimeProvider: parsed.data.runtimeProvider,
        provider: parsed.data.provider,
        model: parsed.data.model,
        autoDistributeDisabled: parsed.data.autoDistributeDisabled,
        workflowId,
        repoIds: [],
        sourceKind: "manual",
        sourceRef: null,
        soul: parsed.data.soul ?? buildManualSoul(parsed.data.name, parsed.data.role),
        memory: parsed.data.memory ?? buildManualMemory(workflowId),
        runtime: {
          importStrategy: "manual",
          profileName: null,
          sourcePath: null,
          configPath: null,
          soulPath: null,
          memoryPath: null,
          cwd: null,
          reasoningEffort: null,
          fastMode: false,
        },
      });
    },

    createWorkerProfile: async (input) => {
      const parsed = WorkerProfileInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          success: false,
          error: {
            code: "INVALID_INPUT",
            message: parsed.error.issues[0]?.message ?? "Invalid worker profile input",
          },
        };
      }

      const workflowId = await resolveWorkflowId(ctx, parsed.data.workflowId);
      if (!workflowId) {
        return {
          success: false,
          error: { code: "INVALID_WORKFLOW", workflowId: parsed.data.workflowId },
        };
      }

      const repoIds = normalizeRepoIds(parsed.data.repoIds);
      const unknownRepoIds = await findUnknownRepoIds(ctx, repoIds);
      if (unknownRepoIds.length > 0) {
        return { success: false, error: { code: "UNKNOWN_REPOS", repoIds: unknownRepoIds } };
      }

      const nameConflict = await reserveAgentNameForCreate(ctx, agentRepository, parsed.data.name);
      if (nameConflict) {
        return nameConflict;
      }

      return createPersistedAgent(ctx, {
        name: parsed.data.name,
        role: parsed.data.role,
        focus: parsed.data.focus ?? null,
        runtimeProvider: WORKFLOW_DEFINED_WORKER_RUNTIME_PROVIDER,
        provider: WORKFLOW_DEFINED_WORKER_RUNTIME_PROVIDER,
        model: WORKFLOW_DEFINED_WORKER_MODEL,
        autoDistributeDisabled: parsed.data.autoDistributeDisabled,
        workflowId,
        repoIds,
        sourceKind: sourceKindForRuntime(WORKFLOW_DEFINED_WORKER_RUNTIME_PROVIDER),
        sourceRef: null,
        soul: null,
        memory: null,
        runtime: {
          importStrategy: workerImportStrategy(WORKFLOW_DEFINED_WORKER_RUNTIME_PROVIDER),
          profileName: null,
          sourcePath: null,
          configPath: null,
          soulPath: null,
          memoryPath: null,
          cwd: null,
          reasoningEffort: null,
          fastMode: false,
        },
      });
    },

    integrateHermesProfile: async (input) => {
      const parsed = HermesAgentImportInputSchema.safeParse(input);
      if (!parsed.success) {
        return {
          success: false,
          error: {
            code: "INVALID_INPUT",
            message: parsed.error.issues[0]?.message ?? "Invalid Hermes import input",
          },
        };
      }

      const profile = await readHermesProfile(parsed.data.profileName);
      if (!profile) {
        return {
          success: false,
          error: {
            code: "HERMES_PROFILE_NOT_FOUND",
            message: `Hermes profile '${parsed.data.profileName}' was not found`,
          },
        };
      }

      if (!profile.isSupported || !isSupportedHermesProvider(profile.provider)) {
        return {
          success: false,
          error: {
            code: "UNSUPPORTED_PROVIDER_MODEL",
            message:
              profile.validationError ??
              `Hermes profile '${profile.name}' uses a provider/model pair that AOP v1 does not support`,
          },
        };
      }

      const agentName = parsed.data.name ?? profile.name;
      const nameResult = AgentNameSchema.safeParse(agentName);
      if (!nameResult.success) {
        return {
          success: false,
          error: {
            code: "INVALID_INPUT",
            message: nameResult.error.issues[0]?.message ?? "Invalid agent name",
          },
        };
      }

      const workflowId = await resolveWorkflowId(ctx, parsed.data.workflowId);
      if (!workflowId) {
        return {
          success: false,
          error: { code: "INVALID_WORKFLOW", workflowId: parsed.data.workflowId },
        };
      }

      const nameConflict = await reserveAgentNameForCreate(ctx, agentRepository, agentName);
      if (nameConflict) {
        return nameConflict;
      }

      return createPersistedAgent(ctx, {
        name: agentName,
        role: parsed.data.role,
        runtimeProvider: "hermes",
        provider: profile.provider,
        model: profile.model,
        workflowId,
        repoIds: [],
        sourceKind: "hermes-profile",
        sourceRef: profile.name,
        soul:
          (await readHermesProfileText(profile.soulPath)) ??
          buildImportedSoul(profile.name, parsed.data.role),
        memory:
          (await readHermesProfileText(profile.memoryPath)) ??
          buildImportedMemory(profile.name, workflowId),
        runtime: {
          importStrategy: "metadata-snapshot",
          profileName: profile.name,
          sourcePath: profile.sourcePath,
          configPath: profile.configPath,
          soulPath: profile.soulPath,
          memoryPath: profile.memoryPath,
          cwd: profile.cwd,
          reasoningEffort: profile.reasoningEffort,
          fastMode: false,
        },
      });
    },

    listAgents: async () => {
      const agents = await agentRepository.list();
      return Promise.all(agents.map((agent) => hydrateAgentRecord(ctx, agent)));
    },

    listHermesProfiles: async () => discoverHermesProfiles(),

    getAgent: async (agentId) => {
      const agent = await agentRepository.getById(agentId);
      return agent ? hydrateAgentRecord(ctx, agent) : null;
    },

    updateAgent: async (agentId, input) => {
      const existing = await agentRepository.getById(agentId);
      if (!existing) {
        return { success: false, error: { code: "AGENT_NOT_FOUND", agentId } };
      }

      let nextWorkflowId = existing.workflow_id;
      if (input.workflowId) {
        const workflowId = await resolveWorkflowId(ctx, input.workflowId);
        if (!workflowId) {
          return {
            success: false,
            error: { code: "INVALID_WORKFLOW", workflowId: input.workflowId },
          };
        }
        nextWorkflowId = workflowId;
      }

      if (input.name && input.name !== existing.name) {
        const duplicate = await agentRepository.getByName(input.name);
        if (duplicate && duplicate.id !== agentId) {
          return { success: false, error: { code: "DUPLICATE_NAME", name: input.name } };
        }
      }

      const nextStatus = input.status ?? existing.status;
      const reactivating = existing.status === "archived" && nextStatus === "active";

      if (reactivating) {
        try {
          return await ctx.db.transaction().execute(async (trx) => {
            const trxAgentRepository = createAgentRepository(trx as DatabaseExecutor);

            return updateAgentRecord(
              ctx,
              trxAgentRepository,
              existing,
              input,
              nextWorkflowId,
              nextStatus,
              agentId,
            );
          });
        } catch (error) {
          if (error instanceof ActiveWorkerLimitError) {
            return error.limitResult;
          }
          throw error;
        }
      }

      return updateAgentRecord(
        ctx,
        agentRepository,
        existing,
        input,
        nextWorkflowId,
        nextStatus,
        agentId,
      );
    },

    listAgentRepoIds: async (agentId) => {
      const agent = await agentRepository.getById(agentId);
      if (!agent) return null;
      const memberships = await agentRepository.listRepoMemberships(agentId);
      return memberships.map((m) => m.repo_id);
    },

    replaceAgentRepos: async (agentId, repoIdsInput) => {
      const agent = await agentRepository.getById(agentId);
      if (!agent) {
        return { success: false, error: { code: "AGENT_NOT_FOUND", agentId } };
      }
      const repoIds = normalizeRepoIds(repoIdsInput);
      const unknownRepoIds = await findUnknownRepoIds(ctx, repoIds);
      if (unknownRepoIds.length > 0) {
        return { success: false, error: { code: "UNKNOWN_REPOS", repoIds: unknownRepoIds } };
      }
      await agentRepository.replaceRepoMemberships(
        agentId,
        buildMembershipRows(agentId, repoIds, new Date().toISOString()),
      );
      await rewriteArtifacts(ctx, agent);
      return { success: true, repoIds };
    },
  };
};

type DatabaseExecutor = LocalServerContext["db"];

const updateAgentRecord = async (
  ctx: LocalServerContext,
  agentRepository: ReturnType<typeof createAgentRepository>,
  existing: Agent,
  input: UpdateAgentInput,
  nextWorkflowId: string,
  nextStatus: AgentStatus,
  agentId: string = existing.id,
): Promise<AgentServiceResult<AgentRecord>> => {
  const releasingName = existing.status === "active" && nextStatus === "archived";
  const updated = await agentRepository.update(agentId, {
    name: releasingName ? buildArchivedAgentName(existing) : (input.name ?? existing.name),
    role: input.role ? normalizeAgentRoleLane(input.role) : existing.role,
    model: input.model ?? existing.model,
    workflow_id: nextWorkflowId,
    status: nextStatus,
    updated_at: new Date().toISOString(),
    ...(input.autoDistributeDisabled !== undefined
      ? { auto_distribute_disabled: input.autoDistributeDisabled }
      : {}),
    ...(input.focus !== undefined ? { focus: input.focus } : {}),
  });

  if (!updated) {
    return { success: false, error: { code: "AGENT_NOT_FOUND", agentId } };
  }

  await rewriteArtifacts(ctx, updated);
  return { success: true, agent: await hydrateAgentRecord(ctx, updated) };
};

const createPersistedAgent = async (
  ctx: LocalServerContext,
  input: {
    name: string;
    role: AgentRole;
    runtimeProvider: RuntimeProvider;
    provider: AgentProvider;
    model: string;
    autoDistributeDisabled?: boolean;
    focus?: string | null;
    workflowId: string;
    repoIds: string[];
    sourceKind: AgentSourceKind;
    sourceRef: string | null;
    soul: string | null;
    memory: string | null;
    runtime: {
      importStrategy:
        | "manual"
        | "metadata-snapshot"
        | "pi-worker-profile"
        | "codex-cli-worker-profile"
        | "grok-build-worker-profile"
        | "opencode-worker-profile";
      profileName: string | null;
      sourcePath: string | null;
      configPath: string | null;
      soulPath: string | null;
      memoryPath: string | null;
      cwd: string | null;
      reasoningEffort: string | null;
      fastMode: boolean;
    };
  },
): Promise<AgentServiceResult<AgentRecord>> => {
  const now = new Date().toISOString();
  const agentId = generateTypeId("agent");
  const privateChannelId = generateTypeId("chan");

  try {
    const created = await ctx.db.transaction().execute(async (trx) => {
      const trxAgentRepository = createAgentRepository(trx as DatabaseExecutor);

      const trxChannelRepository = createChannelRepository(trx as DatabaseExecutor);

      const agent = await trxAgentRepository.create({
        id: agentId,
        name: input.name,
        role: normalizeAgentRoleLane(input.role),
        runtime_provider: input.runtimeProvider,
        provider: input.provider,
        model: input.model,
        auto_distribute_disabled: input.autoDistributeDisabled ?? false,
        focus: input.focus ?? null,
        workflow_id: input.workflowId,
        status: "active",
        artifact_path: aopPaths.agent(agentId),
        source_kind: input.sourceKind,
        source_ref: input.sourceRef,
        created_at: now,
        updated_at: now,
      });

      await trxAgentRepository.replaceRepoMemberships(
        agentId,
        buildMembershipRows(agentId, input.repoIds, now),
      );

      await trxChannelRepository.create({
        id: privateChannelId,
        repo_id: null,
        owner_agent_id: agentId,
        kind: "private",
        name: input.name,
        artifact_path: aopPaths.agentPrivateChat(agentId, privateChannelId),
        created_at: now,
        updated_at: now,
      });
      await trxChannelRepository.createMembership({
        channel_id: privateChannelId,
        agent_id: agentId,
        created_at: now,
      });

      await writeAgentScaffold({
        agent: {
          id: agentId,
          name: input.name,
          role: normalizeAgentRoleLane(input.role),
          runtimeProvider: input.runtimeProvider,
          provider: input.provider,
          model: input.model,
          workflowId: input.workflowId,
          status: "active",
          artifactPath: aopPaths.agent(agentId),
          sourceKind: input.sourceKind,
          sourceRef: input.sourceRef,
          createdAt: now,
          updatedAt: now,
        },
        privateChannel: {
          id: privateChannelId,
          agentId,
          kind: "private",
          name: input.name,
          createdAt: now,
          updatedAt: now,
        },
        soul: input.soul,
        memory: input.memory,
        workflowAttachedAt: now,
        runtime: input.runtime,
      });

      return agent;
    });

    return { success: true, agent: await hydrateAgentRecord(ctx, created, privateChannelId) };
  } catch (error) {
    await rm(aopPaths.agent(agentId), { recursive: true, force: true });
    if (error instanceof ActiveWorkerLimitError) {
      return error.limitResult;
    }
    if (isAgentNameConstraintError(error)) {
      return { success: false, error: { code: "DUPLICATE_NAME", name: input.name } };
    }
    throw error;
  }
};

const isAgentNameConstraintError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("UNIQUE constraint failed: agents.name") ||
    error.message.includes("SQLITE_CONSTRAINT_UNIQUE")
  );
};

const normalizeRepoIds = (repoIds: string[]): string[] => Array.from(new Set(repoIds));

const buildMembershipRows = (agentId: string, repoIds: string[], createdAt: string) => {
  return repoIds.map((repoId, index) => ({
    agent_id: agentId,
    repo_id: repoId,
    membership_role: membershipRoleFor(index),
    created_at: createdAt,
  }));
};

const membershipRoleFor = (index: number): MembershipRole =>
  index === 0 ? "primary" : "secondary";

const buildArchivedAgentName = (agent: Agent): string =>
  `${agent.name}__archived__${agent.id.slice(-8)}`;

const reserveAgentNameForCreate = async (
  ctx: LocalServerContext,
  agentRepository: ReturnType<typeof createAgentRepository>,
  name: string,
): Promise<AgentServiceResult<never> | null> => {
  const active = await agentRepository.findByName(name);
  if (active) {
    return { success: false, error: { code: "DUPLICATE_NAME", name } };
  }

  const existing = await agentRepository.findAnyByName(name);
  if (!existing) {
    return null;
  }

  if (existing.status !== "archived") {
    return { success: false, error: { code: "DUPLICATE_NAME", name } };
  }

  const renamed = await agentRepository.update(existing.id, {
    name: buildArchivedAgentName(existing),
    updated_at: new Date().toISOString(),
  });
  if (renamed) {
    await rewriteArtifacts(ctx, renamed);
  }

  return null;
};

const findUnknownRepoIds = async (
  ctx: LocalServerContext,
  repoIds: string[],
): Promise<string[]> => {
  const unknownRepoIds: string[] = [];
  for (const repoId of repoIds) {
    const repo = await ctx.repoRepository.getById(repoId);
    if (!repo) unknownRepoIds.push(repoId);
  }
  return unknownRepoIds;
};

const resolveWorkflowId = async (
  ctx: LocalServerContext,
  preferredWorkflowId?: string,
): Promise<string | null> => {
  const candidate = preferredWorkflowId?.trim();
  if (!candidate) {
    return null;
  }

  const workflow = await resolveWorkflowRecord(ctx, candidate);
  return workflow ? workflow.id : null;
};

const resolveWorkflowRecord = async (
  ctx: LocalServerContext,
  workflowKey: string,
): Promise<{ id: string; name: string } | null> => {
  const candidate = workflowKey.trim();
  if (!candidate) {
    return null;
  }

  const workflow =
    (await ctx.workflowRepository.findById(candidate)) ??
    (await ctx.workflowRepository.findByName(candidate));
  return workflow ? { id: workflow.id, name: workflow.name } : null;
};

const hydrateAgentRecord = async (
  ctx: LocalServerContext,
  agent: Agent,
  privateChannelIdHint?: string,
): Promise<AgentRecord> => {
  const memberships = await ctx.agentRepository.listRepoMemberships(agent.id);
  const privateChannel = privateChannelIdHint
    ? { id: privateChannelIdHint }
    : await ctx.channelRepository.getPrivateByAgentId(agent.id);
  const workflow = await resolveWorkflowRecord(ctx, agent.workflow_id);

  return {
    id: agent.id,
    name: agent.name,
    role: normalizeAgentRoleLane(agent.role),
    runtimeProvider: agent.runtime_provider,
    provider: agent.provider,
    model: agent.model,
    autoDistributeDisabled: Boolean(agent.auto_distribute_disabled),
    workflowId: agent.workflow_id,
    workflowName: workflow?.name ?? agent.workflow_id,
    focus: agent.focus ?? null,
    status: agent.status,
    artifactPath: agent.artifact_path,
    sourceKind: agent.source_kind,
    sourceRef: agent.source_ref,
    repoIds: memberships.map((membership) => membership.repo_id),
    privateChannelId: privateChannel?.id ?? "",
    createdAt: agent.created_at,
    updatedAt: agent.updated_at,
  };
};

const rewriteArtifacts = async (
  ctx: LocalServerContext,
  agent: Agent,
  privateChannelIdHint?: string | null,
): Promise<void> => {
  const record = await hydrateAgentRecord(ctx, agent, privateChannelIdHint ?? undefined);
  await scaffoldAgentArtifacts({
    agent: {
      ...record,
      provider: agent.provider,
      sourceKind: agent.source_kind,
      sourceRef: agent.source_ref,
    },
    privateChannel: {
      id: record.privateChannelId,
      agentId: record.id,
      kind: "private",
      name: record.name,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
  });
};

const providerForRuntime = (runtimeProvider: RuntimeProvider, model: string): AgentProvider => {
  if (runtimeProvider === "opencode") {
    const modelKey = model.trim() || "opencode-go/kimi-k2.7-code";
    return `opencode:${modelKey}`;
  }
  if (isWorkerRuntime(runtimeProvider)) return runtimeProvider;
  return inferProviderFromModel(model);
};

const sourceKindForRuntime = (runtimeProvider: RuntimeProvider): AgentSourceKind =>
  isWorkerRuntime(runtimeProvider) ? `${runtimeProvider}-worker-profile` : "manual";

const isWorkerRuntime = (
  runtimeProvider: RuntimeProvider,
): runtimeProvider is "pi" | "codex-cli" | "grok-build" | "opencode" =>
  runtimeProvider === "pi" ||
  runtimeProvider === "codex-cli" ||
  runtimeProvider === "grok-build" ||
  runtimeProvider === "opencode";

const workerImportStrategy = (
  runtimeProvider: "pi" | "codex-cli" | "grok-build" | "opencode",
):
  | "pi-worker-profile"
  | "codex-cli-worker-profile"
  | "grok-build-worker-profile"
  | "opencode-worker-profile" => `${runtimeProvider}-worker-profile`;

const inferProviderFromModel = (model: string): AgentProvider =>
  model.startsWith("claude") ? "anthropic" : "openai-codex";

const buildManualSoul = (name: string, role: AgentRole): string =>
  `# Soul\n- Name: ${name}\n- Role: ${role}\n- Runtime: Hermes\n`;

const buildManualMemory = (workflowId: string): string =>
  `# Memory\n- Attached workflow: ${workflowId}\n`;

const buildImportedSoul = (profileName: string, role: AgentRole): string =>
  `# Soul\n- Imported from Hermes profile: ${profileName}\n- Role: ${role}\n`;

const buildImportedMemory = (profileName: string, workflowId: string): string =>
  `# Memory\n- Imported from Hermes profile: ${profileName}\n- Attached workflow: ${workflowId}\n`;
