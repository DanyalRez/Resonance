mod audio;
mod decode;
mod library;

use audio::{AudioConfig, AudioStatus, Devices, Engine};
use library::{safe, LibDir};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent, Wry};

type Eng<'a> = State<'a, Arc<Engine>>;

pub(crate) fn es<E: std::fmt::Display>(e: E) -> String {
  e.to_string()
}

#[derive(Serialize)]
struct Imported {
  name: String,
  file: Option<String>,
  error: Option<String>,
}

#[derive(Serialize)]
struct TestResult {
  ok: bool,
  peak: f32,
  message: String,
}

#[tauri::command]
fn library_dir(lib: State<LibDir>) -> String {
  lib.0.to_string_lossy().into_owned()
}

#[tauri::command]
fn load_library(lib: State<LibDir>) -> Option<String> {
  library::load(&lib.0)
}

#[tauri::command]
fn save_library(lib: State<LibDir>, json: String) -> Result<(), String> {
  library::save(&lib.0, &json)
}

/// Copies each file into the library and decodes it once, so only playable files get a button.
#[tauri::command]
async fn import_audio(lib: State<'_, LibDir>, engine: Eng<'_>, paths: Vec<String>) -> Result<Vec<Imported>, String> {
  Ok(
    paths
      .iter()
      .map(|p| {
        let src = Path::new(p);
        let name = src.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "Son".into());
        let res = library::copy_in(&lib.0, src, "sounds").and_then(|rel| {
          let abs = lib.0.join(&rel);
          match engine.clip(&abs) {
            Ok(_) => Ok(rel),
            Err(e) => {
              let _ = std::fs::remove_file(abs);
              Err(e)
            }
          }
        });
        match res {
          Ok(rel) => Imported { name, file: Some(rel), error: None },
          Err(e) => Imported { name, file: None, error: Some(e) },
        }
      })
      .collect(),
  )
}

#[tauri::command]
async fn import_image(lib: State<'_, LibDir>, path: String) -> Result<String, String> {
  library::copy_in(&lib.0, Path::new(&path), "images")
}

#[tauri::command]
fn delete_files(lib: State<LibDir>, files: Vec<String>) {
  for f in files {
    if let Ok(p) = safe(&lib.0, &f) {
      let _ = std::fs::remove_file(p);
    }
  }
}

#[tauri::command]
fn missing_files(lib: State<LibDir>, files: Vec<String>) -> Vec<String> {
  files.into_iter().filter(|f| safe(&lib.0, f).map_or(true, |p| !p.exists())).collect()
}

/// Decodes short sounds in the background so the first click is instant.
#[tauri::command]
fn preload(lib: State<LibDir>, engine: Eng, files: Vec<String>) {
  let lib = lib.0.clone();
  let engine = engine.inner().clone();
  std::thread::spawn(move || {
    for f in files {
      if let Ok(p) = safe(&lib, &f) {
        if p.metadata().map_or(false, |m| m.len() < 4 << 20) {
          let _ = engine.clip(&p);
        }
      }
    }
  });
}

#[tauri::command]
fn list_devices() -> Devices {
  audio::list_devices()
}

#[tauri::command]
async fn configure_audio(engine: Eng<'_>, cfg: AudioConfig) -> Result<AudioStatus, String> {
  Ok(engine.configure(cfg))
}

#[tauri::command]
fn set_levels(engine: Eng, master: f32, monitor_gain: f32, mic_gain: f32) {
  engine.set_levels(master, monitor_gain, mic_gain);
}

#[tauri::command]
async fn play(
  lib: State<'_, LibDir>,
  engine: Eng<'_>,
  id: String,
  file: String,
  gain: f32,
  looping: bool,
  exclusive: bool,
) -> Result<f64, String> {
  let p = safe(&lib.0, &file)?;
  if !p.exists() {
    return Err("Fichier introuvable : remplacez ce son.".into());
  }
  engine.play(id, &p, gain, looping, exclusive)
}

#[tauri::command]
fn stop(engine: Eng, id: String) {
  engine.stop(&id);
}

#[tauri::command]
fn pause(engine: Eng, id: String, paused: bool) {
  engine.pause(&id, paused);
}

#[tauri::command]
fn seek(engine: Eng, id: String, delta: f64) {
  engine.seek(&id, delta);
}

#[derive(Deserialize)]
struct Fav {
  id: String,
  label: String,
}

