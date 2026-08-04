// Release builds run as a GUI (windows) subsystem app so Windows does NOT allocate a console
// window alongside the desktop UI. Without this the binary is a console-subsystem exe and a
// black terminal window (titled with the exe path) opens next to the app. Left as the default
// console subsystem in debug builds so `tauri dev` keeps printing logs to the terminal.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    aop_desktop_lib::run();
}
