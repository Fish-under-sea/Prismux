# Prismux 官方 Hook 钩子与浅色 / 深色 / 液态玻璃主题样式参考

> 本文档完整整理自 `packages/protocol/src/hooks.ts`、`apps/daemon/src/hooks/LifecycleHookBus.ts`、`packages/prismux-appearance/src/{types.ts,glassEngine.ts,styles/t3-glass-bridge.css,styles/appearance-cards.css}` 与 `vendor/t3code/apps/web/src/index.css`，所有事件名、DOM 属性名与 CSS 自定义属性均与真实运行态 100% 一致。
>
> 插件脚手架、打包与发布流程请查阅 [Prismux 插件创作完全指南](./plugin-development-guide.md)。

---

## 一、`LifecycleHookBus` 官方生命周期钩子全清单

### 1.1 官方 6 大生命周期事件（`LIFECYCLE_HOOK_EVENTS`）

定义于 `packages/protocol/src/hooks.ts`：

| 事件名 | 触发时机 | 是否可拦截 / 改写 | 典型插件用途 |
| :--- | :--- | :--- | :--- |
| `SessionStart` | 会话启动或恢复时触发 | 允许返回 `block` 阻断启动 | 初始化会话级上下文、记录审计日志 |
| `PreToolUse` | 代理调用工具**之前**触发 | 支持 `allow` / `block` / `modify`（改写 `modifiedInput`），并联动四档权限门禁与中文 `ApprovalGuideCard` | 危险命令二次审批（如 `plugin-fishdock-hook`）、参数脱敏或重定向 |
| `PostToolUse` | 工具执行完成后触发（携带 `toolOutput`） | 可附加 `feedback` 或在异常策略下阻断后续链路 | 结果审计、指标上报、输出后处理 |
| `Notification` | 系统产生通知事件（邮件提醒、夜间工场完工等） | 观察与分发 | 转发至 QQ（`plugin-qq`）、FISH-Dock 灵动岛或自定义 Webhook |
| `SubagentStop` | 子代理（Subagent）执行结束时触发 | 观察与汇总 | 记录子任务耗时、统计分片产出 |
| `Stop` | 主会话或单轮任务完成停止时触发 | 观察与归档 | 推送任务完工摘要、清理轮次临时状态 |

> [!NOTE]
> **事件名精确核对**：当前协议 `LIFECYCLE_HOOK_EVENTS` 精确为上述 6 项（`SessionStart`、`PreToolUse`、`PostToolUse`、`Notification`、`SubagentStop`、`Stop`）。会话及子代理终止由 `Stop` 与 `SubagentStop` 承接，协议中**不存在** `SessionEnd` 事件，请勿注册未定义事件名。

### 1.2 输入与输出数据结构

#### 输入上下文：`HookInvocationContext`

```ts
export interface HookInvocationContext {
  event: "SessionStart" | "PreToolUse" | "PostToolUse" | "Notification" | "SubagentStop" | "Stop";
  sessionId: string;
  threadId: string;
  permissionMode: "plan" | "acceptEdits" | "auto" | "supervised";
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: unknown;
  timestamp: number;
}
```

#### 返回结果：`HookExecutionResult`

```ts
export type HookDecision = "allow" | "block" | "modify";

export interface HookExecutionResult {
  decision: HookDecision;
  exitCode: number;
  feedback?: string;
  modifiedInput?: Record<string, unknown>;
  approvalGuide?: ApprovalGuideCard;
  failurePolicyApplied?: "block" | "warn" | "ignore";
}

export interface ApprovalGuideCard {
  toolName: string;
  actionSummary: string;
  riskLevel: "low" | "medium" | "high";
  triggerReason: string;
  rawCommandOrTarget?: string;
}
```

