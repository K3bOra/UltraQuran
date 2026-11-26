// Ultra Quran for Windows.
//
// The main window is the website itself (https://k3bora.github.io/UltraQuran/), so every update of the
// site reaches the program with nothing to reinstall. On top of the site the program adds what a web
// page cannot do on its own:
//   * it keeps running next to the clock (closing the window hides it) and starts with Windows;
//   * the adhan: the site hands over the next 30 days of prayer times through the same bridge the
//     Android app uses (window.UltraQuranNative.schedulePrayers), and the program plays the adhan at
//     its time in a premium card at the corner of the screen, even when the window is hidden;
//   * the muezzin's recording is kept on the computer, so the adhan also plays without internet.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

const SITE: &str = "https://k3bora.github.io/UltraQuran/";
const LATE_LIMIT_MS: i64 = 4 * 60 * 1000; // an adhan more than 4 minutes late (computer was asleep) is skipped
const CARD_W: f64 = 620.0;
const CARD_H: f64 = 330.0;

// window.UltraQuranNative for the site: the same calls as the Android app's bridge
const BRIDGE: &str = r#"
(() => {
  const call = (cmd, args) => {
    try { return window.__TAURI_INTERNALS__.invoke(cmd, args || {}).catch(() => {}); } catch (e) { return null; }
  };
  window.UltraQuranNative = {
    desktop: true,
    version: () => "windows-1.0.1",
    schedulePrayers: (json) => { call("schedule_prayers", { json: String(json) }); },
    clearPrayers: () => { call("clear_prayers"); },
    testAdhan: (name, url, seconds) => { call("test_adhan", { name: String(name || ""), url: String(url || ""), seconds: Number(seconds) || 5 }); },
    stopAdhan: () => { call("stop_adhan"); },
    playbackState: () => {},
    exactAlarms: () => true,
    batteryFree: () => true,
    openBatterySettings: () => {},
    openNotificationSettings: () => {},
  };
  // full screen like Ultra Stalker: no Windows title bar, so a small gold control strip slides down
  // from the top-left corner when the mouse reaches the top edge (F11 also toggles full screen)
  const css = `
    #uqwin { position: fixed; top: 0; left: 50%; z-index: 2147483647; display: flex; gap: 6px; padding: 7px 8px;
      transform: translate(-50%, -100%); transition: transform .22s ease; direction: rtl;
      background: linear-gradient(180deg, #0f3a36f2, #0a2c28f2); border: 1px solid #d9b36c88; border-top: 0;
      border-radius: 0 0 16px 16px; box-shadow: 0 10px 26px #0009; font: 600 13px "Cairo", "Segoe UI", sans-serif; }
    #uqwin.show { transform: translate(-50%, 0); }
    #uqwin button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px;
      border-radius: 999px; color: #fbf5e6; background: #ffffff12; border: 1px solid #ffffff1f; }
    #uqwin button:hover { background: #d9b36c; color: #1b140a; }
    #uqwin svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    #uqedge { position: fixed; top: 0; left: 0; right: 0; height: 6px; z-index: 2147483646; }`;
  const ico = {
    min: '<svg viewBox="0 0 24 24"><path d="M5 18h14"/></svg>',
    fs: '<svg viewBox="0 0 24 24"><path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7 7 17"/></svg>',
  };
  const build = () => {
    if (document.getElementById("uqwin")) return;
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    const edge = document.createElement("div"); edge.id = "uqedge";
    const bar = document.createElement("div"); bar.id = "uqwin";
    bar.innerHTML = `<button data-w="min">${ico.min}تصغير</button><button data-w="fs">${ico.fs}<span>خروج من ملء الشاشة</span></button><button data-w="hide">${ico.x}إخفاء جنب الساعة</button>`;
    document.body.append(edge, bar);
    let t = 0;
    const show = () => { clearTimeout(t); bar.classList.add("show"); };
    const hide = () => { t = setTimeout(() => bar.classList.remove("show"), 700); };
    edge.addEventListener("mouseenter", show);
    bar.addEventListener("mouseenter", show);
    bar.addEventListener("mouseleave", hide);
    bar.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-w]"); if (!b) return;
      const w = b.dataset.w;
      if (w === "min") call("win_minimize");
      if (w === "hide") call("win_hide");
      if (w === "fs") { const on = await call("win_toggle_fullscreen"); sync(on); }
      bar.classList.remove("show");
    });
  };
  const sync = (on) => {
    const bar = document.getElementById("uqwin"), edge = document.getElementById("uqedge");
    if (!bar) return;
    // out of full screen Windows draws its own title bar, so the strip is not needed
    bar.style.display = edge.style.display = on === false ? "none" : "";
  };
  window.addEventListener("keydown", async (e) => {
    if (e.key === "F11") { e.preventDefault(); sync(await call("win_toggle_fullscreen")); }
  }, true);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
  window.addEventListener("load", async () => { build(); sync(await call("win_is_fullscreen")); });
})();
"#;

