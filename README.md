<div align="center">

<p>
  <a href="README.md"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-zh-zh-dark.png"><img src="assets/readme/key-zh-zh-light.png" alt="中文" height="40"></picture></a>
  <a href="README.en.md"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-en-zh-dark.png"><img src="assets/readme/key-en-zh-light.png" alt="English" height="40"></picture></a>
  <a href="#install"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-start-zh-dark.png"><img src="assets/readme/key-start-zh-light.png" alt="快速开始" height="40"></picture></a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme/hero-zh-dark.png">
  <img src="assets/readme/hero-zh-light.png" alt="Prismux — 极简液态玻璃 AI 超级工作台与 24h 秘书系统" width="1448">
</picture>

<p>
  <a href="https://github.com/Fish-under-sea/Prismux/releases/tag/v0.1.1-preview.1"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/stat-version-zh-dark.png"><img src="assets/readme/stat-version-zh-light.png" alt="VERSION：0.1.1-preview.1（Preview 1 · T3 底座 · Win x64）" width="23%"></picture></a>
  <a href="#preview"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/stat-visual-zh-dark.png"><img src="assets/readme/stat-visual-zh-light.png" alt="VISUAL：0 TOKEN（360° 液态玻璃）" width="23%"></picture></a>
  <a href="#features"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/stat-memory-zh-dark.png"><img src="assets/readme/stat-memory-zh-light.png" alt="MEMORY：SQLITE VEC（单文件物理隔离）" width="23%"></picture></a>
  <a href="#plugins"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/stat-plugins-zh-dark.png"><img src="assets/readme/stat-plugins-zh-light.png" alt="PLUGINS：4 PLUGINS（默认不预装）" width="23%"></picture></a>
</p>

<p>
  <img src="https://img.shields.io/badge/Node.js-%3E%3D24.12-8fd6a0?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white&amp;labelColor=5a544a" alt="Node.js >= 24.12">
  <img src="https://img.shields.io/badge/pnpm-12-8fd6a0?style=flat-square&amp;logo=pnpm&amp;logoColor=white&amp;labelColor=5a544a" alt="pnpm 12">
  <img src="https://img.shields.io/badge/TypeScript-5.8-8fd6a0?style=flat-square&amp;logo=typescript&amp;logoColor=white&amp;labelColor=5a544a" alt="TypeScript 5.8">
  <img src="https://img.shields.io/badge/Electron-44-8fd6a0?style=flat-square&amp;logo=electron&amp;logoColor=white&amp;labelColor=5a544a" alt="Electron 44">
  <img src="https://img.shields.io/badge/License-MIT-8fd6a0?style=flat-square&amp;labelColor=5a544a" alt="License MIT">
  <img src="https://img.shields.io/badge/Release-v0.1.1--preview.1-f08a5d?style=flat-square&amp;labelColor=5a544a" alt="Release v0.1.1-preview.1">
</p>

<p><strong>Prismux · 极简液态玻璃 AI 超级工作台与 24 小时常驻秘书系统</strong><br>基于真实 T3 Code 本体（Electron 44 + <code>apps/server</code> + <code>apps/web</code>）最小入侵挂载构建，融合 Orca 风格左侧边栏与 54px 常驻图标栏、Orca 单体输入框与模型识别奔跑小人思考条（0-Token）、双层零依赖手机模拟器、28 项服务体检中心、24px 底部状态栏、TTFT/TPS 用量调用日志、4 组动效设置重构与国内外双源分卷自动更新。</p>

<p>
  <a href="#install"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-download-zh-dark.png"><img src="assets/readme/key-download-zh-light.png" alt="下载 / Releases" height="40"></picture></a>
  <a href="https://github.com/Fish-under-sea/Prismux/releases/tag/v0.1.1-preview.1"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-release-zh-dark.png"><img src="assets/readme/key-release-zh-light.png" alt="更新记录" height="40"></picture></a>
  <a href="https://github.com/Fish-under-sea/Prismux/issues"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-issues-zh-dark.png"><img src="assets/readme/key-issues-zh-light.png" alt="反馈 / Issues" height="40"></picture></a>
</p>

</div>

<h2 id="intro"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-intro-zh-dark.png"><img src="assets/readme/section-intro-zh-light.png" alt="INTRO · 简介" width="100%"></picture></h2>

Prismux 是一个围绕 **「真实 T3 Code 内核 + 外置独立 0-Token 视觉壳 + 按需独立插件」** 构建的 AI 超级工作台与 24 小时无头秘书系统。**Prismux v0.1.1 Preview 1**（`v0.1.1-preview.1`）在真实 **T3 Code 本体底座**（Electron 44 + `apps/server` + `apps/web`，全部挂载点与 Provider 扩展点严格登记于 [`docs/t3code-patch-manifest.md`](docs/t3code-patch-manifest.md)，零修改 `vendor/t3code/pnpm-lock.yaml`）之上，带来全面交互打磨与核心功能闭环：

