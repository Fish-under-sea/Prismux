# Prismux UI/UX、主题与背景及安装包强制设计规范

> 本文档是 Prismux 工作台前端（`apps/workbench-ui`）、桌面原生壳（`apps/desktop-tauri`）、Windows 安装包（`apps/desktop-tauri/installer/`）及 UI 域插件页面的**强制视觉与交互红线**。
> 关联架构规范见 [`master-prompt-v1.3.md`](./master-prompt-v1.3.md)（第 2.4 与第 4 节）及工程入口 [`AGENTS.md`](../../AGENTS.md)。

> **视觉层零 Token 铁律**：动态壁纸、360° Fresnel 液态玻璃、主题调色、系统音频律动与安装引导均属于纯宿主视觉层，**严禁**向任何大模型或 Coding Agent 注入工具定义（Tool Schema）或 System Prompt，必须保持对模型 **0 Token 开销**。

---

## 一、世界级竞赛水准 UI/UX 与精致动效（A）

### 1.1 克制而高级的物理动效与微交互编排

- **弹簧物理阻尼曲线**：所有空间级过渡（「秘书待机预设」↔「多代理编码预设」切换、二元分屏拖拽缩放、浮动玻璃胶囊拖放吸附、面板展开收折）统一采用临界/微欠阻尼缓动曲线，禁止生硬的 `linear` 跳变、廉价弹跳（over-bouncy）或炫技浮夸粒子。
  - **推荐时间与曲线基准**：
    - 布局/预设切换与抽屉过渡：`220–280 ms`、`cubic-bezier(0.22, 1, 0.36, 1)`（快速起势、平滑减速落定）；
    - 天体三态胶囊滑块位移动效：`260–320 ms`、物理弹簧曲线（滑块与光晕跟随同步，无撕裂）；
    - 控件按压与选中反馈：`90–140 ms`、`cubic-bezier(0.2, 0, 0, 1)`；
    - 布局切换时，背景 Z-0 动态壁纸视口始终保持连续渲染与状态不中断。
- **减弱动效无障碍适配**：全局强制响应 `@media (prefers-reduced-motion: reduce)`；命中时将所有位移动效、缩放弹簧与视差追踪收敛为即时状态切换或极短透明度过渡（`<= 10 ms`），确保功能零降级。

### 1.2 精确尺寸刻度与排版节奏

严禁手写无根据的「孤值」（如某处 `22px`、某处 `30px` 导致网格错位），全界面严格对齐 **4 px 空间网格**：

| 维度 | 规范刻度 | 约束与说明 |
| :--- | :--- | :--- |
| 空间网格与间距 | `4 px` 倍数（组内 `8–12 px`，块间 `16–24 px`） | 卡片内边距统一使用 `16 px` 或 `20 px` |
| 字号阶梯 | 卡片标题 `14–16 px` / 小节标题 `13 px` / 正文与控件 `12.5–13 px` / 辅助说明 `12 px` | 禁止出现极小无根据碎字号（如 `10–11 px` 承担核心信息） |
| 列表与详情行高 | 紧凑列表项 `28 px` / 详情 `.kv` 行 `26 px` | **行距即行高**，选项间不额外叠加 `margin` |
| 控件高度与圆角 | 按钮/输入框/下拉触发器 `28–32 px`；卡片圆角 `14 px`、内部面板 `10–12 px`、胶囊与切换轨道 `999 px` | 禁止在 `26 px` 数据行中塞入 `30 px+` 按钮撑偏双栏对齐 |
| 等宽数字列 | `font-variant-numeric: tabular-nums` | Token 台账、配额百分比、端口、延迟、进度读数**强制启用**，防止数值跳变抖动 |
| Icon / Emoji 定高盒 | 统一包裹在 `16×16 px` 固定盒内 | 防止系统 Emoji 字形突破 `line-height` 把列表撑歪 |

