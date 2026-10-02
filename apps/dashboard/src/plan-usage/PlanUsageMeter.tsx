import { useState } from "react";
import { cn } from "@/lib/cn";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/ui/hover-card";
import { formatAgo } from "../projects/selectors";
import { useNow } from "../projects/use-now";
import { usePlanUsage } from "./plan-usage-store";
import {
  describeReset,
  formatResetTime,
  meterLabel,
  peakOf,
  planViews,
  type UsageLevel,
  type WindowView,
} from "./plan-usage-view";

const FILL: Record<UsageLevel, string> = {
  calm: "bg-text-muted",
  warm: "bg-waiting",
  hot: "bg-blocked",
};
const STROKE: Record<UsageLevel, string> = {
  calm: "stroke-text-muted",
  warm: "stroke-waiting",
  hot: "stroke-blocked",
};
const FIGURE: Record<UsageLevel, string> = {
  calm: "text-text-muted",
  warm: "text-waiting",
  hot: "text-blocked",
};

/**
 * The Claude plan's usage against its 5-hour and 7-day limits, as one compact top-bar item: two
 * hairline meters where the bar has room (32rem), the fuller window as a ring with its share
 * where it has less (28rem), and just the ring below that, so the project's name keeps its room.
 * Hovering, focusing or tapping it opens the details. It draws nothing until the host has heard
 * the numbers from a run (an API-key login never reports them).
 */
export const PlanUsageMeter = () => {
  const { usage } = usePlanUsage();
  const now = useNow(30_000);
  const [open, setOpen] = useState(false);
  if (!usage) return null;

  const views = planViews(usage, now);
  const peak = peakOf(views);

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={150} closeDelay={120}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          data-testid="plan-usage-meter"
          data-level={peak.level}
          aria-label={meterLabel(views, now)}
          // A touch has no hover: a tap opens the details, and a tap elsewhere closes them.
          onClick={() => setOpen(true)}
          className={cn(
            "flex h-8 shrink-0 items-center gap-3 rounded-row px-1 transition-colors duration-[120ms] hover:bg-hover @md:px-2",
            open && "bg-hover",
          )}
        >
          <span data-testid="plan-usage-wide" className="hidden items-center gap-3 @lg:flex">
            {views.map((view) => (
              <WindowBar key={view.key} view={view} />
            ))}
          </span>
          <span data-testid="plan-usage-narrow" className="flex items-center gap-1.5 @lg:hidden">
            <Ring view={peak} />
            <span
              className={cn(
                "hidden text-[11px] leading-none font-medium tabular-nums @md:inline",
                FIGURE[peak.level],
              )}
            >
              {figureOf(peak)}
            </span>
          </span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        align="end"
        sideOffset={6}
        data-testid="plan-usage-details"
        className="w-64 border-border-strong bg-overlay p-3"
      >
        <p className="text-meta font-medium text-text">Claude plan usage</p>
        <div className="mt-2.5 flex flex-col gap-3">
          {views.map((view) => (
            <WindowDetail key={view.key} view={view} now={now} />
          ))}
        </div>
        <p
          data-testid="plan-usage-updated"
          className="mt-3 border-t border-border pt-2 text-xs text-text-subtle"
        >
          Updated {formatAgo(usage.updatedAt, now)}, from the latest Claude Code run.
        </p>
      </HoverCardContent>
    </HoverCard>
  );
};

const figureOf = (view: WindowView): string => (view.percent === null ? "—" : `${view.percent}%`);

/** "5h 42%" over a hairline that fills to the same share. */
const WindowBar = ({ view }: { view: WindowView }) => (
  <span
    data-testid={`plan-usage-${view.key}`}
    data-level={view.level}
    className="flex w-11 flex-col gap-[3px]"
  >
    <span className="flex items-baseline justify-between gap-1 text-[11px] leading-none tabular-nums">
      <span className="text-text-subtle">{view.short}</span>
      <span className={cn("font-medium", FIGURE[view.level])}>{figureOf(view)}</span>
    </span>
    <Track view={view} className="h-[2px]" />
  </span>
);

const Track = ({ view, className }: { view: WindowView; className?: string }) => (
  <span className={cn("block w-full overflow-hidden rounded-full bg-border-strong", className)}>
    <span
      className={cn("block h-full rounded-full", FILL[view.level])}
      style={{ width: `${view.percent ?? 0}%` }}
    />
  </span>
);

const RADIUS = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** The fuller window as a ring that fills clockwise. */
const Ring = ({ view }: { view: WindowView }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    aria-hidden="true"
    data-testid="plan-usage-ring"
    data-window={view.key}
    className="-rotate-90"
  >
    <circle cx="8" cy="8" r={RADIUS} fill="none" strokeWidth="2" className="stroke-border-strong" />
    {view.percent ? (
      <circle
        cx="8"
        cy="8"
        r={RADIUS}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${(CIRCUMFERENCE * view.percent) / 100} ${CIRCUMFERENCE}`}
        className={STROKE[view.level]}
      />
    ) : null}
  </svg>
);

const WindowDetail = ({ view, now }: { view: WindowView; now: number }) => (
  <div data-testid={`plan-usage-detail-${view.key}`} className="flex flex-col gap-1.5">
    <div className="flex items-baseline justify-between text-meta">
      <span className="text-text-muted">{view.name} window</span>
      <span className={cn("font-medium tabular-nums", FIGURE[view.level])}>
        {view.percent === null ? "—" : `${view.percent}% used`}
      </span>
    </div>
    <Track view={view} className="h-1" />
    <span className="text-xs text-text-subtle">{resetLine(view, now)}</span>
  </div>
);

const resetLine = (view: WindowView, now: number): string => {
  if (view.percent === null) return "Not reported yet";
  const reset = describeReset(view, now);
  const text = `${reset.charAt(0).toUpperCase()}${reset.slice(1)}`;
  return view.resetsAt === null ? text : `${text} · ${formatResetTime(view.resetsAt, now)}`;
};
