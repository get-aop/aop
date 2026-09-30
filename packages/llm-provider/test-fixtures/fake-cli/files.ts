import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { FileWrite } from "./types";

/** Writes each file under `cwd` and returns the paths it refused because they lead outside it. */
export const writeFiles = (writes: FileWrite[], cwd: string): string[] => {
  const refused: string[] = [];
  for (const { path, content } of writes) {
    const target = resolve(cwd, path);
    if (isAbsolute(path) || relative(cwd, target).startsWith("..")) {
      refused.push(path);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return refused;
};
