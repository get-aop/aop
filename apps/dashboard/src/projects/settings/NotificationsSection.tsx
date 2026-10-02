import type { NotificationLevel, Project } from "@aop/common";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { NOTIFICATION_LEVELS } from "../notification-levels";
import { ROW_SELECT_CLASS, SettingRow, SettingsGroup } from "./blocks";
import { useSettingsAutosave } from "./use-settings-autosave";

/** When the desktop app raises a notification for the project. */
export const NotificationsSection = ({ project }: { project: Project }) => {
  const settings = useSettingsAutosave(project);
  return (
    <SettingsGroup testId="settings-notifications-section">
      <SettingRow
        label="Desktop notifications"
        description="What raises a notification for this project in the desktop app."
        htmlFor="settings-notifications"
        status={settings.state("notificationLevel")}
        control={
          <Select
            value={settings.value("notificationLevel")}
            onValueChange={(level) => settings.set("notificationLevel", level as NotificationLevel)}
          >
            <SelectTrigger
              id="settings-notifications"
              data-testid="settings-notifications"
              className={ROW_SELECT_CLASS}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NOTIFICATION_LEVELS.map(({ level, label }) => (
                <SelectItem
                  key={level}
                  value={level}
                  data-testid={`settings-notifications-${level}`}
                >
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </SettingsGroup>
  );
};
