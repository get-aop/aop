import type { ComputerUseOption, CuaStatus, Project } from "@aop/common";
import { TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { useIsHostOwner } from "../../settings/use-host-owner";
import { useProjectActions } from "../use-project-actions";
import { ROW_SELECT_CLASS, SettingRow, SettingsHeading } from "./blocks";
import { type CuaStatusState, useCuaStatus } from "./use-cua-status";

interface Option {
  value: ComputerUseOption;
  label: string;
  /** Named so people know it is coming; the host refuses it until it is built. */
  wip?: boolean;
}

const OPTIONS: Option[] = [
  { value: "model-default", label: "Model default" },
  { value: "cua", label: "CUA" },
  { value: "codex", label: "Codex", wip: true },
  { value: "claude", label: "Claude", wip: true },
];

const DESCRIPTIONS: Record<Project["computerUse"], string> = {
  "model-default":
    "Threads get no computer-use tools from AOP. They have whatever their agent CLI brings by itself.",
  cua: "Threads get CUA Driver's tools to see and operate apps and browsers on this host, from their next turn. The coordinator does not get them.",
};

/**
 * Where a project's threads get computer and browser use from. It saves as soon as it changes,
 * apart from the form above it, because only the host owner may change it (a paired device sees
 * it read-only) and the host takes it on its own route. CUA can be chosen while CUA Driver is not
 * ready: threads then run without its tools, and this row says why and how to fix it.
 */
export const ComputerUseSetting = ({ project }: { project: Project }) => {
  const owner = useIsHostOwner(true);
  const actions = useProjectActions();
  const cua = useCuaStatus();
  const value = project.computerUse;

  return (
    <div data-testid="settings-computer-use-block" className="flex flex-col">
      <SettingsHeading title="Computer and browser use" />
      <SettingRow
        label="Computer / browser use"
        description={
          <span data-testid="settings-computer-use-description">
            {DESCRIPTIONS[value]}{" "}
            {owner
              ? "Saved as soon as you choose."
              : "Only the host owner can change this, on the host machine."}
          </span>
        }
        htmlFor="settings-computer-use"
        control={
          <Select
            value={value}
            disabled={!owner}
            onValueChange={(next) =>
              void actions.setComputerUse(project, next as ComputerUseOption)
            }
          >
            <SelectTrigger
              id="settings-computer-use"
              data-testid="settings-computer-use"
              data-value={value}
              className={ROW_SELECT_CLASS}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPTIONS.map((option) => (
                <SelectItem
                  key={option.value}
                  value={option.value}
                  disabled={option.wip}
                  data-testid={`settings-computer-use-${option.value}`}
                >
                  {option.label}
                  {option.wip ? <Badge variant="draft">WIP</Badge> : null}
                  {option.value === "cua" && cua.status && !cua.status.usable ? (
                    <Badge variant="blocked">Not ready</Badge>
                  ) : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        below={
          value === "cua" || (cua.status && !cua.status.usable) ? (
            <CuaNotice
              cua={cua}
              chosen={value === "cua"}
              editsOnly={project.threadAccess !== "full-access"}
            />
          ) : null
        }
      />
    </div>
  );
};

/** What CUA Driver looks like on the host: ready, or why not and what to run. */
const CuaNotice = ({
  cua,
  chosen,
  editsOnly,
}: {
  cua: CuaStatusState;
  chosen: boolean;
  editsOnly: boolean;
}) => {
  const { status } = cua;
  if (!status) {
    return cua.checking ? null : (
      <Notice
        tone="warn"
        testId="settings-cua-status"
        title="Could not ask the host about CUA Driver."
        cua={cua}
      />
    );
  }
  const blocked = !status.usable;
  return (
    <div className="flex flex-col gap-2">
      <Notice
        tone={status.state === "ready" ? "ok" : "warn"}
        testId="settings-cua-status"
        title={noticeTitle(status, chosen)}
        cua={cua}
      >
        {status.state === "ready" ? null : <p className="text-text-muted">{status.detail}</p>}
        <FixSteps status={status} />
      </Notice>
      {chosen && editsOnly && !blocked ? (
        <p data-testid="settings-cua-edits-only" className="text-[12px] text-blocked">
          Thread access is Edit files: every CUA call needs an approval no thread can give, so
          threads see the tools but cannot use them. Choose Full access for them to work.
        </p>
      ) : null}
    </div>
  );
};

const noticeTitle = (status: CuaStatus, chosen: boolean): string => {
  if (status.state === "ready") return status.detail;
  if (status.usable) return "CUA Driver is not running.";
  return chosen
    ? "CUA is not ready: threads run without its tools."
    : "CUA is not ready on this host.";
};

const FixSteps = ({ status }: { status: CuaStatus }) =>
  status.fix.length === 0 ? null : (
    <ol data-testid="settings-cua-fix" className="flex list-decimal flex-col gap-1 pl-4">
      {status.fix.map((step) => (
        <li key={step}>
          <code className="rounded-md bg-canvas px-1.5 py-0.5 text-[11.5px] break-all text-text">
            {step}
          </code>
        </li>
      ))}
    </ol>
  );

const Notice = ({
  tone,
  title,
  testId,
  cua,
  children,
}: {
  tone: "ok" | "warn";
  title: string;
  testId: string;
  cua: CuaStatusState;
  children?: ReactNode;
}) => (
  <div
    role={tone === "warn" ? "alert" : "status"}
    data-testid={testId}
    data-tone={tone}
    className={
      tone === "warn"
        ? "flex gap-2.5 rounded-row border border-blocked/30 bg-blocked/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-text"
        : "flex gap-2.5 rounded-row border border-border px-3 py-2.5 text-[12.5px] leading-relaxed text-text"
    }
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