所有图标与 Emoji 容器必须遵循定高盒约束：

```css
.prismux-ico {
  width: 16px;
  height: 16px;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 16px;
}
```

### 1.3 控件八态完备与无障碍对比度底线

任何可交互元素必须完整实现以下 **8 种状态**，缺一不可：

1. **默认态（`default`）**：描边使用 `--line-control`（与背景对比度 **≥ 3:1**），暗色下辅以内高光 `inset 0 1px 0 var(--hi)` 实现精细「抬起」层次。
2. **悬停态（`hover`）**：轻量提亮或微柔化底色（如 `filter: brightness(1.12)` 或语义叠加），不新造冲突色相。
3. **按压态（`active`）**：`transform: translateY(1px)` 提供物理触感反馈，不改变布局占位高度。
4. **键盘聚焦态（`focus-visible`）**：`outline: 2px solid var(--prismux-accent); outline-offset: 2px`，**严禁写全局 `outline: none`** 吞掉键盘可达性。
5. **禁用态（`disabled`）**：`opacity: 0.5` + **必须明确写出不可用原因**（行内 muted 提示、副文案或无障碍说明，如「Daemon 未连接，暂不可切换主秘书槽位」）。
6. **加载态（`loading`）**：局部 `aria-busy="true"` 与进行态文案/微指示器，禁止整页锁死；长耗时操作必须提供取消按钮。
7. **错误态（`error`）**：行内 `role="alert"` + 说清「发生了什么 + 下一步如何恢复」的中文文案与可重试入口，不吞错误也不裸抛错误码。
8. **选中/激活态（`selected / pressed`）**：同步写入 DOM 状态属性（`aria-selected` / `aria-pressed` / `aria-checked` / `aria-expanded`）+ 语义底色 `--sel-bg` 与固定位置强调条 `--sel-line`，不单独依赖颜色传递状态。

#### 无障碍对比度与降级铁律

- **对比度红线**：正文文字对背景 **≥ 4.5:1**；控件边框、分隔线与输入轮廓 **≥ 3:1**；三态文字/图标（`--c-ok` / `--c-warn` / `--c-bad`）对底色 **≥ 6:1**。
- **严禁用 `prefers-color-scheme` 覆盖宿主主题**：工作台及所有插件页面仅读取宿主下发的 `data-prismux-theme` 与 `--prismux-*` CSS 变量，避免系统浅色与工作台深色/玻璃模式双主题打架。
- **禁 GPU / 远程桌面 / 弱透明强制实底兜底**：在禁用 GPU 或部分无头环境中，浏览器 `@supports (backdrop-filter: blur(1px))` 仍可能返回真但实际不渲染模糊导致文字透穿。因此：
  - 需要高频阅读文字的弹层、菜单与确认条应使用高可读实底或稳妥不透明度；
  - 所有半透明玻璃表面必须同时具备三层降级兜底：

```css
/* 1. 浏览器不支持 backdrop-filter */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .prismux-glass-surface {
    background: var(--prismux-card);
    backdrop-filter: none;
  }
}

/* 2. 系统要求减弱透明，或宿主检测到禁 GPU / 软件渲染退化 */
@media (prefers-reduced-transparency: reduce) {
  .prismux-glass-surface {
    background: var(--prismux-card);
    backdrop-filter: none;
  }
}

html[data-prismux-gpu="0"] .prismux-glass-surface {
  background: var(--prismux-card);
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}

/* 3. 系统高对比度模式 */
@media (forced-colors: active) {
  .prismux-glass-surface {
    background: Canvas;
    color: CanvasText;
    border: 1px solid CanvasText;
  }
}
```

### 1.4 交互与布局反面清单（严禁触犯）

