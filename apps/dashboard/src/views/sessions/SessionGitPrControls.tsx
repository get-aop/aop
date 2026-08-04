import { ChevronDownIcon, GitMergeIcon, GitPullRequestIcon } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { Button } from "@/ui/button";
import { type MenuListItem, MenuPanel, readAnchorRect } from "@/ui/menu-panel";
import { Spinner } from "@/ui/spinner";
import type { MergeSessionPrMethod, SessionGitStatus } from "../../api/client";
import { SessionChecksPopup } from "./SessionChecksPopup";
import type { SessionPullRequestController } from "./use-session-pull-request";

export interface ToastLink {
  url: string;
  label: string;
}

interface SessionGitPrControlsProps {
  gitStatus: SessionGitStatus;
  pr: SessionPullRequestController;
  onToast?: (message: string, link?: ToastLink) => void;
  /** Ask the page to re-fetch git status after a create/merge changed the world. */
  onChanged?: () => void;
}

/**
 * Right side of the session git bar: Create PR split button while no PR exists,
 * a checks button once one is open, and a Merge button once checks pass and the
 * PR is mergeable. The merged state renders nothing here — MergedPrBar owns it.
 */
export const SessionGitPrControls = ({
  gitStatus,
  pr,
  onToast,
  onChanged,
}: SessionGitPrControlsProps) => {
  const prState = pr.status?.pr?.state ?? gitStatus.pr?.state ?? null;
  if (prState === "OPEN") {
    return <OpenPrControls pr={pr} onToast={onToast} onChanged={onChanged} />;
  }
  if (prState === "MERGED" || prState === "CLOSED") return null;
  return <CreatePrControls gitStatus={gitStatus} pr={pr} onToast={onToast} onChanged={onChanged} />;
};

const CreatePrControls = ({
  gitStatus,
  pr,
  onToast,
  onChanged,
}: {
  gitStatus: SessionGitStatus;
  pr: SessionPullRequestController;
  onToast?: SessionGitPrControlsProps["onToast"];
  onChanged?: () => void;
}) => {
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const eligible =
    gitStatus.isGitRepo &&
    !gitStatus.isOnDefaultBranch &&
    (gitStatus.dirty || gitStatus.aheadOfBase > 0);
  if (!eligible) return null;

  if (pr.creating) {
    return (
      <span
        data-testid="working-indicator"
        className="inline-flex shrink-0 items-center gap-1.5 text-[12px] text-text-subtle"
      >
        Creating PR…
        <Spinner className="size-3.5" />
      </span>
    );
  }

  const ghReady = gitStatus.ghAvailable;
  const disabledTitle = ghReady
    ? undefined
    : "GitHub CLI unavailable — install gh and run gh auth login";

  const runCreate = async (mode: "create" | "draft" | "manual") => {
    setMenuAnchor(null);
    try {
      const result = await pr.create(mode);
      if ("compareUrl" in result) {
        window.open(result.compareUrl, "_blank", "noopener,noreferrer");
        onToast?.("Branch pushed — opening GitHub to create the PR");
      } else {
        onToast?.(`PR #${result.number} ${mode === "draft" ? "draft " : ""}created`, {
          url: result.url,
          label: `#${result.number}`,
        });
      }
      onChanged?.();
    } catch (error) {
      onToast?.(createErrorMessage(error));
    }
  };

  const items: MenuListItem[] = [
    {
      id: "create",
      label: "Create PR",
      check: true,
      onSelect: () => void runCreate("create"),
    },
    { id: "draft", label: "Create draft PR", onSelect: () => void runCreate("draft") },
    {
      id: "manual",
      label: "Manually create PR",
      onSelect: () => void runCreate("manual"),
    },
  ];

  return (
    <span className="inline-flex shrink-0 items-center" data-testid="session-create-pr">
      <Button
        size="sm"
        variant="secondary"
        data-testid="session-create-pr-primary"
        disabled={!ghReady}
        title={disabledTitle ?? "Create a pull request for this branch"}
        onClick={() => void runCreate("create")}
        className="gap-1 rounded-l-full rounded-r-none"
      >
        <GitPullRequestIcon className="size-3" strokeWidth={1.7} />
        Create PR
      </Button>
      <Button
        size="sm"
        variant="secondary"
        data-testid="session-create-pr-caret"
        aria-label="More pull request options"
        disabled={!ghReady}
        title={disabledTitle ?? "More pull request options"}
        onClick={(event) => setMenuAnchor(readAnchorRect(event))}
        className="-ml-px rounded-l-none rounded-r-pill px-1"
      >
        <ChevronDownIcon className="size-3" strokeWidth={1.7} />
      </Button>
      <MenuPanel
        open={menuAnchor !== null}
        anchor={menuAnchor}
        items={items}
        onClose={() => setMenuAnchor(null)}
        align="end"
      />
    </span>
  );
};

