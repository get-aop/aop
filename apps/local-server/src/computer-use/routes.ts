import type { CuaLeaseState, LiveViewViewer } from "@aop/common";
import { Hono } from "hono";
import type { AuthEnv } from "../auth/api-auth.ts";
import type { LiveViewService } from "./live-view.ts";
import type { ComputerUseService } from "./service.ts";

/**
 * Whether CUA Driver can serve threads on this host. Any paired device may read it, so a remote
 * dashboard explains the CUA option; choosing it is the host owner's alone (project routes).
 * `?fresh=1` probes again instead of reusing the last few seconds' answer.
 *
 * The live view of the host's screen (`/live`, `/live/frame`) is for any authenticated caller:
 * the person watching from a paired device is who it is for, and a device already sees every
 * thread's work and screenshots. The `live_view` host setting decides who gets frames at all.
 *
 * `/lease` says which thread holds the computer-use lease and who waits for it, for any device.
 */
export const createComputerUseRoutes = (
  service: ComputerUseService,
  liveView: LiveViewService,
  lease: () => CuaLeaseState,
) => {
  const routes = new Hono<AuthEnv>();

  routes.get("/lease", (c) => c.json(lease()));

  routes.get("/cua", async (c) =>
    c.json(await service.cuaStatus({ fresh: c.req.query("fresh") === "1" })),
  );

  routes.get("/live", async (c) => c.json(await liveView.status(viewerOf(c.get("principal")))));

  routes.get("/live/frame", async (c) => {
    const answer = await liveView.frame(viewerOf(c.get("principal")));
    if (answer.kind === "refused") {
      return c.json({ error: answer.error, code: answer.code }, answer.status);
    }
    const etag = `"${answer.frame.id}"`;
    const headers = { ETag: etag, "Cache-Control": "no-store" };
    if (c.req.header("if-none-match") === etag) return c.body(null, 304, headers);
    return new Response(answer.frame.jpeg, {
      status: 200,
      headers: { ...headers, "Content-Type": "image/jpeg" },
    });
  });

  return routes;
};

const viewerOf = (principal: AuthEnv["Variables"]["principal"]): LiveViewViewer => principal.kind;
