import type { CuaCheck, CuaStatus } from "@aop/common";
import { CheckIcon, MinusIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { CopyCommand } from "../projects/settings/CuaSetupGuide";
import { type CuaStatusState, useCuaStatus } from "../projects/settings/use-cua-status";
import { SettingsCuaLease } from "./settings-cua-lease";
import { useIsHostOwner } from "./use-host-owner";

/**
 * Settings §Computer use: whether the host can give threads computer use (CUA Driver), each thing
 * it checked, the commands that fix what is missing, and which thread uses the host's screen now.
 * Every command runs on the host, whichever device shows this.
 */
export const SettingsComputerUse = () => {
  const cua = useCuaStatus();
  const owner = useIsHostOwner(true);
  const { status } = cua;
  return (
    <div data-testid="settings-computer-use" className="flex flex-col gap-6 p-4">
      <Readiness cua={cua} />
      {status ? <Checks checks={status.checks} /> : null}
      {status ? <Fix status={status} owner={owner} /> : null}
      <SettingsCuaLease />
    </div>
  );
};

const Readiness = ({ cua }: { cua: CuaStatusState }) => {
  const { status } = cua;
  return (
    <section className="flex items-start gap-3 rounded-row border border-border bg-raised px-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p
          data-testid="settings-cu-status"
          data-status={status?.status ?? (cua.checking ? "checking" : "unknown")}
          className={cn(
            "text-[13px] font-medium",
            status?.status === "ready" ? "text-ok" : status ? "text-blocked" : "text-text-muted",
          )}
        >
          {statusLine(cua)}
        </p>
        {status ? (
          <p data-testid="settings-cu-host" className="text-[12px] text-text-subtle">
            {hostLine(status)}
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        data-testid="settings-cu-recheck"
        disabled={cua.checking}
        onClick={cua.recheck}
      >
        {cua.checking ? "Checking…" : "Check again"}
      </Button>
    </section>
  );
};

const statusLine = ({ status, checking }: CuaStatusState): string => {
  if (!status) return checking ? "Checking the host…" : "Could not ask the host about computer use";
  if (status.status === "ready") return "Ready";
  if (status.status === "not-installed") return "Not installed";
  return `Not ready: ${status.detail}`;
};

const hostLine = (status: CuaStatus): string => {
  const driver = status.version ? `CUA Driver ${status.version}` : "No CUA Driver";
  return `${driver} on ${status.host.name}, checked ${new Date(status.checkedAt).toLocaleTimeString()}`;
};

const Checks = ({ checks }: { checks: CuaCheck[] }) => (
  <section className="flex flex-col gap-2">
    <h2 className="text-[13px] font-semibold text-text">What the host checked</h2>
    <ul data-testid="settings-cu-checks" className="flex flex-col gap-1">
      {checks.map((check) => (
        <CheckRow key={check.id} check={check} />
      ))}
    </ul>
  </section>
);

const CHECK_STATE = {
  ok: { label: "OK", icon: CheckIcon, tone: "text-ok" },
  missing: { label: "Missing", icon: XIcon, tone: "text-blocked" },
  unchecked: { label: "Not checked", icon: MinusIcon, tone: "text-text-subtle" },
} as const;

const checkState = (check: CuaCheck): keyof typeof CHECK_STATE => {
  if (check.ok === null) return "unchecked";
  return check.ok ? "ok" : "missing";
};

const CheckRow = ({ check }: { check: CuaCheck }) => {
  const state = checkState(check);
  const { label, icon: Icon, tone } = CHECK_STATE[state];
  // A missing check that does not decide readiness is not an alarm.
  const iconTone = state === "missing" && !check.required ? "text-text-subtle" : tone;
  return (
    <li
      data-testid={`settings-cu-check-${check.id}`}
      data-state={state}
      className="flex items-start gap-2.5 rounded-row border border-border px-3 py-2"
    >
      <Icon aria-hidden="true" className={cn("mt-0.5 size-3.5 shrink-0", iconTone)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-[12.5px] font-medium text-text">
          {check.label}
          {check.required ? null : (
            <span className="ml-1.5 font-normal text-text-subtle">optional</span>
          )}
        </p>
        {check.detail ? (
          <p className="text-[12px] text-text-subtle break-words">{check.detail}</p>
        ) : null}
      </div>
      <span data-testid="settings-cu-check-state" className={cn("shrink-0 text-[12px]", tone)}>
        {label}
      </span>
    </li>
  );
};

/** What fixes what is missing, and the CUA Driver release AOP installs. */
const Fix = ({ status, owner }: { status: CuaStatus; owner: boolean }) => {
  const { fix } = status;
  return (
    <section data-testid="settings-cu-fix" className="flex flex-col gap-2">
      <h2 className="text-[13px] font-semibold text-text">Set up</h2>
      <p data-testid="settings-cu-pinned" className="text-[12px] text-text-subtle">
        AOP installs and updates CUA Driver {fix.pinnedVersion} by itself.
        {status.version && status.version !== fix.pinnedVersion
          ? ` This host has ${status.version}.`
          : ""}
      </p>
      {fix.missing.length > 0 ? (
        <p data-testid="settings-cu-missing" className="text-[12.5px] text-text">
          Missing: {fix.missing.join(", ")}
        </p>
      ) : null}
      {fix.sudoCommand !== null || fix.command !== null ? (
        <FixCommands status={status} owner={owner} />
      ) : (
        <p data-testid="settings-cu-nothing-to-fix" className="text-[12.5px] text-text-muted">
          Nothing to install.
        </p>
      )}
    </section>
  );
};

/**
 * The commands to run at the host: the one that needs root first (the system packages), then
 * AOP's own setup, which needs none.
 */
const FixCommands = ({ status, owner }: { status: CuaStatus; owner: boolean }) => {
  const { fix, host } = status;
  return (
    <div className="flex flex-col gap-1.5 rounded-row border border-border px-3 py-2.5">
      <p data-testid="settings-cu-where" className="text-[12.5px] text-text">
        {owner
          ? `Run on this machine, ${host.name}: it is the AOP host.`
          : `Run on the AOP host, ${host.name}, not on this device.`}{" "}
        <span className="text-text-muted">Then press Check again.</span>
      </p>
      {fix.sudoCommand ? (
        <CopyCommand label="Needs sudo" command={fix.sudoCommand} testId="settings-cu-fix-sudo" />
      ) : null}
      {fix.command ? (
        <CopyCommand label="Set up" command={fix.command} testId="settings-cu-fix-setup" />
      ) : null}
    </div>
  );
};
