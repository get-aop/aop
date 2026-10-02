import type { IssueLabel, IssuePerson, IssueStage } from "@aop/common";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleIcon,
  CircleSlashIcon,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";

/*
 * The small pieces an issue row is made of: the state marker, label badges and avatars.
 */

const STAGE_ICON: Record<IssueStage, { icon: LucideIcon; tone: string }> = {
  triage: { icon: CircleDashedIcon, tone: "text-waiting" },
  backlog: { icon: CircleDashedIcon, tone: "text-text-subtle" },
  unstarted: { icon: CircleDotIcon, tone: "text-ok" },
  started: { icon: CircleIcon, tone: "text-favorite" },
  completed: { icon: CircleCheckIcon, tone: "text-merged" },
  canceled: { icon: CircleSlashIcon, tone: "text-text-subtle" },
};

/**
 * Where an issue stands, as an icon: open is green, done purple, not planned grey, the way
 * GitHub draws them. A Linear state draws in its own workflow colour.
 */
export const StageIcon = ({
  stage,
  color,
  className,
}: {
  stage: IssueStage;
  color?: string | null;
  className?: string;
}) => {
  const { icon: Icon, tone } = STAGE_ICON[stage];
  return (
    <Icon
      aria-hidden="true"
      data-stage={stage}
      style={color ? { color: `#${color}` } : undefined}
      className={cn("size-3.5 shrink-0", !color && tone, className)}
    />
  );
};

/** A label as GitHub and Linear draw it: a dot of its colour beside its name, on a quiet chip. */
export const LabelBadge = ({ label, className }: { label: IssueLabel; className?: string }) => (
  <span
    data-testid="issue-label"
    className={cn(
      "inline-flex h-5 max-w-40 shrink-0 items-center gap-1.5 rounded-md border border-border-strong bg-raised px-1.5 text-[11.5px] leading-none text-text-muted",
      className,
    )}
  >
    <span
      aria-hidden="true"
      className="size-2 shrink-0 rounded-full"
      style={{ backgroundColor: label.color ? `#${label.color}` : "var(--color-queued)" }}
    />
    <span className="truncate">{label.name}</span>
  </span>
);

/** A person's picture, or their first letter when it has none or does not load. */
export const Avatar = ({
  person,
  size = "size-5",
  className,
}: {
  person: Pick<IssuePerson, "login" | "avatarUrl">;
  size?: string;
  className?: string;
}) => {
  const [failed, setFailed] = useState(false);
  const shared = cn("shrink-0 rounded-full ring-1 ring-border-strong", size, className);
  if (person.avatarUrl && !failed) {
    return (
      <img
        src={person.avatarUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cn(shared, "bg-raised object-cover")}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        shared,
        "grid place-items-center bg-active text-[10px] font-semibold uppercase text-text-muted",
      )}
    >
      {person.login.slice(0, 1)}
    </span>
  );
};

/** Up to three overlapping avatars, then "+n". */
export const AvatarStack = ({ people }: { people: readonly IssuePerson[] }) => {
  if (people.length === 0) return null;
  const shown = people.slice(0, 3);
  const names = people.map((person) => person.login).join(", ");
  return (
    <span
      data-testid="issue-assignees"
      title={`Assigned to ${names}`}
      aria-label={`Assigned to ${names}`}
      role="img"
      className="flex shrink-0 items-center -space-x-1.5"
    >
      {shown.map((person) => (
        <Avatar key={person.login} person={person} className="ring-2 ring-surface" />
      ))}
      {people.length > shown.length ? (
        <span className="pl-2.5 text-[11px] text-text-subtle">+{people.length - shown.length}</span>
      ) : null}
    </span>
  );
};
