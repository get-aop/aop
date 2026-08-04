import type {
  AopUpdateInstallResult,
  AopUpdateStatus,
  DashboardSwimlane,
  ExecHostConfig,
  ExecHostUpsert,
  FactoryHealthSnapshot,
  MarkdownFileContent,
  RuntimeConfigurationModel,
  RuntimeConfigurationModelInput,
  RuntimeConfigurationProvider,
  RuntimeConfigurationProviderInput,
  RuntimeProfile,
  RuntimeProfileInput,
  RuntimeProfilePatch,
  RuntimeThinkingLevel,
  SSEServerStatus,
  SSETask,
} from "@aop/common";
import type { Task } from "../types";
import { request } from "./request";

interface StatusResponse extends SSEServerStatus {
  ready: boolean;
}

export type ProviderCapabilitySupport = "yes" | "no" | "partial";

export interface ProviderCapabilityEntry {
  id: "claude-code" | "codex-cli" | "grok-build" | "opencode" | "pi";
  label: string;
  roleFit: string;
  version: string | null;
  updateState: {
    status: "idle" | "queued" | "running" | "succeeded" | "failed" | "skipped";
    startedAt: string | null;
    finishedAt: string | null;
    message: string | null;
  };
  capabilities: Record<
    | "structuredJsonl"
    | "resumeSupport"
    | "usageReporting"
    | "nativePlanMode"
    | "permissionSandboxFlags"
    | "liveFollowUp",
    ProviderCapabilitySupport
  >;
  readinessProbe: Record<
    | "cliInstalled"
    | "authenticated"
    | "versionDetected"
    | "canSpawn"
    | "canResume"
    | "canWriteLogs"
    | "canReportUsage"
    | "supportsConfiguredSafetyFlags",
    boolean
  >;
}

export type ProviderUpdateStates = Record<
  ProviderCapabilityEntry["id"],
  ProviderCapabilityEntry["updateState"]
>;

const toTask = (sseTask: SSETask, repoPath: string): Task => ({
  ...sseTask,
  repoPath,
});

export const getStatus = async (): Promise<{
  ready: boolean;
  swimlanes: DashboardSwimlane[];
  tasks: Task[];
  repos: { id: string; name: string | null; path: string }[];
}> => {
  const data = await request<StatusResponse>("/status");

  const tasks: Task[] = [];
  const repos: { id: string; name: string | null; path: string }[] = [];

  for (const repo of data.repos) {
    repos.push({ id: repo.id, name: repo.name, path: repo.path });
    for (const task of repo.tasks) {
      tasks.push(toTask(task, repo.path));
    }
  }

  return {
    ready: data.ready,
    swimlanes: data.swimlanes,
    tasks,
    repos,
  };
};

export const unregisterRepo = async (
  repoId: string,
): Promise<{ ok: true; repoId: string; abortedTasks: number; factoryReset: boolean }> => {
  return request(`/repos/${repoId}?force=true`, { method: "DELETE" });
};

export const getFactoryHealth = async (): Promise<FactoryHealthSnapshot> => {
  return request<FactoryHealthSnapshot>("/health/details");
};

export const getUpdateStatus = async (): Promise<AopUpdateStatus> => {
  return request<AopUpdateStatus>("/updates");
};

export const installUpdate = async (): Promise<AopUpdateInstallResult> => {
  return request<AopUpdateInstallResult>("/updates/install", { method: "POST" });
};

