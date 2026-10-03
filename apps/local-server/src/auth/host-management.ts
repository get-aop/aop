import {
  AGENT_SESSION_HEADER,
  type AuthPrincipal,
  type HostManagement,
  mayManageHost,
  parseHostManagement,
} from "@aop/common";
import type { Context } from "hono";
import type { SettingsRepository } from "../settings/repository.ts";
import { isManagerSettingKey, isOwnerOnlySettingKey, SettingKey } from "../settings/types.ts";

/** Who is asking, as far as managing the host goes. */
export interface HostCaller {
  kind: AuthPrincipal["kind"];
  /** The request came from the `aop` CLI inside an agent's turn. */
  agent: boolean;
}

/** The `host_management` setting: who may update the host and pair devices. */
export const readHostManagement = async (settings: SettingsRepository): Promise<HostManagement> =>
  parseHostManagement(await settings.get(SettingKey.HOST_MANAGEMENT));

/**
 * Whether `caller` may manage the host: update it and its agent CLIs, change its update settings,
 * pair and revoke devices. An agent never may, whatever the setting, so a turn cannot restart the
 * host it runs in or widen its own rights.
 */
export const callerMayManage = (setting: HostManagement, caller: HostCaller): boolean =>
  !caller.agent && mayManageHost(setting, caller.kind);

/** Whether the request was made by an agent through the `aop` CLI (see AGENT_SESSION_HEADER). */
export const isAgentRequest = (c: Context): boolean =>
  c.req.header(AGENT_SESSION_HEADER) !== undefined;

export interface AccessRefusal {
  error: string;
  code: "AGENT_REFUSED" | "HOST_ONLY";
}

/**
 * Why `caller` may not do what `level` guards, or null when it may: `owner` is the host machine's
 * alone, `manager` follows `host_management`. An agent is refused both. Worded for the person
 * who reads it, with where to change it.
 */
export const accessRefusal = async (
  level: "owner" | "manager",
  caller: HostCaller,
  hostManagement: () => Promise<HostManagement>,
): Promise<AccessRefusal | null> => {
  const setting = level === "owner" ? "owner" : await hostManagement();
  if (callerMayManage(setting, caller)) return null;
  if (caller.agent) {
    return {
      error:
        "Agents can't update or reconfigure the host they run on. Ask the person to do it in AOP.",
      code: "AGENT_REFUSED",
    };
  }
  return {
    error:
      level === "owner"
        ? "Only available on the host machine"
        : "Only the host machine can update this host. Its owner can let paired devices do it in AOP settings › General › Who can update this host.",
    code: "HOST_ONLY",
  };
};

/**
 * Why `caller` may not write `keys`, or null when it may write them all. Owner-only keys
 * (settings/types.ts) lower a guard on the host and are the host machine's; manager keys decide
 * when the host updates itself and follow `host_management`. Everyone reads both.
 */
export const settingsWriteRefusal = async (
  keys: readonly string[],
  caller: HostCaller,
  hostManagement: () => Promise<HostManagement>,
): Promise<AccessRefusal | null> => {
  if (keys.some(isOwnerOnlySettingKey)) {
    const refusal = await accessRefusal("owner", caller, hostManagement);
    if (refusal) return refusal;
  }
  return keys.some(isManagerSettingKey) ? accessRefusal("manager", caller, hostManagement) : null;
};
