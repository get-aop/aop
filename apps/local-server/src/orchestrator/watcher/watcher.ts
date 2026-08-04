import * as fs from "node:fs";
import { dirname, join } from "node:path";
import { getLogger } from "@aop/infra";
import {
  getCanonicalTaskDocsRoot,
  getLegacyTaskDocsRoot,
  toTaskId,
} from "../../task-docs/paths.ts";
import type { WatcherConfig, WatcherEvent } from "./types.ts";

const logger = getLogger("watcher");

const DEFAULT_DEBOUNCE_MS = 500;

export interface RepoWatcher {
  repoId: string;
  repoPath: string;
  watchers: fs.FSWatcher[];
}

export interface WatcherManager {
  addRepo: (repoId: string, repoPath: string) => void;
  removeRepo: (repoId: string) => void;
  stop: () => void;
}

export const createWatcherManager = (
  onEvent: (event: WatcherEvent) => void,
  config: Partial<WatcherConfig> = {},
): WatcherManager => {
  const debounceMs = config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const watchers = new Map<string, RepoWatcher>();
  const debounceTimers = new Map<string, Timer>();

  const emitDebounced = (event: WatcherEvent) => {
    const key = `${event.repoId}:${event.taskName}`;
    const existing = debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      debounceTimers.delete(key);
      onEvent(event);
    }, debounceMs);

    debounceTimers.set(key, timer);
  };

  const watchDir = (
    dir: string,
    repoId: string,
    repoPath: string,
    tasksPath: string,
  ): fs.FSWatcher | null => {
    if (!fs.existsSync(dir)) return null;

    try {
      return fs.watch(dir, { recursive: true }, (_eventType, filename) => {
        if (!filename) return;
        const taskName = extractTaskName(filename);
        if (!taskName) return;

        const type = determineEventType(join(tasksPath, taskName));
        emitDebounced({
          type,
          repoId,
          repoPath,
          taskName,
          taskPath: join(tasksPath, taskName),
        });
      });
    } catch (err) {
      logger.error("Failed to watch directory {dir}: {error}", { dir, repoId, error: String(err) });
      return null;
    }
  };

  const addRepo = (repoId: string, repoPath: string) => {
    if (watchers.has(repoId)) return;

    const canonicalTasksPath = getCanonicalTaskDocsRoot(repoId);
    fs.mkdirSync(canonicalTasksPath, { recursive: true });

    const watcherList = [
      watchDir(canonicalTasksPath, repoId, repoPath, canonicalTasksPath),
      watchDir(getLegacyTaskDocsRoot(repoPath), repoId, repoPath, getLegacyTaskDocsRoot(repoPath)),
    ].filter((watcher): watcher is fs.FSWatcher => watcher !== null);

    if (watcherList.length === 0) {
      logger.warn("Task docs directories not found for repo {repoId}", { repoId, repoPath });
      return;
    }

    watchers.set(repoId, { repoId, repoPath, watchers: watcherList });
    logger.info("Started watching repo: {repoPath}", { repoId, repoPath });
  };

  const removeRepo = (repoId: string) => {
    const entry = watchers.get(repoId);
    if (!entry) return;

    for (const w of entry.watchers) w.close();
    watchers.delete(repoId);
    logger.info("Stopped watching repo: {repoId}", { repoId });
  };

  const stop = () => {
    for (const timer of debounceTimers.values()) clearTimeout(timer);
    debounceTimers.clear();

    for (const { watchers: ws, repoId } of watchers.values()) {
      for (const w of ws) w.close();
      logger.debug("Closed watcher for repo: {repoId}", { repoId });
    }
    watchers.clear();
    logger.info("All watchers stopped");
  };

  return { addRepo, removeRepo, stop };
};

const extractTaskName = (filename: string): string | null => {
  const candidate = filename.endsWith(".md") ? dirname(filename) : filename;
  const taskId = toTaskId(candidate);
  return taskId && taskId !== "." ? taskId : null;
};

const determineEventType = (taskPath: string): "create" | "delete" => {
  return fs.existsSync(taskPath) ? "create" : "delete";
};