- 插件通过 `ctx.onHook(event, handler)` 注册函数钩子时，返回 `undefined` 等价于放行（`allow`）；
- 返回 `{ decision: "modify", exitCode: 0, modifiedInput: { ... } }` 会将改写后的 `toolInput` 透传给链路上的后续钩子与权限评估器；
- 返回 `{ decision: "block", exitCode: 2, feedback: "阻断原因" }` 会立即短路后续钩子并阻断执行，若发生在 `PreToolUse` 且未显式提供 `approvalGuide`，总线会自动调用 `translatePreToolApproval()` 补齐中文风险审批卡。

### 1.3 外部命令钩子协议、退出码 `2` 拦截与 `onFailure: "block"` 安全默认

除进程内函数钩子外，`LifecycleHookBus.registerCommandHook()` 支持注册外部命令钩子（`CommandHookConfig`）：

- **输入传递**：总线经由 `sanitizeChildEnv()` 清洗环境变量（强制剔除 `ELECTRON_RUN_AS_NODE` 等宿主污染变量）后启动子进程，并将 `JSON.stringify(context) + "\n"` 写入子进程 `stdin`。
- **超时与输出上限**：默认超时 `DEFAULT_HOOK_TIMEOUT_MS = 5000 ms`，超时先发 `SIGTERM`、`50 ms` 宽限后发 `SIGKILL`；`stdout` / `stderr` 单流上限 `1 MiB`（`1048576` 字节）。
- **退出码语义**：
  - **退出码 `0`**：默认放行（`decision: "allow"`）；若 `stdout` 为合法 JSON 对象，支持解析 `{ decision: "allow" | "block" | "modify", modifiedInput?, feedback?, exitCode? }`。
  - **退出码 `2`**：确定性拦截（`decision: "block"`），`stderr` 文本会直接作为 `feedback` 回传给代理或审批流。
  - **其他非零退出码 / 启动失败 / 超时**：判定为 `HookExecutionFailure`，按失败策略处置。
- **失败策略（`HookFailurePolicy`）**：
  - 支持 `"block"`、`"warn"`、`"ignore"` 三档；
  - 全局安全默认值为 `DEFAULT_SECURITY_HOOK_FAILURE_POLICY = "block"`（Fail-Closed，失败即阻断）；
  - 当钩子配置 `securityCritical: true` 时，无论外部传入何种 `onFailure`，总线在注册与派发期均**强制锁定为 `"block"`**，超时或抛错必定阻断执行并产出 `exitCode: 2`。

### 1.4 四档权限模式（`PERMISSION_MODES`）与风险门禁边界

在 `PreToolUse` 事件中，所有自定义钩子放行后，若总线开启权限门禁（默认 `enforcePermissionGate: true`），`LifecycleHookBus.evaluatePermission()` 会结合工具类别（`readonly` / `edit` / `delete` / `network` / `shell` / `high_risk`）与敏感凭据路径规则（`.env`、`.ssh`、`credentials`、`id_rsa` / `id_ed25519`、`.git-credentials`、`.npmrc`、`*.pem` / `*.key` 等）执行四档判定：

| 权限模式（`PermissionMode`） | 只读检索（不涉凭据） | 常规文件编辑（不涉凭据、非高危） | 删除 / Shell / 网络 / 凭据 / 高危命令（如 `rm -rf`、`git push --force`、`git reset --hard`、`curl \| sh`、`chmod 777`） |
| :--- | :--- | :--- | :--- |
| `plan`（只读规划） | 放行 | 阻断（`exitCode: 2`） | 阻断（`exitCode: 2`） |
| `acceptEdits`（自动接受编辑） | 放行 | 放行 | 阻断（`exitCode: 2`） |
| `supervised`（默认监督模式） | 放行（低危只读） | 生成审批单并挂起（`approvalRequired: true`），人工批准后一次性消费放行 | 生成中 / 高危中文 `ApprovalGuideCard` 审批单（`apr-...`）并阻断等待人工放行或驳回 |
| `auto`（全自动） | 放行 | 放行 | 放行（仍附带 `approvalGuide` 风险评估记录，且不绕过显式 `block` 安全钩子） |

