# T3 Code 最小入侵挂载点登记规范与台账（v0.1.0）

> 本文档是 Prismux 对 [`vendor/t3code`](../vendor/t3code) 本体执行最小入侵二次开发的**唯一权威补丁台账**（关联跨机器口径 [`AGENTS.md`](../AGENTS.md)）。
> 所有外置重逻辑与视觉界面必须独立沉淀在 `packages/prismux-appearance`、`packages/prismux-wallpaper`、`packages/protocol`、`packages/memory-core`、`packages/cordis-kernel`、`packages/sync-vault`、`apps/daemon` 与 `plugins-official/*`；对 T3 Code 本体的改动严格收敛在下方 **MP-01 ~ MP-06 标准化挂载点**及授权登记的 **MP-07 Provider / ACP 扩展点**内。

---

## 一、上游基线与托管治理（同步自 [`UPSTREAM_LOCK.json`](../UPSTREAM_LOCK.json)）

| 字段 | 当前实际值 | 说明 |
| :--- | :--- | :--- |
| 上游仓库 | `https://github.com/pingdotgg/t3code.git` | T3 Code 官方上游仓库 |
| 基线分支 | `main` | 上游追踪分支 |
| 基线 Commit SHA | `b23f1e8af9b13af2c4aa1ba8e0d6987550688645` | 当前二次开发的干净上游基线 |
| 同步时间 | `2026-11-22T21:25:00+08:00` | 最近一次记录时间 |
| 上游许可 | `MIT` | 保留上游版权与开源许可声明 |
| 托管模式（`mode` / `readOnly`） | `managed-fork` / `false` | 已从只读子模块转为 Prismux 主仓常规托管源码目录（已移除 `.gitmodules`、`vendor/t3code/.git` 与 `.repos/`） |
| 补丁台账（`patchManifest`） | [`docs/t3code-patch-manifest.md`](./t3code-patch-manifest.md) | 根脚本 [`scripts/sync-t3-upstream.ts`](../scripts/sync-t3-upstream.ts) 校验的登记清单入口（`managed-fork` 模式下拦截破坏性 `--sync`） |

---

## 二、最小入侵登记规范（必遵规则）

1. **薄胶水原则（Thin-Glue Only）**：`vendor/t3code/` 内的改动只允许做路由注册、容器挂接、IPC/RPC 透传、窗口状态/遮挡广播、品牌/本地化与受控 Provider 修复扩展；禁止把壁纸扫描器、液态玻璃光学引擎、三域记忆库或插件内核源码直接写进 `vendor/t3code/`。
2. **先登记后改线 / 同提交闭环**：新增或调整任何挂载点代码时，必须在同一轮提交中同步在本台账补全「实际文件路径（相对 `vendor/t3code/`）」「精确行号范围与关键符号」「接入的外置包名」及「冲突风险评级」。
3. **禁止未登记散落侵入**：代码审查或验收时，通过对比基线 Commit `b23f1e8af9b13af2c4aa1ba8e0d6987550688645` 的文件变更清单核对所有改动路径，任何未在本台账登记的 `vendor/t3code/` 源码修改一律退回重构。
4. **0-Token 视觉铁律**：MP-01 ~ MP-04 注入的壁纸、液态玻璃与外观调控组件属于纯宿主视觉层，严禁向 T3 Code Provider 会话注入额外工具定义或 System Prompt。
5. **四大官方插件零预装底线**：MP-06 的桌面安装包构建流程必须显式断言打包产物不含 `plugins-official/*` 任何插件（`qq`、`pet`、`fishdock-hook`、`ssh`）。
6. **零改上游锁文件原则**：通过 `apps/web/vite.config.ts` 的 `resolve.alias` 与 `apps/web/tsconfig.json` 的 `paths` 直接消费主仓 `@prismux/appearance` 与 `@prismux/wallpaper` 编译产物，不修改 `vendor/t3code/pnpm-lock.yaml`。

---

## 三、标准化挂载点与 Provider 扩展点总览

> 当前状态：**MP-01 ~ MP-06 与 MP-07（Issue #1）全部「已落地实施」**，已完成 `v0.1.0-alpha.2` 去重、桌面壁纸透底治本、中文汉化、`/welcome` 入门引导恢复及本机 `agy` CLI / 全模型 `thought_level` 修复。

