import type { RunIsolation, RunOptions } from "@aop/llm-provider";
import type { ChatSession } from "../db/schema.ts";
import { claudeMcpToolName, sessionRole, toolNamesFor } from "../mcp/availability.ts";

/** How a session's runs differ from a plain chat's, by what the session is. */
export interface RunProfile {
  isolation: RunIsolation;
  /**
   * Pins the access mode whatever the session row says. Left out, the row decides (a plain chat's
   * own setting, or the access a project chose for its threads).
   */
  accessMode?: NonNullable<RunOptions["accessMode"]>;
  /** Tools pre-approved because a run without a terminal cannot ask. */
  allowedTools?: string[];
  disallowedTools?: string[];
  /** An empty list leaves the run with MCP tools only. */
  builtInTools?: string[];
  env: Record<string, string>;
}

// The coordinator processes what people and threads write, so it fails closed: `approval-required`
// adds no permission-skipping flag, and a headless run denies whatever `allowedTools` does not
// pre-approve. It is also hermetic (no user or project settings, hooks, MCP servers, CLAUDE.md or
// auto memory) and asks for no built-in tools, so all real work goes through a thread. The
// access is pinned here rather than trusted from the row, so no stored value can reopen it. The
// mode does not depend on `--tools ""` behaving as documented: it is a second layer, not the guard.
const COORDINATOR_PROFILE: RunProfile = {
  isolation: "hermetic",
  accessMode: "approval-required",
  builtInTools: [],
  env: { CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" },
};

// A thread works like the person's own Claude Code (their settings, hooks, MCP servers) plus
// the AOP tools. Claude's own question tool cannot be answered without a terminal, so it is
// withheld in favour of `aop_ask_user`, whose answer arrives as the next turn.
//
// The built-ins that schedule or wake a session are withheld too. A thread's turn ends when it
// reports or asks, and AOP decides when the next one starts; a thread that armed its own wakeup,
// cron, monitor or remote trigger would either be cut off with the process or start turns AOP
// does not know about (Claude Code 2.1.285 tool names).
export const SCHEDULING_BUILT_IN_TOOLS = [
  "ScheduleWakeup",
  "CronCreate",
  "CronDelete",
  "CronList",
  "Monitor",
  "RemoteTrigger",
];

const THREAD_PROFILE: RunProfile = {
  isolation: "open",
  disallowedTools: ["AskUserQuestion", ...SCHEDULING_BUILT_IN_TOOLS],
  env: {},
};

export const runProfileFor = (session: Pick<ChatSession, "kind">): RunProfile => {
  const role = sessionRole(session);
  if (role === "plain") return { isolation: "open", env: {} };
  const profile = role === "coordinator" ? COORDINATOR_PROFILE : THREAD_PROFILE;
  return { ...profile, allowedTools: toolNamesFor(role).map(claudeMcpToolName) };
};
