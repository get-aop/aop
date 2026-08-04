import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import {
  type AgentModelProvider,
  type HermesProfileSummary,
  validateProviderModel,
} from "./contracts.ts";

export interface HermesProfileDetails extends HermesProfileSummary {
  configPath: string;
  soulPath: string | null;
  memoryPath: string | null;
}

interface HermesConfigFile {
  model?: {
    default?: string;
    provider?: string;
  };
  terminal?: {
    cwd?: string;
  };
  agent?: {
    reasoning_effort?: string;
  };
}

export const listHermesProfiles = async (): Promise<HermesProfileSummary[]> => {
  const hermesHome = getHermesHome();
  const discovered = await Promise.all([
    readHermesProfile("default"),
    ...(await listNamedProfiles(hermesHome)).map((profileName) => readHermesProfile(profileName)),
  ]);

  return discovered.filter((profile): profile is HermesProfileDetails => profile !== null);
};

export const readHermesProfile = async (
  profileName: string,
): Promise<HermesProfileDetails | null> => {
  const hermesHome = getHermesHome();
  const profileRoot = resolveHermesProfileRoot(profileName, hermesHome);
  const configPath = join(profileRoot, "config.yaml");
  if (!existsSync(configPath)) {
    return null;
  }

  const config = parseHermesConfig(await readFile(configPath, "utf-8"));
  const provider = config.model?.provider?.trim() ?? "";
  const model = config.model?.default?.trim() ?? "";
  const validationError = validateProviderModel(provider, model);

  return {
    name: profileName,
    sourcePath: profileRoot,
    configPath,
    soulPath: resolveFirstExistingPath(join(profileRoot, "SOUL.md"), join(hermesHome, "SOUL.md")),
    memoryPath: resolveFirstExistingPath(
      join(profileRoot, "memories", "MEMORY.md"),
      join(hermesHome, "memories", "MEMORY.md"),
    ),
    provider,
    model,
    cwd: config.terminal?.cwd ?? null,
    reasoningEffort: config.agent?.reasoning_effort ?? null,
    isSupported: validationError === null,
    validationError,
  };
};

export const readHermesProfileText = async (path: string | null): Promise<string | null> => {
  if (!path || !existsSync(path)) {
    return null;
  }

  return readFile(path, "utf-8");
};

export const getHermesHome = (): string => process.env.HERMES_HOME ?? join(homedir(), ".hermes");

export const isSupportedHermesProvider = (value: string): value is AgentModelProvider =>
  value === "openai-codex" || value === "anthropic";

const listNamedProfiles = async (hermesHome: string): Promise<string[]> => {
  const profilesDir = join(hermesHome, "profiles");
  if (!existsSync(profilesDir)) {
    return [];
  }

  const entries = await readdir(profilesDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
};

const parseHermesConfig = (rawConfig: string): HermesConfigFile => {
  const parsed = parse(rawConfig);
  return typeof parsed === "object" && parsed !== null ? (parsed as HermesConfigFile) : {};
};

const resolveHermesProfileRoot = (profileName: string, hermesHome: string): string => {
  if (profileName === "default") {
    return hermesHome;
  }

  return join(hermesHome, "profiles", profileName);
};

const resolveFirstExistingPath = (...candidates: string[]): string | null => {
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
};
