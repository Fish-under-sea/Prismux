# Prismux README 视觉资产维护指南

> 本目录资产沿用 **Warm Paper / Dark Olive + Jersey 20 像素立体边框** 旗舰视觉规范。修改文案、版本号或栏目标题时，只需编辑 [`header.html`](./header.html) 与 [`section.html`](./section.html) 模板后全量重新渲染，严禁手绘拼贴不同批次数像素参数（防止跨栏目边框/栅格粗细不一致）。

## 渲染命令

在仓库根目录执行（默认从根 `package.json` 自动读取当前版本号，如 `0.1.2-preview.3`）：

```powershell
node scripts/render-readme.mjs
```

- 渲染器会创建隔离的临时浏览器资料目录启动无头 Microsoft Edge（不干扰日常浏览器配置），并在结束时自动清理临时目录；若 Edge 安装在非默认位置，可通过 `EDGE_BINARY` 环境变量指定可执行文件路径。
- 如需在版本号未合入根 `package.json` 前预览特定版本，可临时追加 `--version <ver>`。

## 产物尺寸与布局规范

| 资产类型 | 输出文件命名 | 尺寸（px） | README 展示方式 |
| :--- | :--- | :--- | :--- |
| 主视觉横幅 | `hero-{zh,en}-{light,dark}.png` | `1448 × 575` | `<picture>` 自适应暗/亮切换，`width="1448"` |
| 四张仪表卡 | `stat-{version,visual,memory,plugins}-{zh,en}-{light,dark}.png` | `357 × 189` | `<picture>` 并行四列，统一 `width="23%"` |
| 立体导航/行动按键 | `key-{zh,en,start,download,release,issues}-{zh,en}-{light,dark}.png` | 按文字自适应（同高） | `<picture>` 对齐展示，`height="40"` |
| 分栏标题横幅（8 栏） | `section-{intro,preview,features,plugins,install,packages,develop,thanks}-{zh,en}-{light,dark}.png` | `1432 × 83` | `<h2><picture>...</picture></h2>`，`width="100%"` |

所有渲染资产的尺寸、字节数与 SHA-256 摘要统一登记在 [`header-metadata.json`](./header-metadata.json)。

## 缓存破除与批次一致性

1. **禁止只重出单张图**：修改模板或调色后必须跑完整个 `node scripts/render-readme.mjs` 全量重出，确保全部横幅与仪表盘像素参数严格一致。
2. **GitHub 图床缓存破除**：GitHub `camo.githubusercontent.com` 按图片 URL 缓存内容。如果某一版已经发布后又调整了图片视觉内容，请为更新后的 PNG 递增文件名后缀（如 `-v2`）并同步更新 README 引用，否则远端页面可能继续显示旧缓存图。
3. **无溢出断言**：渲染脚本内建字体就位（`24px Jersey`）、图片加载（`logo.png`）、标题防溢出（`scrollWidth <= clientWidth`）、仪表卡零重叠与零控制台异常校验，任一失败会直接中止并报错。

## 字体与素材许可边界

- 像素字体 [`Jersey20-Regular.ttf`](./Jersey20-Regular.ttf) 遵循 [SIL Open Font License 1.1](./OFL-Jersey20.txt)。
- 吉祥物 [`logo.png`](./logo.png) 与界面实景截图 [`01-workbench-split-agy-v2.png`](./01-workbench-split-agy-v2.png) / [`02-wallpaper-inline-zoned-glass-v2.png`](./02-wallpaper-inline-zoned-glass-v2.png) / [`03-scoped-model-picker-dsh-fish-v2.png`](./03-scoped-model-picker-dsh-fish-v2.png) / [`04-settings-zoned-glass-capsule-v2.png`](./04-settings-zoned-glass-capsule-v2.png) / [`05-orca-workspace-dialog-v2.png`](./05-orca-workspace-dialog-v2.png) / [`06-statusbar-resources-keepawake-v2.png`](./06-statusbar-resources-keepawake-v2.png) 归属本仓项目资产；排版模板与渲染工具代码遵循仓库根 MIT 许可。
