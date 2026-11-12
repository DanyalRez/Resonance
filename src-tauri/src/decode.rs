use std::{fs::File, path::Path};
use symphonia::core::{
  audio::SampleBuffer,
  codecs::{DecoderOptions, CODEC_TYPE_NULL},
  errors::Error,
  formats::FormatOptions,
  io::MediaSourceStream,
  meta::MetadataOptions,
  probe::Hint,
};

/// A fully decoded sound: interleaved stereo f32 at its native sample rate.
pub struct Clip {
  pub data: Vec<f32>,
  pub rate: u32,
}

impl Clip {
  pub fn frames(&self) -> usize {
    self.data.len() / 2
  }
  pub fn secs(&self) -> f64 {
    self.frames() as f64 / self.rate as f64
  }
}

pub fn decode(path: &Path) -> Result<Clip, String> {
  let file = File::open(path).map_err(|e| format!("Fichier introuvable : {e}"))?;
  let mss = MediaSourceStream::new(Box::new(file), Default::default());
  let mut hint = Hint::new();
  if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
    hint.with_extension(ext);
  }
  let probed = symphonia::default::get_probe()
    .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
    .map_err(|_| "Format audio non pris en charge.".to_string())?;
  let mut format = probed.format;
  let track = format
    .tracks()
    .iter()
    .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
    .ok_or("Aucune piste audio dans ce fichier.")?;
  let track_id = track.id;
  let mut rate = track.codec_params.sample_rate.unwrap_or(44_100);
  let mut decoder = symphonia::default::get_codecs()
    .make(&track.codec_params, &DecoderOptions::default())
    .map_err(|_| "Codec audio non pris en charge.".to_string())?;

  let mut data = Vec::new();
  loop {
    let packet = match format.next_packet() {
      Ok(p) => p,
      Err(Error::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
      Err(Error::ResetRequired) => break,
      Err(e) => return Err(e.to_string()),
    };
    if packet.track_id() != track_id {
      continue;
    }
    let decoded = match decoder.decode(&packet) {
      Ok(d) => d,
      Err(Error::DecodeError(_)) => continue, // one corrupt frame should not kill the whole sound
      Err(e) => return Err(e.to_string()),
    };
    let spec = *decoded.spec();
    rate = spec.rate;
    let ch = spec.channels.count().max(1);
    let mut buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
    buf.copy_interleaved_ref(decoded);
    for f in buf.samples().chunks(ch) {
      let l = f[0];
      data.push(l);
      data.push(if ch > 1 { f[1] } else { l });
    }
  }
  if data.is_empty() {
    return Err("Fichier audio vide ou illisible.".into());
  }
  Ok(Clip { data, rate })
}
