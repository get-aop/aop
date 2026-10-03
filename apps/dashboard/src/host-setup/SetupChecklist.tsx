import type { SetupAction, SetupCheck } from "@aop/common";
import { CheckIcon, CircleAlertIcon, MinusIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { WithCode } from "../components/WithCode";
import { showLiveView } from "../live-view/live-view-store";
import { CopyCommand } from "../projects/settings/CuaSetupGuide";
import { closeSettingsDialog, openSettingsDialog } from "../shell/dialog-store";
import { runSetupFix, useHostSetupState } from "./host-setup-store";

const ICONS: Record<
  SetupCheck["state"],
  { icon: typeof CheckIcon; className: string; label: string }
> = {
  ok: { icon: CheckIcon, className: "text-ok", label: "Ready" },
  warning: { icon: CircleAlertIcon, className: "text-waiting", label: "Needs attention" },
  error: { icon: XIcon, className: "text-blocked", label: "Missing" },
  optional: { icon: MinusIcon, className: "text-text-subtle", label: "Optional" },
};

/**
 * The host's setup checklist: one row per check, what it found, and what can be done: Fix (the
 * host does it itself, for whoever may manage the host), How to (the command to run on the host,
 * worded for whoever reads it), or a link to the page with the rest.
 */
export const SetupChecklist = ({
  checks,
  canManage,
  blockedReason,
}: {
  checks: readonly SetupCheck[];
  canManage: boolean;
  blockedReason: string | null;
}) => (
  <ul data-testid="setup-checklist" className="flex flex-col divide-y divide-border">
    {checks.map((check) => (
      <SetupCheckRow
        key={check.id}
        check={check}
        canManage={canManage}
        blockedReason={blockedReason}
      />
    ))}
  </ul>
);

const SetupCheckRow = ({
  check,
  canManage,
  blockedReason,
}: {
  check: SetupCheck;
  canManage: boolean;
  blockedReason: string | null;
}) => {
  const { icon: Icon, className, label } = ICONS[check.state];
  const [howTo, setHowTo] = useState<HowToAction | null>(null);
  const fixBlocked = check.actions.some((action) => action.kind === "fix") && !canManage;
  return (
    <li
      data-testid={`setup-check-${check.id}`}
      data-state={check.state}
      className="flex flex-col gap-1.5 py-2.5"
    >
      <div className="flex items-start gap-3">
        <Icon
          aria-label={label}
          className={cn("mt-0.5 size-4 shrink-0", className)}
          strokeWidth={2}
        />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-text">{check.title}</p>
          <p data-testid="setup-check-detail" className="text-[12px] break-words text-text-subtle">
            <WithCode text={check.detail} />
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {check.actions.map((action) => (
            <ActionButton
              key={action.kind}
              check={check}
              action={action}
              canManage={canManage}
              onHowTo={(next) => setHowTo(howTo ? null : next)}
            />
          ))}
        </div>
      </div>
      {fixBlocked && blockedReason ? (
        <p data-testid="setup-check-blocked" className="pl-7 text-[11.5px] text-waiting">
          {blockedReason}
        </p>
      ) : null}
      {howTo ? <HowTo action={howTo} /> : null}
    </li>
  );
};

const ActionButton = ({
  check,
  action,
  canManage,
  onHowTo,
}: {
  check: SetupCheck;
  action: SetupAction;
  canManage: boolean;
  onHowTo: (action: HowToAction) => void;
}) => {
  const { fixing } = useHostSetupState();
  if (action.kind === "fix") {
    if (!canManage) return null;
    return (
      <Button
        type="button"
        size="xs"
        variant="secondary"
        data-testid={`setup-fix-${check.id}`}
        disabled={fixing !== null}
        onClick={() => void runSetupFix(check.id)}
      >
        {fixing === check.id ? <Spinner className="size-3" /> : null}
        {action.label}
      </Button>
    );
  }
  if (action.kind === "how-to") {
    return (
      <Button
        type="button"
        size="xs"
        variant="ghost"
        data-testid={`setup-howto-${check.id}`}
        onClick={() => onHowTo(action)}
      >
        How to
      </Button>
    );
  }
  return (
    <Button
      type="button"
      size="xs"
      variant="ghost"
      data-testid={`setup-link-${check.id}`}
      onClick={() => followLink(action.target)}
    >
      {action.label}
    </Button>
  );
};

const followLink = (target: Extract<SetupAction, { kind: "link" }>["target"]): void => {
  if (target === "live-view") {
    closeSettingsDialog();
    showLiveView();
    return;
  }
  openSettingsDialog(target);
};

type HowToAction = Extract<SetupAction, { kind: "how-to" }>;

const HowTo = ({ action }: { action: HowToAction }) => (
  <div
    data-testid="setup-howto"
    className="ml-7 flex flex-col gap-1.5 rounded-row bg-canvas px-3 py-2"
  >
    <ol className="list-decimal pl-4 text-[12px] leading-relaxed text-text-muted">
      {action.steps.map((step) => (
        <li key={step}>
          <WithCode text={step} />
        </li>
      ))}
    </ol>
    {action.command ? (
      <CopyCommand label="On the host" command={action.command} testId="setup-howto" />
    ) : null}
  </div>
);
