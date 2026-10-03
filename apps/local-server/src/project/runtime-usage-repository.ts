import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";

export interface RuntimeUsageRow {
  projectId: string;
  projectName: string;
  coordinator: boolean;
  threads: boolean;
  openThreads: number;
}

export interface RuntimeUsageRepository {
  /** Projects whose settings name the runtime, or with threads that are not resolved on it; oldest first. */
  listUsers: (runtimeId: string) => Promise<RuntimeUsageRow[]>;
  /** Points every session bound to `from` at `to`; the runtime they had is about to go. */
  rebindSessions: (from: string, to: { id: string; command: string }) => Promise<void>;
}

export const createRuntimeUsageRepository = (db: Kysely<Database>): RuntimeUsageRepository => ({
  listUsers: async (runtimeId) => {
    const [projects, threads] = await Promise.all([
      db
        .selectFrom("projects")
        .select(["id", "name", "coordinator_runtime_id", "thread_runtime_id", "created_at"])
        .orderBy("created_at")
        .orderBy("id")
        .execute(),
      db
        .selectFrom("chat_sessions")
        .select(({ fn }) => ["project_id", fn.countAll<number>().as("count")])
        .where("kind", "=", "thread")
        .where("state", "!=", "resolved")
        .where("runtime_configuration_id", "=", runtimeId)
        .groupBy("project_id")
        .execute(),
    ]);
    const open = new Map(threads.map((row) => [row.project_id, Number(row.count)]));
    return projects.flatMap((project) => {
      const row = {
        projectId: project.id,
        projectName: project.name,
        coordinator: project.coordinator_runtime_id === runtimeId,
        threads: project.thread_runtime_id === runtimeId,
        openThreads: open.get(project.id) ?? 0,
      };
      return row.coordinator || row.threads || row.openThreads > 0 ? [row] : [];
    });
  },

  rebindSessions: async (from, to) => {
    await db
      .updateTable("chat_sessions")
      .set({
        runtime_configuration_id: to.id,
        runtime_alias: to.command,
        updated_at: new Date().toISOString(),
      })
      .where("runtime_configuration_id", "=", from)
      .execute();
  },
});
