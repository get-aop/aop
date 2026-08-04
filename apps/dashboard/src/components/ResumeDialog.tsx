import { useCallback, useEffect, useState } from "react";
import { Button } from "@/ui/button";
import { Dialog, DialogContent } from "@/ui/dialog";
import { getPauseContext } from "../api/client";

const resumeTextareaClassName =
  "w-full resize-none rounded-card border border-border-strong bg-raised px-3 py-2 font-sans text-sm text-text placeholder:text-text-muted transition-colors focus:border-running focus:outline-none focus:ring-1 focus:ring-running/40 disabled:opacity-50";

const APPROVAL_MESSAGE = "Approved. Proceed with the plan.";

interface ResumeDialogProps {
  open: boolean;
  repoId: string;
  taskId: string;
  onConfirm: (input: string) => Promise<void>;
  onCancel: () => void;
}

export const ResumeDialog = ({ open, repoId, taskId, onConfirm, onCancel }: ResumeDialogProps) => {
  const [pauseContext, setPauseContext] = useState<string | null>(null);
  const [signal, setSignal] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  const isReviewMode = signal !== null && signal !== "REQUIRES_INPUT";

  const loadPauseContext = useCallback(async () => {
    try {
      const result = await getPauseContext(repoId, taskId);
      setPauseContext(result.pauseContext);
      setSignal(result.signal);
    } catch {
      setPauseContext(null);
      setSignal(null);
    }
  }, [repoId, taskId]);

  useEffect(() => {
    if (open) {
      setInput("");
      setLoading(false);
      setShowFeedback(false);
      setPauseContext(null);
      setSignal(null);
      loadPauseContext();
    }
  }, [open, loadPauseContext]);

  const handleConfirm = useCallback(
    async (value: string) => {
      setLoading(true);
      try {
        await onConfirm(value);
      } finally {
        setLoading(false);
      }
    },
    [onConfirm],
  );

  const handleApprove = useCallback(() => handleConfirm(APPROVAL_MESSAGE), [handleConfirm]);

  const handleSubmitFeedback = useCallback(() => {
    if (!input.trim()) return;
    handleConfirm(input.trim());
  }, [input, handleConfirm]);

  const handleResume = useCallback(() => {
    if (!input.trim()) return;
    handleConfirm(input.trim());
  }, [input, handleConfirm]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent data-testid="resume-dialog" className="w-[28rem] max-w-[28rem]">
        <div className="p-6 pb-8">
          <h2 className="font-sans text-lg font-semibold text-text">
            {isReviewMode ? "Review" : "Resume Task"}
          </h2>
          <p className="mt-3 font-sans text-sm leading-6 text-text-muted">
            {isReviewMode
              ? "Approving sends a clear go-ahead to the paused Pi run; requesting changes keeps it waiting."
              : "Your response is sent to the paused Pi run."}
          </p>

          {pauseContext && (
            <div className="mt-3 rounded-card border border-favorite/30 bg-favorite/5 p-3">
              <span className="mb-1 block text-[12px] font-medium text-favorite">
                {isReviewMode ? "Review details" : "Agent needs"}
              </span>
              <div
                className="mt-1.5 whitespace-pre-wrap font-sans text-sm leading-6 text-text"
                data-testid="pause-context"
              >
                {isReviewMode ? pauseContext : parsePauseContext(pauseContext)}
              </div>
            </div>
          )}

          {isReviewMode ? (
            <ReviewModeActions
              loading={loading}
              showFeedback={showFeedback}
              input={input}
              onInputChange={setInput}
              onApprove={handleApprove}
              onRequestChanges={() => setShowFeedback(true)}
              onSubmitFeedback={handleSubmitFeedback}
              onCancel={onCancel}
            />
          ) : (
            <InputModeActions
              loading={loading}
              input={input}
              onInputChange={setInput}
              onResume={handleResume}
              onCancel={onCancel}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

interface ReviewModeActionsProps {
  loading: boolean;
  showFeedback: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onApprove: () => void;
  onRequestChanges: () => void;
  onSubmitFeedback: () => void;
  onCancel: () => void;
}

const ReviewModeActions = ({
  loading,
  showFeedback,
  input,
  onInputChange,
  onApprove,
  onRequestChanges,
  onSubmitFeedback,
  onCancel,
}: ReviewModeActionsProps) => (
  <>
    {showFeedback && (
      <div className="mt-4">
        <span className="mb-1.5 block text-[12px] font-medium text-text-muted">Feedback</span>
        <textarea
          id="resume-input"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          disabled={loading}
          placeholder="Describe the changes you'd like..."
          data-testid="resume-input"
          rows={4}
          className={resumeTextareaClassName}
        />
      </div>
    )}

    <div className="mt-6 flex justify-end gap-3">
      <Button
        variant="secondary"
        size="sm"
        onClick={onCancel}
        disabled={loading}
        data-testid="resume-cancel"
      >
        Cancel
      </Button>
      {showFeedback ? (
        <Button
          variant="default"
          size="sm"
          onClick={onSubmitFeedback}
          disabled={loading || !input.trim()}
          data-testid="submit-feedback"
        >
          {loading ? "Sending..." : "Send Feedback"}
        </Button>
      ) : (
        <>
          <Button
            variant="secondary"
            size="sm"
            onClick={onRequestChanges}
            disabled={loading}
            data-testid="request-changes"
          >
            Request Changes
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={onApprove}
            disabled={loading}
            data-testid="approve"
          >
            {loading ? "Approving..." : "Approve"}
          </Button>
        </>
      )}
    </div>
  </>
);

interface InputModeActionsProps {
  loading: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onResume: () => void;
  onCancel: () => void;
}

const InputModeActions = ({
  loading,
  input,
  onInputChange,
  onResume,
  onCancel,
}: InputModeActionsProps) => (
  <>
    <div className="mt-4">
      <span className="mb-1.5 block text-[12px] font-medium text-text-muted">Your input</span>
      <textarea
        id="resume-input"
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        disabled={loading}
        placeholder="Provide the information the agent needs..."
        data-testid="resume-input"
        rows={4}
        className={resumeTextareaClassName}
      />
    </div>

    <div className="mt-6 flex justify-end gap-3">
      <Button
        variant="secondary"
        size="sm"
        onClick={onCancel}
        disabled={loading}
        data-testid="resume-cancel"
      >
        Cancel
      </Button>
      <Button
        variant="default"
        size="sm"
        onClick={onResume}
        disabled={loading || !input.trim()}
        data-testid="resume-confirm"
      >
        {loading ? "Resuming..." : "Resume"}
      </Button>
    </div>
  </>
);

const parsePauseContext = (context: string): string => {
  return context.replace(/^INPUT_REASON:\s*/m, "Reason: ").replace(/^INPUT_TYPE:\s*/m, "Type: ");
};
