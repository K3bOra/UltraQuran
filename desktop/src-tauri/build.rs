// The site runs from https://k3bora.github.io (a remote origin): Tauri only lets remote pages call the
// program's commands when they have permissions, so every command gets an allow-<name> permission here
// and capabilities/default.json grants them to the site and to the local adhan card.
const COMMANDS: &[&str] = &[
    "schedule_prayers",
    "clear_prayers",
    "test_adhan",
    "stop_adhan",
    "open_main",
    "win_minimize",
    "win_hide",
    "win_is_fullscreen",
    "win_toggle_fullscreen",
    "apply_update",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
