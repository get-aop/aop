import { type CuaCheck, type CuaSetupStep, type CuaStatus, cuaSetupSteps } from "@aop/common";
import { CheckIcon, MinusIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import type { CuaStatusState } from "./use-cua-status";

/**
 * CUA Driver on the AOP host as the host checked it, and the steps that make it ready. The steps
 * come from `cuaSetupSteps` in @aop/common, the one place they are written. Every command is for
 * the host, whichever device shows this.
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
  const steps = cuaSetupSteps(status);
  return (
    <Frame tone={ready ? "ok" : "warn"} title={titleOf(status, chosen)} cua={cua}>
      {status.status === "not-ready" ? <p className="text-text-muted">{status.detail}</p> : null}
      <CheckList checks={status.checks} />
      {steps.length > 0 ? (
        <div data-testid="settings-cua-guide" className="flex flex-col gap-3 pt-1">
          <p data-testid="settings-cua-host" className="font-medium text-text">
            {owner
              ? `Run these on this machine, ${status.host.name}: it is the AOP host.`
              : `Run these on the AOP host, ${status.host.name}, not on this device.`}{" "}
            <span className="font-normal text-text-muted">Then press Check again.</span>
          </p>
          <ol className="flex flex-col gap-3">
            {steps.map((step, index) => (
              <SetupStep key={step.id} step={step} number={index + 1} />
            ))}
          </ol>
        </div>
      ) : null}
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

const SetupStep = ({ step, number }: { step: CuaSetupStep; number: number }) => (
  <li data-testid={`settings-cua-step-${step.id}`} className="flex gap-2">
    <span className="w-4 shrink-0 font-medium text-text tabular-nums">{number}.</span>
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <p className="font-medium text-text">{step.title}</p>
      <p className="text-text-muted">
        <WithCode text={step.body} />
      </p>
      {step.commands.map((command) => (
        <CopyCommand key={command.command} label={command.label} command={command.command} />
      ))}
      {step.places.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-text-muted">
          {step.places.map((place) => (
            <li key={place}>Or by hand: {place}</li>
          ))}
        </ul>
      ) : null}
    </div>
  </li>
);

// The guide's text marks commands and paths with backticks, as the docs do.
const WithCode = ({ text }: { text: string }) => (
  <>
    {segmentsOf(text).map(({ at, part, code }) =>
      code ? (
        <code key={at} className="rounded bg-canvas px-1 text-[11.5px] text-text">
          {part}
        </code>
      ) : (
        <span key={at}>{part}</span>
      ),
    )}
  </>
);

/** Splits on backticks; each part is keyed by where it starts in the text. */
const segmentsOf = (text: string): { at: number; part: string; code: boolean }[] => {
  let at = 0;
  return text.split("`").map((part, position) => {
    const segment = { at, part, code: position % 2 === 1 };
    at += part.length + 1;
    return segment;
  });
};

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