const OpenPrControls = ({
  pr,
  onToast,
  onChanged,
}: {
  pr: SessionPullRequestController;
  onToast?: SessionGitPrControlsProps["onToast"];
  onChanged?: () => void;
}) => {
  const [checksOpen, setChecksOpen] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const [confirmMethod, setConfirmMethod] = useState<MergeSessionPrMethod | null>(null);
  const [method, setMethod] = useState<MergeSessionPrMethod>("squash");

  const status = pr.status;
  const prNumber = status?.pr?.number ?? null;
  const checksState = status?.checksState ?? null;
  const mergeable = status?.pr?.mergeable === "MERGEABLE";
  const failingCount = status
    ? status.checks.filter((check) => check.bucket.toLowerCase() === "fail").length
    : 0;
  const mergeReady = (checksState === null || checksState === "success") && mergeable;

  const runMerge = async () => {
    const selected = confirmMethod ?? method;
    setConfirmMethod(null);
    try {
      const next = await pr.merge(selected);
      onToast?.(`PR #${next.pr?.number ?? prNumber ?? ""} merged`);
      onChanged?.();
    } catch (error) {
      onToast?.(mergeErrorMessage(error));
    }
  };

  if (pr.merging) {
    return (
      <span
        data-testid="working-indicator"
        className="inline-flex shrink-0 items-center gap-1.5 text-[12px] text-text-subtle"
      >
        Merging…
        <Spinner className="size-3.5" />
      </span>
    );
  }

  const mergeItems: MenuListItem[] = MERGE_METHODS.map((candidate) => ({
    id: candidate,
    label: `${candidate[0]?.toUpperCase() ?? ""}${candidate.slice(1)}`,
    check: candidate === method,
    onSelect: () => {
      setMethod(candidate);
      setConfirmMethod(candidate);
    },
  }));

  return (
    <span className="inline-flex shrink-0 items-center" data-testid="session-open-pr">
      {mergeReady ? (
        <>
          <Button
            size="sm"
            variant="default"
            data-testid="session-merge-primary"
            title="Merge this pull request"
            onClick={() => setConfirmMethod(method)}
            className="gap-1 rounded-l-full rounded-r-none"
          >
            <GitMergeIcon className="size-3" strokeWidth={1.7} />
            Merge
          </Button>
          <Button
            size="sm"
            variant="default"
            data-testid="session-merge-caret"
            aria-label="Choose merge method"
            title="Choose merge method"
            onClick={(event) => setMenuAnchor(readAnchorRect(event))}
            className="-ml-px rounded-l-none rounded-r-pill px-1"
          >
            <ChevronDownIcon className="size-3" strokeWidth={1.7} />
          </Button>
          <MenuPanel
            open={menuAnchor !== null}
            anchor={menuAnchor}
            items={mergeItems}
            onClose={() => setMenuAnchor(null)}
            align="end"
          />
          <AlertDialog
            open={confirmMethod !== null}
            onOpenChange={(next) => !next && setConfirmMethod(null)}
          >
            <AlertDialogContent className="w-[512px]">
              <AlertDialogHeader>
                <AlertDialogTitle>Merge pull request</AlertDialogTitle>
                <AlertDialogDescription>
                  Merge PR #{prNumber ?? "?"} with {confirmMethod ?? method}? This cannot be undone
                  from AOP.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel data-testid="confirm-dialog-cancel">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  data-testid="confirm-dialog-confirm"
                  onClick={() => void runMerge()}
                >
                  Merge
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : (
        <ChecksButton
          checksState={checksState ?? "pending"}
          failingCount={failingCount}
          onClick={() => setChecksOpen(true)}
        />
      )}
      <SessionChecksPopup open={checksOpen} status={status} onClose={() => setChecksOpen(false)} />
    </span>
  );
};

const MERGE_METHODS: readonly MergeSessionPrMethod[] = ["squash", "merge", "rebase"];

const ChecksButton = ({
  checksState,
  failingCount,
  onClick,
}: {
  checksState: "pending" | "success" | "failure";
  failingCount: number;
  onClick: () => void;
}) => {
  const presentation = CHECKS_PRESENTATION[checksState];
  return (
    <Button
      size="sm"
      variant={presentation.variant}
      data-testid="session-checks-button"
      data-state={checksState}
      title={presentation.title}
      onClick={onClick}
      className={`gap-1.5 rounded-full ${presentation.className}`}
    >
      <span
        aria-hidden="true"
        className={`inline-block h-1.5 w-1.5 rounded-full bg-current ${checksState === "pending" ? "pulse" : ""}`}
      />
      {presentation.label(failingCount)}
    </Button>
  );
};

const CHECKS_PRESENTATION: Record<
  "pending" | "success" | "failure",
  {
    variant: "secondary" | "destructive" | "default";
    title: string;
    label: (failingCount: number) => string;
    className: string;
  }
> = {
  pending: {
    variant: "secondary",
    title: "Checks are running — click to view",
    label: () => "Checks · running",
    className: "status-ready",
  },
  failure: {
    variant: "destructive",
    title: "Some checks failed — click to view",
    label: (failingCount) =>
      failingCount > 0 ? `Checks · ${failingCount} failing` : "Checks · failing",
    className: "status-blocked",
  },
  success: {
    variant: "default",
    title: "All checks passed — click to view",
    label: () => "Checks · passing",
    className: "status-success",
  },
};

const createErrorMessage = (error: unknown): string => {
  const code = errorCode(error);
  if (code === "ON_DEFAULT_BRANCH") return "Create a worktree first";
  if (code === "GH_UNAVAILABLE") return "GitHub CLI unavailable — install gh and sign in";
  return error instanceof Error ? error.message : "Could not create the pull request";
};

const mergeErrorMessage = (error: unknown): string => {
  const code = errorCode(error);
  if (code === "CHECKS_FAILING") return "Required checks have not passed yet";
  if (code === "NOT_MERGEABLE") return "GitHub says this PR is not mergeable yet";
  if (code === "GH_UNAVAILABLE") return "GitHub CLI unavailable — install gh and sign in";
  return error instanceof Error ? error.message : "Could not merge the pull request";
};

const errorCode = (error: unknown): string | null => {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
};
