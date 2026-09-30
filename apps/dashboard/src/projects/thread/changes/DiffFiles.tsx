import type { SessionDiffFile, SessionGitDiff } from "@aop/common";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { memo } from "react";
import { DiffHunkView } from "./DiffHunk";

/** The changed files, each folded to its path and counts until opened. */
export const DiffFiles = ({
  diff,
  collapsed,
  loadingPaths,
  onToggleFile,
}: {
  diff: SessionGitDiff;
  collapsed: Record<string, boolean>;
  loadingPaths: Record<string, boolean>;
  onToggleFile: (path: string) => void;
}) => (
  <div data-testid="thread-diff-scroll" className="min-h-0 flex-1 overflow-auto">
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
  return (
    <section
      data-testid="thread-diff-file"
      data-path={file.path}
      data-collapsed={collapsed ? "true" : "false"}
      className="border-b border-border"
    >
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11.5px] hover:bg-raised"
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
        data-testid="thread-diff-file-loading"
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
