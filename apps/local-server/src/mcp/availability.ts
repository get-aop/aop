/**
 * What the AOP MCP server offers to whom: which runtimes can host it and which tools each kind
 * of chat session may use. A leaf module with no imports: the chat engine reads it to decide a
 * run's tools, and the tool registry (tools.ts) is checked against it.
 */

/** Runtimes whose CLI can host the AOP MCP server. */
export const MCP_CAPABLE_RUNTIMES = new Set(["claude-code"]);

export const isMcpCapableRuntime = (runtime: string): boolean => MCP_CAPABLE_RUNTIMES.has(runtime);

export type SessionRole = "plain" | "coordinator" | "thread";

export const PLAIN_TOOL_NAMES = ["aop_list_repos", "aop_set_chat_workspace"] as const;

export const MEMORY_TOOL_NAMES = ["memory_read", "memory_write"] as const;

export const LIBRARY_TOOL_NAMES = [
  "aop_library_save",
  "aop_library_list",
  "aop_library_read",
] as const;

export const COORDINATOR_TOOL_NAMES = [
  "thread_spawn",
  "thread_steer",
  "thread_stop",
  "thread_list",
  "thread_report",
  "thread_open_pr",
  "thread_merge_pr",
  "thread_resolve",
  "propose_threads",
  "project_settings_get",
  "project_settings_set",
  "routine_create",
  "routine_list",
  "routine_update",
  "routine_pause",
  "routine_delete",
  "routine_run_now",
  ...MEMORY_TOOL_NAMES,
  ...LIBRARY_TOOL_NAMES,
  // The coordinator's alone: it keeps memory tidy, and Memory settings ask it to remove things.
  "memory_delete",
] as const;

export const THREAD_TOOL_NAMES = [
  "aop_ask_user",
  "aop_report_status",
  "aop_open_pr",
  "aop_propose_routine",
  ...MEMORY_TOOL_NAMES,
  ...LIBRARY_TOOL_NAMES,
] as const;

const TOOL_NAMES: Record<SessionRole, readonly string[]> = {
  plain: PLAIN_TOOL_NAMES,
  coordinator: COORDINATOR_TOOL_NAMES,
  thread: THREAD_TOOL_NAMES,
};

export const sessionRole = (session: { kind: string | null }): SessionRole =>
  session.kind === "coordinator" || session.kind === "thread" ? session.kind : "plain";

export const toolNamesFor = (role: SessionRole): readonly string[] => TOOL_NAMES[role];

/** The name Claude Code gives an MCP tool: the server key (`aop` in the run's MCP config) between `mcp__` and the tool. */
export const claudeMcpToolName = (tool: string): string => `mcp__aop__${tool}`;
