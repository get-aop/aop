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
 * `searchPath` is the PATH of the env the process is spawned with; a run passes it so the
 * command is looked up where it will be launched from, at every launch. Nothing is cached: an
 * agent CLI updated (or moved) since the last turn is what the next turn starts.
 *
 * Shell aliases are not visible to process spawn. Keep a real executable on PATH
 * (e.g. `~/.local/bin/cpe`) that matches the interactive zsh alias.
 */
export const resolveRuntimeAlias = (
  value: string | undefined,
  fallback: string,
  searchPath?: string,
): string => {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  return resolveRuntimeExecutable(trimmed, searchPath);
};

export const resolveRuntimeExecutable = (command: string, searchPath?: string): string => {
  const name = command.trim();
  if (!name) return name;

  if (isAbsolute(name) || name.includes("/") || name.includes("\\")) {
    return name;
  }

  const fromPath = whichOnPath(name, searchPath ?? process.env.PATH);
  if (fromPath) return fromPath;

  const homeBin = join(homedir(), ".local", "bin", name);
  if (existsSync(homeBin)) return homeBin;

  return name;
};

const whichOnPath = (name: string, searchPath: string | undefined): string | null => {
  const pathEnv = mergeLookupPath(searchPath);
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
