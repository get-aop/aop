export const DEFAULT_LOCAL_SERVER_PORT = 25150;

/** The port the host listens on, as `aop run` reads it. */
export const hostPort = (env: NodeJS.ProcessEnv = process.env): number => {
  const port = Number.parseInt(env.AOP_LOCAL_SERVER_PORT ?? "", 10);
  return Number.isInteger(port) && port > 0 ? port : DEFAULT_LOCAL_SERVER_PORT;
};
