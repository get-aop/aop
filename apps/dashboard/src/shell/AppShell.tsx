import { type ReactNode, useEffect, useState } from "react";
import { SidebarInset, SidebarProvider } from "@/ui/sidebar";
import { Toaster } from "@/ui/sonner";
import { ConfirmationHost } from "../components/ConfirmationHost";
import { AttachRepoDialog } from "../dialogs/AttachRepoDialog";
import { NewProjectDialog } from "../projects/NewProjectDialog";
import { useLiveProjects } from "../projects/ProjectsProvider";
import { UpdateNotice } from "../updates/UpdateNotice";
import { announceRepoAttached, openNewProjectDialog, openSettingsDialog } from "./dialog-store";
import { ProjectPalette } from "./ProjectPalette";
import { ProjectsSidebar } from "./ProjectsSidebar";
import { routeProjectId, useRoute } from "./router";
import { SettingsDialog } from "./SettingsDialog";
import { handleGlobalShortcut } from "./shortcuts";

/**
 * The shell: the projects sidebar is the only chrome, and the route's screen fills the rest.
 * It also tells the live state which project is open (that project always gets a stream),
 * mounts the dialogs, the ⌘K palette, the toaster and the global keyboard layer.
 */
export const AppShell = ({ children }: { children: ReactNode }) => {
  const live = useLiveProjects();
  const route = useRoute();
  const openProjectId = routeProjectId(route);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    live.setSelected(openProjectId);
  }, [live, openProjectId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      handleGlobalShortcut(event, {
        toggleCommandPalette: () => setPaletteOpen((open) => !open),
        newProject: openNewProjectDialog,
        openSettings: () => openSettingsDialog("general"),
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <SidebarProvider data-testid="app-shell" className="h-svh min-h-0">
      <ProjectsSidebar
        onOpenCommand={() => setPaletteOpen(true)}
        onNewProject={openNewProjectDialog}
      />
      <SidebarInset className="min-h-0 min-w-0">
        <UpdateNotice />
        {children}
      </SidebarInset>
      <ProjectPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <SettingsDialog />
      <NewProjectDialog />
      <AttachRepoDialog onAttached={announceRepoAttached} />
      <Toaster position="bottom-right" />
      <ConfirmationHost />
    </SidebarProvider>
  );
};
