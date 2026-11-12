//! Audio engine. Sounds are mixed into two outputs at once:
//! - MONITOR: the user's headphones, so they hear their own sounds;
//! - CABLE: a virtual cable (VB-CABLE) that Discord uses as microphone. The real
//!   microphone is mixed into this output too, so voice and sounds reach Discord together.

use crate::decode::{decode, Clip};
use crate::es;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, SampleFormat, SizedSample};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex, MutexGuard};
use std::time::Duration;

const MONITOR: usize = 0;
const CABLE: usize = 1;
const TEST_ID: &str = "__test__";
const CACHE_BUDGET: usize = 512 << 20;

struct Voice {
  id: String,
  clip: Arc<Clip>,
  gain: f32,
  looping: bool,
  bypass_master: bool,
  targets: [bool; 2],
  cursor: [f64; 2], // read position per output, in source frames (outputs run on separate clocks)
  done: [bool; 2],
  paused: bool,
}

impl Voice {
  fn new(id: String, clip: Arc<Clip>, gain: f32, looping: bool) -> Self {
    Voice { id, clip, gain, looping, bypass_master: false, targets: [true; 2], cursor: [0.0; 2], done: [false; 2], paused: false }
  }

  fn finished(&self, live: [bool; 2]) -> bool {
    if self.paused {
      return false;
    }
    (0..2).all(|w| !live[w] || !self.targets[w] || self.done[w])
  }

  /// 1.3 s rising beep used by the transmission test.
  fn tone() -> Self {
    let rate = 48_000u32;
    let n = rate as usize * 13 / 10;
    let mut data = Vec::with_capacity(n * 2);
    let mut phase = 0f64;
    for i in 0..n {
      let t = i as f64 / n as f64;
      phase += (440.0 + 440.0 * t) / rate as f64;
      let env = (t * 20.0).min(1.0).min((1.0 - t) * 20.0);
      let s = ((phase * std::f64::consts::TAU).sin() * 0.5 * env) as f32;
      data.push(s);
      data.push(s);
    }
    let mut v = Voice::new(TEST_ID.into(), Arc::new(Clip { data, rate }), 1.0, false);
    v.bypass_master = true;
    v
  }
}

pub struct Mixer {
  voices: Vec<Voice>,
  master: f32,
  monitor_gain: f32,
  mic_gain: f32,
  mic_on: bool,
  mic_muted: bool,
  live: [bool; 2],
  mic: VecDeque<f32>,
  mic_rate: u32,
  mic_primed: bool,
  mic_phase: f64,
  mic_prev: f32,
  mic_cur: f32,
}

impl Default for Mixer {
  fn default() -> Self {
    Mixer {
      voices: Vec::new(),
      master: 0.8,
      monitor_gain: 1.0,
      mic_gain: 1.0,
      mic_on: false,
      mic_muted: false,
      live: [false; 2],
      mic: VecDeque::new(),
      mic_rate: 48_000,
      mic_primed: false,
      mic_phase: 0.0,
      mic_prev: 0.0,
      mic_cur: 0.0,
    }
  }
}

#[inline]
fn put(out: &mut [f32], f: usize, ch: usize, l: f32, r: f32) {
  if ch == 1 {
    out[f] += (l + r) * 0.5;
  } else {
    out[f * ch] += l;
    out[f * ch + 1] += r;
  }
}

