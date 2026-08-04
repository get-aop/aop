import { describe, expect, test } from "bun:test";
import { getProviderCapabilities } from "./capabilities.ts";

describe("provider capabilities", () => {
  test("exposes runtime capabilities for loop role decisions", async () => {
    const matrix = await getProviderCapabilities({
      commandExists: async () => false,
      readVersion: async () => null,
      hasAuth: () => false,
      canWriteLog: async () => false,
    });

    expect(matrix.map((entry) => entry.id)).toEqual([
      "claude-code",
      "codex-cli",
      "grok-build",
      "opencode",
      "pi",
    ]);
    expect(matrix.find((entry) => entry.id === "opencode")?.capabilities).toMatchObject({
      structuredJsonl: "yes",
      resumeSupport: "yes",
      usageReporting: "partial",
      nativePlanMode: "yes",
      permissionSandboxFlags: "yes",
      liveFollowUp: "yes",
    });
  });

  test("fills readiness probes from local CLI and auth checks", async () => {
    const matrix = await getProviderCapabilities({
      commandExists: async (command) => command === "opencode",
      readVersion: async (command) => (command === "opencode" ? "opencode 0.12.0" : null),
      hasAuth: (providerId) => providerId === "opencode",
      canWriteLog: async () => true,
    });

    expect(matrix.find((entry) => entry.id === "opencode")?.readinessProbe).toMatchObject({
      cliInstalled: true,
      authenticated: true,
      versionDetected: true,
      canSpawn: true,
      canResume: true,
      canWriteLogs: true,
      canReportUsage: true,
      supportsConfiguredSafetyFlags: true,
    });
    expect(matrix.find((entry) => entry.id === "opencode")?.version).toBe("opencode 0.12.0");
    expect(matrix.find((entry) => entry.id === "claude-code")?.readinessProbe).toMatchObject({
      cliInstalled: false,
      authenticated: false,
      versionDetected: false,
      canSpawn: false,
    });
  });
});
