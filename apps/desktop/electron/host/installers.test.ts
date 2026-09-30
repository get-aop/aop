import { describe, expect, test } from "bun:test";
import { createInstallerRegistry, setupGuideUrl } from "./installers";

describe("Electron setup installer plans", () => {
  test("opens known setup guides and rejects unknown actions", () => {
    expect(setupGuideUrl("install-github-cli")).toBe("https://cli.github.com/");
    expect(setupGuideUrl("install-runtime-claude")).toContain("code.claude.com");
    expect(() => setupGuideUrl("install-everything")).toThrow("Unknown setup action");
  });

  test("uses macOS guide commands without requiring Homebrew", () => {
    const registry = createInstallerRegistry("unix", { homebrew: false, winget: false });

    expect(registry.plan("install-github-cli")).toMatchObject({
      kind: "command",
      command: { program: "open", args: ["https://cli.github.com/"] },
    });
    expect(registry.plan("install-runtime-claude").command?.program).toBe("open");
  });

  test("uses the current Playwright version for browser setup", () => {
    const plan = createInstallerRegistry("unix", { homebrew: true, winget: false }).plan(
      "install-browser-runtime",
    );

    expect(plan.commandPreview).toContain("playwright@1.62.1 install chromium");
  });

  test("keeps WSL-only setup manual on Windows", () => {
    const registry = createInstallerRegistry("windows", { homebrew: false, winget: true });

    expect(registry.plan("install-browser-runtime")).toMatchObject({
      kind: "manual",
      manualInstructions: expect.stringContaining("playwright@1.62.1"),
    });
    expect(registry.plan("install-claude-browser-extension").command).toMatchObject({
      program: "cmd",
      args: ["/C", "start", "", expect.stringContaining("chromewebstore.google.com")],
    });
  });
});
