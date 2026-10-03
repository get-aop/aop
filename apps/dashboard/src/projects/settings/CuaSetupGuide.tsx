import type { CuaCheck, CuaStatus } from "@aop/common";
import { CheckIcon, MinusIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { openSettingsDialog } from "../../shell/dialog-store";
import type { CuaStatusState } from "./use-cua-status";

/**
 * CUA Driver on the AOP host as the host checked it. What makes it ready is set up once for the
 * host, on AOP settings › Host (its Computer use item, with Fix or How to), not per project.
 */
export const CuaHostStatus = ({
  cua,
  owner,
  chosen,
}: {
  cua: CuaStatusState;
  /** This client is the host itself, so "this machine" is the host. */
  owner: boolean;
  /** The project is on CUA, so its threads are what a gap costs. */
  chosen: boolean;
}) => {
  const { status } = cua;
  if (!status) {
    return cua.checking ? null : (
      <Frame tone="warn" title="Could not ask the host about CUA Driver." cua={cua} />
    );
  }
  const ready = status.status === "ready";
  return (
    <Frame tone={ready ? "ok" : "warn"} title={titleOf(status, chosen)} cua={cua}>
      {status.status === "not-ready" ? <p className="text-text-muted">{status.detail}</p> : null}
      <CheckList checks={status.checks} />
      {ready ? null : (
        <div data-testid="settings-cua-guide" className="flex flex-wrap items-center gap-2 pt-1">
          <p data-testid="settings-cua-host" className="text-text">
            {owner
              ? `Set it up on this machine, ${status.host.name}: it is the AOP host.`
              : `Set it up on the AOP host, ${status.host.name}, not on this device.`}
          </p>
          <Button
            type="button"
            size="xs"
            variant="secondary"
            data-testid="settings-cua-open-host"
            onClick={() => openSettingsDialog("host")}
          >
            Open AOP settings › Host
          </Button>
        </div>
      )}
    </Frame>
  );
};

const titleOf = (status: CuaStatus, chosen: boolean): string => {
  const where = `on ${status.host.name}`;
  if (status.status === "ready") {
    return `CUA Driver${status.version ? ` ${status.version}` : ""} is ready ${where}.`;
  }
  const what =
    status.status === "not-installed"
      ? `CUA Driver is not installed ${where}.`
      : `CUA Driver is installed ${where} but not ready.`;
  return chosen ? `${what} Threads run without its tools until it is.` : what;
};

const CheckList = ({ checks }: { checks: CuaCheck[] }) => (
  <ul data-testid="settings-cua-checks" className="flex flex-wrap gap-x-4 gap-y-1">
    {checks.map((check) => (
      <li
        key={check.id}
        data-testid={`settings-cua-check-${check.id}`}
        data-ok={String(check.ok)}
        title={check.detail}
        className="flex items-center gap-1 text-[12px] text-text-muted"
      >
        {check.ok === true ? (
          <CheckIcon className="size-3.5 text-ok" />
        ) : check.ok === false ? (
          <XIcon className={cn("size-3.5", check.required ? "text-blocked" : "text-text-subtle")} />
        ) : (
          <MinusIcon className="size-3.5 text-text-subtle" />
        )}
        {check.label}
      </li>
    ))}
  </ul>
);

/**
 * A command to run on the host, with a button that copies it. `testId` prefixes the command's
 * (`-command`) and the button's (`-copy`) test ids.
 */
export const CopyCommand = ({
  label,
  command,
  testId = "settings-cua",
}: {
  label: string;
  command: string;
  testId?: string;
}) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-[12px] text-text-subtle">{label}</span>
      <code
        data-testid={`${testId}-command`}
        className="min-w-0 flex-1 rounded-md bg-canvas px-1.5 py-0.5 text-[11.5px] break-all text-text"
      >
        {command}
      </code>
      <Button
        type="button"
        size="xs"
        variant="ghost"
        data-testid={`${testId}-copy`}
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

const Frame = ({
  tone,
  title,
  cua,
  children,
}: {
  tone: "ok" | "warn";
  title: string;
  cua: CuaStatusState;
  children?: ReactNode;
}) => (
  <div
    role={tone === "warn" ? "alert" : "status"}
    data-testid="settings-cua-status"
    data-tone={tone}
    className={cn(
      "flex gap-2.5 rounded-row border px-3 py-2.5 text-[12.5px] leading-relaxed text-text",
      tone === "warn" ? "border-blocked/30 bg-blocked/10" : "border-border",
    )}
  >
    {tone === "warn" ? <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-blocked" /> : null}
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <p className={tone === "warn" ? "font-medium text-blocked" : "text-text-muted"}>{title}</p>
      {children}
    </div>
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-testid="settings-cua-recheck"
      disabled={cua.checking}
      onClick={cua.recheck}
    >
      {cua.checking ? "Checking…" : "Check again"}
    </Button>
  </div>
);
