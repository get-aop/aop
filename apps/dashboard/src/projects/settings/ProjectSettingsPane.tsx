import { cn } from "@/lib/cn";
import {
  Link,
  PROJECT_SETTINGS_SECTIONS,
  type ProjectSettingsSection,
  projectSettingsPath,
} from "../../shell/router";
import type { ProjectEntry } from "../projects-state";
import { EnvironmentSection } from "./EnvironmentSection";
import { GeneralSection } from "./GeneralSection";
import { MemorySection } from "./MemorySection";
import { UsageSection } from "./UsageSection";

const SECTION_LABELS: Record<ProjectSettingsSection, string> = {
  general: "General",
  memory: "Memory",
  environment: "Environment",
  usage: "Usage",
};

/** A project's settings: General, Memory (instructions and notes), Environment (repositories) and Usage. */
export const ProjectSettingsPane = ({
  entry,
  section,
}: {
  entry: ProjectEntry;
  section: ProjectSettingsSection;
}) => {
  const { project } = entry;

  return (
    <div
      data-testid="project-settings-pane"
      data-section={section}
      className="flex flex-1 flex-col md:flex-row"
    >
      <div className="shrink-0 border-b border-border md:w-48 md:border-r md:border-b-0">
        <nav
          aria-label="Project settings"
          className="flex gap-0.5 p-3 md:sticky md:top-0 md:flex-col"
        >
          {PROJECT_SETTINGS_SECTIONS.map((id) => (
            <Link
              key={id}
              to={projectSettingsPath(project.id, id)}
              data-testid={`project-settings-nav-${id}`}
              aria-current={id === section ? "page" : undefined}
              className={cn(
                "flex h-8 items-center rounded-row px-2.5 text-[13px] font-medium transition-colors duration-[120ms]",
                id === section
                  ? "bg-active text-text"
                  : "text-text-muted hover:bg-hover hover:text-text",
              )}
            >
              {SECTION_LABELS[id]}
            </Link>
          ))}
        </nav>
      </div>
      {/* The page (the project's <main>) scrolls, so the sticky save bar pins to it. */}
      <div className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-3xl px-6 py-6">
          {section === "general" ? <GeneralSection project={project} /> : null}
          {section === "memory" ? <MemorySection project={project} /> : null}
          {section === "environment" ? <EnvironmentSection entry={entry} /> : null}
          {section === "usage" ? <UsageSection project={project} /> : null}
        </div>
      </div>
    </div>
  );
};
