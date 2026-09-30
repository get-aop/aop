import { sql } from "kysely";
import type { LocalServerContext } from "../context.ts";

export interface HealthDeps {
  ctx: LocalServerContext;
  startTimeMs: number;
}

export const getHealth = async (deps: HealthDeps): Promise<Record<string, unknown>> => {
  const { ctx, startTimeMs } = deps;
  const uptimeSecs = Math.floor((Date.now() - startTimeMs) / 1000);

  return {
    ok: true,
    service: "aop",
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
