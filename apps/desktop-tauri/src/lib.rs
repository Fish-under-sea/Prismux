use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopShellCapabilities {
    pub app_name: &'static str,
    pub milestone: &'static str,
    pub transparent_compositor: bool,
    pub audio_fft_bridge: bool,
    pub occlusion_zero_fps_pause: bool,
    pub steam_workshop_scanner: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperScanStub {
    pub workshop_app_id: u32,
    pub discovered_count: usize,
}

#[tauri::command]
pub fn get_shell_capabilities() -> DesktopShellCapabilities {
    DesktopShellCapabilities {
        app_name: "Prismux",
        milestone: "M4",
        transparent_compositor: true,
        audio_fft_bridge: false,
        occlusion_zero_fps_pause: false,
        steam_workshop_scanner: false,
    }
}

#[tauri::command]
pub fn scan_steam_wallpapers() -> WallpaperScanStub {
    WallpaperScanStub {
        workshop_app_id: 431960,
        discovered_count: 0,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_shell_capabilities,
            scan_steam_wallpapers
        ])
        .run(tauri::generate_context!())
        .expect("error while running Prismux desktop shell");
}
