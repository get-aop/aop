use std::path::PathBuf;

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

use aop_desktop_lib::sidecar::{
    LaunchMode, ShutdownPlan, SidecarFailure, SidecarHealth, SidecarPaths, SidecarPorts,
    build_sidecar_launch_config, build_sidecar_launch_config_with_dashboard_dev,
    build_wsl_launch_script, build_wsl_sidecar_launch_config, classify_sidecar_failure,
    is_valid_runtime_fingerprint, provision_managed_runtime_argv, release_known_wsl_runtime_argv,
    shutdown_plan, sidecar_spawn_argv, taskkill_argv, wait_for_sidecar_health,
};

fn decode_wsl_script(argv: &[String]) -> String {
    let encoded = argv[5]
        .strip_prefix("printf %s ")
        .and_then(|value| value.strip_suffix(" | base64 -d | bash"))
        .expect("encoded WSL script command");
    String::from_utf8(BASE64.decode(encoded).expect("base64 WSL script")).expect("UTF-8 WSL script")
}

#[test]
fn shutdown_plan_kills_in_distro_before_relay_for_wsl() {
    assert_eq!(
        shutdown_plan(&LaunchMode::Wsl {
            distro: "Ubuntu".to_string()
        }),
        ShutdownPlan::WslPidfileThenRelay {
            distro: "Ubuntu".to_string()
        }
    );
    // Native resolves per host: taskkill tree on Windows, kill+wait on Unix.
    let expected_native = if cfg!(windows) {
        ShutdownPlan::TaskkillTree
    } else {
        ShutdownPlan::UnixKillWait
    };
    assert_eq!(shutdown_plan(&LaunchMode::Native), expected_native);
}

#[test]
fn taskkill_argv_terminates_the_process_tree() {
    assert_eq!(taskkill_argv(1234), ["/T", "/F", "/PID", "1234"]);
}

#[test]
fn wsl_launch_config_runs_the_managed_runtime_without_windows_path() {
    let config = build_wsl_sidecar_launch_config("Ubuntu", "0.6.6", SidecarPorts::default());

    assert_eq!(
        config.mode,
        LaunchMode::Wsl {
            distro: "Ubuntu".to_string()
        }
    );
    assert_eq!(config.env_value("AOP_EXEC_HOST"), Some("wsl:Ubuntu"));
    assert_eq!(config.env_value("AOP_DESKTOP_MANAGED_RUNTIME"), Some("1"));
    assert_eq!(config.env_value("AOP_LOCAL_SERVER_PORT"), Some("25150"));
    assert_eq!(config.env_value("PATH"), None);
    assert_eq!(config.env_value("AOP_LOG_DIR"), None);
    assert_eq!(
        config.program,
        PathBuf::from(".aop/desktop-runtime/0.6.6/aop")
    );
    assert_eq!(config.health_url, "http://127.0.0.1:25150/api/health");
}

#[test]
fn sidecar_ports_can_be_overridden_for_local_desktop_dev() {
    let ports = SidecarPorts::from_env_values(Some("25260"), Some("25270"));

    assert_eq!(
        ports,
        SidecarPorts {
            local_server: 25260,
            dashboard: 25270
        }
    );
}

#[test]
fn sidecar_port_overrides_fall_back_when_invalid() {
    assert_eq!(
        SidecarPorts::from_env_values(Some("nope"), Some("0")),
        SidecarPorts::default()
    );
}

#[test]
fn native_spawn_argv_is_program_then_run() {
    let config = build_sidecar_launch_config(
        SidecarPaths {
            executable: PathBuf::from("/x/aop"),
            log_dir: PathBuf::from("/x/logs"),
        },
        SidecarPorts::default(),
    );

    assert_eq!(
        sidecar_spawn_argv(&config),
        ("/x/aop".to_string(), vec!["run".to_string()])
    );
}

