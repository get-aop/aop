import { ArrowLeftIcon, ArrowRightIcon, PanelLeftIcon } from "lucide-react";
import { useSidebar } from "@/ui/sidebar";
import { IconButton } from "../components/IconButton";
import { useProjectsState } from "../projects/ProjectsProvider";
import { attentionOf } from "../projects/selectors";

/**
 * The top bar's first three buttons, on every screen: the projects sidebar's toggle (with a
 * dot when something waits on the person while the sidebar is out of sight), then back and
 * forward through the pages the person has been on.
 */
export const ShellNav = () => (
  <div data-testid="shell-nav" className="flex shrink-0 items-center gap-0.5">
    <SidebarToggle />
    <span className="hidden items-center gap-0.5 sm:flex">
      <IconButton testId="nav-back" label="Back" onClick={() => window.history.back()}>
        <ArrowLeftIcon />
      </IconButton>
      <IconButton testId="nav-forward" label="Forward" onClick={() => window.history.forward()}>
        <ArrowRightIcon />
      </IconButton>
    </span>
  </div>
);

const SidebarToggle = () => {
  const { toggleSidebar, state, isMobile, openMobile } = useSidebar();
  const projects = useProjectsState();
  const hidden = isMobile ? !openMobile : state === "collapsed";
  const waiting = Object.values(projects.byId).some(
    (entry) => attentionOf(entry.threads).waiting > 0,
  );

  return (
    <IconButton
      testId="sidebar-toggle"
      label="Toggle sidebar"
      onClick={toggleSidebar}
      dot={hidden && waiting}
      dotTestId="sidebar-toggle-dot"
    >
      <PanelLeftIcon />
    </IconButton>
  );
};
