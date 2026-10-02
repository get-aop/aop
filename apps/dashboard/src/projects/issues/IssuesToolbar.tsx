import type { IssueSource, IssueStateFilter } from "@aop/common";
import { ArrowDownUpIcon, SearchIcon, XIcon } from "lucide-react";
import { forwardRef } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Input } from "@/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/ui/toggle-group";
import { IssueFilterMenu, TOOLBAR_BUTTON } from "./IssueFilterMenu";
import {
  type facetsOf,
  GROUP_BY_LABEL,
  type IssueGroupBy,
  type IssueSort,
  SORT_LABEL,
} from "./issue-view";
import type { IssueView } from "./use-issue-view";

const STATES: { value: IssueStateFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

/**
 * The tab's controls: search, the open/closed/all switch, then filter and view (group by and
 * sort). Two rows, so it fits the panel at its narrowest; on a wide panel they share one.
 */
export const IssuesToolbar = forwardRef<
  HTMLInputElement,
  {
    view: IssueView;
    facets: ReturnType<typeof facetsOf>;
    sources: readonly IssueSource[];
  }
>(({ view, facets, sources }, searchRef) => (
  <div
    data-testid="issues-toolbar"
    className="flex flex-col gap-2 px-4 pt-1 pb-2.5 @2xl/issues:flex-row @2xl/issues:items-center"
  >
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <SearchField ref={searchRef} view={view} />
      <StateSwitch value={view.state} onChange={view.setState} />
    </div>
    <div className="flex items-center gap-2">
      <IssueFilterMenu
        facets={facets}
        sources={sources}
        filters={view.filters}
        onChange={view.setFilters}
      />
      <ViewMenu view={view} />
    </div>
  </div>
));

const SearchField = forwardRef<HTMLInputElement, { view: IssueView }>(({ view }, ref) => (
  <div className="relative min-w-0 flex-1">
    <SearchIcon
      aria-hidden="true"
      className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-subtle"
    />
    <Input
      ref={ref}
      data-testid="issues-search"
      type="search"
      aria-label="Search issues"
      placeholder="Search issues"
      value={view.filters.query}
      onChange={(event) => {
        const query = event.target.value;
        view.setFilters((filters) => ({ ...filters, query }));
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && view.filters.query) {
          event.stopPropagation();
          view.setFilters((filters) => ({ ...filters, query: "" }));
        }
      }}
      className="h-8 bg-raised pr-7 pl-8 text-meta md:text-meta [&::-webkit-search-cancel-button]:hidden"
    />
    {view.filters.query ? (
      <button
        type="button"
        aria-label="Clear search"
        data-testid="issues-search-clear"
        onClick={() => view.setFilters((filters) => ({ ...filters, query: "" }))}
        className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded text-text-subtle hover:text-text"
      >
        <XIcon className="size-3" />
      </button>
    ) : null}
  </div>
));

/** Open, closed or all: a segmented control, since it decides what the host reads. */
const StateSwitch = ({
  value,
  onChange,
}: {
  value: IssueStateFilter;
  onChange: (state: IssueStateFilter) => void;
}) => (
  <ToggleGroup
    type="single"
    value={value}
    // Clicking the chosen state again would clear it; a state is always chosen.
    onValueChange={(next) => next && onChange(next as IssueStateFilter)}
    aria-label="Issue state"
    data-testid="issues-state"
    data-value={value}
    className="h-8 shrink-0 rounded-row border border-border-strong bg-raised p-0.5"
  >
    {STATES.map((state) => (
      <ToggleGroupItem
        key={state.value}
        value={state.value}
        data-testid={`issues-state-${state.value}`}
        className="h-full rounded-[6px] px-2.5 text-meta font-medium text-text-subtle hover:bg-transparent hover:text-text data-[state=on]:bg-active data-[state=on]:text-text data-[state=on]:shadow-1 data-[spacing=0]:rounded-[6px]"
      >
        {state.label}
      </ToggleGroupItem>
    ))}
  </ToggleGroup>
);

const ViewMenu = ({ view }: { view: IssueView }) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" data-testid="issues-view" className={TOOLBAR_BUTTON}>
        <ArrowDownUpIcon aria-hidden="true" />
        <span className="truncate">
          {GROUP_BY_LABEL[view.groupBy]} · {SORT_LABEL[view.sort]}
        </span>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="w-52" data-testid="issues-view-menu">
      <DropdownMenuLabel>Group by</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={view.groupBy}
        onValueChange={(value) => view.setGroupBy(value as IssueGroupBy)}
      >
        {(Object.keys(GROUP_BY_LABEL) as IssueGroupBy[]).map((groupBy) => (
          <DropdownMenuRadioItem
            key={groupBy}
            value={groupBy}
            data-testid="issues-group-by"
            data-value={groupBy}
          >
            {GROUP_BY_LABEL[groupBy]}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Sort</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={view.sort}
        onValueChange={(value) => view.setSort(value as IssueSort)}
      >
        {(Object.keys(SORT_LABEL) as IssueSort[]).map((sort) => (
          <DropdownMenuRadioItem
            key={sort}
            value={sort}
            data-testid="issues-sort"
            data-value={sort}
          >
            {SORT_LABEL[sort]}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);
