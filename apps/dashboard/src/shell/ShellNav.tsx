import { ArrowLeftIcon, ArrowRightIcon, PlusIcon } from "lucide-react";
import { IconButton } from "../components/IconButton";
import type { ProjectEntry } from "../projects/projects-state";
import { openNewProjectDialog } from "./dialog-store";
import { ProjectSwitcher } from "./project-switcher/ProjectSwitcher";
import { useHistoryEnds } from "./router";

/**
 * The start of every top bar: back and forward through the pages the person has been on, the
 * project switcher (the open project, or none), and the button that starts a new project.
 */
export const ShellNav = ({ current }: { current: ProjectEntry | null }) => {
  const ends = useHistoryEnds();
  return (
    <div data-testid="shell-nav" className="flex min-w-0 items-center gap-0.5">
      <span className="hidden shrink-0 items-center gap-0.5 sm:flex">
        <IconButton
          testId="nav-back"
          label="Back"
          disabled={!ends.back}
          onClick={() => window.history.back()}
        >
          <ArrowLeftIcon />
        </IconButton>
        <IconButton
          testId="nav-forward"
          label="Forward"
          disabled={!ends.forward}
          onClick={() => window.history.forward()}
        >
          <ArrowRightIcon />
        </IconButton>
      </span>
      <ProjectSwitcher current={current} />
      <IconButton
        testId="new-project-button"
        label="New project (⌘N)"
        aria-keyshortcuts="Meta+N"
        onClick={openNewProjectDialog}
      >
        <PlusIcon />
      </IconButton>
    </div>
  );
};