| 反面做法 | 危害与约束 |
| :--- | :--- |
| 在数据行内强塞高胶囊按钮 | 撑破 26 px / 28 px 行高基线，导致多栏文本逐行错位 |
| 组件 CSS 中写死 `blur(18px)` 或裸 `#000` 底 | 用户将玻璃调为全透或关闭模糊时页面失效、残余黑块或挖洞 |
| 对外层 `window` 无条件监听 `wheel` / `resize` 关闭浮层 | 在列表内部滚动时误关弹层；必须判 `if (popover.contains(e.target)) return` |
| 未知数据直接显示 `0` | `0` 是确定结论，未知必须显示「未告知」或「N 项未告知」 |
| 破坏性操作直接执行不提示 | 必须两步确认或提供可 `Esc` 撤销的安全门，撤销后把焦点还回触发源 |

---

## 二、「主题与背景」外观设置体系（B）

### 2.1 设置页头部卡片

- **卡片标题**：`主题与背景`
- **副标题说明**：合并调节动态壁纸引擎（`WebWallGL` / 视频 / 静态背景）与全工作台「浅色 / 深色 / 液态玻璃」三种视觉模式。
- **右上角状态胶囊徽章**：半透明胶囊实时展示当前生效模式与预设，例如：`浅色 · 晴空`、`深色 · 默认`、`玻璃 · 均衡`、`玻璃 · 全透`。

### 2.2 核心标志性组件——全宽内凹天体三态拟物切换胶囊

本组件是 Prismux「主题与背景」卡片的视觉核心，必须实现为**全宽圆角内凹轨道 + 3D 触感天体滑块球体 + 下方居中短蓝光指示栏**：

1. **轨道容器（全宽凹槽）**：
   - 横向铺满设置卡片主宽，高度充足（建议 `52–60 px`）、`border-radius: 999px`；
   - 具备深邃双层内阴影（模拟真实雕刻凹槽）与 `1px` 精细边缘高光，轨道背景随当前选中档位平滑过渡：
     - **档位 1：`浅色`（Light）**：柔和晴空微渐变轨道，内部点缀轻量云朵微剪影与柔和高光。
     - **档位 2：`深色`（Dark）**：深邃夜空轨道（深藏青/午夜蓝至深墨黑渐变），点缀精致四角星芒 `✦` 与微小星点，居中或对应滑块位置衬托同心大气光环；滑块为具备立体明暗与真实环形山浮雕纹理的 **3D 月球球体**，边缘环绕淡蓝大气底晕。
     - **档位 3：`玻璃`（Liquid Glass）**：深透冷调棱镜折射光斑轨道，滑块为具备 **360° Fresnel 边缘高光与内部光学折射弧** 的 **3D 水晶球体**。
2. **轨道下方三档文字标签与蓝光指示条**：
   - 轨道正下方三等分居中对齐显示：`浅色`、`深色`、`玻璃`；
   - 未选中档使用 `--prismux-muted`；**当前选中档文字高亮加粗**，并在文字正下方居中渲染一条 **2–3 px 高度的蓝光短指示条**（`#3b82f6` / `#6cb6ff` 配柔和微光晕）；
   - 语义上使用 `role="radiogroup"` + 三个 `role="radio"` 选项，支持 `←` / `→` 方向键与 `Space` / `Enter` 切换。

### 2.3 动态壁纸引擎控制（`WebWallGL` + Steam `431960` + 视频 / 静态壁纸）

- **壁纸源探测与管理**：
  - 自动探测本机 Steam `steamapps/workshop/content/431960` 目录，支持用户自定义本地文件夹与手动导入壁纸包；
  - 统一调度内置 MIT 开源引擎 `WebWallGL`（WebGL2 实时渲染 Wallpaper Engine `Scene` 粒子/骨骼/SceneScript/鼠标视差，异常时无缝降级为内嵌 MP4 或静态预览帧）、严格沙箱隔离承载 `Web` 壁纸、原生 `<video>` 播放视频壁纸。
