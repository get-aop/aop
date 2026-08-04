import {
  ArrowUpRightIcon,
  CheckIcon,
  CircleXIcon,
  LoaderCircleIcon,
  MinusIcon,
} from "lucide-react";
import type { MouseEvent } from "react";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/ui/dialog";
import {
  openExternalUrl,
  type SessionPullRequestCheck,
  type SessionPullRequestStatus,
} from "../../api/client";
import { isTauriWebView } from "../../utils/desktop-runtime";

interface SessionChecksPopupProps {
  open: boolean;
  status: SessionPullRequestStatus | null;
  onClose: () => void;
  desktop?: boolean;
  openLink?: (url: string) => Promise<void>;
}

/**
 * Native checks popup — gh checks data grouped by workflow. Explicitly NOT an
 * iframe of github.com (GitHub's frame-ancestors policy forbids embedding).
 */
export const SessionChecksPopup = ({
  open,
  status,
  onClose,
  desktop = isTauriWebView(),
  openLink = openExternalUrl,
}: SessionChecksPopupProps) => {
  if (!open) return null;
  const pr = status?.pr ?? null;
  const groups = groupChecksByWorkflow(status?.checks ?? []);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        aria-label="Pull request checks"
        data-testid="session-checks-popup"
        className="w-[512px] max-h-[70vh] overflow-y-auto"
        showCloseButton={false}
      >
        <div className="px-5 pt-4 pb-3">
          <p className="text-[11px] font-medium text-text-subtle">Pull request checks</p>
          <h2
            className="mt-1 text-[15px] font-semibold text-text"
            data-testid="session-checks-popup-title"
          >
            {pr ? `${pr.title} · #${pr.number}` : "Loading…"}
          </h2>
        </div>
        <div className="px-5 pb-3">
          {groups.length === 0 ? (
            <p className="py-4 text-[12px] text-text-muted" data-testid="session-checks-empty">
              {status ? "No checks reported for this pull request." : "Loading checks…"}
            </p>
          ) : (
            groups.map((group) => (
              <section key={group.workflow} className="py-2" data-testid="session-checks-group">
                <h3 className="text-[12px] font-semibold text-text-subtle">{group.workflow}</h3>
                <ul className="mt-1 flex flex-col gap-1">
                  {group.checks.map((check) => (
                    <CheckRow
                      key={`${group.workflow}:${check.name}`}
                      check={check}
                      desktop={desktop}
                      openLink={openLink}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          {pr ? (
            <Button
              size="sm"
              data-testid="session-checks-open-github"
              onClick={() => openExternal(pr.url, desktop, openLink)}
            >
              Open on GitHub
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const CheckRow = ({
  check,
  desktop,
  openLink,
}: {
  check: SessionPullRequestCheck;
  desktop: boolean;
  openLink: (url: string) => Promise<void>;
}) => {
  const presentation = checkPresentation(check);
  const duration = formatCheckDuration(check.startedAt, check.completedAt);
  return (
    <li
      className="flex items-center gap-2 rounded-control border border-border bg-raised px-3 py-2"
      data-testid="session-check-row"
      data-state={presentation.state}
    >
      <presentation.icon
        className={`${presentation.colorClass} size-3.5 shrink-0 ${presentation.spin ? "animate-spin" : ""}`}
        strokeWidth={1.7}
      />
      <span className="min-w-0 flex-1 truncate text-[11.5px] text-text" title={check.name}>
        {check.name}
      </span>
      {check.description ? (
        <span
          className="hidden max-w-40 truncate text-[11.5px] text-text-subtle sm:inline"
          title={check.description}
        >
          {check.description}
        </span>
      ) : null}
      <span className="shrink-0 font-mono text-[12px] text-text-subtle">{duration}</span>
      {check.link ? (
        <a
          href={check.link}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${check.name} on GitHub`}
          title="Open on GitHub"
          className="focus-ring shrink-0 text-text-muted hover:text-text"
          onClick={(event) => openExternalLink(event, check.link ?? "", desktop, openLink)}
        >
          <ArrowUpRightIcon className="size-3" strokeWidth={1.7} />
        </a>
      ) : null}
    </li>
  );
};

const openExternal = (
  url: string,
  desktop: boolean,
  openLink: (url: string) => Promise<void>,
): void => {
  if (desktop) {
    void openLink(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
};

const openExternalLink = (
  event: MouseEvent<HTMLAnchorElement>,
  url: string,
  desktop: boolean,
  openLink: (url: string) => Promise<void>,
): void => {
  if (!desktop) return;
  event.preventDefault();
  void openLink(url);
};

type CheckRowState = "success" | "failure" | "pending" | "skipped";

const checkPresentation = (
  check: SessionPullRequestCheck,
): {
  state: CheckRowState;
  icon: typeof CheckIcon;
  colorClass: string;
  spin: boolean;
} => {
  switch (normalizeCheckBucket(check)) {
    case "success":
      return { state: "success", icon: CheckIcon, colorClass: "text-ok", spin: false };
    case "failure":
      return { state: "failure", icon: CircleXIcon, colorClass: "text-blocked", spin: false };
    case "skipped":
      return { state: "skipped", icon: MinusIcon, colorClass: "text-text-subtle", spin: false };
    default:
      return { state: "pending", icon: LoaderCircleIcon, colorClass: "text-favorite", spin: true };
  }
};

const normalizeCheckBucket = (check: SessionPullRequestCheck): CheckRowState => {
  const bucket = check.bucket.toLowerCase();
  if (bucket === "pass") return "success";
  if (bucket === "fail") return "failure";
  if (bucket === "skipping" || bucket === "cancel") return "skipped";
  const state = check.state.toUpperCase();
  if (state === "SUCCESS" || state === "NEUTRAL") return "success";
  if (state === "FAILURE" || state === "ERROR" || state === "TIMED_OUT") return "failure";
  if (state === "SKIPPED" || state === "CANCELLED") return "skipped";
  return "pending";
};

export const formatCheckDuration = (
  startedAt: string | null,
  completedAt: string | null,
): string => {
  if (!startedAt) return "queued";
  const start = new Date(startedAt).getTime();
  if (!completedAt) return Number.isFinite(start) ? "running" : "queued";
  const end = new Date(completedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "";
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
};

interface CheckGroup {
  workflow: string;
  checks: SessionPullRequestCheck[];
}

const groupChecksByWorkflow = (checks: SessionPullRequestCheck[]): CheckGroup[] => {
  const groups = new Map<string, SessionPullRequestCheck[]>();
  for (const check of checks) {
    const workflow = check.workflow.trim() || "Checks";
    const list = groups.get(workflow) ?? [];
    list.push(check);
    groups.set(workflow, list);
  }
  return [...groups.entries()].map(([workflow, groupChecks]) => ({
    workflow,
    checks: groupChecks,
  }));
};
