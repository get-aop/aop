import type { SessionGitBranch, SessionGitBranchList } from "@aop/common";
import { CheckIcon, ChevronDownIcon, GitBranchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";

interface ComposerBranchPickerProps {
  branch: string | null;
  className?: string;
  disabled?: boolean;
  onListBranches?: () => Promise<SessionGitBranchList>;
  onBranchChange?: (branch: string) => Promise<void> | void;
}

/** Branch combobox — searchable picker (Command in Popover), branch badges preserved. */
export const ComposerBranchPicker = ({
  branch,
  className,
  disabled = false,
  onListBranches,
  onBranchChange,
}: ComposerBranchPickerProps) => {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<SessionGitBranch[]>([]);
  const [loading, setLoading] = useState(false);
  const [switchingBranch, setSwitchingBranch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listBranchesRef = useRef(onListBranches);
  listBranchesRef.current = onListBranches;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void listBranchesRef
      .current?.()
      .then((result) => {
        if (!cancelled) setBranches(result.branches);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not load branches");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!branch) return null;
  const pickerDisabled = disabled || !onListBranches || !onBranchChange;

  const selectBranch = async (candidate: SessionGitBranch) => {
    if (candidate.isCurrent) {
      setOpen(false);
      return;
    }
    setSwitchingBranch(candidate.name);
    setError(null);
    try {
      await onBranchChange?.(candidate.name);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not switch branches");
    } finally {
      setSwitchingBranch(null);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next && pickerDisabled) return;
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="composer-footer-branch"
          className={`flex h-6 min-w-0 max-w-full items-center gap-1 rounded-full border border-border bg-raised px-2 font-mono text-[11.5px] text-text-muted transition-colors duration-[120ms] hover:bg-hover hover:text-text disabled:opacity-50 ${className ?? ""}`}
          disabled={pickerDisabled || switchingBranch !== null}
          aria-label="Branch"
          title={disabled ? "Wait for the current run to finish" : "Switch branch"}
        >
          <GitBranchIcon className="size-3 shrink-0 opacity-70" />
          <span className="min-w-0 max-w-[240px] truncate">{branch}</span>
          <ChevronDownIcon className="size-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-80 p-0">
        <Command data-testid="branch-picker-content">
          <CommandInput placeholder="Search refs…" />
          <CommandList className="max-h-56">
            <CommandEmpty>{loading ? "Loading refs…" : "No refs found."}</CommandEmpty>
            {branches.map((candidate) => (
              <CommandItem
                key={candidate.name}
                value={candidate.name}
                disabled={switchingBranch !== null}
                onSelect={() => void selectBranch(candidate)}
              >
                <span className="flex w-full min-w-0 items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {candidate.isCurrent ? (
                      <CheckIcon className="size-3.5 shrink-0 text-running" />
                    ) : null}
                    <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
                  </span>
                  <BranchBadge branch={candidate} switching={switchingBranch === candidate.name} />
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
        {error ? (
          <div role="alert" className="border-t border-border px-3 py-2 text-[12px] text-blocked">
            {error}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
};

const BranchBadge = ({ branch, switching }: { branch: SessionGitBranch; switching: boolean }) => {
  const badge = resolveBranchBadge(branch, switching);
  return badge ? <span className="shrink-0 text-[10px] text-text-subtle">{badge}</span> : null;
};

const resolveBranchBadge = (branch: SessionGitBranch, switching: boolean): string | null => {
  if (switching) return "switching…";
  if (branch.isCurrent) return "current";
  if (branch.isDefault) return "default";
  if (branch.worktreePath) return "worktree";
  return null;
};
