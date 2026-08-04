import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");

describe("install.ps1 (native Windows)", () => {
  test("installs to %LOCALAPPDATA%\\aop, verifies checksums, and unblocks the exe", async () => {
    const script = await readFile(join(ROOT, "scripts/installer/install.ps1"), "utf8");

    expect(script).toContain('Join-Path $env:LOCALAPPDATA "aop"');
    expect(script).toContain("Get-FileHash -Algorithm SHA256");
    expect(script).toContain("Unblock-File");
    expect(script).toContain("tar.exe -xzf");
    expect(script).toContain("aop-windows-x64.exe");
    // Steers WSL users away from the native package.
    expect(script.toLowerCase()).toContain("wsl");
  });

  test("supports pinning a version and defaults to latest", async () => {
    const script = await readFile(join(ROOT, "scripts/installer/install.ps1"), "utf8");

    expect(script).toContain("param(");
    expect(script).toContain("[string]$Version");
    expect(script).toContain("/latest/version");
  });
});

describe("Windows install publishing", () => {
  test("the install page offers the Windows setup installer and PowerShell CLI path", async () => {
    const page = await readFile(join(ROOT, "docs/install/index.html"), "utf8");

    expect(page).toContain("panel-windows");
    expect(page).toContain("https://getaop.com/latest/aop-windows-x64-setup.exe");
    expect(page).toContain("irm https://getaop.com/install.ps1 | iex");
    expect(page).not.toContain("paused while Windows packaging");
    expect(page.toLowerCase()).toContain("wsl");
  });

  test("both deploy paths publish install.ps1 so the upgrade flow can fetch it", async () => {
    const r2 = await readFile(join(ROOT, "scripts/release/deploy-r2.sh"), "utf8");
    const legacy = await readFile(join(ROOT, "scripts/release/deploy-getaop.sh"), "utf8");

    expect(r2).toContain('upload_object "install.ps1" "scripts/installer/install.ps1"');
    expect(legacy).toContain("scripts/installer/install.ps1");
  });

  test("install.sh is unchanged for POSIX and never targets Windows", async () => {
    const sh = await readFile(join(ROOT, "scripts/installer/install.sh"), "utf8");

    expect(sh).not.toContain("aop-windows-x64");
  });
});
