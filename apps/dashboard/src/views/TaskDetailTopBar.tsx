import { ArrowLeftIcon, CirclePlayIcon, SendIcon } from "lucide-react";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import type { Task } from "../types";
import { statusMeta, type TaskStatusMeta } from "./task-status-meta";

const formatTimestamp = (timestamp: string): string => {
  const date = new Date(timestamp);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

const resolvePrimaryLabel = ({
  isMarkingReady,
  isSubmittingCorrections,
  pendingNoteCount,
  status,
}: {
  isMarkingReady: boolean;
  isSubmittingCorrections: boolean;
  pendingNoteCount: number;
  status: Task["status"];
}): string => {
  if (pendingNoteCount > 0) return isSubmittingCorrections ? "Submitting..." : "Submit corrections";
  if (status === "PAUSED") return "Resume";
  if (status === "BLOCKED") return "Retry";
  return isMarkingReady ? "Starting..." : "Continue";
};

const hasPrimaryAction = (task: Task): boolean =>
  task.status === "DRAFT" || task.status === "BLOCKED" || task.status === "PAUSED";

export interface TaskTopBarProps {
  task: Task;
  changeName: string;
  isMarkingReady: boolean;
  isSubmittingCorrections: boolean;
  pendingReviewNoteCount: number;
  isResetting: boolean;
  onBack: () => void;
  onMarkReady: () => void;
  onSubmitCorrections: () => void;
  onRetry: () => void;
  onResume: () => void;
  onReset: () => void;
  onShowBlockDialog: () => void;
  onShowRemoveDialog: () => void;
}

/**
 * Task detail header (PLAN §6.6): ghost “← Sessions”, title, status badge,
 * mono updated-meta, primary action (white fill), ⋯ DropdownMenu.
 */
export const TaskDetailTopBar = ({
  task,
  changeName,
  isMarkingReady,
  isSubmittingCorrections,
  pendingReviewNoteCount,
  isResetting,
  onBack,
  onMarkReady,
  onSubmitCorrections,
  onRetry,
  onResume,
  onReset,
  onShowBlockDialog,
  onShowRemoveDialog,
}: TaskTopBarProps) => {
  const meta = statusMeta(task.status);

  return (
    <header
      data-testid="task-top-bar"
      className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-3"
    >
      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={onBack}
        data-testid="task-back-button"
        className="gap-1.5 px-2"
      >
        <ArrowLeftIcon className="size-3.5" strokeWidth={1.7} />
        Sessions
      </Button>
      <span aria-hidden className="text-border-strong">
        /
      </span>
      <h1 className="m-0 truncate font-sans text-[16px] font-semibold text-text">{changeName}</h1>
      <StatusPill meta={meta} />

      <div className="ml-auto flex shrink-0 items-center gap-2.5">
        <span className="font-mono text-[12px] font-medium text-text-subtle">
          Updated {formatTimestamp(task.updatedAt)}
        </span>
        <PrimaryAction
          task={task}
          isMarkingReady={isMarkingReady}
          isSubmittingCorrections={isSubmittingCorrections}
          pendingReviewNoteCount={pendingReviewNoteCount}
          onMarkReady={onMarkReady}
          onSubmitCorrections={onSubmitCorrections}
          onRetry={onRetry}
          onResume={onResume}
        />
        <RiskyActionsMenu
          task={task}
          isResetting={isResetting}
          onReset={onReset}
          onShowBlockDialog={onShowBlockDialog}
          onShowRemoveDialog={onShowRemoveDialog}
        />
      </div>
    </header>
  );
};

const StatusPill = ({ meta }: { meta: TaskStatusMeta }) => (
  <Badge
    variant={meta.variant}
    data-testid="task-status-badge"
    className="gap-1.5 rounded-row px-2.5 py-1 font-mono text-[11px] font-semibold"
  >
    <span className="size-1.5 rounded-full bg-current" />
    {meta.tag}
  </Badge>
);

const PrimaryAction = ({
  task,
  isMarkingReady,
  isSubmittingCorrections,
  pendingReviewNoteCount,
  onMarkReady,
  onSubmitCorrections,
  onRetry,
  onResume,
}: Pick<
  TaskTopBarProps,
  | "task"
  | "isMarkingReady"
  | "isSubmittingCorrections"
  | "pendingReviewNoteCount"
  | "onMarkReady"
  | "onSubmitCorrections"
  | "onRetry"
  | "onResume"
>) => {
  if (!hasPrimaryAction(task)) return null;

  const hasPendingCorrections = pendingReviewNoteCount > 0;
  const disabled =
    !task.assignedAgentId || (hasPendingCorrections ? isSubmittingCorrections : isMarkingReady);
  const label = resolvePrimaryLabel({
    isMarkingReady,
    isSubmittingCorrections,
    pendingNoteCount: pendingReviewNoteCount,
    status: task.status,
  });
  const onClick = resolvePrimaryHandler({
    status: task.status,
    hasPendingCorrections,
    onMarkReady,
    onSubmitCorrections,
    onRetry,
    onResume,
  });

  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled && !task.assignedAgentId ? "Assign a worker first" : undefined}
      data-testid="mark-ready-button"
      data-action-state={hasPendingCorrections ? "submit-corrections" : "continue"}
      className="gap-1.5 rounded-[10px] px-4 py-2 text-[13px] font-semibold"
    >
      {hasPendingCorrections ? (
        <SendIcon className="size-3.5" strokeWidth={1.7} />
      ) : (
        <CirclePlayIcon className="size-3.5" strokeWidth={1.7} />
      )}
      {label}
    </Button>
  );
};

const resolvePrimaryHandler = ({
  status,
  hasPendingCorrections,
  onMarkReady,
  onSubmitCorrections,
  onRetry,
  onResume,
}: {
  status: Task["status"];
  hasPendingCorrections: boolean;
  onMarkReady: () => void;
  onSubmitCorrections: () => void;
  onRetry: () => void;
  onResume: () => void;
}): (() => void) => {
  if (hasPendingCorrections) return onSubmitCorrections;
  if (status === "PAUSED") return onResume;
  if (status === "BLOCKED") return onRetry;
  return onMarkReady;
};

const RiskyActionsMenu = ({
  task,
  isResetting,
  onReset,
  onShowBlockDialog,
  onShowRemoveDialog,
}: Pick<
  TaskTopBarProps,
  "task" | "isResetting" | "onReset" | "onShowBlockDialog" | "onShowRemoveDialog"
>) => {
  const canReset = task.status !== "DONE" && task.status !== "REMOVED";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Task actions"
          data-testid="task-actions-menu-button"
          className="rounded-[10px]"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="19" cy="12" r="1.6" />
          </svg>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {canReset ? (
          <DropdownMenuItem
            disabled={isResetting}
            onSelect={onReset}
            data-testid="reset-task-button"
          >
            {isResetting ? "Resetting..." : "Reset to draft"}
          </DropdownMenuItem>
        ) : null}
        {task.status === "WORKING" ? (
          <DropdownMenuItem
            variant="destructive"
            onSelect={onShowBlockDialog}
            data-testid="block-task-button"
          >
            Block
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          variant="destructive"
          onSelect={onShowRemoveDialog}
          data-testid="remove-task-button"
        >
          Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
