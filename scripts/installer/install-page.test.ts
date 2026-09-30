import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const readPage = (): Promise<string> =>
  readFile(join(import.meta.dir, "../../docs/install/index.html"), "utf8");

describe("install page", () => {
  test("offers the host one-liner and the desktop downloads", async () => {
    const page = await readPage();

    expect(page).toContain("curl -fsSL https://getaop.com/install.sh | sh");
    expect(page).toContain("https://getaop.com/latest/aop-macos-arm64.dmg");
    expect(page).toContain("https://getaop.com/latest/aop-macos-x64.dmg");
    expect(page).toContain("https://getaop.com/latest/aop-windows-x64-setup.exe");
    expect(page).toContain("SmartScreen");
  });

  test("offers nothing for a Windows host, CLI or WSL", async () => {
    const page = await readPage();

    expect(page).not.toContain("install.ps1");
    expect(page).not.toContain("aop-windows-x64.exe");
    expect(page).not.toContain("WSL");
    expect(page).not.toContain("latest/version");
  });

  test("every tab has a panel to show", async () => {
    const page = await readPage();
    const tabs = [...page.matchAll(/data-tab="(\w+)"/g)].map((match) => match[1]);

    expect(tabs).toEqual(["host", "desktop", "bun"]);
    for (const tab of tabs) expect(page).toContain(`id="panel-${tab}"`);
  });
});
