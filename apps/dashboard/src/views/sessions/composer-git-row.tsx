import { ListChecksIcon } from "lucide-react";

import { ComposerBranchPicker } from "./ComposerBranchPicker";
import { ComposerWorkspacePicker } from "./ComposerWorkspacePicker";
import { GitDiffstatChip } from "./composer-shell";
import type { ChatComposerProps } from "./composer-types";

/**
 * The composer git row — BELOW the composer card, exactly today's layout:
 * left Current checkout ▾ (worktree) + diff stat; right: branch ▾ (PLAN §6.2,
 * §7.5). Chips render through ui/chip's git variant.
 */
export const ComposerGitRow = ({ props }: { props: ChatComposerProps }) => {
  const branchLabel = props.branch ?? null;
  if (!props.worktreePath && !branchLabel && !props.suggestedWorktreeBranch) return null;
  return (
    <div
      data-testid="composer-footer-strip"
      className="mx-auto flex w-full max-w-3xl items-center gap-2 px-2.5 pb-3 pt-1.5 sm:px-3"
    >
      <div className="flex min-w-0 max-w-[48%] flex-1 items-center gap-1.5 md:max-w-none md:flex-none md:shrink-0">
        <ComposerWorkspacePicker
          repoPath={props.repoPath}
          worktreePath={props.worktreePath}
          suggestedBranch={props.suggestedWorktreeBranch}
          disabled={props.assistantActive}
          onCreateWorktree={props.onCreateWorktree}
        />
        <GitDiffstatChip diffstat={props.gitDiffstat} onClick={props.onDiffstatClick} />
        {props.onOpenTasks ? (
          <button
            type="button"
            data-testid="composer-tasks-button"
            onClick={props.onOpenTasks}
            className="flex h-6 shrink-0 items-center gap-1 rounded-full border border-border bg-raised px-2 font-mono text-[11.5px] text-text-muted transition-colors duration-[120ms] hover:bg-hover hover:text-text"
          >
            <ListChecksIcon className="size-3" strokeWidth={1.7} />
            Tasks{props.tasksCount ? ` (${props.tasksCount})` : ""}
          </button>
        ) : null}
      </div>
      <ComposerBranchPicker
        className="min-w-0 flex-1 justify-end md:ml-auto md:flex-none"
        branch={branchLabel}
        disabled={props.assistantActive}
        onListBranches={props.onListBranches}
        onBranchChange={props.onBranchChange}
      />
    </div>
  );
};
