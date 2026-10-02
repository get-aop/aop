import type { CuaStatus, Project } from "@aop/common";
import { getLogger } from "@aop/infra";
import type { McpStdioServer } from "@aop/llm-provider";
import { type CuaProbeDeps, probeCua } from "./cua-driver.ts";

const logger = getLogger("computer-use");

/** The name CUA Driver's own docs register it under, so its tools read `mcp__cua-driver__*`. */
export const CUA_MCP_SERVER_NAME = "cua-driver";

/** How long a probe answers for: a burst of thread turns asks once, and a fix shows within seconds. */
const STATUS_TTL_MS = 10_000;

export interface ComputerUseService {
  /** CUA Driver as the host sees it; `fresh` skips the few seconds a probe is reused. */
  cuaStatus: (options?: { fresh?: boolean }) => Promise<CuaStatus>;
  /**
   * The MCP servers a project's session adds for computer use, read on every launch so a change
   * applies from the next turn. Only threads get them: the coordinator stays on the aop tools.
   * A project on CUA whose driver cannot serve gets none, and the run starts without them.
   */
  serversFor: (
    project: Pick<Project, "id" | "computerUse">,
    role: "coordinator" | "thread",
  ) => Promise<Record<string, McpStdioServer> | undefined>;
}

export const createComputerUseService = (
  deps?: CuaProbeDeps,
  now: () => number = Date.now,
): ComputerUseService => {
  let cached: { status: CuaStatus; at: number } | null = null;

  const cuaStatus: ComputerUseService["cuaStatus"] = async ({ fresh = false } = {}) => {
    if (!fresh && cached && now() - cached.at < STATUS_TTL_MS) return cached.status;
    const status = await probeCua(deps);
    cached = { status, at: now() };
    return status;
  };

  return {
    cuaStatus,
    serversFor: async (project, role) => {
      if (role !== "thread" || project.computerUse !== "cua") return undefined;
      const status = await cuaStatus();
      if (!status.usable || !status.path) {
        logger.warn(
          "Project {projectId} uses CUA for computer use, but CUA Driver is {state}: the thread runs without its tools. {detail}",
          { projectId: project.id, state: status.state, detail: status.detail },
        );
        return undefined;
      }
      return { [CUA_MCP_SERVER_NAME]: { type: "stdio", command: status.path, args: ["mcp"] } };
    },
  };
};

/** The host's one service: every launch and the status route share its probe. */
export const computerUse = createComputerUseService();