---

## 二、官方主题、液态玻璃与语义样式 Token 全清单

Prismux 视觉层对大模型保持 **0 Token 开销**。插件的声明式 UI（`DeclarativeGlassRenderer`）会自动继承以下全部主题与玻璃变量；若插件通过 `ctx.registerStyle()` 或宿主扩展定制样式，**必须严格使用下表真实 DOM 态标与 CSS 变量**。

### 2.1 宿主 DOM 态标属性与媒体查询兜底

`applyPrismuxAppearanceToDocument()`（`packages/prismux-appearance/src/glassEngine.ts`）会将以下属性同步写入 `document.documentElement`（`<html>`）与 `document.body`：

| 选择器 / 属性 | 真实取值 | 用途说明 |
| :--- | :--- | :--- |
| `html[data-pmx-theme]`（镜像 `data-prismux-theme`） | `"light"` \| `"dark"` | 当前生效底色极性（玻璃态下对应 `glassBasePolarity`）；同步附加类名 `.pmx-light` / `.pmx-dark` 及 T3 Code 的 `html.dark` |
| `html[data-pmx-mode]`（镜像 `data-prismux-mode`） | `"light"` \| `"dark"` \| `"glass"` | 用户在天体三态胶囊选择的模式 |
| `html[data-pmx-glass]`（镜像 `data-prismux-glass`） | `"0"` \| `"1"` | 液态玻璃是否视觉激活；同步附加类名 `.pmx-glass` |
| `html[data-pmx-gpu]`（镜像 `data-prismux-gpu`） | `"0"` \| `"1"` | 硬件 GPU 加速是否可用；`"0"` 时强制退回实底无模糊 |
| `html[data-pmx-reduced-transparency]` | `"1"`（开启时存在） | 系统或宿主开启「减少透明度」时存在，强制退回实底无模糊 |
| `html[data-pmx-wallpaper]` / `[data-pmx-wallpaper-visible]` | `"1"`（激活时存在） | 存在 Z-0 静态 / 视频 / WebWallGL 活跃壁纸 |
| `html[data-pmx-zone-<name>-mode]` | `"inherit"` \| `"custom"` \| `"solid"` | 6 大玻璃分区各自的有效模式（`<name>` 为 `shell-frame`、`right-sidebar`、`main-canvas`、`work-panels`、`composer`、`overlays`） |
| `html[data-pmx-custom-heading="1"]` / `[data-pmx-custom-text="1"]` / `[data-pmx-custom-muted="1"]` | `"1"`（自定义时存在） | 标识用户已在外观设置中指定独立浅色 / 深色文字颜色 |
| `html[data-pmx-custom-font-sans="1"]` / `[data-pmx-custom-font-mono="1"]` | `"1"`（自定义时存在） | 标识用户已指定全局无衬线 / 代码等宽字体 |
| `html[data-pmx-ui-colors="1"]` / `[data-pmx-caret="1"]` | `"1"`（启用时存在） | 标识用户已启用 5 项 UI 自定义强调色或自定义光标色 |
| `@media (prefers-reduced-transparency: reduce)` | 媒体查询 | 系统降透明兜底，所有玻璃表面必须退回不透明实色且禁用 `backdrop-filter` |
| `@media (prefers-reduced-motion: reduce)` | 媒体查询 | 系统减弱动态效果兜底，禁用非必要过渡与循环动画 |
| `@media (forced-colors: active)` | 媒体查询 | Windows 高对比度模式兜底，必须使用 `Canvas` / `CanvasText` / `Highlight` 系统色并关闭模糊 |

