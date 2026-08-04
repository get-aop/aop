import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

type RailwayConfig = {
  build?: {
    builder?: string;
    watchPatterns?: string[];
  };
  deploy?: {
    healthcheckPath?: string;
    restartPolicyType?: string;
    startCommand?: string;
  };
};

type PackageJson = {
  packageManager?: string;
};

const readRailwayConfig = async (): Promise<RailwayConfig> => {
  const contents = await readFile(join(import.meta.dir, "railway.toml"), "utf8");
  return Bun.TOML.parse(contents) as RailwayConfig;
};

const readPackageJson = async (path: string): Promise<PackageJson> => {
  const contents = await readFile(path, "utf8");
  return JSON.parse(contents) as PackageJson;
};

const readRootPackageJson = async (): Promise<PackageJson> => {
  return readPackageJson(join(import.meta.dir, "../../package.json"));
};

const readLicenseServerPackageJson = async (): Promise<PackageJson> => {
  return readPackageJson(join(import.meta.dir, "package.json"));
};

describe("license-server Railway config", () => {
  test("pins Bun as the package manager for Railway workspace installs", async () => {
    const rootPackageJson = await readRootPackageJson();
    const licenseServerPackageJson = await readLicenseServerPackageJson();

    expect(rootPackageJson.packageManager).toBe("bun@1.3.14");
    expect(licenseServerPackageJson.packageManager).toBe("bun@1.3.14");
  });

  test("uses Railpack with the shared monorepo start command", async () => {
    const config = await readRailwayConfig();

    expect(config.build?.builder).toBe("RAILPACK");
    expect(config.deploy?.startCommand).toBe("bun run --filter @aop/license-server start");
    expect(config.deploy?.healthcheckPath).toBe("/health");
    expect(config.deploy?.restartPolicyType).toBe("ON_FAILURE");
  });

  test("watches the license server and shared workspace packages", async () => {
    const config = await readRailwayConfig();

    expect(config.build?.watchPatterns).toEqual([
      "/apps/license-server/**",
      "/packages/license/**",
      "/packages/infra/**",
      "/package.json",
      "/bun.lock",
      "/bunfig.toml",
      "/tsconfig.json",
    ]);
  });
});
