import { guiSafePath } from "./platform";
import type { CommandSpec, HostPlatform } from "./types";

const GUIDE_URLS = {
  "install-git": "https://git-scm.com/install/mac",
  "install-github-cli": "https://cli.github.com/",
  "install-runtime-claude": "https://code.claude.com/docs/en/quickstart#step-1-install-claude-code",
} as const;

export interface InstallerTooling {
  homebrew: boolean;
  winget: boolean;
}

export interface SetupActionPlan {
  id: string;
  title: string;
  kind: "command" | "manual";
  command?: CommandSpec;
  commandPreview: string;
  manualInstructions: string;
}

export interface InstallerRegistry {
  plan: (actionId: string) => SetupActionPlan;
}

export const setupGuideUrl = (actionId: string): string => {
  const url = GUIDE_URLS[actionId as keyof typeof GUIDE_URLS];
  if (!url) throw new Error(`Unknown setup action: ${actionId}`);
  return url;
};

export const createInstallerRegistry = (
  platform: HostPlatform,
  tooling: InstallerTooling,
): InstallerRegistry => {
  void tooling;
  return {
    plan: (actionId) => buildPlan(platform, actionId),
  };
};

const buildPlan = (platform: HostPlatform, actionId: string): SetupActionPlan => {
  if (actionId in GUIDE_URLS) {
    return guidePlan(platform, actionId, actionTitle(actionId), setupGuideUrl(actionId));
  }

  if (actionId === "auth-github-cli") {
    return manualPlan(
      actionId,
      "Sign in to GitHub",
      `Run \`gh auth login -h github.com -w\` in ${platform === "windows" ? "a terminal" : "Terminal"}, complete the browser flow, then return to AOP and check again.`,
    );
  }

  if (platform === "windows") return windowsAutomationPlan(actionId);
  return unixAutomationPlan(actionId);
};

const unixAutomationPlan = (actionId: string): SetupActionPlan => {
  if (actionId === "install-browser-runtime") {
    return commandPlan(
      actionId,
      "Install browser automation",
      shellCommand("bunx -y playwright@1.62.1 install chromium"),
      "Installs the pinned Chromium runtime used by AOP browser automation.",
    );
  }
  if (actionId === "install-claude-browser-extension") {
    return commandPlan(
      actionId,
      "Open Claude browser extension",
      command("open", [
        "https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn",
      ]),
      "Opens Anthropic's official extension in the Chrome Web Store.",
    );
  }
  throw new Error(`Unknown setup action: ${actionId}`);
};

const windowsAutomationPlan = (actionId: string): SetupActionPlan => {
  if (actionId === "install-browser-runtime") {
    return manualPlan(
      actionId,
      "Install browser automation in WSL",
      "Open the selected WSL distro and run `bunx -y playwright@1.62.1 install chromium`.",
    );
  }
  if (actionId === "install-claude-browser-extension") {
    return commandPlan(
      actionId,
      "Open Claude browser extension",
      command("cmd", [
        "/C",
        "start",
        "",
        "https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn",
      ]),
      "Opens Anthropic's official extension. Claude Code integration requires native Windows and is unavailable through WSL.",
    );
  }
  throw new Error(`Unknown setup action: ${actionId}`);
};

const guidePlan = (
  platform: HostPlatform,
  id: string,
  title: string,
  url: string,
): SetupActionPlan =>
  commandPlan(
    id,
    title,
    platform === "windows" ? command("cmd", ["/C", "start", "", url]) : command("open", [url]),
    "Follow the official installation guide, then return to AOP and check again.",
  );

const commandPlan = (
  id: string,
  title: string,
  commandSpec: CommandSpec,
  manualInstructions: string,
): SetupActionPlan => ({
  id,
  title,
  kind: "command",
  command: commandSpec,
  commandPreview: [commandSpec.program, ...commandSpec.args].join(" "),
  manualInstructions,
});

const manualPlan = (id: string, title: string, manualInstructions: string): SetupActionPlan => ({
  id,
  title,
  kind: "manual",
  commandPreview: manualInstructions,
  manualInstructions,
});

const shellCommand = (script: string): CommandSpec => command("sh", ["-lc", script]);

const command = (program: string, args: string[]): CommandSpec => ({
  program,
  args,
  env: { PATH: guiSafePath() },
});

const actionTitle = (actionId: string): string => {
  const titles: Record<string, string> = {
    "install-git": "Install Git",
    "install-github-cli": "Install GitHub CLI",
    "install-runtime-claude": "Install Claude Code",
  };
  return titles[actionId] ?? actionId;
};
