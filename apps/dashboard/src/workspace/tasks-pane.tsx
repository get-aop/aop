import { type ChatDelegationRun, deriveDelegationViewStatus } from "@aop/common";
import { CircleCheckIcon, ClockIcon } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/ui/dialog";
import { RuntimeProviderIcon } from "@/ui/provider-icon";
import { Spinner } from "@/ui/spinner";
import { DelegationDetailView } from "../components/delegations/DelegationDetailView";
import {
  dismissDelegationCard,
  getDelegationCards,
  openDelegationDetail,
  useDelegationCards,
  useOpenDelegationId,
} from "../components/delegations/delegation-center";
import { formatDelegationElapsed } from "../components/delegations/delegation-format";

const FINISHED_LIMIT = 5;

/**
 * Right-panel Tasks tab — the home of background tasks + delegations
 * (PLAN §7.2). Data is the existing delegation-center store; rows open the
 * existing DelegationDetailView in a dialog.
 */
export const TasksPane = () => {
  const cards = useDelegationCards();
  const now = Date.now();
  const running = cards.filter((card) => isRunning(card.delegation, now));
  const finished = cards
    .filter((card) => !isRunning(card.delegation, now))
    .slice(0, FINISHED_LIMIT);
  const [showMore, setShowMore] = useState(false);
  const openId = useOpenDelegationId();
  const runningCount = running.length;

  const finishedVisible = showMore ? finished : finished.slice(0, 3);

  return (
    <div data-testid="tasks-pane" className="flex h-full min-h-0 flex-col gap-1 p-2">
      <TasksSection title="Running" count={runningCount}>
        {running.length === 0 ? (
          <p className="px-1 py-2 text-[12px] text-text-subtle">No background tasks running.</p>
        ) : (
          running.map((card) => (
            <TaskRow
              key={card.delegation.id}
              runtime={card.delegation.runtime}
              label={card.delegation.label}
              model={card.delegation.model}
              startedAt={card.delegation.startedAt}
              running
              now={now}
              onOpen={() => openDelegationDetail(card.delegation.id)}
            />
          ))
        )}
      </TasksSection>
      {finished.length > 0 ? (
        <TasksSection title="Finished">
          {finishedVisible.map((card) => (
            <TaskRow
              key={card.delegation.id}
              runtime={card.delegation.runtime}
              label={card.delegation.label}
              model={card.delegation.model}
              startedAt={card.delegation.startedAt}
              running={false}
              now={now}
              onOpen={() => openDelegationDetail(card.delegation.id)}
            />
          ))}
          {finished.length > 3 && !showMore ? (
            <button
              type="button"
              data-testid="tasks-show-more"
              onClick={() => setShowMore(true)}
              className="mx-1 mt-0.5 flex h-7 items-center rounded-row px-2 text-left text-[12px] text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text"
            >
              Show more · {finished.length - 3}
            </button>
          ) : null}
        </TasksSection>
      ) : null}

      <Dialog
        open={openId !== null}
        onOpenChange={(open) => !open && openId !== null && dismissDelegationCard(openId)}
      >
        <DialogContent className="max-h-[70vh] w-[720px] max-w-[720px] overflow-y-auto">
          <DialogTitle className="sr-only">Delegation detail</DialogTitle>
          {openId ? <DelegationDetailView delegationId={openId} onClose={() => {}} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
};

/** Live running count for badges (non-hook read of the store snapshot). */
export const countActiveDelegations = (): number => {
  const now = Date.now();
  return getDelegationCards().filter((card) => isRunning(card.delegation, now)).length;
};

/** Hook form: re-renders when the delegation store changes. */
export const useActiveDelegationCount = (): number => {
  const cards = useDelegationCards();
  const now = Date.now();
  return cards.filter((card) => isRunning(card.delegation, now)).length;
};

const isRunning = (
  delegation: Pick<ChatDelegationRun, "status" | "activity" | "startedAt" | "updatedAt">,
  now: number,
): boolean =>
  !["completed", "failed", "cancelled"].includes(deriveDelegationViewStatus(delegation, now));

const TasksSection = ({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) => (
  <section className="flex min-h-0 flex-col gap-0.5">
    <h3 className="flex items-center gap-1.5 px-1 pb-1 pt-2 text-[11.5px] font-semibold text-text-subtle">
      {title}
      {count !== undefined ? <span className="text-text-subtle">· {count}</span> : null}
    </h3>
    {children}
  </section>
);

const TaskRow = ({
  runtime,
  label,
  model,
  startedAt,
  running,
  now,
  onOpen,
}: {
  runtime: string;
  label: string;
  model: string;
  startedAt: string;
  running: boolean;
  now: number;
  onOpen: () => void;
}) => (
  <button
    type="button"
    data-testid="tasks-row"
    data-running={running ? "true" : undefined}
    onClick={onOpen}
    className="flex min-w-0 items-center gap-2 rounded-row px-2 py-1.5 text-left transition-colors duration-[120ms] hover:bg-hover"
  >
    {running ? (
      <Spinner className="size-3.5 shrink-0" />
    ) : (
      <CircleCheckIcon className="size-3.5 shrink-0 text-ok" strokeWidth={1.7} />
    )}
    <RuntimeProviderIcon runtime={runtime} className="size-3.5 shrink-0" />
    <span className="min-w-0 flex-1 truncate text-[12.5px] text-text">
      {label}
      <span className="ml-1.5 text-[11.5px] text-text-subtle">{model}</span>
    </span>
    <span className="flex shrink-0 items-center gap-1 text-[11px] text-text-subtle">
      <ClockIcon className="size-3" />
      {formatDelegationElapsed(startedAt, now)}
    </span>
  </button>
);
