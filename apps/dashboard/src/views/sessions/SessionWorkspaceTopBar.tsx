import {
  ChevronDownIcon,
  CloudUploadIcon,
  CopyIcon,
  FolderIcon,
  GitCommitIcon,
  GitPullRequestIcon,
  PanelRightIcon,
  SquareTerminalIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { Spinner } from "@/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import type { ChatSessionDetail, CreateSessionPrMode, SessionGitStatus } from "../../api/client";
import { commitSessionGit } from "../../api/client";
import type { SessionToastLink } from "./SessionModals";
import type { SessionPullRequestController } from "./use-session-pull-request";

export interface SessionWorkspaceTopBarProps {
  session: ChatSessionDetail;
  gitStatus: SessionGitStatus | null;
  pr: SessionPullRequestController | null;
  onToast: (message: string, link?: SessionToastLink) => void;
  onGitChanged: () => void;
  trailing?: React.ReactNode;
  termOpen?: boolean;
  onToggleTerm?: () => void;
  rightPanelOpen?: boolean;
  onToggleRightPanel?: () => void;
  /** Inline title rename (PLAN §6.2 top bar). */
  onRenameTitle?: (title: string) => void;
  /** Kept for callers while worktree creation lives in the bottom checkout strip. */
  suggestedWorktreeBranch?: string;
  onCreateWorktree?: (branchName: string) => Promise<void> | void;
}

/**
 * Workspace top bar (PLAN §6.2): session title (inline rename); right side:
 * Create-PR split, terminal toggle (⌘J), ⋯ session menu. No branch text here.
 */
export const SessionWorkspaceTopBar = ({
  session,
  gitStatus,
  pr,
  onToast,
  onGitChanged,
  trailing,
  termOpen,
  onToggleTerm,
  rightPanelOpen,
  onToggleRightPanel,
  onRenameTitle,
}: SessionWorkspaceTopBarProps) => (
  <header
    data-testid="session-workspace-topbar"
    data-chat-header
    className="session-workspace-topbar flex h-[var(--session-chat-topbar-height)] shrink-0 items-center gap-3 border-b border-border px-3 sm:px-5"
  >
    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
      {session.repoName?.trim() ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 text-text-muted">
          <FolderIcon className="size-3.5 shrink-0 text-text-subtle" />
          <span className="max-w-40 truncate text-[13px] font-medium">{session.repoName}</span>
          <span aria-hidden className="text-text-subtle">
            /
          </span>
        </span>
      ) : null}
      <SessionTitle title={session.title} onRename={onRenameTitle} />
    </div>
    <div className="flex shrink-0 items-center justify-end gap-2">
      <SessionSourceControlActions
        session={session}
        gitStatus={gitStatus}
        pr={pr}
        onToast={onToast}
        onGitChanged={onGitChanged}
      />
      <WorkspaceTerminalAction open={termOpen} onToggle={onToggleTerm} />
      <WorkspaceRightPanelAction open={rightPanelOpen} onToggle={onToggleRightPanel} />
      {trailing}
    </div>
  </header>
);

const SessionTitle = ({
  title,
  onRename,
}: {
  title: string;
  onRename?: (title: string) => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);

  if (!editing) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            data-testid="session-topbar-title"
            aria-label={`Rename session: ${title}`}
            onClick={() => {
              if (!onRename) return;
              setValue(title);
              setEditing(true);
            }}
            className="min-w-0 flex-1 truncate rounded px-1 text-left text-[13.5px] font-medium text-text hover:bg-hover"
          >
            {title}
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{title}</TooltipContent>
      </Tooltip>
    );
  }

  const commit = () => {
    const next = value.trim();
    setEditing(false);
    if (next && next !== title) onRename?.(next);
  };

  return (
    <input
      data-testid="session-topbar-rename"
      className="min-w-0 flex-1 rounded border border-border-strong bg-input-surface px-1.5 py-0.5 text-[13.5px] font-medium text-text outline-none focus:border-running"
      value={value}
      // biome-ignore lint/a11y/noAutofocus: inline rename must capture the caret the moment it appears.
      autoFocus
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
        if (event.key === "Escape") setEditing(false);
      }}
    />
  );
};

