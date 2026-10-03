import { ChevronRightIcon, MessageSquareIcon, XIcon } from "lucide-react";
import { useRef } from "react";
import { IconButton } from "../../components/IconButton";
import type { PullRequestViewRef } from "../../shell/router";
import type { ProjectChat } from "../chat/project-chat";
import { useEscapeCloses, useTakeFocusFromHiddenChat } from "../layout/covering-pane";
import type { ProjectEntry } from "../projects-state";
import { closePullRequestView } from "./open-pull-request-view";
import { askThroughChat, PullRequestView } from "./PullRequestView";

/**
 * A pull request in the coordinator chat's place, under a breadcrumb back to the chat. The chat
 * is hidden underneath, never unmounted, so "Coordinator", × and Escape bring it back as it was.
 */
export const PullRequestPane = ({
  entry,
  pullRequest,
  chat,
}: {
  entry: ProjectEntry;
  pullRequest: PullRequestViewRef;
  /** "Ask the coordinator" sends through it, then brings the chat back to show the answer. */
  chat: Pick<ProjectChat, "send">;
}) => {
  const paneRef = useRef<HTMLDivElement>(null);
  useEscapeCloses(closePullRequestView);
  useTakeFocusFromHiddenChat(paneRef, `${pullRequest.repoId}#${pullRequest.number}`);
  return (
    <div
      ref={paneRef}
      tabIndex={-1}
      data-testid="pull-request-pane"
      className="flex min-h-0 flex-1 flex-col outline-none"
    >
      <nav
        aria-label="Breadcrumb"
        className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2 text-meta"
      >
        <button
          type="button"
          data-testid="pull-request-pane-coordinator"
          onClick={closePullRequestView}
          className="flex items-center gap-1.5 rounded-row px-2 py-1 text-text-subtle hover:bg-hover hover:text-text"
        >
          <MessageSquareIcon className="size-3.5" aria-hidden="true" />
          Coordinator
        </button>
        <ChevronRightIcon className="size-3.5 text-text-subtle" aria-hidden="true" />
        <span aria-current="page" className="px-1 font-medium text-text">
          PR #{pullRequest.number}
        </span>
        <IconButton
          testId="pull-request-pane-close"
          label="Close the pull request (Esc)"
          aria-keyshortcuts="Escape"
          onClick={closePullRequestView}
          className="ml-auto"
        >
          <XIcon />
        </IconButton>
      </nav>
      <PullRequestView
        key={`${pullRequest.repoId}#${pullRequest.number}`}
        entry={entry}
        pullRequest={pullRequest}
        onAsk={askThroughChat((text) => chat.send(text), closePullRequestView)}
      />
    </div>
  );
};