impl Mixer {
  fn render(&mut self, out: &mut [f32], ch: usize, rate: u32, w: usize) {
    out.fill(0.0);
    let frames = out.len() / ch;
    let bus = if w == MONITOR { self.monitor_gain } else { 1.0 };
    for v in self.voices.iter_mut() {
      if !v.targets[w] || v.done[w] || v.paused {
        continue;
      }
      let d = &v.clip.data;
      let len = v.clip.frames();
      let step = v.clip.rate as f64 / rate as f64;
      let g = v.gain * bus * if v.bypass_master { 1.0 } else { self.master };
      let mut c = v.cursor[w];
      for f in 0..frames {
        if c >= len as f64 {
          if !v.looping {
            break;
          }
          c %= len as f64;
        }
        // linear interpolation: cheap resampling to the device rate
        let i = c as usize;
        let t = (c - i as f64) as f32;
        let j = if i + 1 < len { i + 1 } else if v.looping { 0 } else { i };
        let l = d[i * 2] + (d[j * 2] - d[i * 2]) * t;
        let r = d[i * 2 + 1] + (d[j * 2 + 1] - d[i * 2 + 1]) * t;
        put(out, f, ch, l * g, r * g);
        c += step;
      }
      v.cursor[w] = c;
      if !v.looping && c >= len as f64 {
        v.done[w] = true;
      }
    }
    if w == CABLE && self.mic_on {
      self.mix_mic(out, ch, rate);
    }
    // soft knee instead of hard clipping when several loud sounds overlap
    for s in out.iter_mut() {
      let a = s.abs();
      if a > 0.9 {
        *s = s.signum() * (0.9 + 0.1 * ((a - 0.9) / 0.1).tanh());
      }
    }
  }

  fn mix_mic(&mut self, out: &mut [f32], ch: usize, rate: u32) {
    let r = self.mic_rate as usize;
    let ms = |n: usize| r * n / 1000;
    // mic and cable run on different clocks: drop backlog so latency never creeps up
    if self.mic.len() > ms(120) {
      let n = self.mic.len() - ms(40);
      self.mic.drain(..n);
    }
    if !self.mic_primed {
      if self.mic.len() < ms(20) {
        return;
      }
      self.mic_primed = true;
    }
    let step = self.mic_rate as f64 / rate as f64;
    let g = if self.mic_muted { 0.0 } else { self.mic_gain };
    for f in 0..out.len() / ch {
      self.mic_phase += step;
      while self.mic_phase >= 1.0 {
        self.mic_phase -= 1.0;
        self.mic_prev = self.mic_cur;
        match self.mic.pop_front() {
          Some(s) => self.mic_cur = s,
          None => {
            self.mic_primed = false;
            return;
          }
        }
      }
      let s = (self.mic_prev + (self.mic_cur - self.mic_prev) * self.mic_phase as f32) * g;
      put(out, f, ch, s, s);
    }
  }
}

fn lock(m: &Mutex<Mixer>) -> MutexGuard<'_, Mixer> {
  m.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Deserialize)]
pub struct AudioConfig {
  pub monitor: Option<String>,
  pub cable: Option<String>,
  pub mic: Option<String>,
  pub mic_enabled: bool,
}

#[derive(Serialize, Default)]
pub struct AudioStatus {
  pub monitor: Option<String>,
  pub cable: Option<String>,
  pub mic: Option<String>,
  pub errors: Vec<String>,
}

#[derive(Serialize)]
pub struct Devices {
  outputs: Vec<String>,
  inputs: Vec<String>,
  default_output: Option<String>,
  default_input: Option<String>,
}

#[derive(Serialize)]
pub struct Playing {
  id: String,
  pos: f64,
  dur: f64,
  paused: bool,
}

pub fn list_devices() -> Devices {
  let h = cpal::default_host();
  Devices {
    outputs: h.output_devices().map(|it| it.filter_map(|d| d.name().ok()).collect()).unwrap_or_default(),
    inputs: h.input_devices().map(|it| it.filter_map(|d| d.name().ok()).collect()).unwrap_or_default(),
    default_output: h.default_output_device().and_then(|d| d.name().ok()),
    default_input: h.default_input_device().and_then(|d| d.name().ok()),
  }
}

enum Cmd {
  Configure(AudioConfig, mpsc::Sender<AudioStatus>),
  Test(mpsc::Sender<Result<f32, String>>),
}

pub struct Engine {
  mixer: Arc<Mutex<Mixer>>,
  tx: Mutex<mpsc::Sender<Cmd>>,
  cache: Mutex<(HashMap<PathBuf, Arc<Clip>>, usize)>,
}

impl Engine {
  pub fn new() -> Arc<Self> {
    let mixer = Arc::new(Mutex::new(Mixer::default()));
    let (tx, rx) = mpsc::channel();
    let m = mixer.clone();
    // cpal streams are not Send: one thread owns them for the whole app lifetime
    std::thread::spawn(move || audio_thread(m, rx));
    Arc::new(Engine { mixer, tx: Mutex::new(tx), cache: Mutex::new((HashMap::new(), 0)) })
  }

