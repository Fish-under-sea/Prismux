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
  <a href="https://github.com/Fish-under-sea/Prismux/releases/tag/v0.1.0-alpha.3"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/stat-version-zh-dark.png"><img src="assets/readme/stat-version-zh-light.png" alt="VERSION：0.1.0-alpha.3（T3 底座公测 · Win x64 安装包）" width="23%"></picture></a>
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
  <img src="https://img.shields.io/badge/Release-v0.1.0--alpha.2-f08a5d?style=flat-square&amp;labelColor=5a544a" alt="Release v0.1.0-alpha.3">
</p>

<p><strong>Prismux · 极简液态玻璃 AI 超级工作台与 24 小时常驻秘书系统</strong><br>基于真实 T3 Code 本体（Electron 44 + <code>apps/server</code> + <code>apps/web</code>）最小入侵挂载点构建，融合 1:1 FISH-Dock 天体三态胶囊、4K 实播壁纸引擎（非玻璃 / 玻璃双态透底）、内置 Antigravity 本机 <code>agy</code> CLI 复用、单文件隔离 SQLite 记忆、四大按需零预装插件与国内外双源更新器。</p>

<p>
  <a href="#install"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-download-zh-dark.png"><img src="assets/readme/key-download-zh-light.png" alt="下载 / Releases" height="40"></picture></a>
  <a href="https://github.com/Fish-under-sea/Prismux/releases/tag/v0.1.0-alpha.3"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-release-zh-dark.png"><img src="assets/readme/key-release-zh-light.png" alt="更新记录" height="40"></picture></a>
  <a href="https://github.com/Fish-under-sea/Prismux/issues"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-issues-zh-dark.png"><img src="assets/readme/key-issues-zh-light.png" alt="反馈 / Issues" height="40"></picture></a>
</p>

</div>

<h2 id="intro"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-intro-zh-dark.png"><img src="assets/readme/section-intro-zh-light.png" alt="INTRO · 简介" width="100%"></picture></h2>

Prismux 是一个围绕 **「真实 T3 Code 内核 + 外置独立 0-Token 视觉壳 + 按需独立插件」** 构建的 AI 超级工作台与 24 小时无头秘书系统。`v0.1.0-alpha.3` 在真实 **T3 Code 本体二次开发底座**（Electron 44 原生桌面端 + `apps/server` + `apps/web`，全部挂载点与 Provider 扩展点严格登记于 [`docs/t3code-patch-manifest.md`](docs/t3code-patch-manifest.md)）基础上，全面落地四大公测反馈修复与引导体验打磨：

- **纳入并品牌化 `/welcome` 入门引导**：桌面全新冷启动恢复进入 Prismux 定制 `/welcome` 引导页（Ciallo Logo + 离线零云端阻塞），老用户可在「通用 / 关于」设置随时一键重温。
- **彻底根治桌面壁纸实播与双态透底**：修复历史 99% 黑幕、冷启动 Daemon 竞态与内联背景遮挡，Steam `431960` 4K 视频、本地图片/视频及 WebWallGL 在深色、浅色与液态玻璃三态下均可稳定实播且遮挡即时挂起至 0 FPS。
- **外观与壁纸彻底去重 + 全量简中汉化**：`/settings/appearance` 统一收纳 6 张外观卡，`/settings/wallpaper` 与右侧壁纸边栏专注壁纸与播放；补齐 Prismux 设置分组、搜索与新增提示的 10 语言及简体中文翻译。
- **内置 Antigravity 100% 纯官方 ACP 零封控风险接入**：直接以纯 `agy acp` 复用本机官方 CLI 登录态并诚实声明 `prismux` 客户端身份，**彻底移除本地 OAuth Token / Keyring 窃读、`cloudcode-pa` `v1internal` 直连、伪装 UA 与旧版 `"zed"` 伪装**；透传官方 `_meta.antigravity.tier` 订阅等级（如 `Google AI Ultra`）与全模型 `thought_level` 思考强度同步（配额与 AI Credits 余额引导使用官方 `agy` 终端 `/usage`、`/credits` 查询）。
- **四大官方插件默认绝不预装**：`qq`、`pet`、`fishdock-hook`、`ssh` 独立发布为 `.wb-plugin` 与无脚本 npm 包，零重型外部依赖（记忆、配置与加密凭据收敛于 `~/.prismux/`）。

