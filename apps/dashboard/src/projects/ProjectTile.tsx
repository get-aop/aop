import { cn } from "@/lib/cn";
import { PROJECT_ICONS, type ProjectAppearance, tileColors, tileHue } from "./project-appearance";

/**
 * A project's icon: the one picked in its settings, else its first letter, on the colour picked
 * or one taken from its id. Both are project settings, so it looks the same on every device.
 */
export const ProjectTile = ({
  project,
  className,
}: {
  project: ProjectAppearance;
  className?: string;
}) => {
  const Glyph = project.icon ? PROJECT_ICONS[project.icon].glyph : null;
  return (
    <span
      aria-hidden="true"
      data-testid="project-tile"
      data-icon={project.icon ?? "letter"}
      data-color={project.color ?? "auto"}
      style={tileColors(tileHue(project))}
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-md text-[12px] font-semibold uppercase",
        className,
      )}
    >
      {Glyph ? (
        <Glyph className="size-[62%]" strokeWidth={2} />
      ) : (
        project.name.trim().charAt(0) || "?"
      )}
    </span>
  );
};
