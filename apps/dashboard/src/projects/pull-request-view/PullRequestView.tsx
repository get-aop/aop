import { ExternalLinkIcon } from "lucide-react";
import { Link, type PullRequestViewRef, projectScreenPath } from "../../shell/router";
import { PullRequestChip } from "../PullRequestChip";
import type { ProjectEntry } from "../projects-state";
import { pullRequestOf } from "../selectors";
import { threadOwningPullRequest } from "./owning-thread";

/** One pull request, as far as the project's threads know it. */
export const PullRequestView = ({
  entry,
  pullRequest,
}: {
  entry: ProjectEntry;
  pullRequest: PullRequestViewRef;
}) => {
  const owner = threadOwningPullRequest(entry.threads, pullRequest);
  const known = owner ? pullRequestOf(owner) : null;
  return (
    <div data-testid="pull-request-view" className="min-h-0 flex-1 overflow-auto px-6 py-5">
      <h2 className="flex items-center gap-2 text-title font-semibold text-text">
        Pull request #{pullRequest.number}
        {known ? <PullRequestChip pullRequest={known} testId="pull-request-view-state" /> : null}
      </h2>
      {owner ? (
        <p className="mt-2 text-body text-text-muted">
          Opened by the thread{" "}
          <Link
            to={projectScreenPath({
              name: "thread",
              projectId: owner.projectId,
              threadId: owner.id,
              pullRequest,
            })}
            data-testid="pull-request-view-thread"
            className="text-running hover:underline"
          >
            {owner.title}
          </Link>
        </p>
      ) : null}
      {known ? (
        <a
          href={known.url}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-3 inline-flex items-center gap-1.5 text-meta text-text-subtle hover:text-text"
        >
          <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
          Open on GitHub
        </a>
      ) : null}
    </div>
  );
};
