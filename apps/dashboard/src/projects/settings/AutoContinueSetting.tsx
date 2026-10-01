import { Switch } from "@/ui/switch";
import { SettingRow } from "./blocks";
import type { SettingsDraft } from "./use-settings-draft";

/**
 * Whether a thread a usage limit stopped takes up its work by itself when the limit resets. Off,
 * it stays stopped past the reset and the thread's Resume button picks it up.
 */
export const AutoContinueSetting = ({ draft }: { draft: SettingsDraft }) => (
  <SettingRow
    label="Auto-continue when usage limits reset"
    description="Threads that stop on a usage limit pick up where they left off when the limit resets. Applies to every thread in this project."
    htmlFor="settings-auto-continue"
    control={
      <Switch
        id="settings-auto-continue"
        data-testid="settings-auto-continue"
        checked={draft.value("autoContinue")}
        onCheckedChange={(checked) => draft.set("autoContinue", checked)}
        className="data-[state=checked]:bg-running"
      />
    }
  />
);
