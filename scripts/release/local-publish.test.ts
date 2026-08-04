import { describe, expect, test } from "bun:test";
import { buildLocalReleasePlan } from "./local-publish.ts";

describe("local-publish release planning", () => {
  test("builds the macOS DMG on a macOS host", () => {
    const plan = buildLocalReleasePlan({ version: "0.2.20", platform: "darwin" });

    expect(plan.version).toBe("0.2.20");
    expect(plan.tag).toBe("v0.2.20");
    expect(plan.steps.map((step) => step.label)).toEqual([
      "Build release binaries",
      "Package signed macOS DMGs",
      "Generate checksums",
      "Create GitHub Release",
      "Deploy release assets to R2",
      "Verify public latest/version",
    ]);
    expect(plan.steps[0]?.command).toEqual(["bun", "run", "build:release"]);
    expect(plan.steps[1]?.command).toEqual([
      "bun",
      "run",
      "package:macos-dmg",
      "--",
      "--version",
      "0.2.20",
    ]);
    expect(plan.steps[3]?.command).toContain("v0.2.20");
    expect(plan.steps[4]?.command).toEqual(["bash", "scripts/release/deploy-r2.sh", "0.2.20"]);
  });

  test("builds the Windows installer on a Windows host", () => {
    const plan = buildLocalReleasePlan({ version: "0.2.20", platform: "win32" });

    const installerStep = plan.steps.find((step) => step.label === "Package Windows installer");
    expect(installerStep?.command).toEqual([
      "bun",
      "run",
      "package:windows",
      "--",
      "--version",
      "0.2.20",
    ]);
    expect(plan.steps.map((step) => step.label)).not.toContain("Package signed macOS DMGs");
  });

  test("can skip the Windows installer on a Windows host", () => {
    const plan = buildLocalReleasePlan({
      version: "0.2.20",
      platform: "win32",
      skipWindows: true,
    });

    expect(plan.steps.map((step) => step.label)).not.toContain("Package Windows installer");
  });

  test("can skip expensive build phases when artifacts already exist", () => {
    const plan = buildLocalReleasePlan({
      version: "0.2.20",
      platform: "darwin",
      skipBuild: true,
      skipMacos: true,
    });

    expect(plan.steps.map((step) => step.label)).toEqual([
      "Generate checksums",
      "Create GitHub Release",
      "Deploy release assets to R2",
      "Verify public latest/version",
    ]);
  });
});
