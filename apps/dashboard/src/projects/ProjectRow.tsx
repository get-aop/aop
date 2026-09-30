import { EllipsisIcon, PauseIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Link, projectPath } from "../shell/router";
import { ProjectMenu } from "./ProjectMenu";
import { ProjectTile } from "./ProjectTile";
import type { ProjectEntry } from "./projects-state";
import { type Attention, attentionKind, attentionOf } from "./selectors";

/** A project in the sidebar: its icon and name, what needs attention, and its menu. */
export const ProjectRow = ({ entry, active }: { entry: ProjectEntry; active: boolean }) => {
  const { project, threads, threadsLoaded } = entry;
  // Until the threads have arrived nothing is known, and "nothing" must not read as "all quiet".
  const attention = threadsLoaded ? attentionOf(threads) : null;
  const kind = attention ? attentionKind(attention) : "none";

  return (
    <div
      data-testid="project-row"
      data-project-id={project.id}
      data-attention={kind}
      data-active={active}
      data-status={project.status}
      className={cn(
        // Named group: the sidebar wrapper is itself a `group`, so a bare group-hover
        // would reveal every row's menu at once.
        "group/row relative flex h-8 items-center gap-2 rounded-row px-1.5 text-[13px]",
        active ? "bg-active text-text" : "text-text-muted hover:bg-hover hover:text-text",
        project.status === "archived" && "opacity-70",
      )}
    >
      <Link
        to={projectPath(project.id)}
        aria-current={active ? "page" : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none"
      >
        <ProjectTile project={project} className="size-5 text-[11px]" />
        <span
          className={cn("min-w-0 flex-1 truncate", kind === "waiting" && "font-medium text-text")}
        >
          {project.name}
        </span>
      </Link>
      {project.status === "paused" ? (
        <PauseIcon
          data-testid="project-paused"
          aria-label="Paused"
          className="size-3 shrink-0 text-text-subtle"
        />
      ) : null}
      {attention ? <AttentionIndicator attention={attention} /> : null}
      {/* In flow, and mounted while its menu is open: hiding it on pointer-out would
          collapse the trigger to nothing and the open menu would jump to the corner. */}
      <span className="hidden shrink-0 group-hover/row:flex has-[[data-state=open]]:flex">
        <ProjectMenu project={project}>
          <button
            type="button"
            data-testid="project-row-menu"
            aria-label={`Actions for ${project.name}`}
            className="grid size-6 place-items-center rounded text-text-subtle hover:bg-active hover:text-text"
          >
            <EllipsisIcon className="size-3.5" />
          </button>
        </ProjectMenu>
      </span>
    </div>
  );
};

const AttentionIndicator = ({ attention }: { attention: Attention }) => {
  if (attention.waiting > 0) {
    return (
      <span
        data-testid="project-attention-waiting"
        title={`${attention.waiting} waiting on you`}
        className="grid h-4 min-w-4 shrink-0 place-items-center rounded-md bg-waiting/15 px-1 text-[11px] font-semibold tabular-nums text-waiting"
      >
        {attention.waiting}
      </span>
    );
  }
  if (attention.working > 0) {
    return (
      <span
        data-testid="project-attention-working"
        title={`${attention.working} working`}
        className="aop-running-dot size-1.5 shrink-0 rounded-full bg-running motion-safe:animate-[aop-pulse_2s_ease-in-out_infinite]"
      />
    );
  }
  return null;
};
