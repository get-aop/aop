import type { AgentRole } from "../db/schema.ts";

export type AgentRoleLane = "developer";

export const normalizeAgentRoleLane = (_role?: AgentRole | null): AgentRoleLane => "developer";
