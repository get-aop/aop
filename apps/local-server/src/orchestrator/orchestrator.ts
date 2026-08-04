import { existsSync } from "node:fs";
import type { ExecutionInfo, StepCommand, TaskStatus } from "@aop/common/protocol";
import { aopPaths, getLogger, runWithSpan } from "@aop/infra";
import { createProvider, type LLMProvider } from "@aop/llm-provider";
import type { OrchestratorStatus, ServiceStatus } from "../app.ts";
import {
  BACKGROUND_TASK_CLEANUP_INTERVAL_MS,
  pruneOldBackgroundTasks,
} from "../chat-session/background-task-retention.ts";
import type { LocalServerContext } from "../context.ts";
import type { Task } from "../db/schema.ts";
import { executeTask, reattachToRunningAgent } from "../executor/executor.ts";
import { recoverStaleTasks } from "../executor/recovery.ts";
import { SettingKey } from "../settings/types.ts";
import { cleanupStaleWorktreeTaskDocSymlinks } from "../task-docs/worktree-symlink-cleanup.ts";
import { finalizeLaunchFailure } from "./launch-failure.ts";
import { createQueueProcessor, type QueueProcessor } from "./queue/processor.ts";
import {
  createTicker,
  createWatcherManager,
  reconcileAllRepos,
  reconcileRepo,
  type Ticker,
  type WatcherManager,
} from "./watcher/index.ts";

const logger = getLogger("orchestrator");

export interface Orchestrator {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  isReady: () => boolean;
  getStatus: () => OrchestratorStatus;
  triggerRefresh: () => boolean;
}

interface ExecutingTask {
  task: Task;
  promise: Promise<void>;
}

