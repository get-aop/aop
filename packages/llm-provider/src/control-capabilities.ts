export const PLAYWRIGHT_MCP_VERSION = "0.0.78";

export const getControlCapabilityUnsupportedReason = (
  provider: string,
  capability: "browser" | "computer",
): string | null => {
  if (provider !== "claude-code" || capability !== "computer") return null;
  return "Claude computer control is not supported in detached sessions because it requires an interactive session. Use Codex computer control instead.";
};