export const openExternalUrl = async (url: string): Promise<void> => {
  await request<{ ok: true }>("/open-external", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
};

export const getProviderCapabilities = async (): Promise<ProviderCapabilityEntry[]> => {
  const data = await request<{ providers: ProviderCapabilityEntry[] }>("/providers/capabilities");
  return data.providers;
};

export const updateAllProviderClis = async (): Promise<{ accepted: boolean }> =>
  request<{ accepted: boolean }>("/providers/update-all", { method: "POST" });

export const getProviderUpdateStates = async (): Promise<ProviderUpdateStates> => {
  const data = await request<{ states: ProviderUpdateStates }>("/providers/update-status");
  return data.states;
};

export interface DirectoryListingResponse {
  path: string;
  directories: string[];
  parent: string | null;
  isGitRepo: boolean;
}

export const listDirectories = async (
  path?: string,
  hidden = false,
): Promise<DirectoryListingResponse> => {
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  if (hidden) params.set("hidden", "true");
  const query = params.toString();
  return request<DirectoryListingResponse>(`/fs/directories${query ? `?${query}` : ""}`);
};

export const getMarkdownFile = (filePath: string): Promise<MarkdownFileContent> =>
  request<MarkdownFileContent>(`/fs/markdown-file?path=${encodeURIComponent(filePath)}`);

export const saveMarkdownFile = (filePath: string, content: string): Promise<MarkdownFileContent> =>
  request<MarkdownFileContent>("/fs/markdown-file", {
    method: "PUT",
    body: JSON.stringify({ path: filePath, content }),
  });

export interface RegisterRepoResponse {
  ok: boolean;
  repoId: string;
  alreadyExists: boolean;
}

export const registerRepo = async (path: string): Promise<RegisterRepoResponse> => {
  return request<RegisterRepoResponse>("/repos", {
    method: "POST",
    body: JSON.stringify({ path }),
  });
};

export interface PauseContextResponse {
  pauseContext: string | null;
  signal: string | null;
}

export const getPauseContext = async (
  repoId: string,
  taskId: string,
): Promise<PauseContextResponse> => {
  return request<PauseContextResponse>(`/repos/${repoId}/tasks/${taskId}/pause-context`);
};

export interface ResumeTaskResponse {
  ok: boolean;
  taskId: string;
  message: string;
}

export const resumeTask = async (
  repoId: string,
  taskId: string,
  input: string,
): Promise<ResumeTaskResponse> => {
  return request<ResumeTaskResponse>(`/repos/${repoId}/tasks/${taskId}/resume`, {
    method: "POST",
    body: JSON.stringify({ input }),
  });
};

export interface SettingEntry {
  key: string;
  value: string;
}

export const getSettings = async (): Promise<SettingEntry[]> => {
  const data = await request<{ settings: SettingEntry[] }>("/settings");
  return data.settings;
};

export type { ExecHostConfig, ExecHostUpsert };

export interface ExecHostTestResult {
  reachable: boolean;
  latencyMs: number | null;
  rsync: boolean;
  git: boolean;
  clis: Array<{
    id: string;
    installed: boolean;
    version: string | null;
    authenticated: boolean;
  }>;
  error?: string;
}

export const getExecHosts = async (): Promise<ExecHostConfig[]> => {
  const data = await request<{ hosts: ExecHostConfig[] }>("/exec-hosts");
  return data.hosts;
};

export const saveExecHosts = async (hosts: ExecHostUpsert[]): Promise<ExecHostConfig[]> => {
  const data = await request<{ hosts: ExecHostConfig[] }>("/exec-hosts", {
    method: "PUT",
    body: JSON.stringify(hosts),
  });
  return data.hosts;
};

export const testExecHost = async (id: string): Promise<ExecHostTestResult> => {
  return request<ExecHostTestResult>(`/exec-hosts/${encodeURIComponent(id)}/test`, {
    method: "POST",
  });
};

export const getRuntimeProfiles = async (): Promise<RuntimeProfile[]> => {
  const data = await request<{ profiles: RuntimeProfile[] }>("/runtime-profiles");
  return data.profiles;
};

export const createRuntimeProfile = async (input: RuntimeProfileInput): Promise<RuntimeProfile> => {
  const data = await request<{ profile: RuntimeProfile }>("/runtime-profiles", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.profile;
};

export const updateRuntimeProfile = async (
  id: string,
  patch: RuntimeProfilePatch,
): Promise<RuntimeProfile> => {
  const data = await request<{ profile: RuntimeProfile }>(
    `/runtime-profiles/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
  return data.profile;
};

export const deleteRuntimeProfile = async (id: string): Promise<void> => {
  await request(`/runtime-profiles/${encodeURIComponent(id)}`, { method: "DELETE" });
};

export const getRuntimeConfiguration = async (): Promise<RuntimeConfigurationProvider[]> => {
  const data = await request<{ providers: RuntimeConfigurationProvider[] }>(
    "/runtime-configuration",
  );
  return data.providers;
};

export const createRuntimeConfigurationProvider = async (
  input: RuntimeConfigurationProviderInput,
): Promise<RuntimeConfigurationProvider> => {
  const data = await request<{ provider: RuntimeConfigurationProvider }>(
    "/runtime-configuration/providers",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return data.provider;
};

export const updateRuntimeConfigurationProvider = async (
  id: string,
  input: RuntimeConfigurationProviderInput,
): Promise<RuntimeConfigurationProvider> => {
  const data = await request<{ provider: RuntimeConfigurationProvider }>(
    `/runtime-configuration/providers/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  return data.provider;
};

export const cloneRuntimeConfigurationProvider = async (
  id: string,
  input: RuntimeConfigurationProviderInput,
): Promise<RuntimeConfigurationProvider> => {
  const data = await request<{ provider: RuntimeConfigurationProvider }>(
    `/runtime-configuration/providers/${encodeURIComponent(id)}/clone`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return data.provider;
};

export const deleteRuntimeConfigurationProvider = async (id: string): Promise<void> => {
  await request(`/runtime-configuration/providers/${encodeURIComponent(id)}`, { method: "DELETE" });
};

export const createRuntimeConfigurationModel = async (
  providerId: string,
  input: RuntimeConfigurationModelInput,
): Promise<RuntimeConfigurationModel> => {
  const data = await request<{ model: RuntimeConfigurationModel }>(
    `/runtime-configuration/providers/${encodeURIComponent(providerId)}/models`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return data.model;
};

export const updateRuntimeConfigurationModel = async (
  id: string,
  input: RuntimeConfigurationModelInput,
): Promise<RuntimeConfigurationModel> => {
  const data = await request<{ model: RuntimeConfigurationModel }>(
    `/runtime-configuration/models/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
  return data.model;
};

export const deleteRuntimeConfigurationModel = async (id: string): Promise<void> => {
  await request(`/runtime-configuration/models/${encodeURIComponent(id)}`, { method: "DELETE" });
};

export const reorderRuntimeConfigurationModels = async (
  providerId: string,
  modelIds: string[],
): Promise<RuntimeConfigurationProvider> => {
  const data = await request<{ provider: RuntimeConfigurationProvider }>(
    `/runtime-configuration/providers/${encodeURIComponent(providerId)}/models/order`,
    { method: "PUT", body: JSON.stringify({ modelIds }) },
  );
  return data.provider;
};

export const reorderRuntimeConfigurationProviders = async (
  providerIds: string[],
): Promise<RuntimeConfigurationProvider[]> => {
  const data = await request<{ providers: RuntimeConfigurationProvider[] }>(
    "/runtime-configuration/providers/order",
    { method: "PUT", body: JSON.stringify({ providerIds }) },
  );
  return data.providers;
};

export const setDefaultRuntimeConfigurationModel = async (
  id: string,
  isDefault: boolean,
): Promise<RuntimeConfigurationProvider> => {
  const data = await request<{ provider: RuntimeConfigurationProvider }>(
    `/runtime-configuration/models/${encodeURIComponent(id)}/default`,
    { method: "PATCH", body: JSON.stringify({ isDefault }) },
  );
  return data.provider;
};

export const setDefaultRuntimeConfigurationThinkingLevel = async (
  id: string,
  defaultThinkingLevel: RuntimeThinkingLevel | null,
): Promise<RuntimeConfigurationProvider> => {
  const data = await request<{ provider: RuntimeConfigurationProvider }>(
    `/runtime-configuration/models/${encodeURIComponent(id)}/default-thinking`,
    { method: "PATCH", body: JSON.stringify({ defaultThinkingLevel }) },
  );
  return data.provider;
};

export const setRuntimeConfigurationProviderSupportsFast = async (
  id: string,
  supportsFastMode: boolean,
): Promise<RuntimeConfigurationProvider> => {
  const data = await request<{ provider: RuntimeConfigurationProvider }>(
    `/runtime-configuration/providers/${encodeURIComponent(id)}/supports-fast`,
    { method: "PATCH", body: JSON.stringify({ supportsFastMode }) },
  );
  return data.provider;
};

export const updateSettings = async (settings: SettingEntry[]): Promise<void> => {
  await request("/settings", {
    method: "PUT",
    body: JSON.stringify({ settings }),
  });
};
