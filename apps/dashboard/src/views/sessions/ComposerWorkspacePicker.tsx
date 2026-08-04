import { FolderGit2Icon, FolderGitIcon, FolderIcon } from "lucide-react";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/ui/select";

interface ComposerWorkspacePickerProps {
  repoPath: string;
  worktreePath?: string | null;
  suggestedBranch?: string | null;
  disabled?: boolean;
  onCreateWorktree?: (branchName: string) => Promise<void> | void;
}

export const ComposerWorkspacePicker = ({
  repoPath,
  worktreePath,
  suggestedBranch,
  disabled = false,
  onCreateWorktree,
}: ComposerWorkspacePickerProps) => {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeWorktree = isDifferentWorkspace(repoPath, worktreePath);
  const canCreate = Boolean(suggestedBranch && onCreateWorktree);

  if (activeWorktree) {
    return (
      <span
        data-testid="composer-workspace-current"
        className="inline-flex items-center gap-1 px-2 text-[12px] font-medium text-text-subtle"
      >
        <FolderGitIcon className="size-3" />
        Current worktree
      </span>
    );
  }

  if (!canCreate) {
    return (
      <span className="inline-flex items-center gap-1 px-2 text-[12px] font-medium text-text-subtle">
        <FolderIcon className="size-3" />
        Local checkout
      </span>
    );
  }

  const createWorktree = async () => {
    if (!suggestedBranch || !onCreateWorktree || creating) return;
    setCreating(true);
    setError(null);
    try {
      await onCreateWorktree(suggestedBranch);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the worktree");
      setOpen(true);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Select
      open={open}
      onOpenChange={(next) => {
        // Radix emits onValueChange before onOpenChange(false); only clear
        // errors when (re)opening or the failure text would be wiped.
        if (next) setError(null);
        setOpen(next);
      }}
      value="local"
      onValueChange={(value) => {
        if (value === "worktree") void createWorktree();
        if (value === "local") setOpen(false);
      }}
    >
      <SelectTrigger
        size="sm"
        className="h-7 w-auto min-w-0 max-w-full gap-1.5 border-transparent bg-transparent px-2 text-[12px] font-medium text-text-muted shadow-none hover:bg-hover"
        aria-label="Workspace"
        data-testid="composer-worktree"
        disabled={disabled || creating}
        title={disabled ? "Wait for the current run to finish" : "Choose workspace"}
      >
        <SelectValue placeholder="Current checkout" />
      </SelectTrigger>
      <SelectContent side="top" align="start" className="w-64">
        <SelectGroup>
          <SelectLabel>Workspace</SelectLabel>
          <SelectItem value="local">
            <span className="inline-flex items-center gap-1.5">
              <FolderIcon className="size-3" />
              Current checkout
            </span>
          </SelectItem>
          <SelectItem value="worktree" data-testid="composer-worktree-branch" disabled={creating}>
            <span className="inline-flex items-center gap-1.5">
              <FolderGit2Icon className="size-3" />
              New worktree
            </span>
          </SelectItem>
        </SelectGroup>
        {error ? (
          <div role="alert" className="border-t border-border px-3 py-2 text-[12px] text-blocked">
            {error}
          </div>
        ) : null}
      </SelectContent>
    </Select>
  );
};

const isDifferentWorkspace = (repoPath: string, worktreePath?: string | null): boolean => {
  if (!worktreePath) return false;
  return normalizePath(worktreePath) !== normalizePath(repoPath);
};

const normalizePath = (path: string): string => path.replace(/\/+$/, "");