fn tray_menu(app: &AppHandle, favs: &[Fav]) -> tauri::Result<Menu<Wry>> {
  let m = Menu::new(app)?;
  if favs.is_empty() {
    m.append(&MenuItem::with_id(app, "none", "Aucun favori (étoile dans l'éditeur d'un son)", false, None::<&str>)?)?;
  }
  for f in favs {
    m.append(&MenuItem::with_id(app, format!("fav:{}", f.id), &f.label, true, None::<&str>)?)?;
  }
  m.append(&PredefinedMenuItem::separator(app)?)?;
  m.append(&MenuItem::with_id(app, "stop", "Tout arrêter", true, None::<&str>)?)?;
  m.append(&MenuItem::with_id(app, "show", "Ouvrir Resonance", true, None::<&str>)?)?;
  m.append(&MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?)?;
  Ok(m)
}

/// Rebuilds the tray menu with the user's favourites (max 5, chosen in the frontend).
#[tauri::command]
fn set_tray(app: AppHandle, favs: Vec<Fav>) -> Result<(), String> {
  if let Some(t) = app.tray_by_id("main") {
    t.set_menu(Some(tray_menu(&app, &favs).map_err(es)?)).map_err(es)?;
  }
  Ok(())
}

fn show_main(app: &AppHandle) {
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();
  }
}

#[tauri::command]
fn stop_all(engine: Eng) {
  engine.stop_all();
}

#[tauri::command]
async fn test_route(engine: Eng<'_>) -> Result<TestResult, String> {
  Ok(match engine.test() {
    Ok(peak) if peak > 0.02 => TestResult {
      ok: true,
      peak,
      message: "Signal reçu dans le câble : ce que vous jouez arrive bien à l'entrée que Discord utilise.".into(),
    },
    Ok(peak) => TestResult {
      ok: false,
      peak,
      message: "Aucun signal reçu dans le câble. Vérifiez que le volume général n'est pas à zéro et que le câble n'est pas coupé dans le mélangeur Windows.".into(),
    },
    Err(message) => TestResult { ok: false, peak: 0.0, message },
  })
}

#[tauri::command]
async fn export_board(lib: State<'_, LibDir>, dest: String, board: String, files: Vec<String>) -> Result<(), String> {
  library::export(&lib.0, Path::new(&dest), &board, &files)
}

#[tauri::command]
async fn import_board(lib: State<'_, LibDir>, src: String) -> Result<String, String> {
  library::import(&lib.0, Path::new(&src))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_global_shortcut::Builder::new().build())
    .setup(|app| {
      let dir = app.path().app_data_dir()?;
      for d in ["sounds", "images"] {
        std::fs::create_dir_all(dir.join(d))?;
      }
      app.manage(LibDir(dir));

      let engine = Engine::new();
      app.manage(engine.clone());
      let handle = app.handle().clone();
      std::thread::spawn(move || {
        let mut was_playing = false;
        loop {
          std::thread::sleep(Duration::from_millis(50));
          let snap = engine.tick();
          if was_playing || !snap.is_empty() {
            let _ = handle.emit("playback", &snap);
          }
          was_playing = !snap.is_empty();
        }
      });

      TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().ok_or("icône manquante")?)
        .tooltip("Resonance")
        .menu(&tray_menu(app.handle(), &[])?)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, e| match e.id().as_ref() {
          "stop" => app.state::<Arc<Engine>>().stop_all(),
          "show" => show_main(app),
          "quit" => app.exit(0),
          id => {
            if let Some(fav) = id.strip_prefix("fav:") {
              let _ = app.emit("tray-play", fav);
            }
          }
        })
        .build(app)?;

      // Frameless window: ask Windows 11 for its rounded corners back.
      #[cfg(windows)]
      if let Some(w) = app.get_webview_window("main") {
        use windows_sys::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND};
        if let Ok(hwnd) = w.hwnd() {
          let pref = DWMWCP_ROUND;
          unsafe {
            DwmSetWindowAttribute(
              hwnd.0 as _,
              DWMWA_WINDOW_CORNER_PREFERENCE as u32,
              &pref as *const _ as _,
              std::mem::size_of_val(&pref) as u32,
            );
          }
        }
      }
      Ok(())
    })
    // Closing the window keeps Resonance in the tray so hotkeys and favourites still work.
    .on_window_event(|w, e| {
      if let WindowEvent::CloseRequested { api, .. } = e {
        api.prevent_close();
        let _ = w.hide();
      }
    })
    .invoke_handler(tauri::generate_handler![
      library_dir,
      load_library,
      save_library,
      import_audio,
      import_image,
      delete_files,
      missing_files,
      preload,
      list_devices,
      configure_audio,
      set_levels,
      play,
      stop,
      pause,
      seek,
      set_tray,
      stop_all,
      test_route,
      export_board,
      import_board
    ])
    .run(tauri::generate_context!())
    .expect("error while running Resonance");
}