#[test]
fn wsl_spawn_argv_wraps_a_bash_launch_script() {
    let config = build_wsl_sidecar_launch_config("Ubuntu", "0.6.6", SidecarPorts::default());
    let (program, args) = sidecar_spawn_argv(&config);

    assert_eq!(program, "wsl.exe");
    assert_eq!(args[0..5], ["-d", "Ubuntu", "--", "bash", "-lc"]);
    let script = decode_wsl_script(&args);
    assert!(
        script.starts_with(
            "mkdir -p \"$HOME/.aop\" && echo $$ > \"$HOME/.aop/desktop-sidecar.pid\" &&"
        )
    );
    assert!(script.contains("AOP_EXEC_HOST='wsl:Ubuntu'"));
    assert!(script.ends_with(
        "AOP_LOG_DIR=\"$HOME/.aop/logs\" exec \"$HOME\"/'.aop/desktop-runtime/0.6.6/aop' run"
    ));
    assert!(!script.contains("PATH="));
}

#[test]
fn wsl_launch_script_drops_windows_path_and_log_dir() {
    let env = vec![
        ("AOP_LOCAL_SERVER_PORT".to_string(), "25150".to_string()),
        ("PATH".to_string(), "C:\\Windows".to_string()),
        (
            "AOP_LOG_DIR".to_string(),
            "C:\\Users\\m\\.aop\\logs".to_string(),
        ),
    ];

    let script = build_wsl_launch_script(&env, &PathBuf::from(".aop/desktop-runtime/0.6.6/aop"));

    assert!(script.contains("AOP_LOCAL_SERVER_PORT='25150'"));
    assert!(!script.contains("C:\\Windows"));
    assert!(!script.contains("C:\\Users"));
    assert!(script.ends_with(
        "AOP_LOG_DIR=\"$HOME/.aop/logs\" exec \"$HOME\"/'.aop/desktop-runtime/0.6.6/aop' run"
    ));
}

#[test]
fn runtime_fingerprint_requires_a_sha256_hex_digest() {
    assert!(is_valid_runtime_fingerprint(&"a".repeat(64)));
    assert!(!is_valid_runtime_fingerprint("abc123"));
    assert!(!is_valid_runtime_fingerprint(&"Z".repeat(64)));
}

#[test]
fn provision_argv_installs_the_bundled_runtime_atomically() {
    let argv = provision_managed_runtime_argv(
        "Ubuntu",
        "0.6.6",
        r"C:\Program Files\AOP\aop-linux-x64",
        r"C:\Program Files\AOP\runtime-assets.tar.gz",
        "abc123",
    );

    assert_eq!(argv[0..5], ["-d", "Ubuntu", "--", "bash", "-lc"]);
    let script = decode_wsl_script(&argv);
    assert!(script.contains("runtime=\"$HOME/.aop/desktop-runtime\"/'0.6.6'"));
    assert!(script.contains("wslpath -u 'C:\\Program Files\\AOP\\aop-linux-x64'"));
    assert!(script.contains("wslpath -u 'C:\\Program Files\\AOP\\runtime-assets.tar.gz'"));
    assert!(script.contains("tar -xzf"));
    assert!(script.contains("runtime.previous"));
    assert!(script.contains("runtime installation is already in progress"));
    assert!(script.contains("abc123"));
    assert!(!script.contains("command -v aop"));
    assert!(!script.contains("install.sh"));
}

#[test]
fn release_known_runtime_stops_only_managed_and_legacy_aop_services() {
    let argv = release_known_wsl_runtime_argv("Ubuntu");

    assert_eq!(argv[0..5], ["-d", "Ubuntu", "--", "bash", "-lc"]);
    let script = decode_wsl_script(&argv);
    assert!(script.contains("systemctl --user stop aop-local-server.service"));
    assert!(script.contains("desktop-sidecar.pid"));
    assert!(script.contains("/proc/$pid/exe"));
    assert!(script.contains("$HOME/.aop/desktop-runtime/"));
    assert!(!script.contains("fuser"));
    assert!(!script.contains("pkill"));
}

#[test]
fn classify_sidecar_failure_truth_table() {
    assert_eq!(
        classify_sidecar_failure(true, false),
        SidecarFailure::Healthy
    );
    assert_eq!(
        classify_sidecar_failure(false, true),
        SidecarFailure::LocalhostForwardingBlocked
    );
    assert_eq!(
        classify_sidecar_failure(false, false),
        SidecarFailure::SidecarNeverStarted
    );
}

