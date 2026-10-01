import type { Kysely } from "kysely";
import { readRunCliVersion } from "../chat-session/init-event.ts";
import type { Database } from "../db/schema.ts";

/** What the agent CLI service reads about runs: which are in flight, and what the last one ran on. */
export interface AgentCliRunRepository {
  /** Runs of `runtime` marked running, including runs a restarted host is still recovering. */
  activeRuns: (runtime: string) => Promise<{ logFilePath: string }[]>;
  lastRunVersion: (runtime: string) => Promise<string | null>;
  /** The versions the in-flight runs started on, read from their logs, distinct. */
  activeRunVersions: (runs: { logFilePath: string }[], field: string) => Promise<string[]>;
}

export const createAgentCliRunRepository = (db: Kysely<Database>): AgentCliRunRepository => ({
  activeRuns: async (runtime) =>
    (
      await db
        .selectFrom("chat_runs")
        .select("log_file_path")
        .where("runtime", "=", runtime)
        .where("status", "=", "running")
        .execute()
    ).map((row) => ({ logFilePath: row.log_file_path })),
  lastRunVersion: async (runtime) =>
    (
      await db
        .selectFrom("chat_runs")
        .select("cli_version")
        .where("runtime", "=", runtime)
        .where("cli_version", "is not", null)
        .orderBy("updated_at", "desc")
        .limit(1)
        .executeTakeFirst()
    )?.cli_version ?? null,
  activeRunVersions: async (runs, field) => {
    const versions = await Promise.all(
      runs.map((run) => readRunCliVersion(run.logFilePath, field)),
    );
    return [...new Set(versions.filter((version): version is string => version !== null))];
  },
});
