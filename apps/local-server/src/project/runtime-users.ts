import type { RuntimeUsage } from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import { createRuntimeUsageRepository, type RuntimeUsageRow } from "./runtime-usage-repository.ts";
import type { ProjectService } from "./service.ts";

/** What the runtime settings ask of projects before a runtime goes (runtime-configuration/service.ts). */
export interface RuntimeUsers {
  list: (runtimeId: string) => Promise<RuntimeUsage[]>;
  /**
   * Moves every project setting that names `from` to `to`, through the project service so open
   * dashboards and coordinators follow, then points every session still bound to `from` (threads,
   * resolved ones too) at `to`: their next turn runs there, the turn in flight is not touched.
   */
  move: (from: string, to: { id: string; command: string }) => Promise<void>;
}

export const createRuntimeUsers = (
  ctx: LocalServerContext,
  projects: Pick<ProjectService, "get" | "update">,
): RuntimeUsers => {
  const usage = createRuntimeUsageRepository(ctx.db);
  return {
    list: async (runtimeId) =>
      (await usage.listUsers(runtimeId)).map((row) => ({
        projectId: row.projectId,
        projectName: row.projectName,
        roles: [
          ...(row.coordinator ? (["coordinator"] as const) : []),
          ...(row.threads ? (["threads"] as const) : []),
        ],
        openThreads: row.openThreads,
      })),

    move: async (from, to) => {
      for (const row of await usage.listUsers(from)) await moveSettings(row, to.id);
      await usage.rebindSessions(from, to);
    },
  };

  async function moveSettings(row: RuntimeUsageRow, to: string): Promise<void> {
    if (!row.coordinator && !row.threads) return;
    const found = await projects.get(row.projectId);
    if (!found.success) return;
    const { coordinator, thread } = found.project;
    await projects.update(row.projectId, {
      ...(row.coordinator && { coordinator: { ...coordinator, runtimeId: to } }),
      ...(row.threads && { thread: { ...thread, runtimeId: to } }),
    });
  }
};
