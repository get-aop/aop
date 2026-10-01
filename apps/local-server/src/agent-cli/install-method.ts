import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { AgentCliInstallMethod } from "@aop/common";
import type { AgentCliDefinition } from "./definitions.ts";

/** How one installed CLI is updated, decided from where its command resolves. */
export interface UpdatePlan {
  method: AgentCliInstallMethod;
  /** The argv the host runs, or null when it cannot update this install itself. */
  command: string[] | null;
  /** What the person runs by hand when the host cannot, or when its update fails. */
  manualCommand: string;
  /**
   * Whether the update may run while runs of this CLI are in flight. Only a native installer that
   * keeps old versions is: it writes the new version beside the old one, then repoints the
   * symlink, so a running process keeps the file it started from. A package manager replaces
   * the package's files in place, and a run that loads one lazily could read half an update.
   */
  safeWhileRunning: boolean;
}

export interface InstallLocation {
  /** Where the command resolves on PATH (often a symlink). */
  path: string;
  /** The file that path points at. */
  realPath: string;
}

/**
 * Reads the install method from the resolved file's path, the one thing every installer leaves
 * a mark on. Each package manager is run from the directory the command was found in when it is
 * there (npm under nvm, bun's ~/.bun/bin), so the update lands in the install that sessions use
 * and not in another one that happens to be first on PATH. Nothing is ever run with sudo.
 */
export const detectUpdatePlan = (
  definition: AgentCliDefinition,
  location: InstallLocation,
  channel: string,
  fileExists: (path: string) => boolean = existsSync,
): UpdatePlan => {
  const real = location.realPath.replaceAll("\\", "/");
  const spec = `${definition.npmPackage}@${channel}`;
  const sibling = (tool: string) => siblingOrBare(location.path, tool, fileExists);

  const native = definition.native?.layouts.find((layout) => real.includes(layout.marker));
  if (definition.native && native) {
    const command = [location.path, ...definition.native.updateArgs];
    return plan("native", command, native.keepsOldVersions, definition);
  }
  if (real.includes("/Caskroom/") && definition.brewCask) {
    return plan("brew", [sibling("brew"), "upgrade", "--cask", definition.brewCask], false);
  }
  const formula = real.match(/\/Cellar\/([^/]+)\//)?.[1];
  if (formula) return plan("brew", [sibling("brew"), "upgrade", formula], false);
  if (!real.includes(`/node_modules/${definition.npmPackage}/`)) {
    return unknownPlan(definition, spec);
  }
  if (real.includes("/.bun/install/global/")) {
    return plan("bun", [sibling("bun"), "add", "--global", spec], false);
  }
  if (/\/pnpm\/|\/\.pnpm\//.test(real)) {
    return plan("pnpm", [sibling("pnpm"), "add", "--global", spec], false);
  }
  return plan("npm", [sibling("npm"), "install", "--global", spec], false);
};

/** A command as the person would type it: bare program name, arguments quoted when they need it. */
export const formatCommand = (argv: readonly string[]): string =>
  argv.map((arg, index) => quote(index === 0 ? basename(arg) : arg)).join(" ");

const plan = (
  method: AgentCliInstallMethod,
  command: string[],
  safeWhileRunning: boolean,
  definition?: AgentCliDefinition,
): UpdatePlan => ({
  method,
  command,
  // `claude update` is what the person types, whatever path the host found it at.
  manualCommand: definition
    ? formatCommand([definition.command, ...command.slice(1)])
    : formatCommand(command),
  safeWhileRunning,
});

const unknownPlan = (definition: AgentCliDefinition, spec: string): UpdatePlan => {
  const native = definition.native
    ? `${formatCommand([definition.command, ...definition.native.updateArgs])}, or `
    : "";
  return {
    method: "unknown",
    command: null,
    manualCommand: `${native}npm install --global ${spec}`,
    safeWhileRunning: false,
  };
};

const siblingOrBare = (
  commandPath: string,
  tool: string,
  fileExists: (path: string) => boolean,
): string => {
  const candidate = join(dirname(commandPath), tool);
  return fileExists(candidate) ? candidate : tool;
};

const quote = (arg: string): string => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg}'`);
