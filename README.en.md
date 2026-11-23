<div align="center">

<p>
  <a href="README.md"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-zh-en-dark.png"><img src="assets/readme/key-zh-en-light.png" alt="中文" height="40"></picture></a>
  <a href="README.en.md"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-en-en-dark.png"><img src="assets/readme/key-en-en-light.png" alt="English" height="40"></picture></a>
  <a href="#install"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-start-en-dark.png"><img src="assets/readme/key-start-en-light.png" alt="Quick Start" height="40"></picture></a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme/hero-en-dark.png">
  <img src="assets/readme/hero-en-light.png" alt="Prismux — Minimalist Liquid-Glass AI Super Workbench &amp; 24/7 Secretary" width="1448">
</picture>

<p>
  <a href="https://github.com/Fish-under-sea/Prismux/releases/tag/v0.1.2-preview.1"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/stat-version-en-dark.png"><img src="assets/readme/stat-version-en-light.png" alt="VERSION: 0.1.2-preview.1 (Preview 1 · T3 Base · Win x64)" width="23%"></picture></a>
  <a href="#preview"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/stat-visual-en-dark.png"><img src="assets/readme/stat-visual-en-light.png" alt="VISUAL: 0 TOKEN (360° Fresnel Glass)" width="23%"></picture></a>
  <a href="#features"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/stat-memory-en-dark.png"><img src="assets/readme/stat-memory-en-light.png" alt="MEMORY: SQLITE VEC (Single-File Isolation)" width="23%"></picture></a>
  <a href="#plugins"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/stat-plugins-en-dark.png"><img src="assets/readme/stat-plugins-en-light.png" alt="PLUGINS: 4 PLUGINS (Zero Preinstall)" width="23%"></picture></a>
</p>

<p>
  <img src="https://img.shields.io/badge/Node.js-%3E%3D24.12-8fd6a0?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white&amp;labelColor=5a544a" alt="Node.js >= 24.12">
  <img src="https://img.shields.io/badge/pnpm-12-8fd6a0?style=flat-square&amp;logo=pnpm&amp;logoColor=white&amp;labelColor=5a544a" alt="pnpm 12">
  <img src="https://img.shields.io/badge/TypeScript-5.8-8fd6a0?style=flat-square&amp;logo=typescript&amp;logoColor=white&amp;labelColor=5a544a" alt="TypeScript 5.8">
  <img src="https://img.shields.io/badge/Electron-44-8fd6a0?style=flat-square&amp;logo=electron&amp;logoColor=white&amp;labelColor=5a544a" alt="Electron 44">
  <img src="https://img.shields.io/badge/License-MIT-8fd6a0?style=flat-square&amp;labelColor=5a544a" alt="License MIT">
  <img src="https://img.shields.io/badge/Release-v0.1.2--preview.1-f08a5d?style=flat-square&amp;labelColor=5a544a" alt="Release v0.1.2-preview.1">
</p>

<p><strong>Prismux · Minimalist Liquid-Glass AI Super Workbench &amp; 24/7 Secretary</strong><br>Built on a minimal-invasion T3 Code runtime (Electron 44 + <code>apps/server</code> + <code>apps/web</code>), uniting a single-layer SVG-masked glass frame with 5-zone live glass studio, single-row topbar with Orca multi-tab recursive splits, Workspace Board &amp; Tasks views, AGY 2.0 welcome hero &amp; dual-layer sleek composer with animated model-aware reasoning slider (0-Token), AGY Overview panel, 20px live-process &amp; Keep Awake status bar, system tray, Chief identity + Obsidian Agent curation, closed-loop auto-update alerts, and dual-route split updates.</p>

<p>
  <a href="#install"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-download-en-dark.png"><img src="assets/readme/key-download-en-light.png" alt="Downloads" height="40"></picture></a>
  <a href="https://github.com/Fish-under-sea/Prismux/releases/tag/v0.1.2-preview.1"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-release-en-dark.png"><img src="assets/readme/key-release-en-light.png" alt="Changelog" height="40"></picture></a>
  <a href="https://github.com/Fish-under-sea/Prismux/issues"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-issues-en-dark.png"><img src="assets/readme/key-issues-en-light.png" alt="Issues" height="40"></picture></a>
</p>

</div>

<h2 id="intro"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-intro-en-dark.png"><img src="assets/readme/section-intro-en-light.png" alt="INTRO · Overview" width="100%"></picture></h2>

Prismux is an AI Super Workbench and 24/7 headless secretary built around **a real T3 Code core, an isolated 0-Token visual layer, and strictly on-demand plugins**. **Prismux v0.1.2 Preview 1** (`v0.1.2-preview.1`) runs on a managed **T3 Code fork** (Electron 44 + `apps/server` + `apps/web` tracked in [`docs/t3code-patch-manifest.md`](docs/t3code-patch-manifest.md) with zero edits to `vendor/t3code/pnpm-lock.yaml`) and delivers comprehensive architectural refinement and flagship visual upgrades:

