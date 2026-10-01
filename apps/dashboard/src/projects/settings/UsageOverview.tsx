import { formatRuntimeModelLabel, type ProjectUsage } from "@aop/common";
import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/ui/button";
import { formatShare } from "./format";
import { TokenCount } from "./UsageTables";
import { type ThreadRow, totalTokens, USAGE_PARTS, type UsagePartId } from "./usage-math";
import { type HeadlineFigure, headlineOf } from "./usage-summary";

/**
 * Each bucket's colour, the same in the bar and in the breakdown's keys. Validated as a
 * categorical set on the dark surface (CVD and normal-vision separation, 3:1 contrast).
 */
const PART_COLOR: Record<UsagePartId, string> = {
  input: "#3987e5",
  output: "#d95926",
  "cache-write": "#199e70",
  "cache-read": "#c98500",
};

/** The headline figures, then where the tokens went: a stacked bar and its breakdown. */
export const UsageOverview = ({
  usage,
  rows,
}: {
  usage: ProjectUsage;
  rows: readonly ThreadRow[];
}) => (
  <div className="flex flex-col gap-6">
    <dl data-testid="usage-summary" className="grid grid-cols-1 gap-x-8 sm:grid-cols-3">
      {headlineOf(usage, rows).map((figure) => (
        <Figure key={figure.id} figure={figure} usage={usage} />
      ))}
    </dl>
    <Breakdown usage={usage} />
  </div>
);

const Figure = ({ figure, usage }: { figure: HeadlineFigure; usage: ProjectUsage }) => (
  <div
    data-testid={`usage-stat-${figure.id}`}
    className="flex items-baseline gap-3 border-b border-border py-2.5"
  >
    <dt className="text-[13.5px] text-text-muted">{figure.label}</dt>
    <dd className="text-[13.5px] text-text tabular-nums">
      <FigureValue figure={figure} usage={usage} />
    </dd>
  </div>
);

const FigureValue = ({ figure, usage }: { figure: HeadlineFigure; usage: ProjectUsage }) => {
  if (figure.id === "tokens") return <TokenCount value={totalTokens(usage.totals)} />;
  if (figure.id !== "code-changes" || figure.value === "—") return figure.value;
  const { additions, deletions } = usage.codeChanges;
  return (
    <span data-additions={additions} data-deletions={deletions}>
      <span className="text-diff-add-text">+{additions.toLocaleString("en-US")}</span>{" "}
      <span className="text-diff-del-text">−{deletions.toLocaleString("en-US")}</span>
    </span>
  );
};

const Breakdown = ({ usage }: { usage: ProjectUsage }) => {
  const { totals } = usage;
  const total = totalTokens(totals);
  const models = usage.byModel.map((model) => formatRuntimeModelLabel(model.model)).join(", ");

  return (
    <section data-testid="usage-breakdown" className="flex flex-col">
      <div
        data-testid="usage-bar"
        role="img"
        aria-label={USAGE_PARTS.map(
          (part) => `${part.label} ${formatShare(totals[part.key], total)}`,
        ).join(", ")}
        className="flex h-2 w-full gap-0.5"
      >
        {USAGE_PARTS.map((part) =>
          totals[part.key] > 0 ? (
            <span
              key={part.id}
              data-testid="usage-bar-part"
              data-part={part.id}
              title={`${part.label}: ${totals[part.key].toLocaleString("en-US")} tokens (${formatShare(totals[part.key], total)})`}
              style={{
                backgroundColor: PART_COLOR[part.id],
                flexGrow: totals[part.key],
                flexBasis: 0,
              }}
              className="min-w-1 rounded-[4px]"
            />
          ) : null,
        )}
      </div>
      <div className="mt-4 flex items-baseline gap-3 border-b border-border pb-2.5">
        <h3 className="flex-1 text-[13.5px] text-text">Breakdown</h3>
        <span data-testid="usage-breakdown-models" className="text-[13px] text-text-subtle">
          {models}
        </span>
      </div>
      <dl>
        {USAGE_PARTS.map((part) => (
          <div
            key={part.id}
            data-testid={`usage-part-${part.id}`}
            className="flex items-center gap-2.5 border-b border-border py-2.5"
          >
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ backgroundColor: PART_COLOR[part.id] }}
            />
            <dt className="flex-1 text-[13.5px] text-text">{part.label}</dt>
            <dd className="text-[13.5px] text-text-muted tabular-nums">
              <TokenCount value={totals[part.key]} />
            </dd>
          </div>
        ))}
        <div
          data-testid="usage-stat-runs"
          className="flex items-center gap-2.5 border-b border-border py-2.5"
        >
          <dt className="flex-1 text-[13.5px] text-text">Runs</dt>
          <dd className="text-[13.5px] text-text-muted tabular-nums">{totals.runs}</dd>
        </div>
      </dl>
    </section>
  );
};

/** Copies the screen as plain text; a check says it worked. */
export const CopyUsageButton = ({ text }: { text: string | null }) => {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    if (text === null) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      data-testid="usage-copy"
      data-copied={copied}
      aria-label={copied ? "Copied" : "Copy usage as text"}
      title={copied ? "Copied" : "Copy usage as text"}
      disabled={text === null}
      onClick={() => void copy()}
    >
      {copied ? <CheckIcon className="text-ok" /> : <CopyIcon />}
    </Button>
  );
};
