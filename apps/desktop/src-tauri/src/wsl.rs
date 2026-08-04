//! WSL (Model B) building blocks: distro detection, in-distro command execution, and the
//! `AOP_EXEC_HOST` execution mode persisted during setup.
//!
//! The pure helpers (decode/parse/argv/quoting/mode) are unit-tested on any host; only the
//! `wsl.exe`-spawning wrappers run on a real Windows machine.

use std::path::PathBuf;
use std::process::Command;

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use serde::Serialize;

use crate::platform::Platform;
use crate::setup::{CommandOutput, CommandRunner, CommandSpec};

const WSL_USER_CLI_PATH_SETUP: &str = concat!(
    "for aop_cli_bin_dir in ",
    "\"$HOME/.local/bin\" ",
    "\"$HOME/.opencode/bin\" ",
    "\"$HOME/.bun/bin\" ",
    "\"$HOME/.npm-global/bin\" ",
    "\"$HOME/.npm/bin\" ",
    "\"$HOME/.volta/bin\" ",
    "\"$HOME/.asdf/shims\" ",
    "\"$HOME/.local/share/pnpm\" ",
    "\"$HOME/.local/share/mise/shims\" ",
    "\"$HOME/.yarn/bin\" ",
    "\"$HOME\"/.nvm/versions/node/*/bin ",
    "\"$HOME\"/.local/share/fnm/node-versions/*/installation/bin; do ",
    "[ -d \"$aop_cli_bin_dir\" ] && PATH=\"$aop_cli_bin_dir:$PATH\"; ",
    "done; export PATH",
);

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslDistro {
    pub name: String,
    pub is_default: bool,
    pub running: bool,
    pub version: u8,
}

/// Decode `wsl.exe` output. With `WSL_UTF8=1` modern wsl emits UTF-8, but older builds emit
/// UTF-16LE; detect the latter by interleaved NUL bytes (and an optional BOM).
pub fn decode_wsl_output(bytes: &[u8]) -> String {
    let looks_utf16 = bytes.len() >= 2 && bytes.iter().skip(1).step_by(2).any(|byte| *byte == 0);
    if !looks_utf16 {
        return String::from_utf8_lossy(bytes).into_owned();
    }

    let body = if bytes.starts_with(&[0xFF, 0xFE]) {
        &bytes[2..]
    } else {
        bytes
    };
    let units: Vec<u16> = body
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect();
    String::from_utf16_lossy(&units)
}

/// Parse `wsl --list --verbose` into WSL2 distros.
///
/// The header row and STATE column are LOCALIZED by the Windows display language, so we never
/// match on "NAME"/"Running": skip the first line unconditionally, read the version from the
/// LAST column, and take the name from the first column (after an optional `*` default
/// marker). Distro names containing spaces are not recoverable from this table (rare edge).
pub fn parse_wsl_list_verbose(text: &str) -> Vec<WslDistro> {
    text.lines()
        .skip(1)
        .filter_map(parse_wsl_list_line)
        .collect()
}

fn parse_wsl_list_line(line: &str) -> Option<WslDistro> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    let is_default = trimmed.starts_with('*');
    let tokens: Vec<&str> = trimmed
        .trim_start_matches('*')
        .trim()
        .split_whitespace()
        .collect();
    if tokens.len() < 3 {
        return None;
    }

    let name = tokens[0].to_string();
    let version: u8 = tokens[tokens.len() - 1].parse().ok()?;
    if version != 2
        || name.eq_ignore_ascii_case("docker-desktop")
        || name.eq_ignore_ascii_case("docker-desktop-data")
    {
        return None;
    }

    let running = tokens[tokens.len() - 2].eq_ignore_ascii_case("running");
    Some(WslDistro {
        name,
        is_default,
        running,
        version,
    })
}

/// `wsl.exe` args to run a bash login-shell script inside a distro.
pub fn wsl_bash_lc_argv(distro: &str, script: &str) -> Vec<String> {
    vec![
        "-d".to_string(),
        distro.to_string(),
        "--".to_string(),
        "bash".to_string(),
        "-lc".to_string(),
        script.to_string(),
    ]
}

/// Encode scripts before crossing wsl.exe's Windows command-line boundary. Passing scripts with
/// `$variables` directly lets wsl.exe's launch shell expand them before the intended Bash runs.
pub fn wsl_bash_script_argv(distro: &str, script: &str) -> Vec<String> {
    let encoded = BASE64.encode(script);
    wsl_bash_lc_argv(distro, &format!("printf %s {encoded} | base64 -d | bash"))
}

/// Single-quote a string for POSIX bash (close quote, escaped quote, re-open).
pub fn bash_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

