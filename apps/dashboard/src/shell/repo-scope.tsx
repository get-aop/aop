import { FolderIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Checkbox } from "@/ui/checkbox";
import { Chip } from "@/ui/chip";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { loadRepoScope, saveRepoScope } from "../utils/dashboard-state";

export interface ScopeRepo {
  id: string;
  name: string;
  /** Active (unsettled) session count. */
  sessionCount: number;
  /** Latest session activity, for recency ordering. */
  lastActivityAt: string | null;
  hasRunning: boolean;
}

/** Sidebar repo-scope state, persisted in dashboard-state. Null = All. */
export const useRepoScope = () => {
  const [scope, setScopeState] = useState<string[] | null>(loadRepoScope);

  const setScope = (next: string[] | null) => {
    const normalized = next && next.length > 0 ? next : null;
    saveRepoScope(normalized);
    setScopeState(normalized);
  };

  const toggle = (repoId: string) => {
    const base = scope ?? [];
    setScope(base.includes(repoId) ? base.filter((id) => id !== repoId) : [...base, repoId]);
  };

  return { scope, setScope, toggle };
};

const MAX_VISIBLE_CHIPS = 3;

/**
 * Repo-scope chips: All + selected∪recent (capped) + “+N” overflow popover
 * (searchable multiselect with checkboxes + session counts).
 */
export const RepoScopeChips = ({
  repos,
  scope,
  onToggle,
  onReset,
}: {
  repos: ScopeRepo[];
  scope: string[] | null;
  onToggle: (repoId: string) => void;
  onReset: () => void;
}) => {
  const [open, setOpen] = useState(false);

  const visible = useMemo(() => {
    const selected = new Set(scope ?? []);
    const chosen = repos.filter((repo) => selected.has(repo.id));
    const recent = repos
      .filter((repo) => !selected.has(repo.id))
      .sort((a, b) => (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
    return [...chosen, ...recent].slice(0, MAX_VISIBLE_CHIPS);
  }, [repos, scope]);

  const overflowCount = repos.length - visible.length;
  const selected = new Set(scope ?? []);

  return (
    <div data-testid="repo-scope-chips" className="flex flex-wrap items-center gap-1.5 px-2">
      <Chip variant="filter" on={scope === null} onClick={onReset}>
        All
      </Chip>
      {visible.map((repo) => (
        <Chip
          key={repo.id}
          variant="filter"
          on={scope !== null && selected.has(repo.id)}
          onClick={() => onToggle(repo.id)}
        >
          {repo.name}
        </Chip>
      ))}
      {overflowCount > 0 ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Chip variant="filter" aria-label="More projects">
              +{overflowCount}
            </Chip>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-0">
            <Command>
              <CommandInput placeholder="Filter projects" />
              <CommandList>
                <CommandEmpty>No projects</CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value="__all__"
                    onSelect={() => {
                      onReset();
                      setOpen(false);
                    }}
                  >
                    <Checkbox checked={scope === null} className="pointer-events-none" />
                    <span className="flex-1">All projects</span>
                  </CommandItem>
                  {repos.map((repo) => (
                    <CommandItem key={repo.id} value={repo.name} onSelect={() => onToggle(repo.id)}>
                      <Checkbox checked={selected.has(repo.id)} className="pointer-events-none" />
                      <FolderIcon className="size-3.5 text-text-subtle" />
                      <span className="min-w-0 flex-1 truncate">{repo.name}</span>
                      {repo.hasRunning ? (
                        <span className="aop-running-dot size-1.5 rounded-full bg-running motion-safe:animate-[aop-pulse_2s_ease-in-out_infinite]" />
                      ) : null}
                      <span className="text-[11px] text-text-subtle">{repo.sessionCount}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
};
