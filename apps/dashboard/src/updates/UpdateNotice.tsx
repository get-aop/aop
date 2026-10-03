import { type ReactNode, useState } from "react";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { openExternalUrl } from "../api/settings";
import { useIsHostOwner } from "../settings/use-host-owner";
import { clearUpdateError, startUpdate } from "./update-store";
import { useUpdateStatus } from "./use-update-status";

const DISMISSED_KEY = "aop:update-dismissed:v1";

/**
 * A quiet bar above the screen when the host has a newer release. Every client sees it; only the
 * host owner gets "Update now", because updating restarts the host for everyone.
 */
export const UpdateNotice = () => {
  const updates = useUpdateStatus({ poll: true });
  const owner = useIsHostOwner(true);
  const [dismissed, setDismissed] = useState(readDismissed);
  const { status } = updates;

  if (!status?.enabled || !status.supported || !status.available || !status.latest) {
    return null;
  }
  const version = status.latest;
  const busy = updates.target !== null || status.state === "updating";
  const failure = updates.error ?? (status.state === "failed" ? status.updateError : null);
  if (dismissed === version && !busy && !failure) return null;

  return (
    <div
      data-testid="update-notice"
      role="status"
      className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-raised px-4 py-1.5 text-[12px] text-text-muted"
    >
      {busy ? (
        <Progress version={updates.target ?? version} />
      ) : (
        <Available
          version={version}
          releaseUrl={status.releaseUrl}
          owner={owner}
          failure={failure}
          onDismiss={() => setDismissed(dismiss(version))}
        />
      )}
    </div>
  );
};

const Progress = ({ version }: { version: string }) => (
  <span data-testid="update-progress" className="flex items-center gap-2 text-text">
    <Spinner className="size-3" />
    Updating to {version}… the page reconnects on its own
  </span>
);

interface AvailableProps {
  version: string;
  releaseUrl: string | null;
  owner: boolean;
  failure: string | null;
  onDismiss: () => void;
}

const Available = ({ version, releaseUrl, owner, failure, onDismiss }: AvailableProps) => (
  <>
    <span className="text-text">Update available ({version})</span>
    {releaseUrl ? <ReleaseNotesLink url={releaseUrl} /> : null}
    {failure ? (
      <span data-testid="update-error" role="alert" className="text-blocked">
        {failure}
      </span>
    ) : null}
    <span className="ml-auto flex items-center gap-1.5">
      {owner ? <UpdateNowButton retry={failure !== null} /> : null}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        data-testid="update-dismiss"
        onClick={onDismiss}
      >
        Dismiss
      </Button>
    </span>
  </>
);

export const ReleaseNotesLink = ({
  url,
  testId = "update-release-notes-link",
  className = "text-running hover:underline",
  children = "Release notes",
}: {
  url: string;
  testId?: string;
  className?: string;
  children?: ReactNode;
}) => (
  <a
    data-testid={testId}
    href={url}
    target="_blank"
    rel="noreferrer"
    onClick={(event) => {
      event.preventDefault();
      openExternalUrl(url);
    }}
    className={className}
  >
    {children}
  </a>
);

export const UpdateNowButton = ({ retry = false }: { retry?: boolean }) => (
  <Button
    type="button"
    size="xs"
    variant="secondary"
    data-testid="update-now-button"
    onClick={() => {
      clearUpdateError();
      void startUpdate();
    }}
  >
    {retry ? "Retry" : "Update now"}
  </Button>
);

const readDismissed = (): string | null => {
  try {
    return window.localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
};

// Dismissing hides the bar for this release only; the next release shows it again.
const dismiss = (version: string): string => {
  try {
    window.localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    // Storage can be unavailable; the bar then returns on the next load.
  }
  return version;
};
