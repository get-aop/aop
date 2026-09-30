import type { ThreadAccess } from "@aop/common";
import { TriangleAlertIcon } from "lucide-react";
import { cn } from "@/lib/cn";
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

  return (
    <div className="flex flex-col gap-2.5">
      <div
        role="radiogroup"
        aria-label="Thread access"
        data-testid="settings-thread-access"
        data-value={access}
        className="flex flex-col gap-2"
      >
        {OPTIONS.map((option) => (
          <label
            key={option.value}
            htmlFor={`settings-thread-access-${option.value}`}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-row border px-3 py-2.5 transition-colors duration-[120ms]",
              access === option.value
                ? "border-border-bold bg-raised"
                : "border-border hover:bg-hover",
            )}
          >
            <input
              id={`settings-thread-access-${option.value}`}
              type="radio"
              name="thread-access"
              data-testid={`settings-thread-access-${option.value}`}
              checked={access === option.value}
              onChange={() => draft.set("threadAccess", option.value)}
              className="mt-0.5 size-3.5 shrink-0 accent-[var(--color-running)]"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-[13px] font-medium text-text">{option.label}</span>
              <span className="text-[12.5px] leading-relaxed text-text-subtle">
                {option.description}
              </span>
            </span>
          </label>
        ))}
      </div>
      {access === "full-access" ? <FullAccessWarning /> : null}
    </div>
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
