use std::cell::RefCell;
use std::collections::HashMap;

use aop_desktop_lib::commands::{
    DesktopCommandError, detect_installer_tooling_for, run_setup_action_with_runner,
};
use aop_desktop_lib::installers::InstallerTooling;
use aop_desktop_lib::platform::Platform;
use aop_desktop_lib::setup::{CommandOutput, CommandRunner, CommandSpec};

#[test]
fn detects_homebrew_tooling_on_unix() {
    let runner = RecordingRunner::new().with_success(&["brew", "--version"], "Homebrew 5.0.0");

    let tooling = detect_installer_tooling_for(Platform::Unix, &runner);

    assert_eq!(
        tooling,
        InstallerTooling {
            homebrew: true,
            winget: false
        }
    );
}

#[test]
fn detects_winget_tooling_on_windows() {
    let present = RecordingRunner::new().with_success(&["winget", "--version"], "v1.7");
    assert_eq!(
        detect_installer_tooling_for(Platform::Windows, &present),
        InstallerTooling {
            homebrew: false,
            winget: true
        }
    );

    let absent = RecordingRunner::new();
    assert_eq!(
        detect_installer_tooling_for(Platform::Windows, &absent),
        InstallerTooling {
            homebrew: false,
            winget: false
        }
    );
}

#[test]
fn run_setup_action_rejects_unknown_actions() {
    let runner = ready_runner();

    let error = run_setup_action_with_runner(
        "install-everything",
        &runner,
        InstallerTooling {
            homebrew: true,
            winget: false,
        },
    )
    .expect_err("unknown action");

    assert_eq!(error, DesktopCommandError::UnknownSetupAction);
}

#[test]
fn run_setup_action_executes_known_command_then_rechecks_setup() {
    let runner = ready_runner().with_success(&["open", "https://cli.github.com/"], "opened");

    let state = run_setup_action_with_runner(
        "install-github-cli",
        &runner,
        InstallerTooling {
            homebrew: true,
            winget: false,
        },
    )
    .expect("setup action succeeds");

    assert!(state.ready);
    assert!(runner.was_called(&["open", "https://cli.github.com/"]));
    assert!(runner.was_called(&["gh", "auth", "status", "-h", "github.com"]));
}

#[test]
fn run_setup_action_fails_when_installer_command_fails() {
    let runner = ready_runner().with_failure(&["open", "https://cli.github.com/"], "open failed");

    let error = run_setup_action_with_runner(
        "install-github-cli",
        &runner,
        InstallerTooling {
            homebrew: true,
            winget: false,
        },
    )
    .expect_err("installer command failed");

    assert_eq!(
        error,
        DesktopCommandError::SetupActionFailed("open failed".to_string())
    );
}

struct RecordingRunner {
    outputs: HashMap<Vec<String>, CommandOutput>,
    calls: RefCell<Vec<Vec<String>>>,
}

impl RecordingRunner {
    fn new() -> Self {
        Self {
            outputs: HashMap::new(),
            calls: RefCell::new(Vec::new()),
        }
    }

    fn with_success(mut self, command: &[&str], stdout: &str) -> Self {
        self.outputs.insert(
            command_key(command),
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
            command_key(command),
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
            command_key(command),
            CommandOutput {
                status: 127,
                stdout: String::new(),
                stderr: "command not found".to_string(),
            },
        );
        self
    }

    fn was_called(&self, command: &[&str]) -> bool {
        self.calls.borrow().contains(&command_key(command))
    }
}

impl CommandRunner for RecordingRunner {
    fn run(&self, command: &CommandSpec) -> CommandOutput {
        let key = command_key_from_spec(command);
        self.calls.borrow_mut().push(key.clone());
        self.outputs
            .get(&key)
            .cloned()
            .unwrap_or_else(|| CommandOutput {
                status: 127,
                stdout: String::new(),
                stderr: "command not registered".to_string(),
            })
    }
}

fn ready_runner() -> RecordingRunner {
    RecordingRunner::new()
        .with_success(&["git", "--version"], "git version 2.45.0")
        .with_success(&["gh", "--version"], "gh version 2.49.0")
        .with_success(&["gh", "auth", "status", "-h", "github.com"], "Logged in")
        .with_success(&["codex", "--version"], "codex 1.2.3")
        .with_missing(&["claude", "--version"])
        .with_missing(&["opencode", "--version"])
        .with_missing(&["pi", "--version"])
}

fn command_key(command: &[&str]) -> Vec<String> {
    command.iter().map(|part| part.to_string()).collect()
}

fn command_key_from_spec(command: &CommandSpec) -> Vec<String> {
    let mut key = vec![command.program.clone()];
    key.extend(command.args.clone());
    key
}
