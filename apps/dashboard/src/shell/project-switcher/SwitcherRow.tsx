import { CheckIcon, PauseIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { CommandItem } from "@/ui/command";
import { ProjectTile } from "../../projects/ProjectTile";
import type { ProjectEntry } from "../../projects/projects-state";
import { type Attention, attentionKind, attentionOf } from "../../projects/selectors";

/**
 * A project in the switcher: its icon and name, then what needs attention in it (how many
 * threads wait on the person, else a dot while one works), and a check on the open one.
 */
export const SwitcherRow = ({
  entry,
  current,
  onSelect,
}: {
  entry: ProjectEntry;
  current: boolean;
  onSelect: () => void;
}) => {
  const { project, threads, threadsLoaded } = entry;
  // Until the threads have arrived nothing is known, and "nothing" must not read as "all quiet".
  const attention = threadsLoaded ? attentionOf(threads) : null;
  const kind = attention ? attentionKind(attention) : "none";

  return (
    <CommandItem
      value={project.id}
      data-testid="switcher-project"
      data-project-id={project.id}
      data-attention={kind}
      data-current={current}
      data-status={project.status}
      aria-current={current ? "page" : undefined}
      onSelect={onSelect}
      className={cn(
        "h-8 gap-2 rounded-row text-[13px] text-text-muted data-[selected=true]:text-text",
        current && "text-text",
        project.status === "archived" && "opacity-70",
      )}
    >
      <ProjectTile project={project} className="size-5 text-[11px]" />
      <span
        className={cn("min-w-0 flex-1 truncate", kind === "waiting" && "font-medium text-text")}
      >
        {project.name}
      </span>
      {project.status === "paused" ? (
        <PauseIcon
          data-testid="project-paused"
          aria-label="Paused"
          className="size-3 text-text-subtle"
        />
      ) : null}
      {attention ? <AttentionIndicator attention={attention} /> : null}
      <CheckIcon
        aria-hidden="true"
        data-testid={current ? "switcher-project-check" : undefined}
        className={cn("size-3.5 text-text", !current && "invisible")}
      />
    </CommandItem>
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
