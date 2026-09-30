import type { Project } from "@aop/common";
import { cn } from "@/lib/cn";

// Eight muted hues, so neighbouring projects tell apart without any colour shouting.
const HUES = [212, 152, 32, 282, 348, 178, 62, 246];

const hueOf = (projectId: string): number => {
  let hash = 0;
  for (const char of projectId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return HUES[hash % HUES.length] ?? 212;
};

/**
 * A project's icon: its first letter on a hue taken from its id, so the same project looks
 * the same on every device. Picking an icon and colour is a project setting, added with settings.
 */
export const ProjectTile = ({
  project,
  className,
}: {
  project: Pick<Project, "id" | "name">;
  className?: string;
}) => {
  const hue = hueOf(project.id);
  return (
    <span
      aria-hidden="true"
      data-testid="project-tile"
      style={{ background: `hsl(${hue} 32% 24%)`, color: `hsl(${hue} 62% 84%)` }}
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-md text-[12px] font-semibold uppercase",
        className,
      )}
    >
      {project.name.trim().charAt(0) || "?"}
    </span>
  );
};
