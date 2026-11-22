use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Official plugin IDs that must NEVER be preinstalled in the minimal Prismux installer.
pub const OFFICIAL_OPTIONAL_PLUGIN_IDS: [&str; 4] = ["qq", "pet", "fishdock-hook", "ssh"];

pub const COMPONENT_CONFIRMATION_NOTICE: &str = "仅安装极简高效内核（守护中枢 + 工作台界面 + 单文件 SQLite 记忆引擎）；QQ 机器人、桌宠、FISH-Dock 灵动岛、SSH 运维四大官方独立插件默认绝不预装，安装完成后可在内置插件市场按需选装。";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallerStepMeta {
    pub step: u8,
    pub id: String,
    pub title: String,
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptionalOfficialPluginMeta {
    pub id: String,
    pub package_name: String,
    pub display_name: String,
    pub preinstalled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallerPlan {
    pub app_name: String,
    pub version: String,
    pub minimal_core_only: bool,
    pub core_components: Vec<String>,
    pub steps: Vec<InstallerStepMeta>,
    pub official_plugins: Vec<OptionalOfficialPluginMeta>,
    pub component_confirmation_notice: String,
    pub portable_mode_detected: bool,
    pub portable_data_dir: Option<String>,
}

/// Detects whether a sibling `data/` directory exists alongside the executable directory,
/// enabling zero-residue Portable Mode.
pub fn detect_portable_data_dir(executable_dir: &Path) -> Option<PathBuf> {
    let candidate = executable_dir.join("data");
    if candidate.is_dir() {
        Some(candidate)
    } else {
        None
    }
}

/// Returns the restrained 5-step installer / first-run wizard metadata.
pub fn installer_steps() -> Vec<InstallerStepMeta> {
    vec![
        InstallerStepMeta {
            step: 1,
            id: "welcome".to_string(),
            title: "欢迎".to_string(),
            summary: "Prismux — 极简液态玻璃 AI 超级工作台与 24h 秘书系统".to_string(),
        },
        InstallerStepMeta {
            step: 2,
            id: "install-path".to_string(),
            title: "安装路径".to_string(),
            summary: "选择安装目录并核对所需/剩余磁盘空间；支持同级 data/ 便携模式零残留运行。"
                .to_string(),
        },
        InstallerStepMeta {
            step: 3,
            id: "components".to_string(),
            title: "组件确认".to_string(),
            summary: COMPONENT_CONFIRMATION_NOTICE.to_string(),
        },
        InstallerStepMeta {
            step: 4,
            id: "installing".to_string(),
            title: "安装中".to_string(),
            summary: "1px–3px 静奢细线进度条、等宽百分比读数与当前写入文件单行提示。".to_string(),
        },
        InstallerStepMeta {
            step: 5,
            id: "complete".to_string(),
            title: "完成".to_string(),
            summary: "极简内核安装完成，可立即启动工作台并按需选装插件市场扩展。".to_string(),
        },
    ]
}

/// Returns the official plugin preinstall contract list (all strictly `preinstalled: false`).
pub fn official_plugins_contract() -> Vec<OptionalOfficialPluginMeta> {
    let plugins = vec![
        OptionalOfficialPluginMeta {
            id: "qq".to_string(),
            package_name: "@prismux/plugin-qq".to_string(),
            display_name: "QQ 机器人".to_string(),
            preinstalled: false,
        },
        OptionalOfficialPluginMeta {
            id: "pet".to_string(),
            package_name: "@prismux/plugin-pet".to_string(),
            display_name: "桌宠联动".to_string(),
            preinstalled: false,
        },
        OptionalOfficialPluginMeta {
            id: "fishdock-hook".to_string(),
            package_name: "@prismux/plugin-fishdock-hook".to_string(),
            display_name: "FISH-Dock 灵动岛".to_string(),
            preinstalled: false,
        },
        OptionalOfficialPluginMeta {
            id: "ssh".to_string(),
            package_name: "@prismux/plugin-ssh".to_string(),
            display_name: "SSH 运维".to_string(),
            preinstalled: false,
        },
    ];

    assert!(
        plugins.iter().all(|p| !p.preinstalled),
        "all 4 official plugins must never be preinstalled"
    );
    plugins
}

/// Builds the full 5-step installer contract and probes Portable `data/` mode.
pub fn build_installer_plan(executable_dir: Option<&Path>) -> InstallerPlan {
    let detected_exe_dir = executable_dir.map(Path::to_path_buf).or_else(|| {
        std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(Path::to_path_buf))
    });

    let portable_dir = detected_exe_dir
        .as_deref()
        .and_then(detect_portable_data_dir);

    let steps = installer_steps();
    let official_plugins = official_plugins_contract();
    assert_eq!(steps.len(), 5, "installer must expose exactly 5 steps");
    assert!(
        official_plugins.iter().all(|p| !p.preinstalled),
        "minimal installer contract forbids preinstalling official plugins"
    );

    InstallerPlan {
        app_name: "Prismux".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        minimal_core_only: true,
        core_components: vec![
            "apps/daemon (24h 无头守护中枢)".to_string(),
            "apps/workbench-ui (液态玻璃与分屏工作台)".to_string(),
            "packages/memory-core (单文件 SQLite 记忆引擎)".to_string(),
        ],
        steps,
        official_plugins,
        component_confirmation_notice: COMPONENT_CONFIRMATION_NOTICE.to_string(),
        portable_mode_detected: portable_dir.is_some(),
        portable_data_dir: portable_dir.map(|p| p.to_string_lossy().into_owned()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_dir(prefix: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "prismux-tauri-installer-{prefix}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("create temp test dir");
        dir
    }

    #[test]
    fn enforces_five_steps_and_zero_preinstalled_official_plugins() {
        let plan = build_installer_plan(None);
        assert!(plan.minimal_core_only);
        assert_eq!(plan.steps.len(), 5);
        let titles: Vec<&str> = plan.steps.iter().map(|s| s.title.as_str()).collect();
        assert_eq!(titles, vec!["欢迎", "安装路径", "组件确认", "安装中", "完成"]);

        assert_eq!(plan.official_plugins.len(), 4);
        for expected_id in OFFICIAL_OPTIONAL_PLUGIN_IDS {
            let entry = plan
                .official_plugins
                .iter()
                .find(|p| p.id == expected_id)
                .expect("official plugin metadata present");
            assert!(
                !entry.preinstalled,
                "official plugin {expected_id} must NOT be preinstalled"
            );
        }
        assert!(plan.component_confirmation_notice.contains("默认绝不预装"));
    }

    #[test]
    fn detects_sibling_portable_data_directory() {
        let root = make_temp_dir("portable");
        assert_eq!(detect_portable_data_dir(&root), None);

        // Regular file named `data` must not trigger portable directory mode
        let data_path = root.join("data");
        fs::write(&data_path, b"not-a-dir").unwrap();
        assert_eq!(detect_portable_data_dir(&root), None);
        let _ = fs::remove_file(&data_path);

        // Actual `data/` directory triggers portable mode
        fs::create_dir_all(&data_path).unwrap();
        let detected = detect_portable_data_dir(&root).expect("portable data dir detected");
        assert_eq!(detected, data_path);

        let plan = build_installer_plan(Some(&root));
        assert!(plan.portable_mode_detected);
        assert_eq!(
            plan.portable_data_dir.as_deref(),
            Some(data_path.to_string_lossy().as_ref())
        );

        let _ = fs::remove_dir_all(&root);
    }
}
