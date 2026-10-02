import type { AgentCliInstallMethod, AgentCliStatus, AgentCliUpdate } from "@aop/common";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { RuntimeProviderIcon } from "@/ui/provider-icon";
import { Spinner } from "@/ui/spinner";
import { formatAgo } from "../projects/selectors";
import { useIsHostOwner } from "../settings/use-host-owner";
import {
  checkForCliUpdates,
  isUpdateRunning,
  skipsPermissions,
  startCliUpdate,
} from "./agent-cli-store";
import { PermissionBypassBadge, PermissionBypassSetting } from "./PermissionBypassSetting";
import { useAgentCliStatus } from "./use-agent-clis";

const METHOD_LABELS: Record<AgentCliInstallMethod, string> = {
  native: "Native installer",
  npm: "npm global package",
  pnpm: "pnpm global package",
  bun: "Bun global package",
  brew: "Homebrew",
  unknown: "Unknown install method",
};

/**
 * Settings §Runtimes, top: each agent CLI the host runs sessions with, what is installed and
 * what is out, and an Update button for the host owner. Updating runs on the host in the
 * background; the row follows it and says how it went.
 */
export const AgentCliPanel = () => {
  const { data, checking, starting, savingBypass, error } = useAgentCliStatus();
  const owner = useIsHostOwner(true);

  return (
    <section data-testid="agent-clis" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold text-text">Agent CLIs</h2>
        {skipsPermissions(data) ? <PermissionBypassBadge /> : null}
        <span className="flex-1" />
        <Button
          type="button"
          size="xs"
          variant="ghost"
          data-testid="agent-clis-check"
          disabled={checking}
          onClick={() => void checkForCliUpdates()}
        >
          {checking ? "Checking…" : "Check now"}
        </Button>
      </div>
      <p className="text-[12px] text-text-subtle">
        Every turn starts the CLI found on the host's PATH at that moment, so an update reaches the
        next turn without restarting AOP. How often the host checks, and whether it updates on its
        own, are under General.
      </p>
      {error ? (
        <p role="alert" data-testid="agent-clis-error" className="text-[12px] text-blocked">
          {error}
        </p>
      ) : null}
      {data === null ? (
        <p className="py-3 text-center text-[12px] text-text-subtle">Looking for agent CLIs…</p>
      ) : (
        <>
          {data.clis.map((cli) => (
            <CliRow
              key={cli.provider}
              cli={cli}
              owner={owner}
              starting={starting.includes(cli.provider)}
            />
          ))}
          <PermissionBypassSetting
            bypass={data.skipPermissions}
            owner={owner}
            saving={savingBypass}
          />
        </>
      )}
    </section>
  );
};

const CliRow = ({
  cli,
  owner,
  starting,
}: {
  cli: AgentCliStatus;
  owner: boolean;
  starting: boolean;
}) => {
  const running = isUpdateRunning(cli) || starting;
  const canUpdate = owner && cli.installed && (cli.updateAvailable || running);
  return (
    <div
      data-testid={`agent-cli-${cli.provider}`}
      className="flex flex-col gap-2 rounded-row border border-border bg-raised px-3 py-2.5"
    >
      <div className="flex min-w-0 items-center gap-3">
        <RuntimeProviderIcon runtime={cli.provider} className="size-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <CliHeading cli={cli} />
          <CliDetails cli={cli} />
        </div>
        {canUpdate ? <UpdateButton provider={cli.provider} running={running} /> : null}
      </div>
      <UpdateState cli={cli} />
    </div>
  );
};

const CliHeading = ({ cli }: { cli: AgentCliStatus }) => (
  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
    <span className="text-[13px] font-medium text-text">{cli.label}</span>
    <span data-testid="agent-cli-version" className="text-[12.5px] text-text-muted">
      {installedVersion(cli)}
    </span>
    {cli.updateAvailable && cli.latest ? (
      <span
        data-testid="agent-cli-update-available"
        className="rounded-md border border-running/30 bg-running/10 px-1.5 py-px text-[11px] font-medium text-running"
      >
        {cli.latest} available
      </span>
    ) : null}
  </div>
);

const UpdateButton = ({ provider, running }: { provider: string; running: boolean }) => (
  <Button
    type="button"
    size="xs"
    variant="secondary"
    data-testid="agent-cli-update"
    disabled={running}
    onClick={() => void startCliUpdate(provider)}
  >
    {running ? <Spinner className="size-3" /> : null}
    {running ? "Updating…" : "Update"}
  </Button>
);

