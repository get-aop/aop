import { dirname, join } from "node:path";

const MONOREPO_PACKAGE_JSON = join(import.meta.dirname, "../../../../package.json");

export const resolveInstalledVersion = async (): Promise<string> => {
  const envVersion = process.env.AOP_BUILD_VERSION?.trim();
  if (envVersion) {
    return envVersion;
  }

  try {
    const pkg = await Bun.file(MONOREPO_PACKAGE_JSON).json();
    if (typeof pkg.version === "string" && pkg.version.trim().length > 0) {
      return `${pkg.version.trim()}+dev`;
    }
  } catch {
    // Fall back below for non-monorepo installs.
  }

  return "dev";
};

export const isCompiledBinaryInstall = async (): Promise<boolean> => {
  const execName = process.execPath.split("/").pop() ?? "";
  if (execName === "bun" || execName.startsWith("bun")) {
    return false;
  }

  const dashboardIndex = join(dirname(process.execPath), "dashboard", "index.html");
  return Bun.file(dashboardIndex).exists();
};
