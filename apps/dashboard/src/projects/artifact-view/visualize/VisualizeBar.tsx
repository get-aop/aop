import { VISUALIZE_TYPES } from "@aop/common";
import { ChevronDownIcon, InfoIcon, RefreshCwIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Spinner } from "@/ui/spinner";
import { replaceArtifactView } from "../open-artifact-view";
import { forgetArtifact, type ShownArtifact } from "../use-artifact";
import type { VisualizeJob } from "./visualize-job";
import { formatCost, PHASES, TYPE_LABELS, visualizeTypeOf } from "./visualize-labels";
import { startVisualize, useVisualizeJob } from "./visualize-store";

const OUTLINE_NOTE = "Outline (no valid diagram)";

/**
 * Over a diagram Visualize made: draw it again, or as another type. Each new drawing is a new
 * version, so the earlier ones stay in the version menu; while one is being drawn, the bar says
 * where it is, and the view moves to it when it is saved.
 */
export const VisualizeBar = ({
  projectId,
  messageId,
  shown,
}: {
  projectId: string;
  messageId: string;
  shown: ShownArtifact;
}) => {
  const job = useVisualizeJob(messageId);
  const atMount = useRef(job);
  useEffect(() => {
    if (job?.status !== "done" || job === atMount.current || job.cached) return;
    forgetArtifact(job.artifact.id);
    replaceArtifactView(projectId, {
      kind: "artifact",
      id: job.artifact.id,
      version: job.artifact.currentVersion,
    });
  }, [job, projectId]);
  const type = visualizeTypeOf(shown.detail.originType);
  const running = job?.status === "running";
  const draw = (next = type) => startVisualize(projectId, messageId, next, true);
  const note = shown.detail.versions.find((entry) => entry.version === shown.version)?.note ?? null;
  return (
    <div
      data-testid="visualize-bar"
      className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface/60 px-3 py-1.5 text-meta"
    >
      <BarStatus job={job} note={note} />
      {job?.status === "failed" ? <span className="text-blocked">{job.error}</span> : null}
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          data-testid="visualize-regenerate"
          disabled={running}
          onClick={() => draw()}
          className="flex h-7 items-center gap-1.5 rounded-row px-2 text-text-muted hover:bg-hover hover:text-text disabled:opacity-40"
        >
          <RefreshCwIcon aria-hidden="true" className="size-3.5" />
          Regenerate
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="visualize-type-menu"
              disabled={running}
              className="flex h-7 items-center gap-1 rounded-row px-2 text-text-muted hover:bg-hover hover:text-text disabled:opacity-40"
            >
              Different type
              <ChevronDownIcon aria-hidden="true" className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>Draw it as</DropdownMenuLabel>
            {VISUALIZE_TYPES.map((option) => (
              <DropdownMenuItem
                key={option}
                data-testid="visualize-type"
                data-type={option}
                onSelect={() => draw(option)}
              >
                {TYPE_LABELS[option]}
                {option === type ? <span className="ml-auto text-text-subtle">current</span> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
};

/** Where a new drawing is, else what the version shown is (an outline when no diagram parsed). */
const BarStatus = ({ job, note }: { job: VisualizeJob | undefined; note: string | null }) => {
  if (job?.status === "running") {
    return (
      <span
        data-testid="visualize-bar-progress"
        className="flex items-center gap-1.5 text-text-muted"
      >
        <Spinner className="size-3.5" />
        {PHASES.find((entry) => entry.phase === job.phase)?.label}…
      </span>
    );
  }
  if (note === OUTLINE_NOTE) {
    return (
      <span data-testid="visualize-fallback" className="flex items-center gap-1.5 text-text-subtle">
        <InfoIcon aria-hidden="true" className="size-3.5 text-waiting" />
        No valid diagram came back, so this is an outline of the reply.
      </span>
    );
  }
  const cost = job?.status === "done" && !job.cached ? ` · ${formatCost(job.costUsd)}` : "";
  return (
    <span data-testid="visualize-bar-status" className="text-text-subtle">
      Made with Visualize{note ? ` · ${note}` : ""}
      {cost}
    </span>
  );
};
