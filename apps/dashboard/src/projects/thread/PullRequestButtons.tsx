import { ChevronDownIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Spinner } from "@/ui/spinner";
import type { MergeMethod } from "../../api/threads";
import type { PullRequestControls } from "./use-pull-request";

const MERGE_METHODS: { method: MergeMethod; label: string }[] = [
  { method: "squash", label: "Squash and merge" },
  { method: "merge", label: "Create a merge commit" },
  { method: "rebase", label: "Rebase and merge" },
];

// The bar is slim: its buttons are 24px, taller on a phone where a finger presses them. They are
// secondary, never the filled white of a page's one main action.
const SLIM = "h-6 max-sm:h-9";
const SPLIT_MAIN = cn(SLIM, "rounded-r-none px-2 text-meta font-normal");
const SPLIT_MENU = cn(SLIM, "rounded-l-none border-l-0 px-1 max-sm:w-8 [&_svg]:size-3.5");

/** "Create PR" with a chevron for the draft variant: one control in two parts. */
export const OpenButton = ({
  controls,
  disabled,
}: {
  controls: PullRequestControls;
  disabled: boolean;
}) => (
  <div className="flex shrink-0 items-center">
    <Button
      type="button"
      size="sm"
      variant="secondary"
      data-testid="pr-open"
      disabled={disabled}
      onClick={() => void controls.open()}
      className={SPLIT_MAIN}
    >
      {controls.busy === "open" ? <Spinner className="size-3.5" /> : null}
      {controls.busy === "open" ? "Creating…" : "Create PR"}
    </Button>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          data-testid="pr-open-menu"
          aria-label="More ways to open"
          disabled={disabled}
          className={SPLIT_MENU}
        >
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          data-testid="pr-open-draft"
          onSelect={() => void controls.open({ draft: true })}
        >
          Open as draft
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);

/** "Merge" with a chevron for the method; the method chosen stays for this bar. */
export const MergeButton = ({
  controls,
  disabled,
}: {
  controls: PullRequestControls;
  disabled: boolean;
}) => {
  const [method, setMethod] = useState<MergeMethod>("squash");
  return (
    <div className="flex shrink-0 items-center">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        data-testid="pr-merge"
        data-method={method}
        disabled={disabled}
        onClick={() => void controls.merge(method)}
        className={SPLIT_MAIN}
      >
        {controls.busy === "merge" ? <Spinner className="size-3.5" /> : null}
        {controls.busy === "merge" ? "Merging…" : "Merge"}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            data-testid="pr-merge-menu"
            aria-label="Merge method"
            disabled={disabled}
            className={SPLIT_MENU}
          >
            <ChevronDownIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" data-testid="pr-merge-methods">
          <DropdownMenuRadioGroup
            value={method}
            onValueChange={(value) => setMethod(value as MergeMethod)}
          >
            {MERGE_METHODS.map(({ method: value, label }) => (
              <DropdownMenuRadioItem key={value} value={value} data-testid={`pr-merge-${value}`}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

/** Reads the pull request again from GitHub: an icon, with its name in the tooltip. */
export const SyncButton = ({
  controls,
  disabled,
}: {
  controls: PullRequestControls;
  disabled: boolean;
}) => (
  <Button
    type="button"
    size="icon-sm"
    variant="ghost"
    data-testid="pr-sync"
    aria-label={controls.busy === "sync" ? "Syncing with GitHub" : "Sync with GitHub"}
    title="Sync with GitHub"
    disabled={disabled}
    onClick={() => void controls.sync()}
    className={cn(SLIM, "w-6 shrink-0 max-sm:w-9 [&_svg]:size-3.5")}
  >
    {controls.busy === "sync" ? <Spinner className="size-3.5" /> : <RefreshCwIcon />}
  </Button>
);