- **Orca 交互重绘 + `dsh-fish` 奔跑小人思考条 + 实时遥测条**：对照 Orca 源码重绘单体液态玻璃输入框、4 档中文权限盾牌（请求批准 / 接受编辑 / 替我批准 / 完全访问）、统一模型弹层集成 **`dsh-better-reasoning-effort-fish`** 8 大模型家族自动识别动态思考强度滑条（0-Token 纯宿主视觉，支持 `prefers-reduced-motion`）与 Codex/Claude **`⚡ 快速`（Fast Mode）**；输入框外部下方实时采集本地真实 `TPS`、Token 缓存命中率与 `14×14` SVG 上下文进度圈。
- **Orca 左侧边栏 + 54px 常驻图标栏 & 300ms 预测锥**：对齐 Orca 重构顶部搜索与合规导航（`服务体检 / 自动化 / Prismux 手机端 [新功能] / 插件中心`，严禁 `Bots`）、`⌄ 项目` 紧凑头与通知铃铛，收起后变为 `54px` 常驻图标栏配两段式先后动效（先 90ms 淡出文字再收窄，展开先宽后字）；全局悬停子菜单内置 300ms **Safe Triangle 预测锥**（仅拦截鼠标，100% 放行键盘与触控）。
- **零依赖双层手机模拟器 & Android 双源工具链**：内置 6 款主流移动机身预设（支持 `暂无预览` 空白页 1 键启动与横竖屏 60ms 旋转），Electron CDP（`deviceScaleFactor: 0` + `touch` 注入）与单层 CSS 等比缩放协同保障 Windows 150% DPI 屏幕四角 0 裁切且不压盖 24px 底部状态栏；Android 设备工具链按 `npmmirror → npmjs` 回退。
- **24px 状态栏、28 项服务体检中心与 TTFT/TPS 调用日志**：底部单行 24px 状态栏聚合额度 / 4 档 Context 水位 + 压缩刻度 / Prompt Cache 明细 / 去重 `Ports`（防误杀）与 `CPU / RAM`（三态对比度 ≥ 4.5:1）；`/settings/diagnostics` 提供 6 分组 28 项探活与 3 大沉睡内核只读摘要；`/usage` 新增平均 TTFT/TPS、实际缓存命中率及 **`调用日志`** 页签（至多 500 条真实本地记录）。
- **4 组设置架构重排 + 保留原生归档**：设置侧栏收敛为 4 个纯中文分组（带水平分割线与同组 GPU `translate3d` 滑动 / 跨组 `crossfade` 双层指示器），合并「外观与壁纸」「关于与更新」，清理 `Boring Sidebar` / `Guest Links` / `Simlock` / `EAS` / `T3 Connect`，并**按项目决策明确保留 T3 Code 原生轻量线程归档（`/settings/archived`）**。
- **软件内双源分卷自动更新 + `omp acp` / Antigravity 合规接入 + 零预装插件**：内置更新器支持 GitHub ↔ Gitee（80 MB `.7z.001..003` + 随包 `resources/tools/7za.exe` 无损重组与 SHA-256 强制校验，OpenAPI 403 自动回退 Web Releases）；完整支持 `omp acp` 一等公民方言与纯官方 `agy acp`（零 OAuth/Keyring/`v1internal` 窃读）；Cordis 声明式液态玻璃 UI（`z-[70]` / `z-[80]` Portal）与四大官方插件 **100% 零预装**。

当前发行版本为 **`Prismux v0.1.1 Preview 1`**（`v0.1.1-preview.1`），率先提供 Windows x64 安装包 `Prismux-Setup-0.1.1-preview.1-win-x64.exe`（GitHub Releases 与 Gitee Releases 双源发布），macOS 与 Linux 安装包通道已预留。

<h2 id="preview"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-preview-zh-dark.png"><img src="assets/readme/section-preview-zh-light.png" alt="PREVIEW · 界面实景" width="100%"></picture></h2>

> 以下均为 **Prismux v0.1.1 Preview 1（`v0.1.1-preview.1`）Electron 44 Windows 实机二进制**终审签收高清截图，未经任何 P 图修饰：

