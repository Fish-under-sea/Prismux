# Prismux 品牌与视觉资产

本目录仅存放 **Prismux 一方原创品牌与文档视觉资产**，不再保留任何历史过渡或第三方渠道图标工程。

## 目录结构

| 路径 | 用途说明 |
| :--- | :--- |
| [`logo.png`](./logo.png) | Prismux 官方主形象原图（`1024 × 1024` PNG，吉祥物 `Ciallo~(∠・ω< )`），用于派生桌面图标与 README 主视觉 |
| [`prismux/`](./prismux/) | Prismux 官方多尺寸图标源（`prismux-32.png`、`prismux-128.png`、`prismux-256.png`、`prismux-512.png`、`prismux-1024.png`、`prismux-windows.ico`） |
| [`readme/`](./readme/) | 中英双语 README 立体像素头图、分栏横幅、仪表卡、8 秒实机动态演示与高清截图（详见 [`readme/MAINTAINING.md`](./readme/MAINTAINING.md)） |

## 图标引用与同步约定

- **权威路径映射**：[`scripts/lib/brand-assets.ts`](../scripts/lib/brand-assets.ts) 中的 `BRAND_ASSET_PATHS` 统一指向 `assets/prismux/*`，供桌面打包（`scripts/build-desktop-artifact.ts`）、服务端 CLI（`apps/server/scripts/cli.ts`）与 Web 静态资产分发共同消费。
- **项目配置与桌面启动器**：仓库根 [`prismux.json`](../prismux.json) 的 `iconPath` 指向 `assets/prismux/prismux-256.png`，[`apps/desktop/scripts/electron-launcher.mjs`](../apps/desktop/scripts/electron-launcher.mjs) 指向 `assets/prismux/prismux-1024.png`。
- **Web 静态图标同步**：运行 `node scripts/apply-web-brand-assets.ts [brand] [target-directory]` 可将 `assets/prismux/*` 图标复制到构建产物目录（默认 `apps/web/dist`）；[`apps/web/public/`](../apps/web/public/) 下跟踪的 `favicon.ico`、`favicon-16x16.png`、`favicon-32x32.png`、`apple-touch-icon.png`、`icon-192x192.png`、`icon-512x512.png` 与 `prismux-logo.png` 均为 Prismux 官方图标。
- **README 视觉资产重出**：修改文案或版本号后，在仓库根目录执行 `node scripts/render-readme.mjs` 全量重出 `assets/readme/` 像素横幅与卡片，维护规范见 [`assets/readme/MAINTAINING.md`](./readme/MAINTAINING.md)。
