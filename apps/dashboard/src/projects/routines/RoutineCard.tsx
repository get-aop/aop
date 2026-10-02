import { describeSchedule, type Routine } from "@aop/common";
import {
  ChevronDownIcon,
  CopyIcon,
  EllipsisIcon,
  MessageSquareIcon,
  PencilIcon,
  PlayIcon,
  Trash2Icon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Switch } from "@/ui/switch";
import { IconButton } from "../../components/IconButton";
import { RoutineHistory } from "./RoutineHistory";
import { countdown, formatRunTime, RUN_STATUS_LABEL, RUN_STATUS_TONE } from "./routine-format";

export interface RoutineActions {
  toggle: (routine: Routine, enabled: boolean) => void;
  runNow: (routine: Routine) => void;
  edit: (routine: Routine) => void;
  duplicate: (routine: Routine) => void;
  remove: (routine: Routine) => void;
}

/**
 * One routine: its name, when it runs in plain words, when it runs next (counted down), how its
 * last run went, and its switch. Opening it shows its history.
 */
export const RoutineCard = ({
  routine,
  now,
  timeZone,
  open,
  onToggleOpen,
  canEdit,
  busy,
  actions,
}: {
  routine: Routine;
  now: number;
  timeZone: string | null;
  open: boolean;
  onToggleOpen: () => void;
  /** Only the host owner sets routines up; anyone else sees them read-only. */
  canEdit: boolean;
  /** An action on it is in flight. */
  busy: boolean;
  actions: RoutineActions;
}) => {
  const last = routine.lastRun;
  return (
    <li
      data-testid="routine-card"
      data-routine-id={routine.id}
      data-enabled={routine.enabled}
      className="min-w-0 rounded-lg border border-border bg-raised"
    >
      <div className="flex min-w-0 items-start gap-2 p-3">
        <button
          type="button"
          data-testid="routine-open"
          aria-expanded={open}
          onClick={onToggleOpen}
          className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left"
        >
          <span className="flex min-w-0 max-w-full items-center gap-1.5">
            {routine.target === "coordinator" ? (
              <MessageSquareIcon
                aria-label="Messages the coordinator"
                className="size-3.5 shrink-0 text-text-subtle"
              />
            ) : null}
            <span className="truncate text-title font-medium text-text">{routine.name}</span>
            <ChevronDownIcon
              aria-hidden="true"
              className={cn(
                "size-4 shrink-0 text-text-subtle transition-transform",
                open && "rotate-180",
              )}
            />
          </span>
          <span data-testid="routine-schedule" className="text-meta text-text-muted">
            {describeSchedule(routine.schedule)}
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-meta">
            <NextRun routine={routine} now={now} timeZone={timeZone} />
            {last ? (
              <Badge
                data-testid="routine-last-status"
                data-status={last.status}
                variant={RUN_STATUS_TONE[last.status]}
                title={last.reason ?? undefined}
              >
                {RUN_STATUS_LABEL[last.status]}
              </Badge>
            ) : (
              <span className="text-text-subtle">Not run yet</span>
            )}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <Switch
            data-testid="routine-switch"
            aria-label={routine.enabled ? `Pause ${routine.name}` : `Turn on ${routine.name}`}
            checked={routine.enabled}
            disabled={!canEdit || busy}
            onCheckedChange={(enabled) => actions.toggle(routine, enabled)}
          />
          {canEdit ? <RoutineMenu routine={routine} busy={busy} actions={actions} /> : null}
        </div>
      </div>
      {open ? (
        <RoutineHistory
          projectId={routine.projectId}
          routineId={routine.id}
          timeZone={timeZone}
          version={`${routine.updatedAt}|${last?.id ?? ""}|${last?.status ?? ""}`}
        />
      ) : null}
    </li>
  );
};

const NextRun = ({
  routine,
  now,
  timeZone,
}: {
  routine: Routine;
  now: number;
  timeZone: string | null;
}) => {
  if (!routine.enabled) {
    return (
      <span data-testid="routine-next" className="text-text-subtle">
        Paused
      </span>
    );
  }
  if (!routine.nextRunAt) {
    return (
      <span data-testid="routine-next" className="text-text-subtle">
        No upcoming run
      </span>
    );
  }
  return (
    <span
      data-testid="routine-next"
      className="text-text-muted tabular-nums"
      title={formatRunTime(routine.nextRunAt, timeZone)}
    >
      Next {countdown(routine.nextRunAt, now)}
    </span>
  );
};

const RoutineMenu = ({
  routine,
  busy,
  actions,
}: {
  routine: Routine;
  busy: boolean;
  actions: RoutineActions;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <IconButton testId="routine-menu" label={`Actions for ${routine.name}`}>
        <EllipsisIcon />
      </IconButton>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-44">
      <DropdownMenuItem
        data-testid="routine-run-now"
        disabled={busy}
        onSelect={() => actions.runNow(routine)}
      >
        <PlayIcon /> Run now
      </DropdownMenuItem>
      <DropdownMenuItem data-testid="routine-edit" onSelect={() => actions.edit(routine)}>
        <PencilIcon /> Edit
      </DropdownMenuItem>
      <DropdownMenuItem data-testid="routine-duplicate" onSelect={() => actions.duplicate(routine)}>
        <CopyIcon /> Duplicate
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        data-testid="routine-delete"
        variant="destructive"
        onSelect={() => actions.remove(routine)}
      >
        <Trash2Icon /> Delete
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);
