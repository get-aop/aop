import {
  CreateProjectInputSchema,
  describeIssuesByField,
  PROJECT_GOAL_MAX_LENGTH,
  PROJECT_INSTRUCTIONS_MAX_LENGTH,
} from "@aop/common";
import { FolderIcon, PlusIcon, TriangleAlertIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Label } from "@/ui/label";
import { Textarea } from "@/ui/textarea";
import type { RegisteredRepo } from "../api/client";
import { closeNewProjectDialog, openAttachRepoDialog, useDialogs } from "../shell/dialog-store";
import { navigate, projectPath } from "../shell/router";
import { type AppearanceChoice, NameAndIconInput } from "./NameAndIconInput";
import { PROJECT_FIELD_LABELS, projectNameProblem } from "./project-fields";
import { useProjectActions } from "./use-project-actions";
import { useRegisteredRepos } from "./use-registered-repos";

/** Where a new project starts: a name and icon, what it is for, what to tell every agent, and which repositories it works in. */
export const NewProjectDialog = () => {
  const { newProject } = useDialogs();
  return (
    <Dialog open={newProject} onOpenChange={(open) => !open && closeNewProjectDialog()}>
      <DialogContent
        data-testid="new-project-dialog"
        className="w-[560px] max-w-[min(560px,calc(100%-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto grid-cols-[minmax(0,1fr)] gap-4"
      >
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            A project is one coordinator chat and the threads it starts. Threads work in the
            repositories you attach.
          </DialogDescription>
        </DialogHeader>
        {/* Unmounted with the dialog, so every open starts from an empty form. */}
        <NewProjectForm />
      </DialogContent>
    </Dialog>
  );
};

