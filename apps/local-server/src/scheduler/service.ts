import { randomUUID } from "node:crypto";
import { getLogger } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { NewSchedulerTrigger, SchedulerTrigger, Task } from "../db/schema.ts";
import { SettingKey } from "../settings/types.ts";
import { markTaskReady } from "../task/handlers.ts";
import { resolveTaskFilePath } from "../task-docs/paths.ts";
import { parseTaskDoc } from "../task-docs/task.ts";

const logger = getLogger("scheduler");

export interface SchedulerTriggerInput {
  repoId: string;
  name: string;
  action: "re_import_tracker" | "auto_promote_draft_to_ready";
  cadenceSecs: number;
  maxItemsPerRun?: number;
  enabled?: boolean;
  requireApprovalBeforeHandoff?: boolean;
  allowedSources?: string[];
}

export interface SchedulerRunResult {
  triggerId: string;
  action: string;
  promoted: number;
  imported?: number;
  skipped: number;
  reason?: string;
  error?: string;
  failures?: TrackerReimportFailure[];
}

export interface TrackerReimportFailure {
  provider: string;
  ref: string;
  error: string;
}

export interface TrackerReimporter {
  reimportRepo(input: {
    repoId: string;
    allowedSources: string[] | null;
  }): Promise<{ imported: number; skipped: number; failures: TrackerReimportFailure[] }>;
}

interface AutoPromoteEligibility {
  eligible: boolean;
}

export interface SchedulerService {
  createTrigger: (input: SchedulerTriggerInput) => Promise<SchedulerTrigger>;
  updateTrigger: (
    id: string,
    updates: Partial<Omit<SchedulerTriggerInput, "repoId" | "name" | "action">>,
  ) => Promise<SchedulerTrigger | null>;
  deleteTrigger: (id: string) => Promise<boolean>;
  getTrigger: (id: string) => Promise<SchedulerTrigger | null>;
  listTriggers: (repoId: string) => Promise<SchedulerTrigger[]>;
  runTrigger: (id: string) => Promise<SchedulerRunResult>;
  getDueTriggers: () => Promise<SchedulerTrigger[]>;
  processOnce: () => Promise<number>;
}

