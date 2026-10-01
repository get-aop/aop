import { Switch } from "@/ui/switch";
import { SettingRow } from "./blocks";
import type { SettingsDraft } from "./use-settings-draft";

/**
 * Whether the host answers a thread's pull request by itself: it sends the thread a fix prompt
 * for failing checks, a review that requests changes, or merge conflicts, a few times at most.
 */
export const AutoFixSetting = ({ draft }: { draft: SettingsDraft }) => (
  <SettingRow
    label="Fix pull requests automatically"
    description="When a thread's pull request has failing checks, a review that requests changes, or merge conflicts, the thread is sent a prompt to fix it. After a few attempts the host stops and tells the coordinator."
    htmlFor="settings-auto-fix"
    control={
      <Switch
        id="settings-auto-fix"
        data-testid="settings-auto-fix"
        checked={draft.value("autoFixPullRequests")}
        onCheckedChange={(checked) => draft.set("autoFixPullRequests", checked)}
        className="data-[state=checked]:bg-running"
      />
    }
  />
);
