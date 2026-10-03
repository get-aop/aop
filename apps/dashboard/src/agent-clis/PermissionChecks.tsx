import { useIsHostOwner } from "../settings/use-host-owner";
import { skipsPermissions } from "./agent-cli-store";
import { PermissionBypassBadge, PermissionBypassSetting } from "./PermissionBypassSetting";
import { useAgentCliStatus } from "./use-agent-clis";

/**
 * Settings §Runtimes, top: whether the agents this host starts ask before running commands. The
 * agent CLIs' versions and updates are on AOP settings › Updates.
 */
export const PermissionChecks = () => {
  const { data, savingBypass, error } = useAgentCliStatus();
  const owner = useIsHostOwner(true);
  if (data === null) return null;
  return (
    <section data-testid="permission-checks" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-semibold text-text">Permission checks</h2>
        {skipsPermissions(data) ? <PermissionBypassBadge /> : null}
      </div>
      {error ? (
        <p role="alert" data-testid="agent-clis-error" className="text-[12px] text-blocked">
          {error}
        </p>
      ) : null}
      <PermissionBypassSetting bypass={data.skipPermissions} owner={owner} saving={savingBypass} />
    </section>
  );
};
