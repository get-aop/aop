import type { CuaStatus, Project } from "@aop/common";
import { getLogger } from "@aop/infra";
import type { McpServerConfig } from "@aop/llm-provider";
import { type CuaProbeDeps, probeCua } from "./cua-driver.ts";

const logger = getLogger("computer-use");

/** The name CUA Driver's own docs register it under, so its tools read `mcp__cua-driver__*`. */
export const CUA_MCP_SERVER_NAME = "cua-driver";

/** How long a probe answers for: a burst of thread turns asks once, and a fix shows within seconds. */
const STATUS_TTL_MS = 10_000;

export interface ComputerUseService {
  /** CUA Driver on this host (where runs spawn); `fresh` skips the few seconds a probe is reused. */
  cuaStatus: (options?: { fresh?: boolean }) => Promise<CuaStatus>;
  /**
   * The MCP servers a project's session adds for computer use, read on every launch so a change
   * applies from the next turn. Only threads get them: the coordinator stays on the aop tools.
   * A project on CUA whose host is not ready gets none, and the run starts without them.
   *
   * The server is the host's own gate in front of CUA Driver (`/api/mcp/cua`, reached with the
   * session's AOP MCP URL), so the host can hold calls back while another thread has the screen.
   */
  serversFor: (
    project: Pick<Project, "id" | "computerUse">,
    role: "coordinator" | "thread",
    aopMcpUrl?: string,
  ) => Promise<Record<string, McpServerConfig> | undefined>;
}

export const createComputerUseService = (
  deps?: CuaProbeDeps,
  now: () => number = Date.now,
): ComputerUseService => {
  let cached: { status: CuaStatus; at: number } | null = null;
  // A burst of thread launches and a "Check again" share one probe instead of starting several.
  let inFlight: Promise<CuaStatus> | null = null;

  const probe = (): Promise<CuaStatus> => {
    inFlight ??= probeCua(deps)
      .then((status) => {
        cached = { status, at: now() };
        return status;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  const cuaStatus: ComputerUseService["cuaStatus"] = async ({ fresh = false } = {}) => {
    if (!fresh && cached && now() - cached.at < STATUS_TTL_MS) return cached.status;
    return probe();
  };

  return {
    cuaStatus,
    serversFor: async (project, role, aopMcpUrl) => {
      if (role !== "thread" || project.computerUse !== "cua" || !aopMcpUrl) return undefined;
      const status = await cuaStatus();
      if (status.status !== "ready" || !status.path) {
        logger.warn(
          "Project {projectId} uses CUA for computer use, but CUA Driver on this host is {status} ({reason}): the thread runs without its tools. {detail}",
          {
            projectId: project.id,
            status: status.status,
            reason: status.reason,
            detail: status.detail,
          },
        );
        return undefined;
      }
      return { [CUA_MCP_SERVER_NAME]: { type: "http", url: cuaGateUrl(aopMcpUrl) } };
    },
  };
};

/** The gate's URL: the AOP MCP URL of the same session (and token), one path segment deeper. */
export const cuaGateUrl = (aopMcpUrl: string): string => {
  const url = new URL(aopMcpUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/cua`;
  return url.toString();
};

/** The host's one service: every launch and the status route share its probe. */
export const computerUse = createComputerUseService();
