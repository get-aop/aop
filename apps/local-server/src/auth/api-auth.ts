import type { AuthPrincipal, HostManagement } from "@aop/common";
import { getLogger } from "@aop/infra";
import type { Context, MiddlewareHandler } from "hono";
import { bearerTokenOf, readSessionCookie } from "./credentials.ts";
import { accessRefusal, type HostCaller, isAgentRequest } from "./host-management.ts";
import { isDirectLocalRequest } from "./local-request.ts";
import { type RouteAccess, routeAccess } from "./route-policy.ts";
import type { AuthService } from "./service.ts";

const logger = getLogger("auth");

export type AuthEnv = { Variables: { principal: AuthPrincipal; caller: HostCaller } };

/**
 * Puts every `/api/*` route behind authentication unless `route-policy.ts` says otherwise.
 * A caller is the host owner (a direct request on the host machine, see `local-request.ts`)
 * or a device presenting its bearer token or session cookie. A revoked token stops matching
 * on the next request, and streams the device already holds open are closed. `hostManagement`
 * reads who may manage the host, for the `manager` routes.
 */
export const createApiAuth = (
  auth: AuthService,
  hostManagement: () => Promise<HostManagement>,
): MiddlewareHandler<AuthEnv> => {
  return async (c, next) => {
    const access = routeAccess(c.req.method, c.req.path);
    if (access === "public") return next();

    const principal = await resolvePrincipal(c, auth);
    if (!principal) {
      logger.warn("Rejected unauthenticated {method} {path}", {
        method: c.req.method,
        path: c.req.path,
      });
      return c.json({ error: "Authentication required", code: "UNAUTHENTICATED" }, 401, {
        "WWW-Authenticate": "Bearer",
      });
    }
    const caller: HostCaller = { kind: principal.kind, agent: isAgentRequest(c) };
    const refusal = await guardRefusal(access, caller, hostManagement);
    if (refusal) return c.json(refusal, 403);

    c.set("principal", principal);
    c.set("caller", caller);
    await next();
    if (principal.kind === "device") closeStreamOnRevoke(c, auth, principal.device.id);
  };
};

const guardRefusal = (
  access: RouteAccess,
  caller: HostCaller,
  hostManagement: () => Promise<HostManagement>,
) =>
  access === "owner" || access === "manager"
    ? accessRefusal(access, caller, hostManagement)
    : Promise.resolve(null);

const resolvePrincipal = async (c: Context, auth: AuthService): Promise<AuthPrincipal | null> => {
  // Checked first: a stale cookie on the host's own dashboard must not lock the owner out.
  if (isDirectLocalRequest(c)) return { kind: "owner" };

  const token = bearerTokenOf(c) ?? readSessionCookie(c);
  if (!token) return null;
  const device = await auth.authenticate(token);
  return device ? { kind: "device", device } : null;
};

// An event stream authenticates once, when it opens, and can then run for days. Without this,
// revoking a device would leave whatever stream it already held open flowing.
const closeStreamOnRevoke = (c: Context, auth: AuthService, deviceId: string): void => {
  const response = c.res;
  const isStream = response.headers.get("content-type")?.includes("text/event-stream");
  if (!isStream || !response.body) return;
  c.res = new Response(endWhenRevoked(response.body, auth, deviceId), response);
};

const endWhenRevoked = (
  body: ReadableStream<Uint8Array>,
  auth: AuthService,
  deviceId: string,
): ReadableStream<Uint8Array> => {
  const reader = body.getReader();
  let ended = false;
  let stopListening = () => {};

  return new ReadableStream<Uint8Array>({
    start(controller) {
      stopListening = auth.onDeviceRevoked(deviceId, () => {
        if (ended) return;
        ended = true;
        controller.close();
        void reader.cancel();
      });
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (ended) return;
      if (done) {
        ended = true;
        stopListening();
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      ended = true;
      stopListening();
      return reader.cancel(reason);
    },
  });
};