- **Single-Layer SVG-Masked Glass Frame, 5-Zone Studio & 0-Token BootSplash**: `@prismux/appearance` introduces a continuous SVG `<mask>` inner-stage cutout (eliminating corner tint seams and subpixel cracks), 5 independent liquid-glass zones with an in-place right-sidebar studio (`0.00px`-aligned Celestial tri-state capsule and single-layer rounded overlays), plus a pure CSS/SVG rainbow-sweep + 6-face 3D rotating Prismux cube startup splash at **0 LLM tokens**.
- **Single-Row Unified Topbar, Orca Multi-Tab Splits, Workspace Board & Tasks**: Eliminates redundant secondary topbars by folding the breathing vendor-logo Chief pill and Overview toggle directly into `WorkspaceTabBar`, supporting 2–3 pane recursive splits and inline right-sidebar `+` agent sessions; the 280px Orca left sidebar orders 5 quick-nav routes (`Diagnostics → Tasks → Workspace Board → Automations → Prismux Mobile`), adds a 54px collapsed frosted hover-peek drawer, 1:1 Orca projects header, `Ctrl+N` Create Workspace glass dialog, lightweight **Workspace Board (`/workspace-board`)**, and **Tasks (`/tasks`)**.
- **AGY 2.0 Welcome Hero, Dual-Layer Glass Composer & Agent-Scoped Model Picker**: Time-aware bilingual greeting with dynamic translucent vendor watermark (plus 5-click Easter egg) and symmetric drag-to-resize chat width rails; dual-layer sleek composer pairs a top workspace/branch/host tray with 4-tier Permission Shield and narrow-width zero-overlap live `TPS`/cache telemetry; left-edge-aligned (`<= 1px`) scoped model picker preserves the **`dsh-better-reasoning-effort-fish`** animated pixel-runner effort slider and Codex/Claude **`⚡ Fast`** toggle.
- **AGY Overview Panel, 20px Refined Status Bar, Live Process Attribution & System Tray**: Right-hand *Overview* consolidates *Review*, *Files*, *Continue in Terminal*, 8 structured sections, and lightweight Side Questions; the bottom status bar trims to `20px` with real 7-day usage, native Electron `powerSaveBlocker` ☕ Keep Awake (`On / Agent / Off`), deduped `Ports`, and hybrid Electron + Daemon live process `CPU / RAM` attribution; adds a Windows System Tray displaying active agent count and a `Connect to Mobile >` submenu.
- **Custom Chief Identity, Root `AGENTS.md` & Obsidian Agent Curation**: Supports custom `secretaryName`, `@chief` mention detection, live editing of `~/.prismux/chief/AGENTS.md`, and Chief-curated Obsidian Vault import, while renaming the sync engine to **Prismux End-to-End Encrypted Sync**; Settings removes horizontal dividers, splits *Appearance* and *Wallpaper*, and adds persistent provider deletion (preventing built-in resurrection on reload).
- **Closed-Loop Auto-Update Alerts, Dual-Route Split Updates, Pure ACP & Zero Preinstall Plugins**: Silent startup update checks surface a bottom-right liquid-glass card, centered release-notes modal, and FLIP-animated sidebar capsule backed by concurrent GitHub ↔ Gitee probing (with HTML fallback on OpenAPI 403 and bundled `7za.exe` `.7z.001..003` reassembly + SHA-256 verification); completes visible brand purification while keeping 100% pure official `agy acp` / `omp acp` and zero preinstalled official plugins.

The current release is **`Prismux v0.1.2 Preview 1`** (`v0.1.2-preview.1`), shipping `Prismux-Setup-0.1.2-preview.1-win-x64.exe` on GitHub Releases and Gitee Releases (with reserved placeholders for macOS and Linux builds).

<h2 id="preview"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-preview-en-dark.png"><img src="assets/readme/section-preview-en-light.png" alt="PREVIEW · Visual Preview" width="100%"></picture></h2>

> All screenshots below were captured directly from the live **Prismux Electron 44 Windows GPU-composited desktop window**—no mockups:

