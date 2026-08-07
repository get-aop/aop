export type HostPlatform = "unix" | "windows";

export interface CommandSpec {
  program: string;
  args: string[];
  env?: Record<string, string>;
}

export interface CommandOutput {
  status: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run: (command: CommandSpec) => Promise<CommandOutput>;
}
