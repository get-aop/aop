import type { AgentCliDefinition } from "./definitions.ts";

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_NPM_REGISTRY = "https://registry.npmjs.org";
const LATEST_TIMEOUT_MS = 8_000;

/**
 * The newest published version on `channel`, from the registry's dist-tags of the CLI's npm
 * package: one small JSON document (`{"latest":"2.1.286","stable":"2.1.285"}`), the same versions
 * Claude Code's native installer offers. Throws when offline, slow, or the answer is unusable;
 * the caller keeps what it knew and tries again later.
 */
export const fetchLatestCliVersion = async (
  definition: AgentCliDefinition,
  channel: string,
  options: { registry?: string; fetch?: FetchFn; timeoutMs?: number } = {},
): Promise<string> => {
  const registry = (options.registry ?? DEFAULT_NPM_REGISTRY).replace(/\/+$/, "");
  const url = `${registry}/-/package/${definition.npmPackage}/dist-tags`;
  const response = await (options.fetch ?? fetch)(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(options.timeoutMs ?? LATEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`The npm registry answered ${response.status}`);
  const tags = (await response.json()) as Record<string, unknown>;
  const version = tags[channel] ?? tags.latest;
  // Only a plain x.y.z is a release: a pre-release tag is never offered as an update.
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version.trim())) {
    throw new Error(`The npm registry named no ${channel} version of ${definition.npmPackage}`);
  }
  return version.trim();
};
