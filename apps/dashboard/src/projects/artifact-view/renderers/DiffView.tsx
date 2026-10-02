import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { type DiffLine, diffLines, diffStats } from "./line-diff";

/** Two versions line by line: what the newer one removed and added, with each side's numbers. */
export const DiffView = ({
  before,
  after,
  beforeLabel,
  afterLabel,
}: {
  before: string;
  after: string;
  beforeLabel: string;
  afterLabel: string;
}) => {
  const lines = useMemo(() => diffLines(before, after), [before, after]);
  const { added, removed } = diffStats(lines);
  return (
    <div data-testid="artifact-diff" className="min-w-0 p-4">
      <p
        data-testid="artifact-diff-summary"
        className="mb-2 flex items-center gap-3 text-meta text-text-subtle"
      >
        <span>
          {beforeLabel} → {afterLabel}
        </span>
        <span className="text-ok">+{added}</span>
        <span className="text-blocked">−{removed}</span>
        {added === 0 && removed === 0 ? <span>No changes</span> : null}
      </p>
      <div className="overflow-auto rounded-card border border-border font-mono text-[12.5px] leading-5">
        {lines.map((line) => (
          <DiffRow key={lineKey(line)} line={line} />
        ))}
      </div>
    </div>
  );
};

const lineKey = (line: DiffLine): string =>
  `${line.type}:${"before" in line ? line.before : ""}:${"after" in line ? line.after : ""}`;

const MARKS: Record<DiffLine["type"], string> = { added: "+", removed: "−", same: "" };

const DiffRow = ({ line }: { line: DiffLine }) => (
  <div
    data-diff={line.type}
    className={cn(
      "grid grid-cols-[3rem_3rem_1.25rem_minmax(0,1fr)]",
      line.type === "added" && "bg-diff-add-fill text-diff-add-text",
      line.type === "removed" && "bg-diff-del-fill text-diff-del-text",
    )}
  >
    <span className="select-none pr-2 text-right text-text-subtle">
      {"before" in line ? line.before : ""}
    </span>
    <span className="select-none pr-2 text-right text-text-subtle">
      {"after" in line ? line.after : ""}
    </span>
    <span className="select-none text-center">{MARKS[line.type]}</span>
    <span className="whitespace-pre-wrap break-all pr-3">{line.text || " "}</span>
  </div>
);
