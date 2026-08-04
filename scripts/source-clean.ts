#!/usr/bin/env bun

import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, parse, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  type SupportedPlatform,
  type UninstallDependencies,
  uninstallFromSource,
} from "./source-uninstall";
import {
  createTerminalProgress,
  silentTerminalProgress,
  type TerminalProgress,
} from "./terminal-progress";

type CleanDependencies = {
  confirm: (targetPath: string) => Promise<boolean>;
  removeDir: (path: string) => Promise<void>;
  uninstall: typeof uninstallFromSource;
};

type CleanOptions = {
  aopHome?: string;
  confirm?: boolean;
  dependencies?: Partial<CleanDependencies>;
  dryRun?: boolean;
  homeDir?: string;
  platform?: SupportedPlatform;
  progress?: TerminalProgress;
  uninstallDependencies?: Partial<UninstallDependencies>;
  workspaceDir?: string;
};

type CleanerArgs = {
  aopHome?: string;
  dryRun: boolean;
  mode: "clean" | "help";
  yes: boolean;
};

export type CleanSummary = {
  aopHome: string;
  dryRun: boolean;
  removed: boolean;
};

const CLEAN_USAGE = `Usage: ./clean [--yes] [--dry-run] [--aop-home <path>]

Removes local AOP runtime state for a fresh installation:
- stops and removes the local-server user service
- unlinks the global aop CLI registration
- removes the AOP home directory, defaulting to $AOP_HOME or ~/.aop

Use --dry-run to preview. Without --yes, type "clean" when prompted.
`;

export const parseCleanerArgs = (args: string[]): CleanerArgs => {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    return { dryRun: false, mode: "help", yes: false };
  }
  if (args.some((arg) => arg === "--help" || arg === "-h")) {
    throw new Error("--help cannot be combined with other arguments");
  }

  const parsed: CleanerArgs = { dryRun: false, mode: "clean", yes: false };

  for (let i = 0; i < args.length; i += 1) {
    i = parseCleanerArg(args, i, parsed);
  }

  return parsed;
};

export const cleanFromSource = async (options: CleanOptions = {}): Promise<CleanSummary> => {
  const homeDir = resolve(options.homeDir ?? homedir());
  const workspaceDir = resolve(options.workspaceDir ?? resolve(import.meta.dirname, ".."));
  const aopHome = resolve(options.aopHome ?? process.env.AOP_HOME ?? join(homeDir, ".aop"));
  const platform = options.platform ?? detectPlatform();
  const dependencies = createDependencies(options.dependencies);
  const progress = options.progress ?? silentTerminalProgress;
  const dryRun = options.dryRun ?? false;

  assertSafeAopHome(aopHome, { homeDir, workspaceDir });

  if (dryRun) {
    return { aopHome, dryRun, removed: false };
  }

  if (options.confirm !== true) {
    const confirmed = await dependencies.confirm(aopHome);
    if (!confirmed) {
      throw new Error("AOP clean cancelled.");
    }
  }

  await progress.runStep("Stopping installed AOP services", () =>
    dependencies.uninstall({
      dependencies: options.uninstallDependencies,
      homeDir,
      platform,
      progress: silentTerminalProgress,
      workspaceDir,
    }),
  );
  await progress.runStep("Removing AOP runtime home", () => dependencies.removeDir(aopHome));

  return { aopHome, dryRun, removed: true };
};

export const runSourceClean = async (args = process.argv.slice(2)): Promise<void> => {
  const parsed = parseCleanerArgs(args);
  if (parsed.mode === "help") {
    process.stdout.write(CLEAN_USAGE);
    return;
  }

  const progress = createTerminalProgress();
  const summary = await cleanFromSource({
    aopHome: parsed.aopHome,
    confirm: parsed.yes,
    dryRun: parsed.dryRun,
    progress,
  });

  if (parsed.dryRun) {
    process.stdout.write(`AOP clean dry run. Would remove: ${summary.aopHome}\n`);
    return;
  }

  process.stdout.write(
    `\nAOP clean complete.\nRemoved ${summary.aopHome}. Run ./install for a fresh setup.\n`,
  );
};

const parseCleanerArg = (args: string[], index: number, parsed: CleanerArgs): number => {
  const arg = args[index];
  switch (arg) {
    case "--yes":
    case "-y":
      parsed.yes = true;
      return index;
    case "--dry-run":
      parsed.dryRun = true;
      return index;
    case "--aop-home": {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--aop-home requires a path");
      }
      parsed.aopHome = value;
      return index + 1;
    }
    default:
      if (arg?.startsWith("--aop-home=")) {
        parsed.aopHome = arg.slice("--aop-home=".length);
        return index;
      }
      throw new Error(`Unknown argument "${arg}"`);
  }
};

const createDependencies = (dependencies: Partial<CleanDependencies> = {}): CleanDependencies => ({
  confirm: confirmClean,
  removeDir,
  uninstall: uninstallFromSource,
  ...dependencies,
});

const detectPlatform = (): SupportedPlatform => {
  if (process.platform === "darwin") return "darwin";
  if (process.platform === "linux") return "linux";
  throw new Error(
    `Unsupported platform "${process.platform}". Source clean supports macOS and Linux.`,
  );
};

const assertSafeAopHome = (
  aopHome: string,
  paths: { homeDir: string; workspaceDir: string },
): void => {
  const root = parse(aopHome).root;
  if (aopHome === root) {
    throw new Error(`Refusing to clean filesystem root: ${aopHome}`);
  }
  if (aopHome === paths.homeDir) {
    throw new Error(`Refusing to clean the user home directory: ${aopHome}`);
  }
  if (aopHome === paths.workspaceDir) {
    throw new Error(`Refusing to clean the AOP source workspace: ${aopHome}`);
  }
  if (isPathInside(paths.workspaceDir, aopHome)) {
    throw new Error(`Refusing to clean a parent of the AOP source workspace: ${aopHome}`);
  }
};

const isPathInside = (child: string, parent: string): boolean => {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && rel !== ".." && !rel.startsWith(`..${sep}`);
};

const confirmClean = async (targetPath: string): Promise<boolean> => {
  if (!process.stdin.isTTY) {
    throw new Error("Refusing to clean without confirmation. Re-run with --yes to confirm.");
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question(
      `This will permanently remove ${targetPath}. Type "clean" to continue: `,
    );
    return answer.trim() === "clean";
  } finally {
    readline.close();
  }
};

const removeDir = async (path: string): Promise<void> => {
  await rm(path, { recursive: true, force: true });
};

if (import.meta.main) {
  await runSourceClean();
}
