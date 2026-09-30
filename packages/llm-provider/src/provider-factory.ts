import { ClaudeCodeProvider } from "./providers/claude-code";
import { CodexCliProvider } from "./providers/codex-cli";
import { PiProvider } from "./providers/pi";
import type { LLMProvider } from "./types";

export const createProvider = (key: string): LLMProvider => {
  if (key === "claude-code") return new ClaudeCodeProvider();
  if (key === "codex-cli" || key === "codex" || key === "openai-codex") {
    return new CodexCliProvider();
  }
  if (key === "pi") return new PiProvider();
  throw new Error(`Unknown provider: ${key}`);
};