> [!WARNING]
> **切勿编造或误用属性名**：
> 1. 宿主**不使用** `data-theme` 或 `data-pmx-surface-tone`，请始终使用真实属性 `html[data-pmx-theme="light" | "dark"]`、`html[data-pmx-mode="light" | "dark" | "glass"]`、`html[data-pmx-glass="0" | "1"]` 及 `html.dark`。
> 2. **禁止依赖 `@media (prefers-color-scheme: dark)`** 切换插件颜色：用户可在浅色系统下选择深色 / 玻璃主题，一切明暗判断以宿主 `html[data-pmx-theme]` 与 `html.dark` 为唯一真相源。

### 2.2 6 大液态玻璃分区 CSS 变量全清单

Prismux 将工作台划分为 6 个可独立调节（`inherit` / `custom` / `solid`）的液态玻璃分区（`GLASS_ZONE_IDS` / `GLASS_ZONE_CSS_NAMES`）：

| 分区 ID（`GlassZoneId`） | CSS 分区名（`<name>`） | DOM 挂载标记 | 职责范围与可读底线 |
| :--- | :--- | :--- | :--- |
| `shellFrame` | `shell-frame` | `data-pmx-glass-zone="shellFrame"` | 一体化窗口外框（左侧边栏、顶栏、底栏与右细边） |
| `rightSidebar` | `right-sidebar` | `data-pmx-glass-zone="rightSidebar"` | 右侧功能边栏（默认跟随 `shellFrame`，可独立调节） |
| `mainCanvas` | `main-canvas` | `data-pmx-glass-zone="mainCanvas"` | 中央圆角主画布（默认 0px 模糊清透展示 Z-0 壁纸） |
| `workPanels` | `work-panels` | `data-pmx-glass-zone="workPanels"` / `data-pmx-work-panel="1"` | 工作区板、任务面板与定时任务主面板（独立霜透底线） |
| `composer` | `composer` | `data-pmx-glass-zone="composer"` | 双层消息输入框与卡片 |
| `overlays` | `overlays` | `data-pmx-glass-zone="overlays"` | 弹窗、抽屉、下拉菜单与设置窗口（**内置 ≥ 68% 不透明度可读底线**） |

每个分区统一暴露 7 个实时计算的 CSS 自定义属性：

| CSS 变量模板 | 示例值（玻璃态） | 无 GPU / 降透明 / `solid` 兜底值 |
| :--- | :--- | :--- |
| `--pmx-glass-zone-<name>-bg` | `rgba(13, 21, 36, 0.780)` | `rgb(13, 21, 36)` |
| `--pmx-glass-zone-<name>-blur` | `18px` | `0px` |
| `--pmx-glass-zone-<name>-saturation` | `1.10` | `1` |
| `--pmx-glass-zone-<name>-opacity` | `0.780` | `1.000` |
| `--pmx-glass-zone-<name>-border` | `rgba(255, 255, 255, 0.220)` | `rgba(255, 255, 255, 0.12)`（浅色为 `rgba(15, 23, 42, 0.14)`） |
| `--pmx-glass-zone-<name>-backdrop` | `blur(18px) saturate(1.10)` | `none` |
| `--pmx-glass-zone-<name>-sheen` | `linear-gradient(180deg, ...)` | `none` |

此外，引擎额外暴露以下通用玻璃光学变量与 `workPanels` 专用别名：

- **通用四区与光学基线**：`--pmx-glass-tint`（及 `-rgb` / `-light` / `-dark`）、`--pmx-glass-fidelity`、`--pmx-readability-floor`（浅色基线 `READABILITY_FLOOR_LIGHT = 0.50`，深色基线 `READABILITY_FLOOR_DARK = 0.59`）、`--pmx-fresnel-strength`、`--pmx-wallpaper-dim`、`--pmx-glass-border`（镜像 `--prismux-glass-border`）、`--pmx-surface-bg`、`--pmx-canvas-bg`、`--pmx-card-bg`、`--pmx-overlay-bg`、`--pmx-control-bg`、`--pmx-glass-{surface,card,overlay,control}-{op,fill,blur}`。
- **`workPanels` 专用别名**：`--pmx-glass-work-panels-bg`、`--pmx-glass-work-panels-card-bg`、`--pmx-glass-work-panels-blur`、`--pmx-glass-work-panels-border`、`--pmx-glass-work-panels-backdrop`、`--pmx-glass-work-panels-sheen`。

