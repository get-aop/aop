import { type ReactNode, useEffect } from "react";
import { Toaster } from "@/ui/sonner";
import { ConfirmationHost } from "../components/ConfirmationHost";
import { AttachRepoDialog } from "../dialogs/AttachRepoDialog";
import { LiveView } from "../live-view/LiveView";
import { NewProjectDialog } from "../projects/NewProjectDialog";
import { useLiveProjects } from "../projects/ProjectsProvider";
import { useHostUpdatedToast } from "../updates/host-updated";
import { UpdateDialogs } from "../updates/UpdateDialogs";
import { useDesktopSettingsMenu } from "./desktop-settings-menu";
import {
  announceRepoAttached,
  openNewProjectDialog,
  openSettingsDialog,
  setProjectSwitcherOpen,
  toggleProjectSwitcher,
} from "./dialog-store";
import { routeProjectId, useRoute } from "./router";
import { SettingsDialog } from "./SettingsDialog";
import { handleGlobalShortcut } from "./shortcuts";

/**
 * The shell: no chrome of its own. Each screen brings its top bar, which holds the project
 * switcher (the app's menu), so the route's screen has the whole width. The shell tells the live
 * state which project is open (that project always gets a stream), and mounts the live view of
 * the host's screen, the dialogs, the toaster (with "Host soulf updated to x" after a host
 * update) and the global keyboard layer.
 */
export const AppShell = ({ children }: { children: ReactNode }) => {
  const live = useLiveProjects();
  const route = useRoute();
  const openProjectId = routeProjectId(route);

  useEffect(() => {
    live.setSelected(openProjectId);
  }, [live, openProjectId]);

  // Whatever moved the page (a pick, back, a notification) leaves no switcher open on the new screen.
  useEffect(() => {
    if (route) setProjectSwitcherOpen(false);
  }, [route]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      handleGlobalShortcut(event, {
        toggleProjectSwitcher,
        newProject: openNewProjectDialog,
        openSettings: () => openSettingsDialog("general"),
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  useDesktopSettingsMenu();
  useHostUpdatedToast();

  return (
    <div data-testid="app-shell" className="flex h-svh min-h-0 w-full flex-col bg-background">
      <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
      <LiveView />
      <SettingsDialog />
      <NewProjectDialog />
      <AttachRepoDialog onAttached={announceRepoAttached} />
      <Toaster position="bottom-right" />
      <UpdateDialogs />
      <ConfirmationHost />
    </div>
  );
};
