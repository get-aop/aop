import type { SessionDiffFile, SessionGitDiff } from "@aop/common";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getThreadDiff, getThreadDiffFile } from "../../../api/threads";

/** Above this many files they start folded, so thousands of line rows are not mounted at once. */
export const LARGE_DIFF_AUTO_COLLAPSE_THRESHOLD = 12;

export const initialCollapsedForDiff = (
  files: ReadonlyArray<Pick<SessionDiffFile, "path">>,
): Record<string, boolean> => {
  if (files.length < LARGE_DIFF_AUTO_COLLAPSE_THRESHOLD) return {};
  return Object.fromEntries(files.map((file) => [file.path, true]));
};

export interface ThreadDiffView {
  /** The files the thread changed, or null until the first answer or when the host refused. */
  diff: SessionGitDiff | null;
  loading: boolean;
  /** Why there is no diff: the host's own sentence (the worktree is gone, the thread has no repository). */
  error: string | null;
  collapsed: Record<string, boolean>;
  loadingPaths: Record<string, boolean>;
  toggleFile: (path: string) => void;
  collapseAll: () => void;
  expandAll: () => void;
  /** Reads the list again now, without waiting for a turn to end. */
  reload: () => void;
}

/**
 * The thread's changed files. The host answers with the list and counts alone; a file's lines
 * are fetched when it is open, and only while `visible` (the Changes tab is showing), so
 * a thread with many files costs one small request until someone looks. It reads again when
 * `refreshKey` changes: a turn that ended is the moment the worktree changed.
 */
export const useThreadDiff = (
  threadId: string,
  refreshKey: string,
  visible: boolean,
): ThreadDiffView => {
  const [diff, setDiff] = useState<SessionGitDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [loadingPaths, setLoadingPaths] = useState<Record<string, boolean>>({});
  const [reloads, setReloads] = useState(0);

  const updateFile = useCallback(
    (path: string, change: (file: SessionDiffFile) => SessionDiffFile) => {
      setDiff((current) =>
        current
          ? {
              ...current,
              files: current.files.map((file) => (file.path === path ? change(file) : file)),
            }
          : current,
      );
    },
    [],
  );

  const loadFile = useCallback(
    async (path: string) => {
      setLoadingPaths((current) => ({ ...current, [path]: true }));
      try {
        const loaded = await getThreadDiffFile(threadId, path);
        updateFile(path, () => loaded);
      } catch (failure) {
        toast.error(failure instanceof Error ? failure.message : "Could not load the file");
        // Stop asking: the pending flag would bring the file straight back into the queue.
        updateFile(path, (file) => ({ ...file, detailsPending: false }));
      } finally {
        setLoadingPaths((current) => {
          const { [path]: _done, ...rest } = current;
          return rest;
        });
      }
    },
    [threadId, updateFile],
  );

  useEffect(() => {
    void refreshKey;
    void reloads;
    let cancelled = false;
    setLoading(true);
    getThreadDiff(threadId)
      .then((next) => {
        if (cancelled) return;
        setDiff(next);
        setError(null);
        setCollapsed(initialCollapsedForDiff(next.files));
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        setDiff(null);
        setError(failure instanceof Error ? failure.message : "Could not read the changes");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [threadId, refreshKey, reloads]);

  // Every open file whose lines have not come yet is asked for once.
  useEffect(() => {
    if (!visible || !diff) return;
    for (const file of diff.files) {
      if (file.detailsPending && collapsed[file.path] !== true && !loadingPaths[file.path]) {
        void loadFile(file.path);
      }
    }
  }, [visible, diff, collapsed, loadingPaths, loadFile]);

  return {
    diff,
    loading,
    error,
    collapsed,
    loadingPaths,
    toggleFile: (path) => setCollapsed((current) => ({ ...current, [path]: !current[path] })),
    collapseAll: () =>
      setCollapsed(Object.fromEntries((diff?.files ?? []).map((file) => [file.path, true]))),
    expandAll: () => setCollapsed({}),
    reload: () => setReloads((count) => count + 1),
  };
};
