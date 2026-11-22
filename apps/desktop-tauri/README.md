# Prismux Desktop Shell (Tauri v2)

本目录为 Prismux 的轻量透明原生桌面壳骨架（目标里程碑：M4）。

## 定位与职责

- 无边框透明合成窗口（`transparent: true`、`decorations: false`），承载 `apps/workbench-ui/dist` 前端画布。
- M4 阶段将在 Rust 端补全以下宿主能力，且视觉层对大模型保持 0 Token 开销：
  - Steam Workshop（`431960`）与自定义动态壁纸目录扫描；
  - Windows WASAPI Loopback / macOS CoreAudio / Linux PipeWire 低延迟系统音频频谱采集；
  - 窗口最小化 / 全屏遮挡 / 锁屏检测与 `visibility: occluded` 挂起信号（降为 0 FPS）。

## 环境与构建说明

- Rust 工具链要求：`rustc >= 1.85`（`edition = "2021"`）。
- 当前 M1 波仅提供可审阅的骨架结构，`cargo check` 与打包验收将在 M4 阶段执行。
- 在 Windows MSVC 环境下如遇偶发链接器内存访问异常（`0xC0000005`），请使用 `cargo check -j 1` / `cargo test -j 1`。
