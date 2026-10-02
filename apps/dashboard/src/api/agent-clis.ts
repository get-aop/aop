import { type AgentClisResponse, AgentClisResponseSchema } from "@aop/common";
import { request } from "./request";

/** The agent CLIs on the host, their versions and their updates. Any paired device may ask. */
export const getAgentClis = async (): Promise<AgentClisResponse> =>
  AgentClisResponseSchema.parse(await request<unknown>("/agent-clis"));

/** Asks the host to look for new CLI versions now instead of waiting for its periodic check. */
export const checkAgentClis = async (): Promise<AgentClisResponse> =>
  AgentClisResponseSchema.parse(await request<unknown>("/agent-clis/check", { method: "POST" }));

/**
 * Host owner only. Resolves once the host has started the update in the background; how it
 * goes shows in `getAgentClis`, and a refusal says why (and what to run by hand) there too.
 */
export const updateAgentCli = async (provider: string): Promise<void> => {
  await request<unknown>(`/agent-clis/${encodeURIComponent(provider)}/update`, { method: "POST" });
};

/**
 * Host owner only: turns "skip permission checks" on or off for every agent the host starts.
 * Each launch reads it, so it applies from the next turn; a paired device gets a 403.
 */
export const setSkipPermissions = async (enabled: boolean): Promise<void> => {
  await request<unknown>("/settings/agent_cli_skip_permissions", {
    method: "PUT",
    body: JSON.stringify({ value: String(enabled) }),
  });
};