| 挂载点 ID | 状态 | 核心挂载入口与新增桥接（相对 `vendor/t3code/`） | 接入外置包 / 能力 | 最小入侵核心职责 | 上游合并冲突风险 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **MP-01** | 已落地实施 | **修改**：`apps/web/vite.config.ts`、`apps/web/tsconfig.json`、`apps/web/src/AppRoot.tsx`、`apps/web/src/routes/__root.tsx`、`apps/web/src/hooks/useTheme.ts`、`apps/web/src/index.css`<br>**新增**：`apps/web/src/prismux/{daemonClient,PrismuxRuntimeProvider,PrismuxWallpaperBridge}.tsx/.ts` | `@prismux/wallpaper`<br>`@prismux/appearance`<br>`@prismux/daemon` HTTP/WS | 配置 Vite/TS 别名映射、挂载 `<PrismuxRuntimeProvider>` 与 Z-0 `<PrismuxWallpaperBackdrop />`；修复浅/深/玻璃三态透底、`99%` 黑幕历史值自愈与冷启动 Daemon 重试；`.electron-windows.wco` 锁死 138px 三键安全留白 | **低** |
| **MP-02** | 已落地实施 | **修改**：`apps/web/src/components/sidebar/SidebarChrome.tsx`、`apps/web/src/components/onboarding/{FirstRunGate,WelcomePage}.tsx`、`WelcomePage.import.browser.test.tsx`、`apps/web/src/components/settings/SettingsPanels.tsx`、`apps/web/src/components/ChatView.tsx`<br>**复用未改**：`DesktopWindow.ts`（标题栏样式） | `@prismux/appearance`<br>`@prismux/wallpaper`<br>Ciallo Logo 资产 | 侧栏与 `/welcome` 挂载 Ciallo Logo 与 `Prismux` 品牌；**恢复桌面端首次 `/welcome` 入门引导**（离线隐藏 Clerk 云端项）并在设置页提供「重新查看入门引导」；聊天顶栏嵌入 `<PrismuxTopbarControls />`（WCO 避让留白） | **低–中** |
| **MP-03** | 已落地实施 | **修改**：`apps/web/src/rightPanelStore.ts`、`apps/web/src/components/RightPanelTabs.tsx`、`apps/web/src/components/chat/RightPanelSurfaceContent.tsx`、`apps/web/src/components/chat/useRightPanelActions.ts`、`apps/web/src/components/ChatView.tsx`<br>**桥接**：`apps/web/src/prismux/PrismuxWallpaperBridge.tsx`（`PrismuxWallpaperQuickPanel`） | `@prismux/wallpaper`<br>`@prismux/appearance` | 注册 `"wallpaper"` 右侧面板单例表面与 `+` 菜单入口；Issue #3 去重后收敛为纯净双页签 **`壁纸 / 播放`** 边栏，底栏直达 `/settings/appearance` 与 `/settings/wallpaper` | **低** |
| **MP-04** | 已落地实施 | **新增**：`apps/web/src/prismux/settings/{PrismuxAppearanceIntegration,PrismuxWallpaperSettingsPage,PrismuxPluginsSettingsPage,PrismuxMemorySyncSettingsPage,PrismuxUpdatesSettingsPage}.tsx`、`apps/web/src/routes/_chat.settings.{wallpaper,plugins,memory-sync,updates}.tsx`、`apps/web/src/i18n/zhCatalog.test.ts`<br>**自动生成**：`apps/web/src/routeTree.gen.ts`<br>**修改**：`apps/web/src/components/settings/{AppearanceSettingsPanel,settingsSearch,settingsSearch.test,SettingsSidebarNav,SettingsScopeSentence}.ts(x)`、`apps/web/src/i18n/translations/*.json` | `@prismux/appearance`<br>`@prismux/wallpaper`<br>`@prismux/daemon`<br>`gt-react` i18n 词典 | **外观与壁纸彻底去重**（`/settings/appearance` 收纳全套 6 张外观卡并折叠 T3 重复项；`/settings/wallpaper` 收敛为 4 个壁纸专属页签）；补齐 `zh.json`（及 10 locale 对齐）设置侧栏与搜索中文化 | **低** |
| **MP-05** | 已落地实施 | **新增**：`apps/desktop/src/prismux/PrismuxDaemonService.ts`、`apps/desktop/src/ipc/methods/prismux.ts`<br>**修改**：`packages/contracts/src/ipc.ts`、`apps/desktop/src/ipc/{channels,DesktopIpcHandlers}.ts`、`apps/desktop/src/preload.ts`、`apps/desktop/src/window/DesktopWindow.ts`、`apps/desktop/src/main.ts`、`apps/desktop/src/app/{DesktopApp.ts,DesktopApp.test.ts}`<br>**复用未改**：`ElectronProtocol.ts`、`DesktopUpdates.ts` | `@prismux/daemon`<br>Electron `ElectronUpdater` / `ElectronDialog` | 随 Electron 生命周期安全拉起/关闭 `@prismux/daemon`（子进程隔离 `ELECTRON_RUN_AS_NODE=1`）、广播窗口遮挡 `0 FPS` 信号、暴露 `DesktopBridge.prismux` 6 通道与双源 feed URL 切换 | **中** |
| **MP-06** | 已落地实施 | **新增资产**：`assets/prismux/*`、`apps/web/public/{prismux-logo.png,favicon.ico,favicon-16x16.png,favicon-32x32.png,apple-touch-icon.png,icon-192x192.png,icon-512x512.png}`<br>**修改**：`apps/desktop/package.json`、`apps/desktop/src/app/{DesktopEnvironment,DesktopStatePaths,DesktopUserData,DesktopAppIdentity,DesktopEarlyElectronStartup,DesktopAssets}.ts`、`scripts/lib/brand-assets.ts`、`scripts/build-desktop-artifact.ts`、`apps/desktop/resources/installer.nsh`、`apps/web/{src/branding.ts,src/branding.logic.ts,vite.config.ts,index.html,public/manifest.webmanifest}` | `assets/prismux/*`<br>`apps/daemon/dist`<br>`@prismux/{protocol,memory-core,cordis-kernel,sync-vault}` | 统一品牌为 `Prismux` / `io.prismux.desktop` 与独立 `~/.prismux` 目录、映射 Ciallo 图标；`build-desktop-artifact.ts` 显式映射 `PRISMUX_DAEMON_EXTRA_RESOURCES` 避开 `electron-builder` `node_modules` 过滤并写入 `prismux-daemon` 版本，保持四大官方插件零预装 | **低–中** |
| **MP-07**（Provider 扩展点 · Issue #1） | 已落地实施 | **修改**：`packages/contracts/src/settings.ts`、`packages/provider-acp/src/server/sessionConfig.ts`、`packages/provider-acp-registry/src/server/{probe.ts,driver.test.ts}`、`apps/server/src/provider/{antigravityAuthSupport,AntigravityInstallation,antigravityUsageLimits,AntigravityAuth,AntigravityProvider}.ts(.test.ts)`、`acp/AntigravityAcpSupport.ts`、`Drivers/AntigravityDriver.ts`、`apps/web/src/components/settings/{ProviderSettingsForm,ProviderAuthenticationSection,ProviderSetupSection,ProviderSettingsPanel,AddProviderInstanceDialog}.tsx`、`apps/web/src/components/chat/{ComposerModelEffort.tsx,useComposerSelection.ts,composerProviderState.test.tsx}` | 内置 Google Antigravity + `agy acp` + 通用 ACP Registry | 内置 Antigravity 支持 `local-cli` 复用本机 `~/.gemini/antigravity-cli` / keyring 登录态并保留谷歌彩色图标与配额查询；服务端按模型轮询全量解析 `thought_level`（`low/medium/high/xhigh`），前端切模型即时同步与清洗过期档位 | **中** |

