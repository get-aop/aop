import { ArrowUpRightIcon, ChevronRightIcon, MessageSquareIcon, XIcon } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { IconButton } from "../../../components/IconButton";
import { useEscapeCloses, useTakeFocusFromHiddenChat } from "../../layout/covering-pane";
import { SOURCE_NAME } from "../source-marks";
import { useStartThread } from "../use-start-thread";
import { IssueDetailView } from "./IssueDetailView";
import { closeIssueView } from "./open-issue-view";
import { type IssueDetailState, useIssueDetail } from "./use-issue-detail";

/**
 * An issue in the coordinator chat's place, under a breadcrumb back to the chat, as the PR View
 * shows a pull request: its description, the parts a thread needs beside it, its comments, and
 * Start thread. It is read fresh from its source through the host each time it opens.
 */
export const IssuePane = ({ projectId, issueKey }: { projectId: string; issueKey: string }) => {
  const paneRef = useRef<HTMLDivElement>(null);
  useEscapeCloses(closeIssueView);
  useTakeFocusFromHiddenChat(paneRef, issueKey);
  const state = useIssueDetail(projectId, issueKey);
  const startThread = useStartThread(projectId);
  const issue = state.detail?.issue;
  return (
    <div
      ref={paneRef}
      tabIndex={-1}
      data-testid="issue-pane"
      data-state={state.loading ? "loading" : state.detail ? "ready" : "error"}
      className="flex min-h-0 flex-1 flex-col outline-none"
    >
      <nav
        aria-label="Breadcrumb"
        className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2 text-meta"
      >
        <button
          type="button"
          data-testid="issue-pane-coordinator"
          onClick={closeIssueView}
          className="flex items-center gap-1.5 rounded-row px-2 py-1 text-text-subtle hover:bg-hover hover:text-text"
        >
          <MessageSquareIcon className="size-3.5" aria-hidden="true" />
          Coordinator
        </button>
        <ChevronRightIcon className="size-3.5 text-text-subtle" aria-hidden="true" />
        <span aria-current="page" className="min-w-0 truncate px-1 font-medium text-text">
          {issue?.identifier ?? identifierOf(issueKey)}
        </span>
        <span className="ml-auto flex items-center gap-0.5">
          {issue ? (
            <a
              href={issue.url}
              target="_blank"
              rel="noreferrer noopener"
              data-testid="issue-pane-open"
              aria-label={`Open in ${SOURCE_NAME[issue.source]}`}
              title={`Open in ${SOURCE_NAME[issue.source]}`}
              className="grid size-7 place-items-center rounded-row text-text-subtle hover:bg-hover hover:text-text [&_svg]:size-3.5"
            >
              <ArrowUpRightIcon />
            </a>
          ) : null}
          <IconButton
            testId="issue-pane-close"
            label="Close the issue (Esc)"
            aria-keyshortcuts="Escape"
            onClick={closeIssueView}
          >
            <XIcon />
          </IconButton>
        </span>
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PaneBody projectId={projectId} state={state} startThread={startThread} />
      </div>
    </div>
  );
};

const PaneBody = ({
  projectId,
  state,
  startThread,
}: {
  projectId: string;
  state: IssueDetailState;
  startThread: ReturnType<typeof useStartThread>;
}) => {
  if (state.loading && !state.detail) {
    return (
      <p
        data-testid="issue-pane-loading"
        className="flex items-center gap-2 px-6 py-8 text-meta text-text-subtle"
      >
        <Spinner className="size-3.5" /> Reading the issue…
      </p>
    );
  }
  if (!state.detail) {
    return (
      <div data-testid="issue-pane-error" role="alert" className="flex flex-col gap-3 px-6 py-8">
        <p className="text-[14px] font-medium text-text">Could not read this issue</p>
        <p className="text-meta text-text-muted">{explain(state.error)}</p>
        <div>
          <Button
            size="sm"
            variant="secondary"
            data-testid="issue-pane-retry"
            onClick={state.reload}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }
  return <IssueDetailView projectId={projectId} detail={state.detail} startThread={startThread} />;
};

// A refused token is the person's to fix, from the tab's notice; say where.
const explain = (error: IssueDetailState["error"]): string => {
  if (error?.code === "JIRA_UNAUTHORIZED" || error?.code === "LINEAR_UNAUTHORIZED") {
    const source = error.code === "JIRA_UNAUTHORIZED" ? "Jira" : "Linear";
    return `${source} refused the saved token: it may have expired or been revoked. Reconnect ${source} from the Issues tab.`;
  }
  return error?.message ?? "The host did not answer.";
};

/** `ABC-12` or `#12`, from a list key, while the issue is being read. */
const identifierOf = (key: string): string => {
  const github = key.match(/#(\d+)$/);
  if (github) return `#${github[1]}`;
  return key.replace(/^[a-z]+:/, "");
};
