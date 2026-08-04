pub mod commands;
pub mod installers;
pub mod platform;
pub mod setup;
pub mod sidecar;
pub mod wsl;

use std::fs::create_dir_all;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread::sleep;
use std::time::Duration;

use platform::Platform;
use sidecar::{
    HttpSidecarHealth, SidecarHealth, SidecarLaunchConfig, SidecarPaths, SidecarPorts,
    SidecarState, build_sidecar_launch_config,
};
use tauri::Manager;

const SIDECAR_HEALTH_ATTEMPTS: usize = 80;
const SIDECAR_HEALTH_DELAY: Duration = Duration::from_millis(250);

struct SidecarHandle {
    child: Child,
    mode: sidecar::LaunchMode,
}

pub struct DesktopRuntimeState {
    sidecar: Mutex<Option<SidecarHandle>>,
    last_sidecar_state: Mutex<SidecarState>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DesktopRuntimeState::default())
        .invoke_handler(tauri::generate_handler![
            get_setup_state,
            run_setup_action,
            open_setup_guide,
            start_aop_sidecar,
            get_sidecar_state,
            open_logs_folder,
            quit_desktop_app,
            list_wsl_distros,
            get_exec_host,
            set_exec_host
        ])
        .build(tauri::generate_context!())
        .expect("failed to build AOP desktop app")
        .run(|app_handle, event| {
            // Stop the sidecar (and, under WSL, the in-distro server) before the app exits so
            // we never orphan it.
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                stop_sidecar(&app_handle.state::<DesktopRuntimeState>());
            }
        });
}

#[tauri::command]
fn get_setup_state() -> setup::DesktopSetupState {
    commands::get_system_setup_state()
}

#[tauri::command]
fn run_setup_action(action_id: String) -> Result<setup::DesktopSetupState, String> {
    commands::run_system_setup_action(&action_id).map_err(command_error_message)
}

#[tauri::command]
fn open_setup_guide(action_id: String) -> Result<(), String> {
    let url = installers::setup_guide_url(&action_id)
        .map_err(|_| format!("Unknown setup guide: {action_id}"))?;
    let command = browser_command(Platform::current(), url);
    let mut process = Command::new(&command.program);
    process.args(&command.args);
    platform::hide_console_window(&mut process);
    process.spawn().map_err(|error| error.to_string())?;

    Ok(())
}

pub fn browser_command(platform: Platform, url: &str) -> setup::CommandSpec {
    match platform {
        Platform::Unix => setup::CommandSpec::new("open", &[url]),
        Platform::Windows => {
            setup::CommandSpec::new("rundll32.exe", &["url.dll,FileProtocolHandler", url])
        }
    }
}

#[tauri::command]
fn start_aop_sidecar(
    app: tauri::AppHandle,
    state: tauri::State<'_, DesktopRuntimeState>,
) -> Result<SidecarState, String> {
    let config = build_desktop_sidecar_launch_config(&app)?;
    let health = HttpSidecarHealth;

    if let sidecar::LaunchMode::Wsl { distro } = &config.mode {
        release_known_wsl_runtime(distro);
        sleep(Duration::from_millis(600));
        if health.is_healthy(0, &config.health_url) {
            let port = sidecar_port_from_config(&config);
            return update_sidecar_state(
                &state,
                SidecarState {
                    status: "failed".to_string(),
                    dashboard_url: None,
                    log_path: None,
                    message: Some(format!(
                        "Another process is using AOP port {port} inside WSL. Stop it and reopen AOP Desktop."
                    )),
                },
            );
        }
        provision_managed_wsl_runtime(&app, distro)?;
    }

    if matches!(config.mode, sidecar::LaunchMode::Native)
        && health.is_healthy(0, &config.health_url)
    {
        let sidecar_version = resolve_sidecar_version(&config.program)?;
        if sidecar::existing_server_matches_sidecar(&config.health_url, &sidecar_version) {
            return update_sidecar_state(&state, ready_sidecar_state(&config, None));
        }
        release_known_aop_port(sidecar_port_from_config(&config));
        if health.is_healthy(0, &config.health_url) {
            return update_sidecar_state(
                &state,
                SidecarState {
                    status: "failed".to_string(),
                    dashboard_url: None,
                    log_path: config.env_value("AOP_LOG_DIR").map(str::to_string),
                    message: Some(
                        "A different AOP server is already running on port 25150. Quit it and reopen AOP."
                            .to_string(),
                    ),
                },
            );
        }
    }

    if health.is_healthy(0, &config.health_url) {
        return update_sidecar_state(&state, ready_sidecar_state(&config, None));
    }

    start_sidecar_process(&state, &config)?;
    let next_state = wait_for_desktop_sidecar(&health, &config);

    update_sidecar_state(&state, next_state)
}