---

## 四、MP-01 ~ MP-07 实际落地明细（基于基线 `b23f1e8af9b13af2c4aa1ba8e0d6987550688645`）

### MP-01：根外壳、Vite/TS 别名映射与 Z-0 / Z-1 视觉桥（状态：已落地实施）

| 类别 / 目标文件（相对 `vendor/t3code/`） | 实际行号 / 导出符号 | 实际落地职责与最小入侵细节 |
| :--- | :--- | :--- |
| **[修改]** `apps/web/vite.config.ts` | `L380-L413`（`resolve.dedupe`、`resolve.alias`）、`L422-L424`（`server.fs.allow`） | 映射 `@prismux/appearance{/styles.css}` 与 `@prismux/wallpaper{/styles.css}` 至主仓 `packages/*/dist`；`resolve.dedupe: ["react", "react-dom"]` 避免双 React 实例；放行主仓根目录读取（零改动 `vendor/t3code/pnpm-lock.yaml`） |
| **[修改]** `apps/web/tsconfig.json` | `L13-L14`（`compilerOptions.paths`） | 声明 `@prismux/appearance` 与 `@prismux/wallpaper` 指向对应 `dist/index.d.ts` |
| **[新增]** `apps/web/src/prismux/daemonClient.ts` | `DaemonConnectionInfo`、`PrismuxDaemonError`、`PrismuxDaemonClient`、`prismuxDaemonClient` | 经 `window.desktopBridge?.prismux?.getDaemonInfo()` 获取地址与 Bearer Token（非 Electron 降级可用），覆盖壁纸/字体/外观/Chief/记忆/同步/插件/更新器 API 与 `?token=` 媒体 URL 构造 |
| **[新增]** `apps/web/src/prismux/PrismuxRuntimeProvider.tsx` | `PrismuxDialMode`、`PrismuxRuntimeContextValue`、`PrismuxRuntimeProvider`、`usePrismuxRuntime` | 首帧从 `localStorage` 恢复并异步水合 Daemon（Electron 冷启动增设 `40 × 300ms` 有界等待重试 + `fetchInventory` 强制重连）；写入 `data-pmx-wallpaper="1"` / `data-pmx-wallpaper-visible="1"` 并用 `MutationObserver` 清除深/浅模式 `html/body` 内联背景色；归一旧版 `wallpaperOpacity > 90` / `scrim > 1` 自愈回写；订阅 `onWindowOcclusionChange`、`visibilitychange` 与 `window.focus` 解除早期遮挡卡死 |
| **[新增]** `apps/web/src/prismux/PrismuxWallpaperBridge.tsx` | `PrismuxWallpaperBackdrop`、`PrismuxWallpaperQuickPanel`、`PrismuxTopbarControls` | `L20-L60` 挂载 Z-0 `<WallpaperStage />`；`L66-L82` 挂载 Issue #3 去重后双页签 `<WallpaperQuickPanel dock="official" />`；`L102-L184` 渲染顶栏主秘书胶囊与壁纸开关（`L117` 按右侧面板展开态切换 `mr-10` / `mr-28` 避让 Windows `.wco` 三键） |
| **[修改]** `apps/web/src/AppRoot.tsx` | `L1-L2`（样式导入）、`L9, L18-L22`（`AppRoot`） | 引入 `@prismux/appearance/styles.css` 与 `@prismux/wallpaper/styles.css`，以 `<PrismuxRuntimeProvider router={router}>` 包裹路由器与桌面宿主，跨路由保持壁纸与状态常驻 |
| **[修改]** `apps/web/src/routes/__root.tsx` | `L64`（导入）、`L213`（`appShell` `relative z-[1] h-dvh w-full`）、`L225`（`<PrismuxWallpaperBackdrop />`） | 在根路由底层挂载 Z-0 全屏壁纸舞台并将工作台置于 `z-[1]`，不遮挡挂载于 `body` 的浮窗 Portal |
| **[修改]** `apps/web/src/hooks/useTheme.ts` | `L279-L300`（`syncBrowserChromeTheme`） | 当 `html[data-pmx-glass="1"]` 时清除 `html/body` 内联 `backgroundColor` 让壁纸透出，同时保持 `meta[name="theme-color"]` 与 `syncDesktopTheme` 同步（非玻璃透底由 `t3-glass-bridge.css` 与 `PrismuxRuntimeProvider` 协同兜底） |
| **[修改]** `apps/web/src/index.css` | `L169-L178`（`.electron-windows.wco`）、`L365`（`@utility surface-glass`） | 新增 `.electron-windows.wco` 用 `max(calc(138px + 0.75rem), ...)` 锁死 Windows 138px 原生最小化/最大化/关闭三键安全留白；原生主题变量继续由 `t3-glass-bridge.css` 属性门控接管 |