### 2.3 背景、卡片、边框、文字与强调色语义变量对照表

宿主通过 `t3-glass-bridge.css` 自动把 Prismux 玻璃与字体配置桥接到 Tailwind v4 语义变量，插件在**浅色 / 深色 / 液态玻璃三态**下均可零分支直接复用：

| 语义分类 | 推荐 CSS 变量（及 Tailwind 工具类） | 浅色态默认表现 | 深色态默认表现 | 液态玻璃态自动映射 |
| :--- | :--- | :--- | :--- | :--- |
| 页面画布底 | `--background`（`bg-background`） | 浅白 `#fcfcfc` | 纯黑 / 深底 `#000` | `--pmx-canvas-bg`（透出壁纸；叠加层内结构包裹会被透明化） |
| 卡片 / 分组表面 | `--card`（`bg-card` / 推荐设置区 `bg-card/40`） | 纯白 `#ffffff` | 深灰近黑 | `--pmx-card-bg`（经亮度钳制的半透底色） |
| 浮层 / 弹窗表面 | `--popover`（`bg-popover`） | 纯白 `#ffffff` | 深灰近黑 | `--pmx-overlay-bg`（≥ 68% 可读下限） |
| 弱化底 / 轨道 | `--muted`（`bg-muted`）、`--accent`（`bg-accent`） | 浅灰 `zinc-50` / `zinc-100` | 3%–4% 柔白层 | 浅色玻璃用深墨微透、深色玻璃用柔白微透 |
| 分割线与边框 | `--border`（`border-border`）、`--input`（`border-input`） | `zinc-200` / `zinc-300` | 8%–11% 柔白线 | `--pmx-glass-border`（含 Fresnel 边缘高光混合） |
| 主文字（正文） | `--foreground`（`text-foreground`）、`--pmx-text-color` | `#1b1b1f` / `zinc-900` | `#f5f5f7` / `neutral-100` | 跟随用户自定义 `--pmx-text-color` 或自动高对比白 / 炭黑 |
| 标题文字 | `--pmx-heading-color`（镜像 `--dock-heading`） | `#111113` | `#ffffff` | 启用 `data-pmx-custom-heading="1"` 时覆盖 `h1–h6` |
| 次级 / 说明文字 | `--muted-foreground`（`text-muted-foreground`）、`--pmx-muted-color` | `#5d5d5d` | `#a1a1a6` | 深色玻璃自动抬升至 `rgba(255,255,255,0.84)`，浅色玻璃 `rgba(15,23,42,0.78)` |
| 主强调色与前景色 | `--primary`（`--pmx-accent`）、`--primary-foreground`（`--pmx-accent-ink`） | 默认 `#005fb8` / 白字 | 默认 `#5e9bff` / 自适应黑白字 | 跟随系统强调色或用户自定义强调色，`--pmx-accent-ink` 自动计算 `#ffffff` 或 `#000000` |
| 焦点环 | `--ring`（`ring-ring` / `outline-ring`） | 同 `--primary` | 同 `--primary` | 同 `--pmx-accent` |
| 5 项 UI 定制色 | `--pmx-ui-send`、`--pmx-ui-link`、`--pmx-ui-file-icon`、`--pmx-ui-tab`、`--pmx-ui-deep-diving` | 默认跟随 `--pmx-accent` | 默认跟随 `--pmx-accent`（`deep-diving` 为 `#6cb6ff`） | 开启 `data-pmx-ui-colors="1"` 时映射对应局部控件 |
| 字体与光标 | `--pmx-font-sans`、`--pmx-font-mono`、`--pmx-font-weight`、`--pmx-caret-color` | 桥接至 `--font-sans` / `--font-mono` | 桥接至 `--font-sans` / `--font-mono` | 用户在外观页自定义字体与光标色时即时同步 |
| 状态语义色 | `--info`、`--success`、`--warning`、`--destructive`（及其 `*-foreground`） | 蓝 / 绿 / 琥珀 / 红语义色 | 适配深底高对比色 | 全三态保持一致语义识别度 |
| 声明式组件内置色板 | `--pmx-decl-{fg,muted,accent,ok,warn,bad,surface,surface-subtle,border,input-bg,primary-bg,primary-fg,danger-bg,danger-fg}` | 白底 `#1b1b1f` 字（≥ 4.5:1） | 深蓝灰底 `#f5f5f7` 字（≥ 4.5:1） | `.pmx-decl-card` 自动挂接 `--pmx-card-bg`、`--pmx-glass-border` 与 `--pmx-glass-card-blur` |

