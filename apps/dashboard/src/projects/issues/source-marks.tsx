import type { IssueSource } from "@aop/common";
import { cn } from "@/lib/cn";

/*
 * The two sources' marks, drawn inline: the icon set has no brand marks. GitHub's is the
 * Octicons mark; Linear's is its logo. Both take the text colour, so they sit quietly in a row.
 */

const GITHUB_PATH =
  "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z";

const LINEAR_PATH =
  "M1.225 61.523c-.222-.949.908-1.546 1.597-.857l36.512 36.512c.69.69.092 1.82-.857 1.597-18.425-4.323-32.93-18.827-37.252-37.252ZM.002 46.889a.99.99 0 0 0 .29.76L52.35 99.709c.201.2.478.307.761.29 2.369-.148 4.694-.46 6.962-.927.765-.157 1.03-1.096.478-1.648L2.576 39.448c-.552-.551-1.491-.286-1.648.479a50.067 50.067 0 0 0-.926 6.962ZM4.21 29.705a.988.988 0 0 0 .208 1.1l64.776 64.776c.289.29.726.375 1.1.208a49.908 49.908 0 0 0 5.185-2.684.981.981 0 0 0 .183-1.54L8.436 24.336a.981.981 0 0 0-1.541.183 49.896 49.896 0 0 0-2.684 5.185Zm8.448-11.631a.986.986 0 0 1-.045-1.354C21.78 6.46 35.111 0 49.952 0 77.592 0 100 22.407 100 50.048c0 14.84-6.46 28.172-16.72 37.338a.986.986 0 0 1-1.354-.045L12.659 18.074Z";

export const GithubMark = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className={cn("size-4 fill-current", className)}>
    <path d={GITHUB_PATH} />
  </svg>
);

export const LinearMark = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 100 100" aria-hidden="true" className={cn("size-4 fill-current", className)}>
    <path d={LINEAR_PATH} />
  </svg>
);

export const SOURCE_NAME: Record<IssueSource, string> = { github: "GitHub", linear: "Linear" };

/** The mark of an issue's source, named for a screen reader. */
export const SourceMark = ({ source, className }: { source: IssueSource; className?: string }) => {
  const Mark = source === "github" ? GithubMark : LinearMark;
  return (
    <span
      role="img"
      aria-label={SOURCE_NAME[source]}
      title={SOURCE_NAME[source]}
      data-testid="issue-source"
      data-source={source}
      className={cn("inline-flex shrink-0 text-text-subtle", className)}
    >
      <Mark className="size-3.5" />
    </span>
  );
};
