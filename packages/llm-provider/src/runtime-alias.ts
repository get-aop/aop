import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";

/**
 * Resolve a configured runtime command for spawn.
 *
 * - Empty / missing → provider default (`claude`, `codex`, …) left as a bare name.
 * - Absolute path → used as-is.
 * - Bare name like `cpe` → resolved via PATH / `~/.local/bin` when present.
 *
 * Shell aliases are not visible to process spawn. Keep a real executable on PATH
 * (e.g. `~/.local/bin/cpe`) that matches the interactive zsh alias.
 */
export const resolveRuntimeAlias = (value: string | undefined, fallback: string): string => {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  return resolveRuntimeExecutable(trimmed);
};

export const resolveRuntimeExecutable = (command: string): string => {
  const name = command.trim();
  if (!name) return name;

  if (isAbsolute(name) || name.includes("/") || name.includes("\\")) {
    return name;
  }

  const fromPath = whichOnPath(name);
  if (fromPath) return fromPath;

  const homeBin = join(homedir(), ".local", "bin", name);
  if (existsSync(homeBin)) return homeBin;

  return name;
};

const whichOnPath = (name: string): string | null => {
  const pathEnv = mergeLookupPath(process.env.PATH);
  const found = Bun.which(name, { PATH: pathEnv });
  return found ?? null;
};

const mergeLookupPath = (rawPath: string | undefined): string => {
  const parts = (rawPath ?? "").split(delimiter).filter(Boolean);
  const homeBin = join(homedir(), ".local", "bin");
  if (!parts.includes(homeBin)) {
    parts.unshift(homeBin);
  }
  return parts.join(delimiter);
};