#[tauri::command]
fn get_sidecar_state(state: tauri::State<'_, DesktopRuntimeState>) -> Result<SidecarState, String> {
    state
        .last_sidecar_state
        .lock()
        .map(|current| current.clone())
        .map_err(|_| "Could not read sidecar state.".to_string())
}

#[tauri::command]
fn open_logs_folder() -> Result<(), String> {
    let log_dir = default_log_dir()?;
    create_dir_all(&log_dir).map_err(|error| error.to_string())?;
    let (program, arg) = file_manager_command(Platform::current(), &log_dir);
    // explorer.exe returns a nonzero exit status even on success, so we fire-and-forget
    // (.spawn() without waiting) on both platforms rather than checking the status.
    Command::new(program)
        .arg(arg)
        .spawn()
        .map_err(|error| error.to_string())?;

    Ok(())
}

/// Platform file-manager invocation to reveal a folder: `explorer.exe` / `open`.
pub fn file_manager_command(platform: Platform, dir: &Path) -> (&'static str, PathBuf) {
    let program = match platform {
        Platform::Unix => "open",
        Platform::Windows => "explorer.exe",
    };
    (program, dir.to_path_buf())
}

#[tauri::command]
fn quit_desktop_app(app: tauri::AppHandle) {
    stop_sidecar(&app.state::<DesktopRuntimeState>());
    app.exit(0);
}

#[tauri::command]
fn list_wsl_distros() -> Result<Vec<wsl::WslDistro>, String> {
    wsl::list_wsl_distros()
}

#[tauri::command]
fn get_exec_host() -> String {
    wsl::format_exec_host(&wsl::load_exec_host())
}

#[tauri::command]
fn set_exec_host(mode: String) -> Result<(), String> {
    let parsed = wsl::parse_exec_host(&mode);
    if Platform::current() == Platform::Windows && parsed == wsl::ExecHostMode::Native {
        return Err("AOP Desktop requires a WSL 2 distro on Windows.".to_string());
    }
    if let wsl::ExecHostMode::Wsl(distro) = &parsed {
        let distros = wsl::list_wsl_distros()?;
        if !distros.iter().any(|candidate| &candidate.name == distro) {
            return Err(format!("WSL distro '{distro}' was not found."));
        }
    }
    // Persisted to a file (not process env) so the sidecar launch reads it via load_exec_host
    // without mutating process-global env (unsafe under edition 2024) from a Tauri worker.
    wsl::save_exec_host(&parsed)
}

impl Default for DesktopRuntimeState {
    fn default() -> Self {
        Self {
            sidecar: Mutex::new(None),
            last_sidecar_state: Mutex::new(SidecarState {
                status: "idle".to_string(),
                dashboard_url: None,
                log_path: None,
                message: None,
            }),
        }
    }
}

fn build_desktop_sidecar_launch_config(
    app: &tauri::AppHandle,
) -> Result<SidecarLaunchConfig, String> {
    let ports = SidecarPorts::from_env();
    match wsl::load_exec_host() {
        wsl::ExecHostMode::Wsl(distro) => Ok(sidecar::build_wsl_sidecar_launch_config(
            &distro,
            &app.package_info().version.to_string(),
            ports,
        )),
        wsl::ExecHostMode::Native => {
            if Platform::current() == Platform::Windows {
                return Err("Select a WSL 2 distro before starting AOP Desktop.".to_string());
            }
            let paths = SidecarPaths {
                executable: resolve_sidecar_executable(app)?,
                log_dir: default_log_dir()?,
            };
            create_dir_all(&paths.log_dir).map_err(|error| error.to_string())?;
            Ok(build_sidecar_launch_config(paths, ports))
        }
    }
}

