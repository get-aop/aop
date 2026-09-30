import { type AppDependencies, createApp } from "../app.ts";

/**
 * `app.request` has no socket behind it, so the server sees no peer address and treats the
 * request as remote. Bun hands the real server in as Hono's `env`; these stand in for it.
 */
export const peerAt = (address: string) => ({
  requestIP: () => ({ address, family: address.includes(":") ? "IPv6" : "IPv4", port: 50_000 }),
});

export const LOOPBACK_PEER = peerAt("127.0.0.1");
/** A tailnet or LAN client that reaches the server directly, not through a proxy. */
export const REMOTE_PEER = peerAt("100.64.0.7");

/** The app as the host owner's own machine sees it, for tests of routes behind the auth guard. */
export const createLoopbackApp = (deps: AppDependencies) => {
  const app = createApp(deps);
  const request = app.request.bind(app);
  app.request = (input, init, env, executionCtx) =>
    request(input, init, env ?? LOOPBACK_PEER, executionCtx);
  return app;
};
