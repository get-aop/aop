import type { SettingsDraft } from "./use-settings-draft";

/**
 * Whether the host answers a thread's pull request by itself: it sends the thread a fix prompt
 * for failing checks, a review that requests changes, or merge conflicts, a few times at most.
 */
export const AutoFixSetting = ({ draft }: { draft: SettingsDraft }) => {
  const enabled = draft.value("autoFixPullRequests");

  return (
    <label
      htmlFor="settings-auto-fix"
      className="flex max-w-xl cursor-pointer items-start gap-3 rounded-row border border-border px-3 py-2.5 transition-colors duration-[120ms] hover:bg-hover"
    >
      <input
        id="settings-auto-fix"
        type="checkbox"
        data-testid="settings-auto-fix"
        checked={enabled}
        onChange={(event) => draft.set("autoFixPullRequests", event.target.checked)}
        className="mt-0.5 size-3.5 shrink-0 accent-[var(--color-running)]"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-[13px] font-medium text-text">Fix pull requests automatically</span>
        <span className="text-[12.5px] leading-relaxed text-text-subtle">
          When a thread's pull request has failing checks, a review that requests changes, or merge
          conflicts, the thread is sent a prompt to fix it. After a few attempts the host stops and
          tells the coordinator.
        </span>
      </span>
    </label>
  );
};