#[derive(Clone, Serialize, Deserialize)]
struct Item {
    t: i64,
    #[serde(default)]
    k: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    url: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
struct Plan {
    #[serde(default)]
    city: String,
    #[serde(default)]
    items: Vec<Item>,
}

#[derive(Serialize, Deserialize, Default)]
struct Saved {
    #[serde(default)]
    plan: Plan,
    #[serde(default)]
    fired: Vec<String>,
}

struct AppState {
    dir: PathBuf,
    saved: Mutex<Saved>,
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn state_file(dir: &PathBuf) -> PathBuf {
    dir.join("prayers.json")
}

fn persist(state: &AppState) {
    if let Ok(saved) = state.saved.lock() {
        if let Ok(text) = serde_json::to_string(&*saved) {
            let tmp = state.dir.join("prayers.json.tmp");
            if fs::write(&tmp, text).is_ok() {
                let _ = fs::rename(&tmp, state_file(&state.dir));
            }
        }
    }
}

// ---------------------------------------------------------------- adhan recordings kept on the computer
fn cache_name(url: &str) -> String {
    // FNV-1a: a stable file name per recording
    let mut h: u64 = 0xcbf29ce484222325;
    for b in url.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{:016x}.mp3", h)
}

fn cached_path(dir: &PathBuf, url: &str) -> Option<PathBuf> {
    let path = dir.join("adhan").join(cache_name(url));
    match fs::metadata(&path) {
        Ok(m) if m.len() > 10_000 => Some(path),
        _ => None,
    }
}

fn cache_recordings(dir: PathBuf, urls: Vec<String>) {
    thread::spawn(move || {
        let folder = dir.join("adhan");
        let _ = fs::create_dir_all(&folder);
        for url in urls {
            if !url.starts_with("https://") || cached_path(&dir, &url).is_some() {
                continue;
            }
            let target = folder.join(cache_name(&url));
            let part = folder.join(format!("{}.part", cache_name(&url)));
            // Windows 10/11 ship curl.exe: no TLS library to carry inside the program
            let ok = (|| -> Option<()> {
                let mut cmd = std::process::Command::new("curl.exe");
                cmd.args(["-s", "-f", "-L", "--max-time", "180", "--max-filesize", "40000000", "-o"])
                    .arg(&part)
                    .arg(&url);
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flashing on screen
                }
                let status = cmd.status().ok()?;
                if !status.success() || fs::metadata(&part).ok()?.len() < 10_000 {
                    return None;
                }
                fs::rename(&part, &target).ok()
            })();
            if ok.is_none() {
                let _ = fs::remove_file(&part);
            }
        }
        // drop recordings the plan does not use any more
    });
}

// ---------------------------------------------------------------- the adhan card
fn show_card(app: &AppHandle, k: &str, name: &str, url: &str, at: i64, test: bool) {
    let state = app.state::<AppState>();
    let city = state.saved.lock().map(|s| s.plan.city.clone()).unwrap_or_default();
    let file = cached_path(&state.dir, url).map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
    let data = serde_json::json!({
        "k": k, "name": name, "url": url, "file": file, "city": city, "at": at, "test": test, "site": SITE,
    });
    let script = format!("window.__CARD = {};", data);
    if let Some(old) = app.get_webview_window("adhan") {
        let _ = old.destroy();
    }
    let builder = WebviewWindowBuilder::new(app, "adhan", WebviewUrl::App("adhan.html".into()))
        .title("أذان")
        .inner_size(CARD_W, CARD_H)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .initialization_script(&script)
        .additional_browser_args(BROWSER_ARGS);
    if let Ok(win) = builder.build() {
        // bottom corner of the screen, above the taskbar (left corner in an Arabic layout feels odd on
        // Windows, where notifications come from the right)
        if let Ok(Some(mon)) = win.primary_monitor() {
            let area = mon.work_area();
            let scale = mon.scale_factor();
            let w = (CARD_W * scale) as i32;
            let h = (CARD_H * scale) as i32;
            let margin = (14.0 * scale) as i32;
            let x = area.position.x + area.size.width as i32 - w - margin;
            let y = area.position.y + area.size.height as i32 - h - margin;
            let _ = win.set_position(PhysicalPosition::new(x, y));
        }
        let _ = win.set_size(LogicalSize::new(CARD_W, CARD_H));
        let _ = win.show();
    }
}

// one set of browser switches for every window (WebView2 needs the same set for all of them):
// sound may start without a click, and a hidden window keeps its timers
const BROWSER_ARGS: &str = "--autoplay-policy=no-user-gesture-required --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows";

fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

// ---------------------------------------------------------------- commands called by the site / the card
#[tauri::command]
fn schedule_prayers(app: AppHandle, json: String) -> Result<(), String> {
    let plan: Plan = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    let state = app.state::<AppState>();
    let urls: Vec<String> = {
        let mut seen = HashSet::new();
        plan.items.iter().filter(|i| seen.insert(i.url.clone())).map(|i| i.url.clone()).collect()
    };
    if let Ok(mut saved) = state.saved.lock() {
        saved.plan = plan;
    }
    persist(&state);
    cache_recordings(state.dir.clone(), urls);
    Ok(())
}

#[tauri::command]
fn clear_prayers(app: AppHandle) {
    let state = app.state::<AppState>();
    if let Ok(mut saved) = state.saved.lock() {
        saved.plan.items.clear();
    }
    persist(&state);
}

#[tauri::command]
fn test_adhan(app: AppHandle, name: String, url: String, seconds: u64) {
    let app2 = app.clone();
    let state = app.state::<AppState>();
    cache_recordings(state.dir.clone(), vec![url.clone()]);
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(seconds.clamp(1, 60)));
        show_card(&app2, "test", &name, &url, now_ms(), true);
    });
}

