import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  DesktopSetupState,
  RuntimeId,
  RuntimeRequirement,
  SetupAction,
  SetupRequirement,
  SetupRequirementId,
} from "../../src/setup/types";
import { createInstallerRegistry, type InstallerTooling } from "./installers";
import { currentPlatform, guiSafePath } from "./platform";
import type { CommandOutput, CommandRunner, CommandSpec, HostPlatform } from "./types";

const execFileAsync = promisify(execFile);

export const missingWslSetupState = (): DesktopSetupState => ({
  ready: false,
  requirements: [
    {
      id: "wsl",
      status: "missing",
      label: "WSL 2",
      message:
        "Install WSL 2 and a Linux distro with `wsl --install`, restart Windows, then check again.",
      actions: [],
    },
  ],
  runtimes: [],
  blockingRequirements: ["wsl"],
  automationActions: [],
});

export const collectSetupState = async (
  runner: CommandRunner,
  platform: HostPlatform = currentPlatform(),
): Promise<DesktopSetupState> => {
  const tooling = await detectInstallerTooling(platform, runner);
  const [git, githubCli, runtimes] = await Promise.all([
    detectGit(runner, platform, tooling),
    detectGithubCli(runner, platform, tooling),
    detectRuntimes(runner),
  ]);
  const runtime = buildRuntimeRequirement(runtimes, platform, tooling);
  const requirements = [git, githubCli, runtime];
  const blockingRequirements = requirements
    .filter(isBlockingRequirement)
    .map((requirement) => requirement.id);

  return {
    ready: blockingRequirements.length === 0,
    requirements,
    runtimes,
    blockingRequirements,
    automationActions: buildAutomationActions(runtimes, platform, tooling),
  };
};

export const createSystemCommandRunner = (): CommandRunner => ({
  run: async (command) => runCommand(command),
});

export const detectInstallerTooling = async (
  platform: HostPlatform,
  runner: CommandRunner,
): Promise<InstallerTooling> => {
  if (platform === "windows") {
    return {
      homebrew: false,
      winget: isSuccess(await runner.run(command("winget", ["--version"]))),
    };
  }
  return { homebrew: isSuccess(await runner.run(command("brew", ["--version"]))), winget: false };
};

const detectGit = async (
  runner: CommandRunner,
  platform: HostPlatform,
  tooling: InstallerTooling,
): Promise<SetupRequirement> => {
  const output = await runner.run(command("git", ["--version"]));
  if (isSuccess(output)) {
    return {
      id: "git",
      status: "ready",
      label: "Git",
      message: firstLineOr(output.stdout, "Git is installed."),
      actions: [],
    };
  }
  return {
    id: "git",
    status: "missing",
    label: "Git",
    message: "Git is required for repository operations.",
    actions: [buildSetupAction("install-git", "Install Git", "git", platform, tooling)],
  };
};

const detectGithubCli = async (
  runner: CommandRunner,
  platform: HostPlatform,
  tooling: InstallerTooling,
): Promise<SetupRequirement> => {
  const version = await runner.run(command("gh", ["--version"]));
  if (!isSuccess(version)) {
    return {
      id: "github-cli",
      status: "missing",
      label: "GitHub CLI",
      message: "GitHub CLI is optional and enables GitHub authentication and PR operations.",
      actions: [
        buildSetupAction(
          "install-github-cli",
          "Install GitHub CLI",
          "github-cli",
          platform,
          tooling,
        ),
      ],
    };
  }

  const auth = await runner.run(command("gh", ["auth", "status", "-h", "github.com"]));
  if (isSuccess(auth)) {
    return {
      id: "github-cli",
      status: "ready",
      label: "GitHub CLI",
      message: "GitHub CLI is installed and authenticated for github.com.",
      actions: [],
    };
  }
  return {
    id: "github-cli",
    status: "needs-auth",
    label: "GitHub CLI",
    message: "Sign in to enable GitHub PR operations, or continue without them.",
    actions: [
      buildSetupAction("auth-github-cli", "Sign in to GitHub", "github-cli", platform, tooling),
    ],
  };
};

const detectRuntimes = async (runner: CommandRunner): Promise<RuntimeRequirement[]> =>
  Promise.all([detectRuntime(runner, "claude", "claude", "Claude Code", true)]);

