import type { SessionDiffLine } from "@aop/common";
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { memo, useContext, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { DiffLineCommentEditor, DiffReviewContext, diffLineCommentKey } from "./DiffLineComment";
import { DiffSyntax } from "./DiffSyntax";
import { type FoldSegment, foldUnmodifiedRegionsWithEdges } from "./diff-fold";

const FOLD_BUTTON =
  "flex w-full items-center gap-2 border-y border-border bg-raised px-3 py-1 text-left text-[11.5px] text-text-subtle hover:text-text-muted";

/** One hunk: its lines, with long runs of unchanged lines folded until asked for. */
export const DiffHunkView = ({ path, lines }: { path: string; lines: SessionDiffLine[] }) => {
  const segments = useMemo(() => foldUnmodifiedRegionsWithEdges(lines), [lines]);
  const [expandedFolds, setExpandedFolds] = useState<Record<number, boolean>>({});
  const setFold = (id: number, open: boolean) =>
    setExpandedFolds((current) => ({ ...current, [id]: open }));

  return (
    <div data-testid="thread-diff-hunk" className="font-mono text-[12px] leading-5">
      {segments.map((segment) => (
        <DiffSegmentView
          key={segmentKey(segment)}
          path={path}
          segment={segment}
          expanded={segment.kind === "fold" ? expandedFolds[segment.id] === true : true}
          onSetFold={segment.kind === "fold" ? (open) => setFold(segment.id, open) : undefined}
        />
      ))}
    </div>
  );
};

const segmentKey = (segment: FoldSegment): string =>
  segment.kind === "fold"
    ? `fold-${segment.id}`
    : `lines-${segment.lines[0]?.oldNo}-${segment.lines[0]?.newNo}-${segment.lines[0]?.text}-${segment.lines.length}`;

const lineKey = (line: SessionDiffLine): string =>
  `${line.type}:${line.oldNo ?? "x"}:${line.newNo ?? "x"}:${line.text}`;

const DiffSegmentView = ({
  path,
  segment,
  expanded,
  onSetFold,
}: {
  path: string;
  segment: FoldSegment;
  expanded: boolean;
  onSetFold?: (open: boolean) => void;
}) => {
  const rows = segment.lines.map((line) => (
    <DiffLineRow key={lineKey(line)} path={path} line={line} />
  ));
  if (segment.kind === "lines") return <>{rows}</>;
  if (!expanded) {
    return (
      <button
        type="button"
        data-testid="thread-diff-fold"
        onClick={() => onSetFold?.(true)}
        className={FOLD_BUTTON}
      >
        <ChevronDownIcon className="size-3 shrink-0" strokeWidth={1.7} />
        {segment.lines.length} unmodified lines
      </button>
    );
  }
  return (
    <>
      <button
        type="button"
        data-testid="thread-diff-fold-collapse"
        aria-label={`Collapse ${segment.lines.length} unmodified lines`}
        onClick={() => onSetFold?.(false)}
        className={FOLD_BUTTON}
      >
        <ChevronRightIcon className="size-3 shrink-0" strokeWidth={1.7} />
        Collapse {segment.lines.length} unmodified lines
      </button>
      {rows}
    </>
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
  const hasComment = review?.commentedKeys.has(diffLineCommentKey(path, line)) === true;
  return (
    <>
      <div
        data-testid="thread-diff-line"
        data-line-type={line.type}
        className={cn(
          "group relative grid grid-cols-[44px_44px_minmax(0,1fr)] gap-0 px-2",
          LINE_TONE[line.type],
        )}
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
          <span className="mr-1 opacity-60">{LINE_PREFIX[line.type]}</span>
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
    className={cn(
      // z-10: the line numbers beside it have an opacity, which would paint them over the button.
      "absolute inset-y-0 left-0 z-10 flex w-4 items-center justify-center rounded-row",
      hasComment
        ? "bg-ok/10 text-ok opacity-100"
        : "text-text-muted opacity-0 hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100",
    )}
  >
    <PlusIcon className="size-3" strokeWidth={1.7} />
  </button>
);

const LINE_TONE: Record<SessionDiffLine["type"], string> = {
  add: "bg-diff-add-fill text-diff-add-text",
  del: "bg-diff-del-fill text-diff-del-text",
  context: "text-text-muted",
};

const LINE_PREFIX: Record<SessionDiffLine["type"], string> = {
  add: "+",
  del: "−",
  context: " ",
};
