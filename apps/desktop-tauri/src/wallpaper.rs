use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::{Component, Path, PathBuf};

/// Steam Workshop App ID for Wallpaper Engine.
pub const STEAM_WALLPAPER_ENGINE_APP_ID: u32 = 431960;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WallpaperKind {
    Scene,
    Web,
    Video,
    Image,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperItem {
    pub workshop_id: String,
    pub title: String,
    pub wallpaper_type: WallpaperKind,
    pub entry_file: Option<String>,
    pub preview_path: Option<String>,
    pub tags: Vec<String>,
    pub directory: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WallpaperScanResult {
    pub workshop_app_id: u32,
    pub discovered_count: usize,
    pub searched_roots: Vec<String>,
    pub library_paths: Vec<String>,
    pub items: Vec<WallpaperItem>,
}

/// Returns cross-platform candidate installation roots for Steam.
pub fn default_steam_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(override_dir) = env::var_os("PRISMUX_STEAM_DIR")
        .or_else(|| env::var_os("STEAM_PATH"))
        .filter(|v| !v.is_empty())
    {
        candidates.push(PathBuf::from(override_dir));
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(pf86) = env::var_os("ProgramFiles(x86)").filter(|v| !v.is_empty()) {
            candidates.push(PathBuf::from(pf86).join("Steam"));
        }
        if let Some(pf) = env::var_os("ProgramFiles").filter(|v| !v.is_empty()) {
            candidates.push(PathBuf::from(pf).join("Steam"));
        }
        if let Some(local_app) = env::var_os("LOCALAPPDATA").filter(|v| !v.is_empty()) {
            candidates.push(PathBuf::from(local_app).join("Steam"));
        }
        candidates.push(PathBuf::from(r"C:\Program Files (x86)\Steam"));
        candidates.push(PathBuf::from(r"C:\Program Files\Steam"));
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = env::var_os("HOME").filter(|v| !v.is_empty()) {
            candidates.push(
                PathBuf::from(home)
                    .join("Library")
                    .join("Application Support")
                    .join("Steam"),
            );
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(home) = env::var_os("HOME").filter(|v| !v.is_empty()) {
            let home_dir = PathBuf::from(home);
            candidates.push(home_dir.join(".local/share/Steam"));
            candidates.push(home_dir.join(".steam/steam"));
            candidates.push(home_dir.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"));
        }
    }

    dedup_paths(candidates)
}

/// Parses Steam `libraryfolders.vdf` (Valve KeyValues) and extracts library root paths.
/// Supports both modern nested blocks (`"0" { "path" "D:\\SteamLibrary" }`) and
/// legacy flat numeric mappings (`"1" "D:\\SteamLibrary"`).
pub fn parse_library_folders_vdf(raw: &str) -> Vec<PathBuf> {
    let tokens = tokenize_vdf(raw);
    let mut paths = Vec::new();
    let mut depth: usize = 0;
    let mut pending_key: Option<String> = None;
    let mut in_library_folders = false;
    let mut library_folders_depth: usize = 0;

    for token in tokens {
        match token {
            VdfToken::OpenBrace => {
                if let Some(key) = pending_key.take() {
                    if depth == 0 && key.eq_ignore_ascii_case("libraryfolders") {
                        in_library_folders = true;
                        library_folders_depth = 1;
                    }
                }
                depth += 1;
            }
            VdfToken::CloseBrace => {
                pending_key = None;
                depth = depth.saturating_sub(1);
                if in_library_folders && depth < library_folders_depth {
                    in_library_folders = false;
                }
            }
            VdfToken::Text(value) => {
                if let Some(key) = pending_key.take() {
                    if key.eq_ignore_ascii_case("path") && !value.trim().is_empty() {
                        paths.push(PathBuf::from(value.trim()));
                    } else if in_library_folders
                        && depth == library_folders_depth
                        && is_numeric_key(&key)
                        && !value.trim().is_empty()
                    {
                        paths.push(PathBuf::from(value.trim()));
                    }
                } else {
                    pending_key = Some(value);
                }
            }
        }
    }

    dedup_paths(paths)
}

/// Discovers all Steam library directories from the given candidate Steam root paths.
pub fn discover_steam_libraries(steam_roots: &[PathBuf]) -> Vec<PathBuf> {
    let mut libraries = Vec::new();

    for root in steam_roots {
        if root.join("steamapps").is_dir() || root.join("config").is_dir() {
            libraries.push(root.clone());
        }

        let vdf_candidates = [
            root.join("steamapps").join("libraryfolders.vdf"),
            root.join("config").join("libraryfolders.vdf"),
            root.join("libraryfolders.vdf"),
        ];

        for vdf_path in vdf_candidates {
            if vdf_path.is_file() {
                if let Ok(raw) = fs::read_to_string(&vdf_path) {
                    libraries.extend(parse_library_folders_vdf(&raw));
                }
            }
        }
    }

    dedup_paths(libraries)
}

/// Scans Steam Workshop `431960` wallpapers across the default Steam candidate roots.
pub fn scan_steam_wallpapers_default() -> WallpaperScanResult {
    let candidates = default_steam_candidates();
    scan_steam_wallpapers_with_roots(&candidates)
}

/// Scans Steam Workshop `431960` wallpapers given explicit Steam root directories.
pub fn scan_steam_wallpapers_with_roots(steam_roots: &[PathBuf]) -> WallpaperScanResult {
    let libraries = discover_steam_libraries(steam_roots);
    let mut items = Vec::new();
    let mut seen_dirs = HashSet::new();

    for lib in &libraries {
        let workshop_dir = lib
            .join("steamapps")
            .join("workshop")
            .join("content")
            .join(STEAM_WALLPAPER_ENGINE_APP_ID.to_string());
        if !workshop_dir.is_dir() {
            continue;
        }

        let entries = match fs::read_dir(&workshop_dir) {
            Ok(rd) => rd,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let item_dir = entry.path();
            if !item_dir.is_dir() {
                continue;
            }
            let norm_dir = normalize_path_key(&item_dir);
            if !seen_dirs.insert(norm_dir) {
                continue;
            }
            let project_json = item_dir.join("project.json");
            if !project_json.is_file() {
                continue;
            }

            let folder_id = item_dir
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string();

            if let Some(item) = parse_project_json_item(&item_dir, &project_json, folder_id) {
                items.push(item);
            }
        }
    }

    items.sort_by(|a, b| a.workshop_id.cmp(&b.workshop_id).then(a.title.cmp(&b.title)));

    WallpaperScanResult {
        workshop_app_id: STEAM_WALLPAPER_ENGINE_APP_ID,
        discovered_count: items.len(),
        searched_roots: steam_roots
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect(),
        library_paths: libraries
            .iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect(),
        items,
    }
}

/// Scans a user-specified custom directory for Wallpaper Engine packages (`project.json`),
/// Web bundles (`index.html`), or standalone video/image wallpapers.
pub fn scan_custom_wallpapers_in_dir(dir: &Path) -> Result<WallpaperScanResult, String> {
    if !dir.exists() {
        return Err(format!("自定义壁纸目录不存在: {}", dir.display()));
    }
    if !dir.is_dir() {
        return Err(format!("指定路径不是有效目录: {}", dir.display()));
    }

    let mut items = Vec::new();
    let entries = fs::read_dir(dir)
        .map_err(|err| format!("读取自定义壁纸目录失败 ({}): {err}", dir.display()))?;

    for entry in entries.flatten() {
        let path = entry.path();
        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };

        if path.is_dir() {
            let project_json = path.join("project.json");
            if project_json.is_file() {
                let id = format!("custom:{file_name}");
                if let Some(item) = parse_project_json_item(&path, &project_json, id) {
                    items.push(item);
                }
                continue;
            }

            let index_html = path.join("index.html");
            if index_html.is_file() {
                items.push(WallpaperItem {
                    workshop_id: format!("custom:{file_name}"),
                    title: file_name.clone(),
                    wallpaper_type: WallpaperKind::Web,
                    entry_file: Some(index_html.to_string_lossy().into_owned()),
                    preview_path: find_preview_in_dir(&path),
                    tags: vec!["custom".to_string(), "web".to_string()],
                    directory: path.to_string_lossy().into_owned(),
                });
            }
        } else if path.is_file() {
            if let Some(kind) = infer_kind_from_path(&path) {
                let stem = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or(&file_name)
                    .to_string();
                let ext = path
                    .extension()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                items.push(WallpaperItem {
                    workshop_id: format!("custom:{file_name}"),
                    title: stem,
                    wallpaper_type: kind,
                    entry_file: Some(path.to_string_lossy().into_owned()),
                    preview_path: if kind == WallpaperKind::Image {
                        Some(path.to_string_lossy().into_owned())
                    } else {
                        None
                    },
                    tags: if ext.is_empty() {
                        vec!["custom".to_string()]
                    } else {
                        vec!["custom".to_string(), ext]
                    },
                    directory: dir.to_string_lossy().into_owned(),
                });
            }
        }
    }

    items.sort_by(|a, b| a.workshop_id.cmp(&b.workshop_id).then(a.title.cmp(&b.title)));

    Ok(WallpaperScanResult {
        workshop_app_id: STEAM_WALLPAPER_ENGINE_APP_ID,
        discovered_count: items.len(),
        searched_roots: vec![dir.to_string_lossy().into_owned()],
        library_paths: vec![dir.to_string_lossy().into_owned()],
        items,
    })
}

fn parse_project_json_item(
    item_dir: &Path,
    project_json_path: &Path,
    default_id: String,
) -> Option<WallpaperItem> {
    let raw = fs::read_to_string(project_json_path).ok()?;
    let json: Value = serde_json::from_str(&raw).ok()?;
    let obj = json.as_object()?;

    let workshop_id = obj
        .get("workshopid")
        .and_then(|v| match v {
            Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        })
        .unwrap_or(default_id);

    let title = obj
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| workshop_id.clone());

    let raw_file = obj
        .get("file")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let entry_file = raw_file.and_then(|rel| resolve_safe_child(item_dir, rel));

    let raw_type = obj
        .get("type")
        .and_then(Value::as_str)
        .map(|s| s.trim().to_ascii_lowercase());

    let wallpaper_type = match raw_type.as_deref() {
        Some("scene") => WallpaperKind::Scene,
        Some("web") => WallpaperKind::Web,
        Some("video") => WallpaperKind::Video,
        Some("image") | Some("picture") | Some("gif") => WallpaperKind::Image,
        _ => raw_file
            .and_then(|f| infer_kind_from_path(Path::new(f)))
            .unwrap_or(WallpaperKind::Scene),
    };

    let preview_path = obj
        .get("preview")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .and_then(|rel| resolve_safe_child(item_dir, rel))
        .or_else(|| find_preview_in_dir(item_dir));

    let tags = obj
        .get("tags")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default();

    Some(WallpaperItem {
        workshop_id,
        title,
        wallpaper_type,
        entry_file,
        preview_path,
        tags,
        directory: item_dir.to_string_lossy().into_owned(),
    })
}

fn find_preview_in_dir(dir: &Path) -> Option<String> {
    for candidate in ["preview.jpg", "preview.png", "preview.webp", "preview.gif"] {
        let p = dir.join(candidate);
        if p.is_file() {
            return Some(p.to_string_lossy().into_owned());
        }
    }
    None
}

fn resolve_safe_child(base: &Path, relative: &str) -> Option<String> {
    let normalized = relative.replace('\\', "/");
    let candidate = Path::new(&normalized);
    if candidate.is_absolute() {
        return None;
    }
    let mut joined = base.to_path_buf();
    for comp in candidate.components() {
        match comp {
            Component::Normal(part) => joined.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    Some(joined.to_string_lossy().into_owned())
}

fn infer_kind_from_path(path: &Path) -> Option<WallpaperKind> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "mp4" | "webm" | "mov" | "mkv" | "avi" => Some(WallpaperKind::Video),
        "html" | "htm" => Some(WallpaperKind::Web),
        "png" | "jpg" | "jpeg" | "webp" | "bmp" | "gif" => Some(WallpaperKind::Image),
        "json" | "pkg" => Some(WallpaperKind::Scene),
        _ => None,
    }
}

#[derive(Debug, PartialEq, Eq)]
enum VdfToken {
    OpenBrace,
    CloseBrace,
    Text(String),
}

fn tokenize_vdf(input: &str) -> Vec<VdfToken> {
    let mut tokens = Vec::new();
    let chars: Vec<char> = input.chars().collect();
    let mut i = 0usize;

    while i < chars.len() {
        let ch = chars[i];
        if ch.is_whitespace() {
            i += 1;
            continue;
        }
        if ch == '/' && i + 1 < chars.len() && chars[i + 1] == '/' {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        if ch == '{' {
            tokens.push(VdfToken::OpenBrace);
            i += 1;
            continue;
        }
        if ch == '}' {
            tokens.push(VdfToken::CloseBrace);
            i += 1;
            continue;
        }
        if ch == '"' {
            i += 1;
            let mut buf = String::new();
            while i < chars.len() {
                let c = chars[i];
                if c == '\\' && i + 1 < chars.len() {
                    let next = chars[i + 1];
                    match next {
                        '\\' => buf.push('\\'),
                        '"' => buf.push('"'),
                        'n' => buf.push('\n'),
                        't' => buf.push('\t'),
                        other => {
                            buf.push('\\');
                            buf.push(other);
                        }
                    }
                    i += 2;
                    continue;
                }
                if c == '"' {
                    i += 1;
                    break;
                }
                buf.push(c);
                i += 1;
            }
            tokens.push(VdfToken::Text(buf));
            continue;
        }

        // Unquoted bare token
        let mut buf = String::new();
        while i < chars.len() {
            let c = chars[i];
            if c.is_whitespace() || c == '{' || c == '}' || c == '"' {
                break;
            }
            buf.push(c);
            i += 1;
        }
        if !buf.is_empty() {
            tokens.push(VdfToken::Text(buf));
        }
    }

    tokens
}

fn is_numeric_key(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

fn normalize_path_key(path: &Path) -> String {
    let raw = path.to_string_lossy().replace('\\', "/");
    let trimmed = raw.trim_end_matches('/');
    #[cfg(target_os = "windows")]
    {
        trimmed.to_ascii_lowercase()
    }
    #[cfg(not(target_os = "windows"))]
    {
        trimmed.to_string()
    }
}

fn dedup_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for path in paths {
        let key = normalize_path_key(&path);
        if key.is_empty() {
            continue;
        }
        if seen.insert(key) {
            out.push(path);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_dir(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let dir = env::temp_dir().join(format!(
            "prismux-tauri-wallpaper-{prefix}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("create temp test dir");
        dir
    }

    #[test]
    fn parses_modern_and_legacy_vdf_paths() {
        let vdf = r#"
// Steam Library Folders
"libraryfolders"
{
    "0"
    {
        "path"        "C:\\Program Files (x86)\\Steam"
        "label"       ""
    }
    "1"
    {
        "path"        "D:\\Games\\SteamLibrary"
    }
    "2"               "E:\\LegacySteam"
}
"#;
        let libs = parse_library_folders_vdf(vdf);
        assert_eq!(libs.len(), 3);
        assert_eq!(libs[0], PathBuf::from(r"C:\Program Files (x86)\Steam"));
        assert_eq!(libs[1], PathBuf::from(r"D:\Games\SteamLibrary"));
        assert_eq!(libs[2], PathBuf::from(r"E:\LegacySteam"));
    }

    #[test]
    fn scans_steam_431960_workshop_items_from_vdf_libraries() {
        let root = make_temp_dir("steam431960");
        let steam_main = root.join("SteamMain");
        let lib_extra = root.join("SteamLibExtra");

        fs::create_dir_all(steam_main.join("steamapps")).unwrap();
        let item_scene = steam_main.join("steamapps/workshop/content/431960/100001");
        let item_web = lib_extra.join("steamapps/workshop/content/431960/200002");
        let item_video = lib_extra.join("steamapps/workshop/content/431960/300003");
        let item_image = lib_extra.join("steamapps/workshop/content/431960/400004");
        fs::create_dir_all(&item_scene).unwrap();
        fs::create_dir_all(&item_web).unwrap();
        fs::create_dir_all(&item_video).unwrap();
        fs::create_dir_all(&item_image).unwrap();

        let escaped_main = steam_main.to_string_lossy().replace('\\', "\\\\");
        let escaped_extra = lib_extra.to_string_lossy().replace('\\', "\\\\");
        let vdf_content = format!(
            "\"libraryfolders\"\n{{\n  \"0\"\n  {{\n    \"path\" \"{escaped_main}\"\n  }}\n  \"1\"\n  {{\n    \"path\" \"{escaped_extra}\"\n  }}\n}}\n"
        );
        fs::write(steam_main.join("steamapps/libraryfolders.vdf"), vdf_content).unwrap();

        fs::write(
            item_scene.join("project.json"),
            r#"{"title":"Quiet Prism Aurora","type":"scene","file":"scene.json","preview":"preview.jpg","tags":["Abstract","Sci-Fi"]}"#,
        )
        .unwrap();
        fs::write(item_scene.join("preview.jpg"), b"fakejpg").unwrap();

        fs::write(
            item_web.join("project.json"),
            r#"{"title":"Web Shader Horizon","type":"web","file":"index.html","tags":["Web"]}"#,
        )
        .unwrap();

        fs::write(
            item_video.join("project.json"),
            r#"{"title":"Rain Loop 4K","type":"video","file":"rain.mp4","tags":["Relaxing"]}"#,
        )
        .unwrap();

        fs::write(
            item_image.join("project.json"),
            r#"{"title":"Still Midnight","type":"image","file":"still.png","preview":"../escape.png"}"#,
        )
        .unwrap();

        let result = scan_steam_wallpapers_with_roots(&[steam_main.clone()]);
        assert_eq!(result.workshop_app_id, 431960);
        assert_eq!(result.discovered_count, 4);
        assert_eq!(result.items.len(), 4);

        let scene = result.items.iter().find(|i| i.workshop_id == "100001").unwrap();
        assert_eq!(scene.title, "Quiet Prism Aurora");
        assert_eq!(scene.wallpaper_type, WallpaperKind::Scene);
        assert!(scene.entry_file.as_deref().unwrap().ends_with("scene.json"));
        assert!(scene.preview_path.as_deref().unwrap().ends_with("preview.jpg"));
        assert_eq!(scene.tags, vec!["Abstract", "Sci-Fi"]);

        let web = result.items.iter().find(|i| i.workshop_id == "200002").unwrap();
        assert_eq!(web.wallpaper_type, WallpaperKind::Web);

        let video = result.items.iter().find(|i| i.workshop_id == "300003").unwrap();
        assert_eq!(video.wallpaper_type, WallpaperKind::Video);

        let image = result.items.iter().find(|i| i.workshop_id == "400004").unwrap();
        assert_eq!(image.wallpaper_type, WallpaperKind::Image);
        // Path traversal `../escape.png` must be rejected
        assert_eq!(image.preview_path, None);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn scans_custom_wallpaper_directory() {
        let root = make_temp_dir("custom");
        let sub_pkg = root.join("GlassWave");
        fs::create_dir_all(&sub_pkg).unwrap();
        fs::write(
            sub_pkg.join("project.json"),
            r#"{"title":"Glass Wave","type":"scene","file":"scene.pkg"}"#,
        )
        .unwrap();
        fs::write(root.join("ambient-loop.mp4"), b"mp4bytes").unwrap();
        fs::write(root.join("slate-minimal.png"), b"pngbytes").unwrap();

        let res = scan_custom_wallpapers_in_dir(&root).expect("scan custom dir");
        assert_eq!(res.discovered_count, 3);
        assert!(res
            .items
            .iter()
            .any(|i| i.title == "Glass Wave" && i.wallpaper_type == WallpaperKind::Scene));
        assert!(res
            .items
            .iter()
            .any(|i| i.title == "ambient-loop" && i.wallpaper_type == WallpaperKind::Video));
        assert!(res
            .items
            .iter()
            .any(|i| i.title == "slate-minimal" && i.wallpaper_type == WallpaperKind::Image));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn returns_cross_platform_steam_candidates() {
        let candidates = default_steam_candidates();
        assert!(!candidates.is_empty());
    }
}
