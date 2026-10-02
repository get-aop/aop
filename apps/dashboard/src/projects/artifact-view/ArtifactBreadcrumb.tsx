import { ChevronRightIcon, MessageSquareIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "../../components/IconButton";
import { closeArtifactView } from "./open-artifact-view";

/** "Coordinator › <what is shown>", and × to bring the chat back. */
export const ArtifactBreadcrumb = ({ current }: { current: ReactNode }) => (
  <nav
    aria-label="Breadcrumb"
    className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2 text-meta"
  >
    <button
      type="button"
      data-testid="artifact-pane-coordinator"
      onClick={closeArtifactView}
      className="flex shrink-0 items-center gap-1.5 rounded-row px-2 py-1 text-text-subtle hover:bg-hover hover:text-text"
    >
      <MessageSquareIcon className="size-3.5" aria-hidden="true" />
      Coordinator
    </button>
    <ChevronRightIcon className="size-3.5 shrink-0 text-text-subtle" aria-hidden="true" />
    <span
      aria-current="page"
      data-testid="artifact-pane-title"
      className="min-w-0 truncate px-1 font-medium text-text"
    >
      {current}
    </span>
    <IconButton
      testId="artifact-pane-close"
      label="Close (Esc)"
      aria-keyshortcuts="Escape"
      onClick={closeArtifactView}
      className="ml-auto"
    >
      <XIcon />
    </IconButton>
  </nav>
);
