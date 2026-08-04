import { GitMergeIcon, XIcon } from "lucide-react";
import { type MouseEvent, useState } from "react";
import { Badge } from "@/ui/badge";
import { openExternalUrl, type SessionMergedPullRequest } from "../../api/client";
import { isTauriWebView } from "../../utils/desktop-runtime";
import { formatRelativeTime } from "./sessions-runtime";

interface MergedPrBarProps {
  merged: SessionMergedPullRequest;
  /** Branch that was merged (status.pr.headRefName); falls back to the base-less dash. */
  branch: string | null;
  onDismiss: () => void;
  desktop?: boolean;
  openLink?: (url: string) => Promise<void>;
}

/** Shown above the composer once this session's pull request is merged. */
export const MergedPrBar = ({
  merged,
  branch,
  onDismiss,
  desktop = isTauriWebView(),
  openLink = openExternalUrl,
}: MergedPrBarProps) => (
  <div
    data-testid="merged-pr-bar"
    className="mb-2 flex h-7 min-w-0 items-center gap-2 rounded-control border border-accent-violet-border bg-accent-violet-fill px-2 text-[11.5px] text-accent-violet"
  >
    <GitMergeIcon className="size-3 shrink-0" strokeWidth={1.7} />
    <MergedPrLink merged={merged} desktop={desktop} openLink={openLink} />
    {merged.repoNameWithOwner ? (
      <span className="shrink-0 text-text-subtle">{merged.repoNameWithOwner}</span>
    ) : null}
    {branch ? (
      <span className="min-w-0 truncate rounded-pill border border-border px-1.5 font-mono text-[12px] text-text-subtle">
        {branch}
      </span>
    ) : null}
    <span className="ml-auto shrink-0 font-semibold">Merged</span>
    <button
      type="button"
      aria-label="Dismiss merged pull request bar"
      title="Dismiss"
      onClick={onDismiss}
      className="focus-ring shrink-0 rounded-pill p-0.5 text-text-subtle hover:text-text"
    >
      <XIcon className="size-3" strokeWidth={1.7} />
    </button>
  </div>
);

interface MergedPrLinkProps {
  merged: SessionMergedPullRequest;
  desktop: boolean;
  openLink: (url: string) => Promise<void>;
}

const MergedPrLink = ({ merged, desktop, openLink }: MergedPrLinkProps) => {
  const [hover, setHover] = useState(false);
  const openExternally = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!desktop) return;
    event.preventDefault();
    void openLink(merged.url);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the wrapper coordinates its link and hover-card focus as one interactive region
    <span
      className="relative shrink-0"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) setHover(false);
      }}
    >
      <a
        href={merged.url}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="merged-pr-link"
        className="focus-ring font-semibold underline underline-offset-2"
        onClick={openExternally}
      >
        #{merged.number}
      </a>
      {hover ? <PrHoverCard merged={merged} onClick={openExternally} /> : null}
    </span>
  );
};

/** Rich hover card for the merged PR number — all data from the status payload. */
export const PrHoverCard = ({
  merged,
  onClick,
}: {
  merged: SessionMergedPullRequest;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) => (
  <span
    data-testid="pr-hover-region"
    className="absolute bottom-full left-0 z-[var(--z-popover,50)] block pb-1"
  >
    <div
      data-testid="pr-hover-card"
      className="w-72 rounded-card border border-border bg-raised p-3 text-text shadow-3"
    >
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="border-accent-violet-border">
          Merged
        </Badge>
        <span className="text-[11.5px] text-text-subtle">
          {merged.repoNameWithOwner ? `${merged.repoNameWithOwner} ` : ""}#{merged.number}
        </span>
        {merged.mergedAt ? (
          <span className="ml-auto text-[11.5px] text-text-subtle">
            {relativeTimeLabel(merged.mergedAt)}
          </span>
        ) : null}
      </div>
      <a
        href={merged.url}
        target="_blank"
        rel="noopener noreferrer"
        className="focus-ring mt-2 block truncate text-[12px] font-medium text-text underline underline-offset-2"
        title={merged.title}
        onClick={onClick}
      >
        {merged.title}
      </a>
      {merged.authorLogin ? (
        <div className="mt-2 flex items-center gap-1.5">
          <img
            src={`https://github.com/${merged.authorLogin}.png`}
            alt=""
            width={20}
            height={20}
            className="h-5 w-5 rounded-full border border-border"
          />
          <span className="text-[11.5px] text-text-muted">{merged.authorLogin}</span>
        </div>
      ) : null}
      <div className="mt-2 flex items-center gap-2">
        <span className="font-mono text-[12px] text-ok">+{merged.additions}</span>
        <span className="font-mono text-[12px] text-blocked">−{merged.deletions}</span>
        <Badge variant="outline" className="ml-auto">
          {merged.changedFiles} {merged.changedFiles === 1 ? "file" : "files"}
        </Badge>
      </div>
    </div>
  </span>
);

const relativeTimeLabel = (timestamp: string): string => {
  const relative = formatRelativeTime(timestamp);
  return relative === "now" ? relative : `${relative} ago`;
};
