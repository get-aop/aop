import type { Project } from "@aop/common";
import { Switch } from "@/ui/switch";
import { SettingRow, SettingsGroup } from "./blocks";
import { ThreadAccessSetting } from "./ThreadAccessSetting";
import { type AutosaveSettings, useSettingsAutosave } from "./use-settings-autosave";

/** What threads may do on the host, then what the host does for them by itself. */
export const ThreadsSection = ({ project }: { project: Project }) => {
  const settings = useSettingsAutosave(project);
  return (
    <div data-testid="settings-threads" className="flex flex-col gap-6">
      <SettingsGroup title="Permissions">
        <ThreadAccessSetting project={project} settings={settings} />
      </SettingsGroup>
      <SettingsGroup title="Automation">
        <SwitchRow
          settings={settings}
          setting="autoFixPullRequests"
          id="settings-auto-fix"
          label="Fix pull requests automatically"
          description="When a thread's pull request has failing checks, a review that requests changes, or merge conflicts, the thread is sent a prompt to fix it. After a few attempts the host stops and tells the coordinator."
        />
        <SwitchRow
          settings={settings}
          setting="autoContinue"
          id="settings-auto-continue"
          label="Auto-continue when usage limits reset"
          description="Threads that stop on a usage limit pick up where they left off when the limit resets. Off, a stopped thread waits for its Resume button."
        />
      </SettingsGroup>
    </div>
  );
};

const SwitchRow = ({
  settings,
  setting,
  id,
  label,
  description,
}: {
  settings: AutosaveSettings;
  setting: "autoFixPullRequests" | "autoContinue";
  id: string;
  label: string;
  description: string;
}) => (
  <SettingRow
    label={label}
    description={description}
    htmlFor={id}
    status={settings.state(setting)}
    control={
      <Switch
        id={id}
        data-testid={id}
        checked={settings.value(setting)}
        onCheckedChange={(checked) => settings.set(setting, checked)}
        className="data-[state=checked]:bg-running"
      />
    }
  />
);
