import type { PermissionBypass } from "@aop/common";
import { ShieldOffIcon, TriangleAlertIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Switch } from "@/ui/switch";
import { requestConfirmation } from "../components/ConfirmationHost";
import { changeSkipPermissions } from "./agent-cli-store";

/**
 * Settings › Runtimes, under the agent CLIs: whether every Claude Code session the host starts
 * runs with `--dangerously-skip-permissions`. Only the host owner can change it, and turning it
 * on asks first; a paired device sees the state only. While it is on, the row says what that
 * means for as long as it stays on.
 */
export const PermissionBypassSetting = ({
  bypass,
  owner,
  saving,
}: {
  bypass: PermissionBypass;
  owner: boolean;
  saving: boolean;
}) => (
  <div
    data-testid="permission-bypass"
    data-enabled={bypass.enabled}
    className={cn(
      "flex flex-col gap-2 rounded-row border bg-raised px-3 py-2.5",
      bypass.enabled ? "border-blocked/40" : "border-border",
    )}
  >
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <label htmlFor="permission-bypass-switch" className="text-[13px] font-medium text-text">
          Skip permission checks
        </label>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-text-subtle">
          Every Claude Code session this host starts runs with{" "}
          <code className="text-[11px]">--dangerously-skip-permissions</code>: coordinator and
          thread turns, follow-ups and resumed sessions, from the next turn on. Off by default. The
          coordinator keeps its AOP tools only.
        </p>
      </div>
      {owner ? (
        <Switch
          id="permission-bypass-switch"
          data-testid="permission-bypass-switch"
          checked={bypass.enabled}
          disabled={saving || (!bypass.enabled && bypass.blockedReason !== null)}
          onCheckedChange={(checked) => void toggle(checked)}
        />
      ) : (
        <span data-testid="permission-bypass-state" className="text-[12px] text-text-muted">
          {bypass.enabled ? "On" : "Off"}
        </span>
      )}
    </div>
    {owner ? null : (
      <p data-testid="permission-bypass-owner-only" className="text-[11.5px] text-text-subtle">
        Only the host owner can change this, on the host machine.
      </p>
    )}
    {bypass.blockedReason ? (
      <p
        role="alert"
        data-testid="permission-bypass-blocked"
        className="text-[12px] leading-relaxed text-blocked"
      >
        {bypass.blockedReason}
      </p>
    ) : null}
    {bypass.enabled && bypass.blockedReason === null ? <BypassWarning /> : null}
  </div>
);

/** The badge beside the Agent CLIs heading while agents skip permission checks. */
export const PermissionBypassBadge = () => (
  <span
    data-testid="permission-bypass-badge"
    className="flex items-center gap-1 rounded-md border border-blocked/30 bg-blocked/10 px-1.5 py-px text-[11px] font-medium text-blocked"
  >
    <ShieldOffIcon className="size-3" />
    Permission checks off
  </span>
);

const BypassWarning = () => (
  <div
    role="status"
    data-testid="permission-bypass-warning"
    className="flex gap-2.5 rounded-row border border-blocked/30 bg-blocked/10 px-3 py-2.5 text-[12.5px] leading-relaxed text-text"
  >
    <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-blocked" />
    <div className="flex flex-col gap-1">
      <p className="font-medium text-blocked">
        Agents run any command and edit any file on this host without asking.
      </p>
      <p className="text-text-muted">
        This overrides every project's thread access, Edit files included. Only a project's
        read-only survey thread keeps its limits.
      </p>
    </div>
  </div>
);

const toggle = async (enabled: boolean): Promise<void> => {
  if (enabled) {
    const confirmed = await requestConfirmation({
      title: "Skip permission checks for every agent?",
      message:
        "Every Claude Code session this host starts, in every project, will run any command and edit any file as you, without asking: deleting files outside a repository, reading credentials, pushing to any remote. A wrong instruction, or text an attacker put in a file, an issue or memory, is enough to make an agent try. Projects set to Edit files lose that limit while this is on. It applies from each session's next turn.",
      confirmLabel: "Skip permission checks",
      destructive: true,
    });
    if (!confirmed) return;
  }
  await changeSkipPermissions(enabled);
};
