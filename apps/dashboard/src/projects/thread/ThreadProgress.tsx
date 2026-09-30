import { getThreadProgress, type Thread, type ThreadStep } from "@aop/common";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/ui/collapsible";
import { StepsRing } from "../StepsRing";

// Queued and rate-limited threads have a notice of their own that says the same, with more.
const LIVE_LINE_STATUSES: ReadonlySet<Thread["status"]> = new Set(["working", "landing"]);

/**
 * The thread's own account of where it is: the line it last reported and its checklist, which
 * folds away. A thread that has reported neither has nothing to show here.
 */
export const ThreadProgress = ({ thread }: { thread: Thread }) => {
  const progress = getThreadProgress(thread);
  // The line is live only while the thread is at work; once it stops, the transcript says it better.
  const line = LIVE_LINE_STATUSES.has(thread.status) ? thread.liveStatusLine : null;
  if (!progress && !line) return null;

  return (
    <Collapsible
      defaultOpen
      data-testid="thread-progress"
      className="group/progress mx-6 mt-1 rounded-card border border-border bg-raised"
    >
      <CollapsibleTrigger
        data-testid="thread-progress-toggle"
        className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none"
      >
        <span className="min-w-0 flex-1 text-meta text-text-muted">
          {line ? (
            <span data-testid="thread-progress-line" className="text-text">
              {line}
            </span>
          ) : (
            "Steps"
          )}
        </span>
        {progress ? <StepsRing done={progress.done} total={progress.total} /> : null}
        <ChevronDownIcon
          aria-hidden="true"
          className="size-3.5 text-text-subtle transition-transform group-data-[state=closed]/progress:-rotate-90"
        />
      </CollapsibleTrigger>
      {progress ? (
        <CollapsibleContent>
          <ol
            data-testid="thread-steps-list"
            className="flex max-h-48 flex-col gap-2.5 overflow-y-auto border-t border-border px-4 py-3"
          >
            {keyedSteps(thread.steps).map(({ key, step }) => (
              <StepItem key={key} step={step} working={thread.status === "working"} />
            ))}
          </ol>
        </CollapsibleContent>
      ) : null}
    </Collapsible>
  );
};

// A step has no id, only a label, and a checklist may repeat one: the nth repeat gets "#n".
const keyedSteps = (steps: readonly ThreadStep[]): { key: string; step: ThreadStep }[] => {
  const seen = new Map<string, number>();
  return steps.map((step) => {
    const count = (seen.get(step.label) ?? 0) + 1;
    seen.set(step.label, count);
    return { key: count === 1 ? step.label : `${step.label}#${count}`, step };
  });
};

const StepItem = ({ step, working }: { step: ThreadStep; working: boolean }) => (
  <li
    data-testid="thread-step"
    data-state={step.state}
    className={cn(
      "flex items-start gap-3 text-body",
      step.state === "pending" ? "text-text-subtle" : "text-text",
      step.state === "done" && "text-text-muted",
    )}
  >
    <StepMarker state={step.state} working={working} />
    <span className="min-w-0">{step.label}</span>
  </li>
);

const StepMarker = ({ state, working }: { state: ThreadStep["state"]; working: boolean }) => {
  if (state === "done") {
    return (
      <span
        aria-hidden="true"
        className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-ok/15 text-ok"
      >
        <CheckIcon className="size-3" strokeWidth={3} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-0.5 size-5 shrink-0 rounded-full border-[1.5px]",
        state === "active"
          ? cn(
              "border-running",
              working && "aop-running-dot motion-safe:animate-[aop-pulse_2s_ease-in-out_infinite]",
            )
          : "border-border-strong",
      )}
    />
  );
};
