import {
  ChevronDownIcon,
  ChevronRightIcon,
  Maximize2Icon,
  Minimize2Icon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { memo, useContext, useMemo, useState } from "react";
import type { SessionDiffFile, SessionDiffLine, SessionGitDiff } from "../../api/client";
import {
  DiffLineCommentEditor,
  DiffReviewContext,
  diffLineCommentKey,
} from "./session-diff-comment";
import { type FoldSegment, foldUnmodifiedRegionsWithEdges } from "./session-diff-fold";
import { DiffSyntax } from "./session-diff-syntax";

export const DiffPanelHeader = ({
  defaultBranch,
  fileCount,
  expanded,
  onToggleExpand,
  onCollapseAll,
  onExpandAll,
  onClose,
}: {
  defaultBranch: string;
  fileCount: number;
  expanded: boolean;
  onToggleExpand?: () => void;
  onCollapseAll?: () => void;
  onExpandAll?: () => void;
  onClose: () => void;
}) => (
  <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
    <DiffPanelTitle defaultBranch={defaultBranch} fileCount={fileCount} />
    <DiffPanelHeaderActions
      expanded={expanded}
      onToggleExpand={onToggleExpand}
      onCollapseAll={onCollapseAll}
      onExpandAll={onExpandAll}
      onClose={onClose}
    />
  </header>
);

const DiffPanelTitle = ({
  defaultBranch,
  fileCount,
}: {
  defaultBranch: string;
  fileCount: number;
}) => (
  <span className="min-w-0 flex-1 truncate text-[11.5px] text-text-muted">
    <span className="font-mono text-[12px] text-text">{defaultBranch}</span>
    <span className="mx-1.5 text-text-subtle">→</span>
    <span className="font-mono text-[12px] text-text">working tree</span>
    {fileCount > 0 ? (
      <span className="ml-2 text-text-subtle" data-testid="session-diff-file-count">
        {fileCount} {fileCount === 1 ? "file" : "files"}
      </span>
    ) : null}
  </span>
);

const DiffPanelHeaderActions = ({
  expanded,
  onToggleExpand,
  onCollapseAll,
  onExpandAll,
  onClose,
}: {
  expanded: boolean;
  onToggleExpand?: () => void;
  onCollapseAll?: () => void;
  onExpandAll?: () => void;
  onClose: () => void;
}) => (
  <>
    {onCollapseAll ? (
      <button
        type="button"
        data-testid="session-diff-collapse-all"
        aria-label="Collapse all files"
        title="Collapse all"
        onClick={onCollapseAll}
        className="focus-ring rounded-control px-1.5 py-0.5 text-[11.5px] text-text-muted"
      >
        Collapse all
      </button>
    ) : null}
    {onExpandAll ? (
      <button
        type="button"
        data-testid="session-diff-expand-all"
        aria-label="Expand all files"
        title="Expand all"
        onClick={onExpandAll}
        className="focus-ring rounded-control px-1.5 py-0.5 text-[11.5px] text-text-muted"
      >
        Expand all
      </button>
    ) : null}
    {onToggleExpand ? (
      <button
        type="button"
        aria-label={expanded ? "Collapse diff panel" : "Expand diff panel"}
        title={expanded ? "Collapse" : "Expand"}
        onClick={onToggleExpand}
        className="focus-ring rounded-control p-1 text-text-muted"
      >
        {expanded ? (
          <Minimize2Icon className="size-3.5" strokeWidth={1.7} />
        ) : (
          <Maximize2Icon className="size-3.5" strokeWidth={1.7} />
        )}
      </button>
    ) : null}
    <button
      type="button"
      aria-label="Close diff panel"
      title="Close"
      onClick={onClose}
      className="focus-ring rounded-control p-1 text-text-muted"
    >
      <XIcon className="size-3.5" strokeWidth={1.7} />
    </button>
  </>
);

export const DiffPanelBody = ({
  loading,
  diff,
  collapsed,
  loadingPaths = {},
  onToggleFile,
}: {
  loading: boolean;
  diff: SessionGitDiff | null;
  collapsed: Record<string, boolean>;
  loadingPaths?: Record<string, boolean>;
  onToggleFile: (path: string) => void;
}) => {
  if (loading) {
    return <p className="p-4 text-[11.5px] text-text-subtle">Loading diff…</p>;
  }
  if (!diff || diff.files.length === 0) {
    return <p className="p-4 text-[11.5px] text-text-subtle">No changes in this workspace.</p>;
  }
  return (
    <div className="min-h-0 flex-1 overflow-auto" data-testid="session-diff-scroll">
      {diff.files.map((file) => (
        <DiffFileSection
          key={file.path}
          file={file}
          collapsed={collapsed[file.path] === true}
          detailsLoading={loadingPaths[file.path] === true}
          onToggle={() => onToggleFile(file.path)}
        />
      ))}
    </div>
  );
};

const DiffFileSection = memo(function DiffFileSection({
  file,
  collapsed,
  detailsLoading,
  onToggle,
}: {
  file: SessionDiffFile;
  collapsed: boolean;
  detailsLoading: boolean;
  onToggle: () => void;
}) {
  // content-visibility only while collapsed: keeps scroll cheap and avoids
  // desktop webview hit-testing bugs on expanded (interactive) line rows.
  return (
    <section
      data-testid="session-diff-file"
      data-collapsed={collapsed ? "true" : "false"}
      className={`${collapsed ? "session-diff-file-virtualized " : ""}border-b border-border`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="focus-ring flex w-full items-center gap-2 px-3 py-2 text-left text-[11.5px] hover:bg-raised"
      >
        {collapsed ? (
          <ChevronRightIcon className="size-3 shrink-0" strokeWidth={1.7} />
        ) : (
          <ChevronDownIcon className="size-3 shrink-0" strokeWidth={1.7} />
        )}
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text">{file.path}</span>
        <span className="font-mono text-[12px] text-ok">+{file.additions}</span>
        <span className="font-mono text-[12px] text-blocked">−{file.deletions}</span>
      </button>
      {collapsed ? null : <DiffFileBody file={file} detailsLoading={detailsLoading} />}
    </section>
  );
});

const DiffFileBody = ({
  file,
  detailsLoading,
}: {
  file: SessionDiffFile;
  detailsLoading: boolean;
}) => {
  if (detailsLoading || file.detailsPending) {
    return (
      <p
        className="px-3 py-2 text-[11.5px] text-text-subtle"
        data-testid="session-diff-file-loading"
      >
        Loading file…
      </p>
    );
  }
  if (file.status === "binary" || (file.truncated && file.hunks.length === 0)) {
    return (
      <p className="px-3 py-2 text-[11.5px] text-text-subtle">
        {file.status === "binary"
          ? "Binary file — content not shown."
          : "File truncated — content not fully shown."}
      </p>
    );
  }
  return (
    <div className="pb-2">
      {file.hunks.map((hunk) => (
        <DiffHunkView
          key={`${file.path}:${hunk.oldStart}:${hunk.newStart}:${hunk.lines.length}:${hunk.lines[0]?.text ?? ""}`}
          path={file.path}
          lines={hunk.lines}
        />
      ))}
      {file.truncated ? (
        <p className="px-3 py-1 text-[11.5px] text-text-subtle">Diff truncated for this file.</p>
      ) : null}
    </div>
  );
};

const DiffHunkView = ({ path, lines }: { path: string; lines: SessionDiffLine[] }) => {
  const segments = useMemo(() => foldUnmodifiedRegionsWithEdges(lines), [lines]);
  const [expandedFolds, setExpandedFolds] = useState<Record<number, boolean>>({});
  return (
    <div data-testid="session-diff-hunk" className="font-mono text-[12px] text-[12px] leading-5">
      {segments.map((segment) => (
        <DiffSegmentView
          key={segmentKey(segment)}
          path={path}
          segment={segment}
          expanded={segment.kind === "fold" ? expandedFolds[segment.id] === true : true}
          onExpand={() =>
            segment.kind === "fold"
              ? setExpandedFolds((current) => ({ ...current, [segment.id]: true }))
              : undefined
          }
          onCollapse={() =>
            segment.kind === "fold"
              ? setExpandedFolds((current) => ({ ...current, [segment.id]: false }))
              : undefined
          }
        />
      ))}
    </div>
  );
};

const segmentKey = (segment: FoldSegment): string =>
  segment.kind === "fold"
    ? `fold-${segment.id}`
    : `lines-${segment.lines[0]?.oldNo}-${segment.lines[0]?.newNo}-${segment.lines[0]?.text}-${segment.lines.length}`;

const DiffSegmentView = ({
  path,
  segment,
  expanded,
  onExpand,
  onCollapse,
}: {
  path: string;
  segment: FoldSegment;
  expanded: boolean;
  onExpand?: () => void;
  onCollapse?: () => void;
}) => {
  if (segment.kind === "lines") {
    return (
      <>
        {segment.lines.map((line) => (
          <DiffLineRow
            key={`${line.type}:${line.oldNo ?? "x"}:${line.newNo ?? "x"}:${line.text}`}
            path={path}
            line={line}
          />
        ))}
      </>
    );
  }
  if (expanded) {
    return (
      <>
        <button
          type="button"
          data-testid="session-diff-fold-collapse"
          aria-label={`Collapse ${segment.lines.length} unmodified lines`}
          onClick={onCollapse}
          className="focus-ring flex w-full items-center gap-2 border-y border-border bg-raised px-3 py-1 text-left text-[11.5px] text-text-subtle"
        >
          <ChevronRightIcon className="size-3 shrink-0" strokeWidth={1.7} />
          Collapse {segment.lines.length} unmodified lines
        </button>
        {segment.lines.map((line) => (
          <DiffLineRow
            key={`${line.type}:${line.oldNo ?? "x"}:${line.newNo ?? "x"}:${line.text}`}
            path={path}
            line={line}
          />
        ))}
      </>
    );
  }
  return (
    <button
      type="button"
      data-testid="session-diff-fold"
      onClick={onExpand}
      className="focus-ring flex w-full items-center gap-2 border-y border-border bg-raised px-3 py-1 text-left text-[11.5px] text-text-subtle"
    >
      <ChevronDownIcon className="size-3 shrink-0" strokeWidth={1.7} />
      {segment.lines.length} unmodified lines
    </button>
  );
};

const DiffLineRow = memo(function DiffLineRow({
  path,
  line,
}: {
  path: string;
  line: SessionDiffLine;
}) {
  const review = useContext(DiffReviewContext);
  const [editing, setEditing] = useState(false);
  const tone = lineToneClass(line.type);
  const hasComment = review?.commentedKeys.has(diffLineCommentKey(path, line)) === true;
  return (
    <>
      <div
        data-testid="session-diff-line"
        data-line-type={line.type}
        className={`group relative grid grid-cols-[44px_44px_minmax(0,1fr)] gap-0 px-2 ${tone}`}
      >
        {review ? (
          <DiffLineCommentButton
            path={path}
            line={line}
            hasComment={hasComment}
            onOpen={() => setEditing(true)}
          />
        ) : null}
        <span className="select-none text-right text-text-subtle opacity-70">
          {line.oldNo ?? ""}
        </span>
        <span className="select-none pr-2 text-right text-text-subtle opacity-70">
          {line.newNo ?? ""}
        </span>
        <span className="min-w-0 whitespace-pre-wrap break-all">
          <span className="mr-1 opacity-60">{linePrefix(line.type)}</span>
          <DiffSyntax path={path} text={line.text} />
        </span>
      </div>
      {editing && review ? (
        <DiffLineCommentEditor
          onSave={(note) => {
            review.addComment(path, line, note);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}
    </>
  );
});

const DiffLineCommentButton = ({
  path,
  line,
  hasComment,
  onOpen,
}: {
  path: string;
  line: SessionDiffLine;
  hasComment: boolean;
  onOpen: () => void;
}) => (
  <button
    type="button"
    data-testid="diff-comment-button"
    data-commented={hasComment ? "true" : undefined}
    aria-label={`Comment on ${path} ${
      line.newNo !== null ? `line ${line.newNo}` : `old line ${line.oldNo ?? 0}`
    }`}
    title="Add review comment"
    onClick={onOpen}
    className={`focus-ring absolute inset-y-0 left-0 flex w-4 items-center justify-center rounded-control ${
      hasComment
        ? "bg-ok/10 text-ok opacity-100"
        : "text-text-muted opacity-0 hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
    }`}
  >
    <PlusIcon className={hasComment ? "size-3" : "size-3"} strokeWidth={hasComment ? 1.7 : 1.7} />
  </button>
);

const lineToneClass = (type: SessionDiffLine["type"]): string => {
  if (type === "add") return "bg-ok/10 text-ok";
  if (type === "del") return "bg-blocked/10 text-blocked";
  return "text-text-muted";
};

const linePrefix = (type: SessionDiffLine["type"]): string => {
  if (type === "add") return "+";
  if (type === "del") return "−";
  return " ";
};
