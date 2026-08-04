import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";

export interface AgentArtifactDocument {
  id: string;
  name: string;
  role: string;
  runtimeProvider: string;
  provider?: string;
  model: string;
  workflowId: string;
  status: string;
  artifactPath: string;
  repoIds: string[];
  privateChannelId: string;
  sourceKind?:
    | "manual"
    | "hermes-profile"
    | "pi-worker-profile"
    | "codex-cli-worker-profile"
    | "grok-build-worker-profile"
    | "opencode-worker-profile";
  sourceRef?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PrivateChannelArtifactDocument {
  id: string;
  agentId: string;
  kind: "private";
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentScaffoldInput {
  agent: {
    id: string;
    name: string;
    role: string;
    runtimeProvider: string;
    provider: string;
    model: string;
    workflowId: string;
    status: string;
    artifactPath: string;
    sourceKind:
      | "manual"
      | "hermes-profile"
      | "pi-worker-profile"
      | "codex-cli-worker-profile"
      | "grok-build-worker-profile"
      | "opencode-worker-profile";
    sourceRef: string | null;
    createdAt: string;
    updatedAt: string;
  };
  privateChannel?: PrivateChannelArtifactDocument;
  soul: string | null;
  memory: string | null;
  workflowAttachedAt: string;
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
}

export const scaffoldAgentArtifacts = async (params: {
  agent: AgentArtifactDocument;
  privateChannel: PrivateChannelArtifactDocument;
}): Promise<void> => {
  const runtimeProvider = params.agent.runtimeProvider;
  const isWorkerRuntime = isRuntimeBackedWorker(runtimeProvider);

  await writeAgentScaffold({
    agent: {
      id: params.agent.id,
      name: params.agent.name,
      role: params.agent.role,
      runtimeProvider,
      provider: params.agent.provider ?? inferProviderFromModel(params.agent.model),
      model: params.agent.model,
      workflowId: params.agent.workflowId,
      status: params.agent.status,
      artifactPath: params.agent.artifactPath,
      sourceKind: params.agent.sourceKind ?? "manual",
      sourceRef: params.agent.sourceRef ?? null,
      createdAt: params.agent.createdAt,
      updatedAt: params.agent.updatedAt,
    },
    privateChannel: params.privateChannel,
    soul: isWorkerRuntime
      ? null
      : `# Soul
- Agent ${params.agent.name}
`,
    memory: isWorkerRuntime
      ? null
      : `# Memory
- Workflow: ${params.agent.workflowId}
`,
    workflowAttachedAt: params.agent.updatedAt,
    runtime: {
      importStrategy: isWorkerRuntime ? workerImportStrategy(runtimeProvider) : "manual",
      profileName: isWorkerRuntime ? (params.agent.sourceRef ?? null) : null,
      sourcePath: null,
      configPath: null,
      soulPath: null,
      memoryPath: null,
      cwd: null,
      reasoningEffort: null,
      fastMode: false,
    },
  });
};

const isRuntimeBackedWorker = (
  runtimeProvider: string,
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

export const writeAgentScaffold = async (input: AgentScaffoldInput): Promise<void> => {
  const runtimeDir = aopPaths.agentRuntime(input.agent.id, input.agent.runtimeProvider);
  await mkdir(input.agent.artifactPath, { recursive: true });
  await mkdir(runtimeDir, { recursive: true });
  if (input.privateChannel) {
    await mkdir(aopPaths.agentPrivateChat(input.agent.id, input.privateChannel.id), {
      recursive: true,
    });
  }

  const writes = [
    ...buildOptionalTextWrites(input),
    writeJsonFile(join(input.agent.artifactPath, "agent.json"), {
      version: 1,
      ...input.agent,
    }),
    writeJsonFile(join(input.agent.artifactPath, "workflow.json"), {
      version: 1,
      workflowId: input.agent.workflowId,
      attachedAt: input.workflowAttachedAt,
    }),
    writeJsonFile(join(runtimeDir, "profile.json"), {
      version: 1,
      importStrategy: input.runtime.importStrategy,
      profileName: input.runtime.profileName,
      sourcePath: input.runtime.sourcePath,
      configPath: input.runtime.configPath,
      soulPath: input.runtime.soulPath,
      memoryPath: input.runtime.memoryPath,
    }),
    writeJsonFile(join(runtimeDir, "settings.json"), {
      version: 1,
      provider: input.agent.provider,
      model: input.agent.model,
      profileName: input.runtime.profileName,
      cwd: input.runtime.cwd,
      reasoningEffort: input.runtime.reasoningEffort,
      fastMode: input.runtime.fastMode,
    }),
  ];

  if (input.privateChannel) {
    writes.push(
      writeJsonFile(
        join(aopPaths.agentPrivateChat(input.agent.id, input.privateChannel.id), "channel.json"),
        input.privateChannel,
      ),
    );
  }

  await Promise.all(writes);
};

const inferProviderFromModel = (model: string): "openai-codex" | "anthropic" =>
  model.startsWith("claude") ? "anthropic" : "openai-codex";

const buildOptionalTextWrites = (input: AgentScaffoldInput): Promise<void>[] => {
  const writes: Promise<void>[] = [];
  if (input.soul !== null) {
    writes.push(writeTextFile(join(input.agent.artifactPath, "soul.md"), input.soul));
  }
  if (input.memory !== null) {
    writes.push(writeTextFile(join(input.agent.artifactPath, "memory.md"), input.memory));
  }
  return writes;
};

const writeJsonFile = async (path: string, value: unknown): Promise<void> => {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
};

const writeTextFile = async (path: string, value: string): Promise<void> => {
  await writeFile(path, value.endsWith("\n") ? value : `${value}\n`, "utf-8");
};
