import type { FactoryHealthItem, FactoryHealthSeverity, FactoryHealthSnapshot } from "@aop/common";
import { TaskStatus } from "@aop/common";
import type { OrchestratorStatus } from "../app.ts";
import type { LocalServerContext } from "../context.ts";
import { isGhAuthenticated } from "../task/pr-github.ts";

interface HealthFailureInput {
  id: string;
  label: string;
  message: string;
  updatedAt?: string;
}

export interface FactoryHealthSnapshotDeps {
  checkDb(): Promise<boolean>;
  isGhAuthenticated(): Promise<boolean>;
  listRecentFailedImports?(): Promise<HealthFailureInput[]>;
  listRecentFailedExecutions(): Promise<HealthFailureInput[]>;
  listStaleRunningExecutions(): Promise<HealthFailureInput[]>;
  now?: () => Date;
  orchestratorStatus?: () => OrchestratorStatus;
}

export interface GetFactoryHealthSnapshotOptions {
  ctx: LocalServerContext;
  now?: () => Date;
  orchestratorStatus?: () => OrchestratorStatus;
  staleRunningMs?: number;
}

const STALE_RUNNING_MS = 30 * 60 * 1000;
const RECENT_FAILURE_WINDOW_MS = 72 * 60 * 60 * 1000;
const MAX_RECENT_FAILURES = 5;

export const getFactoryHealthSnapshot = (options: GetFactoryHealthSnapshotOptions) =>
  buildFactoryHealthSnapshot({
    checkDb: () => checkDbConnection(options.ctx),
    isGhAuthenticated,
    listRecentFailedExecutions: () => listRecentFailedExecutions(options.ctx),
    listStaleRunningExecutions: () =>
      listStaleRunningExecutions({
        ctx: options.ctx,
        now: options.now?.() ?? new Date(),
        staleRunningMs: options.staleRunningMs ?? STALE_RUNNING_MS,
      }),
    now: options.now,
    orchestratorStatus: options.orchestratorStatus,
  });

export const buildFactoryHealthSnapshot = async (
  deps: FactoryHealthSnapshotDeps,
): Promise<FactoryHealthSnapshot> => {
  const now = deps.now?.() ?? new Date();
  const generatedAt = now.toISOString();
  const [services, integrations, importFailures, executionFailures, staleExecutions] =
    await Promise.all([
      buildServiceItems(deps),
      buildIntegrationItems(deps),
      deps.listRecentFailedImports?.() ?? [],
      deps.listRecentFailedExecutions(),
      deps.listStaleRunningExecutions(),
    ]);
  const recentFailures = [
    ...toRecentFailureItems(
      importFailures.filter((failure) => isRecentFailure(failure, now)),
      "error",
      "Open the task import status and rerun the import.",
    ),
    ...toRecentFailureItems(
      executionFailures.filter((failure) => isRecentFailure(failure, now)),
      "error",
      "Open the task logs and retry the failed step.",
    ),
    ...toRecentFailureItems(
      staleExecutions,
      "warning",
      "Check the worker session or restart the local server.",
    ),
  ].slice(0, MAX_RECENT_FAILURES);
  const allItems = [...services, ...integrations, ...recentFailures];

  return {
    generatedAt,
    severity: summarizeSeverity(allItems),
    summary: {
      ok: allItems.filter((item) => item.severity === "ok").length,
      warning: allItems.filter((item) => item.severity === "warning").length,
      error: allItems.filter((item) => item.severity === "error").length,
    },
    services,
    integrations,
    recentFailures,
  };
};

const buildServiceItems = async (deps: FactoryHealthSnapshotDeps): Promise<FactoryHealthItem[]> => {
  const dbConnected = await deps.checkDb();
  return [buildDatabaseItem(dbConnected), buildOrchestratorItem(deps.orchestratorStatus?.())];
};

const buildDatabaseItem = (connected: boolean): FactoryHealthItem =>
  connected
    ? {
        id: "database",
        label: "Database",
        severity: "ok",
        message: "SQLite is reachable.",
      }
    : {
        id: "database",
        label: "Database",
        severity: "error",
        message: "SQLite health check failed.",
        action: "Restart the local server and verify the AOP home database.",
      };

const buildOrchestratorItem = (status: OrchestratorStatus | undefined): FactoryHealthItem => {
  if (!status) {
    return {
      id: "orchestrator",
      label: "Orchestrator",
      severity: "warning",
      message: "Orchestrator status is unavailable.",
      action: "Refresh the dashboard after the local server finishes starting.",
    };
  }

  const stopped = Object.entries(status)
    .filter(([, value]) => value === "stopped")
    .map(([name]) => name);
  if (stopped.length === 0) {
    return {
      id: "orchestrator",
      label: "Orchestrator",
      severity: "ok",
      message: "Watcher, ticker, and queue processor are running.",
    };
  }

  return {
    id: "orchestrator",
    label: "Orchestrator",
    severity: "warning",
    message: `${toTitleCase(stopped.join(", "))} ${stopped.length === 1 ? "is" : "are"} stopped.`,
    action: "Restart the local server before the demo.",
  };
};