const NewProjectForm = () => {
  const actions = useProjectActions();
  const [name, setName] = useState("");
  const [appearance, setAppearance] = useState<AppearanceChoice>({ icon: null, color: null });
  const [goal, setGoal] = useState("");
  const [instructions, setInstructions] = useState("");
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [lookAround, setLookAround] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repos = useRegisteredRepos((repoId) =>
    setSelected((ids) => (ids.includes(repoId) ? ids : [...ids, repoId])),
  );

  const parsed = CreateProjectInputSchema.safeParse({
    name,
    ...appearance,
    goal: goal.trim(),
    instructions,
    repoIds: selected,
  });
  // The name is the one box a person can type past its limit, so its problem shows under it as
  // they type. Anything else the schema refuses (the other boxes stop at their limits, so it is
  // not expected) is said in plain words above the buttons, never as zod's own text.
  const nameProblem = projectNameProblem(name);
  const otherProblem = parsed.success
    ? undefined
    : Object.entries(describeIssuesByField(parsed.error.issues, PROJECT_FIELD_LABELS)).find(
        ([field]) => field !== "name",
      )?.[1];
  const formProblem = error ?? otherProblem;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!parsed.success) return;
    setSubmitting(true);
    setError(null);
    try {
      const project = await actions.create({
        name: parsed.data.name,
        icon: parsed.data.icon,
        color: parsed.data.color,
        goal: parsed.data.goal,
        instructions: parsed.data.instructions,
        repoIds: parsed.data.repoIds,
        lookAround,
      });
      closeNewProjectDialog();
      navigate(projectPath(project.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the project");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-project-name">Name and icon</Label>
        <NameAndIconInput
          id="new-project-name"
          data-testid="new-project-name"
          pickerTestId="new-project-icon"
          // No id yet, so "Auto" previews one hue here; the project takes its own from its id once created.
          appearance={{ id: "", name, ...appearance }}
          onPick={setAppearance}
          autoFocus
          autoComplete="off"
          placeholder="Checkout service"
          value={name}
          aria-invalid={nameProblem !== null}
          aria-describedby={nameProblem ? "new-project-name-error" : undefined}
          onChange={(event) => setName(event.target.value)}
        />
        {nameProblem ? (
          <p
            id="new-project-name-error"
            data-testid="new-project-name-error"
            className="text-[12px] text-blocked"
          >
            {nameProblem}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="new-project-goal">Goal</Label>
        <Textarea
          id="new-project-goal"
          data-testid="new-project-goal"
          rows={2}
          maxLength={PROJECT_GOAL_MAX_LENGTH}
          placeholder="What is this project for? Optional."
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          className="field-sizing-fixed min-h-0 text-[13px]"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline gap-2">
          <Label htmlFor="new-project-instructions">Instructions</Label>
          <span
            data-testid="new-project-instructions-count"
            className="ml-auto text-[11.5px] tabular-nums text-text-subtle"
          >
            {instructions.length} / {PROJECT_INSTRUCTIONS_MAX_LENGTH}
          </span>
        </div>
        <Textarea
          id="new-project-instructions"
          data-testid="new-project-instructions"
          rows={4}
          maxLength={PROJECT_INSTRUCTIONS_MAX_LENGTH}
          placeholder="Sent to the coordinator and to every thread it starts: context, sources, rules. Optional."
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          className="field-sizing-fixed min-h-0 text-[13px]"
        />
      </div>

      <RepoPicker
        repos={repos}
        selected={selected}
        onToggle={(repoId) =>
          setSelected((ids) =>
            ids.includes(repoId) ? ids.filter((id) => id !== repoId) : [...ids, repoId],
          )
        }
      />

      <LookAroundOption checked={lookAround} onChange={setLookAround} />

      <p
        data-testid="new-project-full-access-notice"
        className="flex items-start gap-2 rounded-row border border-blocked/30 bg-blocked/10 px-3 py-2 text-[12.5px] leading-relaxed text-text"
      >
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-blocked" />
        <span>
          New projects run with full access: a thread can run any command on this host without
          asking. You can change this in the project's settings.
        </span>
      </p>

      {formProblem ? (
        <p data-testid="new-project-error" role="alert" className="text-[12.5px] text-blocked">
          {formProblem}
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="ghost" size="sm" onClick={closeNewProjectDialog}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          data-testid="new-project-submit"
          disabled={!parsed.success || submitting}
        >
          {submitting ? "Creating…" : "Create project"}
        </Button>
      </DialogFooter>
    </form>
  );
};

// On by default: the coordinator's first look is what makes a new project useful at once. It
// spends usage, so it can be turned off before anything runs.
const LookAroundOption = ({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <label
    htmlFor="new-project-look-around"
    data-testid="new-project-look-around-option"
    className="flex cursor-pointer items-start gap-2.5 text-[13px]"
  >
    <Checkbox
      id="new-project-look-around"
      data-testid="new-project-look-around"
      className="mt-0.5"
      checked={checked}
      onCheckedChange={(value) => onChange(value === true)}
    />
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="text-text">Let the coordinator look around first</span>
      <span className="text-[12px] leading-relaxed text-text-subtle">
        It welcomes you, starts one read-only thread to learn what the project does and what's in
        flight, then suggests threads to start. The look around uses your Claude usage.
      </span>
    </span>
  </label>
);

const RepoPicker = ({
  repos,
  selected,
  onToggle,
}: {
  repos: RegisteredRepo[] | null;
  selected: readonly string[];
  onToggle: (repoId: string) => void;
}) => (
  <div className="flex flex-col gap-1.5">
    <div className="flex items-center gap-2">
      <Label>Repositories</Label>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        data-testid="new-project-attach-repo"
        onClick={openAttachRepoDialog}
        className="ml-auto"
      >
        <PlusIcon />
        Attach a repository
      </Button>
    </div>
    <div
      data-testid="new-project-repos"
      className="flex max-h-40 min-h-12 flex-col gap-0.5 overflow-y-auto rounded-md border border-border bg-input-surface p-1"
    >
      {repos === null ? (
        <p className="px-2 py-2 text-[12px] text-text-subtle">Loading repositories…</p>
      ) : null}
      {repos?.length === 0 ? (
        <p className="px-2 py-2 text-[12px] text-text-subtle">
          No repositories are attached to AOP yet. A project can start without one.
        </p>
      ) : null}
      {repos?.map((repo) => (
        <label
          key={repo.id}
          htmlFor={`new-project-repo-${repo.id}`}
          data-testid="new-project-repo"
          data-repo-id={repo.id}
          className="flex cursor-pointer items-center gap-2.5 rounded-row px-2 py-1.5 text-[13px] hover:bg-hover"
        >
          <Checkbox
            id={`new-project-repo-${repo.id}`}
            checked={selected.includes(repo.id)}
            onCheckedChange={() => onToggle(repo.id)}
            aria-label={repo.name ?? repo.path}
          />
          <FolderIcon className="size-3.5 shrink-0 text-text-subtle" strokeWidth={1.7} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-text">{repo.name ?? repo.path}</span>
            <span className="block truncate text-[11.5px] text-text-subtle">{repo.path}</span>
          </span>
        </label>
      ))}
    </div>
  </div>
);