fn sidecar_port_from_config(config: &SidecarLaunchConfig) -> u16 {
    config
        .env_value("AOP_LOCAL_SERVER_PORT")
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or_else(|| SidecarPorts::from_env().local_server)
}

fn resolve_sidecar_version(program: &Path) -> Result<String, String> {
    let output = Command::new(program)
        .arg("--version")
        .output()
        .map_err(|error| format!("Could not read bundled AOP sidecar version: {error}"))?;
    if !output.status.success() {
        return Err("Bundled AOP sidecar did not report a version.".to_string());
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .split('/')
        .nth(1)
        .and_then(|value| value.split_whitespace().next())
        .map(str::to_string)
        .ok_or_else(|| "Bundled AOP sidecar version output was not recognized.".to_string())
}

fn release_known_aop_port(port: u16) {
    #[cfg(target_os = "macos")]
    unload_known_source_launch_agents();
    kill_port_listener(port);
    sleep(Duration::from_millis(600));
}

#[cfg(target_os = "macos")]
fn unload_known_source_launch_agents() {
    let Some(home) = std::env::var_os("HOME").and_then(|value| value.into_string().ok()) else {
        return;
    };
    let uid = Command::new("id")
        .arg("-u")
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|value| value.trim().to_string());

    for service in ["com.aop.local-server", "com.getaop.local-server"] {
        let plist = PathBuf::from(&home)
            .join("Library")
            .join("LaunchAgents")
            .join(format!("{service}.plist"));
        if let Some(uid) = uid.as_deref() {
            let _ = Command::new("launchctl")
                .args(["bootout", &format!("gui/{uid}")])
                .arg(&plist)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        let _ = Command::new("launchctl")
            .arg("unload")
            .arg(&plist)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

fn kill_port_listener(port: u16) {
    let Ok(output) = Command::new("lsof")
        .arg(format!("-tiTCP:{port}"))
        .arg("-sTCP:LISTEN")
        .output()
    else {
        return;
    };
    let pids = String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .map(str::to_string)
        .collect::<Vec<_>>();
    if pids.is_empty() {
        return;
    }

    let _ = Command::new("kill").args(&pids).status();
    sleep(Duration::from_millis(300));
    let _ = Command::new("kill").arg("-9").args(&pids).status();
}

fn provision_managed_wsl_runtime(app: &tauri::AppHandle, distro: &str) -> Result<(), String> {
    let binary = resolve_resource_path(app, "aop-linux-x64")?;
    let assets = resolve_resource_path(app, "runtime-assets.tar.gz")?;
    let fingerprint_path = resolve_resource_path(app, "desktop-runtime.sha256")?;
    let fingerprint = std::fs::read_to_string(&fingerprint_path)
        .map_err(|error| format!("Could not read managed runtime fingerprint: {error}"))?;
    let fingerprint = fingerprint.trim();
    if !sidecar::is_valid_runtime_fingerprint(fingerprint) {
        return Err("The bundled AOP runtime fingerprint is invalid.".to_string());
    }
    let version = app.package_info().version.to_string();
    let args = sidecar::provision_managed_runtime_argv(
        distro,
        &version,
        &binary.to_string_lossy(),
        &assets.to_string_lossy(),
        fingerprint,
    );
    run_hidden_wsl(args, "Could not install the bundled AOP runtime inside WSL")
}

fn release_known_wsl_runtime(distro: &str) {
    let args = sidecar::release_known_wsl_runtime_argv(distro);
    let _ = run_hidden_wsl(args, "Could not stop the previous AOP WSL runtime");
}

fn run_hidden_wsl(args: Vec<String>, message: &str) -> Result<(), String> {
    let mut command = Command::new("wsl.exe");
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    crate::platform::hide_console_window(&mut command);
    let status = command
        .status()
        .map_err(|error| format!("{message}: {error}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{message} (exit code {:?}).", status.code()))
    }
}

fn resolve_resource_path(app: &tauri::AppHandle, resource_name: &str) -> Result<PathBuf, String> {
    if let Ok(path) = app
        .path()
        .resolve(resource_name, tauri::path::BaseDirectory::Resource)
    {
        return Ok(path);
    }

    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let directory = executable
        .parent()
        .ok_or_else(|| "Could not resolve desktop executable directory.".to_string())?;
    Ok(directory.join(resource_name))
}

fn resolve_sidecar_executable(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("AOP_DESKTOP_SIDECAR_PATH") {
        return Ok(PathBuf::from(path));
    }

    resolve_resource_path(app, Platform::current().sidecar_resource_name())
}

fn default_log_dir() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").and_then(|value| value.into_string().ok());
    let userprofile = std::env::var_os("USERPROFILE").and_then(|value| value.into_string().ok());
    let explicit = std::env::var_os("AOP_LOG_DIR").and_then(|value| value.into_string().ok());
    default_log_dir_from_env(
        Platform::current(),
        home.as_deref(),
        userprofile.as_deref(),
        explicit.as_deref(),
    )
}

/// Resolve `<home>/.aop/logs`, preferring `%USERPROFILE%` on Windows. Pure for testing.
pub fn default_log_dir_from(
    platform: Platform,
    home: Option<&str>,
    userprofile: Option<&str>,
) -> Result<PathBuf, String> {
    let base = match platform {
        Platform::Unix => home.ok_or_else(|| "HOME is not set.".to_string())?,
        Platform::Windows => userprofile
            .or(home)
            .ok_or_else(|| "Neither USERPROFILE nor HOME is set.".to_string())?,
    };
    Ok(PathBuf::from(base).join(".aop").join("logs"))
}

pub fn default_log_dir_from_env(
    platform: Platform,
    home: Option<&str>,
    userprofile: Option<&str>,
    explicit: Option<&str>,
) -> Result<PathBuf, String> {
    if let Some(value) = explicit.filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(value));
    }

    default_log_dir_from(platform, home, userprofile)
}

