import type { PermissionBypass } from "@aop/common";
import { buildClaudeCodeSpawnEnv, getLogger } from "@aop/infra";
import type { SettingsRepository } from "../settings/repository.ts";
import { SettingKey } from "../settings/types.ts";

const logger = getLogger("agent-cli", "permission-bypass");

/** What the person reads when the host cannot skip permission checks (see `bypassBlockedReason`). */
export const ROOT_WITHOUT_SANDBOX =
  "AOP runs as root on this host, and Claude Code refuses --dangerously-skip-permissions as root outside a sandbox. Runs keep their usual permission checks. Run AOP as a regular user, or, if this host is a disposable sandbox such as a container or VM, set IS_SANDBOX=1 in AOP's environment.";

/** Who the CLI would run as: the host's own user and the env sessions are spawned with. */
export interface CliIdentity {
  uid: number | null;
  /** Read only for root, the one case that needs it. */
  env: () => Record<string, string | undefined>;
}

/**
 * Why runs on this host cannot skip permission checks, or null when they can. Claude Code 2.1.287
 * exits at startup when bypass mode (either flag) is asked for while it runs as uid 0, unless
 * `IS_SANDBOX=1` or `CLAUDE_CODE_BUBBLEWRAP` is set. The CLI inherits AOP's user and the spawn
 * env, so the host can tell beforehand and leave the flag off instead of failing every run.
 */
export const bypassBlockedReason = (identity: CliIdentity = hostIdentity()): string | null => {
  if (identity.uid !== 0) return null;
  const env = identity.env();
  if (env.IS_SANDBOX === "1" || env.CLAUDE_CODE_BUBBLEWRAP) return null;
  return ROOT_WITHOUT_SANDBOX;
};

/** The setting and whether this host can honour it, as Settings › Runtimes shows them. */
export const readPermissionBypass = async (
  settings: SettingsRepository,
  identity?: CliIdentity,
): Promise<PermissionBypass> => ({
  enabled: (await settings.get(SettingKey.AGENT_CLI_SKIP_PERMISSIONS)) === "true",
  blockedReason: bypassBlockedReason(identity),
});

/**
 * Whether a run launched now skips permission checks: read at every launch (first turns,
 * follow-ups, resumes), so a change reaches the next turn without restarting AOP. A host that
 * cannot skip them runs with the usual checks, and says why in the log and in the panel.
 */
export const launchSkipsPermissions = async (
  settings: SettingsRepository,
  identity?: CliIdentity,
): Promise<boolean> => {
  const bypass = await readPermissionBypass(settings, identity);
  if (!bypass.enabled) return false;
  if (bypass.blockedReason === null) return true;
  logger.warn("Skip permission checks is on but cannot apply: {reason}", {
    reason: bypass.blockedReason,
  });
  return false;
};

const hostIdentity = (): CliIdentity => ({
  uid: typeof process.getuid === "function" ? process.getuid() : null,
  env: () => buildClaudeCodeSpawnEnv(),
});
