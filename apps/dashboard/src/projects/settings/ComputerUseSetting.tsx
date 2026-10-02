import type { ComputerUseOption, Project } from "@aop/common";
import { useState } from "react";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { skipsPermissions, useAgentClis } from "../../agent-clis/agent-cli-store";
import { useIsHostOwner } from "../../settings/use-host-owner";
import { useProjectActions } from "../use-project-actions";
import { ROW_SELECT_CLASS, SettingRow, SettingsHeading } from "./blocks";
import { CuaHostStatus } from "./CuaSetupGuide";
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
  cua: "Threads get CUA Driver's tools to see and operate apps and browsers on the AOP host, from their next turn. The coordinator does not get them.",
};

/**
 * Where a project's threads get computer and browser use from. It saves as soon as it changes,
 * apart from the form above it, because only the host owner may change it (a paired device sees
 * it read-only) and the host takes it on its own route. CUA can be chosen while CUA Driver is not
 * ready on the host: threads then run without its tools, and this row guides the setup there.
 */
export const ComputerUseSetting = ({ project }: { project: Project }) => {
  const owner = useIsHostOwner(true);
  const actions = useProjectActions();
  const cua = useCuaStatus();
  // While the host skips permission checks, Edit files threads run without them too.
  const hostBypass = skipsPermissions(useAgentClis().data);
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
                  {option.value === "cua" && cua.status && cua.status.status !== "ready" ? (
                    <Badge variant="blocked">Not ready</Badge>
                  ) : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        below={
          <ComputerUseBelow
            cua={cua}
            owner={owner}
            chosen={value === "cua"}
            editsOnly={project.threadAccess !== "full-access" && !hostBypass}
          />
        }
      />
    </div>
  );
};

/**
 * On CUA: the host's status, its setup guide when it is not ready, and the access threads need.
 * On the model's default: a line when CUA is not ready on the host, with the guide one click away.
 */
const ComputerUseBelow = ({
  cua,
  owner,
  chosen,
  editsOnly,
}: {
  cua: CuaStatusState;
  owner: boolean;
  chosen: boolean;
  editsOnly: boolean;
}) => {
  const [open, setOpen] = useState(false);
  const notReady = cua.status !== null && cua.status.status !== "ready";
  if (!chosen && !notReady) return null;
  if (!chosen && !open) {
    return (
      <p data-testid="settings-cua-not-ready" className="text-[12px] text-text-muted">
        CUA is not ready on the AOP host{cua.status ? `, ${cua.status.host.name}` : ""}.{" "}
        <Button
          type="button"
          variant="link"
          size="xs"
          data-testid="settings-cua-show-guide"
          className="h-auto px-0"
          onClick={() => setOpen(true)}
        >
          Show how to set it up
        </Button>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <CuaHostStatus cua={cua} owner={owner} chosen={chosen} />
      {chosen && editsOnly && !notReady ? (
        <p data-testid="settings-cua-edits-only" className="text-[12px] text-blocked">
          Thread access is Edit files: every CUA call needs an approval no thread can give, so
          threads see the tools but cannot use them. Choose Full access for them to work.
        </p>
      ) : null}
    </div>
  );
};
