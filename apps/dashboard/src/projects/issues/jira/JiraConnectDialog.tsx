import type { JiraConnection } from "@aop/common";
import { CircleCheckIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Spinner } from "@/ui/spinner";
import { JiraMark } from "../source-marks";
import { JiraCredentialsStep } from "./JiraCredentialsStep";
import { JiraFilterStep } from "./JiraFilterStep";
import { type JiraSetup, useJiraSetup } from "./use-jira-setup";

/**
 * Connects the project to Jira, the way the Linear dialog connects Linear: the host owner gives
 * the site and a token, tests it, and picks the projects (or a JQL query) whose issues this
 * project shows. The token is stored on the host only. A paired device sees what is connected,
 * and that only the host owner can change it.
 */
export const JiraConnectDialog = ({
  projectId,
  open,
  owner,
  reconnect = false,
  onOpenChange,
  onChanged,
}: {
  projectId: string;
  open: boolean;
  owner: boolean;
  /** Opened from the Reconnect notice: straight to the token step. */
  reconnect?: boolean;
  onOpenChange: (open: boolean) => void;
  /** The connection changed: the issues list reads again. */
  onChanged: () => void;
}) => {
  const setup = useJiraSetup(projectId, open, reconnect && owner);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="jira-dialog"
        className="max-h-[calc(100dvh-2rem)] w-[480px] max-w-[calc(100vw-1rem)] gap-5 overflow-y-auto border-border-strong bg-overlay"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[16px]">
            <JiraMark className="size-4" />
            Jira
          </DialogTitle>
          <DialogDescription className="text-meta leading-relaxed text-text-muted">
            List the issues of Jira projects, or of a JQL query, in this project's Issues tab. The
            token stays on the host: paired devices never receive it, and AOP only reads from Jira.
          </DialogDescription>
        </DialogHeader>
        <Body setup={setup} owner={owner} onDone={onChanged} />
        {setup.error ? (
          <p data-testid="jira-error" role="alert" className="text-meta text-blocked">
            {setup.error}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};

const Body = ({
  setup,
  owner,
  onDone,
}: {
  setup: JiraSetup;
  owner: boolean;
  onDone: () => void;
}) => {
  const { step } = setup;
  if (step.kind === "loading") {
    return (
      <p className="flex items-center gap-2 text-meta text-text-subtle">
        <Spinner className="size-3.5" /> Checking the connection…
      </p>
    );
  }
  if (step.kind === "connected") return <Connected setup={setup} owner={owner} onDone={onDone} />;
  if (!owner) {
    return (
      <p data-testid="jira-owner-only" className="text-meta text-text-muted">
        Jira is not connected. Only the host owner can connect it, from the dashboard on the host
        machine.
      </p>
    );
  }
  if (step.kind === "credentials") return <JiraCredentialsStep setup={setup} />;
  return (
    <JiraFilterStep setup={setup} account={step.account} projects={step.projects} onDone={onDone} />
  );
};

const Connected = ({
  setup,
  owner,
  onDone,
}: {
  setup: JiraSetup;
  owner: boolean;
  onDone: () => void;
}) => {
  const connection = setup.connection;
  return (
    <div className="flex flex-col gap-4">
      <dl
        data-testid="jira-connected"
        className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-card border border-border-strong bg-raised px-4 py-3 text-meta"
      >
        <dt className="text-text-subtle">Site</dt>
        <dd data-testid="jira-connected-site" className="min-w-0 truncate text-text">
          {connection?.siteUrl ?? "—"}
          <span className="text-text-subtle">
            {connection?.deployment === "datacenter" ? " · Data Center" : " · Cloud"}
          </span>
        </dd>
        <dt className="text-text-subtle">Account</dt>
        <dd className="text-text">{connection?.account || "—"}</dd>
        <dt className="text-text-subtle">Shows</dt>
        <dd data-testid="jira-connected-filter" className="min-w-0 text-text">
          <FilterSummary connection={connection} />
        </dd>
        <dt className="text-text-subtle">Pull requests</dt>
        <dd className="text-text">
          {connection?.linkPullRequests ? "Titles carry the issue's key" : "Not linked"}
        </dd>
      </dl>
      {owner ? (
        <>
          <ConnectedTest setup={setup} />
          <ConnectedActions setup={setup} onDone={onDone} />
        </>
      ) : (
        <p className="text-meta text-text-subtle">
          Only the host owner can change this, on the host machine.
        </p>
      )}
    </div>
  );
};

const FilterSummary = ({ connection }: { connection: JiraConnection | null }) => {
  const filter = connection?.filter;
  if (!filter) return <>—</>;
  const projects =
    filter.projects.length > 0 ? `Open issues of ${filter.projects.join(", ")}` : null;
  return (
    <span className="flex flex-col gap-1">
      {projects ? <span>{projects}</span> : null}
      {filter.jql ? (
        <code className="break-words font-mono text-[11.5px] text-text-muted">{filter.jql}</code>
      ) : null}
    </span>
  );
};

/**
 * Test connection tries the saved token again, and says beside the button who it signs in as,
 * or that Jira now refuses it (with the way to reconnect).
 */
const ConnectedTest = ({ setup }: { setup: JiraSetup }) => (
  <div className="flex flex-col gap-2">
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="secondary"
        size="sm"
        data-testid="jira-test-saved"
        disabled={setup.busy}
        onClick={() => void setup.testConnection()}
      >
        {setup.busy ? <Spinner className="size-3.5" /> : null}
        Test connection
      </Button>
      {setup.test?.ok ? (
        <p data-testid="jira-test-ok" className="flex items-center gap-2 text-meta text-ok">
          <CircleCheckIcon className="size-3.5 shrink-0" />
          Signed in as {setup.test.account.displayName}.
        </p>
      ) : null}
    </div>
    <TestRefused setup={setup} />
  </div>
);

const TestRefused = ({ setup }: { setup: JiraSetup }) => {
  const outcome = setup.test;
  if (!outcome || outcome.ok) return null;
  return (
    <div
      data-testid="jira-test-failed"
      role="alert"
      className="flex flex-col gap-2 text-meta text-blocked"
    >
      <p className="flex items-start gap-2">
        <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
        {outcome.refused
          ? "Jira refused the saved token: it may have expired or been revoked."
          : outcome.message}
      </p>
      {outcome.refused ? (
        <div>
          <Button size="sm" data-testid="jira-reconnect" onClick={setup.replaceToken}>
            Reconnect with a new token
          </Button>
        </div>
      ) : null}
    </div>
  );
};

/**
 * Test the saved token, replace it, pick another filter, or disconnect. Disconnecting deletes
 * the token from the host, so it asks once more, in place.
 */
const ConnectedActions = ({ setup, onDone }: { setup: JiraSetup; onDone: () => void }) => {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <DialogFooter className="items-center sm:justify-between">
        <p data-testid="jira-disconnect-confirm" className="text-meta text-text-muted">
          Delete the token from this host?
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            size="sm"
            data-testid="jira-disconnect-confirmed"
            disabled={setup.busy}
            onClick={async () => {
              if (await setup.disconnect()) onDone();
              setConfirming(false);
            }}
          >
            Disconnect
          </Button>
        </div>
      </DialogFooter>
    );
  }
  // Not DialogFooter: it stacks its buttons in a column on a narrow screen.
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        data-testid="jira-disconnect"
        disabled={setup.busy}
        onClick={() => setConfirming(true)}
        className="text-blocked hover:text-blocked"
      >
        Disconnect
      </Button>
      <span className="flex-1" />
      <Button
        variant="secondary"
        size="sm"
        data-testid="jira-replace-token"
        disabled={setup.busy}
        onClick={setup.replaceToken}
      >
        Replace token
      </Button>
      <Button
        size="sm"
        data-testid="jira-change-filter"
        disabled={setup.busy}
        onClick={() => void setup.changeFilter()}
      >
        {setup.busy ? <Spinner className="size-3.5" /> : null}
        Change filter
      </Button>
    </div>
  );
};