export const createSchedulerService = (ctx: LocalServerContext): SchedulerService => {
  const repo = ctx.schedulerRepository;

  const createTrigger = async (input: SchedulerTriggerInput): Promise<SchedulerTrigger> => {
    const trigger: NewSchedulerTrigger = {
      id: randomUUID(),
      repo_id: input.repoId,
      name: input.name,
      action: input.action,
      cadence_secs: input.cadenceSecs,
      enabled: input.enabled ?? false,
      max_items_per_run: input.maxItemsPerRun ?? 1,
      require_approval_before_handoff: input.requireApprovalBeforeHandoff ?? true,
      allowed_sources_json: input.allowedSources ? JSON.stringify(input.allowedSources) : null,
      last_run_at: null,
      last_result_json: null,
    };
    return repo.create(trigger);
  };

  const mapTriggerUpdates = (
    updates: Partial<Omit<SchedulerTriggerInput, "repoId" | "name" | "action">>,
  ): Record<string, unknown> => {
    const fieldMap: Array<[string, unknown]> = [
      ["cadence_secs", updates.cadenceSecs],
      ["enabled", updates.enabled],
      ["max_items_per_run", updates.maxItemsPerRun],
      ["require_approval_before_handoff", updates.requireApprovalBeforeHandoff],
    ];
    const dbUpdates: Record<string, unknown> = {};
    for (const [dbKey, value] of fieldMap) {
      if (value !== undefined) dbUpdates[dbKey] = value;
    }
    if (updates.allowedSources !== undefined) {
      dbUpdates.allowed_sources_json = updates.allowedSources
        ? JSON.stringify(updates.allowedSources)
        : null;
    }
    return dbUpdates;
  };

  const updateTrigger = async (
    id: string,
    updates: Partial<Omit<SchedulerTriggerInput, "repoId" | "name" | "action">>,
  ): Promise<SchedulerTrigger | null> => repo.update(id, mapTriggerUpdates(updates));

  const deleteTrigger = async (id: string): Promise<boolean> => repo.delete(id);

  const getTrigger = async (id: string): Promise<SchedulerTrigger | null> => repo.getById(id);

  const listTriggers = async (repoId: string): Promise<SchedulerTrigger[]> =>
    repo.listByRepoId(repoId);

  const runTriggerAction = async (trigger: SchedulerTrigger): Promise<SchedulerRunResult> => {
    if (trigger.action === "auto_promote_draft_to_ready") {
      return runAutoPromote(ctx, trigger);
    }
    if (trigger.action === "re_import_tracker") {
      return runReImport(ctx, trigger);
    }
    return {
      triggerId: trigger.id,
      action: trigger.action,
      promoted: 0,
      skipped: 0,
      error: "unknown_action",
    };
  };

  const checkTriggerGuards = async (
    trigger: SchedulerTrigger | null,
    id: string,
  ): Promise<SchedulerRunResult | null> => {
    if (!trigger) {
      return {
        triggerId: id,
        action: "unknown",
        promoted: 0,
        skipped: 0,
        error: "trigger_not_found",
      };
    }

    const schedulerEnabled =
      (await ctx.settingsRepository.get(SettingKey.SCHEDULER_ENABLED)) === "true";
    if (!schedulerEnabled) {
      return {
        triggerId: id,
        action: trigger.action,
        promoted: 0,
        skipped: 0,
        reason: "scheduler_disabled",
      };
    }

    if (!trigger.enabled) {
      return {
        triggerId: id,
        action: trigger.action,
        promoted: 0,
        skipped: 0,
        reason: "trigger_disabled",
      };
    }

    return null;
  };

  const runTrigger = async (id: string): Promise<SchedulerRunResult> => {
    const trigger = await repo.getById(id);
    const guardResult = await checkTriggerGuards(trigger, id);
    if (guardResult || !trigger)
      return (
        guardResult ?? {
          triggerId: id,
          action: "unknown",
          promoted: 0,
          skipped: 0,
          error: "trigger_not_found",
        }
      );

    let result: SchedulerRunResult;
    try {
      result = await runTriggerAction(trigger);
    } catch (error) {
      logger.error("Scheduler trigger failed: {error}", {
        triggerId: id,
        name: trigger.name,
        error: String(error),
      });
      result = {
        triggerId: id,
        action: trigger.action,
        promoted: 0,
        skipped: 0,
        error: String(error),
      };
    }

    await repo.update(id, {
      last_run_at: new Date().toISOString(),
      last_result_json: JSON.stringify(result),
    });

    await emitSchedulerEvent(ctx, trigger, result);

    return result;
  };

  const getDueTriggers = async (): Promise<SchedulerTrigger[]> => {
    const schedulerEnabled =
      (await ctx.settingsRepository.get(SettingKey.SCHEDULER_ENABLED)) === "true";
    if (!schedulerEnabled) return [];

    const all = await repo.listAll();
    const now = Date.now();
    return all.filter((trigger) => {
      if (!trigger.enabled) return false;
      if (!trigger.last_run_at) return true;
      const elapsedSecs = (now - new Date(trigger.last_run_at).getTime()) / 1000;
      return elapsedSecs >= trigger.cadence_secs;
    });
  };

  const processOnce = async (): Promise<number> => {
    const due = await getDueTriggers();
    for (const trigger of due) {
      await runTrigger(trigger.id);
    }
    return due.length;
  };

  return {
    createTrigger,
    updateTrigger,
    deleteTrigger,
    getTrigger,
    listTriggers,
    runTrigger,
    getDueTriggers,
    processOnce,
  };
};

const runAutoPromote = async (
  ctx: LocalServerContext,
  trigger: SchedulerTrigger,
): Promise<SchedulerRunResult> => {
  const tasks = await ctx.taskRepository.list({ repo_id: trigger.repo_id, status: "DRAFT" });
  const maxItems = trigger.max_items_per_run;
  let promoted = 0;
  let skipped = 0;
  const allowedSources = parseAllowedSources(trigger.allowed_sources_json);

  for (const task of tasks) {
    if (promoted >= maxItems) {
      skipped += tasks.length - promoted - skipped;
      break;
    }

    const eligibility = await checkAutoPromoteEligibility(ctx, task, allowedSources);
    if (!eligibility.eligible) {
      skipped++;
      continue;
    }

    const result = await markTaskReady(ctx, task.id, {
      handoffRequiresApprovalOverride: trigger.require_approval_before_handoff,
    });
    if (result.success) {
      promoted++;
    } else {
      skipped++;
    }
  }

  return {
    triggerId: trigger.id,
    action: trigger.action,
    promoted,
    skipped,
  };
};