fn start_sidecar_process(
    state: &tauri::State<'_, DesktopRuntimeState>,
    config: &SidecarLaunchConfig,
) -> Result<(), String> {
    clear_finished_sidecar(state)?;

    let mut sidecar = state
        .sidecar
        .lock()
        .map_err(|_| "Could not lock sidecar process state.".to_string())?;
    if sidecar.is_some() {
        return Ok(());
    }

    let (program, args) = sidecar::sidecar_spawn_argv(config);
    let mut command = Command::new(&program);
    command
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // Native sets env on the spawned process; WSL bakes env into the bash script so a
    // Windows-shaped PATH/env never leaks across the boundary via the wsl.exe process.
    if matches!(config.mode, sidecar::LaunchMode::Native) {
        command.envs(config.env.iter().map(|(key, value)| (key, value)));
    }
    // Native spawns aop.exe (a console app) and WSL spawns wsl.exe; both pop a console
    // window on Windows without this. No-op off Windows.
    crate::platform::hide_console_window(&mut command);
    let child = command.spawn().map_err(|error| {
        // The bundled aop.exe is unsigned in the alpha, so Defender/SmartScreen can quarantine
        // it; surface that instead of a bare OS error on native Windows.
        let hint = if cfg!(windows) && matches!(config.mode, sidecar::LaunchMode::Native) {
            " (Windows may have blocked the unsigned aop.exe — check SmartScreen/Defender quarantine)"
        } else {
            ""
        };
        format!("Failed to start AOP sidecar ({program}): {error}{hint}")
    })?;

    *sidecar = Some(SidecarHandle {
        child,
        mode: config.mode.clone(),
    });
    Ok(())
}

