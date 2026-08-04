import { join } from "node:path";
import { normalizeReleaseVersion } from "./versioning.ts";

const defaultWorkspaceRoot = join(import.meta.dirname, "../..");
let workspaceRootOverride: string | null = null;

const getWorkspaceRoot = (): string => workspaceRootOverride ?? defaultWorkspaceRoot;

export const setWorkspaceRootForTests = (path: string | null): void => {
  workspaceRootOverride = path;
};

// The root package.json is the single source of truth for the AOP version.
export const readRootVersion = async (): Promise<string> => {
  const pkg = await Bun.file(join(getWorkspaceRoot(), "package.json")).json();
  if (typeof pkg.version !== "string" || pkg.version.trim().length === 0) {
    throw new Error("Root package.json is missing a version");
  }

  return pkg.version.trim();
};

export const bumpRootVersion = async (nextVersion: string): Promise<string[]> => {
  const normalized = normalizeReleaseVersion(nextVersion);
  const rootPath = join(getWorkspaceRoot(), "package.json");
  const pkg = await Bun.file(rootPath).json();
  if (pkg.version === normalized) {
    return [];
  }

  pkg.version = normalized;
  await Bun.write(rootPath, `${JSON.stringify(pkg, null, 2)}\n`);
  return ["package.json"];
};
