import {
  CreateProjectInputSchema,
  PROJECT_GOAL_MAX_LENGTH,
  PROJECT_INSTRUCTIONS_MAX_LENGTH,
} from "@aop/common";
import { FolderIcon, PlusIcon } from "lucide-react";
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
import { Input } from "@/ui/input";
import { Label } from "@/ui/label";
import { Textarea } from "@/ui/textarea";
import type { RegisteredRepo } from "../api/client";
import { closeNewProjectDialog, openAttachRepoDialog, useDialogs } from "../shell/dialog-store";
import { navigate, projectPath } from "../shell/router";
import { useProjectActions } from "./use-project-actions";
import { useRegisteredRepos } from "./use-registered-repos";

/** Where a new project starts: a name, what it is for, what to tell every agent, and which repositories it works in. */
export const NewProjectDialog = () => {
  const { newProject } = useDialogs();
  return (
    <Dialog open={newProject} onOpenChange={(open) => !open && closeNewProjectDialog()}>
      <DialogContent
        data-testid="new-project-dialog"
        className="w-[560px] max-w-[560px] grid-cols-[minmax(0,1fr)] gap-4"
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
  const [goal, setGoal] = useState("");
  const [instructions, setInstructions] = useState("");
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const repos = useRegisteredRepos((repoId) =>
    setSelected((ids) => (ids.includes(repoId) ? ids : [...ids, repoId])),
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = CreateProjectInputSchema.safeParse({
      name,
      goal: goal.trim(),
      instructions,
      repoIds: selected,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the fields and try again");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const project = await actions.create({
        name: parsed.data.name,
        goal: parsed.data.goal,
        instructions: parsed.data.instructions,
        repoIds: parsed.data.repoIds,
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
        <Label htmlFor="new-project-name">Name</Label>
        <Input
          id="new-project-name"
          data-testid="new-project-name"
          autoFocus
          autoComplete="off"
          maxLength={100}
          placeholder="Checkout service"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
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

      {error ? (
        <p data-testid="new-project-error" role="alert" className="text-[12.5px] text-blocked">
          {error}
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
          disabled={name.trim() === "" || submitting}
        >
          {submitting ? "Creating…" : "Create project"}
        </Button>
      </DialogFooter>
    </form>
  );
};

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
