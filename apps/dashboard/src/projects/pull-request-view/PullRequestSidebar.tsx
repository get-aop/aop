import {
  type PullRequestViewDetail,
  type PullRequestViewReviewer,
  shownThreadStatus,
  type Thread,
} from "@aop/common";
import {
  CheckIcon,
  CircleDotIcon,
  EyeIcon,
  MessageSquareIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, type PullRequestViewRef, projectScreenPath } from "../../shell/router";
import { ThreadStatusDot } from "../ThreadStatusDot";
import { Avatar, LabelChip } from "./bits";

/**
 * GitHub's sidebar: reviewers and where each stands, assignees, labels, milestone, the issues
 * this closes, and AOP's own row, the thread that opened the pull request, linked to it.
 */
export const PullRequestSidebar = ({
  detail,
  owner,
  pullRequest,
}: {
  detail: PullRequestViewDetail;
  owner: Thread | null;
  pullRequest: PullRequestViewRef;
}) => (
  <aside
    data-testid="pr-sidebar"
    aria-label="Details"
    className="flex flex-col divide-y divide-border text-meta"
  >
    <Section title="AOP thread" testId="pr-sidebar-thread">
      {owner ? (
        <Link
          to={projectScreenPath({
            name: "thread",
            projectId: owner.projectId,
            threadId: owner.id,
            pullRequest,
          })}
          data-testid="pull-request-view-thread"
          className="flex items-center gap-2 text-text hover:text-running"
        >
          <ThreadStatusDot status={shownThreadStatus(owner)} />
          <span className="min-w-0 truncate">{owner.title}</span>
        </Link>
      ) : (
        <None>No thread of this project opened it</None>
      )}
    </Section>
    <Section title="Reviewers" testId="pr-sidebar-reviewers">
      {detail.reviewers.length === 0 ? (
        <None>No reviews</None>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {detail.reviewers.map((reviewer) => (
            <li
              key={reviewer.login}
              data-testid="pr-reviewer"
              data-state={reviewer.state}
              className="flex items-center gap-2"
            >
              {reviewer.isTeam ? (
                <UsersIcon className="size-5 text-text-subtle" />
              ) : (
                <Avatar user={reviewer} size={20} />
              )}
              <span className="min-w-0 flex-1 truncate text-text">{reviewer.login}</span>
              <ReviewerState state={reviewer.state} />
            </li>
          ))}
        </ul>
      )}
    </Section>
    <Section title="Assignees" testId="pr-sidebar-assignees">
      {detail.assignees.length === 0 ? (
        <None>No one assigned</None>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {detail.assignees.map((user) => (
            <li key={user.login} className="flex items-center gap-2 text-text">
              <Avatar user={user} size={20} />
              {user.login}
            </li>
          ))}
        </ul>
      )}
    </Section>
    <Section title="Labels" testId="pr-sidebar-labels">
      {detail.labels.length === 0 ? (
        <None>None yet</None>
      ) : (
        <div className="flex flex-wrap gap-1">
          {detail.labels.map((label) => (
            <LabelChip key={label.name} {...label} />
          ))}
        </div>
      )}
    </Section>
    <Section title="Milestone" testId="pr-sidebar-milestone">
      {detail.milestone ? (
        <a
          href={detail.milestone.url}
          target="_blank"
          rel="noreferrer noopener"
          className="text-text hover:text-running"
        >
          {detail.milestone.title}
        </a>
      ) : (
        <None>No milestone</None>
      )}
    </Section>
    <Section title="Development" testId="pr-sidebar-issues">
      {detail.linkedIssues.length === 0 ? (
        <None>Closes no issues</None>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {detail.linkedIssues.map((issue) => (
            <li key={issue.number}>
              <a
                href={issue.url}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-start gap-1.5 text-text hover:text-running"
              >
                <CircleDotIcon
                  className={
                    issue.state === "open"
                      ? "mt-0.5 size-3.5 shrink-0 text-ok"
                      : "mt-0.5 size-3.5 shrink-0 text-merged"
                  }
                />
                <span className="min-w-0">
                  {issue.title} <span className="text-text-subtle">#{issue.number}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Section>
  </aside>
);

const Section = ({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: ReactNode;
}) => (
  <section data-testid={testId} className="flex flex-col gap-2 py-3 first:pt-0">
    <h3 className="text-[12px] font-semibold text-text-muted">{title}</h3>
    {children}
  </section>
);

const None = ({ children }: { children: ReactNode }) => (
  <p className="text-text-subtle">{children}</p>
);

const REVIEWER_STATE: Record<PullRequestViewReviewer["state"], [ReactNode, string]> = {
  approved: [<CheckIcon key="i" className="size-4 text-ok" />, "Approved"],
  changes_requested: [<XIcon key="i" className="size-4 text-blocked" />, "Requested changes"],
  commented: [<MessageSquareIcon key="i" className="size-4 text-text-subtle" />, "Left comments"],
  dismissed: [<EyeIcon key="i" className="size-4 text-text-subtle" />, "Review dismissed"],
  requested: [
    <span key="i" className="mx-1 block size-2 rounded-full bg-waiting" />,
    "Awaiting review",
  ],
};

const ReviewerState = ({ state }: { state: PullRequestViewReviewer["state"] }) => {
  const [icon, label] = REVIEWER_STATE[state];
  return (
    <span role="img" aria-label={label} title={label} className="shrink-0">
      {icon}
    </span>
  );
};
