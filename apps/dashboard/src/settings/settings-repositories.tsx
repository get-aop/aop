import { EllipsisIcon, FolderIcon, PlusIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/empty";
import { getStatus, unregisterRepo } from "../api/client";
import { openAttachRepoDialog } from "../shell/dialog-store";

interface RepositorySummary {
  id: string;
  name: string | null;
  path: string;
}

const countByRepo = (items: Array<{ repoId: string }>): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.repoId] = (counts[item.repoId] ?? 0) + 1;
  }
  return counts;
};

export const buildUnregisterRepoWarning = (repoName: string, isLastRepo: boolean): string =>
  `This removes ${repoName} from AOP and deletes its data${
    isLastRepo ? " — AOP data will be factory-reset" : ""
  }. This cannot be undone.`;

/** Settings §Repositories — run-row style rows + Attach repository. */
export const SettingsRepositories = () => {
  const [repos, setRepos] = useState<RepositorySummary[] | null>(null);
  const [taskCounts, setTaskCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [unregisterTarget, setUnregisterTarget] = useState<RepositorySummary | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const status = await getStatus();
      setRepos(status.repos);
      setTaskCounts(countByRepo(status.tasks));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load repositories");
      setRepos([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const runUnregister = async (repo: RepositorySummary) => {
    setUnregisterTarget(null);
    try {
      const result = await unregisterRepo(repo.id);
      toast.success(result.factoryReset ? "AOP data factory-reset" : "Repository unregistered");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Failed to unregister repository");
    }
    await reload();
  };

  return (
    <div data-testid="section-repositories" className="flex flex-col gap-2 p-4">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-[13px] font-semibold text-text">Repositories</h2>
        <Button variant="secondary" size="sm" onClick={openAttachRepoDialog}>
          <PlusIcon className="size-3.5" />
          Attach repository
        </Button>
      </div>

      {error ? <p className="text-[12px] text-blocked">{error}</p> : null}
      {repos === null ? (
        <p className="py-6 text-center text-[12px] text-text-subtle">Loading repositories…</p>
      ) : repos.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No repositories</EmptyTitle>
            <EmptyDescription>Attach a repository to start sessions in it.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        repos.map((repo) => (
          <div
            key={repo.id}
            data-testid="settings-repo-row"
            className="flex min-w-0 items-center gap-2 rounded-row border border-border bg-raised px-3 py-2"
          >
            <FolderIcon className="size-4 shrink-0 text-text-subtle" strokeWidth={1.7} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text">
              {repo.name ?? repo.path.split("/").pop()}
            </span>
            <span className="hidden max-w-56 truncate font-mono text-[11px] text-text-subtle sm:block">
              {repo.path}
            </span>
            <Badge variant="count">{taskCounts[repo.id] ?? 0}</Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Actions for ${repo.name ?? repo.path}`}
                  className="grid size-6 shrink-0 place-items-center rounded text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text"
                >
                  <EllipsisIcon className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem variant="destructive" onSelect={() => setUnregisterTarget(repo)}>
                  Unregister
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))
      )}

      <AlertDialog
        open={unregisterTarget !== null}
        onOpenChange={(open) => !open && setUnregisterTarget(null)}
      >
        <AlertDialogContent className="w-[512px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Unregister repository?</AlertDialogTitle>
            <AlertDialogDescription>
              {unregisterTarget
                ? buildUnregisterRepoWarning(
                    unregisterTarget.name ?? unregisterTarget.path,
                    (repos?.length ?? 0) === 1,
                  )
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="unregister-confirm"
              onClick={() => unregisterTarget && void runUnregister(unregisterTarget)}
            >
              Unregister
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