const checkAutoPromoteEligibility = async (
  ctx: LocalServerContext,
  task: Task,
  allowedSources: Set<string> | null,
): Promise<AutoPromoteEligibility> => {
  const source = await ctx.externalIssueStore.getTaskSourceByTaskId(task.id);
  if (allowedSources && source && !allowedSources.has(source.provider)) {
    return { eligible: false };
  }

  if (await isHighRiskAutoPromotion(ctx, task)) {
    return { eligible: false };
  }

  return { eligible: true };
};

const runReImport = async (
  ctx: LocalServerContext,
  trigger: SchedulerTrigger,
): Promise<SchedulerRunResult> => {
  const allowedSources = parseAllowedSources(trigger.allowed_sources_json);
  const result = await ctx.trackerReimporter.reimportRepo({
    repoId: trigger.repo_id,
    allowedSources: allowedSources ? [...allowedSources] : null,
  });
  const failedRefs = result.failures.map((failure) => `${failure.provider}:${failure.ref}`);

  return {
    triggerId: trigger.id,
    action: trigger.action,
    imported: result.imported,
    promoted: 0,
    skipped: result.skipped,
    ...(result.failures.length > 0
      ? {
          error: `failed_to_reimport:${failedRefs.join(",")}`,
          failures: result.failures,
        }
      : {}),
  };
};

const parseAllowedSources = (json: string | null): Set<string> | null => {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? new Set(parsed.filter((s) => typeof s === "string")) : null;
  } catch {
    return null;
  }
};

const HIGH_RISK_TAGS = new Set([
  "high-risk",
  "risk:high",
  "risk-high",
  "requires-human",
  "requires-approval",
  "manual-approval",
  "sensitive",
]);

const HIGH_RISK_PATH_SEGMENTS = new Set([
  "auth",
  "authentication",
  "authorization",
  "billing",
  "credential",
  "credentials",
  "deploy",
  "deployment",
  "infra",
  "migration",
  "migrations",
  "payment",
  "payments",
  "permission",
  "permissions",
  "production",
  "secret",
  "secrets",
  "security",
  "token",
  "tokens",
]);

const isHighRiskAutoPromotion = async (ctx: LocalServerContext, task: Task): Promise<boolean> => {
  if (hasHighRiskPath(task.change_path)) return true;

  const repo = await ctx.repoRepository.getById(task.repo_id);
  if (!repo) return true;

  try {
    const taskDoc = await parseTaskDoc(
      resolveTaskFilePath(task.repo_id, repo.path, task.change_path),
    );
    return taskDoc.tags.some((tag) => HIGH_RISK_TAGS.has(normalizeRiskToken(tag)));
  } catch {
    return false;
  }
};

const hasHighRiskPath = (changePath: string): boolean =>
  changePath
    .split(/[/._-]+/)
    .map(normalizeRiskToken)
    .some((segment) => HIGH_RISK_PATH_SEGMENTS.has(segment));

const normalizeRiskToken = (value: string): string => value.trim().toLowerCase();

const emitSchedulerEvent = async (
  ctx: LocalServerContext,
  trigger: SchedulerTrigger,
  result: SchedulerRunResult,
): Promise<void> => {
  const kind = result.error
    ? "scheduler_failed"
    : result.promoted > 0
      ? "scheduler_promoted"
      : "scheduler_skipped";

  try {
    await ctx.runtimeEventRepository.insertMany([
      {
        id: randomUUID(),
        task_id: `scheduler:${trigger.id}`,
        execution_id: `scheduler:${trigger.id}`,
        step_execution_id: `scheduler:${trigger.id}`,
        session_id: null,
        agent_id: null,
        kind: "scheduler_triggered" as never,
        title: `Scheduler: ${trigger.name}`,
        message:
          result.error ?? result.reason ?? `Promoted ${result.promoted}, skipped ${result.skipped}`,
        tool_name: null,
        status: result.error ? "failed" : "completed",
        source_kind: "scheduler",
        source_id: trigger.id,
        source_index: 0,
        occurred_at: new Date().toISOString(),
        metadata_json: JSON.stringify({ kind, ...result }),
      },
    ]);
  } catch (error) {
    logger.warn("Failed to emit scheduler event: {error}", { error: String(error) });
  }
};