当前公测版本为 **`v0.1.0-alpha.3`**，提供 Windows x64 安装包 `Prismux-Setup-0.1.0-alpha.3-win-x64.exe`（GitHub Releases 与 Gitee Releases 双源发布）。

<h2 id="preview"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-preview-zh-dark.png"><img src="assets/readme/section-preview-zh-light.png" alt="PREVIEW · 界面实景" width="100%"></picture></h2>

> 以下均为 **Prismux `v0.1.0-alpha.3` Electron 44 真实桌面二进制（`1440×900`）** 实机运行高清截图，覆盖 R2 复验全场景：

<table>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="assets/readme/preview-workbench-wallpaper.png" width="100%" alt="Prismux 4K 动态视频壁纸非玻璃暗色实播与右侧极简双栏壁纸边栏">
      <br>
      <sub><strong>4K 视频壁纸实播（暗色模式）+ 右侧极简双页签边栏</strong>：Steam <code>431960</code> 4K H.264 视频壁纸通过 <code>206</code> 流在暗色工作台清晰透出，右侧边栏去重收敛为纯净 <code>壁纸 / 播放</code> 双页签并直达外观与壁纸设置。</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="assets/readme/preview-workbench-glass.png" width="100%" alt="Prismux 液态玻璃模式与 4K 动态视频壁纸毛玻璃透底">
      <br>
      <sub><strong>液态玻璃模式 + 4K 动态视频壁纸</strong>：完整毛玻璃模糊、360° Fresnel 描边与无缝一体左栏在动态视频之上同步呈现，保证卡片、对话框与文字对比度 ≥ 4.5:1。</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="assets/readme/preview-celestial-appearance.png" width="100%" alt="Prismux 全简中设置栏、1:1 FISH-Dock 天体胶囊与统一六卡外观设置页">
      <br>
      <sub><strong>全简中设置导航 + 统一 6 卡外观中心</strong>：左侧设置栏 <code>Prismux</code> 分区（<code>壁纸引擎 / 插件中心 / 记忆与同步 / 软件更新</code>）完整简中显示；顶部嵌入 1:1 FISH-Dock 天体三态胶囊与全套外观卡，零模型 <strong>0 Token</strong>。</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="assets/readme/preview-onboarding-welcome.png" width="100%" alt="Prismux Welcome to Prismux 入门引导页">
      <br>
      <sub><strong><code>Welcome to Prismux</code> 桌面入门引导</strong>：恢复首次启动引导并接入 Ciallo Logo，自动探测本机 Claude / Codex 就绪态与历史项目导入，离线隐藏云端登录项、无白闪顺畅进入工作台。</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="assets/readme/preview-antigravity-local-cli.png" width="100%" alt="Prismux 内置 Antigravity 一键复用本机 agy CLI">
      <br>
      <sub><strong>内置 Antigravity 一键复用本机 <code>agy</code> CLI</strong>：向导内提供「使用本机 agy CLI」一键入口，直接走官方 <code>agy acp</code> 通道复用登录态并保留谷歌彩色图标、官方订阅等级与全模型 <code>thought_level</code> 同步。</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="assets/readme/preview-dual-updater.png" width="100%" alt="Prismux v0.1.0-alpha.3 国内外双源更新中心">
      <br>
      <sub><strong><code>v0.1.0-alpha.3</code> 国内外双源更新中心</strong>：实时连线 Daemon 与 Electron <code>AppUpdater</code>，显示运行版本与便携模式标识，支持智能测速 / 国内镜像（<code>Gitee + npmmirror</code>）/ 国际直连（<code>GitHub + npmjs</code>）秒切。</sub>
    </td>
  </tr>