### MP-02：顶栏集成、Ciallo 品牌展示与 `/welcome` 入门引导（状态：已落地实施）

| 类别 / 目标文件（相对 `vendor/t3code/`） | 实际行号 / 导出符号 | 实际落地职责与最小入侵细节 |
| :--- | :--- | :--- |
| **[修改]** `apps/web/src/components/sidebar/SidebarChrome.tsx` | `L173, L189-L191, L200`（`SidebarBrand`） | 替换原品牌展示为 `/prismux-logo.png` 与 `"Prismux"` 字标（`aria-label` 对齐 `"Prismux home"`），保留 `L66` `isElectron && "drag-region"` |
| **[修改]** `apps/web/src/components/onboarding/FirstRunGate.tsx` | `L91-L97`（`FirstRunGate`）、`L202`（恢复提示） | 移除旧版 `bypassDesktopOnboarding` 强制跳过，**恢复桌面端全新首次启动正常进入 `/welcome` 入门引导**（完成或跳过写入 `onboardingCompletedAt` 后再启动直达工作台）；`L202` 提示语替换 `"T3 Code"` 为 `"Prismux"` |
| **[修改]** `apps/web/src/components/onboarding/WelcomePage.tsx` & `WelcomePage.import.browser.test.tsx` | `WelcomePage.tsx:284-290, 362, 1001, 1027` | 顶部主视觉区接入 `/prismux-logo.png` 与 `Welcome to Prismux`；全面替换页面/手机联动区残留 `"T3 Code"` 文案为 `"Prismux"`；离线环境由 `hasCloudPublicConfig() === false` 自动隐藏 Clerk 云端引导，同步更新浏览器导入单测 |
| **[修改]** `apps/web/src/components/settings/SettingsPanels.tsx` | `L1221-L1225`（`GeneralSettingsPanel`）、`L2575-L2581`（`AboutSettingsPanel` `welcome-page`） | 在通用设置底部新增 `"Reopen onboarding"`（重新查看入门引导）分区，并统一关于页入口文案，支持老用户随时跳转 `/welcome` |
| **[修改]** `apps/web/src/components/ChatView.tsx` | `L37`（导入）、`L3384`（`openChiefSettingsStable` 跳转 `/settings/memory-sync`）、`L3554-L3560`（`<PrismuxTopbarControls />`） | 在聊天顶栏工作区操作区挂载主秘书槽位状态徽标与壁纸边栏开关，按钮保留 `[-webkit-app-region:no-drag]`，配合 `.electron-windows.wco` 确保零遮挡系统三键 |
| **[复用未改]** `DesktopWindow.ts` / `AppSidebarLayout.tsx` / `WorkspacePageHeader.tsx` | `DesktopWindow.ts:361`（`setTitleBarOverlay`） | 原封复用上游无边框窗口、`titleBarOverlay` 自适应三键与侧栏/顶栏结构 |

### MP-03：右侧面板原生 `"wallpaper"` Tab 注册与极简双页签边栏（状态：已落地实施）

| 类别 / 目标文件（相对 `vendor/t3code/`） | 实际行号 / 导出符号 | 实际落地职责与最小入侵细节 |
| :--- | :--- | :--- |
| **[修改]** `apps/web/src/rightPanelStore.ts` | `L35`（`RIGHT_PANEL_KINDS`）、`L114-L115`（`RightPanelSurface`）、`L305-L306`（`singletonSurface`） | 新增 `"wallpaper"` Kind 与 `{ id: "wallpaper", kind: "wallpaper" }` 单例表面 |
| **[修改]** `apps/web/src/components/RightPanelTabs.tsx` | `L52, L161-L172, L202, L228, L352-L362, L428-L440, L646-L647, L758-L759, L1287-L1298, L1732-L1741` | 注册 `"wallpaper"` 表面标题、提示语、图标、空态启动动作与 `+` 新建菜单入口（Prop 保持可选，零破坏既有调用方） |
| **[修改]** `apps/web/src/components/chat/RightPanelSurfaceContent.tsx` | `L31`（导入）、`L272-L273`（`case "wallpaper"`） | 挂载 Issue #3 去重后的 `<PrismuxWallpaperQuickPanel />`（仅保留 **`壁纸 / 播放`** 2 个高频页签与底栏快捷入口 `外观与玻璃 ›` / `壁纸引擎设置 ›`，移除重复的外观表单堆叠） |
| **[修改]** `apps/web/src/components/chat/useRightPanelActions.ts` | `L174-L183`、`L361, L380` | 新增并导出 `addWallpaperSurfaceStable` 与 `toggleWallpaperSurfaceStable` |
| **[修改]** `apps/web/src/components/ChatView.tsx` | `L2484, L2502`、`L4222, L4231` | 接入 `addWallpaperSurfaceStable` / `toggleWallpaperSurfaceStable` 并向 `<ChatRightPanel>` 透传 `onAddWallpaper` 与 `wallpaperAvailable` |

