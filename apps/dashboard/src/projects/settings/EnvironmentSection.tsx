import type { Thread } from "@aop/common";
import { FolderIcon, PlusIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/ui/button";
import type { RegisteredRepo } from "../../api/client";
import { ApiError } from "../../api/request";
import { openAttachRepoDialog } from "../../shell/dialog-store";
import type { ProjectEntry } from "../projects-state";
import { useProjectActions } from "../use-project-actions";
import { useRegisteredRepos } from "../use-registered-repos";
import { SettingsBlock } from "./blocks";

/** The repositories the project's threads work in. Each change is saved as soon as it is made. */
export const EnvironmentSection = ({ entry }: { entry: ProjectEntry }) => {
  const { project, threads } = entry;
  const actions = useProjectActions();
  const registered = useRegisteredRepos();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ repoId: string; message: string } | null>(null);

  const change = async (repo: RegisteredRepoRef, repoIds: string[]) => {
    setBusyId(repo.id);
    setProblem(null);
    try {
      await actions.update(project, { repoIds });
    } catch (cause) {
      setProblem({ repoId: repo.id, message: explain(cause, repo, threads) });
    } finally {
      setBusyId(null);
    }
  };

  const attachedIds = project.repoIds;
  const known = new Map((registered ?? []).map((repo) => [repo.id, repo]));
  const attached = attachedIds.map((id) => known.get(id) ?? { id, name: null, path: null });
  const available = (registered ?? []).filter((repo) => !attachedIds.includes(repo.id));

  return (
    <div data-testid="settings-environment" className="flex flex-col">
      <SettingsBlock
        title="Repositories"
        description="Threads work in these repositories, one repository and one branch per thread. The coordinator picks which."
        testId="settings-repos"
      >
        <RepoList testId="settings-repos-attached" empty="No repository is attached.">
          {attached.map((repo) => (
            <RepoRow
              key={repo.id}
              repo={repo}
              attached
              busy={busyId === repo.id}
              problem={problem?.repoId === repo.id ? problem.message : null}
              onToggle={() =>
                void change(
                  repo,
                  attachedIds.filter((id) => id !== repo.id),
                )
              }
            />
          ))}
        </RepoList>
      </SettingsBlock>

      <SettingsBlock
        title="Available repositories"
        description="Registered with AOP but not part of this project."
        testId="settings-repos-available-block"
      >
        <RepoList
          testId="settings-repos-available"
          empty={
            registered === null
              ? "Loading repositories…"
              : registered.length === 0
                ? "No repository is registered with AOP yet."
                : "Every repository AOP knows is attached."
          }
        >
          {available.map((repo) => (
            <RepoRow
              key={repo.id}
              repo={repo}
              attached={false}
              busy={busyId === repo.id}
              problem={problem?.repoId === repo.id ? problem.message : null}
              onToggle={() => void change(repo, [...attachedIds, repo.id])}
            />
          ))}
        </RepoList>
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="settings-register-repo"
            onClick={openAttachRepoDialog}
          >
            <PlusIcon />
            Register another repository
          </Button>
        </div>
      </SettingsBlock>
    </div>
  );
};

type RegisteredRepoRef = Pick<RegisteredRepo, "id"> & { name: string | null; path: string | null };

const RepoList = ({
  testId,
  empty,
  children,
}: {
  testId: string;
  empty: string;
  children: ReactNode[];
}) => (
  <div data-testid={testId} className="flex max-w-xl flex-col gap-1.5">
    {children.length === 0 ? <p className="text-[12.5px] text-text-subtle">{empty}</p> : children}
  </div>
);

const RepoRow = ({
  repo,
  attached,
  busy,
  problem,
  onToggle,
}: {
  repo: RegisteredRepoRef;
  attached: boolean;
  busy: boolean;
  problem: string | null;
  onToggle: () => void;
}) => (
  <div
    data-testid="settings-repo"
    data-repo-id={repo.id}
    data-attached={attached}
    className="flex flex-col gap-1.5 rounded-row border border-border bg-raised px-3 py-2"
  >
    <div className="flex items-center gap-2.5">
      <FolderIcon className="size-4 shrink-0 text-text-subtle" strokeWidth={1.7} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-text">
          {repo.name ?? repo.path ?? "Unknown repository"}
        </span>
        <span className="block truncate text-[11.5px] text-text-subtle">
          {repo.path ?? `${repo.id} is no longer registered with AOP`}
        </span>
      </span>
      <Button
        type="button"
        variant={attached ? "secondary" : "ghost"}
        size="xs"
        data-testid={attached ? "settings-repo-detach" : "settings-repo-attach"}
        disabled={busy}
        onClick={onToggle}
      >
        {attached ? "Detach" : "Attach"}
      </Button>
    </div>
    {problem ? (
      <p role="alert" data-testid="settings-repo-error" className="text-[12.5px] text-blocked">
        {problem}
      </p>
    ) : null}
  </div>
);

// The host refuses to detach a repository any thread of the project has (409 REPO_IN_USE), whatever
// its status; its message names only the repository's id, so say which threads hold it. Only an
// unresolved thread "still works" in it: a resolved one has given up its checkout, but it still
// belongs to the repository and blocks the detach until it is deleted, and the row says so.
const explain = (cause: unknown, repo: RegisteredRepoRef, threads: readonly Thread[]): string => {
  if (!(cause instanceof ApiError)) return "Could not change the repositories";
  if (cause.code !== "REPO_IN_USE") return cause.message;
  const holders = threads.filter((thread) => thread.repoId === repo.id);
  if (holders.length === 0) return cause.message;
  const live = holders.filter((thread) => thread.status !== "resolved");
  return explainHolders(repo.name ?? repo.path ?? repo.id, live, holders.length - live.length);
};

const explainHolders = (where: string, live: readonly Thread[], resolved: number): string => {
  const working =
    live.length === 1 ? `“${live[0]?.title}” still works` : `${live.length} threads still work`;
  const done = resolved === 1 ? "1 resolved thread belongs" : `${resolved} resolved threads belong`;
  if (resolved === 0) {
    return `${working} in ${where}. Stop and delete ${live.length === 1 ? "it" : "them"} first, then detach the repository.`;
  }
  if (live.length === 0) {
    return `${done} to ${where}. Delete ${resolved === 1 ? "it" : "them"}, then detach the repository.`;
  }
  return `${working} in ${where}, and ${done} to it. Stop and delete them, then detach the repository.`;
};