const CliDetails = ({ cli }: { cli: AgentCliStatus }) => {
  const lines = [
    cli.installMethod ? METHOD_LABELS[cli.installMethod] : null,
    cli.path ? describePath(cli) : null,
  ].filter(Boolean);
  const runs = cli.activeRuns.count;
  return (
    <div className="mt-0.5 flex flex-col gap-0.5 text-[11.5px] text-text-subtle">
      {lines.length > 0 ? <span className="break-all">{lines.join(" · ")}</span> : null}
      <span data-testid="agent-cli-check-state">{checkLine(cli)}</span>
      {runs > 0 || cli.lastRunVersion ? (
        <span data-testid="agent-cli-runs">{runsLine(cli)}</span>
      ) : null}
    </div>
  );
};

const UpdateState = ({ cli }: { cli: AgentCliStatus }) => {
  const { update } = cli;
  if (update.state === "idle") return null;
  if (update.state === "failed") return <UpdateFailure cli={cli} />;
  if (update.state === "succeeded") {
    return (
      <p data-testid="agent-cli-update-done" className="text-[12px] text-ok">
        {succeededText(update)}
      </p>
    );
  }
  return (
    <p
      data-testid="agent-cli-update-progress"
      role="status"
      className="flex items-center gap-2 text-[12px] text-text"
    >
      <Spinner className="size-3" />
      {progressText(cli)}
    </p>
  );
};

const progressText = ({ label, update }: AgentCliStatus): string =>
  update.state === "waiting"
    ? `Waiting for ${plural(update.deferredFor, "run")} of ${label} to finish: this install is replaced in place, so it updates when none is in flight.`
    : `Updating${toVersion(update)}… new turns wait for it, runs in flight carry on.`;

const succeededText = (update: AgentCliUpdate): string =>
  `Updated${toVersion(update)}${update.finishedAt ? ` ${formatAgo(update.finishedAt)}` : ""}. The next turn runs it.`;

const toVersion = (update: AgentCliUpdate): string =>
  update.toVersion ? ` to ${update.toVersion}` : "";

const installedVersion = (cli: AgentCliStatus): string => {
  if (!cli.installed) return "not installed";
  return cli.version ?? "version unknown";
};

const UpdateFailure = ({ cli }: { cli: AgentCliStatus }) => {
  const { update } = cli;
  const [showOutput, setShowOutput] = useState(false);
  return (
    <div data-testid="agent-cli-update-failed" className="flex flex-col gap-1.5">
      <p role="alert" className="text-[12px] text-blocked">
        {update.error ?? "The update failed."}
      </p>
      {update.manualCommand ? <ManualCommand command={update.manualCommand} /> : null}
      {update.output ? (
        <>
          <button
            type="button"
            className="w-fit text-[11.5px] text-text-subtle hover:text-text"
            onClick={() => setShowOutput((shown) => !shown)}
          >
            {showOutput ? "Hide output" : "Show output"}
          </button>
          {showOutput ? (
            <pre className="max-h-40 overflow-auto rounded-md bg-canvas p-2 text-[11px] whitespace-pre-wrap text-text-muted">
              {update.output}
            </pre>
          ) : null}
        </>
      ) : null}
    </div>
  );
};

const ManualCommand = ({ command }: { command: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px] text-text-muted">
      <span>Run it yourself on the host:</span>
      <code
        data-testid="agent-cli-manual-command"
        className="rounded-md bg-canvas px-1.5 py-0.5 text-[11.5px] text-text"
      >
        {command}
      </code>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        onClick={() =>
          void navigator.clipboard.writeText(command).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
};

const describePath = (cli: AgentCliStatus): string =>
  cli.realPath && cli.realPath !== cli.path ? `${cli.path} → ${cli.realPath}` : (cli.path ?? "");

const checkLine = (cli: AgentCliStatus): string => {
  if (cli.checkError) return `Could not check for a newer version: ${cli.checkError}`;
  if (!cli.checkedAt) return "Not checked for a newer version yet";
  const when = formatAgo(cli.checkedAt);
  if (cli.updateAvailable) return `Checked ${when}`;
  return cli.latest
    ? `Up to date (${cli.channel} is ${cli.latest}), checked ${when}`
    : `Checked ${when}`;
};

const runsLine = (cli: AgentCliStatus): string => {
  const { count, versions } = cli.activeRuns;
  const inFlight =
    count > 0
      ? `${plural(count, "run")} in flight${versions.length > 0 ? ` on ${versions.join(", ")}` : ""}`
      : null;
  const last = cli.lastRunVersion ? `last finished run used ${cli.lastRunVersion}` : null;
  return [inFlight, last].filter(Boolean).join(" · ");
};

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;

/** A small dot that says an agent CLI has a newer version out (the Runtimes nav, the top bar). */
export const CliUpdateDot = ({ className }: { className?: string }) => (
  <span
    data-testid="agent-cli-update-dot"
    aria-hidden="true"
    className={cn("size-1.5 shrink-0 rounded-full bg-running", className)}
  />
);
