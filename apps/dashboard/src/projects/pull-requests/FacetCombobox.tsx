import type { PullRequestFacet } from "@aop/common";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { GithubAvatar } from "./GithubAvatar";

/**
 * A filter like GitHub's: a button naming it (and what is chosen), opening a searchable list of
 * the values the pull requests have, each ticked while chosen. Several can be chosen; the list
 * stays open so the person can tick more. Chosen values come first, also one no pull request
 * has any more, so it can still be unticked.
 */
export const FacetCombobox = ({
  name,
  plural,
  facets,
  selected,
  onToggle,
  onClear,
  kind,
}: {
  /** "Author": the button's name. */
  name: string;
  /** "authors", for the search box and the empty line. */
  plural: string;
  facets: readonly PullRequestFacet[];
  selected: readonly string[];
  onToggle: (value: string) => void;
  onClear: () => void;
  kind: "person" | "label";
}) => {
  const [open, setOpen] = useState(false);
  const options = optionsOf(facets, selected);
  const testId = `pr-filter-${name.toLowerCase()}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={testId}
          data-active={selected.length > 0 ? "true" : undefined}
          aria-label={`Filter by ${name.toLowerCase()}`}
          className={cn(
            "focus-ring inline-flex h-7 max-w-full shrink-0 items-center gap-1 rounded-row border px-2 text-meta transition-colors duration-[120ms]",
            selected.length > 0
              ? "border-border-strong bg-active text-text"
              : "border-border text-text-muted hover:bg-hover hover:text-text",
          )}
        >
          <span className="truncate">{triggerText(name, selected)}</span>
          <ChevronDownIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        data-testid={`${testId}-menu`}
        className="w-64 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-menu border-border-strong p-0 shadow-[var(--menu-shadow)]"
      >
        <Command>
          <CommandInput placeholder={`Filter ${plural}`} className="text-meta" />
          <CommandList className="max-h-72 p-1">
            <CommandEmpty className="py-5 text-center text-meta text-text-subtle">
              No {plural} match.
            </CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <FacetOption
                  key={option.value}
                  option={option}
                  kind={kind}
                  checked={selected.includes(option.value)}
                  onToggle={onToggle}
                  testId={`${testId}-option`}
                />
              ))}
            </CommandGroup>
          </CommandList>
          {selected.length > 0 ? (
            <button
              type="button"
              data-testid={`${testId}-clear`}
              onClick={onClear}
              className="w-full border-t border-border px-3 py-2 text-left text-meta text-text-muted hover:bg-hover hover:text-text"
            >
              Clear {name.toLowerCase()}
            </button>
          ) : null}
        </Command>
      </PopoverContent>
    </Popover>
  );
};

const FacetOption = ({
  option,
  kind,
  checked,
  onToggle,
  testId,
}: {
  option: PullRequestFacet;
  kind: "person" | "label";
  checked: boolean;
  onToggle: (value: string) => void;
  testId: string;
}) => (
  <CommandItem
    value={option.value}
    data-testid={testId}
    data-value={option.value}
    data-checked={checked ? "true" : "false"}
    aria-checked={checked}
    role="option"
    onSelect={() => onToggle(option.value)}
    className="gap-2 rounded-sm px-2 py-1.5 text-meta"
  >
    <span
      aria-hidden="true"
      className={cn(
        "grid size-3.5 shrink-0 place-items-center rounded-[4px] border",
        checked ? "border-running bg-running text-primary-foreground" : "border-border-bold",
      )}
    >
      {checked ? <CheckIcon className="size-3 text-primary-foreground" strokeWidth={3} /> : null}
    </span>
    {kind === "person" ? (
      <GithubAvatar login={option.value} avatarUrl={option.avatarUrl} size={16} />
    ) : (
      <span
        aria-hidden="true"
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: option.color ? `#${option.color}` : undefined }}
      />
    )}
    <span className="min-w-0 flex-1 truncate">{option.value}</span>
    {option.count > 0 ? (
      <span className="shrink-0 text-xs tabular-nums text-text-subtle">{option.count}</span>
    ) : null}
  </CommandItem>
);

const triggerText = (name: string, selected: readonly string[]): string => {
  if (selected.length === 0) return name;
  if (selected.length === 1) return `${name}: ${selected[0]}`;
  return `${name}: ${selected.length}`;
};

/** The chosen values first (with a zero count when no pull request has one any more), then the rest. */
const optionsOf = (
  facets: readonly PullRequestFacet[],
  selected: readonly string[],
): PullRequestFacet[] => {
  const byValue = new Map(facets.map((facet) => [facet.value, facet]));
  const chosen = selected.map(
    (value) => byValue.get(value) ?? { value, count: 0, avatarUrl: null, color: null },
  );
  return [...chosen, ...facets.filter((facet) => !selected.includes(facet.value))];
};
