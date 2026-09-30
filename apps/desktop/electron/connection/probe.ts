import { API_VERSION, checkHostCompatibility } from "@aop/common";
import type { ConnectionState } from "../../src/backend/types";
import type { HostClient } from "./host-client";

/**
 * One look at a host: does it answer, does it speak this app's API, and does it accept this
 * device? The order matters: a host that cannot be reached says nothing about the token, and a
 * host from another API version must be reported before its 401s are read as a revoked device.
 */
export const probeHost = async (
  client: HostClient,
  host: string,
  token: string | null,
  clientApiVersion: number = API_VERSION,
): Promise<ConnectionState> => {
  const health = await client.health();
  if (health.status === "unreachable") {
    return { status: "unreachable", host, message: health.message };
  }
  if (health.status === "not-aop") {
    return { status: "incompatible", host, reason: "not-aop", hostVersion: null };
  }

  const compatibility = checkHostCompatibility(health.health, clientApiVersion);
  if (compatibility.status !== "compatible") {
    return {
      status: "incompatible",
      host,
      reason: compatibility.status,
      hostVersion: health.health.version,
    };
  }

  const principal = await client.principal(token);
  if (principal.status === "ok") {
    return { status: "connected", host, hostVersion: health.health.version };
  }
  if (principal.status === "unauthorized") return { status: "unauthorized", host };
  return { status: "unreachable", host, message: principal.message };
};
