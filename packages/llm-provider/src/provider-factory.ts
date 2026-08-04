import { ClaudeCodeProvider } from "./providers/claude-code";
import { CodexCliProvider } from "./providers/codex-cli";
import { E2EFixtureProvider } from "./providers/e2e-fixture";
import { GrokBuildProvider } from "./providers/grok-build";
import { OpenClawProvider } from "./providers/openclaw";
import { OpenCodeProvider } from "./providers/opencode";
import { PiProvider } from "./providers/pi";
import type { LLMProvider } from "./types";

const createStaticProvider = (key: string): LLMProvider | null => {
  if (key === "claude-code") return new ClaudeCodeProvider();
  if (key === "codex-cli") return new CodexCliProvider();
  if (key === "codex") return new CodexCliProvider();
  if (key === "openai-codex") return new CodexCliProvider();
  if (key === "grok-build") return new GrokBuildProvider();
  if (key === "e2e-fixture") return new E2EFixtureProvider();
  if (key === "pi") return new PiProvider();
  return null;
};

const createPrefixedProvider = (key: string): LLMProvider | null => {
  if (key.startsWith("openclaw:")) {
    const agentId = key.slice("openclaw:".length);
    if (!agentId) throw new Error(`Unknown provider: ${key}`);
    return new OpenClawProvider(agentId);
  }

  if (key.startsWith("opencode:")) {
    const model = key.slice("opencode:".length);
    if (!model) throw new Error(`Unknown provider: ${key}`);
    return new OpenCodeProvider(model);
  }

  return null;
};

export const createProvider = (key: string): LLMProvider => {
  const staticProvider = createStaticProvider(key);
  if (staticProvider) return staticProvider;

  const prefixedProvider = createPrefixedProvider(key);
  if (prefixedProvider) return prefixedProvider;

  throw new Error(`Unknown provider: ${key}`);
};