  pub fn configure(&self, cfg: AudioConfig) -> AudioStatus {
    let (tx, rx) = mpsc::channel();
    if self.tx.lock().unwrap().send(Cmd::Configure(cfg, tx)).is_ok() {
      if let Ok(st) = rx.recv() {
        return st;
      }
    }
    AudioStatus { errors: vec!["Moteur audio indisponible.".into()], ..Default::default() }
  }

  /// Plays a beep into the cable and listens to its recording side: the peak it hears.
  pub fn test(&self) -> Result<f32, String> {
    let (tx, rx) = mpsc::channel();
    self.tx.lock().unwrap().send(Cmd::Test(tx)).map_err(es)?;
    rx.recv().map_err(es)?
  }

  pub fn clip(&self, path: &Path) -> Result<Arc<Clip>, String> {
    if let Some(c) = self.cache.lock().unwrap().0.get(path) {
      return Ok(c.clone());
    }
    let c = Arc::new(decode(path)?);
    let mut cache = self.cache.lock().unwrap();
    let size = c.data.len() * 4;
    // shortcut: the whole cache is dropped past 512 MB of decoded audio; switch to LRU if big music libraries become common
    if cache.1 + size > CACHE_BUDGET {
      cache.0.clear();
      cache.1 = 0;
    }
    cache.1 += size;
    cache.0.insert(path.to_path_buf(), c.clone());
    Ok(c)
  }

  pub fn play(&self, id: String, path: &Path, gain: f32, looping: bool, exclusive: bool) -> Result<f64, String> {
    let clip = self.clip(path)?;
    let dur = clip.secs();
    let mut m = lock(&self.mixer);
    if !m.live[MONITOR] && !m.live[CABLE] {
      return Err("Aucune sortie audio active : ouvrez « Audio & Discord ».".into());
    }
    if exclusive {
      m.voices.retain(|v| v.id == TEST_ID);
    }
    m.voices.push(Voice::new(id, clip, gain.clamp(0.0, 2.0), looping));
    Ok(dur)
  }

  pub fn pause(&self, id: &str, paused: bool) {
    for v in lock(&self.mixer).voices.iter_mut().filter(|v| v.id == id) {
      v.paused = paused;
    }
  }

  /// Moves every instance of a sound by `delta` seconds, on both outputs.
  pub fn seek(&self, id: &str, delta: f64) {
    for v in lock(&self.mixer).voices.iter_mut().filter(|v| v.id == id) {
      let len = v.clip.frames() as f64;
      let d = delta * v.clip.rate as f64;
      for w in 0..2 {
        let pos = if v.looping { v.cursor[w] % len } else { v.cursor[w] };
        v.cursor[w] = (pos + d).clamp(0.0, len);
        v.done[w] = !v.looping && v.cursor[w] >= len;
      }
    }
  }

  pub fn stop(&self, id: &str) {
    lock(&self.mixer).voices.retain(|v| v.id != id);
  }

  pub fn stop_all(&self) {
    lock(&self.mixer).voices.retain(|v| v.id == TEST_ID);
  }

  pub fn set_levels(&self, master: f32, monitor: f32, mic: f32) {
    let mut m = lock(&self.mixer);
    m.master = master.clamp(0.0, 2.0);
    m.monitor_gain = monitor.clamp(0.0, 2.0);
    m.mic_gain = mic.clamp(0.0, 3.0);
  }

  /// Drops finished voices and returns what is still playing (for progress bars).
  pub fn tick(&self) -> Vec<Playing> {
    let mut m = lock(&self.mixer);
    let live = m.live;
    m.voices.retain(|v| !v.finished(live));
    m.voices
      .iter()
      .filter(|v| v.id != TEST_ID)
      .map(|v| {
        let w = if live[CABLE] && v.targets[CABLE] { CABLE } else { MONITOR };
        let len = v.clip.frames() as f64;
        Playing { id: v.id.clone(), pos: (v.cursor[w] % len) / v.clip.rate as f64, dur: len / v.clip.rate as f64, paused: v.paused }
      })
      .collect()
  }
}

