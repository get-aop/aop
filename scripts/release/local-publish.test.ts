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
      "Write release notes",
      "Create GitHub Release",
      "Deploy release assets to R2",
      "Verify the published install script",
      "Verify the published release feed",
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
    expect(plan.steps[3]?.command).toEqual([
      "bun",
      "run",
      "./scripts/release/release-notes.ts",
      "v0.2.20",
      "get-aop/aop",
      "dist/release-notes.md",
    ]);
    expect(plan.steps[4]?.command).toContain("v0.2.20");
    expect(plan.steps[5]?.command).toEqual(["bash", "scripts/release/deploy-r2.sh", "0.2.20"]);
  });

  test("builds the Windows desktop installer on a Windows host", () => {
    const plan = buildLocalReleasePlan({ version: "0.2.20", platform: "win32" });

    const installerStep = plan.steps.find(
      (step) => step.label === "Package Windows desktop installer",
    );
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

    expect(plan.steps.map((step) => step.label)).not.toContain("Package Windows desktop installer");
  });

  test("waits for the install script and the release feed, never a latest/version file", () => {
    const plan = buildLocalReleasePlan({ version: "0.2.20", platform: "darwin" });

    const [install, feed] = plan.steps.slice(-2).map((step) => step.command.join(" "));
    expect(`${install} ${feed}`).not.toContain("latest/version");
    expect(install).toContain('^DEFAULT_VERSION="0.2.20"');
    expect(feed).toContain("https://getaop.com/releases/latest.json");
    expect(feed).toContain('"version": "0.2.20"');
  });

  test("skips the R2 deploy and its verification together", () => {
    const plan = buildLocalReleasePlan({ version: "0.2.20", platform: "darwin", skipR2: true });

    expect(plan.steps.map((step) => step.label)).not.toContain("Deploy release assets to R2");
    expect(plan.steps.map((step) => step.label)).not.toContain(
      "Verify the published install script",
    );
    expect(plan.steps.map((step) => step.label)).not.toContain("Verify the published release feed");
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
      "Write release notes",
      "Create GitHub Release",
      "Deploy release assets to R2",
      "Verify the published install script",
      "Verify the published release feed",
    ]);
  });
});
