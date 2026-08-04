import { defaultGhRunner, type RunCommand } from "../command-runner.ts";

export type { CommandResult } from "../command-runner.ts";

export type RunGh = RunCommand;

export const defaultRunGh: RunGh = defaultGhRunner;

const GH_AUTH_CACHE_TTL_MS = 60_000;
let ghAuthCache: { at: number; authenticated: boolean } | null = null;

export const isGhAuthenticated = async (): Promise<boolean> => {
  const now = Date.now();
  if (ghAuthCache && now - ghAuthCache.at < GH_AUTH_CACHE_TTL_MS) {
    return ghAuthCache.authenticated;
  }
  const authenticated = (await Bun.$`gh auth status`.quiet().nothrow()).exitCode === 0;
  ghAuthCache = { at: now, authenticated };
  return authenticated;
};
