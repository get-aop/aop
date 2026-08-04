import { useState } from "react";
import { ConfirmDialog } from "@/ui/confirm-dialog";
import {
  ApiError,
  blockTask,
  markReady,
  removeTask,
  resetTaskExecution,
  resumeTask,
} from "../api/client";
import { ResumeDialog } from "../components/ResumeDialog";
import { RetryDialog } from "../components/RetryDialog";
import type { Step, Task } from "../types";

const finalizeTaskReadyAction = async (task: Task): Promise<{ message: string }> => {
  await markReady(task.repoId, task.id);
  return { message: "Task marked ready" };
};

/**
 * Owns every task-lifecycle dialog's open/pending state plus the API calls and
 * toast feedback that back them. The detail view drives all destructive and
 * lifecycle actions through this one hook.
 */
export const useDialogs = (task: Task | undefined, onClose: () => void) => {
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [showBlockDialog, setShowBlockDialog] = useState(false);
  const [showResumeDialog, setShowResumeDialog] = useState(false);
  const [showRetryDialog, setShowRetryDialog] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const [isMarkingReady, setIsMarkingReady] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastType, setToastType] = useState<"error" | "success">("error");

  const showToast = (message: string, type: "error" | "success" = "error") => {
    setToastType(type);
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleMarkReady = async () => {
    if (!task?.assignedAgentId) return;
    setIsMarkingReady(true);
    try {
      const result = await finalizeTaskReadyAction(task);
      showToast(result.message, "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to mark task as ready");
    } finally {
      setIsMarkingReady(false);
    }
  };

  const handleRemove = async () => {
    if (!task) return;
    setIsRemoving(true);
    try {
      await removeTask(task.repoId, task.id, task.status === "WORKING");
      onClose();
    } finally {
      setIsRemoving(false);
      setShowRemoveDialog(false);
    }
  };

  const handleReset = async () => {
    if (!task) return;
    setIsResetting(true);
    try {
      const result = await resetTaskExecution(task.repoId, task.id);
      showToast(
        result.aborted ? "Task reset to draft (run aborted)" : "Task reset to draft",
        "success",
      );
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to reset task");
    } finally {
      setIsResetting(false);
    }
  };

  const handleBlock = async () => {
    if (!task) return;
    setIsBlocking(true);
    try {
      await blockTask(task.repoId, task.id);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to block task");
    } finally {
      setIsBlocking(false);
      setShowBlockDialog(false);
    }
  };

  const handleRetryConfirm = async (_task: Task, stepId?: string) => {
    if (!task) return;
    try {
      await markReady(task.repoId, task.id, stepId);
      setShowRetryDialog(false);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to retry task");
      setShowRetryDialog(false);
    }
  };

  const handleResumeConfirm = async (input: string) => {
    if (!task) return;
    try {
      await resumeTask(task.repoId, task.id, input);
      setShowResumeDialog(false);
      showToast("Task resumed", "success");
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : "Failed to resume task");
      setShowResumeDialog(false);
    }
  };

  return {
    showRemoveDialog,
    setShowRemoveDialog,
    showBlockDialog,
    setShowBlockDialog,
    showResumeDialog,
    setShowResumeDialog,
    showRetryDialog,
    setShowRetryDialog,
    isRemoving,
    isBlocking,
    isMarkingReady,
    isResetting,
    toastMessage,
    toastType,
    showToast,
    handleMarkReady,
    handleRetryConfirm,
    handleRemove,
    handleReset,
    handleBlock,
    handleResumeConfirm,
  };
};

export type DialogState = ReturnType<typeof useDialogs>;

export const TaskDetailDialogs = ({
  task,
  dialogs,
  steps,
}: {
  task: Task;
  dialogs: DialogState;
  steps: Step[];
}) => {
  const changeName = task.changePath?.split("/").pop() ?? task.changePath ?? "";

  return (
    <>
      <RetryTaskDialog task={task} dialogs={dialogs} steps={steps} />
      <ResumeTaskDialog task={task} dialogs={dialogs} />
      <RemoveTaskDialog task={task} dialogs={dialogs} changeName={changeName} />
      <BlockTaskDialog dialogs={dialogs} changeName={changeName} />
      <TaskToast dialogs={dialogs} />
    </>
  );
};

const RetryTaskDialog = ({
  task,
  dialogs,
  steps,
}: {
  task: Task;
  dialogs: DialogState;
  steps: Step[];
}) => {
  if (!dialogs.showRetryDialog) return null;

  return (
    <RetryDialog
      open={dialogs.showRetryDialog}
      task={task}
      steps={steps}
      onSelect={dialogs.handleRetryConfirm}
      onCancel={() => dialogs.setShowRetryDialog(false)}
    />
  );
};

const ResumeTaskDialog = ({ task, dialogs }: { task: Task; dialogs: DialogState }) => {
  if (!dialogs.showResumeDialog) return null;

  return (
    <ResumeDialog
      open={dialogs.showResumeDialog}
      repoId={task.repoId}
      taskId={task.id}
      onConfirm={dialogs.handleResumeConfirm}
      onCancel={() => dialogs.setShowResumeDialog(false)}
    />
  );
};

const formatRemoveTaskMessage = (task: Task, changeName: string): string => {
  const parts = [
    `Are you sure you want to remove "${changeName}"?`,
    "This permanently deletes task docs from AOP storage and removes any associated worktree.",
  ];
  if (task.status === "WORKING") {
    parts.push("This will abort the running execution.");
  }
  return parts.join(" ");
};

const RemoveTaskDialog = ({
  task,
  dialogs,
  changeName,
}: {
  task: Task;
  dialogs: DialogState;
  changeName: string;
}) => {
  if (!dialogs.showRemoveDialog) return null;

  return (
    <ConfirmDialog
      open={dialogs.showRemoveDialog}
      title="Remove Task"
      message={formatRemoveTaskMessage(task, changeName)}
      confirmLabel={dialogs.isRemoving ? "Removing..." : "Remove"}
      destructive
      onConfirm={dialogs.handleRemove}
      onCancel={() => dialogs.setShowRemoveDialog(false)}
    />
  );
};

const BlockTaskDialog = ({ dialogs, changeName }: { dialogs: DialogState; changeName: string }) => {
  if (!dialogs.showBlockDialog) return null;

  return (
    <ConfirmDialog
      open={dialogs.showBlockDialog}
      title="Block Task"
      message={`Are you sure you want to block "${changeName}"? This will stop all running agents. You can resume the task later with "Mark Ready".`}
      confirmLabel={dialogs.isBlocking ? "Blocking..." : "Block"}
      destructive
      onConfirm={dialogs.handleBlock}
      onCancel={() => dialogs.setShowBlockDialog(false)}
    />
  );
};

const TaskToast = ({ dialogs }: { dialogs: DialogState }) => {
  if (!dialogs.toastMessage) return null;

  return (
    <div
      className={`fixed bottom-4 right-4 rounded-card px-4 py-3 font-sans text-sm font-medium shadow-2 ${
        dialogs.toastType === "success" ? "bg-ok/10 text-ok" : "bg-blocked/10 text-blocked"
      }`}
    >
      {dialogs.toastMessage}
    </div>
  );
};
