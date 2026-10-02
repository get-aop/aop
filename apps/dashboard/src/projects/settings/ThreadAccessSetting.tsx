import type { Project, ThreadAccess } from "@aop/common";
import { Button } from "@/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { skipsPermissions, useAgentClis } from "../../agent-clis/agent-cli-store";
import { requestConfirmation } from "../../components/ConfirmationHost";
import { openSettingsDialog } from "../../shell/dialog-store";
import { ROW_SELECT_CLASS, SettingNote, SettingRow } from "./blocks";
import type { AutosaveSettings } from "./use-settings-autosave";

const OPTIONS: { value: ThreadAccess; label: string; description: string }[] = [
  {
    value: "full-access",
    label: "Full access",
    description:
      "Threads run any command on this host without asking. This is the default for new projects.",
  },
  {
    value: "auto-accept-edits",
    label: "Edit files",
    description:
      "Threads edit files in their own worktree. Commands that run code or change things, such as running tests or git commit, are denied (read-only ones like git status still run): there is no approval prompt.",
  },
];

/**
 * What a project's threads may do without asking. Full access is what a new project starts with,
 * so its note shows for as long as it is selected; only the person can change the setting, since
 * no coordinator tool can. Choosing it asks once more before it saves. While the host skips
 * permission checks this setting does not apply, and the row says that instead of warning twice.
 */
export const ThreadAccessSetting = ({
  project,
  settings,
}: {
  project: Project;
  settings: AutosaveSettings;
}) => {
  const access = settings.value("threadAccess");
  const chosen = OPTIONS.find((option) => option.value === access);
  const hostBypass = skipsPermissions(useAgentClis().data);

  const choose = async (next: ThreadAccess) => {
    // Full access is the one setting that lowers a guard, so choosing it asks once more.
    if (next === "full-access") {
      const confirmed = await requestConfirmation({
        title: "Give threads full access?",
        message: `Threads of “${project.name}” will run any command on this host without asking, starting with their next turn. Only continue for a project you trust.`,
        confirmLabel: "Give full access",
        destructive: true,
      });
      if (!confirmed) return;
    }
    settings.set("threadAccess", next);
  };

  return (
    <SettingRow
      label="Thread access"
      description={
        <span data-testid="settings-thread-access-description">
          How much a thread may do on this host without asking you first. {chosen?.description}
        </span>
      }
      htmlFor="settings-thread-access"
      status={settings.state("threadAccess")}
      control={
        <Select value={access} onValueChange={(value) => void choose(value as ThreadAccess)}>
          <SelectTrigger
            id="settings-thread-access"
            data-testid="settings-thread-access"
            data-value={access}
            className={ROW_SELECT_CLASS}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPTIONS.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                data-testid={`settings-thread-access-${option.value}`}
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
      below={
        hostBypass ? (
          <OverriddenNote />
        ) : access === "full-access" ? (
          <SettingNote
            tone="warn"
            testId="settings-full-access-warning"
            title="Threads can run any command on this host."
          >
            They run as you: a wrong instruction, or text an attacker put in a file or in memory,
            can make one delete files outside the repository, read credentials or push anywhere.
            Choose Edit files for repositories and instructions you do not trust. The coordinator
            never gets this access.
          </SettingNote>
        ) : null
      }
    />
  );
};

const OverriddenNote = () => (
  <SettingNote tone="warn" testId="settings-thread-access-overridden">
    Overridden on this host: Skip permission checks is on, so every thread runs with full access
    whatever this says.{" "}
    <Button
      type="button"
      variant="link"
      size="xs"
      data-testid="settings-thread-access-runtimes"
      className="h-auto p-0 text-[12.5px]"
      onClick={() => openSettingsDialog("runtimes")}
    >
      Settings › Runtimes
    </Button>
  </SettingNote>
);
