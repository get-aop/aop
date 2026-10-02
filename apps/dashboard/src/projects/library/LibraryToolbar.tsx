import {
  ArrowUpDownIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  LayoutGridIcon,
  ListIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useRef } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Spinner } from "@/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/ui/toggle-group";
import { IconButton } from "../../components/IconButton";
import type { LibraryLayout } from "./LibraryItems";
import {
  crumbsOf,
  LIBRARY_SORTS,
  LIBRARY_TYPE_FILTERS,
  type LibrarySort,
  type LibraryTypeFilter,
} from "./library-view";

/**
 * The Library's own toolbar, under the panel's tabs: where you are and "Add" on the first row;
 * search, the type filter, the sort and the layout on the second. Both rows fit a phone.
 */
export const LibraryToolbar = ({
  folder,
  onFolder,
  search,
  onSearch,
  type,
  onType,
  sort,
  onSort,
  layout,
  onLayout,
  uploading,
  onUpload,
}: {
  folder: string;
  onFolder: (folder: string) => void;
  search: string;
  onSearch: (search: string) => void;
  type: LibraryTypeFilter;
  onType: (type: LibraryTypeFilter) => void;
  sort: LibrarySort;
  onSort: (sort: LibrarySort) => void;
  layout: LibraryLayout;
  onLayout: (layout: LibraryLayout) => void;
  uploading: number;
  onUpload: (files: File[]) => void;
}) => {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div data-testid="library-toolbar" className="flex shrink-0 flex-col gap-2 px-3 pt-1 pb-2">
      <div className="flex min-h-8 items-center gap-2">
        <Crumbs folder={folder} onFolder={onFolder} />
        {uploading > 0 ? (
          <span
            data-testid="library-uploading"
            className="flex shrink-0 items-center gap-1.5 text-meta text-text-subtle"
          >
            <Spinner className="size-3.5" />
            Adding {uploading}
          </span>
        ) : null}
        <Button
          size="sm"
          data-testid="library-add"
          className="shrink-0"
          onClick={() => input.current?.click()}
        >
          <PlusIcon />
          Add
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          data-testid="library-file-input"
          onChange={(event) => {
            onUpload([...(event.target.files ?? [])]);
            event.target.value = "";
          }}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-row border border-border bg-input-surface px-2.5 focus-within:border-border-strong">
          <SearchIcon aria-hidden="true" className="size-3.5 shrink-0 text-text-subtle" />
          <input
            data-testid="library-search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onSearch("");
            }}
            placeholder="Search files"
            aria-label="Search files"
            className="min-w-0 flex-1 bg-transparent text-meta text-text outline-none placeholder:text-text-subtle"
          />
          {search ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onSearch("")}
              className="text-text-subtle hover:text-text"
            >
              <XIcon className="size-3.5" />
            </button>
          ) : null}
        </label>
        <TypeFilter type={type} onType={onType} />
        <SortMenu sort={sort} onSort={onSort} />
        <LayoutToggle layout={layout} onLayout={onLayout} />
      </div>
    </div>
  );
};

const Crumbs = ({ folder, onFolder }: { folder: string; onFolder: (folder: string) => void }) => {
  const crumbs = crumbsOf(folder);
  return (
    <nav
      aria-label="Folder"
      data-testid="library-crumbs"
      className="flex min-w-0 flex-1 items-center gap-0.5 text-body"
    >
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1;
        return (
          <span
            key={crumb.path}
            className={cn("flex items-center gap-0.5", last ? "min-w-0" : "shrink-0")}
          >
            {index > 0 ? (
              <ChevronRightIcon aria-hidden="true" className="size-3.5 shrink-0 text-text-subtle" />
            ) : null}
            {last ? (
              <span aria-current="page" className="truncate font-medium text-text">
                {crumb.label}
              </span>
            ) : (
              <button
                type="button"
                data-testid="library-crumb"
                onClick={() => onFolder(crumb.path)}
                className="truncate rounded-sm px-1 text-text-muted hover:bg-hover hover:text-text"
              >
                {crumb.label}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
};

const TypeFilter = ({
  type,
  onType,
}: {
  type: LibraryTypeFilter;
  onType: (type: LibraryTypeFilter) => void;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        data-testid="library-type-filter"
        data-value={type}
        className={cn(
          "flex h-8 shrink-0 items-center gap-1 rounded-row px-2 text-meta text-text-muted hover:bg-hover hover:text-text",
          type !== "all" && "bg-active text-text",
        )}
      >
        {type === "all" ? "Type" : LIBRARY_TYPE_FILTERS.find((filter) => filter.id === type)?.label}
        <ChevronDownIcon aria-hidden="true" className="size-3.5" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-44">
      <DropdownMenuLabel>Show</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={type}
        onValueChange={(value) => onType(value as LibraryTypeFilter)}
      >
        {LIBRARY_TYPE_FILTERS.map((filter) => (
          <DropdownMenuRadioItem
            key={filter.id}
            value={filter.id}
            data-testid="library-type-option"
            data-value={filter.id}
          >
            {filter.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);

const SortMenu = ({ sort, onSort }: { sort: LibrarySort; onSort: (sort: LibrarySort) => void }) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <IconButton testId="library-sort" label="Sort files">
        <ArrowUpDownIcon />
      </IconButton>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-44">
      <DropdownMenuLabel>Sort by</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={sort} onValueChange={(value) => onSort(value as LibrarySort)}>
        {LIBRARY_SORTS.map((option) => (
          <DropdownMenuRadioItem
            key={option.id}
            value={option.id}
            data-testid="library-sort-option"
            data-value={option.id}
          >
            {option.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
);

const LayoutToggle = ({
  layout,
  onLayout,
}: {
  layout: LibraryLayout;
  onLayout: (layout: LibraryLayout) => void;
}) => (
  <ToggleGroup
    type="single"
    aria-label="Layout"
    value={layout}
    onValueChange={(value) => {
      if (value) onLayout(value as LibraryLayout);
    }}
    className="shrink-0 rounded-row bg-raised p-0.5"
  >
    <ToggleGroupItem
      value="grid"
      aria-label="Grid"
      title="Grid"
      data-testid="library-layout-grid"
      className="size-7 min-w-7 rounded-[5px] px-0 text-text-subtle data-[state=on]:bg-active data-[state=on]:text-text"
    >
      <LayoutGridIcon className="size-3.5" />
    </ToggleGroupItem>
    <ToggleGroupItem
      value="list"
      aria-label="List"
      title="List"
      data-testid="library-layout-list"
      className="size-7 min-w-7 rounded-[5px] px-0 text-text-subtle data-[state=on]:bg-active data-[state=on]:text-text"
    >
      <ListIcon className="size-3.5" />
    </ToggleGroupItem>
  </ToggleGroup>
);
