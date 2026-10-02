import type { LibraryListing } from "@aop/common";
import { FilesIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Progress } from "@/ui/progress";
import { useLocalStorage } from "../../hooks/use-local-storage";
import { Link, projectSettingsPath } from "../../shell/router";
import { formatBytes } from "./library-view";

/** The share of a cap at which the meter turns to a warning. */
const NEAR_CAP = 0.85;

/**
 * Under the files: a tip about agents saving here (until dismissed), then the project's storage
 * against its cap, the host's against its own, and how long automatic files are kept.
 */
export const LibraryFooter = ({
  projectId,
  listing,
}: {
  projectId: string;
  listing: LibraryListing;
}) => {
  const [tipDismissed, setTipDismissed] = useLocalStorage("aop:library-tip-dismissed:v1", false);
  const { usage, retention } = listing;
  const share = usage.capBytes ? Math.min(1, usage.bytes / usage.capBytes) : 0;
  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-border px-3 py-2.5">
      {tipDismissed ? null : (
        <div
          data-testid="library-tip"
          className="flex items-start gap-3 rounded-card border border-border bg-raised px-3 py-2.5"
        >
          <FilesIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-text-muted" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="text-meta font-medium text-text">Agents can save files here</p>
            <p className="text-meta text-text-muted">
              Ask for a report, a doc, a diagram or an export in any thread, or ask the coordinator
              to save a summary.
            </p>
          </div>
          <button
            type="button"
            aria-label="Dismiss tip"
            data-testid="library-tip-dismiss"
            onClick={() => setTipDismissed(true)}
            className="text-text-subtle hover:text-text"
          >
            <XIcon className="size-4" />
          </button>
        </div>
      )}
      <div data-testid="library-usage" className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2 text-meta">
          <span className="text-text-muted">
            <span
              data-testid="library-usage-project"
              className="font-medium text-text tabular-nums"
            >
              {formatBytes(usage.bytes)}
            </span>
            {usage.capBytes ? ` of ${formatBytes(usage.capBytes)}` : " used, no cap"}
          </span>
          <Link
            to={projectSettingsPath(projectId, "usage")}
            data-testid="library-retention-link"
            className="shrink-0 text-text-subtle hover:text-text hover:underline"
          >
            {retention.retentionDays > 0
              ? `Auto files kept ${retention.retentionDays} days`
              : "Auto files kept"}
          </Link>
        </div>
        {usage.capBytes ? (
          <Progress
            aria-label="Library storage"
            data-testid="library-usage-meter"
            data-near-cap={share >= NEAR_CAP}
            value={Math.max(share * 100, usage.bytes > 0 ? 1 : 0)}
            className={cn(
              "h-1 bg-active",
              share >= NEAR_CAP
                ? "[&>[data-slot=progress-indicator]]:bg-waiting"
                : "[&>[data-slot=progress-indicator]]:bg-running",
            )}
          />
        ) : null}
        <span data-testid="library-usage-host" className="text-[11.5px] text-text-subtle">
          All projects on this host: {formatBytes(usage.hostBytes)}
          {usage.hostCapBytes ? ` of ${formatBytes(usage.hostCapBytes)}` : ""}
        </span>
      </div>
    </div>
  );
};