- **壁纸参数控制**：
  - 壁纸底图遮罩浓度：联动写入全局 `--wall-veil`（随 `content` 区域不透明度动态重算，保障前景色对比度）；
  - 壁纸暗角强度（Vignette）与动态模糊半径；
  - 帧率上限控制（如 `30 FPS / 60 FPS / 原生`）。
- **节能与系统音频律动开关**：
  - **遮挡与节能挂起开关（默认开启）**：当 `apps/desktop-tauri` 检测到窗口最小化、被全屏窗口完全遮挡、系统锁屏或笔记本进入省电阈值时发出 `visibility: occluded`，壁纸渲染循环立即挂起至 **0% GPU / 0 FPS**；
  - **系统音频 FFT 律动开关**：通过 Windows WASAPI Loopback / macOS CoreAudio / Linux PipeWire 采集低延迟频谱与 Now Playing 元数据，驱动壁纸音频响应与工作台底栏音波。

### 2.4 四区域 360° Fresnel 液态玻璃精细控制

1. **四区域坐标模型**：
   工作台液态玻璃精确拆分为 **4 个独立区域**，各拥有独立的一对数值坐标：

| 区域标识 | 作用域 | 说明 |
| :--- | :--- | :--- |
| `sidebar` | 侧边栏与顶部状态栏 | 导航、会话树、顶部服务条（玻璃模式下顶栏自动透明融合） |
| `content` | 主界面内容区 | 对话流、编辑器、行级 Diff、工具卡片 |
| `overlay` | 浮层与对话框 | 审批弹层、下拉菜单、确认条、浮动胶囊（优先保证可读性） |
| `control` | 交互控件 | 按钮、输入框、分段控件、快捷键胶囊 |

   - 每个区域独立调节：
     - `fill`：**0%–100%** 不透明度百分比（`100%` = 完全实底；`0%` = 全透底色，但必须保留 Fresnel 边缘高光与柔光，且绝不残留 `#000` 黑底）；
     - `blur`：**0–40 px** 模糊半径（`0 px` = 无模糊）。
   - 「关闭」不是粗暴布尔隐藏，而是 `{ fill: 100, blur: 0 }`（同时顶层仍保留「液态玻璃模块总开关」，一键停用后秒回纯净原生扁平外观且壁纸不受影响）。
2. **五档快速预设**：提供 `关闭`、`轻透`、`均衡`、`全透`、`自定义` 五枚快捷预设（手动拖动任一区域滑块后自动切换为 `自定义`）。
3. **光学细节与独立调色**：
   - **独立玻璃色调 `--prismux-glass-tint`**：与强调色 `--prismux-accent` 完全解耦，未设置时回退中性玻璃，避免高饱和强调色把整块玻璃染脏；
   - **360° Fresnel 边缘高光强度**：控制四周光学菲涅尔亮边强度 + 抗色带微噪点叠层 + SVG 位移折射滤镜（Chromium 下以 `saturate(...) brightness(...)` 近似折射观感保底）；
   - **跟随本机 FISH-Dock 主题开关**：支持一键开启 `FishDock.theme` 桥接，自动同步本机 FISH-Dock 的明暗模式、强调色与四区玻璃参数。

### 2.5 独立文字颜色与排版调色台

- **浅色 / 深色文字颜色完全独立**：
  - 分别存储与调节「浅色模式调色组」与「深色模式调色组」的 **主文字色（`--fg` / `--prismux-text`）**、**次要文字色（`--fg-2` / `--prismux-muted`）**、**控件前景文字色（`--ctl-fg`）**，切换明暗/玻璃模式时自动切换对应组别，互不覆盖。
- **字体与强调色收敛**：
  - 支持字体家族选择与全局字重滑块；
  - 对高饱和强调色在玻璃底上的染色比例做自动收敛上限，确保代码、Diff 红绿条与终端字符高对比度可读。