### MP-04：设置去重整合、Prismux 中文汉化与 4 大独立设置页面（状态：已落地实施）

| 类别 / 目标文件（相对 `vendor/t3code/`） | 实际行号 / 导出符号 | 实际落地职责与最小入侵细节 |
| :--- | :--- | :--- |
| **[修改]** `apps/web/src/prismux/settings/PrismuxAppearanceIntegration.tsx` | `L18-L111`（`PrismuxAppearanceIntegration`） | Issue #3 大一统收敛：在 `/settings/appearance` 启用全套 **6 张外观专属卡**（`ThemeHeroCard` 含天体胶囊与紧凑 `"前往壁纸引擎 ›"` 入口、`LiquidGlassCard` 含折叠区「各面独立精细调节」、`SidebarCornersCard`、`UiColorsCard`、`TypographyCard` 直连 `systemFonts` 与 `refreshSystemFonts`、`ThemeSnapshotCard`） |
| **[修改]** `apps/web/src/components/settings/AppearanceSettingsPanel.tsx` | `L40, L153`（挂载）；`L303-L480, L486-L504`（`<AdvancedSettings>`） | 在顶部挂载 `<PrismuxAppearanceIntegration />`，并将 T3 Code 原生 `setting-glass-opacity` 与 `<ThemeLibrary />` 优雅折叠进 `<AdvancedSettings>`，彻底消除同页重复主题切换器同时保留搜索自动展开锚点 |
| **[修改]** `apps/web/src/prismux/settings/PrismuxWallpaperSettingsPage.tsx` | `L15-L20`（`VALID_TABS`）、`L41-L116`（`PrismuxWallpaperSettingsPage`） | Issue #3 去重：移除重复「外观」页签，收敛为 **4 个壁纸专属页签（`library / playback / rotation / system`）**，页头保留 `"前往外观与玻璃设置 ›"` 跳转入口 |
| **[新增]** `apps/web/src/prismux/settings/PrismuxPluginsSettingsPage.tsx` | `PrismuxPluginsSettingsPage` | 顶部显式声明「四大官方插件（`qq` / `pet` / `fishdock-hook` / `ssh`）默认零预装」；对接 Cordis 目录/启停/卸载/免 Git 社区 npm 导入，并在 `modelVisible: true` 或 `409` 时弹出权限审计二次确认 |
| **[新增]** `apps/web/src/prismux/settings/PrismuxMemorySyncSettingsPage.tsx` | `PrismuxMemorySyncSettingsPage` | 集成主秘书热切与 `agent / oracle / review` 三档拨盘、SQLite `WAL + FTS5 + sqlite-vec` 统计与检索（含 `qq_group` 物理隔离展示）、Obsidian 导入及 Magpie 加密同步三通道配置（凭据只写不回显明文） |
| **[新增]** `apps/web/src/prismux/settings/PrismuxUpdatesSettingsPage.tsx` | `PrismuxUpdatesSettingsPage` | 集成软件更新 GitHub ↔ Gitee、插件源 npm ↔ npmmirror 国内外双源切换、延迟探测，并联动 `window.desktopBridge?.prismux?.setUpdateFeedUrl()` |
| **[新增]** `apps/web/src/routes/_chat.settings.{wallpaper,plugins,memory-sync,updates}.tsx` | 4 个 TanStack File Routes | 注册 `/_chat/settings/wallpaper`、`/_chat/settings/plugins`、`/_chat/settings/memory-sync`、`/_chat/settings/updates` |
| **[自动更新]** `apps/web/src/routeTree.gen.ts` | TanStack Router 生成路由树 | 由 `effect-tsgo tsrs` / `vp build` 自动生成，注册上述 4 条设置子路由 |
| **[修改]** `apps/web/src/components/settings/settingsSearch.ts` & `settingsSearch.test.ts` | `L44-L47, L125-L128, L161-L169, L1512-L1541, L1565-L1568`；`L1747-L1768`（`searchSettings`） | 注册 Prismux 设置路径、导航组与搜索项；规范化英文源 `searchTerms` 并升级 `searchSettings()` 使 `localizedTitle`（如「壁纸引擎 / 插件中心 / 记忆与同步 / 软件更新 / 入门引导」）在中文搜索时享同等最高匹配权重 |
| **[修改]** `apps/web/src/components/settings/SettingsSidebarNav.tsx` | `L16-L17, L22, L31`（导入图标）、`L122-L125`（`SETTINGS_SECTION_ICONS`） | 注册 `ImageIcon`、`PuzzleIcon`、`DatabaseIcon`、`DownloadCloudIcon` 映射 |
| **[修改]** `apps/web/src/components/settings/SettingsScopeSentence.tsx` | `L61-L64`（`SETTINGS_DEVICE_ONLY_PATHS`） | 将 4 条 Prismux 设置路径加入设备级路由白名单，配合 `_chat.settings.tsx`（`L101, L170`）正常放行渲染 |
| **[修改 / 新增]** `apps/web/src/i18n/translations/{en,zh,de,es,fr,ja,ko,pt-BR,ru,sv}.json` & `apps/web/src/i18n/zhCatalog.test.ts` | `zh.json`（`Wallpaper → 壁纸引擎`、`Plugins → 插件中心`、`Memory & Sync → 记忆与同步`、`Prismux Updates → 软件更新`、`Welcome page → 入门引导`） | 经 `gt generate` 补齐全部 10 种语言词典键集（含 Issue #2 侧栏/面包屑/搜索词条、Prismux `/welcome` 及 Issue #1 本机 `agy` CLI 本地化文案），新增 `zhCatalog.test.ts` 回归校验 |

