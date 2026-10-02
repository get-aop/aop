import { buildChannel } from "@aop/common";

/** 25150 for stable, 25650 for AOP Nightly. */
export const DEFAULT_LOCAL_SERVER_PORT = buildChannel().hostPort;

/** The port the host listens on, as `aop run` reads it. */
export const hostPort = (env: NodeJS.ProcessEnv = process.env): number => {
  const port = Number.parseInt(env.AOP_LOCAL_SERVER_PORT ?? "", 10);
  return Number.isInteger(port) && port > 0 ? port : DEFAULT_LOCAL_SERVER_PORT;
};
