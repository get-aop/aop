import { homedir } from "node:os";
import { join } from "node:path";
import type { CliProvider } from "@aop/common";

/**
 * What the host needs to know about one agent CLI to find it, read its version, look up the
 * newest release and update it. Claude Code is the only one sessions run in Phase 1. Codex
 * (`codex`, npm `@openai/codex`, cask `codex`) and PI join with their own entry when their
 * provider ids join `CliProviderSchema`; nothing else here is specific to Claude Code.
 */
export interface AgentCliDefinition {
  provider: CliProvider;
  label: string;
  /** The command sessions launch (the built-in runtime configuration's command). */
  command: string;
  /** The npm package: its registry dist-tags say what is published, and package managers install it. */
  npmPackage: string;
  /** The Homebrew cask that installs it, when there is one. */
  brewCask: string | null;
  /**
   * Path segments that mark the CLI's own installer, and the arguments that make the CLI update
   * itself there. `keepsOldVersions` says the installer writes each version to a file of its own
   * and repoints a symlink, leaving the old file in place. Null when it has no installer.
   */
  native: {
    layouts: { marker: string; keepsOldVersions: boolean }[];
    updateArgs: string[];
  } | null;
  /** The dist-tag the person follows; `latest` unless the CLI's own config says otherwise. */
  readChannel: () => Promise<string>;
  /** The field of a run's `system` init event that names the CLI version. */
  initVersionField: string;
}

export const CLAUDE_CODE_CLI: AgentCliDefinition = {
  provider: "claude-code",
  label: "Claude Code",
  command: "claude",
  npmPackage: "@anthropic-ai/claude-code",
  brewCask: "claude-code",
  native: {
    // The native installer keeps each version as a file under versions/ (the last five) and
    // points ~/.local/bin/claude at one; the older "local" install lives under ~/.claude/local.
    layouts: [
      { marker: "/.local/share/claude/versions/", keepsOldVersions: true },
      // An npm install of its own: `claude update` replaces its files in place.
      { marker: "/.claude/local/", keepsOldVersions: false },
    ],
    updateArgs: ["update"],
  },
  readChannel: () => readClaudeCodeChannel(),
  initVersionField: "claude_code_version",
};

export const AGENT_CLIS: readonly AgentCliDefinition[] = [CLAUDE_CODE_CLI];

export const findAgentCli = (provider: string): AgentCliDefinition | null =>
  AGENT_CLIS.find((definition) => definition.provider === provider) ?? null;

/** Claude Code's `autoUpdatesChannel` setting: "latest" (the default) or "stable". */
export const readClaudeCodeChannel = async (
  settingsPath = join(
    process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude"),
    "settings.json",
  ),
): Promise<string> => {
  try {
    const settings: unknown = await Bun.file(settingsPath).json();
    const channel = (settings as { autoUpdatesChannel?: unknown }).autoUpdatesChannel;
    return channel === "stable" ? "stable" : "latest";
  } catch {
    return "latest";
  }
};