### MP-05：Electron 生命周期、Daemon 托管、遮挡 0 FPS 与 `DesktopBridge.prismux`（状态：已落地实施）

| 类别 / 目标文件（相对 `vendor/t3code/`） | 实际行号 / 导出符号 | 实际落地职责与最小入侵细节 |
| :--- | :--- | :--- |
| **[修改]** `packages/contracts/src/ipc.ts` | `L1107-L1127`、`L1272-L1273` | 定义 `PrismuxDaemonInfoSchema`、`PrismuxWindowOcclusionSchema`、`PrismuxDesktopBridge`，并在 `DesktopBridge` 挂载可选 `prismux?: PrismuxDesktopBridge` |
| **[修改]** `apps/desktop/src/ipc/channels.ts` | `L158-L163` | 注册 6 个 `desktop:prismux:*` 频道：`PRISMUX_GET_DAEMON_INFO_CHANNEL`、`PRISMUX_GET_WINDOW_OCCLUSION_CHANNEL`、`PRISMUX_WINDOW_OCCLUSION_CHANNEL`、`PRISMUX_PICK_WALLPAPER_FILES_CHANNEL`、`PRISMUX_PICK_WALLPAPER_DIRECTORY_CHANNEL`、`PRISMUX_SET_UPDATE_FEED_URL_CHANNEL` |
| **[新增]** `apps/desktop/src/prismux/PrismuxDaemonService.ts` | `PrismuxDaemonStartInput`、`PrismuxDaemonService`、`layer` | 随桌面宿主启动并管理 `@prismux/daemon`（开发态 `../../apps/daemon/dist/cli.js`，打包态 `resources/prismux-daemon/cli.js`）；仅向 Daemon 子进程注入 `ELECTRON_RUN_AS_NODE=1`（严禁污染父进程或 T3 Server），随机 loopback 端口 + 32 字节 Hex Token，5s `/health` 轮询非阻塞降级与优雅停机（含 Windows `taskkill /T /F`） |
| **[新增]** `apps/desktop/src/ipc/methods/prismux.ts` | `PrismuxInvalidUpdateFeedUrlError`、`getPrismuxDaemonInfo`、`getPrismuxWindowOcclusion`、`pickPrismuxWallpaperFiles`、`pickPrismuxWallpaperDirectory`、`setPrismuxUpdateFeedUrl` | 实现 5 个请求/指令型 IPC method；`setPrismuxUpdateFeedUrl` 仅允许 `https:` 与 loopback `http:`，并调用 `ElectronUpdater.setFeedURL({ provider: "generic", url })` |
| **[修改]** `apps/desktop/src/ipc/DesktopIpcHandlers.ts` | `L96-L101`（导入）、`L201-L205`（`ipc.handle(...)`） | 注册上述 5 个 Prismux IPC handler |
| **[修改]** `apps/desktop/src/preload.ts` | `L10`（导入 `PrismuxWindowOcclusion`）、`L574-L600`（`contextBridge` 暴露 `prismux`） | 向渲染层安全暴露 `getDaemonInfo`、`getWindowOcclusion`、`onWindowOcclusionChange`、`pickWallpaperFiles`、`pickWallpaperDirectory`、`setUpdateFeedUrl` |
| **[修改]** `apps/desktop/src/window/DesktopWindow.ts` | `L28`（导入频道）、`L865-L890`（`emitWindowOcclusion`） | 监听 `minimize / hide / restore / show / blur / focus`，向渲染层实时推送 `PRISMUX_WINDOW_OCCLUSION_CHANNEL` `{ occluded, reason }` 驱动壁纸 `0 FPS` 挂起 |
| **[修改]** `apps/desktop/src/main.ts` | `L66`（导入）、`L221`（Layer 装配） | 将 `PrismuxDaemonService.layer` 装配进桌面应用主依赖图 |
| **[修改]** `apps/desktop/src/app/DesktopApp.ts` & `DesktopApp.test.ts` | `DesktopApp.ts:45, 208, 228, 300-304, 463-468`；`DesktopApp.test.ts:46, 204` | 在 `startLocalBackend` 后异步拉起 `prismuxDaemon.start()` 并在 `scopedProgram` finalizer 挂接 `Effect.ensuring(prismuxDaemon.stop)`；同步补齐 `DesktopApp.test.ts` 服务 mock |
| **[复用未改]** `ElectronProtocol.ts` & `DesktopUpdates.ts` | `ElectronProtocol.ts:90`（`media-src` 允许 `http:`）；`DesktopUpdates.ts:1303-1309` | 原生 CSP 与更新器已满足本地媒体流（含 HTTP `206` 与有限定 Cookie 的 Web 子资源）与 `setFeedURL` 能力，未额外修改源码 |