- **DeepSeek 系列暗色模式专属轨道**：
  - 在暗色与玻璃深底模式下，`ReasoningEffortCard`（思考强度卡）的 DeepSeek 系列模型进度轨道**必须采用深海军蓝轨道 + 深蓝至浅蓝渐变填充 + `#6cb6ff` 高亮文字**，严禁偏紫，并与浅色模式白蓝轨道清晰区分。

### 2.6 工作台与插件主题同步契约（CSS 变量 + HTML 属性 + JS 钩子）

宿主每次初始化或切换主题时，在文档根 `<html>`（`:root`）同步以下只读属性与 CSS 变量（并允许导出/导入 `.wb-theme` 预设包，**导出时强制剥离一切本机路径与凭据**）：

1. **`<html>` 状态属性**：

| 属性 | 取值 | 含义 |
| :--- | :--- | :--- |
| `data-prismux-theme` | `'light'` \| `'dark'` | 当前基础色彩明暗度 |
| `data-prismux-mode` | `'light'` \| `'dark'` \| `'glass'` | 当前三态外观模式 |
| `data-prismux-glass` | `'1'` \| `'0'` | 液态玻璃是否激活（玻璃启用且任一区域 `fill < 100` 或 `blur > 0` 时为 `'1'`） |
| `data-prismux-gpu` | `'1'` \| `'0'`（可选） | 硬件加速状态；为 `'0'` 时玻璃表面自动退化为实底 |

2. **标准 CSS 变量清单**：
   - 基础语义与排版变量：`--prismux-bg`、`--prismux-card`、`--prismux-control`、`--prismux-line`、`--prismux-muted`（`--fg-2`）、`--prismux-text`（`--fg`）、`--prismux-accent`、`--ctl-fg`、`--wall-veil`、`--prismux-glass-tint`
   - 四区域玻璃变量：
     - `--prismux-glass-sidebar-fill` / `--prismux-glass-sidebar-blur`
     - `--prismux-glass-content-fill` / `--prismux-glass-content-blur`
     - `--prismux-glass-overlay-fill` / `--prismux-glass-overlay-blur`
     - `--prismux-glass-control-fill` / `--prismux-glass-control-blur`
   - 高光与壁纸参考变量：`--prismux-glass-border`、`--prismux-fresnel-strength`、`--prismux-wallpaper-dim`
   - 插件或面板引用示例（必须携带实底与 `0px` 回退值，禁止写死模糊像素）：

```css
.prismux-panel {
  background: color-mix(
    in srgb,
    var(--prismux-glass-tint, var(--prismux-card)) var(--prismux-glass-content-fill, 100%),
    transparent
  );
  -webkit-backdrop-filter: blur(var(--prismux-glass-content-blur, 0px)) saturate(180%) brightness(1.06);
  backdrop-filter: blur(var(--prismux-glass-content-blur, 0px)) saturate(180%) brightness(1.06);
  border: 1px solid var(--prismux-glass-border, var(--prismux-line));
  border-radius: 14px;
  box-shadow: inset 0 1px 0 var(--hi, rgba(255, 255, 255, 0.14));
}
```

3. **JS 桥接钩子**：
   - UI 域插件与沙箱扩展面板通过 `prismux.theme.current()` / `prismux.theme.onChange(cb)` 与 `prismux.glass()` / `prismux.onGlass(cb)` 订阅主题与四区参数变化（组件卸载时通过 `ctx.effect()` 自动取消订阅）；
   - 当开启「跟随本机 FISH-Dock 主题」时，由桥接适配器对接 `window.FishDock.theme` 同步色彩与玻璃参数，并保持对大模型 0 Token 开销。

---

## 三、安装包与首次引导界面设计规范（C）

> 核心美学原则：**精心设计但不要花哨（Quiet Luxury & Engineering Precision）**。
> 适用范围：Windows NSIS / Tauri v2 原生安装程序（`apps/desktop-tauri/installer/`）与软件首次启动引导流程（First-Run Onboarding）。

### 3.1 极简静奢视觉基调

