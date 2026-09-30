import { describe, expect, test } from "bun:test";
import { getProviderCapabilities, probeProviderClis } from "./capabilities.ts";

describe("provider capabilities", () => {
  test("lists Claude Code as the only runtime", async () => {
    const matrix = await getProviderCapabilities({
      commandExists: async () => false,
      readVersion: async () => null,
      hasAuth: () => false,
      canWriteLog: async () => false,
    });

    expect(matrix.map((entry) => entry.id)).toEqual(["claude-code"]);
    expect(matrix[0]?.capabilities).toMatchObject({
      structuredJsonl: "partial",
      resumeSupport: "yes",
      usageReporting: "partial",
      nativePlanMode: "yes",
      permissionSandboxFlags: "yes",
      liveFollowUp: "yes",
    });
  });

  test("fills readiness probes from local CLI and auth checks", async () => {
    const matrix = await getProviderCapabilities({
      commandExists: async (command) => command === "claude",
      readVersion: async (command) => (command === "claude" ? "2.1.220 (Claude Code)" : null),
      hasAuth: (providerId) => providerId === "claude-code",
      canWriteLog: async () => true,
    });

    expect(matrix.find((entry) => entry.id === "claude-code")?.readinessProbe).toEqual({
      cliInstalled: true,
      authenticated: true,
      versionDetected: true,
      canSpawn: true,
      canResume: true,
      canWriteLogs: true,
      canReportUsage: true,
      supportsConfiguredSafetyFlags: true,
    });
    expect(matrix.find((entry) => entry.id === "claude-code")?.version).toBe(
      "2.1.220 (Claude Code)",
    );
  });

  test("reports an uninstalled CLI as not spawnable", async () => {
    const matrix = await getProviderCapabilities({
      commandExists: async () => false,
      readVersion: async () => null,
      hasAuth: () => true,
      canWriteLog: async () => true,
    });

    expect(matrix.find((entry) => entry.id === "claude-code")?.readinessProbe).toMatchObject({
      cliInstalled: false,
      authenticated: false,
      versionDetected: false,
      canSpawn: false,
    });
  });

  test("probes only the CLIs in the catalog", async () => {
    const probed: string[] = [];
    const probes = await probeProviderClis({
      commandExists: async (command) => {
        probed.push(command);
        return true;
      },
      readVersion: async () => "1.0.0",
      hasAuth: () => true,
      canWriteLog: async () => true,
    });

    expect(probed).toEqual(["claude"]);
    expect(probes).toEqual([
      { id: "claude-code", installed: true, version: "1.0.0", authenticated: true },
    ]);
  });
});
