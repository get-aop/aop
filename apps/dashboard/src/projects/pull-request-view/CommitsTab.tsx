import type { PullRequestViewCommit, PullRequestViewDetail } from "@aop/common";
import { GitCommitHorizontalIcon } from "lucide-react";
import { plural } from "./bits";
import { EmptyTab } from "./ChecksTab";
import { CommitLine } from "./Timeline";

/** The Commits tab: the branch's commits grouped by the day they were committed, oldest first. */
export const CommitsTab = ({ detail }: { detail: PullRequestViewDetail }) => {
  if (detail.commits.length === 0) {
    return (
      <EmptyTab testId="pr-commits-empty" title="No commits">
        This pull request has no commits.
      </EmptyTab>
    );
  }
  return (
    <section data-testid="pr-commits-tab" className="flex flex-col gap-4">
      {detail.commitCount > detail.commits.length ? (
        <p className="text-meta text-text-subtle">
          Showing the latest {plural(detail.commits.length, "commit")} of {detail.commitCount}.{" "}
          <a href={`${detail.url}/commits`} target="_blank" rel="noreferrer noopener" className="text-running hover:underline">
            See all on GitHub
          </a>
        </p>
      ) : null}
      {byDay(detail.commits).map(([day, commits]) => (
        <div key={day} className="flex flex-col gap-1.5">
          <h3 className="flex items-center gap-2 text-meta text-text-muted">
            <GitCommitHorizontalIcon className="size-4" aria-hidden="true" />
            Commits on {day}
          </h3>
          <ul className="flex flex-col divide-y divide-border rounded-card border border-border-strong px-3 py-1">
            {commits.map((commit) => (
              <CommitLine key={commit.sha} commit={commit} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
};

export const byDay = (commits: PullRequestViewCommit[]): [string, PullRequestViewCommit[]][] => {
  const days = new Map<string, PullRequestViewCommit[]>();
  for (const commit of commits) {
    const day = new Date(commit.committedAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    days.set(day, [...(days.get(day) ?? []), commit]);
  }
  return [...days];
};
