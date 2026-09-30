import type {
  HostHealth,
  MarkdownFileContent,
  RuntimeConfigurationModel,
  RuntimeConfigurationModelInput,
  RuntimeConfigurationProvider,
  RuntimeConfigurationProviderInput,
  RuntimeThinkingLevel,
  SSEServerStatus,
} from "@aop/common";
import { request } from "./request";

export interface RegisteredRepo {
  id: string;
  name: string | null;
  path: string;
}

export const getRepos = async (): Promise<RegisteredRepo[]> => {
  const data = await request<SSEServerStatus>("/status");
  return data.repos.map(({ id, name, path }) => ({ id, name, path }));
};

export const unregisterRepo = async (
  repoId: string,
): Promise<{ ok: true; repoId: string; factoryReset: boolean }> => {
  return request(`/repos/${repoId}?force=true`, { method: "DELETE" });
};

/** The host's release as it reports it on the probe every client may call. */
export const getHostVersion = async (): Promise<string> => {
  const health = await request<Pick<HostHealth, "version">>("/health");
  return health.version;
};

/**
 * Opens the link on the machine the user is sitting at: a new tab in a browser, and in the
 * desktop app the window-open handler hands it to the OS browser. The host never opens
 * links for a client, because the host may be another machine.
 */
export const openExternalUrl = (url: string): void => {
  window.open(url, "_blank", "noopener,noreferrer");
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

export interface SettingEntry {
  key: string;
  value: string;
}

export const getSettings = async (): Promise<SettingEntry[]> => {
  const data = await request<{ settings: SettingEntry[] }>("/settings");
  return data.settings;
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
