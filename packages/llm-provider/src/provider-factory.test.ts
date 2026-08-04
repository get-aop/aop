import { describe, expect, test } from "bun:test";
import { createProvider } from "./provider-factory";
import { ClaudeCodeProvider } from "./providers/claude-code";
import { CodexCliProvider } from "./providers/codex-cli";
import { E2EFixtureProvider } from "./providers/e2e-fixture";
import { GrokBuildProvider } from "./providers/grok-build";
import { OpenClawProvider } from "./providers/openclaw";
import { OpenCodeProvider } from "./providers/opencode";
import { PiProvider } from "./providers/pi";

describe("createProvider", () => {
  test("returns ClaudeCodeProvider for 'claude-code'", () => {
    const provider = createProvider("claude-code");
    expect(provider).toBeInstanceOf(ClaudeCodeProvider);
    expect(provider.name).toBe("claude-code");
  });

  test("returns OpenCodeProvider for 'opencode:opencode-go/kimi-k2.7-code'", () => {
    const provider = createProvider("opencode:opencode-go/kimi-k2.7-code");
    expect(provider).toBeInstanceOf(OpenCodeProvider);
    expect(provider.name).toBe("opencode");
    expect((provider as OpenCodeProvider).model).toBe("opencode-go/kimi-k2.7-code");
  });

  test("returns OpenCodeProvider for workflow-style GPT 5.5 model keys", () => {
    const provider = createProvider("opencode:openai/gpt-5.5/high");
    expect(provider).toBeInstanceOf(OpenCodeProvider);
    expect((provider as OpenCodeProvider).model).toBe("openai/gpt-5.5/high");
  });

  test("returns OpenCodeProvider for 'opencode:openai/gpt-5.5'", () => {
    const provider = createProvider("opencode:openai/gpt-5.5");
    expect(provider).toBeInstanceOf(OpenCodeProvider);
    expect(provider.name).toBe("opencode");
    expect((provider as OpenCodeProvider).model).toBe("openai/gpt-5.5");
  });

  test("returns OpenClawProvider for 'openclaw:ops'", () => {
    const provider = createProvider("openclaw:ops");
    expect(provider).toBeInstanceOf(OpenClawProvider);
    expect(provider.name).toBe("openclaw");
    expect((provider as OpenClawProvider).agentId).toBe("ops");
  });

  test("returns CodexCliProvider for 'codex-cli'", () => {
    const provider = createProvider("codex-cli");
    expect(provider).toBeInstanceOf(CodexCliProvider);
    expect(provider.name).toBe("codex-cli");
  });

  test("returns GrokBuildProvider for 'grok-build'", () => {
    const provider = createProvider("grok-build");
    expect(provider).toBeInstanceOf(GrokBuildProvider);
    expect(provider.name).toBe("grok-build");
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

  test("returns E2EFixtureProvider for 'e2e-fixture'", () => {
    const provider = createProvider("e2e-fixture");
    expect(provider).toBeInstanceOf(E2EFixtureProvider);
    expect(provider.name).toBe("e2e-fixture");
  });

  test("throws for unknown provider key", () => {
    expect(() => createProvider("unknown-provider")).toThrow("Unknown provider: unknown-provider");
  });

  test("throws for empty string", () => {
    expect(() => createProvider("")).toThrow("Unknown provider: ");
  });

  test("throws for 'opencode' without model", () => {
    expect(() => createProvider("opencode")).toThrow("Unknown provider: opencode");
  });

  test("throws for 'opencode:' with empty model", () => {
    expect(() => createProvider("opencode:")).toThrow("Unknown provider: opencode:");
  });

  test("throws for removed provider names", () => {
    expect(() => createProvider("removed-provider")).toThrow("Unknown provider: removed-provider");
  });

  test("throws for removed prefixed provider keys", () => {
    expect(() => createProvider("removed-provider:model")).toThrow(
      "Unknown provider: removed-provider:model",
    );
  });

  test("throws for 'openclaw:' with empty agent id", () => {
    expect(() => createProvider("openclaw:")).toThrow("Unknown provider: openclaw:");
  });
});