### MP-06：品牌标识、Ciallo 图标、`.prismux` 隔离与 Electron NSIS / Daemon 打包（状态：已落地实施）

| 类别 / 目标文件（相对 `vendor/t3code/`） | 实际行号 / 导出符号 | 实际落地职责与最小入侵细节 |
| :--- | :--- | :--- |
| **[新增资产]** `assets/prismux/*` & `apps/web/public/*` | `prismux-{32,128,256,512,1024}.png`、`prismux-windows.ico`；Web `prismux-logo.png`、`favicon*`、`icon-*`、`apple-touch-icon.png` | 统一提供 Prismux Ciallo 桌面窗口图标、安装器图标与 Web 启动闪屏/PWA 图标 |
| **[修改]** `apps/desktop/package.json` & `DesktopEnvironment.ts` & `DesktopAppIdentity.ts` & `DesktopEarlyElectronStartup.ts` | `package.json:47`、`DesktopEnvironment.ts:88-113, 233`、`DesktopAppIdentity.ts:95-99`、`DesktopEarlyElectronStartup.ts:34` | 统一产品名 `"Prismux"`（去正式版 `(Beta)` 后缀）、AppUserModelId `"io.prismux.desktop"` / `".dev"` 与 Linux desktop entry ID |
| **[修改]** `apps/desktop/src/app/DesktopStatePaths.ts` & `DesktopUserData.ts` | `DesktopStatePaths.ts:19`（`.prismux`）、`DesktopUserData.ts:43-44`（`prismux` / `prismux-dev`） | 默认状态目录与 Electron `userData` 路径独立收敛至 `.prismux` / `prismux`，与原 `.t3` 物理隔离 |
| **[修改]** `apps/desktop/src/app/DesktopAssets.ts` & `scripts/lib/brand-assets.ts` | `DesktopAssets.ts:66-73, 90`；`brand-assets.ts:3-37` | 桌面运行时窗口图标与全渠道构建资产映射切换至 `assets/prismux/*` |
| **[修改]** `apps/web/src/branding.ts` & `branding.logic.ts` & `vite.config.ts` & `index.html` & `manifest.webmanifest` | `branding.ts:22`、`branding.logic.ts:8`、`vite.config.ts:291`、`index.html:684, 689-690`、`manifest.webmanifest:3-4` | 统一 Web 标题为 `Prismux`、闪屏 Logo 为 `/prismux-logo.png` 并对齐 Web App Manifest |
| **[修改]** `scripts/build-desktop-artifact.ts` & `apps/desktop/resources/installer.nsh` | `build-desktop-artifact.ts:66, 1067-1068, 2808, 2832-2897, 2974, 3335, 3521, 4161, 4211`；`installer.nsh:1-3, 19-29, 38` | `DESKTOP_APP_ID = "io.prismux.desktop"`；`withRepoBinOnPath` 自动前置 `node_modules/.bin` 避免 `vp ENOENT`；`PRISMUX_DAEMON_EXTRA_RESOURCES` 将依赖经 `prismux-daemon-deps` 映射至 `prismux-daemon/node_modules`（绕开 `electron-builder` 默认过滤 `node_modules` 并同步写入打包态 `package.json` 版本，**严禁包含 `plugins-official/`**，`WINDOWS_PACKAGED_PAYLOAD_FILE_LIMIT = 300`）；NSIS 更新 `Prismux` 进程关闭检测与零预装声明 |

### MP-07（Provider / ACP 运行时扩展点 · GitHub Issue #1）：内置 Antigravity 本机 `agy` CLI 复用与全模型 `thought_level` 探测同步（状态：已落地实施）