- **自适应克制底色**：自动随系统明暗切换沉稳中性深底或柔白浅底，搭配 `1px` 精致细线边框与极克制的 Prismux 棱镜微光细线强调，保留充足呼吸留白。
- **严禁花哨元素**：禁止使用高饱和刺眼霓虹大渐变背景、炫光粒子动画、弹跳图标或夸大营销弹窗。
- **清晰数据读数**：所有进度百分比、磁盘空间、耗时与估算数值使用 `tabular-nums` 等宽数字对齐，并实时显示当前正在写入的精确文件路径，确保过程透明可预期。

### 3.2 清晰 5 步安装向导流程

安装器界面严格收敛为清晰 5 步（顶部/左侧配简洁步进指示器）：

| 步骤 | 页面名称 | 必须包含的核心内容与交互规范 |
| :--- | :--- | :--- |
| 第 1 步 | **欢迎** | 极简 Prismux 标志、一句话定位（「极简液态玻璃 AI 超级工作台与 24h 秘书系统」）、版本与协议摘要；直接提供主按钮「开始安装 / 下一步」 |
| 第 2 步 | **安装路径** | 清晰的目录选择框、所需空间 vs 剩余空间对比（`tabular-nums`），附简洁便携模式说明（支持随附 `data/` 目录零系统残留运行） |
| 第 3 步 | **组件确认** | **必须明确提示**：**「仅安装极简高效内核（守护中枢 + 工作台界面 + 单文件 SQLite 记忆引擎）；QQ 机器人、桌宠、FISH-Dock 灵动岛、SSH 运维、红队清洗五大官方独立插件默认绝不预装，安装完成后可在内置插件市场按需选装。」** |
| 第 4 步 | **安装中** | 平滑细腻的 1px–3px 细线进度条、等宽百分比读数（如 `064%`）、当前解压/写入的文件路径单行提示与稳定取消保护 |
| 第 5 步 | **完成** | 极简收尾状态提示、勾选「立即启动 Prismux」与快捷方式选项；首次启动后进入简明引导（快速选定默认外观模式与绑定主秘书代理，跳过繁琐问卷） |

---

## 四、M4 与安装包验收自检清单

- [ ] **0 Token 铁律**：所有壁纸、液态玻璃、主题与安装引导代码均未向任何大模型/Agent 注入 Tool Schema 或 System Prompt
- [ ] **动效与刻度**：`prefers-reduced-motion: reduce` 生效；空间网格对齐 `4 px`；所有数字列启用 `tabular-nums`；图标/Emoji 全量封装 `16×16` 盒
- [ ] **控件八态与对比度**：正文 ≥ 4.5:1、边框 ≥ 3:1、三态提示 ≥ 6:1；禁用态写明原因；无 `prefers-color-scheme` 覆盖宿主主题；含禁 GPU 与减弱透明实底兜底
- [ ] **天体三态胶囊**：具备全宽凹槽 + 3D 球体（浅色云日 / 深色四角星芒+大气光环月球 / 玻璃 Fresnel 水晶）+ 下方居中对齐文字与 `2–3 px` 蓝光指示条
- [ ] **四区玻璃与独立调色**：`sidebar / content / overlay / control` 支持独立 `fill`（`0–100%`）与 `blur`（`0–40 px`）；`fill=0%` 无黑底残留；浅/深文字色独立配置；DeepSeek 暗色轨道为深海军蓝至 `#6cb6ff`；支持 `.wb-theme` 无路径无凭据导出
- [ ] **壁纸与节能**：支持 Steam `431960` 扫描、音频 FFT 律动，且窗口最小化或遮挡（`visibility: occluded`）时立刻挂起至 `0 FPS`
- [ ] **安装包 5 步流**：`欢迎 → 安装路径 → 组件确认 → 安装中 → 完成` 极简克制无霓虹浮夸效果，组件确认页明确声明五大官方插件默认不预装
