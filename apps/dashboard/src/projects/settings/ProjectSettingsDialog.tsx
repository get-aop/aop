import { XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/ui/dialog";
import { iconButtonClass } from "../../components/IconButton";
import type { ProjectSettingsSection } from "../../shell/router";
import type { ProjectEntry } from "../projects-state";
import { AdvancedSection } from "./AdvancedSection";
import { ComputerUseSetting } from "./ComputerUseSetting";
import { EnvironmentSection } from "./EnvironmentSection";
import { GeneralSection } from "./GeneralSection";
import { IssueSourcesSection } from "./IssueSourcesSection";
import { MemorySection } from "./MemorySection";
import { ModelsSection } from "./ModelsSection";
import { NotificationsSection } from "./NotificationsSection";
import { ProjectSettingsNav, SECTIONS } from "./ProjectSettingsNav";
import { ThreadsSection } from "./ThreadsSection";
import { UsageSection } from "./UsageSection";

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
        <ProjectSettingsNav projectId={project.id} section={section} />
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
          // A section starts at its top, and its own edits are sent before the next one shows.
          key={section}
          data-testid="project-settings-pane"
          data-section={section}
          className="relative min-h-0 min-w-0 flex-1 overflow-y-auto"
        >
          {/*
           * This column scrolls, so Memory's request field pins to its bottom. It is `relative` so
           * the hidden native inputs Radix puts beside a select or a switch (absolute) stay inside
           * it: placed against the dialog instead, they overflow it, and focusing a control low in
           * the form scrolls the whole dialog, nav and × with it.
           */}
          <div className="mx-auto w-full max-w-3xl px-6 pt-6 pb-10 md:pt-10">
            <header className="mb-6 flex flex-col gap-1.5">
              <h2
                data-testid="project-settings-title"
                className="text-[17px] font-medium text-text"
              >
                {SECTIONS[section].label}
              </h2>
              <p
                data-testid="project-settings-description"
                className="max-w-xl text-[12.5px] leading-relaxed text-text-subtle"
              >
                {SECTIONS[section].description}
              </p>
            </header>
            <SectionBody entry={entry} section={section} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const SectionBody = ({
  entry,
  section,
}: {
  entry: ProjectEntry;
  section: ProjectSettingsSection;
}): ReactNode => {
  const { project } = entry;
  switch (section) {
    case "general":
      return <GeneralSection project={project} />;
    case "models":
      return <ModelsSection project={project} />;
    case "threads":
      return <ThreadsSection project={project} />;
    case "computer-use":
      return <ComputerUseSetting project={project} />;
    case "notifications":
      return <NotificationsSection project={project} />;
    case "environment":
      return <EnvironmentSection entry={entry} />;
    case "issues":
      return <IssueSourcesSection project={project} />;
    case "memory":
      return <MemorySection project={project} />;
    case "usage":
      return <UsageSection project={project} />;
    case "advanced":
      return <AdvancedSection project={project} />;
  }
};
