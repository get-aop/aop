import { describe, expect, test } from "bun:test";
import { formatControlCommandMarker, parseControlCommand } from "@aop/common";

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

describe("control command markers", () => {
  test("formats a marker with model and thinking", () => {
    const selection = {
      id: "CC_BROWSER_USE" as const,
      model: "claude-opus-4-8",
      reasoning: "high" as const,
      fastMode: false,
    };
    expect(formatControlCommandMarker(selection)).toBe("$CC_BROWSER_USE[claude-opus-4-8;high]");
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