<table>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="assets/readme/01-workbench-glass-phone.png" width="100%" alt="Prismux 液态玻璃主工作台、Orca 侧栏与输入框、24px 状态栏与零裁切手机模拟器">
      <br>
      <sub><strong>液态玻璃主工作台 + Orca 侧栏/输入框 + 零裁切手机模拟器</strong>：左栏呈 Orca 搜索/服务体检/手机端 <code>[新功能]</code> 徽标；中央液态玻璃输入框配 4 档权限盾牌；右侧 iPhone 16 Pro 机身在 150% DPI 下实现 <code>393×852</code> 四边 0 裁切与 <code>ontouchstart=true</code>；底部 24px 状态栏清晰不被压盖。</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="assets/readme/02-collapsed-rail-claude-slider-fast.png" width="100%" alt="Prismux 54px 常驻图标栏收起态与 Claude 模型识别奔跑小人思考条及快速模式">
      <br>
      <sub><strong>54px 常驻图标栏收起态 + <code>dsh-fish</code> 奔跑小人思考条 + <code>⚡ 快速</code></strong>：左侧收起为 54px 图标栏与底部居中竖排图标列；点击模型胶囊选中 <code>Claude Opus 5.5</code> 后，自动切换为暖橙色像素矩阵轨道与奔跑小人，并显示 Codex/Claude 专属 <code>速度 · ⚡ 快速</code> 开关（对大模型 <strong>0 Token</strong>）。</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="assets/readme/03-usage-call-logs.png" width="100%" alt="Prismux 用量面板 TTFT、TPS、96.3% 实际缓存命中率与调用日志页签">
      <br>
      <sub><strong>用量面板 + TTFT/TPS 汇总与调用日志页签</strong>：统计 <code>2.78B</code> Token 与每日分布趋势，<code>总计</code> 区实时汇总平均首字响应（TTFT）、平均输出速度（TPS）与 <code>96.3%</code> 实际缓存命中率；<code>调用日志</code>（<code>/usage#calls</code>）支持按提供方/模型筛选、排序与展开明细。</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="assets/readme/04-settings-about-updates.png" width="100%" alt="Prismux 4 分组设置侧栏与关于与更新页面 GitHub、Gitee 双源绿灯">
      <br>
      <sub><strong>4 分组设置侧栏 + 关于与更新双源绿灯</strong>：设置侧栏重构为 4 个带分割线的纯中文分组（保留 <code>归档</code>）；<code>关于与更新</code> 内嵌双源内更新中心（<code>v0.1.1-preview.1</code>），实测 <code>GitHub Releases (245 ms)</code> 与 <code>Gitee Releases (233 ms)</code> 双线绿灯并支持 3 分卷无损更新。</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="assets/readme/05-settings-diagnostics.png" width="100%" alt="Prismux 28 项服务体检中心与宿主核心四项全绿">
      <br>
      <sub><strong>28 项服务体检中心（宿主核心 4/4 全绿）</strong>：实时汇总 Daemon、T3 Server（<code>HTTP 200</code>）、Electron Bridge、Resource Monitor 与记忆 FTS5 / <code>sqlite-vec</code> 运行态，并单列只读展示 <code>OvernightFactory</code>、<code>LifecycleHookBus</code>、<code>WorktreeSandbox</code> 就绪状态。</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="assets/readme/06-settings-plugins-drawer.png" width="100%" alt="Prismux 四态插件中心与高不透明 Portal 详情抽屉（四大官方插件零预装）">
      <br>
      <sub><strong>四态插件中心 + Portal 详情抽屉（零预装验证）</strong>：详情抽屉经 <code>createPortal(..., document.body)</code> 挂载于 <code>z-[70]</code> 高不透明磨砂面之上，清晰展示 <code>distribution: managed</code>、<code>engines.prismux</code>、SHA-256、<code>0600</code> 凭据隔离及 <code>0 Token 宿主纯净</code> 声明，四大官方插件均呈「未预装 / 按需安装」。</sub>
    </td>
  </tr>
</table>

<h2 id="features"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-features-zh-dark.png"><img src="assets/readme/section-features-zh-light.png" alt="FEATURES · 核心能力" width="100%"></picture></h2>