/// Join a program + args into one bash command line, each part single-quoted.
pub fn shell_join(program: &str, args: &[String]) -> String {
    std::iter::once(program.to_string())
        .chain(args.iter().cloned())
        .map(|part| bash_single_quote(&part))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Full `wsl.exe` argv that runs a CommandSpec inside a distro. The spec's env is
/// intentionally dropped — Windows-shaped env/PATH must never leak into the distro.
pub fn wsl_runner_argv(distro: &str, command: &CommandSpec) -> Vec<String> {
    let command_line = shell_join(&command.program, &command.args);
    wsl_bash_lc_argv(
        distro,
        &format!("{WSL_USER_CLI_PATH_SETUP}; exec {command_line}"),
    )
}

/// `wsl.exe` argv that TERMs the in-distro sidecar via its pidfile (written by
/// `sidecar::build_wsl_launch_script`). The pidfile holds aop's real Linux PID, so this
/// reaches the actual server — killing only the wsl.exe relay would orphan it.
pub fn wsl_kill_argv(distro: &str) -> Vec<String> {
    wsl_bash_script_argv(
        distro,
        "pidfile=\"$HOME/.aop/desktop-sidecar.pid\"; pid=$(cat \"$pidfile\" 2>/dev/null || true); case \"$pid\" in (*[!0-9]*|'') ;; (*) exe=$(readlink \"/proc/$pid/exe\" 2>/dev/null || true); case \"$exe\" in (\"$HOME/.aop/desktop-runtime/\"*/aop) kill -TERM \"$pid\" 2>/dev/null || true ;; esac ;; esac; rm -f \"$pidfile\"",
    )
}

/// CommandRunner that executes setup-detection commands inside a WSL distro via wsl.exe.
pub struct WslCommandRunner {
    pub distro: String,
}

impl CommandRunner for WslCommandRunner {
    fn run(&self, command: &CommandSpec) -> CommandOutput {
        let mut wsl = Command::new("wsl.exe");
        wsl.args(wsl_runner_argv(&self.distro, command));
        crate::platform::hide_console_window(&mut wsl);
        match wsl.output() {
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

/// Execution mode selected during setup, persisted as `AOP_EXEC_HOST`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ExecHostMode {
    Native,
    Wsl(String),
}

pub fn parse_exec_host(value: &str) -> ExecHostMode {
    match value.trim().strip_prefix("wsl:") {
        Some(distro) if !distro.is_empty() => ExecHostMode::Wsl(distro.to_string()),
        _ => ExecHostMode::Native,
    }
}

pub fn format_exec_host(mode: &ExecHostMode) -> String {
    match mode {
        ExecHostMode::Native => "native".to_string(),
        ExecHostMode::Wsl(distro) => format!("wsl:{distro}"),
    }
}

pub fn resolve_windows_exec_host(
    current: &ExecHostMode,
    distros: &[WslDistro],
) -> Option<ExecHostMode> {
    if let ExecHostMode::Wsl(selected) = current
        && distros.iter().any(|distro| distro.name == *selected)
    {
        return Some(current.clone());
    }

    distros
        .iter()
        .find(|distro| distro.is_default)
        .or_else(|| distros.first())
        .map(|distro| ExecHostMode::Wsl(distro.name.clone()))
}

/// `<home>/.aop/exec-host` (`%USERPROFILE%\.aop\exec-host` on Windows). Pure for testing.
pub fn exec_host_config_path(
    platform: Platform,
    home: Option<&str>,
    userprofile: Option<&str>,
) -> Option<PathBuf> {
    let base = match platform {
        Platform::Unix => home,
        Platform::Windows => userprofile.or(home),
    }?;
    Some(PathBuf::from(base).join(".aop").join("exec-host"))
}

fn config_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").and_then(|value| value.into_string().ok());
    let userprofile = std::env::var_os("USERPROFILE").and_then(|value| value.into_string().ok());
    exec_host_config_path(Platform::current(), home.as_deref(), userprofile.as_deref())
}

/// Resolve the execution mode: an explicit `AOP_EXEC_HOST` env override wins, else the
/// persisted file, else Native. We persist to a file (not `set_var`) so the value survives
/// across processes and we never mutate process-global env (unsafe under edition 2024).
pub fn load_exec_host() -> ExecHostMode {
    if let Some(value) = std::env::var("AOP_EXEC_HOST")
        .ok()
        .filter(|value| !value.trim().is_empty())
    {
        return parse_exec_host(&value);
    }
    if let Some(content) = config_path().and_then(|path| std::fs::read_to_string(path).ok()) {
        return parse_exec_host(&content);
    }
    ExecHostMode::Native
}

pub fn save_exec_host(mode: &ExecHostMode) -> Result<(), String> {
    let path =
        config_path().ok_or_else(|| "Could not resolve the AOP home directory.".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(&path, format_exec_host(mode)).map_err(|error| error.to_string())
}

/// Enumerate installed WSL2 distros. Windows-only at runtime.
pub fn list_wsl_distros() -> Result<Vec<WslDistro>, String> {
    let mut wsl = Command::new("wsl.exe");
    wsl.args(["--list", "--verbose"]).env("WSL_UTF8", "1");
    crate::platform::hide_console_window(&mut wsl);
    let output = wsl
        .output()
        .map_err(|_| "WSL is not installed or wsl.exe is unavailable.".to_string())?;
    if !output.status.success() {
        return Err("Could not list WSL distros. Is WSL installed?".to_string());
    }
    Ok(parse_wsl_list_verbose(&decode_wsl_output(&output.stdout)))
}
