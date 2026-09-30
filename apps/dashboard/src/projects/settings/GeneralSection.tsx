import { type NotificationLevel, PROJECT_GOAL_MAX_LENGTH, type Project } from "@aop/common";
import { Input } from "@/ui/input";
import { Label } from "@/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Textarea } from "@/ui/textarea";
import { requestConfirmation } from "../../components/ConfirmationHost";
import { NOTIFICATION_LEVELS } from "../notification-levels";
import { AutoFixSetting } from "./AutoFixSetting";
import { SaveBar, SettingsBlock } from "./blocks";
import { ModelSettings } from "./ModelSettings";
import { CoordinatorRestart, DangerZone } from "./ProjectLifecycle";
import { ThreadAccessSetting } from "./ThreadAccessSetting";
import { type SettingsDraft, useSettingsDraft } from "./use-settings-draft";

/** Name, goal, models, thread access and notifications in one form, then the actions that are not edits. */
export const GeneralSection = ({ project }: { project: Project }) => {
  const draft = useSettingsDraft(project);
  const nameMissing = draft.value("name").trim() === "";

  const save = async () => {
    if (nameMissing) return;
    // Full access is the one setting that lowers a guard, so saving it asks once more.
    if (draft.patch.threadAccess === "full-access") {
      const confirmed = await requestConfirmation({
        title: "Give threads full access?",
        message: `Threads of “${project.name}” will run any command on this host without asking, starting with their next turn. Only continue for a project you trust.`,
        confirmLabel: "Give full access",
        destructive: true,
      });
      if (!confirmed) return;
    }
    await draft.save();
  };

  return (
    <div data-testid="settings-general" className="flex flex-col">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        className="flex flex-col"
      >
        <SettingsBlock title="Project">
          <div className="flex max-w-xl flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-name">Name</Label>
              <Input
                id="settings-name"
                data-testid="settings-name"
                autoComplete="off"
                maxLength={100}
                value={draft.value("name")}
                aria-invalid={nameMissing}
                onChange={(event) => draft.set("name", event.target.value)}
              />
              {nameMissing ? (
                <p data-testid="settings-name-error" className="text-[12px] text-blocked">
                  A project needs a name.
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="settings-goal">Goal</Label>
              <Textarea
                id="settings-goal"
                data-testid="settings-goal"
                rows={3}
                maxLength={PROJECT_GOAL_MAX_LENGTH}
                placeholder="What is this project for?"
                value={draft.value("goal")}
                onChange={(event) => draft.set("goal", event.target.value)}
                className="field-sizing-fixed min-h-0 text-[13px]"
              />
              <p className="text-[12px] text-text-subtle">
                Shown under the project's name, and sent to the coordinator and every thread.
              </p>
            </div>
          </div>
        </SettingsBlock>

        <SettingsBlock
          title="Models"
          description="Each role runs the model and effort you choose. “Use default” passes none, so Claude Code picks its own and the role follows it when it changes."
          testId="settings-models"
        >
          <ModelSettings draft={draft} />
        </SettingsBlock>

        <SettingsBlock
          title="Thread access"
          description="How much a thread may do on this host without asking you first."
        >
          <ThreadAccessSetting draft={draft} />
        </SettingsBlock>

        <SettingsBlock
          title="Pull requests"
          description="What the host does when a thread's pull request needs work."
        >
          <AutoFixSetting draft={draft} />
        </SettingsBlock>

        <SettingsBlock
          title="Notifications"
          description="When the desktop app raises a notification for this project."
        >
          <NotificationSetting draft={draft} />
        </SettingsBlock>

        <SaveBar draft={draft} blocked={nameMissing} />
      </form>

      <CoordinatorRestart project={project} />
      <DangerZone project={project} />
    </div>
  );
};

const NotificationSetting = ({ draft }: { draft: SettingsDraft }) => (
  <div className="flex max-w-xl flex-col gap-1.5">
    <Label htmlFor="settings-notifications">Notify me about</Label>
    <Select
      value={draft.value("notificationLevel")}
      onValueChange={(level) => draft.set("notificationLevel", level as NotificationLevel)}
    >
      <SelectTrigger
        id="settings-notifications"
        data-testid="settings-notifications"
        className="w-full"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {NOTIFICATION_LEVELS.map(({ level, label }) => (
          <SelectItem key={level} value={level} data-testid={`settings-notifications-${level}`}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);
