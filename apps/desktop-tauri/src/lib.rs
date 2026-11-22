pub mod audio;
pub mod installer_meta;
pub mod updater;
pub mod visibility;
pub mod wallpaper;

use audio::{AudioBridgeState, AudioSpectrumSnapshot};
use installer_meta::{build_installer_plan, detect_portable_data_dir, InstallerPlan};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager, Window, WindowEvent};
use updater::{
    build_updater_bootstrap, verify_installer_sha256_file, Sha256VerificationResult,
    UpdaterBootstrapInfo,
};
use visibility::{VisibilitySignal, VisibilityState, VISIBILITY_EVENT_NAME};
use wallpaper::{
    scan_custom_wallpapers_in_dir, scan_steam_wallpapers_default, scan_steam_wallpapers_with_roots,
    WallpaperScanResult,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopShellCapabilities {
    pub app_name: &'static str,
    pub milestone: &'static str,
    pub transparent_compositor: bool,
    pub audio_fft_bridge: bool,
    pub occlusion_zero_fps_pause: bool,
    pub steam_workshop_scanner: bool,
    pub zero_token_visual_layer: bool,
    pub installer_step_count: u8,
    pub portable_data_dir: Option<String>,
}

pub struct DesktopShellState {
    pub audio: Mutex<AudioBridgeState>,
    pub visibility: Mutex<VisibilityState>,
    pub last_emitted_visibility: Mutex<Option<VisibilitySignal>>,
}

impl Default for DesktopShellState {
    fn default() -> Self {
        Self::new()
    }
}

impl DesktopShellState {
    pub fn new() -> Self {
        let initial_visibility = VisibilityState::default();
        let initial_signal = initial_visibility.signal();
        Self {
            audio: Mutex::new(AudioBridgeState::new()),
            visibility: Mutex::new(initial_visibility),
            last_emitted_visibility: Mutex::new(Some(initial_signal)),
        }
    }
}

pub mod commands {
    use super::*;

    #[tauri::command]
    pub fn get_shell_capabilities() -> DesktopShellCapabilities {
        let portable_data_dir = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(PathBuf::from))
            .and_then(|dir| detect_portable_data_dir(&dir))
            .map(|p| p.to_string_lossy().into_owned());

        DesktopShellCapabilities {
            app_name: "Prismux",
            milestone: "M4",
            transparent_compositor: true,
            audio_fft_bridge: true,
            occlusion_zero_fps_pause: true,
            steam_workshop_scanner: true,
            zero_token_visual_layer: true,
            installer_step_count: 5,
            portable_data_dir,
        }
    }

    #[tauri::command]
    pub fn scan_steam_wallpapers(steam_roots: Option<Vec<String>>) -> WallpaperScanResult {
        match steam_roots {
            Some(roots) if !roots.is_empty() => {
                let paths: Vec<PathBuf> = roots.into_iter().map(PathBuf::from).collect();
                scan_steam_wallpapers_with_roots(&paths)
            }
            _ => scan_steam_wallpapers_default(),
        }
    }

    #[tauri::command]
    pub fn scan_custom_wallpapers(directory: String) -> Result<WallpaperScanResult, String> {
        scan_custom_wallpapers_in_dir(PathBuf::from(directory).as_path())
    }

    #[tauri::command]
    pub fn get_audio_spectrum(
        state: tauri::State<'_, DesktopShellState>,
    ) -> Result<AudioSpectrumSnapshot, String> {
        let mut audio = state
            .audio
            .lock()
            .map_err(|_| "音频频谱状态锁已失效".to_string())?;
        Ok(audio.snapshot())
    }

    #[tauri::command]
    pub fn set_audio_capture_enabled(
        enabled: bool,
        state: tauri::State<'_, DesktopShellState>,
    ) -> Result<AudioSpectrumSnapshot, String> {
        let mut audio = state
            .audio
            .lock()
            .map_err(|_| "音频频谱状态锁已失效".to_string())?;
        Ok(audio.set_capture_enabled(enabled))
    }

    #[tauri::command]
    pub fn get_visibility_signal(
        state: tauri::State<'_, DesktopShellState>,
    ) -> Result<VisibilitySignal, String> {
        let visibility = state
            .visibility
            .lock()
            .map_err(|_| "可见性状态锁已失效".to_string())?;
        Ok(visibility.signal())
    }

    #[tauri::command]
    pub fn report_window_occlusion(
        app: tauri::AppHandle,
        occluded: bool,
        power_saver: Option<bool>,
        reason: Option<String>,
        state: tauri::State<'_, DesktopShellState>,
    ) -> Result<VisibilitySignal, String> {
        let signal = {
            let mut visibility = state
                .visibility
                .lock()
                .map_err(|_| "可见性状态锁已失效".to_string())?;
            let reason_ref = reason.as_deref();
            if let Some(saver) = power_saver {
                visibility.set_power_saver(saver, reason_ref);
            }
            visibility.set_occluded(occluded, reason_ref)
        };

        if let Ok(mut last) = state.last_emitted_visibility.lock() {
            *last = Some(signal.clone());
        }
        let _ = app.emit(VISIBILITY_EVENT_NAME, &signal);
        Ok(signal)
    }

    #[tauri::command]
    pub fn get_installer_plan(executable_dir: Option<String>) -> InstallerPlan {
        let dir_buf = executable_dir.map(PathBuf::from);
        build_installer_plan(dir_buf.as_deref())
    }

    #[tauri::command]
    pub fn get_updater_bootstrap(executable_dir: Option<String>) -> UpdaterBootstrapInfo {
        let dir_buf = executable_dir.map(PathBuf::from);
        build_updater_bootstrap(dir_buf.as_deref())
    }

    #[tauri::command]
    pub fn verify_installer_sha256(
        file_path: String,
        expected_sha256: String,
    ) -> Result<Sha256VerificationResult, String> {
        verify_installer_sha256_file(PathBuf::from(file_path).as_path(), &expected_sha256)
    }
}

