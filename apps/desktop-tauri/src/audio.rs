use serde::{Deserialize, Serialize};

/// Fixed FFT output band count shared with workbench visualizers.
pub const DEFAULT_SPECTRUM_BANDS: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AudioBackend {
    WasapiLoopback,
    Coreaudio,
    Pipewire,
    SilentFallback,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlayingMetadata {
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub source_app: Option<String>,
    pub playing: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSpectrumSnapshot {
    pub backend: AudioBackend,
    pub bands: Vec<f32>,
    pub rms: f32,
    pub peak: f32,
    pub now_playing: Option<NowPlayingMetadata>,
    pub capturing: bool,
    pub fallback_reason: Option<String>,
    pub sequence: u64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AudioEnvelopeConfig {
    pub attack_alpha: f32,
    pub release_alpha: f32,
    pub noise_floor: f32,
}

impl Default for AudioEnvelopeConfig {
    fn default() -> Self {
        Self {
            attack_alpha: 0.55,
            release_alpha: 0.22,
            noise_floor: 0.002,
        }
    }
}

/// Returns the preferred native loopback audio backend for the active OS.
pub fn platform_preferred_backend() -> AudioBackend {
    #[cfg(target_os = "windows")]
    {
        AudioBackend::WasapiLoopback
    }
    #[cfg(target_os = "macos")]
    {
        AudioBackend::Coreaudio
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        AudioBackend::Pipewire
    }
}

/// Pure-Rust audio FFT spectrum and Now Playing state bridge with asymmetric
/// exponential envelope smoothing and safe device-less silent fallback.
#[derive(Debug, Clone)]
pub struct AudioBridgeState {
    preferred_backend: AudioBackend,
    device_available: bool,
    capture_requested: bool,
    capturing: bool,
    envelope: AudioEnvelopeConfig,
    bands: Vec<f32>,
    now_playing: Option<NowPlayingMetadata>,
    fallback_reason: Option<String>,
    sequence: u64,
}

impl Default for AudioBridgeState {
    fn default() -> Self {
        Self::new()
    }
}

impl AudioBridgeState {
    /// Creates an audio bridge initialized in safe device-less silent fallback mode.
    pub fn new() -> Self {
        Self::with_device_available(platform_preferred_backend(), false)
    }

    /// Creates an audio bridge with explicit backend and hardware loopback availability.
    pub fn with_device_available(preferred_backend: AudioBackend, device_available: bool) -> Self {
        let fallback_reason = if device_available {
            Some("系统音频 FFT 律动待机中".to_string())
        } else {
            Some("未连接系统音频回环流，已安全降级为静默频谱".to_string())
        };
        Self {
            preferred_backend,
            device_available,
            capture_requested: false,
            capturing: false,
            envelope: AudioEnvelopeConfig::default(),
            bands: vec![0.0; DEFAULT_SPECTRUM_BANDS],
            now_playing: None,
            fallback_reason: Some(fallback_reason.expect("reason")),
            sequence: 0,
        }
    }

    pub fn set_envelope_config(&mut self, config: AudioEnvelopeConfig) {
        self.envelope = AudioEnvelopeConfig {
            attack_alpha: sanitize_unit(config.attack_alpha).max(0.01),
            release_alpha: sanitize_unit(config.release_alpha).max(0.01),
            noise_floor: sanitize_unit(config.noise_floor),
        };
    }

    pub fn set_device_available(&mut self, available: bool) {
        self.device_available = available;
        if !available {
            self.capturing = false;
            self.fallback_reason =
                Some("未检测到系统音频回环设备，已安全降级为静默频谱".to_string());
        } else if self.capture_requested {
            self.capturing = true;
            self.fallback_reason = None;
        }
    }

    /// Enables or disables audio spectrum capture.
    /// If no loopback device is available, safely remains in `silent-fallback` without panicking.
    pub fn set_capture_enabled(&mut self, enabled: bool) -> AudioSpectrumSnapshot {
        self.capture_requested = enabled;
        if enabled {
            if self.device_available {
                self.capturing = true;
                self.fallback_reason = None;
            } else {
                self.capturing = false;
                self.fallback_reason =
                    Some("未连接系统音频回环设备，已安全降级为静默频谱".to_string());
                self.decay_toward_silence();
            }
        } else {
            self.capturing = false;
            self.fallback_reason = Some("系统音频 FFT 律动已关闭".to_string());
            self.decay_toward_silence();
        }
        self.sequence = self.sequence.saturating_add(1);
        self.current_snapshot()
    }

    /// Feeds a raw FFT frame and optional Now Playing metadata through the exponential
    /// attack/release envelope filter.
    pub fn ingest_fft_frame(
        &mut self,
        raw_bands: &[f32],
        now_playing: Option<NowPlayingMetadata>,
    ) -> AudioSpectrumSnapshot {
        self.device_available = true;
        if !self.capture_requested {
            self.capture_requested = true;
        }
        self.capturing = true;
        self.fallback_reason = None;
        self.now_playing = now_playing;

        let resampled = resample_to_32_bands(raw_bands);
        for (slot, target) in self.bands.iter_mut().zip(resampled.into_iter()) {
            let alpha = if target >= *slot {
                self.envelope.attack_alpha
            } else {
                self.envelope.release_alpha
            };
            let mut next = *slot + alpha * (target - *slot);
            if target == 0.0 && next < self.envelope.noise_floor {
                next = 0.0;
            }
            *slot = sanitize_unit(next);
        }

        self.sequence = self.sequence.saturating_add(1);
        self.current_snapshot()
    }

    /// Advances the smoothing envelope toward silence (used when idle or paused).
    pub fn decay_toward_silence(&mut self) -> AudioSpectrumSnapshot {
        for slot in &mut self.bands {
            let next = *slot * (1.0 - self.envelope.release_alpha);
            *slot = if next < self.envelope.noise_floor {
                0.0
            } else {
                sanitize_unit(next)
            };
        }
        self.sequence = self.sequence.saturating_add(1);
        self.current_snapshot()
    }

    /// Returns the current snapshot; when not capturing, applies one silent release step
    /// if residual energy remains.
    pub fn snapshot(&mut self) -> AudioSpectrumSnapshot {
        if !self.capturing && self.bands.iter().any(|&v| v > 0.0) {
            self.decay_toward_silence();
        }
        self.current_snapshot()
    }

    fn current_snapshot(&self) -> AudioSpectrumSnapshot {
        let backend = if self.capturing {
            self.preferred_backend
        } else {
            AudioBackend::SilentFallback
        };
        let (rms, peak) = compute_rms_and_peak(&self.bands);
        AudioSpectrumSnapshot {
            backend,
            bands: self.bands.clone(),
            rms,
            peak,
            now_playing: if self.capturing {
                self.now_playing.clone()
            } else {
                None
            },
            capturing: self.capturing,
            fallback_reason: self.fallback_reason.clone(),
            sequence: self.sequence,
        }
    }
}

fn sanitize_unit(value: f32) -> f32 {
    if !value.is_finite() {
        0.0
    } else {
        value.clamp(0.0, 1.0)
    }
}

fn resample_to_32_bands(raw: &[f32]) -> [f32; DEFAULT_SPECTRUM_BANDS] {
    let mut out = [0.0_f32; DEFAULT_SPECTRUM_BANDS];
    if raw.is_empty() {
        return out;
    }
    if raw.len() == DEFAULT_SPECTRUM_BANDS {
        for (dst, &src) in out.iter_mut().zip(raw.iter()) {
            *dst = sanitize_unit(src);
        }
        return out;
    }

    let last = raw.len() - 1;
    for (idx, dst) in out.iter_mut().enumerate() {
        let pos = (idx as f32) * (last as f32) / ((DEFAULT_SPECTRUM_BANDS - 1) as f32);
        let lo = pos.floor() as usize;
        let hi = (lo + 1).min(last);
        let frac = pos - (lo as f32);
        let a = sanitize_unit(raw[lo]);
        let b = sanitize_unit(raw[hi]);
        *dst = sanitize_unit(a + frac * (b - a));
    }
    out
}

fn compute_rms_and_peak(bands: &[f32]) -> (f32, f32) {
    if bands.is_empty() {
        return (0.0, 0.0);
    }
    let mut sum_sq = 0.0_f32;
    let mut peak = 0.0_f32;
    for &b in bands {
        let clamped = sanitize_unit(b);
        sum_sq += clamped * clamped;
        if clamped > peak {
            peak = clamped;
        }
    }
    let rms = (sum_sq / (bands.len() as f32)).sqrt();
    (sanitize_unit(rms), sanitize_unit(peak))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_safe_silent_fallback_without_audio_device() {
        let mut bridge = AudioBridgeState::new();
        let snap = bridge.snapshot();
        assert_eq!(snap.backend, AudioBackend::SilentFallback);
        assert!(!snap.capturing);
        assert_eq!(snap.bands.len(), 32);
        assert!(snap.bands.iter().all(|&b| b == 0.0));
        assert_eq!(snap.rms, 0.0);
        assert_eq!(snap.peak, 0.0);
        assert!(snap.fallback_reason.is_some());

        // Enabling capture without hardware loopback remains safely in silent-fallback
        let after_enable = bridge.set_capture_enabled(true);
        assert_eq!(after_enable.backend, AudioBackend::SilentFallback);
        assert!(!after_enable.capturing);
        assert_eq!(after_enable.bands.len(), 32);
    }

    #[test]
    fn switches_capture_state_and_applies_exponential_envelope() {
        let mut bridge = AudioBridgeState::with_device_available(AudioBackend::WasapiLoopback, true);

        let started = bridge.set_capture_enabled(true);
        assert!(started.capturing);
        assert_eq!(started.backend, AudioBackend::WasapiLoopback);
        assert!(started.fallback_reason.is_none());

        let meta = NowPlayingMetadata {
            title: "Nocturne in Glass".to_string(),
            artist: Some("Prismux Ensemble".to_string()),
            album: None,
            source_app: Some("Spotify.exe".to_string()),
            playing: true,
        };

        // Feed out-of-range and NaN inputs to verify clamping and smoothing
        let mut raw = vec![1.5_f32; 32];
        raw[0] = -0.8;
        raw[1] = f32::NAN;
        let frame1 = bridge.ingest_fft_frame(&raw, Some(meta.clone()));
        assert_eq!(frame1.bands.len(), 32);
        assert_eq!(frame1.bands[0], 0.0);
        assert_eq!(frame1.bands[1], 0.0);
        // With default attack_alpha = 0.55, jumping from 0.0 to clamped 1.0 lands near 0.55
        assert!((frame1.bands[2] - 0.55).abs() < 1e-4);
        assert!(frame1.rms > 0.0 && frame1.rms <= 1.0);
        assert!((frame1.peak - 0.55).abs() < 1e-4);
        assert_eq!(frame1.now_playing, Some(meta));

        // Second frame continues smoothly climbing toward 1.0
        let frame2 = bridge.ingest_fft_frame(&raw, None);
        assert!(frame2.bands[2] > frame1.bands[2] && frame2.bands[2] < 1.0);

        // Disabling capture transitions back to silent-fallback and releases smoothly
        let stopped = bridge.set_capture_enabled(false);
        assert!(!stopped.capturing);
        assert_eq!(stopped.backend, AudioBackend::SilentFallback);
        assert!(stopped.bands[2] < frame2.bands[2] && stopped.bands[2] > 0.0);
        assert!(stopped.now_playing.is_none());
    }
}