/// Terminate the sidecar on quit. Under WSL the in-distro pidfile kill MUST run before the
/// relay kill, because Child::id() is the wsl.exe relay PID, not the Linux aop PID.
fn stop_sidecar(state: &tauri::State<'_, DesktopRuntimeState>) {
    let Ok(mut guard) = state.sidecar.lock() else {
        return;
    };
    let Some(mut handle) = guard.take() else {
        return;
    };

    match sidecar::shutdown_plan(&handle.mode) {
        sidecar::ShutdownPlan::WslPidfileThenRelay { distro } => {
            let mut kill = Command::new("wsl.exe");
            kill.args(wsl::wsl_kill_argv(&distro))
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            crate::platform::hide_console_window(&mut kill);
            let _ = kill.status();
            let _ = handle.child.kill();
            let _ = handle.child.wait();
        }
        sidecar::ShutdownPlan::TaskkillTree => {
            let mut taskkill = Command::new("taskkill");
            taskkill
                .args(sidecar::taskkill_argv(handle.child.id()))
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            crate::platform::hide_console_window(&mut taskkill);
            let _ = taskkill.status();
            let _ = handle.child.wait();
        }
        sidecar::ShutdownPlan::UnixKillWait => {
            let _ = handle.child.kill();
            let _ = handle.child.wait();
        }
    }
}

fn clear_finished_sidecar(state: &tauri::State<'_, DesktopRuntimeState>) -> Result<(), String> {
    let mut sidecar = state
        .sidecar
        .lock()
        .map_err(|_| "Could not lock sidecar process state.".to_string())?;

    if let Some(handle) = sidecar.as_mut() {
        if handle
            .child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_some()
        {
            *sidecar = None;
        }
    }

    Ok(())
}

fn wait_for_desktop_sidecar(
    health: &impl SidecarHealth,
    config: &SidecarLaunchConfig,
) -> SidecarState {
    for attempt in 0..SIDECAR_HEALTH_ATTEMPTS {
        if health.is_healthy(attempt, &config.health_url) {
            return ready_sidecar_state(config, None);
        }

        sleep(SIDECAR_HEALTH_DELAY);
    }

    let message = match &config.mode {
        sidecar::LaunchMode::Wsl { distro } => {
            // Probe the port this launch actually used (AOP_LOCAL_SERVER_PORT may be
            // overridden via env), not the hardcoded default — otherwise the WSL
            // failure diagnostic checks the wrong port and mis-reports the cause.
            let local_server_port = config
                .env_value("AOP_LOCAL_SERVER_PORT")
                .and_then(|value| value.parse::<u16>().ok())
                .unwrap_or_else(|| SidecarPorts::default().local_server);
            let in_distro_ok = sidecar::wsl_in_distro_health(distro, local_server_port);
            sidecar::sidecar_failure_message(sidecar::classify_sidecar_failure(false, in_distro_ok))
                .to_string()
        }
        sidecar::LaunchMode::Native => "The AOP local server did not become healthy.".to_string(),
    };

    SidecarState {
        status: "failed".to_string(),
        dashboard_url: None,
        log_path: config.env_value("AOP_LOG_DIR").map(str::to_string),
        message: Some(message),
    }
}

fn ready_sidecar_state(config: &SidecarLaunchConfig, message: Option<String>) -> SidecarState {
    SidecarState {
        status: "ready".to_string(),
        dashboard_url: Some(config.dashboard_url.clone()),
        log_path: config.env_value("AOP_LOG_DIR").map(str::to_string),
        message: Some(message.unwrap_or_else(|| "AOP is ready.".to_string())),
    }
}

fn update_sidecar_state(
    state: &tauri::State<'_, DesktopRuntimeState>,
    next_state: SidecarState,
) -> Result<SidecarState, String> {
    let mut current = state
        .last_sidecar_state
        .lock()
        .map_err(|_| "Could not update sidecar state.".to_string())?;
    *current = next_state.clone();

    Ok(next_state)
}

fn command_error_message(error: commands::DesktopCommandError) -> String {
    match error {
        commands::DesktopCommandError::UnknownSetupAction => "Unknown setup action.".to_string(),
        commands::DesktopCommandError::SetupActionFailed(message) => message,
    }
}
