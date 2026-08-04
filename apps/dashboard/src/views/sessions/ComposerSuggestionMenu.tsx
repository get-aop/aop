import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Command, CommandGroup, CommandItem, CommandList } from "@/ui/command";

export interface ComposerSuggestionItem {
  id: string;
  label: string;
  description?: string;
  icon?: ReactNode;
}

interface ComposerSuggestionMenuProps {
  testId: string;
  ariaLabel: string;
  heading?: string;
  items: ComposerSuggestionItem[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onPick: (index: number) => void;
}

export const ComposerSuggestionMenu = ({
  testId,
  ariaLabel,
  heading,
  items,
  activeIndex,
  onActiveIndexChange,
  onPick,
}: ComposerSuggestionMenuProps) => (
  <Command shouldFilter={false}>
    <div
      data-testid={testId}
      data-slot="autocomplete-popup"
      data-composer-menu-surface="true"
      className="relative w-full overflow-hidden rounded-[20px] border border-border/80 bg-popover/96 shadow-lg/8 backdrop-blur-xs"
    >
      <CommandList aria-label={ariaLabel} className="max-h-72">
        <CommandGroup
          heading={heading}
          className={cn(
            "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2",
            "[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:normal-case",
            "[&_[cmdk-group-heading]]:tracking-normal [&_[cmdk-group-heading]]:text-text-subtle",
          )}
        >
          {items.map((item, index) => (
            <CommandItem
              key={item.id}
              value={item.id}
              data-composer-item-id={item.id}
              className={cn(
                "cursor-pointer select-none gap-2 hover:bg-transparent hover:text-inherit data-highlighted:bg-transparent data-highlighted:text-inherit",
                activeIndex === index && "bg-accent! text-accent-foreground!",
              )}
              onMouseMove={() => {
                if (activeIndex !== index) onActiveIndexChange(index);
              }}
              onMouseDown={(event) => event.preventDefault()}
              onSelect={() => onPick(index)}
            >
              {item.icon ? (
                <span className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground/80">
                  {item.icon}
                </span>
              ) : null}
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="shrink-0">{item.label}</span>
                {item.description ? (
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground/70">
                    {item.description}
                  </span>
                ) : null}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </div>
  </Command>
);
