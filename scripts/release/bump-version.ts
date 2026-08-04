import { join } from "node:path";
import { normalizeReleaseVersion } from "./versioning.ts";

const defaultWorkspaceRoot = join(import.meta.dirname, "../..");
let workspaceRootOverride: string | null = null;

const getWorkspaceRoot = (): string => workspaceRootOverride ?? defaultWorkspaceRoot;

export const setWorkspaceRootForTests = (path: string | null): void => {
  workspaceRootOverride = path;
};

const PACKAGE_JSON_PATHS = [
  "package.json",
  "apps/cli/package.json",
  "apps/dashboard/package.json",
  "apps/desktop/package.json",
  "apps/license-server/package.json",
  "apps/local-server/package.json",
  "packages/common/package.json",
  "packages/git-manager/package.json",
  "packages/infra/package.json",
  "packages/license/package.json",
  "packages/llm-provider/package.json",
  "e2e-tests/package.json",
] as const;

export const readRootVersion = async (): Promise<string> => {
  const pkg = await Bun.file(join(getWorkspaceRoot(), "package.json")).json();
  if (typeof pkg.version !== "string" || pkg.version.trim().length === 0) {
    throw new Error("Root package.json is missing a version");
  }

  return pkg.version.trim();
};

export const bumpWorkspaceVersions = async (nextVersion: string): Promise<string[]> => {
  const normalized = normalizeReleaseVersion(nextVersion);
  const updatedPaths: string[] = [];

  for (const relativePath of PACKAGE_JSON_PATHS) {
    const absolutePath = join(getWorkspaceRoot(), relativePath);
    const file = Bun.file(absolutePath);
    if (!(await file.exists())) {
      continue;
    }

    const pkg = await file.json();
    if (pkg.version === normalized) {
      continue;
    }

    pkg.version = normalized;
    await Bun.write(absolutePath, `${JSON.stringify(pkg, null, 2)}\n`);
    updatedPaths.push(relativePath);
  }

  return updatedPaths;
};