const detectRuntime = async (
  runner: CommandRunner,
  id: RuntimeId,
  program: string,
  label: string,
  recommended: boolean,
): Promise<RuntimeRequirement> => {
  const output = await runner.run(command(program, ["--version"]));
  return isSuccess(output)
    ? {
        id,
        status: "ready",
        label,
        message: firstLineOr(output.stdout, `${label} is installed.`),
        recommended,
      }
    : { id, status: "missing", label, message: `${label} is not installed.`, recommended };
};

const buildRuntimeRequirement = (
  runtimes: RuntimeRequirement[],
  platform: HostPlatform,
  tooling: InstallerTooling,
): SetupRequirement => {
  if (runtimes.some((runtime) => runtime.status === "ready")) {
    return {
      id: "runtime",
      status: "ready",
      label: "Agent runtime",
      message: "At least one supported coding runtime is installed.",
      actions: [],
    };
  }
  return {
    id: "runtime",
    status: "missing",
    label: "Agent runtime",
    message: "Install and sign in to Claude Code.",
    actions: runtimes.map((runtime) => runtimeInstallAction(runtime.id, platform, tooling)),
  };
};

const buildAutomationActions = (
  runtimes: RuntimeRequirement[],
  platform: HostPlatform,
  tooling: InstallerTooling,
): SetupAction[] => {
  if (!runtimeReady(runtimes, "claude")) return [];

  return [
    buildSetupAction(
      "install-browser-runtime",
      "Install browser automation",
      "runtime",
      platform,
      tooling,
    ),
    buildSetupAction(
      "install-claude-browser-extension",
      "Open Claude browser extension",
      "runtime",
      platform,
      tooling,
      "claude",
    ),
  ];
};

const runtimeInstallAction = (
  runtimeId: RuntimeId,
  platform: HostPlatform,
  tooling: InstallerTooling,
): SetupAction => {
  const actions: Record<RuntimeId, [string, string]> = {
    claude: ["install-runtime-claude", "Install Claude Code"],
  };
  const [id, label] = actions[runtimeId];
  return buildSetupAction(id, label, "runtime", platform, tooling, runtimeId);
};

const buildSetupAction = (
  id: string,
  label: string,
  requirementId: SetupRequirementId,
  platform: HostPlatform,
  tooling: InstallerTooling,
  runtimeId?: RuntimeId,
): SetupAction => {
  const plan = createInstallerRegistry(platform, tooling).plan(id);
  return {
    id,
    label,
    requirementId,
    requiresConsent: !isGuideAction(id),
    runtimeId,
    description: actionDescription(id, platform),
    commandPreview: plan.commandPreview,
    manualInstructions: plan.manualInstructions,
    manual: plan.kind === "manual",
  };
};

const actionDescription = (id: string, platform: HostPlatform): string | undefined => {
  const descriptions: Record<string, string> = {
    "install-git": "Opens the official Git installation guide.",
    "install-github-cli": "Opens the official GitHub CLI page.",
    "auth-github-cli": "Starts GitHub CLI authentication for github.com.",
    "install-runtime-claude": "Opens the official Claude Code quickstart.",
    "install-browser-runtime": `Installs Chromium for AOP's Playwright fallback${platform === "windows" ? " inside WSL" : ""}.`,
    "install-claude-browser-extension": "Opens Anthropic's official Claude extension.",
  };
  return descriptions[id];
};

const command = (program: string, args: string[]): CommandSpec => ({
  program,
  args,
  env: { PATH: guiSafePath() },
});

const isGuideAction = (id: string): boolean =>
  ["install-git", "install-github-cli", "install-runtime-claude"].includes(id);

const runtimeReady = (runtimes: RuntimeRequirement[], id: RuntimeId): boolean =>
  runtimes.some((runtime) => runtime.id === id && runtime.status === "ready");

const isBlockingRequirement = (requirement: SetupRequirement): boolean =>
  requirement.id !== "github-cli" && requirement.status !== "ready";

const isSuccess = (output: CommandOutput): boolean => output.status === 0;

const firstLineOr = (value: string, fallback: string): string =>
  value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean) ?? fallback;

const runCommand = async (commandSpec: CommandSpec): Promise<CommandOutput> => {
  try {
    const { stdout, stderr } = await execFileAsync(commandSpec.program, commandSpec.args, {
      env: { ...process.env, ...commandSpec.env },
      windowsHide: true,
    });
    return { status: 0, stdout, stderr };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      status: typeof failure.code === "number" ? failure.code : 127,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? failure.message,
    };
  }
};