const SessionSourceControlActions = ({
  session,
  gitStatus,
  pr,
  onToast,
  onGitChanged,
}: Pick<
  SessionWorkspaceTopBarProps,
  "session" | "gitStatus" | "pr" | "onToast" | "onGitChanged"
>) => {
  const [busy, setBusy] = useState(false);
  const state = useMemo(
    () => resolveSourceControlState(session, gitStatus, pr, busy),
    [busy, gitStatus, pr, session],
  );

  if (!session.workspacePath) return null;
  if (busy || pr?.creating) return <Spinner className="size-4 shrink-0" aria-label="Git…" />;

  const runCommit = async (push: boolean) => {
    setBusy(true);
    try {
      const result = await commitSessionGit(session.id, { push });
      onToast(
        result.pushed
          ? `Committed and pushed ${result.branch}`
          : `Committed changes on ${result.branch}`,
      );
      onGitChanged();
    } catch (error) {
      onToast(commitErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const runCreatePr = async (mode: CreateSessionPrMode) => {
    if (!pr) return;
    setBusy(true);
    try {
      const result = await pr.create(mode);
      if ("compareUrl" in result) {
        window.open(result.compareUrl, "_blank", "noopener,noreferrer");
        onToast("Branch pushed — opening GitHub to create the PR");
      } else {
        onToast(`PR #${result.number} ${mode === "draft" ? "draft " : ""}created`, {
          url: result.url,
          label: `#${result.number}`,
        });
      }
      onGitChanged();
    } catch (error) {
      onToast(createErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const viewPullRequest = () => {
    if (state.prUrl) window.open(state.prUrl, "_blank", "noopener,noreferrer");
  };

  const copyBranch = async () => {
    const branch = gitStatus?.branch;
    if (!branch) return;
    try {
      await navigator.clipboard.writeText(branch);
      onToast(`Copied branch ${branch}`);
    } catch {
      onToast("Could not copy the branch name");
    }
  };

  const runQuick = () => {
    runQuickSourceControlAction(state.quick.action, runCommit, runCreatePr, viewPullRequest);
  };

  return (
    <div
      role="group"
      aria-label="Git actions"
      className="flex shrink-0 items-center"
      data-testid="session-source-control-actions"
    >
      <Button
        variant={state.quick.action === "create-pr" ? "default" : "secondary"}
        size="sm"
        data-testid="session-source-control-primary"
        disabled={state.quick.disabled}
        title={state.quick.hint ?? state.quick.label}
        onClick={runQuick}
        className="rounded-r-none"
      >
        <SourceControlActionIcon action={state.quick.action} />
        <span className="hidden sm:inline">{state.quick.label}</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={state.quick.action === "create-pr" ? "default" : "secondary"}
            size="icon-sm"
            aria-label="Git action options"
            className="rounded-l-none border-l border-border"
          >
            <ChevronDownIcon aria-hidden="true" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!state.canCommit} onSelect={() => void runCommit(false)}>
            <GitCommitIcon />
            Commit
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!state.canCommitPush} onSelect={() => void runCommit(true)}>
            <CloudUploadIcon />
            Commit &amp; push
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {state.prUrl ? (
            <DropdownMenuItem onSelect={viewPullRequest}>
              <GitPullRequestIcon />
              Open on GitHub
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem
                disabled={!state.canCreatePr}
                onSelect={() => void runCreatePr("create")}
              >
                <GitPullRequestIcon />
                Create PR
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!state.canCreatePr}
                onSelect={() => void runCreatePr("draft")}
              >
                <GitPullRequestIcon />
                Draft PR
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem disabled={!gitStatus?.branch} onSelect={() => void copyBranch()}>
            <CopyIcon />
            Copy branch
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
const WorkspaceTerminalAction = ({ open, onToggle }: { open?: boolean; onToggle?: () => void }) => {
  if (!onToggle) return null;
  const label = open ? "Hide terminal (⌘J)" : "Terminal (⌘J)";
  return (
    <button
      type="button"
      data-testid="topbar-terminal-toggle"
      aria-label={label}
      aria-pressed={open}
      title={label}
      onClick={onToggle}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-control text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text",
        open && "bg-active text-text",
      )}
    >
      <SquareTerminalIcon className="size-4" strokeWidth={1.7} />
    </button>
  );
};

const WorkspaceRightPanelAction = ({
  open,
  onToggle,
}: {
  open?: boolean;
  onToggle?: () => void;
}) => {
  if (!onToggle) return null;
  return (
    <button
      type="button"
      data-testid="topbar-right-panel-toggle"
      aria-label="Toggle right panel"
      aria-pressed={open}
      title="Toggle right panel"
      onClick={onToggle}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-control text-text-subtle transition-colors duration-[120ms] hover:bg-hover hover:text-text",
        open && "bg-active text-text",
      )}
    >
      <PanelRightIcon className="size-4" strokeWidth={1.7} />
    </button>
  );
};

const SourceControlActionIcon = ({
  action,
}: {
  action: "commit" | "commit-push" | "create-pr" | "view-pr" | null;
}) => {
  const iconProps = { className: "size-3.5", "data-testid": "session-source-control-icon" };
  if (action === "commit-push") return <CloudUploadIcon {...iconProps} />;
  if (action === "create-pr" || action === "view-pr") {
    return <GitPullRequestIcon {...iconProps} />;
  }
  return <GitCommitIcon {...iconProps} />;
};

const commitErrorMessage = (error: unknown): string => {
  if (error && typeof error === "object" && "code" in error && error.code === "NO_CHANGES") {
    return "Nothing to commit";
  }
  return error instanceof Error ? error.message : "Could not commit changes";
};

const createErrorMessage = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "ON_DEFAULT_BRANCH") return "Create a worktree first";
    if (error.code === "GH_UNAVAILABLE") return "GitHub CLI unavailable — install gh and sign in";
  }
  return error instanceof Error ? error.message : "Could not create the pull request";
};

import {
  resolveSourceControlState,
  runQuickSourceControlAction,
} from "./session-source-control-state";
