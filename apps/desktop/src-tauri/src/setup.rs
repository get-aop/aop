use serde::Serialize;
use std::env;
use std::process::Command;

use crate::installers::{InstallerRegistry, InstallerTooling, SetupActionKind};
use crate::platform::Platform;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopSetupState {
    pub ready: bool,
    pub requirements: Vec<SetupRequirement>,
    pub runtimes: Vec<RuntimeRequirement>,
    pub blocking_requirements: Vec<String>,
    pub automation_actions: Vec<SetupAction>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupRequirement {
    pub id: String,
    pub status: RequirementStatus,
    pub label: String,
    pub message: String,
    pub actions: Vec<SetupAction>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRequirement {
    pub id: RuntimeId,
    pub status: RequirementStatus,
    pub label: String,
    pub message: String,
    pub recommended: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupAction {
    pub id: String,
    pub label: String,
    pub requirement_id: String,
    pub requires_consent: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_id: Option<RuntimeId>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command_preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manual_instructions: Option<String>,
    /// True when AOP cannot run this action itself (e.g. a browser auth flow, or an install
    /// requiring a tool the host lacks). The frontend shows instructions + a re-check instead
    /// of pretending to run it.
    pub manual: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum RequirementStatus {
    Ready,
    Missing,
    NeedsAuth,
    Installing,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
pub enum RuntimeId {
    #[serde(rename = "codex")]
    Codex,
    #[serde(rename = "claude")]
    Claude,
    #[serde(rename = "opencode")]
    OpenCode,
    #[serde(rename = "pi")]
    Pi,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommandSpec {
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommandOutput {
    pub status: i32,
    pub stdout: String,
    pub stderr: String,
}

pub trait CommandRunner {
    fn run(&self, command: &CommandSpec) -> CommandOutput;
}

pub struct SystemCommandRunner;

impl CommandRunner for SystemCommandRunner {
    fn run(&self, command: &CommandSpec) -> CommandOutput {
        let mut sys = Command::new(&command.program);
        sys.args(&command.args)
            .envs(command.env.iter().map(|(key, value)| (key, value)));
        crate::platform::hide_console_window(&mut sys);
        match sys.output() {
            Ok(output) => CommandOutput {
                status: output.status.code().unwrap_or(1),
                stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            },
            Err(error) => CommandOutput {
                status: 127,
                stdout: String::new(),
                stderr: error.to_string(),
            },
        }
    }
}

pub fn missing_wsl_setup_state() -> DesktopSetupState {
    DesktopSetupState {
        ready: false,
        requirements: vec![SetupRequirement {
            id: "wsl".to_string(),
            status: RequirementStatus::Missing,
            label: "WSL 2".to_string(),
            message: "Install WSL 2 and a Linux distro with `wsl --install`, restart Windows, then check again."
                .to_string(),
            actions: Vec::new(),
        }],
        runtimes: Vec::new(),
        blocking_requirements: vec!["wsl".to_string()],
        automation_actions: Vec::new(),
    }
}

pub fn collect_setup_state(runner: &impl CommandRunner) -> DesktopSetupState {
    let tooling = crate::commands::detect_installer_tooling_for(Platform::current(), runner);
    let git = detect_git(runner, tooling);
    let github_cli = detect_github_cli(runner, tooling);
    let runtimes = detect_runtimes(runner);
    let runtime_requirement = build_runtime_requirement(&runtimes, tooling);
    let automation_actions = build_automation_actions(&runtimes, tooling);
    let requirements = vec![git, github_cli, runtime_requirement];
    let blocking_requirements = requirements
        .iter()
        .filter(|requirement| requirement_is_blocking(requirement))
        .map(|requirement| requirement.id.clone())
        .collect::<Vec<_>>();

    DesktopSetupState {
        ready: blocking_requirements.is_empty(),
        requirements,
        runtimes,
        blocking_requirements,
        automation_actions,
    }
}

fn requirement_is_blocking(requirement: &SetupRequirement) -> bool {
    requirement.id != "github-cli" && requirement.status != RequirementStatus::Ready
}

fn build_automation_actions(
    runtimes: &[RuntimeRequirement],
    tooling: InstallerTooling,
) -> Vec<SetupAction> {
    let has_codex = runtime_ready(runtimes, RuntimeId::Codex);
    let has_claude = runtime_ready(runtimes, RuntimeId::Claude);
    if !has_codex && !has_claude {
        return Vec::new();
    }

    let mut actions = vec![setup_action(
        "install-browser-runtime",
        "Install browser automation",
        "runtime",
        None,
        tooling,
    )];
    if has_codex {
        actions.push(setup_action(
            "install-codex-browser-plugins",
            "Install Codex browser extensions",
            "runtime",
            Some(RuntimeId::Codex),
            tooling,
        ));
        if Platform::current() == Platform::Unix {
            actions.push(setup_action(
                "install-codex-computer-plugin",
                "Install Codex computer control",
                "runtime",
                Some(RuntimeId::Codex),
                tooling,
            ));
        }
    }
    if has_claude {
        actions.push(setup_action(
            "install-claude-browser-extension",
            "Open Claude browser extension",
            "runtime",
            Some(RuntimeId::Claude),
            tooling,
        ));
    }
    actions
}

fn runtime_ready(runtimes: &[RuntimeRequirement], id: RuntimeId) -> bool {
    runtimes
        .iter()
        .any(|runtime| runtime.id == id && runtime.status == RequirementStatus::Ready)
}

pub fn collect_system_setup_state() -> DesktopSetupState {
    collect_setup_state(&SystemCommandRunner)
}

fn detect_git(runner: &impl CommandRunner, tooling: InstallerTooling) -> SetupRequirement {
    let output = runner.run(&command("git", &["--version"]));

    if output.is_success() {
        return SetupRequirement {
            id: "git".to_string(),
            status: RequirementStatus::Ready,
            label: "Git".to_string(),
            message: first_line_or(&output.stdout, "Git is installed."),
            actions: Vec::new(),
        };
    }

    SetupRequirement {
        id: "git".to_string(),
        status: RequirementStatus::Missing,
        label: "Git".to_string(),
        message: "Git is required for repository operations.".to_string(),
        actions: vec![setup_action(
            "install-git",
            "Install Git",
            "git",
            None,
            tooling,
        )],
    }
}

fn detect_github_cli(runner: &impl CommandRunner, tooling: InstallerTooling) -> SetupRequirement {
    let version = runner.run(&command("gh", &["--version"]));
    if !version.is_success() {
        return SetupRequirement {
            id: "github-cli".to_string(),
            status: RequirementStatus::Missing,
            label: "GitHub CLI".to_string(),
            message: "GitHub CLI is optional and enables GitHub authentication and PR operations."
                .to_string(),
            actions: vec![setup_action(
                "install-github-cli",
                "Install GitHub CLI",
                "github-cli",
                None,
                tooling,
            )],
        };
    }

    let auth = runner.run(&command("gh", &["auth", "status", "-h", "github.com"]));
    if auth.is_success() {
        return SetupRequirement {
            id: "github-cli".to_string(),
            status: RequirementStatus::Ready,
            label: "GitHub CLI".to_string(),
            message: "GitHub CLI is installed and authenticated for github.com.".to_string(),
            actions: Vec::new(),
        };
    }

    SetupRequirement {
        id: "github-cli".to_string(),
        status: RequirementStatus::NeedsAuth,
        label: "GitHub CLI".to_string(),
        message: "Sign in to enable GitHub PR operations, or continue without them.".to_string(),
        actions: vec![setup_action(
            "auth-github-cli",
            "Sign in to GitHub",
            "github-cli",
            None,
            tooling,
        )],
    }
}

fn detect_runtimes(runner: &impl CommandRunner) -> Vec<RuntimeRequirement> {
    vec![
        detect_runtime(runner, RuntimeId::Codex, "codex", "Codex", true),
        detect_runtime(runner, RuntimeId::Claude, "claude", "Claude Code", false),
        detect_runtime(runner, RuntimeId::OpenCode, "opencode", "OpenCode", false),
        detect_runtime(runner, RuntimeId::Pi, "pi", "Pi", false),
    ]
}

fn detect_runtime(
    runner: &impl CommandRunner,
    id: RuntimeId,
    program: &str,
    label: &str,
    recommended: bool,
) -> RuntimeRequirement {
    let output = runner.run(&command(program, &["--version"]));

    if output.is_success() {
        return RuntimeRequirement {
            id,
            status: RequirementStatus::Ready,
            label: label.to_string(),
            message: first_line_or(&output.stdout, &format!("{label} is installed.")),
            recommended,
        };
    }

    RuntimeRequirement {
        id,
        status: RequirementStatus::Missing,
        label: label.to_string(),
        message: format!("{label} is not installed."),
        recommended,
    }
}

fn build_runtime_requirement(
    runtimes: &[RuntimeRequirement],
    tooling: InstallerTooling,
) -> SetupRequirement {
    if runtimes
        .iter()
        .any(|runtime| runtime.status == RequirementStatus::Ready)
    {
        return SetupRequirement {
            id: "runtime".to_string(),
            status: RequirementStatus::Ready,
            label: "Agent runtime".to_string(),
            message: "At least one supported coding runtime is installed.".to_string(),
            actions: Vec::new(),
        };
    }

    SetupRequirement {
        id: "runtime".to_string(),
        status: RequirementStatus::Missing,
        label: "Agent runtime".to_string(),
        message: "Install and sign in to Codex, Claude Code, OpenCode, or Pi.".to_string(),
        actions: runtimes
            .iter()
            .map(|runtime| runtime_install_action(runtime.id, tooling))
            .collect(),
    }
}

fn runtime_install_action(runtime_id: RuntimeId, tooling: InstallerTooling) -> SetupAction {
    let (id, label) = match runtime_id {
        RuntimeId::Codex => ("install-runtime-codex", "Install Codex"),
        RuntimeId::Claude => ("install-runtime-claude", "Install Claude Code"),
        RuntimeId::OpenCode => ("install-runtime-opencode", "Install OpenCode"),
        RuntimeId::Pi => ("install-runtime-pi", "Install Pi"),
    };

    setup_action(id, label, "runtime", Some(runtime_id), tooling)
}

fn setup_action(
    id: &str,
    label: &str,
    requirement_id: &str,
    runtime_id: Option<RuntimeId>,
    tooling: InstallerTooling,
) -> SetupAction {
    let details = setup_action_details(id);

    SetupAction {
        id: id.to_string(),
        label: label.to_string(),
        requirement_id: requirement_id.to_string(),
        requires_consent: !action_opens_install_guide(id),
        runtime_id,
        description: details.description.map(str::to_string),
        command_preview: details.command_preview.map(str::to_string),
        manual_instructions: details.manual_instructions.map(str::to_string),
        manual: action_is_manual(id, tooling),
    }
}

fn action_opens_install_guide(id: &str) -> bool {
    matches!(
        id,
        "install-git"
            | "install-github-cli"
            | "install-runtime-codex"
            | "install-runtime-claude"
            | "install-runtime-opencode"
            | "install-runtime-pi"
    )
}

/// Whether the installer registry would actually execute this action itself. Unknown ids and
/// anything the host can't run (browser auth flows, missing Homebrew/winget, WSL-only agent
/// installs) resolve to manual so the UI shows steps instead of faking a run.
fn action_is_manual(id: &str, tooling: InstallerTooling) -> bool {
    match InstallerRegistry::new(Platform::current(), tooling).plan(id) {
        Ok(plan) => plan.kind == SetupActionKind::Manual,
        Err(_) => true,
    }
}

struct SetupActionDetails {
    description: Option<&'static str>,
    command_preview: Option<&'static str>,
    manual_instructions: Option<&'static str>,
}

fn setup_action_details(id: &str) -> SetupActionDetails {
    if Platform::current() == Platform::Windows {
        return windows_setup_action_details(id);
    }
    match id {
        "install-git" => SetupActionDetails {
            description: Some("Opens the official Git installation guide."),
            command_preview: Some("open https://git-scm.com/install/mac"),
            manual_instructions: Some(
                "Follow the official installation guide, then return to AOP and check again.",
            ),
        },
        "install-github-cli" => SetupActionDetails {
            description: Some("Opens the official GitHub CLI page."),
            command_preview: Some("open https://cli.github.com/"),
            manual_instructions: Some(
                "Follow the official installation guide, then return to AOP and check again.",
            ),
        },
        "auth-github-cli" => SetupActionDetails {
            description: Some("Starts GitHub CLI authentication for github.com."),
            command_preview: Some("gh auth login -h github.com -w"),
            manual_instructions: Some(
                "Complete the browser sign-in, then return to AOP and check setup again.",
            ),
        },
        "install-runtime-codex" => SetupActionDetails {
            description: Some("Opens the official Codex CLI getting-started guide."),
            command_preview: Some(
                "open https://learn.chatgpt.com/docs/codex/cli?surface=cli#getting-started",
            ),
            manual_instructions: Some("After install, sign in through Codex if prompted."),
        },
        "install-runtime-claude" => SetupActionDetails {
            description: Some("Opens the official Claude Code quickstart."),
            command_preview: Some(
                "open https://code.claude.com/docs/en/quickstart#step-1-install-claude-code",
            ),
            manual_instructions: Some("After install, run Claude Code once to complete sign-in."),
        },
        "install-runtime-opencode" => SetupActionDetails {
            description: Some("Opens the official OpenCode documentation."),
            command_preview: Some("open https://opencode.ai/docs/"),
            manual_instructions: Some("After install, run OpenCode once to configure a provider."),
        },
        "install-runtime-pi" => SetupActionDetails {
            description: Some("Opens the official Pi quickstart."),
            command_preview: Some("open https://pi.dev/docs/latest/quickstart"),
            manual_instructions: Some("After install, run Pi once to complete setup."),
        },
        "install-browser-runtime" => SetupActionDetails {
            description: Some(
                "Installs the pinned Chromium runtime used by AOP's isolated Playwright fallback.",
            ),
            command_preview: Some("bunx -y playwright@1.61.1 install chromium"),
            manual_instructions: Some("Install Chromium, then return to AOP."),
        },
        "install-codex-browser-plugins" => SetupActionDetails {
            description: Some(
                "Installs Codex's bundled in-app Browser and signed-in Chrome plugins.",
            ),
            command_preview: Some(
                "codex plugin add browser@openai-bundled && codex plugin add chrome@openai-bundled",
            ),
            manual_instructions: Some(
                "Complete any Chrome extension connection prompt, then restart Chrome.",
            ),
        },
        "install-codex-computer-plugin" => SetupActionDetails {
            description: Some("Installs Codex's bundled macOS Computer Use plugin."),
            command_preview: Some("codex plugin add computer-use@openai-bundled"),
            manual_instructions: Some(
                "Grant Accessibility and Screen Recording access when macOS prompts.",
            ),
        },
        "install-claude-browser-extension" => SetupActionDetails {
            description: Some(
                "Opens Anthropic's official Claude extension in the Chrome Web Store.",
            ),
            command_preview: Some(
                "open https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn",
            ),
            manual_instructions: Some(
                "Add the extension to Chrome or Edge, sign in, then restart the browser.",
            ),
        },
        _ => SetupActionDetails {
            description: None,
            command_preview: None,
            manual_instructions: None,
        },
    }
}

fn windows_setup_action_details(id: &str) -> SetupActionDetails {
    match id {
        "install-git" => SetupActionDetails {
            description: Some("Opens the official Git installation guide."),
            command_preview: Some("cmd /C start https://git-scm.com/install/mac"),
            manual_instructions: Some(
                "Follow the official installation guide, then return to AOP and check again.",
            ),
        },
        "install-github-cli" => SetupActionDetails {
            description: Some("Opens the official GitHub CLI page."),
            command_preview: Some("cmd /C start https://cli.github.com/"),
            manual_instructions: Some(
                "Follow the official installation guide, then return to AOP and check again.",
            ),
        },
        "auth-github-cli" => SetupActionDetails {
            description: Some("Starts GitHub CLI authentication for github.com."),
            command_preview: Some("gh auth login -h github.com -w"),
            manual_instructions: Some(
                "Complete the browser sign-in, then return to AOP and check setup again.",
            ),
        },
        "install-runtime-codex" => guide_details(
            "Opens the official Codex CLI getting-started guide.",
            "https://learn.chatgpt.com/docs/codex/cli?surface=cli#getting-started",
        ),
        "install-runtime-claude" => guide_details(
            "Opens the official Claude Code quickstart.",
            "https://code.claude.com/docs/en/quickstart#step-1-install-claude-code",
        ),
        "install-runtime-opencode" => guide_details(
            "Opens the official OpenCode documentation.",
            "https://opencode.ai/docs/",
        ),
        "install-runtime-pi" => guide_details(
            "Opens the official Pi quickstart.",
            "https://pi.dev/docs/latest/quickstart",
        ),
        "install-browser-runtime" => SetupActionDetails {
            description: Some("Installs Chromium for AOP's Playwright fallback inside WSL."),
            command_preview: None,
            manual_instructions: Some(
                "Open the selected WSL distro and run `bunx -y playwright@1.61.1 install chromium`.",
            ),
        },
        "install-codex-browser-plugins" => SetupActionDetails {
            description: Some(
                "Installs Codex browser plugins inside WSL; signed-in host Chrome forwarding is unavailable from WSL.",
            ),
            command_preview: None,
            manual_instructions: Some(
                "Open the selected WSL distro and run `codex plugin add browser@openai-bundled`. AOP uses Playwright for Windows browser automation.",
            ),
        },
        "install-claude-browser-extension" => SetupActionDetails {
            description: Some(
                "Opens Anthropic's official Chrome extension. Claude Code integration requires native Windows and does not connect through WSL.",
            ),
            command_preview: Some(
                "cmd /C start https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn",
            ),
            manual_instructions: Some(
                "Install and sign in to the extension. AOP's WSL runtime continues to use Playwright.",
            ),
        },
        _ => SetupActionDetails {
            description: None,
            command_preview: None,
            manual_instructions: None,
        },
    }
}

fn guide_details(description: &'static str, url: &'static str) -> SetupActionDetails {
    SetupActionDetails {
        description: Some(description),
        command_preview: Some(url),
        manual_instructions: Some(
            "Follow the installation guide inside WSL, then return to AOP and check again.",
        ),
    }
}

fn command(program: &str, args: &[&str]) -> CommandSpec {
    CommandSpec::new(program, args).with_gui_safe_path()
}

fn first_line_or(value: &str, fallback: &str) -> String {
    value
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(|line| line.trim().to_string())
        .unwrap_or_else(|| fallback.to_string())
}

impl CommandOutput {
    pub fn is_success(&self) -> bool {
        self.status == 0
    }

    pub fn failure_message(&self) -> String {
        let stderr = self.stderr.trim();
        if !stderr.is_empty() {
            return stderr.to_string();
        }

        let stdout = self.stdout.trim();
        if !stdout.is_empty() {
            return stdout.to_string();
        }

        format!("Command exited with status {}.", self.status)
    }
}

impl CommandSpec {
    pub fn new(program: &str, args: &[&str]) -> Self {
        Self {
            program: program.to_string(),
            args: args.iter().map(|arg| arg.to_string()).collect(),
            env: Vec::new(),
        }
    }

    pub fn with_gui_safe_path(mut self) -> Self {
        self.env.push(("PATH".to_string(), gui_safe_path()));
        self
    }
}

pub(crate) fn gui_safe_path() -> String {
    let home = env::var_os("HOME").and_then(|value| value.into_string().ok());
    let userprofile = env::var_os("USERPROFILE").and_then(|value| value.into_string().ok());
    let localappdata = env::var_os("LOCALAPPDATA").and_then(|value| value.into_string().ok());
    let current_path = env::var_os("PATH").and_then(|value| value.into_string().ok());

    gui_safe_path_for(
        Platform::current(),
        home.as_deref(),
        userprofile.as_deref(),
        localappdata.as_deref(),
        current_path.as_deref(),
    )
}

/// Build a GUI-safe PATH for the given platform. The Unix arm reproduces the historical
/// behavior byte-for-byte; the Windows arm seeds WinGet shims, per-user agent bins, and the
/// default Git/GitHub CLI install dirs. Pure (no env reads) so both arms are unit-testable.
pub fn gui_safe_path_for(
    platform: Platform,
    home: Option<&str>,
    userprofile: Option<&str>,
    localappdata: Option<&str>,
    current_path: Option<&str>,
) -> String {
    let separator = platform.path_separator();
    let mut paths = Vec::new();

    match platform {
        Platform::Unix => {
            if let Some(home) = home {
                paths.push(format!("{home}/.local/bin"));
                paths.push(format!("{home}/.opencode/bin"));
                paths.push(format!("{home}/.bun/bin"));
            }
            paths.extend(
                [
                    "/opt/homebrew/bin",
                    "/usr/local/bin",
                    "/usr/bin",
                    "/bin",
                    "/usr/sbin",
                    "/sbin",
                ]
                .iter()
                .map(|path| path.to_string()),
            );
        }
        Platform::Windows => {
            if let Some(localappdata) = localappdata {
                paths.push(format!("{localappdata}\\Microsoft\\WinGet\\Links"));
            }
            if let Some(userprofile) = userprofile {
                paths.push(format!("{userprofile}\\.local\\bin"));
                paths.push(format!("{userprofile}\\.bun\\bin"));
                paths.push(format!("{userprofile}\\.opencode\\bin"));
            }
            paths.push("C:\\Program Files\\Git\\cmd".to_string());
            paths.push("C:\\Program Files\\GitHub CLI".to_string());
        }
    }

    if let Some(current_path) = current_path {
        paths.extend(current_path.split(separator).map(str::to_string));
    }

    dedupe_paths(paths).join(&separator.to_string())
}

fn dedupe_paths(paths: Vec<String>) -> Vec<String> {
    let mut deduped = Vec::new();
    for path in paths {
        if path.is_empty() || deduped.contains(&path) {
            continue;
        }
        deduped.push(path);
    }
    deduped
}

#[cfg(test)]
mod tests {
    use super::*;

    struct PathAwareRunner;

    impl CommandRunner for PathAwareRunner {
        fn run(&self, command: &CommandSpec) -> CommandOutput {
            let path = command
                .env
                .iter()
                .find_map(|(key, value)| (key == "PATH").then_some(value.as_str()))
                .unwrap_or_default();

            let success = match command.program.as_str() {
                "git" => true,
                "gh" => path.contains("/opt/homebrew/bin"),
                "codex" => path.contains("/opt/homebrew/bin"),
                "claude" => path.contains("/.local/bin"),
                "opencode" => path.contains("/.opencode/bin"),
                _ => false,
            };

            if success {
                return CommandOutput {
                    status: 0,
                    stdout: format!("{} version test\n", command.program),
                    stderr: String::new(),
                };
            }

            CommandOutput {
                status: 127,
                stdout: String::new(),
                stderr: "command not found".to_string(),
            }
        }
    }

    #[test]
    fn setup_detection_uses_gui_safe_path_for_homebrew_and_user_local_tools() {
        let state = collect_setup_state(&PathAwareRunner);

        assert!(state.ready);
        assert_eq!(
            state
                .requirements
                .iter()
                .find(|requirement| requirement.id == "github-cli")
                .map(|requirement| requirement.status),
            Some(RequirementStatus::Ready)
        );
        assert!(
            state
                .runtimes
                .iter()
                .any(|runtime| runtime.id == RuntimeId::Codex
                    && runtime.status == RequirementStatus::Ready)
        );
    }
}
