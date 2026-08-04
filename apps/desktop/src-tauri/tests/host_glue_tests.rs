use std::path::{Path, PathBuf};

use aop_desktop_lib::platform::Platform;
use aop_desktop_lib::{
    browser_command, default_log_dir_from, default_log_dir_from_env, file_manager_command,
};

#[test]
fn sidecar_resource_name_is_exe_on_windows() {
    assert_eq!(Platform::Unix.sidecar_resource_name(), "aop");
    assert_eq!(Platform::Windows.sidecar_resource_name(), "aop.exe");
}

#[test]
fn default_log_dir_prefers_userprofile_on_windows() {
    assert_eq!(
        default_log_dir_from(Platform::Windows, None, Some("C:\\Users\\m")),
        Ok(PathBuf::from("C:\\Users\\m").join(".aop").join("logs"))
    );
    // Falls back to HOME on Windows if USERPROFILE is absent.
    assert_eq!(
        default_log_dir_from(Platform::Windows, Some("C:\\Users\\m"), None),
        Ok(PathBuf::from("C:\\Users\\m").join(".aop").join("logs"))
    );
}

#[test]
fn default_log_dir_unix_uses_home_and_errors_without_it() {
    assert_eq!(
        default_log_dir_from(Platform::Unix, Some("/home/u"), None),
        Ok(PathBuf::from("/home/u").join(".aop").join("logs"))
    );
    assert!(default_log_dir_from(Platform::Unix, None, Some("C:\\Users\\m")).is_err());
    assert!(default_log_dir_from(Platform::Windows, None, None).is_err());
}

#[test]
fn default_log_dir_uses_explicit_override_for_isolated_desktop_dev() {
    assert_eq!(
        default_log_dir_from_env(
            Platform::Unix,
            Some("/home/u"),
            None,
            Some("/tmp/aop-isolated/logs")
        ),
        Ok(PathBuf::from("/tmp/aop-isolated/logs"))
    );
}

#[test]
fn file_manager_command_is_explorer_on_windows() {
    let dir = Path::new("/tmp/logs");
    assert_eq!(
        file_manager_command(Platform::Unix, dir),
        ("open", PathBuf::from("/tmp/logs"))
    );
    assert_eq!(
        file_manager_command(Platform::Windows, dir),
        ("explorer.exe", PathBuf::from("/tmp/logs"))
    );
}

#[test]
fn browser_command_opens_urls_on_the_host_platform() {
    let url = "https://learn.chatgpt.com/docs/codex/cli?surface=cli#getting-started";
    let unix = browser_command(Platform::Unix, url);
    assert_eq!(unix.program, "open");
    assert_eq!(unix.args, [url]);

    let windows = browser_command(Platform::Windows, url);
    assert_eq!(windows.program, "rundll32.exe");
    assert_eq!(windows.args, ["url.dll,FileProtocolHandler", url]);
}