<table>
  <tr>
    <td width="50%" valign="top">
      <strong>1. T3 Code 底座、<code>omp acp</code> 与纯官方 <code>agy acp</code></strong>
      <p>Electron 44 桌面端（<code>PrismuxDaemonService</code>）监督托管 <code>@prismux/daemon</code>（仅向守护子进程注入 <code>ELECTRON_RUN_AS_NODE=1</code> 并透传真实 T3 Server 地址），首启进入 <code>/welcome</code> 引导后常驻工作台，支持 Claude / Codex / Antigravity / OpenCode / OMP 担任 <code>Chief Thread Slot</code> 主秘书。</p>
      <p>内置 Antigravity 100% 走官方 <code>agy acp</code>（<code>local-cli</code>，零窃读本地凭据、零 <code>v1internal</code> 旁路）；<code>omp acp</code> 一等公民方言完整打通 <code>_session/steering</code> 转向、纯 ACP <code>_omp/usage</code>、Shell 清洗与断线重连。</p>
    </td>
    <td width="50%" valign="top">
      <strong>2. 五大标杆内化原语（严禁 4 项冗余看板）</strong>
      <p>永久裁撤 Task Board、AgentTeam DAG、Skill Lens、Visual Companion 及自建重型会话归档系统（保留 T3 Code 原生轻量 <code>/settings/archived</code>），凝练为五大高精度原语：</p>
      <ul>
        <li><code>PersistentPtyPool</code>：每终端 <code>2 MB</code> 环形缓冲与断线无损回放</li>
        <li><code>HandoffEngine</code>：<code>/handoff</code> 提纯续跑、<code>agent / oracle / review</code> 三档拨盘与 Orca 动态围栏延续</li>
        <li><code>CollectorAndGuard</code>：多格式切片 + 传输层身份注入与 <code>60 s</code> 熔断</li>
        <li><code>LifecycleHookBus</code>：6 类钩子、退出码 <code>2</code> 拦截与默认 <code>onFailure: "block"</code></li>
        <li><code>WorktreeSandbox</code>：OS 级写隔离与域名白名单本地 HTTP 代理网关</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>3. Mnemopi 记忆召回、物理隔离与夜间工场</strong>
      <p>全部记忆收敛于单文件 <code>~/.prismux/data/memory.db</code>（SQLite WAL + FTS5 + <code>sqlite-vec</code>），融合 <strong>Mnemopi Prompt-Cache</strong> 友好召回（<code>&lt;memories&gt;</code>/<code>&lt;memory-delta&gt;</code> XML 转义防护、两阶段 <code>prepare/commit</code> 与 4 级分域缓存）及 Obsidian 迁移接口。<code>forwardIdentity</code> 在传输层强制覆写 <code>_callerScope</code>，<code>qq_group:&lt;gid&gt;</code> 绝不可读取 <code>private/chief</code> 或 <code>workspace/*</code>。</p>
      <p><code>OvernightFactory</code> 串联 Gmail OAuth2 / IMAP <code>#factory</code> 入站 → 记忆立项 → Worktree 沙箱编码提交 → Oracle 只读 <code>review</code> → 带 Diff 与 <code>prismux://review/&lt;threadId&gt;</code> 的 HTML 早报。</p>
    </td>
    <td width="50%" valign="top">
      <strong>4. 0-Token 视觉矩阵、Orca 交互与思考强度滑条</strong>
      <p><code>@prismux/appearance</code> 沉淀 1:1 FISH-Dock 天体三态胶囊与 <code>&lt;PrismuxReasoningEffortSlider /&gt;</code>（<code>dsh-better-reasoning-effort-fish</code> 8 大模型家族识别 + 内嵌 RGBA WebP 奔跑小人 + Canvas 像素辐射），结合 <code>@prismux/wallpaper</code>（Steam <code>431960</code> / WebWallGL / 遮挡 <code>0 FPS</code> 挂起）、24px 状态栏与 4 组动效设置重构，保持对大模型 <strong>0 Token 开销</strong>与 ≥ 4.5:1 对比度。</p>
      <p>全局 300ms 悬停预测锥、54px 图标栏收起动效、Orca 单体输入框与底部 TTFT/TPS 实时遥测条均纯本地真实渲染。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>5. Cordis 声明式插件中心与 Magpie 加密同步</strong>
      <p><code>@prismux/cordis-kernel</code> 强制校验顶层 <code>engines.prismux</code> SemVer，以 <code>ctx.effect()</code> 实现卸载零残留回滚，内置 <code>512 KiB</code> 预算声明式液态玻璃 UI（<code>DeclarativeGlassRenderer</code>）与 4 态插件中心（<code>distribution: "managed"</code> 锁与 <code>0600</code> 独立凭据）；社区 npm 导入免 Git 禁安装脚本。</p>
      <p><code>@prismux/sync-vault</code> 采用 Argon2id + AEAD 密封 <code>.prismux-backup</code>，支持 WebDAV / S3 / GitHub 独立开关、<code>If-Match</code> 乐观锁、<code>60 s</code> 停滞看门狗与便携 <code>data/</code> 模式。</p>
    </td>
    <td width="50%" valign="top">
      <strong>6. 手机模拟器、28 项诊断与分卷双源自动更新</strong>
      <p>内置零依赖手机模拟器结合 Electron CDP（<code>deviceScaleFactor: 0</code> + 触控注入）与单层 CSS 缩放，保障高 DPI 四边 0 裁切，Windows Android SDK 支持 5 态诊断与 <code>npmmirror</code> 回退。</p>
      <p><code>AppUpdater</code> 在 <strong>GitHub ↔ Gitee</strong> 与 <strong>npm ↔ npmmirror</strong> 间测速选优（OpenAPI 403 自动降级 Web Releases 解析），支持 Gitee 3 分卷 <code>7za.exe</code> 重组、SHA-256 强制校验与桌面端一键安装重启；10 语种词典同步（<code>en/zh</code> <code>10,296</code> 词条 100% 对齐）。</p>
    </td>
  </tr>
</table>

<h2 id="plugins"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-plugins-zh-dark.png"><img src="assets/readme/section-plugins-zh-light.png" alt="PLUGINS · 官方独立插件" width="100%"></picture></h2>

> [!NOTE]
> **四大官方插件默认绝不预装**：`Prismux-Setup-0.1.1-preview.1-win-x64.exe` 安装包及解压态 `win-unpacked/` 均**绝不包含** `plugins-official/` 任何插件目录（打包后通过递归扫描 0 命中校验）。以下 4 个官方插件均以独立 `.wb-plugin` 归档（配合 `prismux-plugins-official.json` 与 `prismux-plugins-0.1.1-preview.1-SHA256SUMS.txt`）及无脚本 npm 单包形式分发，按需安装并支持 `ctx.effect()` 零残留卸载。

| 插件 ID | 独立归档包（`.wb-plugin`） | npm 包名（无作用域 / GitHub Packages） | 运行域（`realms`） | 核心能力与隔离边界 |
| :--- | :--- | :--- | :--- | :--- |
| `qq` | `prismux-plugin-qq-0.1.1-preview.1.wb-plugin` | `prismux-plugin-qq`<br><code>@fish-under-sea/prismux-plugin-qq</code> | `daemon`、`ui` | OneBot v11 正/反向 WebSocket 自动探测（NapCatQQ / Lagrange.Core）；私聊主人接入主秘书，群聊启用防刷屏节奏器并硬隔离至 <code>social/qq-group-&lt;gid&gt;</code> |
| `pet` | `prismux-plugin-pet-0.1.1-preview.1.wb-plugin` | `prismux-plugin-pet`<br><code>@fish-under-sea/prismux-plugin-pet</code> | `ui`、`daemon` | 桌宠联动插件；实现定向实例绑定、带过期校验的 Lease Token 租约锁、只读播放进度订阅与动作/气泡分阶段交还 |
| `fishdock-hook` | `prismux-plugin-fishdock-hook-0.1.1-preview.1.wb-plugin` | `prismux-plugin-fishdock-hook`<br><code>@fish-under-sea/prismux-plugin-fishdock-hook</code> | `daemon` | FISH-Dock 灵动岛桥接插件；将 `PreToolUse` 中文风险审批、重要邮件与夜间工场完工回执推送至灵动岛卡片并支持快捷放行/驳回 |
| `ssh` | `prismux-plugin-ssh-0.1.1-preview.1.wb-plugin` | `prismux-plugin-ssh`<br><code>@fish-under-sea/prismux-plugin-ssh</code> | `daemon`、`ui` | 按需选装的远程运维插件；提供隔离 SSH 主机池、Web PTY 会话桥接、路径安全校验与 SFTP 文件浏览 |

<h2 id="install"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-install-zh-dark.png"><img src="assets/readme/section-install-zh-light.png" alt="INSTALL · 下载与双源更新" width="100%"></picture></h2>

### 双网络发行入口（GitHub Releases ↔ Gitee Releases）

| 分发渠道 | 适用场景 | 入口 / 下载说明 |
| :--- | :--- | :--- |
| **GitHub Releases**（国际直连） | 海外网络 / GitHub CLI 环境 | [Release 页面（`v0.1.1-preview.1`）](https://github.com/Fish-under-sea/Prismux/releases/tag/v0.1.1-preview.1) · [直下 `Prismux-Setup-0.1.1-preview.1-win-x64.exe`](https://github.com/Fish-under-sea/Prismux/releases/download/v0.1.1-preview.1/Prismux-Setup-0.1.1-preview.1-win-x64.exe) |
| **Gitee Releases**（国内镜像） | 中国大陆直连加速下载 | [Release 页面（`v0.1.1-preview.1`）](https://gitee.com/Fish-under-sea/Prismux/releases/tag/v0.1.1-preview.1)（含 80 MB 7z 无损分卷 `.7z.001..003`、分卷汇总校验与全部官方插件归档） |
| **软件内更新中心**（推荐） | 自动测速 GitHub / Gitee、分卷重组与强制 SHA-256 校验 | 在工作台打开 **设置 → 关于与更新**（`/settings/about#prismux-updates`），可在 `智能测速 / 国内优先 / 国际优先` 间秒切并一键安装重启 |

### 平台下载矩阵与完整性校验

| 平台 / 发行资产 | 文件名 / 计划状态 | 说明与隔离策略 |
| :--- | :--- | :--- |
| **Windows x64 安装包（Electron 44 NSIS）** | `Prismux-Setup-0.1.1-preview.1-win-x64.exe`（Gitee 同步提供 `.7z.001..003`） | 内含完整 Electron 44 桌面端、Bundled `resources/prismux-daemon/`、`resources/tools/7za.exe` 与 `t3-resource-monitor.exe`；支持 `/D=<目录>` 自定义路径；状态目录隔离于 `~/.prismux/`（亦支持便携 `data/`）；**四大官方插件零预装** |
| **macOS（Apple Silicon / Intel）** | `暂未发布（已预留通道占位）` | 后续预览版将提供 `.dmg` 通用或分架构归档，复用同一套 `0-Token` 视觉与 `~/.prismux/` 隔离规范 |
| **Linux（x86_64 / arm64）** | `暂未发布（已预留通道占位）` | 后续预览版将提供 `.AppImage` / `.deb` 发行资产，同样支持双源更新与独立插件导入 |
| **4 个官方独立插件包** | `prismux-plugin-{qq,pet,fishdock-hook,ssh}-0.1.1-preview.1.wb-plugin` & `prismux-plugins-official.json` | 四枚确定性 ustar + gzip 归档，下载后在 **设置 → 插件中心**（`/settings/plugins`）按需验签导入 |
| **分离式合并校验清单** | `Prismux-0.1.1-preview.1-SHA256SUMS.txt` & `prismux-plugins-0.1.1-preview.1-SHA256SUMS.txt` | 手动下载后可通过 `Get-FileHash Prismux-Setup-0.1.1-preview.1-win-x64.exe -Algorithm SHA256` 或 `7z t` 核对完整性 |

<h2 id="packages"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-packages-zh-dark.png"><img src="assets/readme/section-packages-zh-light.png" alt="PACKAGES · npm 与国内镜像" width="100%"></picture></h2>

每个官方独立插件均额外发布为**零 `preinstall / install / postinstall` 脚本**的单包归档，内部携带已校验的 `prismux-plugin-<id>-0.1.1-preview.1.wb-plugin` 与防覆盖导出 CLI（`prismux-plugin-<id>`）；软件内插件市场同样支持在 **`registry.npmjs.org` ↔ `registry.npmmirror.com`** 间免本机 Git 纯流式拉取与自动故障回退。

```powershell
# 1. 从 npm 官方源安装并提取 .wb-plugin 归档（含 SHA-256 核对，目标同名文件存在时不覆盖）
npm install prismux-plugin-qq@0.1.1-preview.1
npx prismux-plugin-qq --out ./plugins-stage

# 2. 中国大陆网络使用 npmmirror 国内镜像加速安装
npm install prismux-plugin-qq@0.1.1-preview.1 --registry=https://registry.npmmirror.com
npx prismux-plugin-qq --out ./plugins-stage
```

- **可选插件前缀替换**：将上方命令中的 `qq` 替换为 `pet`、`fishdock-hook` 或 `ssh` 即可获取对应官方插件归档，然后在设置页 **插件中心**（`/settings/plugins`）直接拖入或选择导入。
- **GitHub Packages 同步包**：发布后工作流同步推送 `@fish-under-sea/prismux-plugin-{qq,pet,fishdock-hook,ssh}` 至 `https://npm.pkg.github.com`，方便企业或 CI 流水线拉取校验。

<h2 id="develop"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-develop-zh-dark.png"><img src="assets/readme/section-develop-zh-light.png" alt="DEVELOP · 开发与验收" width="100%"></picture></h2>

> **前置工具链**：`Node.js >= 24.12.0`、`pnpm >= 10.0.0`（主仓锁定 `pnpm@12.3.4`）、`Electron 44` 与 `Rust >= 1.85`（用于编译 `vendor/t3code/native/resource-monitor`；Windows 下运行 Cargo 请固定传入 `-j 1` 与 `NO_PROXY=*`）。执行前请先读取 [`AGENTS.md`](AGENTS.md)、[`docs/t3code-patch-manifest.md`](docs/t3code-patch-manifest.md) 与对应的个人环境档案 `docs/agents/local/<规范化用户名>.md`。

```powershell
# 1. 安装主仓工作区依赖（12 个 TS 工作区包）
pnpm install

# 2. 全仓构建、独立类型检查与全仓测试
pnpm -r build
pnpm -r typecheck
pnpm -r --if-present test
pnpm test:scripts

# 3. 校验 vendor/t3code managed-fork 契约、基线提交与补丁台账
pnpm upstream:check

# 4. 在 vendor/t3code 下检查并构建真实 Electron 44 桌面端（web + server + desktop）
pnpm --dir vendor/t3code exec vp run --filter @t3tools/web typecheck
pnpm --dir vendor/t3code exec vp run --filter @t3tools/desktop typecheck
pnpm --dir vendor/t3code exec vp run build:desktop

# 5. 一键串联主仓构建 + T3 底座构建 + Windows NSIS 安装包打包（含 7z 校验与 SHA256SUMS）
pnpm desktop:build
pnpm desktop:installer

# 6. 为指定官方插件生成确定性 .wb-plugin（内置 gunzip 回环校验）
pnpm plugin:pack -- --plugin plugins-official/plugin-qq
```

<details>
<summary><strong>展开查看：Monorepo 目录树与 T3 Code 最小入侵边界</strong></summary>

```text
prismux/
├── AGENTS.md                            # 跨机器统配入口、五大工程红线与验收门禁
├── LICENSE                              # 标准 MIT 开源许可证
├── README.md / README.en.md             # 中英双语项目主页
├── UPSTREAM_LOCK.json                   # pingdotgg/t3code 基线 SHA、managed-fork 模式与台账指针
├── pnpm-workspace.yaml                  # 12 个 TS 工作区包白名单（排除 vendor/t3code 与 desktop-tauri）
├── package.json                         # 根任务编排脚本（0.1.1-preview.1）
├── tsconfig.base.json                   # TypeScript 5.8+ 严格共享基线（ES2024 + NodeNext）
├── assets/
│   ├── logo.png                         # 透明 1024×1024 吉祥物主图标
│   └── readme/                          # 立体像素头图、分栏横幅、Preview 1 实机截图与渲染模板
├── docs/
│   ├── t3code-patch-manifest.md         # T3 Code MP-01 ~ MP-07 最小入侵挂载与扩展点权威台账
│   ├── agents/                          # 按人存放的本机环境档案说明、模板与个人档案
│   ├── releases/v0.0.1-alpha.1.md       # 早期原型版本归档说明
│   └── specs/
│       ├── master-prompt-v1.3.md        # 全栈自主施工总指令书（架构宪法）
│       └── ui-ux-design-mandate.md      # UI/UX、主题与背景及安装包强制设计规范
├── scripts/                             # 运维脚本与 README 渲染器（纯 Node 24 原生 TS / ESM）
│   ├── build-prismux-desktop.ts         # 一键桌面构建与 NSIS 安装包编排器（--installer / --skip-rust）
│   ├── release-all.ts                   # 桌面安装包 + 4 大官方插件 + npm 单包 + SHA256SUMS 统一发布
│   ├── sync-t3-upstream.ts              # managed-fork / 上游锁校验脚本（--check / --sync）
│   ├── pack-plugin.ts                   # 确定性 ustar + gunzip 回环校验插件打包器
│   ├── build-npm-plugin-packages.ts     # 生成无脚本 npm / GitHub Packages 插件单包
│   ├── rename-brand.ts                  # 全局品牌标识安全替换脚本
│   ├── render-readme.mjs                # Edge CDP 立体像素头图与分栏横幅渲染器
│   └── __tests__/scripts.test.ts        # node:test 回归测试
├── vendor/
│   └── t3code/                          # T3 Code 运行底座（Electron 44 + server + web），受控于 MP-01 ~ MP-07 台账
├── packages/                            # 6 个核心 workspace 包
│   ├── protocol/                        # @prismux/protocol：品牌常量、RPC、Hook、记忆、插件与更新契约
│   ├── cordis-kernel/                   # @prismux/cordis-kernel：双域插件内核、声明式 UI 校验、双源流式安装器与 0600 凭据
│   ├── memory-core/                     # @prismux/memory-core：SQLite WAL + FTS5 + sqlite-vec、Mnemopi 召回与物理防泄密
│   ├── sync-vault/                      # @prismux/sync-vault：Argon2id + AEAD 同步、乐观锁与 60 s 看门狗
│   ├── prismux-appearance/              # @prismux/appearance：天体胶囊、声明式液态玻璃、模型识别动态思考强度滑条与 T3 玻璃桥
│   └── prismux-wallpaper/               # @prismux/wallpaper：双页签边栏、4 页签设置、Z-0 舞台与 Steam 431960 扫描
├── apps/                                # 核心守护进程（含待退役原型壳与历史壳）
│   ├── daemon/                          # @prismux/daemon：24h 守护、主秘书槽位、五大原语、服务体检/端口资源与夜间工场
│   ├── workbench-ui/                    # @prismux/workbench-ui：[待退役原型壳] v0.0.1 原型界面，已由真实 T3 Code 底座接替
│   └── desktop-tauri/                   # prismux-desktop：[历史原生壳] 主桌面端已切换为 T3 Code Electron 44
└── plugins-official/                    # 4 个官方独立插件（workspace 包）与权威索引
    ├── catalog/official.json            # 官方插件权威发布索引（SHA-256 / bytes / engines / status）
    ├── plugin-qq/                       # @prismux/plugin-qq
    ├── plugin-pet/                      # @prismux/plugin-pet
    ├── plugin-fishdock-hook/            # @prismux/plugin-fishdock-hook
    └── plugin-ssh/                      # @prismux/plugin-ssh
```

</details>

<details>
<summary><strong>展开查看：五大绝对工程红线</strong></summary>

1. **T3 Code 本体最小入侵与业务外置原则**：`vendor/t3code/` 仅允许保留已登记于 [`docs/t3code-patch-manifest.md`](docs/t3code-patch-manifest.md) 的 MP-01 ~ MP-07 标准化挂载与扩展点（且零修改 `vendor/t3code/pnpm-lock.yaml`），严禁散落业务逻辑；重逻辑全部沉淀于主仓 `packages/*` 与 `apps/daemon`。
2. **严禁混入已砍掉的 4 项冗余模块（保留 T3 Code 原生轻量线程归档）**：禁止实现 Task Board、AgentTeam DAG、Skill Lens、Visual Companion 及自建重型会话归档系统，统一由五大内化原语替代；**T3 Code 原生轻量线程归档（`/settings/archived`）按项目决策予以保留**。
3. **内生单文件记忆中枢与物理防泄密**：记忆引擎固定为 `~/.prismux/data/memory.db`（SQLite WAL + FTS5 + `sqlite-vec`），零 PostgreSQL / Qdrant / MinIO / Obsidian 客户端依赖；查询层强制绑定 `_callerScope` 物理隔离。
4. **四大官方插件默认绝不预装**：`qq`、`pet`、`fishdock-hook`、`ssh` 全部作为独立包存放于 `plugins-official/`，主程序与安装包均不含插件包，按需从市场安装。
5. **视觉层对模型 0 Token 开销与强制设计规范**：壁纸、360° Fresnel 液态玻璃、模型识别奔跑小人思考条、字体调色、系统音频律动、桌宠演出与安装引导均不向任何大模型注入工具定义或提示词。

</details>

<details>
<summary><strong>展开查看：M1–M5 与 Preview 1 里程碑矩阵</strong></summary>

| 里程碑 | 核心交付内容 | 验收状态 |
| :--- | :--- | :--- |
| **M1** | Monorepo 骨架、T3 Code 基线接入、`apps/daemon` 进程监督、环境变量净化、主秘书槽位与 `2 MB` 环形 `PersistentPtyPool` | 已完成并通过门禁 |
| **M2** | 单文件 SQLite WAL + FTS5 + `sqlite-vec` 混合记忆、Mnemopi 召回与分域缓存、`forwardIdentity` 隔离、`LifecycleHookBus`、`HandoffEngine` 与 `WorktreeSandbox` | 已完成并通过门禁 |
| **M3** | `cordis-kernel`（`engines.prismux` 校验、`ctx.effect()` 零残留、免 Git 流式安装、声明式 UI）与 `sync-vault`（Argon2id + AEAD、`If-Match`、`60 s` 看门狗、`data/` 便携模式） | 已完成并通过门禁 |
| **M4 / v0.1.0–v0.1.1 Preview 1** | `@prismux/appearance`（含 `dsh-fish` 思考条）+ `@prismux/wallpaper` 外置沉淀、T3 Code MP-01 ~ MP-07 融合（Orca 输入框/侧栏/54px 图标栏、实时遥测条、TTFT/TPS 调用日志、300ms 预测锥、4 组动效设置、零裁切手机模拟器、28 项服务体检与纯官方 ACP） | 已完成并通过 R6 真机签收 |
| **M5** | `OvernightFactory` 夜间全自动工场闭环、四大官方独立插件确定性打包验签（`0.1.1-preview.1`）与双源分卷自动更新体系 | 已完成并通过门禁 |

</details>

<h2 id="thanks"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-thanks-zh-dark.png"><img src="assets/readme/section-thanks-zh-light.png" alt="THANKS · 致谢与边界" width="100%"></picture></h2>

### 工程文档索引

| 文档 | 说明 |
| :--- | :--- |
| [`AGENTS.md`](AGENTS.md) | 跨机器统配入口、五大工程红线、脚本与插件打包契约、环境排障与提交流程 |
| [`docs/t3code-patch-manifest.md`](docs/t3code-patch-manifest.md) | T3 Code MP-01 ~ MP-07 最小入侵挂载与 Provider 扩展点登记台账 |
| [`docs/specs/ui-ux-design-mandate.md`](docs/specs/ui-ux-design-mandate.md) | 世界级 UI/UX、天体三态胶囊、四区液态玻璃同步契约与安装包强制设计规范 |
| [`docs/specs/master-prompt-v1.3.md`](docs/specs/master-prompt-v1.3.md) | Prismux 全栈自主施工总指令书（架构宪法） |
| [`docs/agents/README.md`](docs/agents/README.md) | 贡献者本机环境档案命名规范、模板与维护流程 |
| [`docs/releases/v0.0.1-alpha.1.md`](docs/releases/v0.0.1-alpha.1.md) | 早期原型阶段发行说明归档 |
| [`assets/readme/MAINTAINING.md`](assets/readme/MAINTAINING.md) | README 立体像素头图与分栏横幅渲染、尺寸与图床缓存维护指南 |

### 上游项目与 MIT 开源致谢

- [pingdotgg/t3code](https://github.com/pingdotgg/t3code)（MIT）：提供 Electron 44 + `apps/server` + `apps/web` 运行底座与 Provider 桥接内核。
- [stablyai/orca](https://github.com/stablyai/orca)（MIT）：提供端口扫描与资源监控、24px 状态栏、可拖拽 Activity Bar、Orca 侧栏与单体输入框、`omp` 方言与声明式 UI 状态机等参考对标。
- [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi)（MIT）：提供 Mnemopi Prompt-Cache 召回与分域缓存、`omp acp` `_session/steering` / `_omp/usage` 协议及状态栏 Context / Cache 刻度参考。
- `dsh-better-reasoning-effort-fish`（[HanaAyane/dsh-reasoning-effort](https://github.com/HanaAyane/dsh-reasoning-effort) PR #9 + [HaoyueQin/dsh-better-reasoning-effort](https://github.com/HaoyueQin/dsh-better-reasoning-effort)，MIT）：提供模型自动识别动态思考强度滑条（`<PrismuxReasoningEffortSlider />`、8 大家族主题与 RGBA WebP 奔跑小人）移植源。
- [yetone/magpie](https://github.com/yetone/magpie)：启发口令密封 AEAD 加密同步、`If-Match` 乐观锁、60 秒停滞看门狗与便携模式设计规范。
- [Amp](https://ampcode.com/)：启发 `/handoff` 上下文提纯交接与 `agent / oracle / review` 三档角色拨盘工作流。
- [FISH-Dock](https://github.com/Fish-under-sea/FISH-Dock)：提供 Warm Paper / Dark Olive 立体像素视觉体系、1:1 光学天体胶囊与 360° Fresnel 液态玻璃主题规范及灵动岛审批回执联动灵感。

### 许可边界

Prismux 本仓核心代码与排版工具链遵循 **MIT License**（见仓库根 [`LICENSE`](LICENSE)）；随视觉资产分发的像素字体 `Jersey20-Regular.ttf` 遵循 [SIL Open Font License 1.1](assets/readme/OFL-Jersey20.txt)；基于 `pingdotgg/t3code`（MIT）托管的 `vendor/t3code` 及上述参考移植源码均严格保留各自原始 MIT 许可证与归属声明。
