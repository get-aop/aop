//! Single runtime selector for OS-specific desktop behavior.
//!
//! `Platform::current` holds the ONLY compile-time OS read for *branching* in the crate;
//! every other OS-dependent decision branches on a `Platform` value so the Windows arms
//! stay unit-testable from a Linux/macOS host (and via `cargo check --target *-windows-msvc`).
//! The sole exception is `hide_console_window`, which must `cfg(windows)` because the
//! `CommandExt::creation_flags` API only exists on Windows; it stays a callable no-op on
//! other targets so call sites remain checkable everywhere.

use std::process::Command;

/// Stop a child process from flashing a console window on Windows (the aop sidecar,
/// `wsl.exe`, and `where`/`winget` setup probes all open consoles otherwise). Applies
/// `CREATE_NO_WINDOW`; a no-op on every other platform.
pub fn hide_console_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = command;
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Platform {
    Unix,
    Windows,
}

impl Platform {
    pub fn current() -> Self {
        if cfg!(windows) {
            Self::Windows
        } else {
            Self::Unix
        }
    }

    /// PATH entry separator: `:` on Unix, `;` on Windows.
    pub fn path_separator(self) -> char {
        match self {
            Self::Unix => ':',
            Self::Windows => ';',
        }
    }

    /// Executable suffix for the bundled sidecar resource: `""` on Unix, `.exe` on Windows.
    pub fn exe_suffix(self) -> &'static str {
        match self {
            Self::Unix => "",
            Self::Windows => ".exe",
        }
    }

    /// Bundled sidecar resource filename (prepare-tauri-sidecar emits `aop` / `aop.exe`).
    pub fn sidecar_resource_name(self) -> &'static str {
        match self {
            Self::Unix => "aop",
            Self::Windows => "aop.exe",
        }
    }
}
