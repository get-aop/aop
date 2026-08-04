/**
 * "N changed files +X -Y" card — clone of t3code ChangedFilesCard/ChangedFilesTree
 * (apps/web/src/components/chat/ChangedFilesTree.tsx). Renders inside the chat
 * column once the workspace has uncommitted changes.
 */
import type { SessionDiffFile } from "@aop/common";
import {
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  FileDiffIcon,
  FolderClosedIcon,
  FolderIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { getSessionGitDiff } from "../../api/client";
import {
  buildChangedFilesTree,
  type ChangedFilesTreeNode,
  collectDirectoryPaths,
  summarizeChangedFilesStats,
} from "./changed-files-tree";

export interface SessionChangedFilesCardProps {
  sessionId: string;
  /** Bump to re-fetch after a run ends. */
  refreshKey?: number;
  /** Open a file row (e.g. in the side panel diff view). */
  onOpenFile?: (path: string) => void;
}

const EMPTY_OVERRIDES: Record<string, boolean> = {};

export const SessionChangedFilesCard = ({
  sessionId,
  refreshKey = 0,
  onOpenFile,
}: SessionChangedFilesCardProps) => {
  const [files, setFiles] = useState<SessionDiffFile[] | null>(null);

  useEffect(() => {
    void refreshKey;
    let cancelled = false;
    getSessionGitDiff(sessionId)
      .then((diff) => {
        if (!cancelled) setFiles(diff.files);
      })
      .catch(() => {
        if (!cancelled) setFiles(null);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, refreshKey]);

  if (!files || files.length === 0) return null;
  return <SessionChangedFilesCardInner files={files} onOpenFile={onOpenFile} />;
};

const SessionChangedFilesCardInner = ({
  files,
  onOpenFile,
}: {
  files: SessionDiffFile[];
  onOpenFile?: (path: string) => void;
}) => {
  const [allExpanded, setAllExpanded] = useState(true);
  const totals = useMemo(() => summarizeChangedFilesStats(files), [files]);

  return (
    <div data-testid="session-changed-files-card" className="mt-4 w-full">
      <div className="rounded-2xl border border-border bg-card/40 p-2 pt-3 shadow-sm">
        <div className="sticky top-0 z-10 mb-2 flex items-center justify-between gap-2 px-2">
          <p className="flex items-center gap-1.5 whitespace-nowrap font-medium text-foreground text-xs leading-4">
            <span>
              {files.length} changed file{files.length === 1 ? "" : "s"}
            </span>
            <DiffStat additions={totals.additions} deletions={totals.deletions} />
          </p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label={allExpanded ? "Collapse all" : "Expand all"}
              title={allExpanded ? "Collapse all" : "Expand all"}
              onClick={() => setAllExpanded((value) => !value)}
              className="grid size-[22px] place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
            >
              {allExpanded ? (
                <ChevronsDownUpIcon className="size-3" />
              ) : (
                <ChevronsUpDownIcon className="size-3" />
              )}
            </button>
            <button
              type="button"
              aria-label="View diff"
              title="View diff"
              onClick={() => onOpenFile?.(files[0]?.path ?? "")}
              className="grid size-[22px] place-items-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
            >
              <FileDiffIcon className="size-3" />
            </button>
          </div>
        </div>
        <ChangedFilesTree files={files} allExpanded={allExpanded} onOpenFile={onOpenFile} />
      </div>
    </div>
  );
};

const ChangedFilesTree = ({
  files,
  allExpanded,
  onOpenFile,
}: {
  files: SessionDiffFile[];
  allExpanded: boolean;
  onOpenFile?: (path: string) => void;
}) => {
  const treeNodes = useMemo(() => buildChangedFilesTree(files), [files]);
  const expansionKey = `${allExpanded ? "expanded" : "collapsed"}\0${collectDirectoryPaths(treeNodes).join("\0")}`;
  const [overrides, setOverrides] = useState<{ key: string; values: Record<string, boolean> }>({
    key: expansionKey,
    values: {},
  });
  const activeOverrides = overrides.key === expansionKey ? overrides.values : EMPTY_OVERRIDES;

  const toggleDirectory = (path: string) => {
    setOverrides((current) => {
      const base = current.key === expansionKey ? current.values : {};
      return {
        key: expansionKey,
        values: { ...base, [path]: !(base[path] ?? allExpanded) },
      };
    });
  };

  return (
    <div className="aop-scroll max-h-72 space-y-0.5 overflow-y-auto">
      {treeNodes.map((node) => (
        <TreeNodeRow
          key={`${node.kind}:${node.path}`}
          node={node}
          depth={0}
          allExpanded={allExpanded}
          overrides={activeOverrides}
          onToggleDirectory={toggleDirectory}
          onOpenFile={onOpenFile}
        />
      ))}
    </div>
  );
};

const TreeNodeRow = ({
  node,
  depth,
  allExpanded,
  overrides,
  onToggleDirectory,
  onOpenFile,
}: {
  node: ChangedFilesTreeNode;
  depth: number;
  allExpanded: boolean;
  overrides: Record<string, boolean>;
  onToggleDirectory: (path: string) => void;
  onOpenFile?: (path: string) => void;
}) => {
  const leftPadding = 8 + depth * 14;
  if (node.kind === "directory") {
    const isExpanded = overrides[node.path] ?? allExpanded;
    return (
      <div>
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => onToggleDirectory(node.path)}
          className="group flex w-full items-center gap-1.5 rounded-xl py-1 pr-3 text-left transition-colors hover:bg-accent/50"
          style={{ paddingLeft: `${leftPadding}px` }}
        >
          <ChevronRightIcon
            aria-hidden="true"
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/70 transition-transform group-hover:text-foreground/80",
              isExpanded && "rotate-90",
            )}
          />
          {isExpanded ? (
            <FolderIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
          ) : (
            <FolderClosedIcon className="size-3.5 shrink-0 text-muted-foreground/75" />
          )}
          <span className="truncate font-mono text-[11px] text-muted-foreground/90 group-hover:text-foreground/90">
            {node.name}
          </span>
          <span className="ml-auto shrink-0">
            <DiffStat additions={node.stat.additions} deletions={node.stat.deletions} small />
          </span>
        </button>
        {isExpanded ? (
          <div className="space-y-0.5">
            {node.children.map((child) => (
              <TreeNodeRow
                key={`${child.kind}:${child.path}`}
                node={child}
                depth={depth + 1}
                allExpanded={allExpanded}
                overrides={overrides}
                onToggleDirectory={onToggleDirectory}
                onOpenFile={onOpenFile}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpenFile?.(node.path)}
      className="group flex w-full items-center gap-1.5 rounded-xl py-1 pr-3 text-left transition-colors hover:bg-accent/50"
      style={{ paddingLeft: `${leftPadding}px` }}
    >
      <span aria-hidden="true" className="size-3.5 shrink-0" />
      <FileStatusBadge status={node.file.status} />
      <span className="truncate font-mono text-[11px] text-muted-foreground/80 group-hover:text-foreground/90">
        {node.name}
      </span>
      <span className="ml-auto shrink-0">
        <DiffStat additions={node.file.additions} deletions={node.file.deletions} small />
      </span>
    </button>
  );
};

const DiffStat = ({
  additions,
  deletions,
  small = false,
}: {
  additions: number;
  deletions: number;
  small?: boolean;
}) => {
  if (additions === 0 && deletions === 0) return null;
  return (
    <span className={cn("font-mono tabular-nums", small ? "text-[10px]" : "text-xs leading-4")}>
      {additions > 0 ? (
        <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>
      ) : null}
      {additions > 0 && deletions > 0 ? " " : null}
      {deletions > 0 ? <span className="text-red-600 dark:text-red-400">−{deletions}</span> : null}
    </span>
  );
};

const FILE_STATUS_META: Record<SessionDiffFile["status"], { label: string; tone: string }> = {
  added: { label: "A", tone: "text-emerald-600 dark:text-emerald-400" },
  binary: { label: "B", tone: "text-muted-foreground/70" },
  deleted: { label: "D", tone: "text-red-600 dark:text-red-400" },
  modified: { label: "M", tone: "text-muted-foreground/70" },
  renamed: { label: "R", tone: "text-amber-600 dark:text-amber-400" },
};

const FileStatusBadge = ({ status }: { status: SessionDiffFile["status"] }) => {
  const meta = FILE_STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex size-3.5 shrink-0 items-center justify-center rounded-[3px] font-mono text-[9px] font-semibold",
        meta.tone,
      )}
      title={`Status: ${status}`}
    >
      {meta.label}
    </span>
  );
};