| 类别 / 目标文件（相对 `vendor/t3code/`） | 实际行号 / 导出符号 | 实际落地职责与最小入侵细节 |
| :--- | :--- | :--- |
| **[修改]** `packages/contracts/src/settings.ts` | `L867-L896`（`ANTIGRAVITY_AUTH_METHODS`） | 新增 `{ value: "local-cli", label: "Local agy CLI" }` 认证选项（保持默认解码向下兼容 `oauth-personal`） |
| **[修改]** `packages/provider-acp/src/server/sessionConfig.ts` | `L26-L32, L102`（`isAcpThoughtLevelOption`） | 兼容识别 `id === "thought_level" | "thinking_level"`（即使 ACP 未显式标出 `category` 仍归类为 `role: "reasoning"`） |
| **[修改]** `packages/provider-acp-registry/src/server/probe.ts` & `driver.test.ts` | `probe.ts:39, 257, 268, 609-676` | 对紧凑型 `model-select` 目录（`<= 24` 模型，如 `agy acp`、Mistral Vibe）在单次探活中带超时边界轮询切模型，按模型记录各自真实 `reasoningEffort` 后恢复默认模型，解决仅默认模型有思考强度的问题 |
| **[修改]** `apps/server/src/provider/antigravityAuthSupport.ts` & `.test.ts` | `L131-L156, L198, L288, L539, L692`（`antigravityAuthUsesLocalCli`、`detectLocalAntigravityCliAuth`） | `local-cli` 模式直接以纯 `["acp"]` 拉起 `agy`，**不覆写 `GEMINI_HOME`、不传 `--gemini-dir` / `--app-data-dir` / `AGY_ACP_FORCE_FILE_STORAGE` / `SSH_CONNECTION`，并清洗 `ELECTRON_RUN_AS_NODE`**，直接检测与复用 `~/.gemini/antigravity-cli` / 系统 keyring |
| **[修改]** `apps/server/src/provider/AntigravityInstallation.ts` | `L101-L120, L643-L740` | `resolve` / `acquire` 支持 `{ preferPath: true }`，`local-cli` 优先选用 `PATH` 上的本机 `agy`（缺失时回退托管安装版） |
| **[修改]** `apps/server/src/provider/antigravityUsageLimits.ts` & `.test.ts` | `L29, L232, L339-L390`（`readAntigravityCliKeyringSecret`） | `local-cli` 直接读取 `~/.gemini/antigravity-cli/antigravity-oauth-token`（回退 OS keyring `gemini:antigravity`）查询完整谷歌配额窗口 |
| **[修改]** `apps/server/src/provider/acp/AntigravityAcpSupport.ts` | `L35, L125, L250-L335`（`findAntigravityModelConfigOption`、`antigravityThinkingConfig`） | `local-cli` 关闭强制交互认证与 `authenticateEagerly`；统一模型与 `thought_level` 配置解析 helper |
| **[修改]** `apps/server/src/provider/AntigravityAuth.ts` & `.test.ts` | `L113-L185, L293-L305, L480-L488, L628-L660` | 支持 `localCli` 认证状态，登出仅清理本地会话状态而不执行全局 `agy logout` 破坏本机 CLI 登录 |
| **[修改]** `apps/server/src/provider/AntigravityProvider.ts` & `.test.ts` | `L96, L174, L203, L256, L352-L359, L416-L421, L477-L568` | `local-cli` 探活检测本机凭据后自动置 `ready` + `canLogout: false` 并后台单次 `hydrateCatalog` 拉取全量目录；局部 `config_option_update` 不再误清模型目录 |
| **[修改]** `apps/server/src/provider/Drivers/AntigravityDriver.ts` | `L46-L78, L171, L516-L570, L630-L795`（`publishCatalog`） | 串联 `usesLocalCli` 全链路；`publishCatalog` 对所有模型循环切换并直读 `runtime.getConfigOptions` 写入每模型独立思考强度后恢复默认模型 |
| **[修改]** `apps/web/src/components/settings/{AddProviderInstanceDialog,ProviderSettingsForm,ProviderAuthenticationSection,ProviderSetupSection,ProviderSettingsPanel}.tsx` | `AddProviderInstanceDialog.tsx:797-802`、`ProviderSettingsForm.tsx:165-167, 258`、`ProviderAuthenticationSection.tsx:82-114`、`ProviderSetupSection.tsx:144-370`、`ProviderSettingsPanel.tsx:1422` | 新增 `"Local agy CLI"` 认证切换与添加向导/已有实例一键「Use local agy CLI」复用入口，完整保留原生 Google Antigravity 彩色图标与配额面板 |
| **[修改]** `apps/web/src/components/chat/{ComposerModelEffort.tsx,useComposerSelection.ts,composerProviderState.test.tsx}` | `ComposerModelEffort.tsx:86`（`describeComposerEffort`）、`useComposerSelection.ts:91, 278`（`resolveModelSwitchOptions`） | 切换模型时按目标模型最新描述符清洗过期 `thought_level` 并允许兼容平滑承接，对尚未观测 `currentValue` 的推理描述符保留思考强度选择器可视指示 |

---

## 五、周期性上游合并与实测构建要点

1. **上游合并流程**：基于 [`UPSTREAM_LOCK.json`](../UPSTREAM_LOCK.json) 的 `commit` SHA 比对上述 MP-01 ~ MP-07 登记文件 diff → 三方合并 `pingdotgg/t3code` 新提交 → 复核本台账新增/修改文件与精确行号并更新 `UPSTREAM_LOCK.json` → 跑通全量门禁与真实桌面二进制启动/拖拽三键/多场景截图自审。
2. **已验证构建坑点与规避参数**：
   - **清理残留代理避免 Cargo / 网络卡死**：在命令行会话清空 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY`，并在调用 Rust Cargo 时显式设置 `NO_PROXY=*`。
   - **Windows `native/resource-monitor` 预编译与 Spectre 规避**：先使用 `-j 1` 串行编译 `native/resource-monitor` 规避 MSVC `0xC0000005` 并发链接崩溃，打 NSIS 安装包时传入 `T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR=1` 绕过 VS Spectre 库预检阻塞；主仓 [`scripts/build-prismux-desktop.ts`](../scripts/build-prismux-desktop.ts) 已内置上述环境清洗与自动串联逻辑。
   - **`electron-builder` 过滤 `node_modules` 避坑**：打包 `prismux-daemon` 运行时依赖时严禁把依赖目录直接命名为 `node_modules` 放入 `extraResources` 源目录，必须经 `prismux-daemon-deps` 中转并显式映射 `to: "prismux-daemon/node_modules"`。
   - **Electron 44 打包构建与类型检查**：在 `vendor/t3code` 执行 `pnpm exec vp run build:desktop`、`pnpm exec vp run --filter @t3tools/desktop typecheck` 与 `pnpm exec vp run --filter @t3tools/web typecheck`；或在主仓根执行 `pnpm desktop:build` / `pnpm desktop:installer`。
