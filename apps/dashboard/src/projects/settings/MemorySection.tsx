import { PROJECT_INSTRUCTIONS_MAX_LENGTH, type Project } from "@aop/common";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { Label } from "@/ui/label";
import { Textarea } from "@/ui/textarea";
import { AutoMemory } from "./AutoMemory";
import { SettingsBlock } from "./blocks";
import { useSettingsDraft } from "./use-settings-draft";

/** What every session is told: the instructions the person writes, and the memory agents keep. */
export const MemorySection = ({ project }: { project: Project }) => (
  <div data-testid="settings-memory" className="flex flex-col">
    <InstructionsBlock project={project} />
    <AutoMemory projectId={project.id} />
  </div>
);

const NEAR_LIMIT = 0.9;

const InstructionsBlock = ({ project }: { project: Project }) => {
  const draft = useSettingsDraft(project);
  const instructions = draft.value("instructions");
  const nearLimit = instructions.length >= PROJECT_INSTRUCTIONS_MAX_LENGTH * NEAR_LIMIT;

  return (
    <SettingsBlock
      title="Instructions"
      description="Sent to the coordinator and to every thread it starts, on every turn. Write what only you know: how the repositories relate, what is the source of truth, the rules a thread must keep. Do not repeat what each repository's CLAUDE.md already says."
      testId="settings-instructions-block"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void draft.save();
        }}
        className="flex flex-col gap-2"
      >
        <div className="flex items-baseline gap-2">
          <Label htmlFor="settings-instructions">Instructions</Label>
          <span
            data-testid="settings-instructions-count"
            data-near-limit={nearLimit}
            className={cn(
              "ml-auto text-[11.5px] tabular-nums",
              nearLimit ? "text-waiting" : "text-text-subtle",
            )}
          >
            {instructions.length} / {PROJECT_INSTRUCTIONS_MAX_LENGTH}
          </span>
        </div>
        <Textarea
          id="settings-instructions"
          data-testid="settings-instructions"
          rows={10}
          maxLength={PROJECT_INSTRUCTIONS_MAX_LENGTH}
          placeholder="Project context, sources, source of truth, invariants, what to do before starting."
          value={instructions}
          onChange={(event) => draft.set("instructions", event.target.value)}
          className="field-sizing-fixed min-h-0 text-[13px] leading-relaxed"
        />
        {draft.error ? (
          <p
            role="alert"
            data-testid="settings-instructions-error"
            className="text-[12.5px] text-blocked"
          >
            {draft.error}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <span className="flex-1" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="settings-instructions-discard"
            disabled={!draft.dirty || draft.saving}
            onClick={draft.discard}
          >
            Discard
          </Button>
          <Button
            type="submit"
            size="sm"
            data-testid="settings-instructions-save"
            disabled={!draft.dirty || draft.saving}
          >
            {draft.saving ? "Saving…" : "Save instructions"}
          </Button>
        </div>
      </form>
    </SettingsBlock>
  );
};
