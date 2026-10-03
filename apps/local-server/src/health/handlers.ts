import { API_VERSION, buildChannel, MIN_CLIENT_API_VERSION } from "@aop/common";
import { sql } from "kysely";
import type { LocalServerContext } from "../context.ts";

export interface HealthDeps {
  ctx: LocalServerContext;
  startTimeMs: number;
  port?: number;
}

export const getHealth = async (deps: HealthDeps): Promise<Record<string, unknown>> => {
  const { ctx, startTimeMs, port } = deps;
  const uptimeSecs = Math.floor((Date.now() - startTimeMs) / 1000);

  return {
    ok: true,
    service: "aop",
    // Read by clients before they hold a token, to see whether they can talk to this host at all.
    version: process.env.AOP_BUILD_VERSION?.trim() || "dev",
    // `nightly` for AOP Nightly, so a client can tell the two hosts on one machine apart.
    channel: buildChannel().id,
    // A pairing code is asked for on the host machine at this port; behind a proxy, a client
    // can't read it from its own address (docs/HOST.md).
    port,
    apiVersion: API_VERSION,
    minClientApiVersion: MIN_CLIENT_API_VERSION,
    uptime: uptimeSecs,
    db: { connected: await checkDbConnection(ctx) },
  };
};

const checkDbConnection = async (ctx: LocalServerContext): Promise<boolean> => {
  try {
    await sql`select 1`.execute(ctx.db);
    return true;
  } catch {
    return false;
  }
};