<table>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="assets/readme/01-workbench-split-agy-v2.png" width="100%" alt="Prismux Orca multi-tab horizontal split view, 280px liquid-glass sidebar, AGY 2.0 welcome hero, and dual-layer glass composer">
      <br>
      <sub><strong>Orca Multi-Tab Split View + AGY 2.0 Dual-Layer Composer + Breathing Chief Pill</strong>: 280px Orca left sidebar with <code>[Logo+Prismux Menu]</code> &amp; split footer; <code>14px</code> inner-stage corners, recursive split panes, time-aware greeting with dynamic agent watermark, sleek dual-layer glass composer with zero-overlap narrow telemetry wrapping, and breathing vendor-logo Chief pill.</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="assets/readme/02-wallpaper-inline-zoned-glass-v2.png" width="100%" alt="Prismux right wallpaper sidebar frosted liquid glass and in-place 6-zone appearance studio">
      <br>
      <sub><strong>Frosted Wallpaper Sidebar + In-Place 6-Zone Glass Studio</strong>: True frosted translucency over the live wallpaper without opaque dead fill; clicking <em>Appearance &amp; Glass</em> switches in-place without leaving the workspace, pairing the <code>0.00px</code>-aligned Celestial capsule with 6 independent glass zones (left/right sidebars, main canvas, composer, chrome bars, overlays).</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="assets/readme/03-scoped-model-picker-dsh-fish-v2.png" width="100%" alt="Prismux scoped per-agent model picker with dsh-fish animated reasoning slider and AGY session overview panel">
      <br>
      <sub><strong>Scoped Model Picker + <code>dsh-fish</code> Runner Slider + AGY Overview Panel</strong>: Agent-scoped model popover with instant search, refined two-line cards, and the model-aware animated reasoning effort slider (<strong>0 LLM tokens</strong>); right-hand <em>Overview</em> consolidates <em>Review</em>, <em>Files</em>, <em>Continue in Terminal</em>, and 8 structured sections including lightweight Side Questions.</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="assets/readme/04-settings-zoned-glass-capsule-v2.png" width="100%" alt="Prismux 4-group settings sidebar, 0.00px aligned celestial theme capsule, and 6-zone glass configurator">
      <br>
      <sub><strong>4-Group Settings Sidebar + <code>0.00px</code> Aligned Celestial Capsule + 6-Zone Controls</strong>: 4 cleanly partitioned settings groups (preserving <code>Archived</code>) with damped pill motion; unified <em>Appearance &amp; Wallpaper</em> removes redundant corner sliders in favor of default inner-stage rounding, synced live with the right-sidebar 6-zone glass studio at ≥ 4.5:1 contrast.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="assets/readme/05-orca-workspace-dialog-v2.png" width="100%" alt="Prismux 1:1 Orca projects sidebar header and Ctrl+N Create Workspace liquid glass dialog">
      <br>
      <sub><strong>1:1 Orca Projects Header &amp; <code>Ctrl+N</code> Create Workspace Glass Dialog</strong>: Faithful Orca sidebar workflow with hover-reveal <code>↕ Ctrl+Shift+H</code> expand/collapse, inline <code>🔔</code> agent activity view, <code>🎛</code> filter/view menu, <code>📁+</code> add-project menu, and the liquid-glass <em>Create Workspace</em> modal (project, host, emoji naming, agent picker, and <em>Create more</em>).</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="assets/readme/06-statusbar-resources-keepawake-v2.png" width="100%" alt="Prismux 24px status bar live system and PTY process attribution popover with usage and Keep Awake">
      <br>
      <sub><strong>24px Status Bar Live Process Attribution, Real Usage &amp; ☕ Keep Awake</strong>: Streamlined bottom bar displaying real daily token usage, native Electron <code>powerSaveBlocker</code> ☕ Keep Awake (<code>On / Agent / Off</code>), active ports, and hybrid Electron + Daemon 12-process CPU/RAM attribution inside crisp single-layer rounded glass popovers with zero corner bleed.</sub>
    </td>
  </tr>
</table>

<h2 id="features"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-features-en-dark.png"><img src="assets/readme/section-features-en-light.png" alt="FEATURES · Core Capabilities" width="100%"></picture></h2>