#[tauri::command]
fn stop_adhan(app: AppHandle) {
    if let Some(win) = app.get_webview_window("adhan") {
        let _ = win.destroy();
    }
}

#[tauri::command]
fn open_main(app: AppHandle) {
    show_main(&app);
}

#[tauri::command]
fn win_minimize(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.minimize();
    }
}

#[tauri::command]
fn win_hide(app: AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
}

#[tauri::command]
fn win_is_fullscreen(app: AppHandle) -> bool {
    app.get_webview_window("main").and_then(|w| w.is_fullscreen().ok()).unwrap_or(false)
}

#[tauri::command]
fn win_toggle_fullscreen(app: AppHandle) -> bool {
    if let Some(w) = app.get_webview_window("main") {
        let on = !w.is_fullscreen().unwrap_or(false);
        let _ = w.set_fullscreen(on);
        if !on {
            let _ = w.maximize();
        }
        return on;
    }
    false
}

// ---------------------------------------------------------------- the clock
fn start_scheduler(app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(5));
        let state = app.state::<AppState>();
        let now = now_ms();
        let due: Option<Item> = {
            let mut saved = match state.saved.lock() {
                Ok(s) => s,
                Err(_) => continue,
            };
            let hit = saved
                .plan
                .items
                .iter()
                .find(|i| now >= i.t && now - i.t < LATE_LIMIT_MS && !saved.fired.contains(&format!("{}{}", i.t, i.k)))
                .cloned();
            if let Some(item) = &hit {
                let id = format!("{}{}", item.t, item.k);
                saved.fired.push(id);
                let keep = saved.fired.len().saturating_sub(20);
                saved.fired.drain(..keep);
                // forget the past
                saved.plan.items.retain(|i| i.t > now - LATE_LIMIT_MS);
            }
            hit
        };
        if let Some(item) = due {
            persist(&state);
            show_card(&app, &item.k, &item.name, &item.url, item.t, false);
        }
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .invoke_handler(tauri::generate_handler![
            schedule_prayers, clear_prayers, test_adhan, stop_adhan, open_main,
            win_minimize, win_hide, win_is_fullscreen, win_toggle_fullscreen
        ])
        .setup(|app| {
            let dir = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("UltraQuran"));
            let _ = fs::create_dir_all(&dir);
            let saved: Saved = fs::read_to_string(state_file(&dir))
                .ok()
                .and_then(|t| serde_json::from_str(&t).ok())
                .unwrap_or_default();
            let first_run = !dir.join("first-run.done").exists();
            app.manage(AppState { dir: dir.clone(), saved: Mutex::new(saved) });

            // start with Windows (once, on the first run; the user can turn it off from the tray menu)
            if first_run {
                let _ = app.autolaunch().enable();
                let _ = fs::write(dir.join("first-run.done"), "1");
            }

            let minimized = std::env::args().any(|a| a == "--minimized");
            let main = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(SITE.parse().unwrap()))
                .title("ألترا قرآن")
                .inner_size(1280.0, 820.0)
                .min_inner_size(420.0, 600.0)
                .center()
                .fullscreen(true) // full screen like Ultra Stalker; F11 or the top strip leaves it
                .visible(!minimized)
                .initialization_script(BRIDGE)
                .additional_browser_args(BROWSER_ARGS)
                .build()?;
            let main2 = main.clone();
            main.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    // closing hides the program next to the clock; the adhan keeps working
                    api.prevent_close();
                    let _ = main2.hide();
                }
            });

            // tray icon next to the clock
            let open = MenuItem::with_id(app, "open", "افتح ألترا قرآن", true, None::<&str>)?;
            let auto_on = app.autolaunch().is_enabled().unwrap_or(false);
            let startup = MenuItem::with_id(
                app,
                "startup",
                if auto_on { "✓ يشتغل مع الويندوز" } else { "يشتغل مع الويندوز" },
                true,
                None::<&str>,
            )?;
            let stop = MenuItem::with_id(app, "stop", "إيقاف الأذان", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "خروج", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&open, &stop, &sep, &startup, &quit])?;
            let startup2 = startup.clone();
            TrayIconBuilder::with_id("tray")
                .icon(app.default_window_icon().cloned().expect("icon"))
                .tooltip("ألترا قرآن · الأذان شغال")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "open" => show_main(app),
                    "stop" => {
                        if let Some(win) = app.get_webview_window("adhan") {
                            let _ = win.destroy();
                        }
                    }
                    "startup" => {
                        let al = app.autolaunch();
                        let on = al.is_enabled().unwrap_or(false);
                        let _ = if on { al.disable() } else { al.enable() };
                        let _ = startup2.set_text(if on { "يشتغل مع الويندوز" } else { "✓ يشتغل مع الويندوز" });
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            start_scheduler(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Ultra Quran");
}
