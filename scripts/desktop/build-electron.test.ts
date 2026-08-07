import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildElectronBundlePlan } from "./build-electron";

describe("Electron main-process build", () => {
  test("bundles main and preload as CommonJS while keeping Electron external", () => {
    expect(buildElectronBundlePlan("/repo")).toEqual({
      entrypoints: [
        join("/repo", "apps/desktop/electron/main.ts"),
        join("/repo", "apps/desktop/electron/preload.ts"),
      ],
      external: ["electron"],
      format: "cjs",
      naming: "[name].cjs",
      outdir: join("/repo", "apps/desktop/dist-electron"),
      sourcemap: "external",
      target: "node",
    });
  });
});
