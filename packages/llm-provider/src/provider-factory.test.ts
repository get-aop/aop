import { describe, expect, test } from "bun:test";
import { createProvider } from "./provider-factory";
import { ClaudeCodeProvider } from "./providers/claude-code";
import { CodexCliProvider } from "./providers/codex-cli";
import { PiProvider } from "./providers/pi";

describe("createProvider", () => {
  test("returns ClaudeCodeProvider for 'claude-code'", () => {
    const provider = createProvider("claude-code");
    expect(provider).toBeInstanceOf(ClaudeCodeProvider);
    expect(provider.name).toBe("claude-code");
  });

  test("returns CodexCliProvider for 'codex-cli'", () => {
    const provider = createProvider("codex-cli");
    expect(provider).toBeInstanceOf(CodexCliProvider);
    expect(provider.name).toBe("codex-cli");
  });

  test("keeps old Codex provider keys as aliases for persisted settings", () => {
    expect(createProvider("codex")).toBeInstanceOf(CodexCliProvider);
    expect(createProvider("openai-codex")).toBeInstanceOf(CodexCliProvider);
  });

  test("returns PiProvider for 'pi'", () => {
    const provider = createProvider("pi");
    expect(provider).toBeInstanceOf(PiProvider);
    expect(provider.name).toBe("pi");
  });

  test("throws for unknown provider key", () => {
    expect(() => createProvider("unknown-provider")).toThrow("Unknown provider: unknown-provider");
  });

  test("throws for empty string", () => {
    expect(() => createProvider("")).toThrow("Unknown provider: ");
  });

  test.each(["grok-build", "e2e-fixture", "opencode", "opencode:openai/gpt-5.5", "openclaw:ops"])(
    "throws for removed runtime key %s",
    (key) => {
      expect(() => createProvider(key)).toThrow(`Unknown provider: ${key}`);
    },
  );
});
