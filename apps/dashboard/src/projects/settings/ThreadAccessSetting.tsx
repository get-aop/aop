import type { ThreadAccess } from "@aop/common";
import { TriangleAlertIcon } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { ROW_SELECT_CLASS, SettingRow } from "./blocks";
import type { SettingsDraft } from "./use-settings-draft";

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
 * so its warning shows for as long as it is selected; only the person can change the setting,
 * since no coordinator tool can. The coordinator itself never gets full access.
 */
export const ThreadAccessSetting = ({ draft }: { draft: SettingsDraft }) => {
  const access = draft.value("threadAccess");
  const chosen = OPTIONS.find((option) => option.value === access);

  return (
    <SettingRow
      label="Thread access"
      description={
        <span data-testid="settings-thread-access-description">
          How much a thread may do on this host without asking you first. {chosen?.description}
        </span>
      }
      htmlFor="settings-thread-access"
      control={
        <Select
          value={access}
          onValueChange={(value) => draft.set("threadAccess", value as ThreadAccess)}
        >
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
      below={access === "full-access" ? <FullAccessWarning /> : null}
    />
  );
};

const FullAccessWarning = () => (
  <div
    role="alert"
    data-testid="settings-full-access-warning"
    className="flex gap-2.5 rounded-row border border-blocked/30 bg-blocked/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-text"
  >
    <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-blocked" />
    <div className="flex flex-col gap-1">
      <p className="font-medium text-blocked">Threads can run any command on this host.</p>
      <p className="text-text-muted">
        A thread runs as you on this machine: it can delete files outside the repository, read
        credentials and push to any remote. A wrong instruction, or text an attacker put in a file
        or in memory, is enough to make it try. Choose Edit files for a project whose repositories
        and instructions you do not trust. The setting applies to every thread of the project,
        including the ones running now, from their next turn. The coordinator never gets this
        access.
      </p>
    </div>
  </div>
);