<table>
  <tr>
    <td width="50%" valign="top">
      <strong>1. T3 Code Base, <code>omp acp</code> &amp; Pure Official <code>agy acp</code></strong>
      <p>The Electron 44 app (<code>PrismuxDaemonService</code>) supervises <code>@prismux/daemon</code> (scoping <code>ELECTRON_RUN_AS_NODE=1</code> strictly to the child process and injecting live T3 server URLs), launches <code>/welcome</code> on first run, and hot-swaps Claude, Codex, Antigravity, OpenCode, or OMP in the <code>Chief Thread Slot</code>.</p>
      <p>Built-in Antigravity uses strictly official <code>agy acp</code> (<code>local-cli</code>—zero token/keyring scraping or <code>v1internal</code> calls), while the first-class <code>omp acp</code> dialect supports <code>_session/steering</code>, pure ACP <code>_omp/usage</code>, shell sanitization, and <code>sessionLost</code> recovery.</p>
    </td>
    <td width="50%" valign="top">
      <strong>2. Five Core Primitives (No Redundant Bloat)</strong>
      <p>Permanently excludes heavy session-detached Task Boards, AgentTeam DAG, Skill Lens, Visual Companion, and custom heavy Session Archive backends (while <strong>preserving T3 Code's lightweight <code>/settings/archived</code> and Orca's lightweight Workspace Board / Tasks views</strong>), consolidating onto five primitives:</p>
      <ul>
        <li><code>PersistentPtyPool</code>: <code>2 MB</code> per-terminal ring buffer &amp; lossless reconnect replay</li>
        <li><code>HandoffEngine</code>: <code>/handoff</code> distillation, <code>agent / oracle / review</code> Dial &amp; Orca dynamic fences</li>
        <li><code>CollectorAndGuard</code>: Multi-format slicing, identity injection &amp; <code>60 s</code> breaker</li>
        <li><code>LifecycleHookBus</code>: 6 hook events, exit-code <code>2</code> blocks &amp; <code>onFailure: "block"</code></li>
        <li><code>WorktreeSandbox</code>: OS-level write isolation &amp; domain-allowlisted proxy gateway</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>3. Mnemopi Memory Recall, Chief Identity &amp; Night Factory</strong>
      <p>Memories stay in single-file <code>~/.prismux/data/memory.db</code> (SQLite WAL + FTS5 + <code>sqlite-vec</code>) with <strong>Mnemopi prompt-cache-friendly recall</strong> (<code>&lt;memories&gt;</code>/<code>&lt;memory-delta&gt;</code> XML guarding, two-phase <code>prepare/commit</code>, 4-tier scoped cache), custom Chief naming + persistent <code>~/.prismux/chief/AGENTS.md</code>, and Chief-curated Obsidian Vault import. Transport-level <code>forwardIdentity</code> locks <code>qq_group:&lt;gid&gt;</code> queries away from <code>private/chief</code> and <code>workspace/*</code>.</p>
      <p><code>OvernightFactory</code> automates Gmail OAuth2 / IMAP <code>#factory</code> ingestion → memory Handoff → sandboxed <code>git worktree</code> coding → read-only Oracle <code>review</code> → HTML morning report with diff &amp; <code>prismux://review/&lt;threadId&gt;</code> link.</p>
    </td>
    <td width="50%" valign="top">
      <strong>4. 0-Token Visual Matrix, Single-Layer Glass &amp; Effort Slider</strong>
      <p><code>@prismux/appearance</code> unites the single-layer SVG-masked glass frame, 5-zone live glass studio, 1:1 Celestial capsule, and <code>&lt;PrismuxReasoningEffortSlider /&gt;</code> (ported from <code>dsh-better-reasoning-effort-fish</code> with 8 model families, embedded RGBA WebP runners, and Canvas pixel radiation) alongside <code>@prismux/wallpaper</code> (Steam <code>431960</code> / WebWallGL / <code>0 FPS</code> occlusion pause), 20px status bar, and divider-free settings—at <strong>0 LLM tokens</strong> and ≥ 4.5:1 contrast.</p>
      <p>The 0-Token rainbow-cube BootSplash, 300ms hover aim-cones, 54px hover-peek icon rail, dual-layer composer, and live TTFT/TPS telemetry run purely locally.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>5. Cordis Declarative Plugins &amp; Prismux E2EE Sync</strong>
      <p><code>@prismux/cordis-kernel</code> enforces top-level <code>engines.prismux</code> SemVer, zero-leak <code>ctx.effect()</code> rollback, <code>512 KiB</code>-budget declarative liquid-glass UI (<code>DeclarativeGlassRenderer</code>), 4-tab Plugin Center, <code>distribution: "managed"</code> locks, <code>0600</code> per-plugin secrets, and script-free npm tarball imports without invoking <code>git</code>.</p>
      <p><code>@prismux/sync-vault</code> (Prismux End-to-End Encrypted Sync) seals <code>.prismux-backup</code> payloads with Argon2id + AEAD across WebDAV, S3, and GitHub with <code>If-Match</code> locking, <code>60 s</code> watchdog, and portable <code>data/</code> mode.</p>
    </td>
    <td width="50%" valign="top">
      <strong>6. Phone Simulator, System Tray &amp; Closed-Loop Split Updates</strong>
      <p>Zero-dependency phone simulator pairs Electron CDP (<code>deviceScaleFactor: 0</code> + touch emulation) with single-layer CSS scaling for crisp unclipped HiDPI previews; adds a Windows System Tray (active agent count + <code>Connect to Mobile &gt;</code> submenu) and native Electron <code>powerSaveBlocker</code> Keep Awake.</p>
      <p><code>AppUpdater</code> races <strong>GitHub ↔ Gitee</strong> (auto-falling back to Web Releases on OpenAPI 403) and <strong>npm ↔ npmmirror</strong>, pairing bottom-right update cards + FLIP sidebar capsules with bundled <code>7za.exe</code> <code>.7z.001..003</code> reassembly and mandatory SHA-256 checks; 10-locale catalog keeps <code>en/zh</code> <code>10,300</code> keys 100% aligned.</p>
    </td>
  </tr>
</table>

<h2 id="plugins"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-plugins-en-dark.png"><img src="assets/readme/section-plugins-en-light.png" alt="PLUGINS · Optional Plugins" width="100%"></picture></h2>

> [!NOTE]
> **Four Official Plugins Are Never Preinstalled**: Neither `Prismux-Setup-0.1.2-preview.1-win-x64.exe` nor the unpacked desktop bundle contains any directory from `plugins-official/` (verified at 0 hits across the packaged tree). Each official plugin ships separately as a verified `.wb-plugin` archive (indexed by `prismux-plugins-official.json` and `prismux-plugins-0.1.2-preview.1-SHA256SUMS.txt`) and script-free npm single package, installing strictly on demand with `ctx.effect()` zero-leak rollback.

| Plugin ID | Archive (`.wb-plugin`) | npm Package (Unscoped / GitHub Packages) | Realms | Capabilities &amp; Isolation |
| :--- | :--- | :--- | :--- | :--- |
| `qq` | `prismux-plugin-qq-0.1.2-preview.1.wb-plugin` | `prismux-plugin-qq`<br><code>@fish-under-sea/prismux-plugin-qq</code> | `daemon`, `ui` | OneBot v11 forward/reverse WebSocket probe (NapCatQQ / Lagrange.Core); owner DMs route to the Chief slot while authorized QQ groups use anti-spam pacing locked to <code>social/qq-group-&lt;gid&gt;</code> |
| `pet` | `prismux-plugin-pet-0.1.2-preview.1.wb-plugin` | `prismux-plugin-pet`<br><code>@fish-under-sea/prismux-plugin-pet</code> | `ui`, `daemon` | Desktop mascot bridge implementing targeted instance binding, expiring Lease Tokens, read-only playback subscriptions, and staged motion/bubble handover |
| `fishdock-hook` | `prismux-plugin-fishdock-hook-0.1.2-preview.1.wb-plugin` | `prismux-plugin-fishdock-hook`<br><code>@fish-under-sea/prismux-plugin-fishdock-hook</code> | `daemon` | Bridges `PreToolUse` risk approvals, priority mail alerts, and Overnight Factory completions to FISH-Dock Dynamic Island cards with instant approve/reject actions |
| `ssh` | `prismux-plugin-ssh-0.1.2-preview.1.wb-plugin` | `prismux-plugin-ssh`<br><code>@fish-under-sea/prismux-plugin-ssh</code> | `daemon`, `ui` | Optional remote ops plugin offering an isolated SSH host pool, Web PTY session bridging, path validation, and SFTP file browsing |

<h2 id="install"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-install-en-dark.png"><img src="assets/readme/section-install-en-light.png" alt="INSTALL · Download &amp; Updates" width="100%"></picture></h2>

### Dual-Route Release Channels (GitHub Releases ↔ Gitee Releases)

| Channel | Best For | Release &amp; Download Details |
| :--- | :--- | :--- |
| **GitHub Releases** (Global) | Direct global network / GitHub CLI environments | [Release (`v0.1.2-preview.1`)](https://github.com/Fish-under-sea/Prismux/releases/tag/v0.1.2-preview.1) · [Direct `Prismux-Setup-0.1.2-preview.1-win-x64.exe`](https://github.com/Fish-under-sea/Prismux/releases/download/v0.1.2-preview.1/Prismux-Setup-0.1.2-preview.1-win-x64.exe) |
| **Gitee Releases** (Mainland China Mirror) | High-speed direct downloads inside mainland China | [Release (`v0.1.2-preview.1`)](https://gitee.com/Fish-under-sea/Prismux/releases/tag/v0.1.2-preview.1) (includes 80 MB split `.7z.001..003` volumes, consolidated checksums, and official plugin archives) |
| **In-App Update Center** (Recommended) | Concurrent latency probing, split reassembly &amp; mandatory SHA-256 verification | Open **Settings → About &amp; Updates** (`/settings/about#prismux-updates`) to switch between `Auto / Domestic First / Global First` with one-click install &amp; restart |

### Platform Downloads &amp; Integrity Verification

| Platform / Release Asset | Filename / Availability | Details &amp; Isolation |
| :--- | :--- | :--- |
| **Windows x64 Installer (Electron 44 NSIS)** | `Prismux-Setup-0.1.2-preview.1-win-x64.exe` (Gitee also provides `.7z.001..003`) | Full Electron 44 desktop app with bundled `resources/prismux-daemon/`, `resources/tools/7za.exe`, and `t3-resource-monitor.exe`; supports `/D=<dir>` custom install paths; keeps state in `~/.prismux/` (plus portable `data/` mode); **zero preinstalled official plugins** |
| **macOS (Apple Silicon / Intel)** | `Coming soon (Placeholder reserved)` | Planned `.dmg` artifacts will follow the exact same `0-Token` visual separation and `~/.prismux/` isolation guarantees |
| **Linux (x86_64 / arm64)** | `Coming soon (Placeholder reserved)` | Planned `.AppImage` / `.deb` packages will support dual-route updates and on-demand plugin verification |
| **4 Official Plugin Archives** | `prismux-plugin-{qq,pet,fishdock-hook,ssh}-0.1.2-preview.1.wb-plugin` &amp; `prismux-plugins-official.json` | Deterministic ustar + gzip bundles for on-demand verified import via `/settings/plugins` |
| **Consolidated Checksums** | `Prismux-0.1.2-preview.1-SHA256SUMS.txt` &amp; `prismux-plugins-0.1.2-preview.1-SHA256SUMS.txt` | Verify manual downloads with `Get-FileHash Prismux-Setup-0.1.2-preview.1-win-x64.exe -Algorithm SHA256` or `7z t` |

<h2 id="packages"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-packages-en-dark.png"><img src="assets/readme/section-packages-en-light.png" alt="PACKAGES · npm &amp; Mirrors" width="100%"></picture></h2>

Each official plugin is also published as a **script-free (`preinstall / install / postinstall` disabled)** single npm package bundling its SHA-256-verified `prismux-plugin-<id>-0.1.2-preview.1.wb-plugin` archive and overwrite-safe copy CLI (`prismux-plugin-<id>`). Inside the Plugin Center, Track 2 streams tarballs directly over HTTPS with automatic failover between **`registry.npmjs.org` ↔ `registry.npmmirror.com`** and zero local `git` invocation.

```powershell
# 1. Install and extract a verified .wb-plugin archive from npmjs
npm install prismux-plugin-qq@0.1.2-preview.1
npx prismux-plugin-qq --out ./plugins-stage

# 2. Use the npmmirror domestic registry in mainland China
npm install prismux-plugin-qq@0.1.2-preview.1 --registry=https://registry.npmmirror.com
npx prismux-plugin-qq --out ./plugins-stage
```

- **Other Official Plugins**: Swap `qq` for `pet`, `fishdock-hook`, or `ssh`, then import the extracted `.wb-plugin` file via Settings → **Plugins** (`/settings/plugins`).
- **GitHub Packages Mirror**: Published releases sync `@fish-under-sea/prismux-plugin-{qq,pet,fishdock-hook,ssh}` to `https://npm.pkg.github.com`.

<h2 id="develop"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-develop-en-dark.png"><img src="assets/readme/section-develop-en-light.png" alt="DEVELOP · Development &amp; QA" width="100%"></picture></h2>

> **Prerequisites**: `Node.js >= 24.12.0`, `pnpm >= 10.0.0` (repo pins `pnpm@12.3.4`), `Electron 44`, and `Rust >= 1.85` (for `vendor/t3code/native/resource-monitor`; pass `-j 1` and `NO_PROXY=*` on Windows). Read [`AGENTS.md`](AGENTS.md), [`docs/t3code-patch-manifest.md`](docs/t3code-patch-manifest.md), and your contributor profile `docs/agents/local/<normalized-username>.md` first.

```powershell
# 1. Install workspace dependencies (12 TypeScript workspace packages)
pnpm install

# 2. Build, typecheck, and test all root workspace packages and ops scripts
pnpm -r build
pnpm -r typecheck
pnpm -r --if-present test
pnpm test:scripts

# 3. Verify the vendor/t3code managed-fork lock contract and patch manifest
pnpm upstream:check

# 4. Typecheck and build the Electron 44 T3 Code runtime (web + server + desktop)
pnpm --dir vendor/t3code exec vp run --filter @t3tools/web typecheck
pnpm --dir vendor/t3code exec vp run --filter @t3tools/desktop typecheck
pnpm --dir vendor/t3code exec vp run build:desktop

# 5. Orchestrate full desktop build & Windows NSIS installer (with 7z check & SHA256SUMS)
pnpm desktop:build
pnpm desktop:installer

# 6. Deterministically pack an official plugin (.wb-plugin + gunzip loopback check)
pnpm plugin:pack -- --plugin plugins-official/plugin-qq
```

<details>
<summary><strong>Expand: Monorepo Structure &amp; T3 Code Minimal-Invasion Boundary</strong></summary>

```text
prismux/
├── AGENTS.md                            # Cross-machine engineering rules, guardrails & DoD gates
├── LICENSE                              # Standard MIT License
├── README.md / README.en.md             # Bilingual project homepages
├── UPSTREAM_LOCK.json                   # pingdotgg/t3code baseline SHA, managed-fork mode & manifest pointer
├── pnpm-workspace.yaml                  # 12 TS workspace packages (excludes vendor/t3code & desktop-tauri)
├── package.json                         # Root orchestration scripts (0.1.2-preview.1)
├── tsconfig.base.json                   # Shared strict TypeScript 5.8+ baseline (ES2024 + NodeNext)
├── assets/
│   ├── logo.png                         # Transparent 1024×1024 mascot master icon
│   └── readme/                          # Pixel-art headers, section banners, Preview 1 screenshots & templates
├── docs/
│   ├── t3code-patch-manifest.md         # Authoritative registry of MP-01 ~ MP-07 T3 Code mounts & extensions
│   ├── agents/                          # Per-developer local environment profiles & templates
│   ├── releases/v0.0.1-alpha.1.md       # Archived initial prototype release notes
│   └── specs/
│       ├── master-prompt-v1.3.md        # Full-stack architectural constitution
│       └── ui-ux-design-mandate.md      # Mandatory UI/UX, theme & installer specification
├── scripts/                             # Operational tooling & README renderer (Node 24 native TS / ESM)
│   ├── build-prismux-desktop.ts         # Unified desktop & NSIS installer orchestrator (--installer / --skip-rust)
│   ├── release-all.ts                   # Desktop + 4 official plugins + npm packages + SHA256SUMS bundler
│   ├── sync-t3-upstream.ts              # managed-fork / upstream lock verifier (--check / --sync)
│   ├── pack-plugin.ts                   # Deterministic ustar + gunzip loopback plugin packer
│   ├── build-npm-plugin-packages.ts     # Script-free npm & GitHub Packages generator
│   ├── rename-brand.ts                  # Safe repository-wide brand identifier renamer
│   ├── render-readme.mjs                # Edge CDP pixel-header & section-banner renderer
│   └── __tests__/scripts.test.ts        # node:test regression suite
├── vendor/
│   └── t3code/                          # T3 Code base (Electron 44 + server + web), tracked by MP-01 ~ MP-07
├── packages/                            # 6 core workspace packages
│   ├── protocol/                        # @prismux/protocol: brand, RPC, hooks, memory, plugin & updater types
│   ├── cordis-kernel/                   # @prismux/cordis-kernel: dual-realm host, declarative UI, dual-route installer & 0600 secrets
│   ├── memory-core/                     # @prismux/memory-core: SQLite WAL + FTS5 + sqlite-vec, Mnemopi recall & query isolation
│   ├── sync-vault/                      # @prismux/sync-vault: Argon2id + AEAD sync, optimistic locks & 60 s watchdog
│   ├── prismux-appearance/              # @prismux/appearance: Celestial capsule, declarative glass, model effort slider & T3 glass bridge
│   └── prismux-wallpaper/               # @prismux/wallpaper: 2-tab sidebar, 4-tab settings, Z-0 stage & Steam 431960
├── apps/                                # Headless daemon (+ retiring prototype & historical shell)
│   ├── daemon/                          # @prismux/daemon: 24h supervisor, Chief slot, 5 primitives, diagnostics, ports & factory
│   ├── workbench-ui/                    # @prismux/workbench-ui: [retiring prototype] v0.0.1 shell superseded by T3 Code base
│   └── desktop-tauri/                   # prismux-desktop: [historical shell] superseded by T3 Code Electron 44
└── plugins-official/                    # 4 optional official plugins (workspace packages) + catalog
    ├── catalog/official.json            # Authoritative plugin index (SHA-256 / bytes / engines / status)
    ├── plugin-qq/                       # @prismux/plugin-qq
    ├── plugin-pet/                      # @prismux/plugin-pet
    ├── plugin-fishdock-hook/            # @prismux/plugin-fishdock-hook
    └── plugin-ssh/                      # @prismux/plugin-ssh
```

</details>

<details>
<summary><strong>Expand: Five Non-Negotiable Engineering Guardrails</strong></summary>

1. **Minimal-Invasion Layering on T3 Code**: `vendor/t3code/` changes remain strictly registered under MP-01 ~ MP-07 in [`docs/t3code-patch-manifest.md`](docs/t3code-patch-manifest.md) with zero changes to `vendor/t3code/pnpm-lock.yaml`; heavy domain logic and visual engines reside in root `packages/*` and `apps/daemon`.
2. **Never reintroduce the 4 eliminated bloat modules (native lightweight archiving & Orca lightweight Workspace Board / Tasks preserved)**: Heavy session-detached Task Boards, AgentTeam DAG, Skill Lens, Visual Companion, and custom heavy Session Archive backends remain excluded in favor of the five core primitives; **T3 Code's native lightweight `/settings/archived` view and Orca's lightweight `/workspace-board` & `/tasks` views are preserved per project decision**.
3. **Single-file hybrid memory & physical isolation**: All memories reside in `~/.prismux/data/memory.db` (SQLite WAL + FTS5 + `sqlite-vec`) with zero PostgreSQL / Qdrant / MinIO / Obsidian client dependencies, enforced at transport level via `_callerScope`.
4. **Four official plugins are never preinstalled**: `qq`, `pet`, `fishdock-hook`, and `ssh` remain isolated in `plugins-official/` and are excluded from desktop installers, installed strictly on demand.
5. **Zero model token cost for the visual layer**: Wallpapers, 360° Fresnel liquid glass, animated model effort sliders, typography tinting, audio FFT sync, desktop pet staging, and installer screens inject zero tool schemas or prompts into any LLM.

</details>

<details>
<summary><strong>Expand: M1–M5 &amp; Preview 1 Integration Milestones</strong></summary>

| Milestone | Scope Delivered | Status |
| :--- | :--- | :--- |
| **M1** | Monorepo scaffold, T3 Code baseline lock, `apps/daemon` supervision, env sanitization, Chief Thread Slot &amp; `2 MB` ring-buffered `PersistentPtyPool` | Complete &amp; Verified |
| **M2** | Single-file SQLite WAL + FTS5 + `sqlite-vec` memory, Mnemopi prompt-cache recall, `forwardIdentity` isolation, `LifecycleHookBus`, `HandoffEngine` &amp; `WorktreeSandbox` | Complete &amp; Verified |
| **M3** | `cordis-kernel` (`engines.prismux`, zero-leak `ctx.effect()`, declarative UI, script-free npm tarball installer, `managed` lock) &amp; `sync-vault` (Argon2id + AEAD, `If-Match`, `60 s` stall watchdog, portable `data/`) | Complete &amp; Verified |
| **M4 / v0.1.0–v0.1.2 Preview 1** | `@prismux/appearance` (SVG-masked glass frame, 5-zone studio &amp; `dsh-fish` effort slider) + `@prismux/wallpaper` extraction, T3 Code MP-01 ~ MP-07 integration (0-Token cube BootSplash, single-row multi-tab splits, Orca sidebar/Workspace Board/Tasks, AGY 2.0 welcome hero &amp; dual-layer composer, AGY Overview, 20px live-process &amp; Keep Awake bar, System Tray, Chief identity &amp; Obsidian curation, closed-loop auto-updates, divider-free settings &amp; pure official ACP) | Complete &amp; Live-Verified |
| **M5** | `OvernightFactory` end-to-end closed loop, deterministic `.wb-plugin` packaging/verification (`0.1.2-preview.1`) for `qq`, `pet`, `fishdock-hook`, and `ssh`, plus dual-route split auto-updates | Complete &amp; Verified |

</details>

<h2 id="thanks"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-thanks-en-dark.png"><img src="assets/readme/section-thanks-en-light.png" alt="THANKS · Credits &amp; License" width="100%"></picture></h2>

### Documentation Index

| Document | Purpose |
| :--- | :--- |
| [`AGENTS.md`](AGENTS.md) | Cross-machine engineering rules, five guardrails, script/plugin contracts &amp; commit conventions |
| [`docs/t3code-patch-manifest.md`](docs/t3code-patch-manifest.md) | Authoritative registry of MP-01 ~ MP-07 mounts, Provider extensions &amp; upstream merge guide |
| [`docs/specs/ui-ux-design-mandate.md`](docs/specs/ui-ux-design-mandate.md) | UI/UX craftsmanship, Celestial tri-state capsule, four-region glass sync &amp; installer mandate |
| [`docs/specs/master-prompt-v1.3.md`](docs/specs/master-prompt-v1.3.md) | Full-stack autonomous build specification (architectural constitution) |
| [`docs/agents/README.md`](docs/agents/README.md) | Contributor local environment profile naming rules, template &amp; maintenance workflow |
| [`docs/releases/v0.0.1-alpha.1.md`](docs/releases/v0.0.1-alpha.1.md) | Archived initial prototype release notes |
| [`assets/readme/MAINTAINING.md`](assets/readme/MAINTAINING.md) | README pixel-art header/banner rendering workflow, dimensions &amp; CDN cache guide |

### Upstream Credits &amp; MIT Open-Source Attributions

- [pingdotgg/t3code](https://github.com/pingdotgg/t3code) (MIT): Upstream Electron 44 + `apps/server` + `apps/web` runtime and provider bridge core.
- [stablyai/orca](https://github.com/stablyai/orca) (MIT): Reference for port scanning &amp; resource monitoring, 24px status bar, sortable Activity Bar, Orca sidebar &amp; monolithic composer, `omp` dialect, and declarative plugin UI.
- [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) (MIT): Reference for Mnemopi prompt-cache-friendly recall &amp; scoped caches, `omp acp` `_session/steering` / `_omp/usage`, and status-bar context/cache gauges.
- `dsh-better-reasoning-effort-fish` ([HanaAyane/dsh-reasoning-effort](https://github.com/HanaAyane/dsh-reasoning-effort) PR #9 + [HaoyueQin/dsh-better-reasoning-effort](https://github.com/HaoyueQin/dsh-better-reasoning-effort), MIT): Source for the model-recognizing animated reasoning effort slider (`<PrismuxReasoningEffortSlider />`, 8 model family themes &amp; RGBA WebP runners).
- [yetone/magpie](https://github.com/yetone/magpie): Inspiration for passphrase-sealed AEAD sync, `If-Match` optimistic locking, 60-second stall watchdogs, and portable mode.
- [Amp](https://ampcode.com/): Inspiration for `/handoff` distillation and `agent / oracle / review` dial workflows.
- [FISH-Dock](https://github.com/Fish-under-sea/FISH-Dock): Reference for the Warm Paper / Dark Olive stereomorphic README design system, 1:1 Celestial capsule &amp; 360° Fresnel liquid-glass theme hooks, and Dynamic Island approval bridging.

### License Boundary

Prismux core source code and README layout tooling are licensed under the **MIT License** (see [`LICENSE`](LICENSE)); the bundled pixel font `Jersey20-Regular.ttf` is licensed under [SIL Open Font License 1.1](assets/readme/OFL-Jersey20.txt); the managed `vendor/t3code` fork and ported MIT references above preserve their original MIT licenses and notices.

<p align="center"><sub>Prismux · 24/7 Agent-Agnostic Super Workbench · 0-Token Visual Layer · 4 Official Optional Plugins</sub></p>