const buildIntegrationItems = async (
  deps: FactoryHealthSnapshotDeps,
): Promise<FactoryHealthItem[]> => [await buildGitHubCliItem(deps)];

const buildGitHubCliItem = async (deps: FactoryHealthSnapshotDeps): Promise<FactoryHealthItem> => {
  try {
    if (await deps.isGhAuthenticated()) {
      return {
        id: "github-cli",
        label: "GitHub CLI",
        severity: "ok",
        message: "GitHub CLI (gh) is installed and authenticated.",
      };
    }
  } catch {
    // Fall through to the unavailable item below.
  }

  return {
    id: "github-cli",
    label: "GitHub CLI",
    severity: "error",
    message: "GitHub CLI (gh) is not installed or not authenticated.",
    action: "Install gh and run `gh auth login`; pull-request actions are disabled until it is.",
  };
};

const toRecentFailureItems = (
  failures: HealthFailureInput[],
  severity: FactoryHealthSeverity,
  action: string,
): FactoryHealthItem[] =>
  failures.map((failure) => ({
    id: failure.id,
    label: failure.label,
    severity,
    message: sanitizeMessage(failure.message),
    action,
    updatedAt: failure.updatedAt,
  }));

const listRecentFailedExecutions = async (
  ctx: LocalServerContext,
): Promise<HealthFailureInput[]> => {
  const rows = await ctx.db
    .selectFrom("executions")
    .innerJoin("tasks", "tasks.id", "executions.task_id")
    .select([
      "executions.id as executionId",
      "executions.completed_at as completedAt",
      "executions.status as status",
      "tasks.change_path as changePath",
    ])
    .where("executions.status", "in", ["failed", "aborted", "cancelled"])
    .where("tasks.status", "=", TaskStatus.BLOCKED)
    .orderBy("executions.completed_at", "desc")
    .limit(MAX_RECENT_FAILURES)
    .execute();

  return rows.map((row) => ({
    id: `execution-${row.executionId}`,
    label: `Task ${row.changePath} failed`,
    message: `Execution ${row.executionId} ended with status ${row.status}.`,
    updatedAt: row.completedAt ?? undefined,
  }));
};

const listStaleRunningExecutions = async (params: {
  ctx: LocalServerContext;
  now: Date;
  staleRunningMs: number;
}): Promise<HealthFailureInput[]> => {
  const cutoff = new Date(params.now.getTime() - params.staleRunningMs).toISOString();
  const rows = await params.ctx.db
    .selectFrom("executions")
    .innerJoin("tasks", "tasks.id", "executions.task_id")
    .select([
      "executions.id as executionId",
      "executions.started_at as startedAt",
      "tasks.change_path as changePath",
    ])
    .where("executions.status", "=", "running")
    .where("tasks.status", "=", TaskStatus.WORKING)
    .where("executions.started_at", "<", cutoff)
    .orderBy("executions.started_at", "asc")
    .limit(MAX_RECENT_FAILURES)
    .execute();

  return rows.map((row) => ({
    id: `stale-${row.executionId}`,
    label: `Stale task ${row.changePath}`,
    message: `Execution ${row.executionId} has been running since ${row.startedAt}.`,
    updatedAt: row.startedAt,
  }));
};

const checkDbConnection = async (ctx: LocalServerContext): Promise<boolean> => {
  try {
    await ctx.settingsRepository.get("max_concurrent_tasks");
    return true;
  } catch {
    return false;
  }
};

const summarizeSeverity = (items: FactoryHealthItem[]): FactoryHealthSeverity => {
  if (items.some((item) => item.severity === "error")) return "error";
  if (items.some((item) => item.severity === "warning")) return "warning";
  return "ok";
};

const isRecentFailure = (failure: HealthFailureInput, now: Date): boolean => {
  if (!failure.updatedAt) {
    return true;
  }

  const updatedAtMs = Date.parse(failure.updatedAt);
  if (Number.isNaN(updatedAtMs)) {
    return true;
  }

  return now.getTime() - updatedAtMs <= RECENT_FAILURE_WINDOW_MS;
};

const sanitizeMessage = (message: string): string =>
  message
    .replaceAll(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    .replaceAll(
      /(access[_-]?token|refresh[_-]?token|api[_-]?token|password)[=:]\s*[^\s,;]+/gi,
      "$1=[redacted]",
    );

const toTitleCase = (value: string): string =>
  value.replace(/\b\w/g, (letter) => letter.toUpperCase());
