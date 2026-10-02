import type { PullRequestViewFile } from "@aop/common";
import { getSingularPatch } from "@pierre/diffs";
import { FileDiff, Virtualizer } from "@pierre/diffs/react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { type CSSProperties, memo, useMemo } from "react";
import { cn } from "@/lib/cn";
import { fileAnchor, isLargeFile, patchOf } from "./diff-files";

/*
 * The diff itself, in a module of its own so the renderer (@pierre/diffs, on Shiki) loads only
 * when the Files tab is opened. @pierre/diffs was picked for: unified and split views from one
 * parsed patch, Shiki highlighting with the github themes the chat already ships, line-level
 * virtualization (only the rows in view are in the DOM, so a 20k-line file scrolls), and
 * rendering inside a shadow root, so its CSS and ours never collide. Apache-2.0.
 */

export type DiffStyle = "unified" | "split";

export interface DiffListProps {
  files: PullRequestViewFile[];
  diffStyle: DiffStyle;
  collapsed: ReadonlySet<string>;
  /** Large files the person asked to see. */
  shown: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onShow: (path: string) => void;
  githubUrl: string;
}

// The renderer's colours follow the page's: its background, font and line height.
const DIFF_VARS = {
  "--diffs-dark-bg": "var(--color-canvas)",
  "--diffs-font-family": "var(--font-mono)",
  "--diffs-font-size": "12.5px",
  "--diffs-line-height": "20px",
} as CSSProperties;

export const DiffList = ({ files, ...props }: DiffListProps) => (
  <Virtualizer
    className="min-h-0 flex-1 overflow-auto"
    contentClassName="flex flex-col gap-3 p-3"
    config={{ overscrollSize: 800 }}
  >
    {files.map((file) => (
      <FileSection key={file.path} file={file} {...props} />
    ))}
  </Virtualizer>
);

const STATUS_MARK: Record<PullRequestViewFile["status"], [string, string]> = {
  added: ["A", "text-ok"],
  removed: ["D", "text-blocked"],
  modified: ["M", "text-waiting"],
  renamed: ["R", "text-running"],
  copied: ["C", "text-running"],
  changed: ["M", "text-waiting"],
  unchanged: ["·", "text-text-subtle"],
};

const FileSection = memo(function FileSection({
  file,
  diffStyle,
  collapsed,
  shown,
  onToggle,
  onShow,
  githubUrl,
}: Omit<DiffListProps, "files"> & { file: PullRequestViewFile }) {
  const isCollapsed = collapsed.has(file.path);
  const [mark, tone] = STATUS_MARK[file.status];
  return (
    <section
      id={fileAnchor(file.path)}
      data-testid="pr-file"
      data-path={file.path}
      data-collapsed={isCollapsed}
      className="scroll-mt-3 overflow-hidden rounded-card border border-border-strong"
    >
      <button
        type="button"
        aria-expanded={!isCollapsed}
        onClick={() => onToggle(file.path)}
        className="sticky top-0 z-10 flex w-full items-center gap-2 border-b border-border-strong bg-raised px-3 py-2 text-left hover:bg-hover"
      >
        {isCollapsed ? (
          <ChevronRightIcon className="size-3.5 shrink-0" />
        ) : (
          <ChevronDownIcon className="size-3.5 shrink-0" />
        )}
        <span
          className={cn("w-3 shrink-0 font-mono text-[12px] font-semibold", tone)}
          title={file.status}
        >
          {mark}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-text">
          {file.previousPath ? `${file.previousPath} → ` : ""}
          {file.path}
        </span>
        <span className="shrink-0 font-mono text-[12px] text-ok">+{file.additions}</span>
        <span className="shrink-0 font-mono text-[12px] text-blocked">−{file.deletions}</span>
      </button>
      {isCollapsed ? null : (
        <FileBody
          file={file}
          diffStyle={diffStyle}
          shown={shown.has(file.path)}
          onShow={onShow}
          githubUrl={githubUrl}
        />
      )}
    </section>
  );
});

const FileBody = ({
  file,
  diffStyle,
  shown,
  onShow,
  githubUrl,
}: {
  file: PullRequestViewFile;
  diffStyle: DiffStyle;
  shown: boolean;
  onShow: (path: string) => void;
  githubUrl: string;
}) => {
  const patch = patchOf(file);
  if (patch === null) {
    const renameOnly = file.status === "renamed" && file.additions + file.deletions === 0;
    return (
      <Notice testId="pr-file-no-patch">
        {renameOnly ? (
          "File renamed without changes."
        ) : (
          <>
            Binary file, or a diff too large for GitHub to send.{" "}
            <a
              href={`${githubUrl}/files`}
              target="_blank"
              rel="noreferrer noopener"
              className="text-running hover:underline"
            >
              See it on GitHub
            </a>
          </>
        )}
      </Notice>
    );
  }
  if (isLargeFile(file) && !shown) {
    return (
      <Notice testId="pr-file-large">
        Large diffs are not rendered by default (
        {(file.additions + file.deletions).toLocaleString()} changed lines).{" "}
        <button
          type="button"
          data-testid="pr-file-load"
          onClick={() => onShow(file.path)}
          className="text-running hover:underline"
        >
          Load diff
        </button>
      </Notice>
    );
  }
  return <RenderedDiff patch={patch} diffStyle={diffStyle} />;
};

const RenderedDiff = ({ patch, diffStyle }: { patch: string; diffStyle: DiffStyle }) => {
  const fileDiff = useMemo(() => parse(patch), [patch]);
  if (!fileDiff) return <Notice testId="pr-file-unreadable">This diff could not be read.</Notice>;
  return (
    <FileDiff
      fileDiff={fileDiff}
      style={DIFF_VARS}
      options={{
        diffStyle,
        theme: { dark: "github-dark", light: "github-light" },
        themeType: "dark",
        disableFileHeader: true,
        overflow: "scroll",
        hunkSeparators: "line-info",
        lineDiffType: "word",
      }}
    />
  );
};

const parse = (patch: string) => {
  try {
    return getSingularPatch(patch);
  } catch {
    return null;
  }
};

const Notice = ({ testId, children }: { testId: string; children: React.ReactNode }) => (
  <p data-testid={testId} className="px-4 py-6 text-center text-meta text-text-muted">
    {children}
  </p>
);

export default DiffList;
