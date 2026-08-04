use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

use aop_desktop_lib::platform::Platform;
use aop_desktop_lib::setup::CommandSpec;
use aop_desktop_lib::wsl::{
    ExecHostMode, WslDistro, bash_single_quote, decode_wsl_output, exec_host_config_path,
    format_exec_host, parse_exec_host, parse_wsl_list_verbose, resolve_windows_exec_host,
    shell_join, wsl_bash_lc_argv, wsl_bash_script_argv, wsl_kill_argv, wsl_runner_argv,
};

fn decode_wsl_script(argv: &[String]) -> String {
    let encoded = argv[5]
        .strip_prefix("printf %s ")
        .and_then(|value| value.strip_suffix(" | base64 -d | bash"))
        .expect("encoded WSL script command");
    String::from_utf8(BASE64.decode(encoded).expect("base64 WSL script")).expect("UTF-8 WSL script")
}

#[test]
fn wsl_kill_argv_targets_the_launch_script_pidfile() {
    let argv = wsl_kill_argv("Ubuntu");

    assert_eq!(argv[0..5], ["-d", "Ubuntu", "--", "bash", "-lc"]);
    // Pidfile path must match sidecar::build_wsl_launch_script.
    let script = decode_wsl_script(&argv);
    assert!(script.contains("$HOME/.aop/desktop-sidecar.pid"));
    assert!(script.contains("/proc/$pid/exe"));
    assert!(script.contains("$HOME/.aop/desktop-runtime/"));
    assert!(script.contains("kill -TERM"));
}

fn utf16le(text: &str, bom: bool) -> Vec<u8> {
    let mut bytes = Vec::new();
    if bom {
        bytes.extend_from_slice(&[0xFF, 0xFE]);
    }
    for unit in text.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    bytes
}

#[test]
fn decode_wsl_output_handles_utf16_and_utf8() {
    let text = "Ubuntu Running 2";
    assert_eq!(decode_wsl_output(&utf16le(text, true)), text);
    assert_eq!(decode_wsl_output(&utf16le(text, false)), text);
    assert_eq!(decode_wsl_output(text.as_bytes()), text);
}

#[test]
fn parse_wsl_list_verbose_skips_header_and_filters() {
    // Header + state words are localized, so the parser must not match on them.
    let text = "  NAME            STATE           VERSION\n\
                * Ubuntu          Running         2\n\
                  Debian          Stopped         2\n\
                  docker-desktop  Stopped         2\n\
                  Legacy          Running         1\n";

    let distros = parse_wsl_list_verbose(text);

    assert_eq!(
        distros,
        vec![
            WslDistro {
                name: "Ubuntu".to_string(),
                is_default: true,
                running: true,
                version: 2
            },
            WslDistro {
                name: "Debian".to_string(),
                is_default: false,
                running: false,
                version: 2
            },
        ]
    );
}

#[test]
fn wsl_argv_and_quoting() {
    assert_eq!(
        wsl_bash_lc_argv("Ubuntu", "git --version"),
        vec!["-d", "Ubuntu", "--", "bash", "-lc", "git --version"]
    );
    assert_eq!(bash_single_quote("a b"), "'a b'");
    assert_eq!(bash_single_quote("it's"), "'it'\\''s'");
    assert_eq!(
        shell_join("gh", &["auth".to_string(), "status".to_string()]),
        "'gh' 'auth' 'status'"
    );
}

#[test]
fn wsl_script_argv_prevents_wsl_from_expanding_shell_variables_early() {
    let argv = wsl_bash_script_argv("Ubuntu", "runtime=\"$HOME/aop\"; echo \"$runtime\"");

    assert_eq!(argv[0..5], ["-d", "Ubuntu", "--", "bash", "-lc"]);
    assert!(!argv[5].contains("$HOME"));
    assert!(!argv[5].contains("$runtime"));
    assert!(argv[5].contains("base64 -d | bash"));
    assert!(argv[5].contains("cnVudGltZT0iJEhPTUUvYW9wIjsgZWNobyAiJHJ1bnRpbWUi"));
}

#[test]
fn wsl_runner_argv_drops_env_and_quotes_command() {
    let spec = CommandSpec {
        program: "gh".to_string(),
        args: vec!["--version".to_string()],
        env: vec![("PATH".to_string(), "C:\\Windows".to_string())],
    };

    let argv = wsl_runner_argv("Ubuntu", &spec);

    assert_eq!(argv[0..5], ["-d", "Ubuntu", "--", "bash", "-lc"]);
    assert!(!argv[5].contains("C:\\Windows"));
    assert!(argv[5].ends_with("exec 'gh' '--version'"));
}

#[test]
fn wsl_runner_adds_common_user_cli_bins_before_runtime_probes() {
    let spec = CommandSpec::new("pi", &["--version"]);

    let argv = wsl_runner_argv("Ubuntu", &spec);
    let script = &argv[5];

    assert!(script.contains("$HOME/.opencode/bin"));
    assert!(script.contains("$HOME/.npm-global/bin"));
    assert!(script.contains(".nvm/versions/node/*/bin"));
    assert!(script.ends_with("exec 'pi' '--version'"));
}

#[test]
fn exec_host_mode_round_trips() {
    for raw in ["native", "", "wsl:Ubuntu", "wsl:My Distro"] {
        let mode = parse_exec_host(raw);
        assert_eq!(parse_exec_host(&format_exec_host(&mode)), mode);
    }
    assert_eq!(
        parse_exec_host("wsl:Ubuntu"),
        ExecHostMode::Wsl("Ubuntu".to_string())
    );
    assert_eq!(parse_exec_host("wsl:"), ExecHostMode::Native);
    assert_eq!(format_exec_host(&ExecHostMode::Native), "native");
}

#[test]
fn windows_exec_host_keeps_a_valid_wsl_selection_or_uses_the_default() {
    let distros = vec![
        WslDistro {
            name: "Ubuntu".to_string(),
            is_default: true,
            running: true,
            version: 2,
        },
        WslDistro {
            name: "Debian".to_string(),
            is_default: false,
            running: false,
            version: 2,
        },
    ];

    assert_eq!(
        resolve_windows_exec_host(&ExecHostMode::Wsl("Debian".to_string()), &distros),
        Some(ExecHostMode::Wsl("Debian".to_string()))
    );
    assert_eq!(
        resolve_windows_exec_host(&ExecHostMode::Native, &distros),
        Some(ExecHostMode::Wsl("Ubuntu".to_string()))
    );
    assert_eq!(resolve_windows_exec_host(&ExecHostMode::Native, &[]), None);
}

#[test]
fn exec_host_config_path_prefers_userprofile_on_windows() {
    assert_eq!(
        exec_host_config_path(Platform::Unix, Some("/home/u"), None),
        Some(
            std::path::PathBuf::from("/home/u")
                .join(".aop")
                .join("exec-host")
        )
    );
    assert_eq!(
        exec_host_config_path(Platform::Windows, None, Some("C:\\Users\\m")),
        Some(
            std::path::PathBuf::from("C:\\Users\\m")
                .join(".aop")
                .join("exec-host")
        )
    );
    assert_eq!(exec_host_config_path(Platform::Windows, None, None), None);
}