### 2.4 WCAG AA ≥ 4.5:1 对比度与液态玻璃避坑指南

1. **严禁硬编码明暗色值**：
   - 禁止在插件样式中写死 `bg-black`、`bg-white`、`bg-zinc-*`、`bg-neutral-900`、`text-white`、`text-black`、`#000`、`#fff`（除非搭配明确的 `html[data-pmx-theme]` 极性选择器或与高对比背景成对绑定）。
   - 使用 `var(--foreground)`、`var(--muted-foreground)`、`var(--border)`、`var(--primary)` 等语义变量即可同时满足浅色、深色与玻璃三态。
2. **严禁在玻璃容器内叠加高不透明 `bg-card/80` 或嵌套 `backdrop-filter`**：
   - 在液态玻璃设置页或弹窗（`overlays` 分区）内部，外层容器已经拥有单次 `backdrop-filter` 与半透底色；若内层子卡片继续使用 `bg-card/80` 或再次声明 `backdrop-filter`，在深色玻璃态下会产生发黑割裂的「暗块砖」，同时触发 Chromium Backdrop Root 双重模糊失真。
   - **推荐层次**：外层设置分组容器采用 `bg-card/40 border-border/60`（与 `SettingsSection` 一致），内层独立小卡片采用通透微浮层 `bg-foreground/[0.025] dark:bg-white/[0.035]` + 细边框 `border-border/60` + `1px` 顶部镜面内高光。
3. **亮度钳制与可读底线**：
   - `clampSurfaceColorForContrast()` 在 `glassFidelity = 100` 时确保任意用户自选玻璃底色叠加在最差壁纸像素（浅色态 `#000000`、深色态 `#ffffff`）上仍满足正文 **≥ 4.5:1** 对比度（`READABILITY_FLOOR_LIGHT = 0.50`，`READABILITY_FLOOR_DARK = 0.59`）。
4. **反色胶囊警惕 `.text-background`**：
   - 玻璃态下 `--background` 是半透明画布，不能直接拿来做实心按钮文字色；若需强调按钮文字，请始终使用 `--primary-foreground`（`--pmx-accent-ink`）。

### 2.5 主题同步监听与三态自适应 CSS 示范

#### 三态自适应样式（含 4 重兜底）

