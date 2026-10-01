import {
  type CliProvider,
  CliProviderSchema,
  type ProjectUsage,
  ProjectUsageSchema,
  type RunUsage,
  RunUsageSchema,
  type ThreadUsage,
  ThreadUsageSchema,
  type UsageWindow,
} from "@aop/common";
import { getLogger } from "@aop/infra";
import type { Kysely } from "kysely";
import type { ChatRun, Database } from "../db/schema.ts";
import type { ThreadChanges } from "../thread/changes.ts";
import { byModel, byThread, totalsOf } from "./aggregate.ts";
import { parseClaudeCodeUsage } from "./claude-code-usage.ts";
import { sumThreadChanges } from "./code-changes.ts";
import { createUsageRepository, type UsageBounds } from "./repository.ts";
import type { RunUsageEntry, UsageParser } from "./types.ts";

const logger = getLogger("usage");

// Typed over the whole catalog: a provider added to CliProvider does not compile until it has
// a parser here, so no provider can run without its usage being read.
const PARSERS: Record<CliProvider, UsageParser> = {
  "claude-code": parseClaudeCodeUsage,
};

const UNBOUNDED: UsageBounds = { since: null, until: null };

export interface UsageService {
  /**
   * Reads what a finished run consumed from its log and stores it. It never throws: usage is
   * accounting on the side of a run, and a log that cannot be read must not fail the run.
   */
  recordRunUsage: (run: Pick<ChatRun, "id" | "runtime" | "log_file_path">) => Promise<void>;
  /** Null when there is no such run. A run that recorded no usage has zero totals. */
  getRunUsage: (runId: string) => Promise<RunUsage | null>;
  /** Null when there is no such session. A thread is a chat session, so `threadId` is its id. */
  getThreadUsage: (threadId: string, window: UsageWindow) => Promise<ThreadUsage | null>;
  /**
   * Null when there is no such project. Its code changes are what the threads with runs in the
   * window have changed in their worktrees, read now.
   */
  getProjectUsage: (projectId: string, window: UsageWindow) => Promise<ProjectUsage | null>;
}

export interface UsageServiceDeps {
  now?: () => Date;
  /** Reads a thread's worktree change; without it a project's code changes read as none. */
  threadChanges?: Pick<ThreadChanges, "changes">;
}

export const createUsageService = (
  db: Kysely<Database>,
  { now = () => new Date(), threadChanges }: UsageServiceDeps = {},
): UsageService => {
  const repository = createUsageRepository(db);

  return {
    recordRunUsage: async (run) => {
      const provider = CliProviderSchema.safeParse(run.runtime);
      if (!provider.success) return;
      try {
        const entries = await readEntries(provider.data, run.log_file_path);
        if (entries.length > 0) {
          await repository.record(run.id, provider.data, entries, now().toISOString());
        }
      } catch (error) {
        logger.warn("Could not record usage of run {runId}: {error}", {
          runId: run.id,
          error: errorMessage(error),
        });
      }
    },

    getRunUsage: async (runId) => {
      const threadId = await repository.getRunSessionId(runId);
      if (threadId === null) return null;
      const records = await repository.list({ kind: "run", id: runId }, UNBOUNDED);
      return RunUsageSchema.parse({
        runId,
        threadId,
        totals: totalsOf(records),
        byModel: byModel(records),
      });
    },

    getThreadUsage: async (threadId, window) => {
      if (!(await repository.exists({ kind: "session", id: threadId }))) return null;
      const bounded = toUtc(window);
      const records = await repository.list({ kind: "session", id: threadId }, bounded);
      return ThreadUsageSchema.parse({
        threadId,
        window: bounded,
        totals: totalsOf(records),
        byModel: byModel(records),
      });
    },

    getProjectUsage: async (projectId, window) => {
      if (!(await repository.exists({ kind: "project", id: projectId }))) return null;
      const bounded = toUtc(window);
      const records = await repository.list({ kind: "project", id: projectId }, bounded);
      const threads = byThread(records);
      const threadIds = threads.flatMap((row) => (row.kind === "thread" ? [row.threadId] : []));
      return ProjectUsageSchema.parse({
        projectId,
        window: bounded,
        totals: totalsOf(records),
        byModel: byModel(records),
        threads,
        codeChanges: threadChanges
          ? await sumThreadChanges(threadChanges, threadIds)
          : { additions: 0, deletions: 0 },
      });
    },
  };
};

// Stored times are UTC `toISOString()` strings and are compared as strings, so a bound given
// with an offset is converted first.
const toUtc = (window: UsageWindow): UsageWindow => ({
  since: window.since === null ? null : new Date(window.since).toISOString(),
  until: window.until === null ? null : new Date(window.until).toISOString(),
});

const readEntries = async (provider: CliProvider, logPath: string): Promise<RunUsageEntry[]> => {
  const log = Bun.file(logPath);
  return (await log.exists()) ? PARSERS[provider](await log.text()) : [];
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
