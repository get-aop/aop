import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  getSessionGitDiff,
  getSessionGitDiffFile,
  type SessionDiffFile,
  type SessionDiffLine,
  type SessionGitDiff,
} from "../../api/client";
import { RightPanelTabs } from "./right-panel-tabs";
import {
  DiffReviewContext,
  type DiffReviewContextValue,
  diffLineCommentKey,
  diffLineExcerpt,
} from "./session-diff-comment";
import { DiffPanelBody, DiffPanelHeader } from "./session-diff-panel-body";
import { addSessionReviewComment, useSessionReviewQueue } from "./session-review-queue";

/** Above this count, files start collapsed so we don't mount thousands of line rows. */
export const LARGE_DIFF_AUTO_COLLAPSE_THRESHOLD = 12;

interface SessionDiffPanelProps {
  sessionId: string;
  onClose: () => void;
  showToast: (message: string) => void;
  width?: number;
  expanded?: boolean;
  onToggleExpand?: () => void;
  refreshKey?: number;
}

export const initialCollapsedForDiff = (
  files: ReadonlyArray<Pick<SessionDiffFile, "path">>,
): Record<string, boolean> => {
  if (files.length < LARGE_DIFF_AUTO_COLLAPSE_THRESHOLD) return {};
  return Object.fromEntries(files.map((file) => [file.path, true]));
};

const prefetchOpenFileDetails = async (
  sessionId: string,
  next: SessionGitDiff,
  collapsedMap: Record<string, boolean>,
  cancelled: boolean,
  setDiff: Dispatch<SetStateAction<SessionGitDiff | null>>,
): Promise<void> => {
  const openPaths = next.files
    .filter((file) => file.detailsPending && collapsedMap[file.path] !== true)
    .map((file) => file.path);
  if (openPaths.length === 0) return;
  const loaded = await Promise.all(
    openPaths.map(async (path) => {
      try {
        return await getSessionGitDiffFile(sessionId, path);
      } catch {
        return null;
      }
    }),
  );
  if (cancelled) return;
  const files: SessionDiffFile[] = [];
  for (const file of loaded) {
    if (file) files.push(file);
  }
  if (files.length === 0) return;
  const byPath = new Map(files.map((file) => [file.path, file] as const));
  setDiff((current) => {
    if (!current) return current;
    return {
      ...current,
      files: current.files.map((entry) => byPath.get(entry.path) ?? entry),
    };
  });
};

const loadPendingOpenFiles = (
  diff: SessionGitDiff | null,
  collapsed: Record<string, boolean>,
  loadingPaths: Record<string, boolean>,
  loadFileDetails: (path: string) => Promise<void>,
): void => {
  if (!diff) return;
  for (const file of diff.files) {
    if (!file.detailsPending || collapsed[file.path] === true || loadingPaths[file.path]) continue;
    void loadFileDetails(file.path);
  }
};

export const SessionDiffPanel = ({
  sessionId,
  onClose,
  showToast,
  width = 540,
  expanded = false,
  onToggleExpand,
  refreshKey = 0,
}: SessionDiffPanelProps) => {
  const [diff, setDiff] = useState<SessionGitDiff | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [loadingPaths, setLoadingPaths] = useState<Record<string, boolean>>({});
  const reviewComments = useSessionReviewQueue(sessionId);
  const commentedKeys = useMemo(
    () =>
      new Set(
        reviewComments.map((comment) =>
          diffLineCommentKey(comment.path, {
            type: comment.lineType,
            oldNo: comment.oldNo,
            newNo: comment.newNo,
          }),
        ),
      ),
    [reviewComments],
  );
  const addComment = useCallback(
    (path: string, line: SessionDiffLine, note: string) => {
      addSessionReviewComment(sessionId, {
        path,
        lineType: line.type,
        oldNo: line.oldNo,
        newNo: line.newNo,
        excerpt: diffLineExcerpt(line.text),
        note,
      });
    },
    [sessionId],
  );
  const review = useMemo<DiffReviewContextValue>(
    () => ({ commentedKeys, addComment }),
    [commentedKeys, addComment],
  );

  const loadFileDetails = useCallback(
    async (path: string) => {
      setLoadingPaths((current) => ({ ...current, [path]: true }));
      try {
        const file = await getSessionGitDiffFile(sessionId, path);
        setDiff((current) => {
          if (!current) return current;
          return {
            ...current,
            files: current.files.map((entry) => (entry.path === path ? file : entry)),
          };
        });
      } catch (error: unknown) {
        showToast(error instanceof Error ? error.message : "Could not load file diff");
        // Clear pending so the expand effect does not retry forever.
        setDiff((current) => {
          if (!current) return current;
          return {
            ...current,
            files: current.files.map((entry) =>
              entry.path === path ? { ...entry, detailsPending: false } : entry,
            ),
          };
        });
      } finally {
        setLoadingPaths((current) => {
          const next = { ...current };
          delete next[path];
          return next;
        });
      }
    },
    [sessionId, showToast],
  );

  useEffect(() => {
    void refreshKey;
    let cancelled = false;
    setLoading(true);
    getSessionGitDiff(sessionId)
      .then(async (next) => {
        if (cancelled) return;
        const collapsedMap = initialCollapsedForDiff(next.files);
        setDiff(next);
        setCollapsed(collapsedMap);
        await prefetchOpenFileDetails(sessionId, next, collapsedMap, cancelled, setDiff);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        showToast(error instanceof Error ? error.message : "Could not load session diff");
        setDiff(null);
        setCollapsed({});
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, sessionId, showToast]);

  const collapseAll = useCallback(() => {
    if (!diff) return;
    setCollapsed(Object.fromEntries(diff.files.map((file) => [file.path, true])));
  }, [diff]);

  const expandAll = useCallback(() => {
    setCollapsed({});
  }, []);

  const onToggleFile = useCallback(
    (path: string) => {
      setCollapsed((current) => {
        const wasCollapsed = current[path] === true;
        if (wasCollapsed) {
          const pending = diff?.files.find((file) => file.path === path)?.detailsPending;
          if (pending && !loadingPaths[path]) void loadFileDetails(path);
        }
        return { ...current, [path]: !wasCollapsed };
      });
    },
    [diff, loadFileDetails, loadingPaths],
  );

  // When expand-all opens summary rows, load their details.
  useEffect(() => {
    loadPendingOpenFiles(diff, collapsed, loadingPaths, loadFileDetails);
  }, [collapsed, diff, loadFileDetails, loadingPaths]);

  return (
    <RightPanelTabs surface="diff" title="Diff" width={width} onClose={onClose}>
      <div
        data-testid="session-diff-panel"
        className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface"
      >
        <DiffPanelHeader
          defaultBranch={diff?.defaultBranch ?? "main"}
          fileCount={diff?.files.length ?? 0}
          expanded={expanded}
          onToggleExpand={onToggleExpand}
          onCollapseAll={
            diff && diff.files.length >= LARGE_DIFF_AUTO_COLLAPSE_THRESHOLD
              ? collapseAll
              : undefined
          }
          onExpandAll={
            diff && diff.files.length >= LARGE_DIFF_AUTO_COLLAPSE_THRESHOLD ? expandAll : undefined
          }
          onClose={onClose}
        />
        <DiffReviewContext.Provider value={review}>
          <DiffPanelBody
            loading={loading}
            diff={diff}
            collapsed={collapsed}
            loadingPaths={loadingPaths}
            onToggleFile={onToggleFile}
          />
        </DiffReviewContext.Provider>
      </div>
    </RightPanelTabs>
  );
};
