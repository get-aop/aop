import { useMemo, useState } from "react";
import { Button } from "@/ui/button";
import { Dialog, DialogContent } from "@/ui/dialog";
import type { Step, Task } from "../types";

export interface RetryDialogProps {
  open: boolean;
  task: Task | null;
  steps: Step[];
  onSelect: (task: Task, stepId?: string) => void;
  onCancel: () => void;
}

export const RetryDialog = ({ open, task, steps, onSelect, onCancel }: RetryDialogProps) => {
  const [selectedStepId, setSelectedStepId] = useState<string | undefined>(undefined);
  const [prevOpen, setPrevOpen] = useState(false);

  const uniqueSteps = useMemo(
    () =>
      steps.reduce<Step[]>((acc, step) => {
        if (step.stepId && !acc.some((s) => s.stepId === step.stepId)) acc.push(step);
        return acc;
      }, []),
    [steps],
  );

  // Reset selection only when dialog opens (derive-during-render pattern)
  if (open && !prevOpen) {
    setSelectedStepId(uniqueSteps[0]?.stepId ?? undefined);
  }
  if (open !== prevOpen) {
    setPrevOpen(open);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="w-80 max-w-80">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-text">Retry from step</h2>
          <p className="mt-2 text-sm text-text-muted">
            Choose which step to restart the workflow from.
          </p>

          {uniqueSteps.length > 0 ? (
            <div className="mt-4 flex flex-col gap-1">
              {uniqueSteps.map((step) => (
                <button
                  type="button"
                  key={step.stepId}
                  onClick={() => setSelectedStepId(step.stepId)}
                  data-testid={`retry-step-option-${step.stepId}`}
                  className={`focus-ring flex cursor-pointer items-center gap-2 rounded-control px-3 py-2 text-left text-sm transition-colors ${
                    selectedStepId === step.stepId
                      ? "bg-favorite/10 text-favorite"
                      : "text-text-muted hover:bg-raised hover:text-text"
                  }`}
                >
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      selectedStepId === step.stepId ? "bg-favorite/15" : "bg-border-strong"
                    }`}
                  />
                  <span className="font-mono text-[12px] text-text">{step.stepId}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-text-subtle">
              No step history available. The task will restart from the beginning.
            </p>
          )}

          <div className="mt-6 flex justify-end gap-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={onCancel}
              data-testid="retry-dialog-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => task && onSelect(task, selectedStepId)}
              data-testid="retry-dialog-confirm"
            >
              Retry
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
