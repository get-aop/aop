import type { LocalServerContext } from "../context.ts";
import { createAgentCliRunRepository } from "./run-repository.ts";
import { type AgentCliService, createAgentCliService } from "./service.ts";

/** The agent CLI service of this host: its settings, its runs, the real CLIs on its PATH. */
export const createHostAgentCliService = (ctx: LocalServerContext): AgentCliService =>
  createAgentCliService({
    settings: ctx.settingsRepository,
    runs: createAgentCliRunRepository(ctx.db),
  });
