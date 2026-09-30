import { describe, expect, test } from "bun:test";
import {
  CONTROL_COMMANDS,
  controlCommandLabel,
  defaultControlSelection,
  formatControlCommandMarker,
  parseControlCommand,
  rewriteControlCommandMarker,
} from "@aop/common";

describe("controlCommandLabel", () => {
  test("returns provider + capability descriptions without technical ids", () => {
    expect(CONTROL_COMMANDS.map(controlCommandLabel)).toEqual([
      "Claude Browser",
      "Claude Computer",
    ]);
  });
});

describe("parseControlCommand", () => {
  test("parses a Claude browser command and removes its marker", () => {
    expect(parseControlCommand("$CC_BROWSER_USE Sign in and inspect the billing page")).toEqual({
      command: { provider: "claude-code", capability: "browser" },
      prompt: "Sign in and inspect the billing page",
    });
  });

  test("parses model and thinking payload from the control marker", () => {
    expect(
      parseControlCommand("$CC_BROWSER_USE[claude-opus-4-8;high] inspect the page"),
    ).toMatchObject({
      command: {
        provider: "claude-code",
        capability: "browser",
        model: "claude-opus-4-8",
        reasoning: "high",
      },
      prompt: "inspect the page",
    });
  });

  test("keeps the fast flag only when a runtime configuration is bound", () => {
    expect(
      parseControlCommand("$CC_COMPUTER_USE[claude-opus-5;medium;fast;cfg:rtprov_x] open Settings"),
    ).toMatchObject({
      command: { provider: "claude-code", capability: "computer", fastMode: true },
    });
    expect(
      parseControlCommand("$CC_COMPUTER_USE[claude-opus-5;medium;fast] open Settings"),
    ).not.toHaveProperty("command.fastMode");
  });

  test("parses a Claude computer command placed after the request", () => {
    expect(parseControlCommand("Open System Settings $CC_COMPUTER_USE")).toEqual({
      command: { provider: "claude-code", capability: "computer" },
      prompt: "Open System Settings",
    });
  });

  test("does not recognize the removed Codex control commands", () => {
    expect(parseControlCommand("$CX_BROWSER_USE inspect the page")).toBeNull();
    expect(parseControlCommand("$CX_COMPUTER_USE open System Settings")).toBeNull();
  });

  test("rejects competing control commands", () => {
    expect(parseControlCommand("$CC_BROWSER_USE $CC_COMPUTER_USE Compare both results")).toEqual({
      error: "Use one computer or browser control command per message.",
    });
  });

  test("leaves ordinary browser wording as a normal runtime prompt", () => {
    expect(parseControlCommand("Please use the browser to investigate this")).toBeNull();
  });
});

describe("control command selection helpers", () => {
  test("formats and rewrites markers with model and thinking", () => {
    const selection = {
      id: "CC_BROWSER_USE" as const,
      model: "claude-opus-4-8",
      reasoning: "high" as const,
      fastMode: false,
    };
    expect(formatControlCommandMarker(selection)).toBe("$CC_BROWSER_USE[claude-opus-4-8;high]");
    expect(rewriteControlCommandMarker("check billing $CC_BROWSER_USE", selection)).toBe(
      "check billing $CC_BROWSER_USE[claude-opus-4-8;high]",
    );
  });

  test("default selection picks a valid model for the control provider", () => {
    const selection = defaultControlSelection("CC_BROWSER_USE");
    expect(selection?.id).toBe("CC_BROWSER_USE");
    expect(selection?.model).toBeTruthy();
    expect(selection?.reasoning).toBeTruthy();
    expect(selection?.fastMode).toBe(false);
  });

  test("default selection uses runtime configuration defaults when provided", () => {
    const configs = [
      {
        id: "rtprov_claude_code",
        name: "Claude Code",
        command: "claude",
        driver: "claude-code" as const,
        builtIn: true,
        position: 0,
        supportsFastMode: false,
        models: [
          {
            id: "m0",
            providerId: "rtprov_claude_code",
            description: "Sonnet",
            model: "claude-sonnet-4-6",
            thinkingLevels: ["low", "medium"] as Array<"low" | "medium">,
            builtIn: true,
            position: 0,
            isDefault: true,
            defaultThinkingLevel: "medium" as const,
          },
        ],
      },
      {
        id: "rtprov_claude_personal",
        name: "Claude Code personal",
        command: "claude-personal",
        driver: "claude-code" as const,
        builtIn: false,
        position: 1,
        supportsFastMode: true,
        models: [
          {
            id: "m1",
            providerId: "rtprov_claude_personal",
            description: "Opus",
            model: "claude-opus-4-8",
            thinkingLevels: ["low", "high", "max"] as Array<"low" | "high" | "max">,
            builtIn: false,
            position: 0,
            isDefault: true,
            defaultThinkingLevel: "high" as const,
          },
        ],
      },
    ];
    expect(defaultControlSelection("CC_BROWSER_USE", configs)).toEqual({
      id: "CC_BROWSER_USE",
      model: "claude-sonnet-4-6",
      reasoning: "medium",
      fastMode: false,
      runtimeConfigurationId: "rtprov_claude_code",
    });
    // Session bound to personal profile is preferred when drivers match.
    expect(defaultControlSelection("CC_BROWSER_USE", configs, "rtprov_claude_personal")).toEqual({
      id: "CC_BROWSER_USE",
      model: "claude-opus-4-8",
      reasoning: "high",
      fastMode: false,
      runtimeConfigurationId: "rtprov_claude_personal",
    });
    // An unknown preferred configuration falls back to the first runnable one.
    expect(
      defaultControlSelection("CC_BROWSER_USE", configs, "rtprov_unknown")?.runtimeConfigurationId,
    ).toBe("rtprov_claude_code");
  });

  test("round-trips runtime configuration id on control markers", () => {
    const marker = formatControlCommandMarker({
      id: "CC_BROWSER_USE",
      model: "claude-opus-5",
      reasoning: "high",
      fastMode: true,
      runtimeConfigurationId: "rtprov_claude_personal",
    });
    expect(marker).toBe("$CC_BROWSER_USE[claude-opus-5;high;fast;cfg:rtprov_claude_personal]");
    expect(parseControlCommand(`inspect ${marker}`)).toMatchObject({
      command: {
        provider: "claude-code",
        capability: "browser",
        model: "claude-opus-5",
        reasoning: "high",
        fastMode: true,
        runtimeConfigurationId: "rtprov_claude_personal",
      },
      prompt: "inspect",
    });
  });
});
