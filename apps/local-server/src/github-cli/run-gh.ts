import { defaultGhRunner, type RunCommand } from "../command-runner.ts";

export type { CommandResult } from "../command-runner.ts";

export type RunGh = RunCommand;

export const defaultRunGh: RunGh = defaultGhRunner;

export const isGhAuthenticated = async (): Promise<boolean> =>
  (await Bun.$`gh auth status`.quiet().nothrow()).exitCode === 0;
