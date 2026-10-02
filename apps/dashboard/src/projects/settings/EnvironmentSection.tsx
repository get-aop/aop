import { ChevronDownIcon, GitBranchIcon, PlusIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import type { RegisteredRepo } from "../../api/client";
import type { ProjectEntry } from "../projects-state";
import { useProjectActions } from "../use-project-actions";
import { useRegisteredRepos } from "../use-registered-repos";
import { SettingRow, SettingsGroup } from "./blocks";
import { explainRepoChange, type ProjectRepoRef } from "./repo-change-error";
import { useRegisterToAdd } from "./use-register-to-add";

/**
 * The repositories the project's threads work in: one list with a remove × per row, and an Add
 * menu of the registered repositories not in it yet, or a new one registered through the attach
 * dialog. Each change is saved as soon as it is made, like every project setting.
 */
export const EnvironmentSection = ({ entry }: { entry: ProjectEntry }) => {
  const { project, threads } = entry;
  const actions = useProjectActions();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ repoId: string; message: string } | null>(null);
  // A repository registered from the dialog is added after the list reloads, by then this
  // render's project may be an older one.
  const latest = useRef(project);
  latest.current = project;

  const change = async (repo: ProjectRepoRef, repoIds: string[]) => {
    setBusyId(repo.id);
    setProblem(null);
    try {
      await actions.update(latest.current, { repoIds });
    } catch (cause) {
      setProblem({ repoId: repo.id, message: explainRepoChange(cause, repo, threads) });
    } finally {
      setBusyId(null);
    }
  };
  const add = (repo: ProjectRepoRef) => {
    const { repoIds } = latest.current;
    if (!repoIds.includes(repo.id)) void change(repo, [...repoIds, repo.id]);
  };
  const remove = (repo: ProjectRepoRef) =>
    void change(
      repo,
      latest.current.repoIds.filter((id) => id !== repo.id),
    );

  const registration = useRegisterToAdd((repoId) => add({ id: repoId, name: null, path: null }));
  const registered = useRegisteredRepos(registration.onRegistered);
  const known = new Map((registered ?? []).map((repo) => [repo.id, repo]));
  const attached = project.repoIds.map((id) => known.get(id) ?? { id, name: null, path: null });
  const available = (registered ?? []).filter((repo) => !project.repoIds.includes(repo.id));

  return (
    <SettingsGroup testId="settings-environment">
      <SettingRow
        testId="settings-repos"
        label="Project repositories"
        description="Threads work in these repositories, one repository and one branch per thread. The coordinator picks which."
        control={
          <AddRepoMenu
            registered={registered}
            available={available}
            onAdd={add}
            onRegister={registration.open}
          />
        }
      />
      <div data-testid="settings-repos-attached" className="flex flex-col">
        {attached.length === 0 ? (
          <p className="px-4 py-3.5 text-[12.5px] text-text-subtle">No repository is attached.</p>
        ) : (
          attached.map((repo) => (
            <RepoRow
              key={repo.id}
              repo={repo}
              busy={busyId === repo.id}
              problem={problem?.repoId === repo.id ? problem.message : null}
              onRemove={() => remove(repo)}
            />
          ))
        )}
      </div>
    </SettingsGroup>
  );
};

const AddRepoMenu = ({
  registered,
  available,
  onAdd,
  onRegister,
}: {
  registered: RegisteredRepo[] | null;
  available: RegisteredRepo[];
  onAdd: (repo: RegisteredRepo) => void;
  onRegister: () => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="secondary" size="sm" data-testid="settings-repo-add">
        Add
        <ChevronDownIcon />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="end"
      data-testid="settings-repo-add-menu"
      className="w-72 max-w-[calc(100vw-2rem)]"
    >
      {available.length === 0 ? (
        <p
          data-testid="settings-repo-add-empty"
          className="px-2 py-1.5 text-[12px] text-text-subtle"
        >
          {emptyMenuText(registered)}
        </p>
      ) : (
        available.map((repo) => (
          <DropdownMenuItem
            key={repo.id}
            data-testid="settings-repo-add-option"
            data-repo-id={repo.id}
            onSelect={() => onAdd(repo)}
          >
            <GitBranchIcon />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{repo.name ?? repo.path}</span>
              <span className="block truncate text-[11.5px] text-text-subtle">{repo.path}</span>
            </span>
          </DropdownMenuItem>
        ))
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem data-testid="settings-register-repo" onSelect={onRegister}>
        <PlusIcon />
        Register another repository…
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

const emptyMenuText = (registered: RegisteredRepo[] | null): string => {
  if (registered === null) return "Loading repositories…";
  if (registered.length === 0) return "No repository is registered with AOP yet.";
  return "Every registered repository is already added.";
};

const RepoRow = ({
  repo,
  busy,
  problem,
  onRemove,
}: {
  repo: ProjectRepoRef;
  busy: boolean;
  problem: string | null;
  onRemove: () => void;
}) => {
  const name = repo.name ?? repo.path ?? "Unknown repository";
  return (
    <div
      data-testid="settings-repo"
      data-repo-id={repo.id}
      className="flex flex-col gap-1 border-b border-border/60 px-4 py-2.5 last:border-b-0"
    >
      <div className="flex items-center gap-3">
        <GitBranchIcon className="size-4 shrink-0 text-text-subtle" strokeWidth={1.7} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] text-text">{name}</span>
          <span className="block truncate text-[11.5px] text-text-subtle">
            {repo.path ?? `${repo.id} is no longer registered with AOP`}
          </span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          data-testid="settings-repo-detach"
          aria-label={`Remove ${name}`}
          title={`Remove ${name}`}
          disabled={busy}
          onClick={onRemove}
        >
          <XIcon />
        </Button>
      </div>
      {problem ? (
        <p
          role="alert"
          data-testid="settings-repo-error"
          className="pl-7 text-[12.5px] text-blocked"
        >
          {problem}
        </p>
      ) : null}
    </div>
  );
};
