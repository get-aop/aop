import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aopPaths, useTestAopHome } from "@aop/infra";
import type { WatcherEvent } from "./types.ts";
import { createWatcherManager, type WatcherManager } from "./watcher.ts";

type WatchCallback = (eventType: string, filename: string | Buffer) => void;

describe("orchestrator/watcher/watcher", () => {
  let cleanupAopHome: (() => void) | undefined;
  let manager: WatcherManager | null;

  beforeEach(() => {
    cleanupAopHome = useTestAopHome();
    manager = null;
  });

  afterEach(() => {
    manager?.stop();
    mock.restore();
    cleanupAopHome?.();
  });

  test("watches the canonical .aop repo task root and emits create events from it", async () => {
    const repoId = "repo-1";
    const repoPath = join(tmpdir(), "aop-watcher-repo");
    const canonicalTasksRoot = aopPaths.repoTasks(repoId);
    const canonicalTaskDir = aopPaths.repoTask(repoId, "auth-flow");
    const watchCallbacks: WatchCallback[] = [];
    const events: WatcherEvent[] = [];

    const watchSpy = spyOn(fs, "watch").mockImplementation(((_path, _options, listener) => {
      const callback = listener as WatchCallback | undefined;
      if (callback) {
        watchCallbacks.push(callback);
      }
      return { close: () => {} } as fs.FSWatcher;
    }) as typeof fs.watch);
    const existsSpy = spyOn(fs, "existsSync").mockImplementation(
      ((path) => path === canonicalTasksRoot || path === canonicalTaskDir) as typeof fs.existsSync,
    );
    const mkdirSpy = spyOn(fs, "mkdirSync").mockImplementation(
      (() => undefined) as typeof fs.mkdirSync,
    );

    manager = createWatcherManager((event) => events.push(event), { debounceMs: 0 });
    manager.addRepo(repoId, repoPath);

    expect(mkdirSpy).toHaveBeenCalledWith(canonicalTasksRoot, { recursive: true });
    expect(watchSpy).toHaveBeenCalledWith(
      canonicalTasksRoot,
      { recursive: true },
      expect.any(Function),
    );

    const callback = watchCallbacks[0];
    expect(callback).toBeDefined();
    callback?.("change", "auth-flow/task.md");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(existsSpy).toHaveBeenCalledWith(canonicalTaskDir);
    expect(events).toEqual([
      {
        type: "create",
        repoId,
        repoPath,
        taskName: "auth-flow",
        taskPath: canonicalTaskDir,
      },
    ]);
  });
});
