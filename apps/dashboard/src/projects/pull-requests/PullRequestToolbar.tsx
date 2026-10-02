import {
  PULL_REQUEST_LIST_SORTS,
  type PullRequestListSort,
  type PullRequestListState,
} from "@aop/common";
import {
  ArrowDownUpIcon,
  RefreshCwIcon,
  SearchIcon,
  UserRoundCheckIcon,
  XIcon,
} from "lucide-react";
import type { RefObject } from "react";
import { cn } from "@/lib/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Input } from "@/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/ui/toggle-group";
import { IconButton } from "../../components/IconButton";
import { FacetCombobox } from "./FacetCombobox";
import {
  activeFilterCount,
  type PullRequestFilterControls,
  SORT_LABEL,
} from "./pull-request-filters";
import type { ReadyList } from "./use-pull-request-list";

const STATES: { id: PullRequestListState; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "closed", label: "Closed" },
  { id: "merged", label: "Merged" },
  { id: "all", label: "All" },
];

/**
 * The tab's own header under the panel's tabs: the search and Refresh, the state, then the
 * filters (author, label, assignee, involves me) and the sort, wrapping as the panel narrows.
 */
export const PullRequestToolbar = ({
  controls,
  facets,
  refreshing,
  onRefresh,
  searchRef,
}: {
  controls: PullRequestFilterControls;
  facets: ReadyList["facets"] | null;
  refreshing: boolean;
  onRefresh: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
}) => {
  const { filters, set, toggle } = controls;
  return (
    <div data-testid="pr-toolbar" className="flex flex-col gap-2 px-3 pt-1 pb-2">
      <div className="flex items-center gap-1.5">
        <SearchField value={filters.q} onChange={(q) => set("q", q)} inputRef={searchRef} />
        <IconButton
          testId="pr-refresh"
          label={refreshing ? "Refreshing" : "Refresh from GitHub"}
          onClick={onRefresh}
          aria-busy={refreshing}
        >
          <RefreshCwIcon className={cn(refreshing && "animate-spin")} />
        </IconButton>
      </div>
      <StatePicker value={filters.state} onChange={(state) => set("state", state)} />
      <div className="flex flex-wrap items-center gap-1.5">
        <FacetCombobox
          name="Author"
          plural="authors"
          kind="person"
          facets={facets?.authors ?? []}
          selected={filters.author}
          onToggle={(value) => toggle("author", value)}
          onClear={() => set("author", [])}
        />
        <FacetCombobox
          name="Label"
          plural="labels"
          kind="label"
          facets={facets?.labels ?? []}
          selected={filters.label}
          onToggle={(value) => toggle("label", value)}
          onClear={() => set("label", [])}
        />
        <FacetCombobox
          name="Assignee"
          plural="assignees"
          kind="person"
          facets={facets?.assignees ?? []}
          selected={filters.assignee}
          onToggle={(value) => toggle("assignee", value)}
          onClear={() => set("assignee", [])}
        />
        <InvolvesMe pressed={filters.involves} onChange={(on) => set("involves", on)} />
        <span className="flex-1" />
        <SortMenu value={filters.sort} onChange={(sort) => set("sort", sort)} />
      </div>
    </div>
  );
};

/** "12 pull requests" and, while any filter narrows them, the way to drop every filter. */
export const ResultLine = ({
  total,
  controls,
}: {
  total: number;
  controls: PullRequestFilterControls;
}) => {
  const active = activeFilterCount(controls.filters);
  return (
    <div className="flex min-h-6 items-center justify-between px-4 text-meta text-text-subtle">
      <span data-testid="pr-count" className="tabular-nums" aria-live="polite">
        {total} {total === 1 ? "pull request" : "pull requests"}
      </span>
      {active > 0 ? (
        <button
          type="button"
          data-testid="pr-filters-clear"
          onClick={controls.clear}
          className="inline-flex items-center gap-1 rounded-row px-1 hover:text-text"
        >
          <XIcon aria-hidden="true" className="size-3" />
          Clear filters
        </button>
      ) : null}
    </div>
  );
};

const SearchField = ({
  value,
  onChange,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) => (
  <div className="relative min-w-0 flex-1">
    <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-subtle" />
    <Input
      ref={inputRef}
      data-testid="pr-search"
      type="search"
      aria-label="Search pull requests"
      placeholder="Search pull requests"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && value) {
          event.stopPropagation();
          onChange("");
        }
      }}
      className="h-8 pl-8 text-meta md:text-meta"
    />
  </div>
);

/** Open, Closed, Merged, All: one of them, like GitHub's tabs over its list (arrow keys move). */
const StatePicker = ({
  value,
  onChange,
}: {
  value: PullRequestListState;
  onChange: (state: PullRequestListState) => void;
}) => (
  <ToggleGroup
    type="single"
    value={value}
    onValueChange={(next) => {
      // Radix offers "" when the chosen one is clicked again; a state is always chosen.
      if (next) onChange(next as PullRequestListState);
    }}
    aria-label="State"
    data-testid="pr-state"
    className="grid w-full grid-cols-4 gap-0.5 rounded-row border border-border bg-input-surface p-0.5"
  >
    {STATES.map((state) => (
      <ToggleGroupItem
        key={state.id}
        value={state.id}
        data-testid={`pr-state-${state.id}`}
        className="h-6 rounded-[6px] px-1 text-meta font-normal text-text-subtle hover:bg-transparent hover:text-text data-[state=on]:bg-active data-[state=on]:font-medium data-[state=on]:text-text data-[state=on]:shadow-1"
      >
        {state.label}
      </ToggleGroupItem>
    ))}
  </ToggleGroup>
);

const InvolvesMe = ({
  pressed,
  onChange,
}: {
  pressed: boolean;
  onChange: (on: boolean) => void;
}) => (
  <button
    type="button"
    data-testid="pr-involves"
    aria-pressed={pressed}
    title="Pull requests you wrote, are assigned, or review"
    onClick={() => onChange(!pressed)}
    className={cn(
      "focus-ring inline-flex h-7 shrink-0 items-center gap-1 rounded-row border px-2 text-meta transition-colors duration-[120ms]",
      pressed
        ? "border-running/40 bg-running/15 text-running"
        : "border-border text-text-muted hover:bg-hover hover:text-text",
    )}
  >
    <UserRoundCheckIcon aria-hidden="true" className="size-3.5" />
    Involves me
  </button>
);

const SortMenu = ({
  value,
  onChange,
}: {
  value: PullRequestListSort;
  onChange: (sort: PullRequestListSort) => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        data-testid="pr-sort"
        aria-label={`Sort: ${SORT_LABEL[value]}`}
        title={`Sort: ${SORT_LABEL[value]}`}
        className="focus-ring inline-flex h-7 shrink-0 items-center gap-1 rounded-row px-1.5 text-meta text-text-muted hover:bg-hover hover:text-text"
      >
        <ArrowDownUpIcon aria-hidden="true" className="size-3.5" />
        <span className="max-w-32 truncate">{SORT_LABEL[value]}</span>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" data-testid="pr-sort-menu" className="w-56">
      <DropdownMenuLabel>Sort by</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={value}
        onValueChange={(next) => onChange(next as PullRequestListSort)}
      >
        {PULL_REQUEST_LIST_SORTS.map((sort) => (
          <DropdownMenuRadioItem key={sort} value={sort} data-testid={`pr-sort-${sort}`}>
            {SORT_LABEL[sort]}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);