pub use commands::{
    get_audio_spectrum, get_installer_plan, get_shell_capabilities, get_updater_bootstrap,
    get_visibility_signal, report_window_occlusion, scan_custom_wallpapers,
    scan_steam_wallpapers, set_audio_capture_enabled, verify_installer_sha256,
};

fn handle_window_event<R: tauri::Runtime>(window: &Window<R>, event: &WindowEvent) {
    let state = window.state::<DesktopShellState>();
    let maybe_next = {
        let mut visibility = match state.visibility.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };

        match event {
            WindowEvent::Resized(size) => {
                let is_minimized =
                    window.is_minimized().unwrap_or(false) || size.width == 0 || size.height == 0;
                Some(visibility.set_minimized(is_minimized, None))
            }
            WindowEvent::Moved(_) => {
                let is_minimized = window.is_minimized().unwrap_or(false);
                Some(visibility.set_minimized(is_minimized, None))
            }
            WindowEvent::Focused(focused) => {
                let is_minimized = window.is_minimized().unwrap_or(false);
                visibility.set_minimized(is_minimized, None);
                Some(visibility.set_focused(*focused))
            }
            WindowEvent::Destroyed => Some(visibility.set_occluded(true, Some("window-destroyed"))),
            _ => None,
        }
    };

    if let Some(next_signal) = maybe_next {
        let should_emit = match state.last_emitted_visibility.lock() {
            Ok(mut last) => {
                if last.as_ref() != Some(&next_signal) {
                    *last = Some(next_signal.clone());
                    true
                } else {
                    false
                }
            }
            Err(_) => true,
        };

        if should_emit {
            let _ = window.emit(VISIBILITY_EVENT_NAME, &next_signal);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DesktopShellState::new())
        .on_window_event(handle_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::get_shell_capabilities,
            commands::scan_steam_wallpapers,
            commands::scan_custom_wallpapers,
            commands::get_audio_spectrum,
            commands::set_audio_capture_enabled,
            commands::get_visibility_signal,
            commands::report_window_occlusion,
            commands::get_installer_plan,
            commands::get_updater_bootstrap,
            commands::verify_installer_sha256
        ])
        .run(tauri::generate_context!())
        .expect("error while running Prismux desktop shell");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_reflect_zero_token_visual_layer_and_m4_features() {
        let caps = get_shell_capabilities();
        assert_eq!(caps.app_name, "Prismux");
        assert_eq!(caps.milestone, "M4");
        assert!(caps.transparent_compositor);
        assert!(caps.audio_fft_bridge);
        assert!(caps.occlusion_zero_fps_pause);
        assert!(caps.steam_workshop_scanner);
        assert!(caps.zero_token_visual_layer);
        assert_eq!(caps.installer_step_count, 5);
    }

    #[test]
    fn shell_state_initializes_cleanly() {
        let state = DesktopShellState::new();
        let snap = state.audio.lock().unwrap().snapshot();
        assert_eq!(snap.bands.len(), 32);
        assert!(!snap.capturing);

        let vis = state.visibility.lock().unwrap().signal();
        assert_eq!(vis.target_fps, 60);
        assert!(!vis.occluded);
        assert!(!vis.minimized);
    }
}