fn audio_thread(mixer: Arc<Mutex<Mixer>>, rx: mpsc::Receiver<Cmd>) {
  let mut streams: Vec<cpal::Stream> = Vec::new();
  let mut cable: Option<String> = None;
  while let Ok(cmd) = rx.recv() {
    match cmd {
      Cmd::Configure(cfg, reply) => {
        streams.clear();
        let (s, st) = open(&cfg, &mixer);
        streams = s;
        cable = st.cable.clone();
        let _ = reply.send(st);
      }
      Cmd::Test(reply) => {
        let _ = reply.send(probe(cable.as_deref(), &mixer));
      }
    }
  }
}

fn find<I: Iterator<Item = cpal::Device>>(it: Option<I>, name: &str) -> Option<cpal::Device> {
  it?.find(|d| d.name().map_or(false, |n| n == name))
}

/// "CABLE Input (VB-Audio Virtual Cable)" -> "CABLE Output (VB-Audio Virtual Cable)".
fn recording_side(cable: &str) -> String {
  cable.replacen("Input", "Output", 1)
}

fn open(cfg: &AudioConfig, mixer: &Arc<Mutex<Mixer>>) -> (Vec<cpal::Stream>, AudioStatus) {
  {
    let mut m = lock(mixer);
    m.live = [false; 2];
    m.mic_on = false;
    m.mic.clear();
    m.mic_primed = false;
  }
  let host = cpal::default_host();
  let mut st = AudioStatus::default();
  let mut streams = Vec::new();

  let mon = match &cfg.monitor {
    Some(n) => find(host.output_devices().ok(), n),
    None => host.default_output_device(),
  };
  match mon {
    None => st.errors.push("Aucun casque ou haut-parleur trouvé pour l'écoute.".into()),
    Some(d) => {
      let name = d.name().unwrap_or_default();
      if cfg.cable.as_deref() == Some(name.as_str()) {
        st.errors.push(format!(
          "« {name} » sert à la fois d'écoute et de sortie Discord : choisissez vos écouteurs dans « Écoute »."
        ));
      } else {
        match out_stream(&d, mixer.clone(), MONITOR) {
          Ok(s) => {
            streams.push(s);
            st.monitor = Some(name);
          }
          Err(e) => st.errors.push(format!("Écoute ({name}) : {e}")),
        }
      }
    }
  }

  if let Some(n) = &cfg.cable {
    match find(host.output_devices().ok(), n) {
      None => st.errors.push(format!("Sortie Discord « {n} » introuvable. Le câble virtuel est-il installé ?")),
      Some(d) => match out_stream(&d, mixer.clone(), CABLE) {
        Ok(s) => {
          streams.push(s);
          st.cable = Some(n.clone());
        }
        Err(e) => st.errors.push(format!("Sortie Discord : {e}")),
      },
    }
  }

  if let (Some(cable), true) = (&st.cable, cfg.mic_enabled) {
    let dev = match &cfg.mic {
      Some(n) => find(host.input_devices().ok(), n),
      None => host.default_input_device(),
    };
    match dev {
      None => st.errors.push("Micro introuvable.".into()),
      Some(d) => {
        let name = d.name().unwrap_or_default();
        if name == recording_side(cable) || name.to_lowercase().contains("cable output") {
          st.errors.push(format!(
            "Le micro « {name} » est la sortie du câble : cela créerait une boucle. Choisissez votre vrai micro."
          ));
        } else {
          let mx = mixer.clone();
          let res = in_stream(&d, move |x| {
            let mut m = lock(&mx);
            m.mic.extend(x.iter().copied());
            let cap = m.mic_rate as usize / 2;
            if m.mic.len() > cap {
              let n = m.mic.len() - cap;
              m.mic.drain(..n);
            }
          });
          match res {
            Ok((s, rate)) => {
              let mut m = lock(mixer);
              m.mic_rate = rate;
              m.mic_on = true;
              streams.push(s);
              st.mic = Some(name);
            }
            Err(e) => st.errors.push(format!("Micro ({name}) : {e}")),
          }
        }
      }
    }
  }

  for s in &streams {
    if let Err(e) = s.play() {
      st.errors.push(e.to_string());
    }
  }
  lock(mixer).live = [st.monitor.is_some(), st.cable.is_some()];
  (streams, st)
}

