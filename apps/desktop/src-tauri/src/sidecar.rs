use serde::Serialize;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use crate::setup::gui_safe_path;
use crate::wsl;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SidecarPaths {
    pub executable: PathBuf,
    pub log_dir: PathBuf,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SidecarPorts {
    pub local_server: u16,
    pub dashboard: u16,
}

/// Where the sidecar runs: as a native process, or inside a WSL distro (Model B).
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum LaunchMode {
    Native,
    Wsl { distro: String },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SidecarLaunchConfig {
    pub mode: LaunchMode,
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub health_url: String,
    pub dashboard_url: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarState {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dashboard_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub log_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

pub trait SidecarHealth {
    fn is_healthy(&self, attempt: usize, health_url: &str) -> bool;
}

pub struct HttpSidecarHealth;

impl SidecarHealth for HttpSidecarHealth {
    fn is_healthy(&self, _attempt: usize, health_url: &str) -> bool {
        check_health_url(health_url)
    }
}

impl Default for SidecarPorts {
    fn default() -> Self {
        Self {
            local_server: 25150,
            dashboard: 25160,
        }
    }
}

impl SidecarPorts {
    pub fn from_env() -> Self {
        Self::from_env_values(
            std::env::var("AOP_DESKTOP_LOCAL_SERVER_PORT")
                .ok()
                .as_deref(),
            std::env::var("AOP_DESKTOP_DASHBOARD_PORT").ok().as_deref(),
        )
    }

    pub fn from_env_values(local_server: Option<&str>, dashboard: Option<&str>) -> Self {
        let defaults = Self::default();
        Self {
            local_server: parse_port(local_server).unwrap_or(defaults.local_server),
            dashboard: parse_port(dashboard).unwrap_or(defaults.dashboard),
        }
    }
}

impl SidecarLaunchConfig {
    pub fn env_value(&self, key: &str) -> Option<&str> {
        self.env
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.as_str())
    }
}

fn parse_port(value: Option<&str>) -> Option<u16> {
    let port = value?.parse::<u16>().ok()?;
    (port > 0).then_some(port)
}

pub fn build_sidecar_launch_config(
    paths: SidecarPaths,
    ports: SidecarPorts,
) -> SidecarLaunchConfig {
    build_sidecar_launch_config_with_dashboard_dev(paths, ports, is_dashboard_dev_mode())
}

pub fn build_sidecar_launch_config_with_dashboard_dev(
    paths: SidecarPaths,
    ports: SidecarPorts,
    dashboard_dev: bool,
) -> SidecarLaunchConfig {
    let local_server_url = format!("http://127.0.0.1:{}", ports.local_server);
    let dashboard_origin = dashboard_origin_for_ports(ports, dashboard_dev);
    let dashboard_url = dashboard_webview_url(&dashboard_origin);

    SidecarLaunchConfig {
        mode: LaunchMode::Native,
        program: paths.executable,
        args: vec!["run".to_string()],
        env: vec![
            (
                "AOP_LOCAL_SERVER_PORT".to_string(),
                ports.local_server.to_string(),
            ),
            (
                "AOP_DASHBOARD_PORT".to_string(),
                ports.dashboard.to_string(),
            ),
            (
                "AOP_LOG_DIR".to_string(),
                paths.log_dir.to_string_lossy().to_string(),
            ),
            ("AOP_LOCAL_SERVER_URL".to_string(), local_server_url.clone()),
            ("AOP_DASHBOARD_URL".to_string(), dashboard_origin),
            (
                "NODE_ENV".to_string(),
                node_env_for_dashboard(dashboard_dev),
            ),
            ("PATH".to_string(), gui_safe_path()),
        ],
        health_url: format!("{local_server_url}/api/health"),
        dashboard_url,
    }
}

/// Model B launch config: the Linux `aop` runs inside `distro`. No Windows PATH or
/// AOP_LOG_DIR — those are set inside the distro by `build_wsl_launch_script`.
pub fn build_wsl_sidecar_launch_config(
    distro: &str,
    version: &str,
    ports: SidecarPorts,
) -> SidecarLaunchConfig {
    build_wsl_sidecar_launch_config_with_dashboard_dev(
        distro,
        version,
        ports,
        is_dashboard_dev_mode(),
    )
}

pub fn build_wsl_sidecar_launch_config_with_dashboard_dev(
    distro: &str,
    version: &str,
    ports: SidecarPorts,
    dashboard_dev: bool,
) -> SidecarLaunchConfig {
    let local_server_url = format!("http://127.0.0.1:{}", ports.local_server);
    let dashboard_origin = dashboard_origin_for_ports(ports, dashboard_dev);
    let dashboard_url = dashboard_webview_url(&dashboard_origin);

    SidecarLaunchConfig {
        mode: LaunchMode::Wsl {
            distro: distro.to_string(),
        },
        program: PathBuf::from(format!(".aop/desktop-runtime/{version}/aop")),
        args: vec!["run".to_string()],
        env: vec![
            (
                "AOP_LOCAL_SERVER_PORT".to_string(),
                ports.local_server.to_string(),
            ),
            (
                "AOP_DASHBOARD_PORT".to_string(),
                ports.dashboard.to_string(),
            ),
            ("AOP_LOCAL_SERVER_URL".to_string(), local_server_url.clone()),
            ("AOP_DASHBOARD_URL".to_string(), dashboard_origin),
            (
                "NODE_ENV".to_string(),
                node_env_for_dashboard(dashboard_dev),
            ),
            ("AOP_EXEC_HOST".to_string(), format!("wsl:{distro}")),
            ("AOP_DESKTOP_MANAGED_RUNTIME".to_string(), "1".to_string()),
        ],
        health_url: format!("{local_server_url}/api/health"),
        dashboard_url,
    }
}

fn dashboard_origin_for_ports(ports: SidecarPorts, dev_mode: bool) -> String {
    let port = if dev_mode {
        ports.dashboard
    } else {
        ports.local_server
    };
    format!("http://127.0.0.1:{port}")
}

fn is_dashboard_dev_mode() -> bool {
    std::env::var("AOP_DESKTOP_DASHBOARD_DEV")
        .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

fn node_env_for_dashboard(dev_mode: bool) -> String {
    if dev_mode {
        "development"
    } else {
        "production"
    }
    .to_string()
}

fn dashboard_webview_url(origin: &str) -> String {
    format!("{origin}/?aopDesktop=1")
}

/// Resolve the program + args to actually spawn. Native: (program, args). WSL: `wsl.exe`
/// running a bash login-shell launch script inside the distro.
pub fn sidecar_spawn_argv(config: &SidecarLaunchConfig) -> (String, Vec<String>) {
    match &config.mode {
        LaunchMode::Native => (
            config.program.to_string_lossy().into_owned(),
            config.args.clone(),
        ),
        LaunchMode::Wsl { distro } => (
            "wsl.exe".to_string(),
            wsl::wsl_bash_script_argv(
                distro,
                &build_wsl_launch_script(&config.env, &config.program),
            ),
        ),
    }
}

/// Bash login-shell script for the in-distro sidecar. `echo $$` records the shell PID; after
/// `exec <managed-runtime>/aop run` replaces the shell and inherits that PID, so the pidfile
/// real Linux PID (WIN-13 kills it). AOP_HOME/logs stay inside the distro filesystem — never
/// /mnt/c, whose 9p access is slow and corrupts git worktrees and SQLite.
pub fn build_wsl_launch_script(env: &[(String, String)], executable: &std::path::Path) -> String {
    let mut script =
        String::from("mkdir -p \"$HOME/.aop\" && echo $$ > \"$HOME/.aop/desktop-sidecar.pid\" && ");
    for (key, value) in env {
        // Defensive: a Windows-shaped PATH or log dir must never cross into the distro.
        if key == "PATH" || key == "AOP_LOG_DIR" {
            continue;
        }
        script.push_str(&format!("{key}={} ", wsl::bash_single_quote(value)));
    }
    script.push_str(&format!(
        "AOP_LOG_DIR=\"$HOME/.aop/logs\" exec \"$HOME\"/{} run",
        wsl::bash_single_quote(&executable.to_string_lossy())
    ));
    script
}

pub fn is_valid_runtime_fingerprint(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// Install the release-matched Linux runtime from the Windows package into WSL. A content
/// fingerprint refreshes same-version recovery builds while leaving user-managed `aop` commands
/// untouched.
pub fn provision_managed_runtime_argv(
    distro: &str,
    version: &str,
    windows_binary: &str,
    windows_assets: &str,
    fingerprint: &str,
) -> Vec<String> {
    let version = wsl::bash_single_quote(version);
    let windows_binary = wsl::bash_single_quote(windows_binary);
    let windows_assets = wsl::bash_single_quote(windows_assets);
    let fingerprint = wsl::bash_single_quote(fingerprint);
    let script = format!(
        "set -eu; runtime=\"$HOME/.aop/desktop-runtime\"/{version}; marker=\"$runtime/.fingerprint\"; expected={fingerprint}; \
         if [ -x \"$runtime/aop\" ] && [ -f \"$runtime/dashboard/index.html\" ] && [ \"$(cat \"$marker\" 2>/dev/null || true)\" = \"$expected\" ]; then exit 0; fi; \
         binary=$(wslpath -u {windows_binary}); assets=$(wslpath -u {windows_assets}); parent=$(dirname \"$runtime\"); \
         staging=\"$runtime.tmp.$$\"; backup=\"$runtime.previous\"; lock=\"$runtime.lock\"; mkdir -p \"$parent\"; \
         if ! mkdir \"$lock\" 2>/dev/null; then echo 'AOP Desktop runtime installation is already in progress.' >&2; exit 1; fi; \
         trap 'rm -rf \"$staging\" \"$lock\"' EXIT; rm -rf \"$staging\"; mkdir -p \"$staging\"; \
         cp \"$binary\" \"$staging/aop\"; chmod 755 \"$staging/aop\"; tar -xzf \"$assets\" -C \"$staging\"; \
         test -f \"$staging/dashboard/index.html\"; printf '%s\\n' \"$expected\" > \"$staging/.fingerprint\"; rm -rf \"$backup\"; \
         if [ -e \"$runtime\" ]; then mv \"$runtime\" \"$backup\"; fi; \
         if mv \"$staging\" \"$runtime\"; then rm -rf \"$backup\"; else if [ -e \"$backup\" ]; then mv \"$backup\" \"$runtime\"; fi; exit 1; fi; \
         rm -rf \"$lock\"; trap - EXIT"
    );
    wsl::wsl_bash_script_argv(distro, &script)
}

/// Stop only AOP processes whose ownership is known: the legacy source-install service and a
/// previous desktop-managed sidecar. Unknown listeners are left untouched and reported later.
pub fn release_known_wsl_runtime_argv(distro: &str) -> Vec<String> {
    let script = "systemctl --user stop aop-local-server.service >/dev/null 2>&1 || true; \
                  pidfile=\"$HOME/.aop/desktop-sidecar.pid\"; \
                  if [ -f \"$pidfile\" ]; then pid=$(cat \"$pidfile\"); case \"$pid\" in (*[!0-9]*|'') ;; (*) exe=$(readlink \"/proc/$pid/exe\" 2>/dev/null || true); case \"$exe\" in (\"$HOME/.aop/desktop-runtime/\"*/aop) kill \"$pid\" >/dev/null 2>&1 || true ;; esac ;; esac; rm -f \"$pidfile\"; fi";
    wsl::wsl_bash_script_argv(distro, script)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SidecarFailure {
    Healthy,
    LocalhostForwardingBlocked,
    SidecarNeverStarted,
}

/// Distinguish "the in-distro server is up but Windows can't reach it over forwarded
/// localhost" from "the sidecar never started", using a Windows-side + an in-distro probe.
pub fn classify_sidecar_failure(windows_ok: bool, in_distro_ok: bool) -> SidecarFailure {
    match (windows_ok, in_distro_ok) {
        (true, _) => SidecarFailure::Healthy,
        (false, true) => SidecarFailure::LocalhostForwardingBlocked,
        (false, false) => SidecarFailure::SidecarNeverStarted,
    }
}

pub fn sidecar_failure_message(failure: SidecarFailure) -> &'static str {
    match failure {
        SidecarFailure::Healthy => "AOP is ready.",
        SidecarFailure::LocalhostForwardingBlocked => {
            "AOP is running inside WSL but Windows can't reach it on localhost. Check WSL \
             networking (mirrored mode / .wslconfig) and any firewall blocking 127.0.0.1:25150."
        }
        SidecarFailure::SidecarNeverStarted => {
            "The AOP server did not start inside WSL. Open your distro and check ~/.aop/logs."
        }
    }
}

/// How to terminate the sidecar on quit, selected from the launch mode.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ShutdownPlan {
    /// WSL: kill the in-distro sidecar via its pidfile FIRST, then the wsl.exe relay child.
    WslPidfileThenRelay { distro: String },
    /// Native Windows: taskkill the whole process tree.
    TaskkillTree,
    /// Native Unix: kill + wait the child.
    UnixKillWait,
}

pub fn shutdown_plan(mode: &LaunchMode) -> ShutdownPlan {
    match mode {
        LaunchMode::Wsl { distro } => ShutdownPlan::WslPidfileThenRelay {
            distro: distro.clone(),
        },
        LaunchMode::Native => {
            if cfg!(windows) {
                ShutdownPlan::TaskkillTree
            } else {
                ShutdownPlan::UnixKillWait
            }
        }
    }
}

/// `taskkill` argv to terminate a Windows process tree by PID.
pub fn taskkill_argv(pid: u32) -> Vec<String> {
    vec![
        "/T".to_string(),
        "/F".to_string(),
        "/PID".to_string(),
        pid.to_string(),
    ]
}

/// Probe the in-distro server health by running curl inside the distro (Windows-only).
pub fn wsl_in_distro_health(distro: &str, port: u16) -> bool {
    let script =
        format!("curl -fsS -o /dev/null -w '%{{http_code}}' http://127.0.0.1:{port}/api/health");
    let mut wsl = Command::new("wsl.exe");
    wsl.args(wsl::wsl_bash_lc_argv(distro, &script));
    crate::platform::hide_console_window(&mut wsl);
    match wsl.output() {
        Ok(output) => output.stdout.starts_with(b"200"),
        Err(_) => false,
    }
}

pub fn wait_for_sidecar_health(
    health: &impl SidecarHealth,
    health_url: &str,
    max_attempts: usize,
) -> SidecarState {
    for attempt in 0..max_attempts {
        if health.is_healthy(attempt, health_url) {
            return SidecarState {
                status: "ready".to_string(),
                dashboard_url: Some(dashboard_url_from_health_url(health_url)),
                log_path: None,
                message: Some("AOP is ready.".to_string()),
            };
        }
    }

    SidecarState {
        status: "failed".to_string(),
        dashboard_url: None,
        log_path: None,
        message: Some("The AOP local server did not become healthy.".to_string()),
    }
}

fn dashboard_url_from_health_url(health_url: &str) -> String {
    health_url
        .strip_suffix("/api/health")
        .map(|base| format!("{base}/"))
        .unwrap_or_else(|| health_url.to_string())
}

fn check_health_url(health_url: &str) -> bool {
    let Some((port, path)) = parse_local_http_url(health_url) else {
        return false;
    };
    let address = format!("127.0.0.1:{port}");
    let Ok(mut stream) = TcpStream::connect_timeout(
        &address.parse().expect("valid loopback address"),
        Duration::from_millis(200),
    ) else {
        return false;
    };

    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let request = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }

    let mut buffer = [0_u8; 32];
    match stream.read(&mut buffer) {
        Ok(size) => {
            let status = &buffer[..size];
            status.starts_with(b"HTTP/1.1 200") || status.starts_with(b"HTTP/1.0 200")
        }
        Err(_) => false,
    }
}

fn parse_local_http_url(url: &str) -> Option<(u16, String)> {
    let value = url
        .strip_prefix("http://127.0.0.1:")
        .or_else(|| url.strip_prefix("http://localhost:"))?;
    let (port, path) = value.split_once('/')?;
    let port = port.parse::<u16>().ok()?;

    Some((port, format!("/{path}")))
}

pub fn existing_server_matches_sidecar(health_url: &str, sidecar_version: &str) -> bool {
    read_existing_server_version(health_url)
        .map(|server_version| is_existing_server_compatible(&server_version, sidecar_version))
        .unwrap_or(false)
}

pub fn is_existing_server_compatible(server_version: &str, sidecar_version: &str) -> bool {
    let Some(server) = release_core(server_version) else {
        return false;
    };
    let Some(sidecar) = release_core(sidecar_version) else {
        return false;
    };

    server == sidecar
}

fn read_existing_server_version(health_url: &str) -> Option<String> {
    let version_url = health_url.strip_suffix("/api/health")?;
    let response = request_local_http_url(&format!("{version_url}/api/updates"))?;
    let body = response.split_once("\r\n\r\n")?.1;
    extract_json_string_field(body, "currentVersion")
}

fn release_core(version: &str) -> Option<&str> {
    let core = version
        .trim()
        .trim_start_matches('v')
        .split('+')
        .next()?
        .trim();
    if core.is_empty() { None } else { Some(core) }
}

fn extract_json_string_field(body: &str, field: &str) -> Option<String> {
    let needle = format!("\"{field}\"");
    let (_, after_field) = body.split_once(&needle)?;
    let (_, after_colon) = after_field.split_once(':')?;
    let after_quote = after_colon.trim_start().strip_prefix('"')?;
    let value = after_quote.split('"').next()?.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

fn request_local_http_url(url: &str) -> Option<String> {
    let (port, path) = parse_local_http_url(url)?;
    let address = format!("127.0.0.1:{port}");
    let mut stream = TcpStream::connect_timeout(
        &address.parse().expect("valid loopback address"),
        Duration::from_millis(200),
    )
    .ok()?;

    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let request = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).ok()?;

    let mut response = String::new();
    stream.read_to_string(&mut response).ok()?;
    Some(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn existing_server_compatibility_requires_matching_release_version() {
        assert!(is_existing_server_compatible(
            "0.2.14+d6c5672",
            "0.2.14+d6c5672"
        ));
        assert!(is_existing_server_compatible("0.2.14+d6c5672", "0.2.14"));
        assert!(!is_existing_server_compatible(
            "0.2.13+9c968cc",
            "0.2.14+d6c5672"
        ));
        assert!(!is_existing_server_compatible("", "0.2.14+d6c5672"));
    }
}
