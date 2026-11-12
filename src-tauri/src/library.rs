//! Library files on disk: library.json plus copies of every sound and image under
//! %APPDATA%/com.danyalrez.resonance/{sounds,images}. The JSON schema is owned by the frontend.

use crate::es;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub struct LibDir(pub PathBuf);

/// Resolves a library-relative path ("sounds/x.mp3"), refusing anything that could escape the library.
pub fn safe(lib: &Path, rel: &str) -> Result<PathBuf, String> {
  let ok = match rel.split_once('/') {
    Some((dir, name)) => {
      (dir == "sounds" || dir == "images")
        && !name.is_empty()
        && !name.starts_with('.')
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
    }
    None => false,
  };
  if ok {
    Ok(lib.join(rel))
  } else {
    Err(format!("Chemin refusé : {rel}"))
  }
}

fn unique(ext: &str) -> String {
  static N: AtomicU64 = AtomicU64::new(0);
  let t = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_nanos());
  format!("{t:x}{:x}.{ext}", N.fetch_add(1, Ordering::Relaxed))
}

/// Copies a user file into the library and returns its relative path.
pub fn copy_in(lib: &Path, src: &Path, dir: &str) -> Result<String, String> {
  let mut ext: String = src
    .extension()
    .and_then(|e| e.to_str())
    .unwrap_or("")
    .to_ascii_lowercase()
    .chars()
    .filter(|c| c.is_ascii_alphanumeric())
    .collect();
  if ext.is_empty() {
    ext = "bin".into();
  }
  let rel = format!("{dir}/{}", unique(&ext));
  fs::copy(src, lib.join(&rel)).map_err(|e| format!("Copie impossible : {e}"))?;
  Ok(rel)
}

pub fn load(lib: &Path) -> Option<String> {
  let p = lib.join("library.json");
  let s = fs::read_to_string(&p).ok()?;
  if serde_json::from_str::<serde_json::Value>(&s).is_ok() {
    return Some(s);
  }
  // never overwrite a library we cannot read: set it aside for manual recovery
  let _ = fs::rename(&p, lib.join(format!("library.corrupt-{}.json", unique("x").trim_end_matches(".x"))));
  None
}

pub fn save(lib: &Path, json: &str) -> Result<(), String> {
  let tmp = lib.join("library.json.tmp");
  fs::write(&tmp, json).map_err(es)?;
  fs::rename(&tmp, lib.join("library.json")).map_err(es) // atomic: a crash never leaves a half-written library
}

pub fn export(lib: &Path, dest: &Path, board: &str, files: &[String]) -> Result<(), String> {
  let mut z = zip::ZipWriter::new(File::create(dest).map_err(es)?);
  let opts = zip::write::SimpleFileOptions::default();
  z.start_file("board.json", opts).map_err(es)?;
  z.write_all(board.as_bytes()).map_err(es)?;
  for rel in files {
    let p = safe(lib, rel)?;
    if p.exists() {
      // audio is already compressed: store as-is
      z.start_file(rel.as_str(), opts.compression_method(zip::CompressionMethod::Stored)).map_err(es)?;
      std::io::copy(&mut File::open(p).map_err(es)?, &mut z).map_err(es)?;
    }
  }
  z.finish().map_err(es)?;
  Ok(())
}

pub fn import(lib: &Path, src: &Path) -> Result<String, String> {
  let mut a = zip::ZipArchive::new(File::open(src).map_err(es)?).map_err(|_| "Fichier de soundboard invalide.".to_string())?;
  let mut json = None;
  for i in 0..a.len() {
    let mut e = a.by_index(i).map_err(es)?;
    let name = e.name().to_string();
    if name == "board.json" {
      let mut s = String::new();
      e.read_to_string(&mut s).map_err(es)?;
      json = Some(s);
    } else if let Ok(p) = safe(lib, &name) {
      if !p.exists() {
        std::io::copy(&mut e, &mut File::create(p).map_err(es)?).map_err(es)?;
      }
    }
  }
  json.ok_or("Fichier de soundboard invalide (board.json manquant).".into())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn safe_rejects_escapes() {
    let lib = Path::new("C:/lib");
    assert!(safe(lib, "sounds/abc.mp3").is_ok());
    assert!(safe(lib, "images/a-b_c.png").is_ok());
    for bad in ["../x.mp3", "sounds/../x", "sounds/..", "other/x.mp3", "sounds/a/b.mp3", "C:/x.mp3", "sounds/", "sounds\\x"] {
      assert!(safe(lib, bad).is_err(), "{bad}");
    }
  }
}