fn probe(cable: Option<&str>, mixer: &Arc<Mutex<Mixer>>) -> Result<f32, String> {
  let cable = cable.ok_or("Aucune sortie Discord active : choisissez le câble virtuel à l'étape « Périphériques ».")?;
  let want = recording_side(cable);
  let rec = find(cpal::default_host().input_devices().ok(), &want)
    .ok_or(format!("Entrée « {want} » introuvable : impossible d'écouter le câble pour vérifier."))?;
  let peak = Arc::new(Mutex::new(0f32));
  let p = peak.clone();
  let (s, _) = in_stream(&rec, move |x| {
    let mx = x.iter().fold(0f32, |a, s| a.max(s.abs()));
    let mut p = p.lock().unwrap();
    *p = p.max(mx);
  })?;
  s.play().map_err(es)?;
  {
    let mut m = lock(mixer);
    m.mic_muted = true; // so the user's voice cannot fake a positive result
    m.voices.push(Voice::tone());
  }
  std::thread::sleep(Duration::from_millis(250));
  *peak.lock().unwrap() = 0.0;
  std::thread::sleep(Duration::from_millis(1000));
  lock(mixer).mic_muted = false;
  drop(s);
  let v = *peak.lock().unwrap();
  Ok(v)
}

fn out_stream(dev: &cpal::Device, mixer: Arc<Mutex<Mixer>>, w: usize) -> Result<cpal::Stream, String> {
  let sc = dev.default_output_config().map_err(es)?;
  let cfg = sc.config();
  match sc.sample_format() {
    SampleFormat::F32 => out_typed::<f32>(dev, &cfg, mixer, w),
    SampleFormat::I16 => out_typed::<i16>(dev, &cfg, mixer, w),
    SampleFormat::U16 => out_typed::<u16>(dev, &cfg, mixer, w),
    SampleFormat::I32 => out_typed::<i32>(dev, &cfg, mixer, w),
    f => Err(format!("format {f:?} non pris en charge")),
  }
}

fn out_typed<T: SizedSample + FromSample<f32>>(
  dev: &cpal::Device,
  cfg: &cpal::StreamConfig,
  mixer: Arc<Mutex<Mixer>>,
  w: usize,
) -> Result<cpal::Stream, String> {
  let ch = cfg.channels as usize;
  let rate = cfg.sample_rate.0;
  let mut buf: Vec<f32> = Vec::new();
  let on_err = mixer.clone();
  dev
    .build_output_stream(
      cfg,
      move |out: &mut [T], _: &cpal::OutputCallbackInfo| {
        buf.resize(out.len(), 0.0);
        lock(&mixer).render(&mut buf, ch, rate, w);
        for (o, s) in out.iter_mut().zip(&buf) {
          *o = T::from_sample(*s);
        }
      },
      move |e| {
        // unplugged device: stop waiting on it so voices can still finish elsewhere
        if matches!(e, cpal::StreamError::DeviceNotAvailable) {
          lock(&on_err).live[w] = false;
        }
      },
      None,
    )
    .map_err(es)
}

fn in_stream<F: FnMut(&[f32]) + Send + 'static>(dev: &cpal::Device, f: F) -> Result<(cpal::Stream, u32), String> {
  let sc = dev.default_input_config().map_err(es)?;
  let cfg = sc.config();
  let s = match sc.sample_format() {
    SampleFormat::F32 => in_typed::<f32, F>(dev, &cfg, f),
    SampleFormat::I16 => in_typed::<i16, F>(dev, &cfg, f),
    SampleFormat::U16 => in_typed::<u16, F>(dev, &cfg, f),
    SampleFormat::I32 => in_typed::<i32, F>(dev, &cfg, f),
    x => Err(format!("format {x:?} non pris en charge")),
  }?;
  Ok((s, cfg.sample_rate.0))
}

