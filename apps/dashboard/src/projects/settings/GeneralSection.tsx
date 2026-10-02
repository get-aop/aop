import {
  PROJECT_GOAL_MAX_LENGTH,
  PROJECT_INSTRUCTIONS_MAX_LENGTH,
  type Project,
} from "@aop/common";
import { cn } from "@/lib/cn";
import { Textarea } from "@/ui/textarea";
import { NameAndIconInput } from "../NameAndIconInput";
import { projectNameProblem } from "../project-fields";
import { SettingRow, SettingsGroup } from "./blocks";
import { type AutosaveSettings, useSettingsAutosave } from "./use-settings-autosave";

const count = (value: number): string => value.toLocaleString("en-US");
const NEAR_LIMIT = 0.9;

/**
 * What the project is called, and what the coordinator and every thread are told about it. Text
 * saves once typing pauses or the field loses focus; a picked icon saves at once.
 */
export const GeneralSection = ({ project }: { project: Project }) => {
  const settings = useSettingsAutosave(project);
  return (
    <div data-testid="settings-general" className="flex flex-col gap-6">
      <SettingsGroup>
        <NameRow project={project} settings={settings} />
      </SettingsGroup>
      <SettingsGroup
        title="What agents are told"
        description="Sent to the coordinator and to every thread, on every turn."
      >
        <TextRow
          settings={settings}
          setting="goal"
          label="Goal"
          description="The outcome you want the coordinator to work toward. Also shown under the project's name."
          placeholder="What is this project for?"
          rows={3}
          max={PROJECT_GOAL_MAX_LENGTH}
        />
        <TextRow
          settings={settings}
          setting="instructions"
          label="Instructions"
          description="What only you know: how the repositories relate, what is the source of truth, the rules a thread must keep. Do not repeat what each repository's CLAUDE.md already says."
          placeholder="Project context, sources, source of truth, invariants, what to do before starting."
          rows={8}
          max={PROJECT_INSTRUCTIONS_MAX_LENGTH}
        />
      </SettingsGroup>
    </div>
  );
};

const NameRow = ({ project, settings }: { project: Project; settings: AutosaveSettings }) => {
  const name = settings.value("name");
  const problem = name.trim() === "" ? "A project needs a name." : projectNameProblem(name);
  // One row holds two settings; it reports whichever the person changed last.
  const status = settings.state("name");
  return (
    <SettingRow
      label="Name and icon"
      description="How the project shows in the sidebar and in its header."
      htmlFor="settings-name"
      status={settings.state(status.phase === "idle" ? "icon" : "name")}
      control={
        <NameAndIconInput
          id="settings-name"
          data-testid="settings-name"
          pickerTestId="settings-icon"
          autoComplete="off"
          value={name}
          aria-invalid={problem !== null}
          aria-describedby={problem ? "settings-name-error" : undefined}
          onChange={(event) => settings.set("name", event.target.value, { typed: true })}
          onBlur={settings.flush}
          appearance={{
            id: project.id,
            name,
            icon: settings.value("icon"),
            color: settings.value("color"),
          }}
          onPick={({ icon, color }) => {
            // The first only records the icon; the second saves both in one request.
            settings.set("icon", icon, { typed: true });
            settings.set("color", color);
          }}
          className="w-full sm:w-64"
        />
      }
      below={
        problem ? (
          <p
            id="settings-name-error"
            data-testid="settings-name-error"
            className="text-[12px] text-blocked sm:text-right"
          >
            {problem}
          </p>
        ) : null
      }
    />
  );
};

const TextRow = ({
  settings,
  setting,
  label,
  description,
  placeholder,
  rows,
  max,
}: {
  settings: AutosaveSettings;
  setting: "goal" | "instructions";
  label: string;
  description: string;
  placeholder: string;
  rows: number;
  max: number;
}) => {
  const text = settings.value(setting);
  const nearLimit = text.length >= max * NEAR_LIMIT;
  const id = `settings-${setting}`;
  return (
    <SettingRow
      label={label}
      description={description}
      htmlFor={id}
      status={settings.state(setting)}
      stacked
      control={
        <div className="flex w-full flex-col gap-1.5">
          <Textarea
            id={id}
            data-testid={id}
            rows={rows}
            maxLength={max}
            placeholder={placeholder}
            value={text}
            onChange={(event) => settings.set(setting, event.target.value, { typed: true })}
            onBlur={settings.flush}
            className="field-sizing-fixed min-h-0 text-[13px] leading-relaxed"
          />
          <p
            data-testid={`${id}-count`}
            data-near-limit={nearLimit}
            className={cn(
              "self-end text-[11.5px] tabular-nums",
              nearLimit ? "text-waiting" : "text-text-subtle",
            )}
          >
            {count(text.length)} / {count(max)}
          </p>
        </div>
      }
    />
  );
};
