import { launchSkipsPermissions } from "../agent-cli/permission-bypass.ts";
import type { LocalServerContext } from "../context.ts";
import type { ChatRun, ChatSession } from "../db/schema.ts";
import { bypassesPermissions, type HostRunAccess, runProfileFor } from "./run-profile.ts";

/**
 * What the host decides for one launch of the session's CLI, asked right before it spawns (after
 * any wait for a CLI update), so the owner's permission bypass reaches the next turn, follow-ups
 * and resumes included, without a restart. The run records whether it skipped permission checks.
 */
export const hostRunAccess =
  (ctx: LocalServerContext, session: ChatSession, chatRun: ChatRun | undefined) =>
  async (): Promise<HostRunAccess> => {
    const host = { skipPermissions: await launchSkipsPermissions(ctx.settingsRepository) };
    if (chatRun) {
      await recordRunPermissions(
        ctx,
        chatRun.id,
        bypassesPermissions(runProfileFor(session, host)),
      );
    }
    return host;
  };

const recordRunPermissions = async (
  ctx: LocalServerContext,
  runId: string,
  bypassed: boolean,
): Promise<void> => {
  await ctx.db
    .updateTable("chat_runs")
    .set({ permissions_bypassed: bypassed ? 1 : 0 })
    .where("id", "=", runId)
    .where("status", "=", "running")
    .execute();
};
