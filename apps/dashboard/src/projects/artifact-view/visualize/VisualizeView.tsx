import { CheckIcon, CircleIcon, RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { ArtifactBreadcrumb } from "../ArtifactBreadcrumb";
import { replaceArtifactView } from "../open-artifact-view";
import { forgetArtifact } from "../use-artifact";
import type { VisualizeJob, VisualizePhase } from "./visualize-job";
import { PHASES } from "./visualize-labels";
import { startVisualize, useVisualizeJob } from "./visualize-store";

/**
 * A reply's diagram being made: the steps of the run as they happen, then the diagram itself,
 * which replaces this view. A reply visualized before opens its diagram at once.
 */
export const VisualizeView = ({
  projectId,
  messageId,
}: {
  projectId: string;
  messageId: string;
}) => {
  const job = useVisualizeJob(messageId);
  const atMount = useRef(job);
  useEffect(() => {
    if (atMount.current?.status !== "running") startVisualize(projectId, messageId);
  }, [projectId, messageId]);
  useEffect(() => {
    if (job?.status !== "done" || job === atMount.current) return;
    forgetArtifact(job.artifact.id);
    replaceArtifactView(projectId, {
      kind: "artifact",
      id: job.artifact.id,
      version: job.artifact.currentVersion,
    });
  }, [job, projectId]);

  return (
    <>
      <ArtifactBreadcrumb current="Visualize" />
      <div
        data-testid="visualize-progress"
        className="flex flex-1 flex-col items-center px-6 py-12"
      >
        <div className="w-full max-w-md rounded-card border border-border bg-surface p-5">
          <h2 className="text-title font-medium text-text">Making a diagram of this reply</h2>
          <p className="mt-1 text-meta text-text-subtle">
            A short, separate run on Claude Haiku with only the reply's text. It does not join the
            conversation.
          </p>
          {job?.status === "failed" ? (
            <FailedRun
              error={job.error}
              onRetry={() => startVisualize(projectId, messageId, job.type, true)}
            />
          ) : (
            <Steps job={job} />
          )}
        </div>
      </div>
    </>
  );
};

const Steps = ({ job }: { job: VisualizeJob | undefined }) => {
  const current = job?.status === "running" ? job.phase : job?.status === "done" ? null : "cache";
  const reached = PHASES.findIndex((entry) => entry.phase === current);
  return (
    <ol className="mt-4 flex flex-col gap-2">
      {PHASES.filter(({ phase }) => phase !== "repairing" || current === "repairing").map(
        ({ phase, label }) => {
          const index = PHASES.findIndex((entry) => entry.phase === phase);
          const state =
            current === null || index < reached ? "done" : index === reached ? "active" : "waiting";
          return <Step key={phase} phase={phase} label={label} state={state} />;
        },
      )}
    </ol>
  );
};

const Step = ({
  phase,
  label,
  state,
}: {
  phase: VisualizePhase;
  label: string;
  state: "done" | "active" | "waiting";
}) => (
  <li
    data-testid="visualize-step"
    data-phase={phase}
    data-state={state}
    className={cn(
      "flex items-center gap-2 text-meta",
      state === "waiting" ? "text-text-subtle" : "text-text",
    )}
  >
    {state === "done" ? (
      <CheckIcon aria-hidden="true" className="size-3.5 text-ok" />
    ) : state === "active" ? (
      <Spinner className="size-3.5" />
    ) : (
      <CircleIcon aria-hidden="true" className="size-3.5" />
    )}
    {label}
  </li>
);

const FailedRun = ({ error, onRetry }: { error: string; onRetry: () => void }) => (
  <div data-testid="visualize-failed" className="mt-4 flex flex-col items-start gap-3">
    <p className="flex items-center gap-1.5 text-meta text-blocked">
      <TriangleAlertIcon aria-hidden="true" className="size-3.5" />
      {error}
    </p>
    <Button size="sm" variant="secondary" onClick={onRetry} data-testid="visualize-retry">
      <RotateCcwIcon /> Try again
    </Button>
  </div>
);