fn in_typed<T, F>(dev: &cpal::Device, cfg: &cpal::StreamConfig, mut f: F) -> Result<cpal::Stream, String>
where
  T: SizedSample,
  f32: FromSample<T>,
  F: FnMut(&[f32]) + Send + 'static,
{
  let ch = (cfg.channels as usize).max(1);
  let mut mono: Vec<f32> = Vec::new();
  dev
    .build_input_stream(
      cfg,
      move |data: &[T], _: &cpal::InputCallbackInfo| {
        mono.clear();
        mono.extend(data.chunks(ch).map(|fr| fr.iter().map(|&s| s.to_sample::<f32>()).sum::<f32>() / ch as f32));
        f(&mono);
      },
      |e| eprintln!("entrée audio : {e}"),
      None,
    )
    .map_err(es)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn resamples_and_finishes() {
    // 100 frames at 24 kHz rendered at 48 kHz = 200 output frames
    let clip = Arc::new(Clip { data: vec![0.5; 200], rate: 24_000 });
    let mut m = Mixer::default();
    m.master = 1.0;
    m.voices.push(Voice::new("a".into(), clip, 1.0, false));
    let mut out = vec![0.0; 2 * 150];
    m.render(&mut out, 2, 48_000, MONITOR);
    assert!((out[0] - 0.5).abs() < 1e-6);
    assert!(!m.voices[0].done[MONITOR]);
    m.render(&mut out, 2, 48_000, MONITOR);
    assert!(m.voices[0].done[MONITOR]);
    assert_eq!(out[2 * 149], 0.0);
    assert!(m.voices[0].finished([true, false]));
    assert!(!m.voices[0].finished([true, true])); // cable side has not played yet
  }

  #[test]
  fn looping_never_finishes() {
    let clip = Arc::new(Clip { data: vec![0.2; 20], rate: 48_000 });
    let mut m = Mixer::default();
    m.voices.push(Voice::new("a".into(), clip, 1.0, true));
    let mut out = vec![0.0; 2 * 64];
    m.render(&mut out, 2, 48_000, MONITOR);
    assert!(!m.voices[0].done[MONITOR]);
    assert!(out[2 * 63] > 0.0);
  }

  #[test]
  fn pause_and_seek() {
    let clip = Arc::new(Clip { data: vec![0.3; 2 * 48_000], rate: 48_000 }); // 1 s
    let e = Engine { mixer: Arc::new(Mutex::new(Mixer::default())), tx: Mutex::new(mpsc::channel().0), cache: Mutex::new((HashMap::new(), 0)) };
    lock(&e.mixer).voices.push(Voice::new("a".into(), clip, 1.0, false));
    e.pause("a", true);
    let mut out = vec![1.0; 2 * 64];
    lock(&e.mixer).render(&mut out, 2, 48_000, MONITOR);
    assert_eq!(out[0], 0.0); // paused voice is silent and does not advance
    assert!(!lock(&e.mixer).voices[0].finished([true, true]));
    e.seek("a", 0.5);
    assert_eq!(lock(&e.mixer).voices[0].cursor, [24_000.0; 2]);
    e.seek("a", -5.0);
    assert_eq!(lock(&e.mixer).voices[0].cursor, [0.0; 2]);
    e.seek("a", 5.0);
    assert!(lock(&e.mixer).voices[0].done[MONITOR]);
  }

  /// Real hardware: needs VB-CABLE. Run with `cargo test -- --ignored --nocapture`.
  #[test]
  #[ignore]
  fn cable_route_on_this_pc() {
    let e = Engine::new();
    let st = e.configure(AudioConfig {
      monitor: None,
      cable: Some("CABLE Input (VB-Audio Virtual Cable)".into()),
      mic: None,
      mic_enabled: true,
    });
    println!("monitor={:?} cable={:?} mic={:?} errors={:?}", st.monitor, st.cable, st.mic, st.errors);
    let peak = e.test().expect("probe");
    println!("peak heard on CABLE Output = {peak:.3}");
    assert!(peak > 0.02);
  }
}
