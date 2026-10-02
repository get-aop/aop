import type { ArtifactDetail } from "@aop/common";
import { CheckIcon, ChevronDownIcon, GitCompareArrowsIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { formatAgo } from "../selectors";
import { useSharedNow } from "../use-now";

/**
 * "v2 of 3": the versions of an artifact, newest first, each with what changed and when; and,
 * for text, comparing the version shown with the one before it.
 */
export const VersionMenu = ({
  detail,
  version,
  canCompare,
  onSelect,
  onCompare,
}: {
  detail: ArtifactDetail;
  version: number;
  canCompare: boolean;
  onSelect: (version: number) => void;
  onCompare: (base: number) => void;
}) => {
  const now = useSharedNow();
  const newestFirst = [...detail.versions].reverse();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="artifact-version-menu"
          className="flex h-8 items-center gap-1 rounded-row border border-border px-2 text-meta tabular-nums text-text-muted hover:bg-hover hover:text-text"
        >
          v{version}
          <span className="text-text-subtle">of {detail.versions.length}</span>
          <ChevronDownIcon aria-hidden="true" className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72" data-testid="artifact-versions">
        <DropdownMenuLabel>Versions</DropdownMenuLabel>
        {newestFirst.map((entry) => (
          <DropdownMenuItem
            key={entry.version}
            data-testid="artifact-version"
            data-version={entry.version}
            onSelect={() => onSelect(entry.version)}
            className="items-start gap-2"
          >
            <span className="w-7 shrink-0 tabular-nums font-medium">v{entry.version}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">
                {entry.note ?? (entry.version === 1 ? "First version" : "Updated")}
                {entry.version === detail.currentVersion ? (
                  <span className="text-text-subtle"> · latest</span>
                ) : null}
              </span>
              {entry.createdAt ? (
                <span className="block text-text-subtle">{formatAgo(entry.createdAt, now)}</span>
              ) : null}
            </span>
            {entry.version === version ? <CheckIcon className="size-3.5 shrink-0" /> : null}
          </DropdownMenuItem>
        ))}
        {canCompare && version > 1 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid="artifact-compare"
              onSelect={() => onCompare(version - 1)}
            >
              <GitCompareArrowsIcon className="size-3.5" />
              Compare v{version - 1} → v{version}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
