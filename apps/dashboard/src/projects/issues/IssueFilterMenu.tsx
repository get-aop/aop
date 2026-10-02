import type { IssueSource } from "@aop/common";
import { ListFilterIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Avatar } from "./issue-bits";
import {
  activeFilterCount,
  type Facet,
  type facetsOf,
  type IssueFilters,
  toggleValue,
} from "./issue-view";
import { SOURCE_NAME } from "./source-marks";

type Facets = ReturnType<typeof facetsOf>;
type FacetField = "labels" | "assignees" | "authors";

const FIELDS: { field: FacetField; label: string; empty: string }[] = [
  { field: "labels", label: "Label", empty: "No labels" },
  { field: "assignees", label: "Assignee", empty: "No assignees" },
  { field: "authors", label: "Author", empty: "No authors" },
];

/**
 * Filter by label, assignee, author and source: one submenu each, offering the values the list
 * holds with how many issues have each. Picking several values of one field shows issues with
 * any of them; filters on different fields all apply.
 */
export const IssueFilterMenu = ({
  facets,
  sources,
  filters,
  onChange,
}: {
  facets: Facets;
  /** The sources the list has, so the source filter offers only those. */
  sources: readonly IssueSource[];
  filters: IssueFilters;
  onChange: (update: (filters: IssueFilters) => IssueFilters) => void;
}) => {
  const active = activeFilterCount(filters);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="issues-filter"
          className={cn(TOOLBAR_BUTTON, active > 0 && "border-running/40 text-text")}
        >
          <ListFilterIcon aria-hidden="true" />
          Filter
          {active > 0 ? (
            <span
              data-testid="issues-filter-count"
              className="rounded-full bg-running px-1.5 text-[10.5px] font-semibold text-primary-foreground tabular-nums"
            >
              {active}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52" data-testid="issues-filter-menu">
        {FIELDS.map(({ field, label, empty }) => (
          <DropdownMenuSub key={field}>
            <DropdownMenuSubTrigger data-testid={`issues-filter-${field}`}>
              {label}
              {filters[field].length > 0 ? (
                <span className="ml-auto text-[11px] text-running tabular-nums">
                  {filters[field].length}
                </span>
              ) : null}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-80 w-60 overflow-y-auto">
              {facets[field].length === 0 ? (
                <DropdownMenuLabel className="font-normal text-text-subtle">
                  {empty}
                </DropdownMenuLabel>
              ) : (
                facets[field].map((facet) => (
                  <FacetItem
                    key={facet.value}
                    field={field}
                    facet={facet}
                    checked={filters[field].includes(facet.value)}
                    onToggle={() =>
                      onChange((current) => ({
                        ...current,
                        [field]: toggleValue(current[field], facet.value),
                      }))
                    }
                  />
                ))
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
        {sources.length > 1 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Source</DropdownMenuLabel>
            {sources.map((source) => (
              <DropdownMenuCheckboxItem
                key={source}
                data-testid="issues-filter-source"
                data-source={source}
                checked={filters.sources.includes(source)}
                onCheckedChange={() =>
                  onChange((current) => ({
                    ...current,
                    sources: toggleValue(current.sources, source),
                  }))
                }
                onSelect={(event) => event.preventDefault()}
              >
                {SOURCE_NAME[source]}
              </DropdownMenuCheckboxItem>
            ))}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const FacetItem = ({
  field,
  facet,
  checked,
  onToggle,
}: {
  field: FacetField;
  facet: Facet;
  checked: boolean;
  onToggle: () => void;
}) => (
  <DropdownMenuCheckboxItem
    data-testid="issues-filter-option"
    data-field={field}
    data-value={facet.value}
    checked={checked}
    onCheckedChange={onToggle}
    // Several values are picked in one go, so the menu stays open.
    onSelect={(event) => event.preventDefault()}
  >
    {field === "labels" ? (
      <span
        aria-hidden="true"
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: facet.color ? `#${facet.color}` : "var(--color-queued)" }}
      />
    ) : facet.value ? (
      <Avatar person={{ login: facet.label, avatarUrl: facet.avatarUrl }} size="size-4" />
    ) : null}
    <span className="min-w-0 flex-1 truncate">{facet.label}</span>
    <span className="text-[11px] text-text-subtle tabular-nums">{facet.count}</span>
  </DropdownMenuCheckboxItem>
);

export const TOOLBAR_BUTTON =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-row border border-border-strong bg-raised px-2.5 text-meta font-medium text-text-muted transition-colors duration-[120ms] hover:bg-active hover:text-text focus-visible:outline-2 focus-visible:outline-running data-[state=open]:bg-active data-[state=open]:text-text [&_svg]:size-3.5";
