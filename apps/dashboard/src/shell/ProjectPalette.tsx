import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/ui/command";
import { useProjectsState } from "../projects/ProjectsProvider";
import { ProjectTile } from "../projects/ProjectTile";
import { navigate, projectPath } from "./router";

/** ⌘K: jump to a project by name. */
export const ProjectPalette = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const { byId } = useProjectsState();
  const projects = Object.values(byId)
    .map(({ project }) => project)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Find a project">
      <CommandInput placeholder="Find a project" />
      <CommandList>
        <CommandEmpty>No projects found</CommandEmpty>
        <CommandGroup heading="Projects">
          {projects.map((project) => (
            <CommandItem
              key={project.id}
              value={`${project.name} ${project.id}`}
              data-testid="palette-project"
              onSelect={() => {
                onOpenChange(false);
                navigate(projectPath(project.id));
              }}
            >
              <ProjectTile project={project} className="size-5 text-[11px]" />
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              {project.status !== "active" ? (
                <span className="text-[11px] capitalize text-text-subtle">{project.status}</span>
              ) : null}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};
