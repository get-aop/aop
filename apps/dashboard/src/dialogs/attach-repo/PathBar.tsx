import { ArrowUpIcon } from "lucide-react";
import { Spinner } from "@/ui/spinner";
import { GitKindBadge } from "./DirectoryList";
import { PathField } from "./PathField";
import type { useDirectoryBrowser } from "./use-directory-browser";

/** The bar on top of the Attach dialog: up one level, the path field, and what the folder is to git. */
export const PathBar = ({ browser }: { browser: ReturnType<typeof useDirectoryBrowser> }) => {
  const { listing } = browser;
  const parent = listing?.parent ?? undefined;
  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded-row border border-border bg-raised px-2.5 py-1.5 font-mono text-[11.5px] text-text-muted">
      {parent ? (
        <button
          type="button"
          data-testid="attach-repo-up"
          aria-label="Up one level"
          onClick={() => void browser.show(parent)}
          className="grid size-6 shrink-0 place-items-center rounded text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text"
        >
          <ArrowUpIcon className="size-3.5" />
        </button>
      ) : null}
      <PathField
        value={browser.draft}
        onType={browser.type}
        onEnter={browser.enter}
        onComplete={browser.complete}
        onMove={browser.move}
        onLeave={browser.resetDraft}
      />
      {browser.loading ? <Spinner className="size-3 shrink-0" /> : null}
      <GitKindBadge kind={listing?.gitKind ?? undefined} testId="attach-repo-git-badge" />
    </div>
  );
};
