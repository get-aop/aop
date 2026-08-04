use crate::platform::Platform;
use crate::setup::CommandSpec;

const CLAUDE_GUIDE_URL: &str =
    "https://code.claude.com/docs/en/quickstart#step-1-install-claude-code";
const CODEX_GUIDE_URL: &str =
    "https://learn.chatgpt.com/docs/codex/cli?surface=cli#getting-started";
const GIT_GUIDE_URL: &str = "https://git-scm.com/install/mac";
const GITHUB_CLI_GUIDE_URL: &str = "https://cli.github.com/";
const OPENCODE_GUIDE_URL: &str = "https://opencode.ai/docs/";
const PI_GUIDE_URL: &str = "https://pi.dev/docs/latest/quickstart";

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InstallerRegistry {
    platform: Platform,
    tooling: InstallerTooling,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InstallerTooling {
    pub homebrew: bool,
    pub winget: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SetupActionPlan {
    pub id: String,
    pub title: String,
    pub kind: SetupActionKind,
    pub command: Option<CommandSpec>,
    pub command_preview: String,
    pub manual_instructions: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SetupActionKind {
    Command,
    Manual,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SetupActionError {
    UnknownAction,
}

pub fn setup_guide_url(action_id: &str) -> Result<&'static str, SetupActionError> {
    match action_id {
        "install-git" => Ok(GIT_GUIDE_URL),
        "install-github-cli" => Ok(GITHUB_CLI_GUIDE_URL),
        "install-runtime-codex" => Ok(CODEX_GUIDE_URL),
        "install-runtime-claude" => Ok(CLAUDE_GUIDE_URL),
        "install-runtime-opencode" => Ok(OPENCODE_GUIDE_URL),
        "install-runtime-pi" => Ok(PI_GUIDE_URL),
        _ => Err(SetupActionError::UnknownAction),
    }
}

impl InstallerRegistry {
    pub fn new(platform: Platform, tooling: InstallerTooling) -> Self {
        Self { platform, tooling }
    }

    pub fn plan(&self, action_id: &str) -> Result<SetupActionPlan, SetupActionError> {
        match self.platform {
            Platform::Unix => self.plan_unix(action_id),
            Platform::Windows => self.plan_windows(action_id),
        }
    }

    fn plan_unix(&self, action_id: &str) -> Result<SetupActionPlan, SetupActionError> {
        let plan = match action_id {
            "install-git" => self.guide_plan(action_id, "Install Git", GIT_GUIDE_URL),
            "install-github-cli" => {
                self.guide_plan(action_id, "Install GitHub CLI", GITHUB_CLI_GUIDE_URL)
            }
            "auth-github-cli" => manual_plan(
                action_id,
                "Sign in to GitHub",
                "Run `gh auth login -h github.com -w` in Terminal, complete the browser flow, then return to AOP and check again.",
            ),
            "install-runtime-codex" => self.guide_plan(action_id, "Install Codex", CODEX_GUIDE_URL),
            "install-runtime-claude" => {
                self.guide_plan(action_id, "Install Claude Code", CLAUDE_GUIDE_URL)
            }
            "install-runtime-opencode" => {
                self.guide_plan(action_id, "Install OpenCode", OPENCODE_GUIDE_URL)
            }
            "install-runtime-pi" => self.guide_plan(action_id, "Install Pi", PI_GUIDE_URL),
            "install-browser-runtime" => command_plan(
                action_id,
                "Install browser automation",
                shell_command("bunx -y playwright@1.61.1 install chromium"),
                "Installs the pinned Chromium runtime used by AOP browser automation.",
            ),
            "install-codex-browser-plugins" => command_plan(
                action_id,
                "Install Codex browser extensions",
                shell_command(
                    "codex plugin add browser@openai-bundled && codex plugin add chrome@openai-bundled",
                ),
                "Installs Codex's Browser and signed-in Chrome plugins.",
            ),
            "install-codex-computer-plugin" => command_plan(
                action_id,
                "Install Codex computer control",
                command("codex", &["plugin", "add", "computer-use@openai-bundled"]),
                "Installs Codex's macOS Computer Use plugin.",
            ),
            "install-claude-browser-extension" => command_plan(
                action_id,
                "Open Claude browser extension",
                command(
                    "open",
                    &[
                        "https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn",
                    ],
                ),
                "Opens Anthropic's official extension in the Chrome Web Store.",
            ),
            _ => return Err(SetupActionError::UnknownAction),
        };

        Ok(plan)
    }

    fn plan_windows(&self, action_id: &str) -> Result<SetupActionPlan, SetupActionError> {
        let plan = match action_id {
            "install-git" => self.guide_plan(action_id, "Install Git", GIT_GUIDE_URL),
            "install-github-cli" => {
                self.guide_plan(action_id, "Install GitHub CLI", GITHUB_CLI_GUIDE_URL)
            }
            "auth-github-cli" => manual_plan(
                action_id,
                "Sign in to GitHub",
                "Run `gh auth login -h github.com -w` in a terminal, complete the browser flow, then return to AOP and check again.",
            ),
            "install-runtime-codex" => self.guide_plan(action_id, "Install Codex", CODEX_GUIDE_URL),
            "install-runtime-claude" => {
                self.guide_plan(action_id, "Install Claude Code", CLAUDE_GUIDE_URL)
            }
            "install-runtime-opencode" => {
                self.guide_plan(action_id, "Install OpenCode", OPENCODE_GUIDE_URL)
            }
            "install-runtime-pi" => self.guide_plan(action_id, "Install Pi", PI_GUIDE_URL),
            "install-browser-runtime" => manual_plan(
                action_id,
                "Install browser automation in WSL",
                "Open the selected WSL distro and run `bunx -y playwright@1.61.1 install chromium`.",
            ),
            "install-codex-browser-plugins" => manual_plan(
                action_id,
                "Install Codex browser plugin in WSL",
                "Open the selected WSL distro and run `codex plugin add browser@openai-bundled`. Host Chrome forwarding is unavailable through WSL.",
            ),
            "install-codex-computer-plugin" => manual_plan(
                action_id,
                "Codex computer control unavailable",
                "Codex CLI computer control is macOS-only. AOP cannot forward Windows desktop control through WSL.",
            ),
            "install-claude-browser-extension" => command_plan(
                action_id,
                "Open Claude browser extension",
                command(
                    "cmd",
                    &[
                        "/C",
                        "start",
                        "",
                        "https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn",
                    ],
                ),
                "Opens Anthropic's official extension. Claude Code integration requires native Windows and is unavailable through WSL.",
            ),
            _ => return Err(SetupActionError::UnknownAction),
        };

        Ok(plan)
    }

    fn guide_plan(&self, action_id: &str, title: &str, url: &str) -> SetupActionPlan {
        let command = match self.platform {
            Platform::Unix => command("open", &[url]),
            Platform::Windows => command("cmd", &["/C", "start", "", url]),
        };
        command_plan(
            action_id,
            title,
            command,
            "Follow the official installation guide, then return to AOP and check again.",
        )
    }
}

fn command_plan(
    id: &str,
    title: &str,
    command: CommandSpec,
    manual_instructions: &str,
) -> SetupActionPlan {
    SetupActionPlan {
        id: id.to_string(),
        title: title.to_string(),
        kind: SetupActionKind::Command,
        command_preview: command.preview(),
        command: Some(command),
        manual_instructions: manual_instructions.to_string(),
    }
}

fn manual_plan(id: &str, title: &str, manual_instructions: &str) -> SetupActionPlan {
    SetupActionPlan {
        id: id.to_string(),
        title: title.to_string(),
        kind: SetupActionKind::Manual,
        command: None,
        command_preview: manual_instructions.to_string(),
        manual_instructions: manual_instructions.to_string(),
    }
}

fn shell_command(script: &str) -> CommandSpec {
    command("sh", &["-lc", script])
}

fn command(program: &str, args: &[&str]) -> CommandSpec {
    CommandSpec::new(program, args).with_gui_safe_path()
}

impl CommandSpec {
    fn preview(&self) -> String {
        std::iter::once(self.program.as_str())
            .chain(self.args.iter().map(String::as_str))
            .collect::<Vec<_>>()
            .join(" ")
    }
}
