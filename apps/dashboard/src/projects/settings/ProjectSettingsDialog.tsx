import {
  BrainIcon,
  ChartLineIcon,
  FolderGit2Icon,
  type LucideIcon,
  SettingsIcon,
  XIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/ui/dialog";
import { iconButtonClass } from "../../components/IconButton";
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

const SECTIONS: Record<ProjectSettingsSection, { label: string; icon: LucideIcon }> = {
  general: { label: "General", icon: SettingsIcon },
  memory: { label: "Memory", icon: BrainIcon },
  environment: { label: "Environment", icon: FolderGit2Icon },
  usage: { label: "Usage", icon: ChartLineIcon },
};

/**
 * A project's settings in a dialog over the project screen, which stays mounted underneath so the
 * chat keeps its draft and its place. The address names the section; closing (× or Escape) hands
 * back to `onClose`, which leaves the settings address. Full screen on a phone.
 */
export const ProjectSettingsDialog = ({
  entry,
  section,
  onClose,
}: {
  entry: ProjectEntry;
  section: ProjectSettingsSection;
  onClose: () => void;
}) => {
  const { project } = entry;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        data-testid="project-settings-dialog"
        className={cn(
          "flex max-w-none gap-0 overflow-hidden border-border-strong bg-surface p-0",
          // A sheet over the whole screen on a phone, a centered dialog from md up.
          "max-md:top-0 max-md:left-0 max-md:h-dvh max-md:w-screen max-md:translate-x-0 max-md:translate-y-0 max-md:flex-col max-md:rounded-none max-md:border-0",
          "md:h-[min(760px,calc(100dvh-4rem))] md:w-[min(1100px,calc(100vw-4rem))] md:rounded-modal",
        )}
      >
        <DialogTitle className="sr-only">{project.name} settings</DialogTitle>
        <SectionNav projectId={project.id} section={section} />
        <DialogClose asChild>
          <button
            type="button"
            data-testid="project-settings-close"
            aria-label="Close settings"
            title="Close settings"
            className={iconButtonClass(false, "absolute top-2 right-2 z-20")}
          >
            <XIcon />
          </button>
        </DialogClose>
        <div
          data-testid="project-settings-pane"
          data-section={section}
          className="relative min-h-0 min-w-0 flex-1 overflow-y-auto"
        >
          {/*
           * This column scrolls, so the General form's sticky save bar pins to its bottom. It is
           * `relative` so the hidden native inputs Radix puts beside a select or a switch (absolute)
           * stay inside it: placed against the dialog instead, they overflow it, and focusing a
           * control low in the form scrolls the whole dialog, nav and × with it.
           */}
          <div className="mx-auto w-full max-w-3xl px-6 pt-6 pb-10 md:pt-10">
            <h2
              data-testid="project-settings-title"
              className="mb-5 text-[17px] font-medium text-text"
            >
              {SECTIONS[section].label}
            </h2>
            {section === "general" ? <GeneralSection project={project} /> : null}
            {section === "memory" ? <MemorySection project={project} /> : null}
            {section === "environment" ? <EnvironmentSection entry={entry} /> : null}
            {section === "usage" ? <UsageSection project={project} /> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

/**
 * A column of sections from md up. On a phone it is a row of tabs that stops short of the ×, and
 * only the current tab keeps its name (the others are icons, named in their tooltip), so all four
 * fit without scrolling, like the threads panel's tab strip.
 */
const SectionNav = ({
  projectId,
  section,
}: {
  projectId: string;
  section: ProjectSettingsSection;
}) => (
  <div className="shrink-0 border-b border-border pr-10 md:w-56 md:border-r md:border-b-0 md:pr-0">
    <p className="hidden px-5 pt-5 pb-2 text-[12px] text-text-subtle md:block">Settings</p>
    <nav aria-label="Project settings" className="flex gap-0.5 p-2 md:flex-col md:px-3">
      {PROJECT_SETTINGS_SECTIONS.map((id) => {
        const { label, icon: Icon } = SECTIONS[id];
        const current = id === section;
        return (
          <Link
            key={id}
            to={projectSettingsPath(projectId, id)}
            data-testid={`project-settings-nav-${id}`}
            aria-current={current ? "page" : undefined}
            aria-label={current ? undefined : label}
            title={current ? undefined : label}
            className={cn(
              "flex h-9 shrink-0 items-center gap-2.5 rounded-row px-2.5 text-[14px] transition-colors duration-[120ms]",
              current
                ? "bg-active text-text"
                : "text-text-muted hover:bg-hover hover:text-text max-md:w-9 max-md:justify-center max-md:px-0",
            )}
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            <span
              data-testid="project-settings-nav-label"
              className={cn(!current && "max-md:hidden")}
            >
              {label}
            </span>
          </Link>
        );
      })}
    </nav>
  </div>
);
