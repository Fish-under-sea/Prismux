# Prismux Windows NSIS 安装包配置与静奢设计说明

> 对应规范：[`docs/specs/ui-ux-design-mandate.md`](../../../docs/specs/ui-ux-design-mandate.md)（第 3 节）与 [`docs/specs/master-prompt-v1.3.md`](../../../docs/specs/master-prompt-v1.3.md)。

## 1. 视觉基调（Quiet Luxury & Engineering Precision）

- **单色灰阶与微棱镜细线资产**：
  - [`sidebar.bmp`](./sidebar.bmp)：`164 × 314` 24-bit 无压缩 BMP，深石板灰阶渐变底色配合 `1px` 建筑细线与克制冷蓝几何棱镜线框。
  - [`header.bmp`](./header.bmp)：`150 × 57` 24-bit 无压缩 BMP，柔白石膏渐变底色配合右侧极简钢蓝棱镜线框与 `1px` 底部分隔线。
  - **禁用元素**：零刺眼霓虹大色块、零炫光粒子、零弹跳图标与夸大营销弹层。
- **安装脚本钩子**：[`prismux-installer.nsh`](./prismux-installer.nsh) 通过 Tauri v2 `bundle.windows.nsis.installerHooks` 挂载，采用 `SimpChinese` / `English` 双语声明。

## 2. 克制 5 步安装流程对照

| 步骤 | 页面名称 | 宿主契约（`src/installer_meta.rs`）与前端引导（`FirstRunWizard`）对照 |
| :--- | :--- | :--- |
| 第 1 步 | **欢迎** | 展示 Prismux 极简棱镜标志、核心定位（「极简液态玻璃 AI 超级工作台与 24h 秘书系统」）与版本信息 |
| 第 2 步 | **安装路径** | 目录选择、等宽数字（`tabular-nums`）所需/剩余空间对比，以及同级 `data/` 便携模式零残留说明 |
| 第 3 步 | **组件确认** | **显式硬编码声明**：仅安装极简高效内核（`apps/daemon` + `apps/workbench-ui` + `packages/memory-core`）；`qq`、`pet`、`fishdock-hook`、`ssh` 四大官方插件 `preinstalled: false`，默认绝不预装 |
| 第 4 步 | **安装中** | `1px–3px` 平滑细线进度条（`MUI_INSTFILESPAGE_PROGRESSBAR "smooth"`）、等宽百分比与当前解压/写入文件路径单行提示 |
| 第 5 步 | **完成** | 极简收尾状态提示与启动入口；首次启动进入简明外观与主秘书代理引导 |

## 3. 便携模式（`data/`）约定

在主程序可执行文件同级创建 `data/` 目录时：
- Rust 原生壳 `installer_meta::detect_portable_data_dir` 与 Daemon 侧 `resolvePortableDataDir` 同步识别为便携模式；
- SQLite 混合记忆库、插件加密凭据（`0600`）与日志全部收敛于 `data/` 内，不在系统用户目录写残留。