#[test]
fn launch_config_starts_aop_foreground_with_desktop_ports() {
    let config = build_sidecar_launch_config(
        SidecarPaths {
            executable: PathBuf::from("/Applications/AOP.app/Contents/MacOS/aop"),
            log_dir: PathBuf::from("/Users/test/.aop/logs"),
        },
        SidecarPorts::default(),
    );

    assert_eq!(
        config.program,
        PathBuf::from("/Applications/AOP.app/Contents/MacOS/aop")
    );
    assert_eq!(config.args, vec!["run"]);
    assert_eq!(config.env_value("AOP_LOCAL_SERVER_PORT"), Some("25150"));
    assert_eq!(config.env_value("AOP_DASHBOARD_PORT"), Some("25160"));
    assert_eq!(
        config.env_value("AOP_LOG_DIR"),
        Some("/Users/test/.aop/logs")
    );
    assert_eq!(
        config.env_value("AOP_LOCAL_SERVER_URL"),
        Some("http://127.0.0.1:25150")
    );
    assert_eq!(
        config.env_value("AOP_DASHBOARD_URL"),
        Some("http://127.0.0.1:25150")
    );
    assert_eq!(config.health_url, "http://127.0.0.1:25150/api/health");
    assert_eq!(config.dashboard_url, "http://127.0.0.1:25150/?aopDesktop=1");
}

#[test]
fn launch_config_can_open_dashboard_dev_server_for_isolated_desktop_dev() {
    let config = build_sidecar_launch_config_with_dashboard_dev(
        SidecarPaths {
            executable: PathBuf::from("/Applications/AOP.app/Contents/MacOS/aop"),
            log_dir: PathBuf::from("/Users/test/.aop/logs"),
        },
        SidecarPorts {
            local_server: 25360,
            dashboard: 25370,
        },
        true,
    );

    assert_eq!(
        config.env_value("AOP_DASHBOARD_URL"),
        Some("http://127.0.0.1:25370")
    );
    assert_eq!(config.env_value("NODE_ENV"), Some("development"));
    assert_eq!(config.health_url, "http://127.0.0.1:25360/api/health");
    assert_eq!(config.dashboard_url, "http://127.0.0.1:25370/?aopDesktop=1");
}

#[test]
fn launch_config_injects_gui_safe_path_for_brew_resolvable_binaries() {
    let config = build_sidecar_launch_config(
        SidecarPaths {
            executable: PathBuf::from("/Applications/AOP.app/Contents/MacOS/aop"),
            log_dir: PathBuf::from("/Users/test/.aop/logs"),
        },
        SidecarPorts::default(),
    );

    let path = config.env_value("PATH").expect(
        "sidecar launch config must inject a PATH so spawned processes resolve Homebrew binaries",
    );
    assert!(
        path.contains("/opt/homebrew/bin"),
        "sidecar PATH must include Homebrew locations so the local server can resolve tools like gh; got: {path}"
    );
}

#[test]
fn health_wait_returns_ready_when_probe_succeeds() {
    let health = StepHealth {
        values: vec![false, true],
    };

    let state = wait_for_sidecar_health(&health, "http://127.0.0.1:25150/api/health", 3);

    assert_eq!(state.status, "ready");
    assert_eq!(
        state.dashboard_url,
        Some("http://127.0.0.1:25150/".to_string())
    );
}

#[test]
fn health_wait_returns_failed_after_last_probe() {
    let health = StepHealth {
        values: vec![false, false, false],
    };

    let state = wait_for_sidecar_health(&health, "http://127.0.0.1:25150/api/health", 3);

    assert_eq!(state.status, "failed");
    assert_eq!(
        state.message,
        Some("The AOP local server did not become healthy.".to_string())
    );
}

struct StepHealth {
    values: Vec<bool>,
}

impl SidecarHealth for StepHealth {
    fn is_healthy(&self, attempt: usize, _health_url: &str) -> bool {
        self.values.get(attempt).copied().unwrap_or(false)
    }
}
