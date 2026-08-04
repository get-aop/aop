use std::collections::HashMap;

use aop_desktop_lib::platform::Platform;
use aop_desktop_lib::setup::{
    CommandOutput, CommandRunner, CommandSpec, RequirementStatus, RuntimeId, collect_setup_state,
    gui_safe_path_for, missing_wsl_setup_state,
};

#[test]
fn missing_wsl_is_a_blocking_setup_requirement() {
    let state = missing_wsl_setup_state();

    assert!(!state.ready);
    assert_eq!(state.blocking_requirements, vec!["wsl"]);
    assert_eq!(state.requirements[0].id, "wsl");
    assert_eq!(state.requirements[0].status, RequirementStatus::Missing);
    assert!(state.requirements[0].message.contains("WSL 2"));
}

#[test]
fn gui_safe_path_unix_is_unchanged() {
    let path = gui_safe_path_for(
        Platform::Unix,
        Some("/home/u"),
        None,
        None,
        Some("/usr/bin:/bin"),
    );

    assert_eq!(
        path,
        "/home/u/.local/bin:/home/u/.opencode/bin:/home/u/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
    );
}

#[test]
fn gui_safe_path_windows_seeds_winget_and_user_bins() {
    let path = gui_safe_path_for(
        Platform::Windows,
        Some("C:\\Users\\m"),
        Some("C:\\Users\\m"),
        Some("C:\\Users\\m\\AppData\\Local"),
        Some("C:\\Windows;C:\\Windows\\System32"),
    );

    assert!(path.contains(';'));
    assert!(path.contains("C:\\Users\\m\\AppData\\Local\\Microsoft\\WinGet\\Links"));
    assert!(path.contains("C:\\Users\\m\\.bun\\bin"));
    assert!(path.contains("C:\\Program Files\\Git\\cmd"));
    assert!(path.contains("C:\\Program Files\\GitHub CLI"));
    assert!(path.ends_with("C:\\Windows;C:\\Windows\\System32"));
    assert!(!path.contains("/opt/homebrew"));
    assert!(!path.contains(':') || path.contains("C:")); // no Unix ':' separators
}

#[test]
fn platform_separators_and_suffixes() {
    assert_eq!(Platform::Unix.path_separator(), ':');
    assert_eq!(Platform::Windows.path_separator(), ';');
    assert_eq!(Platform::Unix.exe_suffix(), "");
    assert_eq!(Platform::Windows.exe_suffix(), ".exe");
}

#[test]
fn setup_state_is_ready_when_git_gh_auth_and_one_runtime_are_ready() {
    let runner = FakeRunner::new()
        .with_missing(&["brew", "--version"])
        .with_success(&["git", "--version"], "git version 2.45.0")
        .with_success(&["gh", "--version"], "gh version 2.49.0")
        .with_success(&["gh", "auth", "status", "-h", "github.com"], "Logged in")
        .with_success(&["codex", "--version"], "codex 1.2.3")
        .with_missing(&["claude", "--version"])
        .with_missing(&["opencode", "--version"])
        .with_missing(&["pi", "--version"]);

    let state = collect_setup_state(&runner);

    assert!(state.ready);
    assert!(state.blocking_requirements.is_empty());
    assert_eq!(state.requirements[0].status, RequirementStatus::Ready);
    assert_eq!(state.requirements[1].status, RequirementStatus::Ready);
    assert_eq!(state.requirements[2].status, RequirementStatus::Ready);
    assert!(
        state
            .automation_actions
            .iter()
            .any(|action| action.id == "install-browser-runtime")
    );
    assert!(
        state
            .automation_actions
            .iter()
            .any(|action| action.id == "install-codex-browser-plugins")
    );
}

#[test]
fn github_cli_auth_is_optional_for_local_desktop_setup() {
    let runner = FakeRunner::new()
        .with_missing(&["brew", "--version"])
        .with_success(&["git", "--version"], "git version 2.45.0")
        .with_success(&["gh", "--version"], "gh version 2.49.0")
        .with_failure(
            &["gh", "auth", "status", "-h", "github.com"],
            "not logged in to github.com",
        )
        .with_success(&["codex", "--version"], "codex 1.2.3")
        .with_missing(&["claude", "--version"])
        .with_missing(&["opencode", "--version"])
        .with_missing(&["pi", "--version"]);

    let state = collect_setup_state(&runner);

    assert!(state.ready);
    assert_eq!(state.requirements[1].status, RequirementStatus::NeedsAuth);
    assert!(state.blocking_requirements.is_empty());
}

#[test]
fn codex_is_recommended_when_no_runtime_is_installed() {
    let runner = FakeRunner::new()
        .with_missing(&["brew", "--version"])
        .with_success(&["git", "--version"], "git version 2.45.0")
        .with_success(&["gh", "--version"], "gh version 2.49.0")
        .with_success(&["gh", "auth", "status", "-h", "github.com"], "Logged in")
        .with_missing(&["codex", "--version"])
        .with_missing(&["claude", "--version"])
        .with_missing(&["opencode", "--version"])
        .with_missing(&["pi", "--version"]);

    let state = collect_setup_state(&runner);

    assert!(!state.ready);
    assert_eq!(state.requirements[2].status, RequirementStatus::Missing);
    assert_eq!(state.blocking_requirements, vec!["runtime"]);
    assert_eq!(state.runtimes[0].id, RuntimeId::Codex);
    assert!(state.runtimes[0].recommended);
    assert_eq!(state.runtimes[3].id, RuntimeId::Pi);
    assert_eq!(state.requirements[2].actions[3].id, "install-runtime-pi");
    assert_eq!(state.requirements[2].actions[0].id, "install-runtime-codex");
    assert_eq!(
        state.requirements[2].actions[0].command_preview.as_deref(),
        Some("open https://learn.chatgpt.com/docs/codex/cli?surface=cli#getting-started")
    );
    assert!(!state.requirements[2].actions[0].requires_consent);
}

struct FakeRunner {
    outputs: HashMap<Vec<String>, CommandOutput>,
}

impl FakeRunner {
    fn new() -> Self {
        Self {
            outputs: HashMap::new(),
        }
    }

    fn with_success(mut self, command: &[&str], stdout: &str) -> Self {
        self.outputs.insert(
            to_command_key(command),
            CommandOutput {
                status: 0,
                stdout: stdout.to_string(),
                stderr: String::new(),
            },
        );
        self
    }

    fn with_failure(mut self, command: &[&str], stderr: &str) -> Self {
        self.outputs.insert(
            to_command_key(command),
            CommandOutput {
                status: 1,
                stdout: String::new(),
                stderr: stderr.to_string(),
            },
        );
        self
    }

    fn with_missing(mut self, command: &[&str]) -> Self {
        self.outputs.insert(
            to_command_key(command),
            CommandOutput {
                status: 127,
                stdout: String::new(),
                stderr: "command not found".to_string(),
            },
        );
        self
    }
}

impl CommandRunner for FakeRunner {
    fn run(&self, command: &CommandSpec) -> CommandOutput {
        self.outputs
            .get(&to_command_key_from_spec(command))
            .cloned()
            .expect("test command output is registered")
    }
}

fn to_command_key(command: &[&str]) -> Vec<String> {
    command.iter().map(|part| part.to_string()).collect()
}

fn to_command_key_from_spec(command: &CommandSpec) -> Vec<String> {
    let mut key = vec![command.program.clone()];
    key.extend(command.args.clone());
    key
}
