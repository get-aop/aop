import type { RunOptions, RunResult, SetupSystem } from "./system.ts";

export const HOME = "/home/ada";
export const LIBS = [
  "libX11.so.6",
  "libXi.so.6",
  "libXext.so.6",
  "libxcb.so.1",
  "libxkbcommon.so.0",
];

export interface FakeMachine {
  sys: SetupSystem;
  /** Every command run, joined by spaces, with `interactive` marked. */
  runs: string[];
  files: Map<string, string>;
  /** Commands on the PATH. */
  commands: Set<string>;
  /** Paths that exist besides the files (sockets, binaries, directories' entries). */
  paths: Set<string>;
  rootOwned: Set<string>;
  installedVersion: { value: string | null };
  linger: { value: boolean };
}

export interface FakeMachineOptions {
  platform?: NodeJS.Platform;
  arch?: string;
  /** Commands on the PATH (by name). */
  commands?: string[];
  libraries?: string[];
  paths?: string[];
  rootOwned?: string[];
  /** The driver's version, or null when none is installed. */
  driver?: string | null;
  env?: Record<string, string>;
  linger?: boolean;
  /** Answers a command the fake does not know; exit 0 and no output otherwise. */
  answer?: (argv: string[], options?: RunOptions) => RunResult | undefined;
}

/** A Linux (or macOS) machine in memory: what setup reads, and a record of what it changes. */
export const fakeMachine = (options: FakeMachineOptions = {}): FakeMachine => {
  const runs: string[] = [];
  const files = new Map<string, string>();
  const commands = new Set(
    options.commands ?? ["systemctl", "loginctl", "ldconfig", "apt-get", "curl"],
  );
  const paths = new Set(options.paths ?? []);
  const rootOwned = new Set(options.rootOwned ?? []);
  const installedVersion = { value: options.driver === undefined ? null : options.driver };
  const linger = { value: options.linger ?? true };
  const libraries = options.libraries ?? LIBS;
  const state = { libraries, installedVersion, linger, paths };

  const run = async (argv: string[], runOptions?: RunOptions): Promise<RunResult> => {
    runs.push(`${runOptions?.interactive ? "[tty] " : ""}${argv.join(" ")}`);
    return (
      options.answer?.(argv, runOptions) ??
      knownAnswer(state, argv, runOptions) ?? { exitCode: 0, output: "" }
    );
  };

  if (installedVersion.value) paths.add(DRIVER_PATH);
  const sys: SetupSystem = {
    platform: options.platform ?? "linux",
    arch: options.arch ?? "x64",
    home: HOME,
    user: "ada",
    env: options.env ?? {},
    run,
    which: (command) => (commands.has(command) ? `/usr/bin/${command}` : null),
    exists: (path) => files.has(path) || paths.has(path),
    list: (dir) =>
      [...paths, ...files.keys()]
        .filter((path) => path.startsWith(`${dir}/`))
        .map((path) => path.slice(dir.length + 1).split("/")[0] ?? "")
        .filter(Boolean),
    rootOwned: (path) => rootOwned.has(path),
    readText: (path) => files.get(path) ?? null,
    writeText: (path, text) => {
      files.set(path, text);
    },
  };
  return { sys, runs, files, commands, paths, rootOwned, installedVersion, linger };
};

const DRIVER_PATH = `${HOME}/.local/bin/cua-driver`;

interface MachineState {
  libraries: string[];
  installedVersion: { value: string | null };
  linger: { value: boolean };
  paths: Set<string>;
}

// What the real commands setup runs would answer, from the machine's state.
const knownAnswer = (
  state: MachineState,
  argv: string[],
  options?: RunOptions,
): RunResult | undefined => {
  const [command, first] = argv;
  if (command?.endsWith("ldconfig"))
    return { exitCode: 0, output: ldconfigOutput(state.libraries) };
  if (command === DRIVER_PATH && first === "--version") return driverVersion(state);
  if (command === "/bin/bash" && argv[2]?.includes("cua.ai/driver/install.sh")) {
    state.installedVersion.value = options?.env?.CUA_DRIVER_RS_VERSION ?? null;
    state.paths.add(DRIVER_PATH);
    return { exitCode: 0, output: "installed" };
  }
  if (command === "loginctl" && first === "show-user") {
    return { exitCode: 0, output: `Linger=${state.linger.value ? "yes" : "no"}\n` };
  }
  return undefined;
};

const driverVersion = (state: MachineState): RunResult =>
  state.installedVersion.value
    ? { exitCode: 0, output: `cua-driver ${state.installedVersion.value}\n` }
    : { exitCode: 1, output: "" };

const ldconfigOutput = (libraries: string[]): string =>
  libraries.map((lib) => `\t${lib} (libc6,x86-64) => /lib/${lib}`).join("\n");

/** A Linux host where everything computer use needs is installed, the display included. */
export const readyLinux = (overrides: FakeMachineOptions = {}): FakeMachine =>
  fakeMachine({
    commands: ["systemctl", "loginctl", "ldconfig", "apt-get", "curl", "Xvfb", "openbox", "ffmpeg"],
    paths: [
      "/usr/libexec/at-spi-bus-launcher",
      "/opt/google/chrome/google-chrome",
      "/tmp/.X11-unix/X99",
    ],
    rootOwned: ["/opt/google/chrome/google-chrome"],
    driver: "0.32.0",
    ...overrides,
  });