```css
/* 默认深色基线（可同时在深色与深色玻璃态生效） */
.my-plugin-card {
  border-radius: 12px;
  border: 1px solid var(--border, rgba(255, 255, 255, 0.14));
  background-color: color-mix(in srgb, var(--card, #141926) 40%, transparent);
  color: var(--foreground, var(--pmx-text-color, #f5f5f7));
  padding: 14px 16px;
}

.my-plugin-card-title {
  color: var(--pmx-heading-color, var(--foreground, #ffffff));
  font-weight: 600;
}

.my-plugin-card-desc {
  color: var(--muted-foreground, var(--pmx-muted-color, #a1a1a6));
}

/* 浅色态适配：仅使用宿主真实属性，禁止 @media (prefers-color-scheme) */
html[data-pmx-theme="light"] .my-plugin-card {
  border-color: var(--border, rgba(15, 23, 42, 0.14));
  background-color: color-mix(in srgb, var(--card, #ffffff) 78%, transparent);
  color: var(--foreground, var(--pmx-text-color, #1b1b1f));
}

/* 液态玻璃态（仅独立浮层启用单次 backdrop-filter；置于 overlays/settings 内部时省略 blur） */
html[data-pmx-glass="1"] .my-plugin-floating-panel {
  background-color: var(--pmx-glass-zone-overlays-bg, var(--pmx-overlay-bg));
  background-image: var(--pmx-glass-zone-overlays-sheen, none);
  border-color: var(--pmx-glass-zone-overlays-border, var(--pmx-glass-border));
  -webkit-backdrop-filter: var(--pmx-glass-zone-overlays-backdrop, blur(16px) saturate(1.08));
  backdrop-filter: var(--pmx-glass-zone-overlays-backdrop, blur(16px) saturate(1.08));
}

/* 必须实现的 4 重兜底：无 GPU / 降透明 / 不支持 blur / 高对比度 / 减弱动效 */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  html[data-pmx-glass="1"] .my-plugin-floating-panel {
    background-color: var(--pmx-glass-tint, var(--popover));
    background-image: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}

@media (prefers-reduced-transparency: reduce) {
  html[data-pmx-glass="1"] .my-plugin-floating-panel {
    background-color: var(--pmx-glass-tint, var(--popover));
    background-image: none;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}

html:is([data-pmx-gpu="0"], [data-prismux-gpu="0"], [data-pmx-reduced-transparency="1"])
  .my-plugin-floating-panel {
  background-color: var(--pmx-glass-tint, var(--popover)) !important;
  background-image: none !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}

@media (forced-colors: active) {
  .my-plugin-card,
  .my-plugin-floating-panel {
    background: Canvas !important;
    color: CanvasText !important;
    border: 1px solid CanvasText !important;
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
  }
}

@media (prefers-reduced-motion: reduce) {
  .my-plugin-card,
  .my-plugin-floating-panel {
    transition-duration: 0.01ms !important;
    animation: none !important;
  }
}
```

#### 运行时主题态监听（Canvas / 图表等非 CSS 场景）

如果插件需要在 Canvas 或脚本逻辑中实时感知三态变化，可在 `ctx.effect()` 保护下监听 `document.documentElement` 属性变更：

```ts
export interface PrismuxThemeSnapshot {
  polarity: "light" | "dark";
  mode: "light" | "dark" | "glass";
  glassActive: boolean;
  gpuAvailable: boolean;
  accent: string;
}

export function readHostThemeSnapshot(): PrismuxThemeSnapshot {
  const html = document.documentElement;
  const computed = getComputedStyle(html);
  const polarity = html.getAttribute("data-pmx-theme") === "light" ? "light" : "dark";
  const rawMode = html.getAttribute("data-pmx-mode");
  const mode = rawMode === "light" || rawMode === "dark" || rawMode === "glass" ? rawMode : polarity;
  return {
    polarity,
    mode,
    glassActive: html.getAttribute("data-pmx-glass") === "1",
    gpuAvailable: html.getAttribute("data-pmx-gpu") !== "0",
    accent: computed.getPropertyValue("--pmx-accent").trim() || (polarity === "dark" ? "#5e9bff" : "#005fb8")
  };
}

export function observeHostTheme(onChange: (snap: PrismuxThemeSnapshot) => void): () => void {
  const observer = new MutationObserver(() => {
    onChange(readHostThemeSnapshot());
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [
      "data-pmx-theme",
      "data-pmx-mode",
      "data-pmx-glass",
      "data-pmx-gpu",
      "data-pmx-reduced-transparency",
      "style"
    ]
  });
  onChange(readHostThemeSnapshot());
  return () => observer.disconnect();
}
```
