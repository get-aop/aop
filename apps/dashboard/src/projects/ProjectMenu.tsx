import type { NotificationLevel, Project } from "@aop/common";
import type { ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { navigate, projectSettingsPath } from "../shell/router";
import { NOTIFICATION_LEVELS } from "./notification-levels";
import { usePinnedProjects } from "./project-preferences";
import { useProjectActions } from "./use-project-actions";

/**
 * The menu on a project row and on a project card: Pin, Notifications, Settings, Archive,
 * Delete, and Pause or Resume. `children` is the button that opens it.
 */
export const ProjectMenu = ({ project, children }: { project: Project; children: ReactNode }) => {
  const { pinnedIds, toggle } = usePinnedProjects();
  const actions = useProjectActions();
  const pinned = pinnedIds.includes(project.id);
  const archived = project.status === "archived";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" data-testid="project-menu">
        <DropdownMenuItem data-testid="project-menu-pin" onSelect={() => toggle(project.id)}>
          {pinned ? "Unpin" : "Pin"}
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-testid="project-menu-notifications">
            Notifications
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              value={project.notificationLevel}
              onValueChange={(level) =>
                void actions.setNotifications(project, level as NotificationLevel)
              }
            >
              {NOTIFICATION_LEVELS.map(({ level, label }) => (
                <DropdownMenuRadioItem
                  key={level}
                  value={level}
                  data-testid={`project-menu-notifications-${level}`}
                >
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem
          data-testid="project-menu-settings"
          onSelect={() => navigate(projectSettingsPath(project.id))}
        >
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {archived ? null : (
          <DropdownMenuItem
            data-testid="project-menu-pause"
            onSelect={() =>
              void actions.transition(project, project.status === "paused" ? "resume" : "pause")
            }
          >
            {project.status === "paused" ? "Resume" : "Pause"}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          data-testid="project-menu-archive"
          onSelect={() => void actions.transition(project, archived ? "restore" : "archive")}
        >
          {archived ? "Restore" : "Archive"}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          data-testid="project-menu-delete"
          onSelect={() => void actions.remove(project)}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