export const createOrchestrator = (ctx: LocalServerContext): Orchestrator => {
  let watcher: WatcherManager | null = null;
  let ticker: Ticker | null = null;
  let backgroundTaskCleanupTicker: Ticker | null = null;
  let queueProcessor: QueueProcessor | null = null;
  let schedulerTimer: ReturnType<typeof setTimeout> | null = null;
  let schedulerRunning = false;
  let schedulerEnabled = false;
  let ready = false;
  const executingTasks = new Map<string, ExecutingTask>();
  let pendingRefresh: Promise<void> | null = null;

  const schedulerStatus = (): ServiceStatus =>
    schedulerEnabled ? (schedulerRunning ? "running" : "stopped") : "disabled";

  const getStatus = (): OrchestratorStatus => ({
    watcher: watcher ? "running" : "stopped",
    ticker: ticker?.isRunning() ? "running" : "stopped",
    processor: queueProcessor?.isRunning() ? "running" : "stopped",
    scheduler: schedulerStatus(),
  });

  const startWatcher = async (): Promise<void> => {
    const repos = await ctx.repoRepository.getAll();

    watcher = createWatcherManager(async (event) => {
      await runWithSpan("watcher-event", async () => {
        logger.debug("Watcher event: {type} {taskName}", {
          type: event.type,
          taskName: event.taskName,
          repoId: event.repoId,
        });
        const repo = await ctx.repoRepository.getById(event.repoId);
        if (repo) {
          await reconcileRepo(repo, {
            repoRepository: ctx.repoRepository,
            taskRepository: ctx.taskRepository,
            externalIssueStore: ctx.externalIssueStore,
            settingsRepository: ctx.settingsRepository,
          });
        }
      });
    });

    for (const repo of repos) {
      watcher.addRepo(repo.id, repo.path);
    }

    logger.info("Watcher started for {count} repos", { count: repos.length });
  };

  const startTicker = async (): Promise<void> => {
    const intervalSecs = Number.parseInt(
      await ctx.settingsRepository.get(SettingKey.WATCHER_POLL_INTERVAL_SECS),
      10,
    );

    ticker = createTicker(
      async () => {
        triggerRefreshInternal();
      },
      { intervalMs: intervalSecs * 1000 },
    );

    ticker.start();
  };

  const startBackgroundTaskCleanup = (): void => {
    backgroundTaskCleanupTicker = createTicker(
      async () => {
        const removed = await pruneOldBackgroundTasks(ctx);
        if (removed > 0) {
          logger.info("Removed {count} old background tasks", { count: removed });
        }
      },
      { intervalMs: BACKGROUND_TASK_CLEANUP_INTERVAL_MS },
    );
    backgroundTaskCleanupTicker.start();
  };

  const startQueueProcessor = async (): Promise<void> => {
    queueProcessor = createQueueProcessor({
      taskRepository: ctx.taskRepository,
      repoRepository: ctx.repoRepository,
      settingsRepository: ctx.settingsRepository,
      executionRepository: ctx.executionRepository,
      workflowService: ctx.workflowService,
      executeTask: (task, stepCommand, execution, revertStatus) =>
        executeTaskAsync(task, stepCommand, execution, revertStatus),
    });

    await queueProcessor.start();
  };

  const startScheduler = async (): Promise<void> => {
    const enabled = (await ctx.settingsRepository.get(SettingKey.SCHEDULER_ENABLED)) === "true";
    schedulerEnabled = enabled;
    if (!enabled) {
      logger.info("Scheduler disabled, skipping start");
      return;
    }
    schedulerRunning = true;
    const loop = async () => {
      if (!schedulerRunning) return;
      try {
        await runWithSpan("scheduler-process", () => ctx.schedulerService.processOnce());
      } catch (err) {
        logger.error("Scheduler loop error: {error}", { error: String(err) });
      }
      if (schedulerRunning) {
        const intervalSecs = Number.parseInt(
          await ctx.settingsRepository.get(SettingKey.SCHEDULER_POLL_INTERVAL_SECS),
          10,
        );
        schedulerTimer = setTimeout(loop, intervalSecs * 1000);
      }
    };
    const intervalSecs = Number.parseInt(
      await ctx.settingsRepository.get(SettingKey.SCHEDULER_POLL_INTERVAL_SECS),
      10,
    );
    schedulerTimer = setTimeout(loop, intervalSecs * 1000);
    logger.info("Scheduler started with interval {intervalSecs}s", { intervalSecs });
  };

  const stopScheduler = (): void => {
    schedulerRunning = false;
    if (schedulerTimer) {
      clearTimeout(schedulerTimer);
      schedulerTimer = null;
    }
  };

  const resolveProviderForTask = async (task: Task): Promise<LLMProvider | undefined> => {
    if (task.preferred_provider) {
      return createProvider(task.preferred_provider);
    }

    if (process.env.AOP_TEST_MODE === "true") {
      const testProviderKey = process.env.AOP_E2E_AGENT_PROVIDER?.trim() || "e2e-fixture";
      return createProvider(testProviderKey);
    }

    return undefined;
  };

  const executeTaskAsync = (
    task: Task,
    stepCommand: StepCommand,
    execution: ExecutionInfo,
    revertStatus: TaskStatus = "READY",
  ): void => {
    const promise: Promise<void> = resolveProviderForTask(task)
      .then((provider) => executeTask(ctx, task, stepCommand, execution, provider))
      .then(() => {})
      .catch(async (err) => {
        logger.error("Task execution failed: {error}", {
          taskId: task.id,
          error: String(err),
        });

        try {
          // Close the just-created step/execution before reverting the task so
          // failed launches do not stay visible as fake "running" history.
          await finalizeLaunchFailure({
            executionRepository: ctx.executionRepository,
            taskRepository: ctx.taskRepository,
            taskId: task.id,
            stepExecutionId: stepCommand.id,
            executionId: execution.id,
            revertStatus,
            error: err,
          });
        } catch (updateErr) {
          logger.error("Failed to finalize execution failure: {error}", {
            taskId: task.id,
            error: String(updateErr),
          });
        }
      })
      .finally(() => {
        executingTasks.delete(task.id);
      });

    executingTasks.set(task.id, { task, promise });
  };

  const triggerRefreshInternal = (): void => {
    if (!ready) return;

    pendingRefresh = refreshWatchedRepos()
      .catch((err) => {
        logger.error("Refresh failed: {error}", { error: String(err) });
      })
      .finally(() => {
        pendingRefresh = null;
      });
  };

  const refreshWatchedRepos = async (): Promise<void> => {
    if (!watcher) return;

    await runWithSpan("refresh", async () => {
      const startTime = performance.now();
      const repos = await ctx.repoRepository.getAll();

      let removedCount = 0;
      for (const repo of repos) {
        if (!existsSync(repo.path)) {
          logger.info("Repo path no longer exists, removing: {repoPath}", {
            repoId: repo.id,
            repoPath: repo.path,
          });
          watcher?.removeRepo(repo.id);
          await ctx.repoRepository.remove(repo.id);
          removedCount++;
          continue;
        }
        watcher?.addRepo(repo.id, repo.path);
      }

      await reconcileAllRepos({
        repoRepository: ctx.repoRepository,
        taskRepository: ctx.taskRepository,
        externalIssueStore: ctx.externalIssueStore,
        settingsRepository: ctx.settingsRepository,
      });

      const durationMs = Math.round(performance.now() - startTime);
      logger.info(
        "Refresh complete in {durationMs}ms, watching {count} repos, removed {removedCount}",
        {
          durationMs,
          count: repos.length - removedCount,
          removedCount,
        },
      );
    });
  };

  const waitForPendingRefresh = async (): Promise<void> => {
    if (pendingRefresh) {
      try {
        await pendingRefresh;
      } catch {
        // Ignore errors from pending refresh during shutdown
      }
    }
  };

  const handleStaleTaskRecovery = async (): Promise<void> => {
    const result = await recoverStaleTasks(ctx, {
      logsDir: aopPaths.logs(),
      reattachToRunningAgent: (step) => {
        const promise = ctx.taskRepository
          .get(step.task_id)
          .then(async (task) => {
            if (!task) return;
            const provider = await resolveProviderForTask(task);
            await reattachToRunningAgent(ctx, step, provider);
          })
          .catch(async (err) => {
            logger.error("Reattached agent failed: {error}", {
              taskId: step.task_id,
              error: String(err),
            });
            try {
              await ctx.taskRepository.update(step.task_id, { status: "BLOCKED" });
            } catch (updateErr) {
              logger.error("Failed to set task BLOCKED after reattach failure: {error}", {
                taskId: step.task_id,
                error: String(updateErr),
              });
            }
          })
          .finally(() => {
            executingTasks.delete(step.task_id);
          });

        executingTasks.set(step.task_id, {
          task: { id: step.task_id } as Task,
          promise,
        });
      },
      executeTask: (task, stepCommand, execution) => {
        executeTaskAsync(task, stepCommand, execution, "BLOCKED");
      },
    });

    if (result.recovered > 0 || result.reset > 0 || result.reattached > 0) {
      logger.info(
        "Startup recovery: {recovered} recovered from logs, {reattached} reattached to alive agents, {reset} reset to READY",
        { ...result },
      );
    }
  };

  return {
    start: async () => {
      const startTime = performance.now();
      logger.info("Starting orchestrator");

      await handleStaleTaskRecovery();
      const removedSymlinks = await cleanupStaleWorktreeTaskDocSymlinks(ctx.repoRepository);
      if (removedSymlinks > 0) {
        logger.info("Removed {count} stale task-doc symlinks from worktrees", {
          count: removedSymlinks,
        });
      }
      await startWatcher();
      await startTicker();
      startBackgroundTaskCleanup();
      await startQueueProcessor();
      await startScheduler();

      ready = true;
      const durationMs = Math.round(performance.now() - startTime);
      logger.info("Orchestrator started in {durationMs}ms", { durationMs });
    },

    stop: async () => {
      logger.info("Stopping orchestrator");
      ready = false;

      stopScheduler();
      queueProcessor?.stop();
      backgroundTaskCleanupTicker?.stop();
      ticker?.stop();
      watcher?.stop();

      await waitForPendingRefresh();

      logger.info("Orchestrator stopped");
    },

    isReady: () => ready,

    getStatus,

    triggerRefresh: () => {
      if (!ready) return false;
      triggerRefreshInternal();
      return true;
    },
  };
};
