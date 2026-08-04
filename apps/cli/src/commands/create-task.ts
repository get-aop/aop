import * as readline from "node:readline";
import { getLogger } from "@aop/infra";
import { createSpinner } from "../format/spinner.ts";
import { fetchServer, requireServer } from "./client.ts";

const logger = getLogger("cli", "create-task");
type CreateTaskLogger = Pick<typeof logger, "debug" | "error" | "info" | "warn">;

interface CreateTaskRuntime {
  createInterface: typeof readline.createInterface;
  createSpinner: typeof createSpinner;
  cwd: () => string;
  exit: typeof process.exit;
  fetchServer: typeof fetchServer;
  logger: CreateTaskLogger;
  offSignal: typeof process.off;
  onSignal: typeof process.on;
  requireServer: typeof requireServer;
}

type CreateTaskRuntimeOverrides = Partial<CreateTaskRuntime>;

const createRuntime = (overrides: CreateTaskRuntimeOverrides = {}): CreateTaskRuntime => {
  return {
    createInterface: readline.createInterface,
    createSpinner,
    cwd: () => process.cwd(),
    exit: process.exit,
    fetchServer,
    logger,
    offSignal: process.off,
    onSignal: process.on,
    requireServer,
    ...overrides,
  };
};

export interface CreateTaskCommandOptions {
  debug?: boolean;
  raw?: boolean;
}

export const createTaskCommand = async (
  _description?: string,
  _options: CreateTaskCommandOptions = {},
  runtimeOverrides: CreateTaskRuntimeOverrides = {},
): Promise<void> => {
  const runtime = createRuntime(runtimeOverrides);
  runtime.logger.error(
    "create-task is deprecated. Open AOP Sessions and use /task create so the session can generate the complete task package.",
  );
  runtime.exit(1);
};
