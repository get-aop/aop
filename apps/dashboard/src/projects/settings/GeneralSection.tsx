import { type NotificationLevel, PROJECT_GOAL_MAX_LENGTH, type Project } from "@aop/common";
import { Input } from "@/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { Textarea } from "@/ui/textarea";
import { requestConfirmation } from "../../components/ConfirmationHost";
import { NOTIFICATION_LEVELS } from "../notification-levels";
import { projectNameProblem } from "../project-fields";
import { AutoFixSetting } from "./AutoFixSetting";
import { ROW_SELECT_CLASS, SaveBar, SettingRow, SettingsHeading } from "./blocks";
import { ModelSettings } from "./ModelSettings";
import { ProjectLifecycle } from "./ProjectLifecycle";
import { ThreadAccessSetting } from "./ThreadAccessSetting";
import { type SettingsDraft, useSettingsDraft } from "./use-settings-draft";

const count = (value: number): string => value.toLocaleString("en-US");

/** Name, goal, models, thread access and notifications in one form, then the actions that are not edits. */
export const GeneralSection = ({ project }: { project: Project }) => {
  const draft = useSettingsDraft(project);
  const name = draft.value("name");
  const goal = draft.value("goal");
  const nameMissing = name.trim() === "";
  const nameProblem = nameMissing ? "A project needs a name." : projectNameProblem(name);

  const save = async () => {
    if (nameProblem) return;
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
        <SettingRow
          label="Name"
          htmlFor="settings-name"
          control={
            <Input
              id="settings-name"
              data-testid="settings-name"
              autoComplete="off"
              value={name}
              aria-invalid={nameProblem !== null}
              onChange={(event) => draft.set("name", event.target.value)}
              className="w-full sm:w-64"
            />
          }
          below={
            nameProblem ? (
              <p
                data-testid="settings-name-error"
                className="text-[12px] text-blocked sm:text-right"
              >
                {nameProblem}
              </p>
            ) : null
          }
        />
        <SettingRow
          label="Goal"
          description="The outcome you want the coordinator to work toward. Shown under the project's name, and sent to the coordinator and every thread."
          htmlFor="settings-goal"
          below={
            <div className="flex flex-col gap-1.5">
              <Textarea
                id="settings-goal"
                data-testid="settings-goal"
                rows={3}
                maxLength={PROJECT_GOAL_MAX_LENGTH}
                placeholder="What is this project for?"
                value={goal}
                onChange={(event) => draft.set("goal", event.target.value)}
                className="field-sizing-fixed min-h-0 text-[13px]"
              />
              <p
                data-testid="settings-goal-count"
                className="self-end text-[12px] tabular-nums text-text-subtle"
              >
                {count(goal.length)} / {count(PROJECT_GOAL_MAX_LENGTH)}
              </p>
            </div>
          }
        />

        <div data-testid="settings-models" className="flex flex-col">
          <SettingsHeading
            title="Models"
            description="Each role runs the model and effort you choose. “Default” passes none, so Claude Code picks its own and the role follows it when it changes; the label names what the last run used."
          />
          <ModelSettings draft={draft} reported={project.reportedRuntime} />
        </div>

        <SettingsHeading title="Threads" />
        <ThreadAccessSetting draft={draft} />
        <AutoFixSetting draft={draft} />
        <NotificationSetting draft={draft} />

        <SaveBar draft={draft} blocked={nameProblem !== null} />
      </form>

      <ProjectLifecycle project={project} />
    </div>
  );
};

const NotificationSetting = ({ draft }: { draft: SettingsDraft }) => (
  <SettingRow
    label="Notifications"
    description="When the desktop app raises a notification for this project."
    htmlFor="settings-notifications"
    control={
      <Select
        value={draft.value("notificationLevel")}
        onValueChange={(level) => draft.set("notificationLevel", level as NotificationLevel)}
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
            <SelectItem key={level} value={level} data-testid={`settings-notifications-${level}`}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    }
  />
);