</table>

<h2 id="features"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-features-zh-dark.png"><img src="assets/readme/section-features-zh-light.png" alt="FEATURES · 核心能力" width="100%"></picture></h2>

<table>
  <tr>
    <td width="50%" valign="top">
      <strong>1. T3 Code 挂载底座、本机 <code>agy</code> CLI 与 24h 守护</strong>
      <p>Electron 44 桌面端（<code>PrismuxDaemonService</code>）随应用生命周期监督托管 <code>@prismux/daemon</code>（仅对守护子进程注入 <code>ELECTRON_RUN_AS_NODE=1</code>），首启进入 Prismux 品牌化 <code>/welcome</code> 引导后常驻工作台，顶栏热切 Claude / Codex / Antigravity / OpenCode 担任 <code>Chief Thread Slot</code> 主秘书。</p>
      <p>内置 Antigravity 支持 <code>local-cli</code> 纯官方 <code>agy acp</code> 模式免隔离复用本机登录态，零 Token 窃读与零 <code>v1internal</code> 旁路，透传官方订阅等级与全模型 <code>thought_level</code> 且切模型即时刷新。</p>
    </td>
    <td width="50%" valign="top">
      <strong>2. 五大标杆内化原语（严禁 5 项冗余面板）</strong>
      <p>彻底砍掉 Task Board、AgentTeam、Skill Lens、Visual Companion 与 Session Archive，统一凝练为五大高精度原语：</p>
      <ul>
        <li><code>PersistentPtyPool</code>：每终端 <code>2 MB</code> 环形缓冲与断线无损回放</li>
        <li><code>HandoffEngine</code>：<code>/handoff</code> 提纯续跑与 <code>agent / oracle / review</code> 三档拨盘</li>
        <li><code>CollectorAndGuard</code>：多格式切片 + 传输层身份注入与 <code>60 s</code> 熔断</li>
        <li><code>LifecycleHookBus</code>：6 类钩子、退出码 <code>2</code> 拦截与默认 <code>onFailure: "block"</code></li>
        <li><code>WorktreeSandbox</code>：OS 级写隔离与域名白名单本地 HTTP 代理网关</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>3. 单文件 SQLite 隔离记忆与 <code>OvernightFactory</code></strong>
      <p>全部记忆存储于单文件 <code>~/.prismux/data/memory.db</code>（SQLite WAL + FTS5 中文分词 + <code>sqlite-vec</code> 混合 RRF 检索），支持 <code>POST /v1/memory/import-obsidian</code> 迁移历史笔记。<code>forwardIdentity</code> 在传输层硬性覆写 <code>_callerScope</code>，<code>qq_group:&lt;gid&gt;</code> 绝不可读取 <code>private/chief</code> 或 <code>workspace/*</code>。</p>
      <p><code>OvernightFactory</code> 打通 Gmail OAuth2 / IMAP <code>#factory</code> 入站 → 记忆立项 → Worktree 沙箱编码提交 → Oracle 只读 <code>review</code> → 带 Diff 与 <code>prismux://review/&lt;threadId&gt;</code> 深链的 HTML 完工早报。</p>
    </td>
    <td width="50%" valign="top">
      <strong>4. 1:1 天体胶囊、双态壁纸透底与 0-FPS 挂起</strong>
      <p><code>@prismux/appearance</code> 1:1 复刻 FISH-Dock 11 层光学天体胶囊与 244px 浮窗调色盘，<code>/settings/appearance</code> 统合全部 6 张外观卡（天体胶囊、四区与各面玻璃微调、侧栏圆角、UI 配色、系统字体、<code>.wb-theme</code> 快照），保持对模型 <strong>0 Token 开销</strong>。</p>
      <p><code>@prismux/wallpaper</code> + Daemon HTTP <code>206</code> 媒体网关支持 Steam <code>431960</code> 4K 视频、本地导入（最高 512 MB）与 4 套 WebWallGL 在深/浅非玻璃态与液态玻璃态下均清晰可播，遮挡瞬间降至 <strong>0 FPS</strong>。</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>5. Cordis 双域插件内核与 Magpie 加密同步</strong>
      <p><code>@prismux/cordis-kernel</code> 强制校验顶层 <code>engines.prismux</code> SemVer，以 <code>ctx.effect()</code> 实现停用与卸载零残留回滚，每个插件独享 <code>0600</code> 加密凭据文件与 <code>distribution: "managed"</code> 单写锁，社区 npm 导入免 Git 禁生命周期脚本并支持 <code>modelVisible: true</code> 二次权限审计。</p>
      <p><code>@prismux/sync-vault</code> 使用 Argon2id + AEAD 密封 <code>.prismux-backup</code> 载荷，支持 WebDAV / S3（<code>path-style</code>） / GitHub 独立开关、<code>If-Match</code> 乐观锁、<code>60 s</code> 停滞看门狗与便携 <code>data/</code> 模式。</p>
    </td>
    <td width="50%" valign="top">
      <strong>6. 国内外双网络自动切换更新与全量简体中文</strong>
      <p><code>AppUpdater</code> 联动 Electron 原生 <code>setUpdateFeedUrl</code> 与设置中心更新页，共同支持「智能测速自动选优 / 国内镜像优先 / 国际直连优先」三态策略，在 <strong>GitHub ↔ Gitee</strong> 与 <strong>npm ↔ npmmirror</strong> 间容灾并强制校验 64 位 <code>.sha256</code>。</p>
      <p>全面接入 <code>gt-react</code> 10 语言词典并校准简体中文（<code>zh.json</code>）设置侧栏、面包屑、搜索权重与 Provider / 引导文案。</p>
    </td>
  </tr>
</table>

<h2 id="plugins"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-plugins-zh-dark.png"><img src="assets/readme/section-plugins-zh-light.png" alt="PLUGINS · 官方独立插件" width="100%"></picture></h2>

> [!NOTE]
> **四大官方插件默认绝不预装**：`Prismux-Setup-0.1.0-alpha.3-win-x64.exe` 安装包及解压态 `win-unpacked/` 均**绝不包含** `plugins-official/` 任何插件目录（打包后通过递归扫描 0 命中校验）。以下 4 个官方插件均以独立 `.wb-plugin` 归档（GitHub / Gitee Releases）及无脚本 npm 单包形式分发，按需安装并支持 `ctx.effect()` 零残留卸载。

| 插件 ID | 独立归档包（`.wb-plugin`） | npm 包名（无作用域 / GitHub Packages） | 运行域（`realms`） | 核心能力与隔离边界 |
| :--- | :--- | :--- | :--- | :--- |
| `qq` | `qq-0.1.0-alpha.3.wb-plugin` | `prismux-plugin-qq`<br><code>@fish-under-sea/prismux-plugin-qq</code> | `daemon`、`ui` | OneBot v11 正/反向 WebSocket 自动探测（NapCatQQ / Lagrange.Core）；私聊主人接入主秘书，群聊启用防刷屏节奏器并硬隔离至 <code>social/qq-group-&lt;gid&gt;</code> |
| `pet` | `pet-0.1.0-alpha.3.wb-plugin` | `prismux-plugin-pet`<br><code>@fish-under-sea/prismux-plugin-pet</code> | `ui`、`daemon` | 桌宠联动插件；实现定向实例绑定、带过期校验的 Lease Token 租约锁、只读播放进度订阅与动作/气泡分阶段交还 |
| `fishdock-hook` | `fishdock-hook-0.1.0-alpha.3.wb-plugin` | `prismux-plugin-fishdock-hook`<br><code>@fish-under-sea/prismux-plugin-fishdock-hook</code> | `daemon` | FISH-Dock 灵动岛桥接插件；将 `PreToolUse` 中文风险审批、重要邮件与夜间工场完工回执推送至灵动岛卡片并支持快捷放行/驳回 |
| `ssh` | `ssh-0.1.0-alpha.3.wb-plugin` | `prismux-plugin-ssh`<br><code>@fish-under-sea/prismux-plugin-ssh</code> | `daemon`、`ui` | 按需选装的远程运维插件；提供隔离 SSH 主机池、Web PTY 会话桥接、路径安全校验与 SFTP 文件浏览 |

<h2 id="install"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-install-zh-dark.png"><img src="assets/readme/section-install-zh-light.png" alt="INSTALL · 下载与双源更新" width="100%"></picture></h2>

### 双网络发行入口（GitHub Releases ↔ Gitee Releases）

| 分发渠道 | 适用场景 | 入口 / 下载说明 |
| :--- | :--- | :--- |
| **GitHub Releases**（国际直连） | 海外网络 / GitHub CLI 环境 | [Release 页面（`v0.1.0-alpha.3`）](https://github.com/Fish-under-sea/Prismux/releases/tag/v0.1.0-alpha.3) · [直下 `Prismux-Setup-0.1.0-alpha.3-win-x64.exe`](https://github.com/Fish-under-sea/Prismux/releases/download/v0.1.0-alpha.3/Prismux-Setup-0.1.0-alpha.3-win-x64.exe) |
| **Gitee Releases**（国内镜像） | 中国大陆直连加速下载 | [Release 页面（`v0.1.0-alpha.3`）](https://gitee.com/Fish-under-sea/Prismux/releases/tag/v0.1.0-alpha.3)（提供完整小文件资产与 80 MB 7z 无损分卷 `.7z.001..003` 一键解压安装） |
| **软件内更新中心**（推荐） | 自动并发测速 GitHub / Gitee、断点续传与强制 `.sha256` 校验 | 在工作台打开设置 → **软件更新**（`/settings/updates`），可在 `智能测速 / 国内优先 / 国际优先` 间秒切 |

### 安装包与完整性校验（Windows x64）

| 发行资产 | 文件名 | 说明与隔离策略 |
| :--- | :--- | :--- |
| **Windows 安装包（Electron 44 NSIS）** | `Prismux-Setup-0.1.0-alpha.3-win-x64.exe` | 内含完整 T3 Code Electron 44 桌面端、Bundled `resources/prismux-daemon/` 与 `t3-resource-monitor.exe`；支持自定义 `/D=<目录>`；状态目录独立隔离于 `~/.prismux/`（亦支持便携 `data/` 模式）；**四大官方插件默认零预装** |
| **4 个官方独立插件包** | `*-0.1.0-alpha.3.wb-plugin` | 含 `qq`、`pet`、`fishdock-hook`、`ssh` 四枚确定性 ustar + gzip 归档与 `official.json`，安装后在 `/settings/plugins`（插件中心）按需导入 |
| **安全校验清单** | `SHA256SUMS.txt` 与各资产同名 `.sha256` | 手动下载后可通过 `Get-FileHash Prismux-Setup-0.1.0-alpha.3-win-x64.exe -Algorithm SHA256` 或 `7z t` 核对完整性 |

<h2 id="packages"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-packages-zh-dark.png"><img src="assets/readme/section-packages-zh-light.png" alt="PACKAGES · npm 与国内镜像" width="100%"></picture></h2>

每个官方独立插件均额外发布为**零 `preinstall / install / postinstall` 脚本**的单包归档，内部携带已校验的 `<id>-0.1.0-alpha.3.wb-plugin` 与防覆盖导出 CLI（`prismux-plugin-<id>`）；软件内插件市场同样支持在 **`registry.npmjs.org` ↔ `registry.npmmirror.com`** 间免本机 Git 纯流式拉取与自动故障回退。

```powershell
# 1. 从 npm 官方源安装并提取 .wb-plugin 归档（含 SHA-256 核对，目标同名文件存在时不覆盖）
npm install prismux-plugin-qq@0.1.0-alpha.3
npx prismux-plugin-qq --out ./plugins-stage

# 2. 中国大陆网络使用 npmmirror 国内镜像加速安装
npm install prismux-plugin-qq@0.1.0-alpha.3 --registry=https://registry.npmmirror.com
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

# 5. 一键串联主仓构建 + T3 底座构建 + Windows NSIS 安装包打包（含 7z 校验与 .sha256）
pnpm desktop:build
pnpm desktop:installer

# 6. 为指定官方插件生成确定性 .wb-plugin 与 .sha256（内置 gunzip 回环校验）
pnpm plugin:pack -- --plugin plugins-official/plugin-qq
```

<details>
<summary><strong>展开查看：Monorepo 目录树与 T3 Code 最小入侵边界</strong></summary>

```text
prismux/
├── AGENTS.md                            # 跨机器统配入口、工程红线与验收门禁
├── LICENSE                              # 标准 MIT 开源许可证
├── README.md / README.en.md             # 中英双语项目主页
├── UPSTREAM_LOCK.json                   # pingdotgg/t3code 基线 SHA、managed-fork 模式与台账指针
├── pnpm-workspace.yaml                  # 12 个 TS 工作区包白名单（排除 vendor/t3code 与 desktop-tauri）
├── package.json                         # 根任务编排脚本（v0.1.0-alpha.3）
├── tsconfig.base.json                   # TypeScript 5.8+ 严格共享基线（ES2024 + NodeNext）
├── assets/
│   ├── logo.png                         # 透明 1024×1024 吉祥物主图标
│   └── readme/                          # 立体像素头图、分栏横幅、R2 实机截图与渲染模板
├── docs/
│   ├── t3code-patch-manifest.md         # T3 Code MP-01 ~ MP-07 最小入侵挂载与扩展点权威台账
│   ├── agents/                          # 按人存放的本机环境档案说明、模板与个人档案
│   ├── releases/v0.0.1-alpha.1.md       # 早期公开内测版本归档说明
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
│   ├── cordis-kernel/                   # @prismux/cordis-kernel：双域插件内核、SemVer、双源流式安装器与 0600 凭据
│   ├── memory-core/                     # @prismux/memory-core：SQLite WAL + FTS5 + sqlite-vec 与物理防泄密
│   ├── sync-vault/                      # @prismux/sync-vault：Argon2id + AEAD 同步、乐观锁与 60 s 看门狗
│   ├── prismux-appearance/              # @prismux/appearance：1:1 FISH-Dock 光学天体胶囊、调色盘、6 卡集成与 T3 玻璃桥
│   └── prismux-wallpaper/               # @prismux/wallpaper：双页签边栏、4 页签设置、Z-0 舞台与 Steam 431960 扫描
├── apps/                                # 核心守护进程（含待退役原型壳与历史壳）
│   ├── daemon/                          # @prismux/daemon：24h 无头守护、主秘书槽位、五大原语、206 媒体网关与夜间工场
│   ├── workbench-ui/                    # @prismux/workbench-ui：[待退役原型壳] v0.0.1 原型界面，已由真实 T3 Code 底座接替
│   └── desktop-tauri/                   # prismux-desktop：[历史原生壳] v0.1.0 主桌面端已切换为 T3 Code Electron 44
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
2. **严禁混入已砍掉的 5 项冗余模块**：不包含 Task Board、AgentTeam、Skill Lens、Visual Companion 与 Session Archive，统一由五大内化原语替代。
3. **内生单文件记忆中枢与物理防泄密**：记忆引擎固定为 `~/.prismux/data/memory.db`（SQLite WAL + FTS5 + `sqlite-vec`），零 PostgreSQL / Qdrant / MinIO / Obsidian 客户端依赖；查询层强制绑定 `_callerScope` 物理隔离。
4. **四大官方插件默认绝不预装**：`qq`、`pet`、`fishdock-hook`、`ssh` 全部作为独立包存放于 `plugins-official/`，主程序与安装包均不含插件包，按需从市场安装。
5. **视觉层对模型 0 Token 开销与强制设计规范**：壁纸、360° Fresnel 液态玻璃、字体调色、系统音频律动、桌宠演出与安装引导均不向任何大模型注入工具定义或提示词。

</details>

<details>
<summary><strong>展开查看：M1–M5 与 v0.1.0 融合里程碑矩阵</strong></summary>

| 里程碑 | 核心交付内容 | 验收状态 |
| :--- | :--- | :--- |
| **M1** | Monorepo 骨架、T3 Code 基线接入、`apps/daemon` 进程监督、环境变量净化、主秘书槽位与 `2 MB` 环形 `PersistentPtyPool` | 已完成并通过门禁 |
| **M2** | 单文件 SQLite WAL + FTS5 + `sqlite-vec` 混合记忆、Obsidian 导入接口、`forwardIdentity` 越权隔离、`LifecycleHookBus`（`onFailure: "block"`）、`HandoffEngine`（三档拨盘）与 `WorktreeSandbox` | 已完成并通过门禁 |
| **M3** | `cordis-kernel`（顶层 `engines.prismux` 校验、`ctx.effect()` 卸载零残留、免 Git 无脚本流式安装与 `managed` 锁）与 `sync-vault`（Argon2id + AEAD、`If-Match`、`60 s` 看门狗与 `data/` 便携模式） | 已完成并通过门禁 |
| **M4 / v0.1.0** | `@prismux/appearance` + `@prismux/wallpaper` 外置沉淀、T3 Code Electron 44 MP-01 ~ MP-07 融合（壁纸双态透底、外观/壁纸去重、10 语言汉化、`/welcome` 引导、本机 `agy` CLI 与全模型 `thought_level`），R2 真机全量审图通过 | 已完成并通过 R2 真机签收 |
| **M5** | `OvernightFactory` 夜间全自动工场闭环、四大官方独立插件打包验签（`0.1.0-alpha.3`）与双网络自动切换更新体系 | 已完成并通过门禁 |

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
| [`docs/releases/v0.0.1-alpha.1.md`](docs/releases/v0.0.1-alpha.1.md) | 早期 `v0.0.1-alpha.1` 原型阶段发行说明归档 |
| [`assets/readme/MAINTAINING.md`](assets/readme/MAINTAINING.md) | README 立体像素头图与分栏横幅渲染、尺寸与图床缓存维护指南 |

### 上游项目与灵感致谢

- [pingdotgg/t3code](https://github.com/pingdotgg/t3code)：提供 Electron 44 + `apps/server` + `apps/web` 运行底座与 Provider 桥接内核。
- [yetone/magpie](https://github.com/yetone/magpie)：提供口令密封 AEAD 加密同步、`If-Match` 乐观锁、60 秒停滞看门狗与便携模式设计规范。
- [stablyai/orca](https://github.com/stablyai/orca)：启发服务端持久化 PTY 环形缓冲与 Worktree 状态树管理原语。
- [Amp](https://ampcode.com/)：启发 `/handoff` 上下文提纯交接与 `agent / oracle / review` 三档角色拨盘工作流。
- [FISH-Dock](https://github.com/Fish-under-sea/FISH-Dock)：提供 Warm Paper / Dark Olive 立体像素视觉体系、1:1 光学天体胶囊与 360° Fresnel 液态玻璃主题规范及灵动岛审批回执联动灵感。

### 许可边界

Prismux 本仓核心代码与排版工具链遵循 **MIT License**（见仓库根 [`LICENSE`](LICENSE)）；随视觉资产分发的像素字体 `Jersey20-Regular.ttf` 遵循 [SIL Open Font License 1.1](assets/readme/OFL-Jersey20.txt)；基于 `pingdotgg/t3code`（MIT）托管的 `vendor/t3code` 保留其原始许可证与归属声明。
