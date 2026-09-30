import { getLogger } from "@aop/infra";
import { terminateProcessTree } from "@aop/llm-provider";
import type { LocalServerContext } from "../context.ts";
import type { ChatRun } from "../db/schema.ts";
import { isAgentProcess, isAgentRunning } from "../process/liveness.ts";

const logger = getLogger("aop", "chat-run-process");

/** Records the detached CLI's pid on its running chat run so a restarted server can find it. */
export const recordChatRunPid = async (
  ctx: LocalServerContext,
  runId: string,
  pid: number,
): Promise<void> => {
  await ctx.db
    .updateTable("chat_runs")
    .set({ pid, updated_at: new Date().toISOString() })
    .where("id", "=", runId)
    .where("status", "=", "running")
    .execute();
};

/**
 * The recorded CLI of a run is gone: the pid exited, or it now belongs to an
 * unrelated process. Runs without a recorded pid are never declared gone here.
 */
export const isChatRunProcessGone = (
  run: Pick<ChatRun, "pid">,
  executable: string | null,
): boolean => run.pid !== null && !isChatRunProcessLive(run.pid, executable);

/**
 * Stops the CLI of a run whose owning server is gone (Stop after a restart).
 * Only a live process whose command line is an agent CLI is signalled, so a
 * reused pid is left alone. Returns whether a process was stopped.
 */
export const stopOrphanedChatRunProcess = async (
  run: Pick<ChatRun, "id" | "pid">,
  executable: string | null,
): Promise<boolean> => {
  if (run.pid === null || !isChatRunProcessLive(run.pid, executable)) return false;
  await terminateProcessTree(run.pid);
  logger.info("Stopped orphaned chat run process {pid} for run {runId}", {
    pid: run.pid,
    runId: run.id,
  });
  return true;
};

const isChatRunProcessLive = (pid: number, executable: string | null): boolean =>
  isAgentRunning(pid) && isAgentProcess(pid, { executable });
