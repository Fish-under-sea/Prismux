# Prismux Desktop Shell (Tauri v2)

本目录为 Prismux 的轻量透明原生桌面壳（Rust `edition = "2021"` / `rustc >= 1.85` / Tauri v2），严格保持视觉层对大模型 **0 Token 开销**。

## 核心模块（`src/`）

- `src/wallpaper.rs`：跨平台 Steam Workshop（`431960`）与自定义目录动态壁纸扫描器（解析 `libraryfolders.vdf` 与 `project.json`）。
- `src/audio.rs`：系统音频 FFT 32 频段频谱与 Now Playing 抽象桥接（含指数攻防平滑滤波与无设备静默降级）。
- `src/visibility.rs`：窗口最小化 / 遮挡 / 省电检测与 `0 FPS` 挂起状态机（派发 `prismux://visibility` 事件）。
- `src/installer_meta.rs`：5 步静奢安装向导契约与同级 `data/` 便携模式探测（显式断言四大官方插件默认不预装）。
- `src/lib.rs`：注册 8 个 Tauri IPC 命令及窗口生命周期监听（`Resized` / `Moved` / `Focused` / `Destroyed`）。

## 安装包与资产

- `icons/`：极简深蓝棱镜多尺寸 RGBA PNG 与 Windows 多帧 `icon.ico`。
- `installer/`：静奢单色灰阶 `sidebar.bmp`（`164×314`）、`header.bmp`（`150×57`）、NSIS 钩子 [`prismux-installer.nsh`](./installer/prismux-installer.nsh) 及设计对照 [`installer/README.md`](./installer/README.md)。

## 编译与单测门禁

在 Windows MSVC 环境下固定传入 `-j 1` 串行链接，避免并发访问冲突（`0xC0000005`）：

```powershell
cargo check -j 1 --manifest-path apps/desktop-tauri/Cargo.toml
cargo test -j 1 --manifest-path apps/desktop-tauri/Cargo.toml
```
