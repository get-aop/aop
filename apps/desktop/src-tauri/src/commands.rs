use crate::installers::{InstallerRegistry, InstallerTooling, SetupActionError, SetupActionKind};
use crate::platform::Platform;
use crate::setup::{
    CommandRunner, CommandSpec, DesktopSetupState, SystemCommandRunner, collect_setup_state,
    missing_wsl_setup_state,
};
use crate::wsl;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DesktopCommandError {
    UnknownSetupAction,
    SetupActionFailed(String),
}

pub fn get_setup_state_with_runner(runner: &impl CommandRunner) -> DesktopSetupState {
    collect_setup_state(runner)
}

pub fn get_system_setup_state() -> DesktopSetupState {
    if Platform::current() == Platform::Windows {
        let current = wsl::load_exec_host();
        let distros = wsl::list_wsl_distros().unwrap_or_default();
        let Some(mode) = wsl::resolve_windows_exec_host(&current, &distros) else {
            return missing_wsl_setup_state();
        };
        if mode != current {
            let _ = wsl::save_exec_host(&mode);
        }
        let wsl::ExecHostMode::Wsl(distro) = mode else {
            return missing_wsl_setup_state();
        };
        return get_setup_state_with_runner(&wsl::WslCommandRunner { distro });
    }

    get_setup_state_with_runner(&SystemCommandRunner)
}

pub fn detect_installer_tooling(runner: &impl CommandRunner) -> InstallerTooling {
    detect_installer_tooling_for(Platform::current(), runner)
}

pub fn detect_installer_tooling_for(
    platform: Platform,
    runner: &impl CommandRunner,
) -> InstallerTooling {
    match platform {
        Platform::Unix => InstallerTooling {
            homebrew: runner.run(&command("brew", &["--version"])).is_success(),
            winget: false,
        },
        Platform::Windows => InstallerTooling {
            homebrew: false,
            winget: runner.run(&command("winget", &["--version"])).is_success(),
        },
    }
}

pub fn run_setup_action_with_runner(
    action_id: &str,
    runner: &impl CommandRunner,
    tooling: InstallerTooling,
) -> Result<DesktopSetupState, DesktopCommandError> {
    let registry = InstallerRegistry::new(Platform::current(), tooling);
    let plan = registry.plan(action_id).map_err(map_setup_action_error)?;

    if plan.kind == SetupActionKind::Command {
        if let Some(command) = plan.command {
            let output = runner.run(&command);
            if !output.is_success() {
                return Err(DesktopCommandError::SetupActionFailed(
                    output.failure_message(),
                ));
            }
        }
    }

    Ok(collect_setup_state(runner))
}

pub fn run_system_setup_action(action_id: &str) -> Result<DesktopSetupState, DesktopCommandError> {
    if Platform::current() == Platform::Windows {
        let wsl::ExecHostMode::Wsl(distro) = wsl::load_exec_host() else {
            return Err(DesktopCommandError::SetupActionFailed(
                "A WSL 2 distro must be selected before running setup actions.".to_string(),
            ));
        };
        let runner = wsl::WslCommandRunner { distro };
        let tooling = detect_installer_tooling(&runner);
        return run_setup_action_with_runner(action_id, &runner, tooling);
    }

    let runner = SystemCommandRunner;
    let tooling = detect_installer_tooling(&runner);
    run_setup_action_with_runner(action_id, &runner, tooling)
}

fn map_setup_action_error(error: SetupActionError) -> DesktopCommandError {
    match error {
        SetupActionError::UnknownAction => DesktopCommandError::UnknownSetupAction,
    }
}

fn command(program: &str, args: &[&str]) -> CommandSpec {
    CommandSpec::new(program, args).with_gui_safe_path()
}
