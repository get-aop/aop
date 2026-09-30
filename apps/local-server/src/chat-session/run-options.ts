import { AOP_PORTS } from "@aop/common";
import type { RunOptions } from "@aop/llm-provider";
import type { ChatSession } from "../db/schema.ts";
import { createAuthenticatedMcpUrl } from "../mcp/auth.ts";
import { isMcpCapableRuntime } from "../mcp/availability.ts";
import { runProfileFor } from "./run-profile.ts";
import { CHAT_RUNTIME_TIMEOUT_POLICY } from "./runtime-timeout-policy.ts";

/** What one chat turn asks the provider adapter to run, derived from the session row. */
export const buildRunOptions = (
  session: ChatSession,
  repoPath: string,
  prompt: string,
  onSession: (id: string) => Promise<void> | void,
  logFilePath: string,
  allowedDirectories?: string[],
  onSpawn?: (pid: number) => Promise<void>,
): RunOptions => {
  const profile = runProfileFor(session);
  return {
    prompt,
    cwd: repoPath,
    model: session.model,
    reasoningEffort: session.reasoning_effort,
    fastMode: Boolean(session.fast_mode),
    accessMode: profile.accessMode ?? session.runtime_access_mode ?? "full-access",
    runtimeAlias: session.runtime_alias ?? undefined,
    resumeSessionId: session.runtime_session_id ?? undefined,
    logFilePath,
    onSession,
    onSpawn,
    allowedDirectories,
    mcpServerUrl: resolveAopMcpUrl(session.runtime, session.id),
    startupTimeoutMs: CHAT_RUNTIME_TIMEOUT_POLICY.startupTimeoutMs,
    isolation: profile.isolation,
    allowedTools: profile.allowedTools,
    disallowedTools: profile.disallowedTools,
    builtInTools: profile.builtInTools,
    env: {
      ...profile.env,
      AOP_CHAT_SESSION_ID: session.id,
      AOP_CHAT_WORKSPACE_PATH: repoPath,
    },
  };
};

/** Per-provider capability flag: only MCP-capable CLIs receive the aop endpoint. */
export const resolveAopMcpUrl = (runtime: string, chatSessionId: string): string | undefined => {
  if (!isMcpCapableRuntime(runtime)) return undefined;
  if (process.env.AOP_MCP_URL?.trim()) {
    return createAuthenticatedMcpUrl(process.env.AOP_MCP_URL.trim(), chatSessionId);
  }
  // Prefer explicit env; avoid throwing when AOP_PORTS.LOCAL_SERVER is unset in unit tests.
  const raw = process.env.PORT ?? process.env.AOP_LOCAL_SERVER_PORT;
  const port = raw ? Number(raw) : Number.NaN;
  if (!Number.isFinite(port) || port <= 0) {
    try {
      return createAuthenticatedMcpUrl(
        `http://127.0.0.1:${AOP_PORTS.LOCAL_SERVER}/api/mcp`,
        chatSessionId,
      );
    } catch {
      return undefined;
    }
  }
  return createAuthenticatedMcpUrl(`http://127.0.0.1:${port}/api/mcp`, chatSessionId);
};
