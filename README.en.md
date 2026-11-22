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
  <a href="https://github.com/Fish-under-sea/Prismux/releases/tag/v0.0.1-alpha.1"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/stat-version-en-dark.png"><img src="assets/readme/stat-version-en-light.png" alt="VERSION: 0.0.1-alpha.1 (Setup &amp; Portable)" width="23%"></picture></a>
  <a href="#preview"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/stat-visual-en-dark.png"><img src="assets/readme/stat-visual-en-light.png" alt="VISUAL: 0 TOKEN (360° Fresnel Glass)" width="23%"></picture></a>
  <a href="#features"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/stat-memory-en-dark.png"><img src="assets/readme/stat-memory-en-light.png" alt="MEMORY: SQLITE VEC (Single-File Isolation)" width="23%"></picture></a>
  <a href="#plugins"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/stat-plugins-en-dark.png"><img src="assets/readme/stat-plugins-en-light.png" alt="PLUGINS: 4 PLUGINS (Zero Preinstall)" width="23%"></picture></a>
</p>

<p>
  <img src="https://img.shields.io/badge/Node.js-%3E%3D24.12-8fd6a0?style=flat-square&amp;logo=nodedotjs&amp;logoColor=white&amp;labelColor=5a544a" alt="Node.js >= 24.12">
  <img src="https://img.shields.io/badge/pnpm-12-8fd6a0?style=flat-square&amp;logo=pnpm&amp;logoColor=white&amp;labelColor=5a544a" alt="pnpm 12">
  <img src="https://img.shields.io/badge/TypeScript-5.8-8fd6a0?style=flat-square&amp;logo=typescript&amp;logoColor=white&amp;labelColor=5a544a" alt="TypeScript 5.8">
  <img src="https://img.shields.io/badge/Tauri%20v2-Rust%201.85%2B-8fd6a0?style=flat-square&amp;logo=tauri&amp;logoColor=white&amp;labelColor=5a544a" alt="Tauri v2 / Rust 1.85+">
  <img src="https://img.shields.io/badge/License-MIT-8fd6a0?style=flat-square&amp;labelColor=5a544a" alt="License MIT">
  <img src="https://img.shields.io/badge/Release-v0.0.1--alpha.1-f08a5d?style=flat-square&amp;labelColor=5a544a" alt="Release v0.0.1-alpha.1">
</p>

<p><strong>Prismux · Minimalist Liquid-Glass AI Super Workbench &amp; 24/7 Secretary</strong><br>Bridges a read-only <code>t3code</code> server with an agent-agnostic Chief slot, query-isolated single-file SQLite memory, 360° Fresnel liquid glass, dual-route auto-updates, and an autonomous Overnight Factory.</p>

<p>
  <a href="#install"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-download-en-dark.png"><img src="assets/readme/key-download-en-light.png" alt="Downloads" height="40"></picture></a>
  <a href="docs/releases/v0.0.1-alpha.1.md"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-release-en-dark.png"><img src="assets/readme/key-release-en-light.png" alt="Changelog" height="40"></picture></a>
  <a href="https://github.com/Fish-under-sea/Prismux/issues"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/key-issues-en-dark.png"><img src="assets/readme/key-issues-en-light.png" alt="Issues" height="40"></picture></a>
</p>

</div>

<h2 id="intro"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-intro-en-dark.png"><img src="assets/readme/section-intro-en-light.png" alt="INTRO · Overview" width="100%"></picture></h2>

Prismux is an AI Super Workbench and 24/7 headless secretary built around **a lean core, a 0-Token visual shell, and strictly on-demand plugins**. The main application bundles only the lightweight daemon (`apps/daemon`), workbench frontend (`apps/workbench-ui`), native transparent Tauri shell (`apps/desktop-tauri`), and single-file SQLite memory core (`packages/memory-core`), delivering **complete M1–M5 capabilities and `v0.0.1-alpha.1` dual-route release tooling**.

- **100% Read-Only Upstream Submodule**: [`vendor/t3code`](vendor/t3code) remains strictly unmodified and excluded from `pnpm-workspace.yaml`; all extensions connect externally through authenticated WebSocket RPC and loopback MCPs.
- **Zero Heavy External Services**: No PostgreSQL, Qdrant, MinIO, or Obsidian desktop client required—memory, logs, and credentials stay in `~/.prismux/` (or an adjacent `data/` directory in portable mode).
- **Four Official Plugins Never Preinstalled**: `qq`, `pet`, `fishdock-hook`, and `ssh` ship independently as `.wb-plugin` archives and script-free npm packages, installed only when explicitly selected in the Plugin Market.

The current pre-release is **`v0.0.1-alpha.1`**; see [v0.0.1-alpha.1 Release Notes](docs/releases/v0.0.1-alpha.1.md) for package checklists and upgrade notes.

<h2 id="preview"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-preview-en-dark.png"><img src="assets/readme/section-preview-en-light.png" alt="PREVIEW · Visual Preview" width="100%"></picture></h2>

<p align="center">
  <img src="assets/readme/preview-glass-standby.png" width="860" alt="Prismux Secretary Standby preset over WebWallGL aurora liquid glass canvas">
  <br>
  <sub><strong>Secretary Standby Preset</strong>: Collapses heavy coding panes to preserve 85%–90% unobstructed <code>WebWallGL</code> live wallpaper canvas with floating glass capsules and the bottom <code>UsageLedger</code> bar.</sub>
</p>

<table>
  <tr>
    <td width="50%" align="center" valign="top">
      <img src="assets/readme/preview-theme-capsule.png" width="100%" alt="Prismux Theme and Background controls with Celestial Three-State Capsule">
      <br>
      <sub><strong>Celestial Capsule &amp; Four-Region Liquid Glass</strong>: Full-width recessed tri-state capsule (Light / Dark / Glass), <code>WebWallGL + Steam 431960</code> wallpaper controls, and four-region (<code>sidebar / content / overlay / control</code>) glass tuning.</sub>
    </td>
    <td width="50%" align="center" valign="top">
      <img src="assets/readme/preview-multi-agent.png" width="100%" alt="Prismux Multi-Agent Coding preset with approval guide and PTY replay">
      <br>
      <sub><strong>Multi-Agent Coding &amp; Approval Guide</strong>: Worktree tree, persistent <code>2 MB</code> ring-buffered PTY terminal, inline Git diff, three-column risk approval card, and <code>Dial / Handoff</code> preview.</sub>
    </td>
  </tr>
</table>

<h2 id="features"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-features-en-dark.png"><img src="assets/readme/section-features-en-light.png" alt="FEATURES · Core Capabilities" width="100%"></picture></h2>

<table>
  <tr>
    <td width="50%" valign="top">
      <strong>1. Agent-Agnostic Chief Slot (<code>Chief Thread Slot</code>)</strong>
      <p><code>apps/daemon</code> supervises an unmodified, read-only <code>vendor/t3code/apps/server</code> 24/7 with <code>--headless</code> support while stripping host pollution variables such as <code>ELECTRON_RUN_AS_NODE</code> before spawning any provider or shell.</p>
      <p>Hot-swap Claude Code, Codex, Antigravity, or OpenCode in the top bar—reusing existing subscriptions and attaching loopback <code>prismux-memory</code> and <code>prismux-orchestrator</code> MCPs automatically.</p>
    </td>
    <td width="50%" valign="top">
      <strong>2. Five Core Primitives (Zero Legacy Bloat Panels)</strong>
      <p>Replaces Task Boards, AgentTeam DAGs, Skill Lens, Visual Companions, and Session Archives with five sharp engineering primitives:</p>
      <ul>
        <li><code>PersistentPtyPool</code>: <code>2 MB</code> per-terminal ring buffer &amp; lossless reconnect replay</li>
        <li><code>HandoffEngine</code>: <code>/handoff</code> distillation &amp; <code>agent / oracle / review</code> dial modes</li>
        <li><code>CollectorAndGuard</code>: Multi-format slicing, identity injection &amp; <code>60 s</code> breaker</li>
        <li><code>LifecycleHookBus</code>: 6 deterministic hook events, exit-code <code>2</code> blocks &amp; <code>onFailure: "block"</code></li>
        <li><code>WorktreeSandbox</code>: OS-level write isolation &amp; domain-allowlisted proxy gateway</li>
      </ul>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>3. Single-File Isolated Memory &amp; <code>OvernightFactory</code></strong>
      <p>All memories live inside <code>~/.prismux/data/memory.db</code> (SQLite WAL + FTS5 + <code>sqlite-vec</code> hybrid RRF search) with a <code>POST /v1/memory/import-obsidian</code> migration API. <code>forwardIdentity</code> overwrites <code>_callerScope</code> at the transport layer so <code>qq_group:&lt;gid&gt;</code> can never access <code>private/chief</code> or <code>workspace/*</code>.</p>
      <p><code>OvernightFactory</code> automates Gmail OAuth2 / IMAP <code>#factory</code> ingestion → memory-enriched Handoff → sandboxed <code>git worktree</code> coding &amp; branch commit → read-only Oracle <code>review</code> → HTML morning report with diff &amp; <code>prismux://review/&lt;threadId&gt;</code> deep link.</p>
    </td>
    <td width="50%" valign="top">
      <strong>4. 360° Fresnel Liquid Glass, 0-FPS Wallpaper &amp; 4 Tools</strong>
      <p>Features the recessed Celestial tri-state capsule, four-region <code>fill / blur</code> sliders, independent light/dark text palettes, <code>FishDock.theme</code> follow hooks, and sanitized <code>.wb-theme</code> bundles with strictly <strong>0 Token overhead</strong> to any model.</p>
      <p>Includes Steam <code>431960</code> scanning, WASAPI / CoreAudio / PipeWire audio FFT sync, <code>visibility: occluded</code> 0 FPS suspension, plus <code>ApprovalGuide</code>, <code>ReasoningEffortCard</code> (navy-to-blue DeepSeek dark track), <code>UsageLedger</code>, and <code>NavAndCommandOrder</code>.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <strong>5. Cordis Dual-Realm Plugins &amp; Magpie E2EE Sync</strong>
      <p><code>@prismux/cordis-kernel</code> enforces top-level <code>engines.prismux</code> SemVer, tears down every route, hook, style, and panel via <code>ctx.effect()</code>, and secures per-plugin secrets in <code>0600</code> encrypted files under <code>distribution: "managed"</code> locks.</p>
      <p><code>@prismux/sync-vault</code> seals <code>.prismux-backup</code> payloads using Argon2id + AEAD across independent WebDAV, S3 (<code>path-style</code>), and GitHub channels with <code>If-Match</code> optimistic locking, a <code>60 s</code> stall watchdog, and portable <code>data/</code> mode.</p>
    </td>
    <td width="50%" valign="top">
      <strong>6. Dual-Route Auto-Switching In-App &amp; Plugin Updater</strong>
      <p><code>AppUpdater</code> (Daemon + Tauri + Workbench Update Center) and <code>StreamingInstaller</code> share a unified <code>auto / domestic / global</code> network routing policy.</p>
      <p>App updates race and failover between <strong>GitHub Releases ↔ Gitee Releases</strong> with mandatory 64-hex <code>.sha256</code> verification (cleaning <code>.part</code> files immediately on mismatch), <code>Range</code> resume, and optional custom proxy prefixes; plugin installs fail over cleanly between <strong>npmjs ↔ npmmirror</strong> without touching local <code>git</code> or running lifecycle scripts.</p>
    </td>
  </tr>
</table>

<h2 id="plugins"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-plugins-en-dark.png"><img src="assets/readme/section-plugins-en-light.png" alt="PLUGINS · Optional Plugins" width="100%"></picture></h2>

> [!NOTE]
> **Four Official Plugins Are Never Preinstalled**: Neither the Setup EXE nor the Portable ZIP includes any directory from `plugins-official/`. Each official plugin ships separately as a verified `.wb-plugin` archive (GitHub / Gitee Releases) and a script-free npm single package, installs strictly on demand, and rolls back cleanly with `ctx.effect()`.

| Plugin ID | Archive (`.wb-plugin`) | npm Package (Unscoped / GitHub Packages) | Realms | Capabilities &amp; Isolation |
| :--- | :--- | :--- | :--- | :--- |
| `qq` | `qq-0.0.1-alpha.1.wb-plugin` | `prismux-plugin-qq`<br><code>@fish-under-sea/prismux-plugin-qq</code> | `daemon`, `ui` | OneBot v11 forward/reverse WebSocket probe (NapCatQQ / Lagrange.Core); owner DMs route to the Chief slot while authorized QQ groups use anti-spam pacing locked to <code>social/qq-group-&lt;gid&gt;</code> |
| `pet` | `pet-0.0.1-alpha.1.wb-plugin` | `prismux-plugin-pet`<br><code>@fish-under-sea/prismux-plugin-pet</code> | `ui`, `daemon` | Desktop mascot bridge implementing targeted instance binding, expiring Lease Tokens, read-only playback subscriptions, and staged motion/bubble handover |
| `fishdock-hook` | `fishdock-hook-0.0.1-alpha.1.wb-plugin` | `prismux-plugin-fishdock-hook`<br><code>@fish-under-sea/prismux-plugin-fishdock-hook</code> | `daemon` | Bridges `PreToolUse` risk approvals, priority mail alerts, and Overnight Factory completions to FISH-Dock Dynamic Island cards with instant approve/reject actions |
| `ssh` | `ssh-0.0.1-alpha.1.wb-plugin` | `prismux-plugin-ssh`<br><code>@fish-under-sea/prismux-plugin-ssh</code> | `daemon`, `ui` | Optional remote ops plugin offering an isolated SSH host pool, Web PTY session bridging, path validation, and SFTP file browsing |

<h2 id="install"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-install-en-dark.png"><img src="assets/readme/section-install-en-light.png" alt="INSTALL · Download &amp; Updates" width="100%"></picture></h2>

### Dual-Route Release Channels (GitHub Releases ↔ Gitee Releases)

| Channel | Best For | Release URL |
| :--- | :--- | :--- |
| **GitHub Releases** (Global) | Direct global network / GitHub CLI environments | [Fish-under-sea/Prismux Releases (`v0.0.1-alpha.1`)](https://github.com/Fish-under-sea/Prismux/releases/tag/v0.0.1-alpha.1) |
| **Gitee Releases** (Mainland China Mirror) | High-speed direct downloads inside mainland China | [Fish-under-sea/Prismux Gitee Releases (`v0.0.1-alpha.1`)](https://gitee.com/Fish-under-sea/Prismux/releases/tag/v0.0.1-alpha.1) |
| **In-App Update Center** (Recommended) | Concurrent latency probing, `Range` resume &amp; mandatory `.sha256` checks | Click the `v0.0.1-alpha.1` pill in the top bar to switch between `Auto / Domestic Mirror First / Global Direct First` |

### Setup Installer vs Portable Archive (Windows x64)

| Package | Filename | Installation &amp; Usage | Data &amp; Isolation |
| :--- | :--- | :--- | :--- |
| **Setup EXE (NSIS)** | `Prismux-Setup-0.0.1-alpha.1.exe` | Quiet-luxury 5-step wizard (defaults to per-user `$LOCALAPPDATA\Prismux`) | Stores runtime memory &amp; secrets in `~/.prismux/`; supports `/D=<dir>` custom install dir; never preinstalls the 4 plugins |
| **Portable ZIP** | `Prismux-Portable-0.0.1-alpha.1-win-x64.zip` | Extract and run anywhere (USB, NAS share, or isolated sandbox) | Includes an adjacent `data/` folder and `PORTABLE_MODE.txt`; SQLite DB, logs, and `0600` plugin secrets stay inside `data/` |
| **Integrity Checksums** | `SHA256SUMS.txt` &amp; per-asset `.sha256` | Mandatory checksum verification source | Verify manual downloads via `Get-FileHash <file> -Algorithm SHA256` against [v0.0.1-alpha.1 Release Notes](docs/releases/v0.0.1-alpha.1.md) |

<h2 id="packages"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-packages-en-dark.png"><img src="assets/readme/section-packages-en-light.png" alt="PACKAGES · npm &amp; Mirrors" width="100%"></picture></h2>

Each official plugin is also published as a **script-free (`preinstall / install / postinstall` disabled)** single npm package bundling its SHA-256-verified `<id>-0.0.1-alpha.1.wb-plugin` archive and overwrite-safe copy CLI (`prismux-plugin-<id>`). Inside the Plugin Market, Track 2 streams tarballs directly over HTTPS with automatic failover between **`registry.npmjs.org` ↔ `registry.npmmirror.com`** and zero local `git` invocation.

```powershell
# 1. Install and extract a verified .wb-plugin archive from npmjs
npm install prismux-plugin-qq@0.0.1-alpha.1
npx prismux-plugin-qq --out ./plugins-stage

# 2. Use the npmmirror domestic registry in mainland China
npm install prismux-plugin-qq@0.0.1-alpha.1 --registry=https://registry.npmmirror.com
npx prismux-plugin-qq --out ./plugins-stage
```

- **Other Official Plugins**: Swap `qq` for `pet`, `fishdock-hook`, or `ssh`, then import the extracted `.wb-plugin` file in the Prismux Plugin Market.
- **GitHub Packages Mirror**: Published releases automatically trigger `.github/workflows/publish-github-packages.yml` to publish `@fish-under-sea/prismux-plugin-{qq,pet,fishdock-hook,ssh}` to `https://npm.pkg.github.com`.

<h2 id="develop"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-develop-en-dark.png"><img src="assets/readme/section-develop-en-light.png" alt="DEVELOP · Development &amp; QA" width="100%"></picture></h2>

> **Prerequisites**: `Node.js >= 24.12.0`, `pnpm >= 10.0.0` (repo pins `pnpm@12.3.4`), and `Rust >= 1.85` (pass `-j 1` to Cargo on Windows to prevent MSVC linker crashes). Read [`AGENTS.md`](AGENTS.md) and your contributor profile `docs/agents/local/<normalized-username>.md` first.

```powershell
# 1. Install workspace dependencies (10 TypeScript workspace packages)
pnpm install

# 2. Build and typecheck all TypeScript workspace packages (typecheck passes with zero dist/)
pnpm -r build
pnpm -r typecheck

# 3. Run all workspace unit tests and zero-dependency script tests
pnpm test
pnpm test:scripts

# 4. Verify the read-only vendor/t3code submodule lock contract
pnpm upstream:check

# 5. Start the 24/7 headless daemon CLI
node apps/daemon/dist/cli.js start --headless

# 6. Deterministically pack an official plugin (.wb-plugin + gunzip loopback check + .sha256)
pnpm plugin:pack -- --plugin plugins-official/plugin-qq

# 7. Check and test the Rust / Tauri v2 desktop shell
# (If using a portable Rust toolchain, activate RUSTUP_HOME / CARGO_HOME / PATH per docs/agents/local/<username>.md first)
cargo check -j 1 --offline --all-targets --manifest-path apps/desktop-tauri/Cargo.toml
cargo test -j 1 --offline --manifest-path apps/desktop-tauri/Cargo.toml

# 8. Build complete Setup EXE, Portable ZIP, 4 official plugins, and SHA256SUMS.txt
pnpm release:build
```

<details>
<summary><strong>Expand: Monorepo 10-Package Tree</strong></summary>

```text
prismux/
├── AGENTS.md                            # Cross-machine engineering rules, guardrails & DoD gates
├── LICENSE                              # Standard MIT License
├── README.md / README.en.md             # Bilingual project homepages
├── UPSTREAM_LOCK.json                   # Pinned commit & required paths for read-only vendor/t3code
├── pnpm-workspace.yaml                  # 10 TS workspace packages (excludes vendor/t3code & desktop-tauri)
├── package.json                         # Root orchestration scripts (v0.0.1-alpha.1)
├── tsconfig.base.json                   # Shared strict TypeScript 5.8+ baseline (ES2024 + NodeNext)
├── assets/
│   ├── logo.png                         # Transparent 1024×1024 mascot master icon
│   └── readme/                          # Pixel-art headers, section banners, UI previews & templates
├── docs/
│   ├── agents/                          # Per-developer local environment profiles & templates
│   ├── releases/v0.0.1-alpha.1.md       # Initial public alpha release notes
│   └── specs/
│       ├── master-prompt-v1.3.md        # Full-stack architectural constitution
│       └── ui-ux-design-mandate.md      # Mandatory UI/UX, theme & quiet-luxury installer spec
├── scripts/                             # Operational tooling & README renderer
│   ├── rename-brand.ts                  # Safe repository-wide brand identifier renamer
│   ├── sync-t3-upstream.ts              # Read-only check (--check) & shallow sync (--sync)
│   ├── pack-plugin.ts                   # Deterministic ustar + gunzip loopback plugin packer
│   ├── render-readme.mjs                # Edge CDP pixel-header & section-banner renderer
│   ├── build-release-packages.ts        # Full Setup EXE / Portable ZIP / 4-plugin / SHA256SUMS builder
│   ├── build-npm-plugin-packages.ts     # Script-free npm & GitHub Packages generator
│   ├── publish-gitee-release.ts         # Gitee repo provisioning, tag push & verified upload script
│   └── __tests__/scripts.test.ts        # node:test regression suite
├── vendor/
│   └── t3code/                          # 100% read-only pingdotgg/t3code submodule (excluded from workspace)
├── packages/                            # 4 core workspace packages
│   ├── protocol/                        # @prismux/protocol: brand, RPC, hooks, memory, handoff, plugin & updater types
│   ├── cordis-kernel/                   # @prismux/cordis-kernel: dual-realm host, SemVer, dual-route installer & 0600 secrets
│   ├── memory-core/                     # @prismux/memory-core: SQLite WAL + FTS5 + sqlite-vec & query isolation
│   └── sync-vault/                      # @prismux/sync-vault: Argon2id + AEAD sync, optimistic locks & 60 s watchdog
├── apps/                                # 2 TS workspace apps + 1 standalone Rust crate
│   ├── daemon/                          # @prismux/daemon: 24h supervisor, Chief slot, 5 primitives, updater & OvernightFactory
│   ├── workbench-ui/                    # @prismux/workbench-ui: React 19 + Vite + WebWallGL + 360° Fresnel glass
│   └── desktop-tauri/                   # prismux-desktop: Rust + Tauri v2 transparent shell & NSIS installer
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

1. **Never modify a single line inside `vendor/t3code/`**: `git status --porcelain` must stay completely empty and aligned with `UPSTREAM_LOCK.json`; all extensions live externally via authenticated WebSocket RPC, `client-runtime`, and loopback MCPs.
2. **Never reintroduce the 5 eliminated bloat modules**: Task Board, AgentTeam DAG, Skill Lens, Visual Companion, and Session Archive remain permanently excluded in favor of the five core primitives.
3. **Single-file hybrid memory & physical isolation**: All memories reside in `~/.prismux/data/memory.db` (SQLite WAL + FTS5 + `sqlite-vec`) with zero PostgreSQL / Qdrant / MinIO / Obsidian client dependencies, enforced at transport level via `_callerScope`.
4. **Four official plugins are never preinstalled**: `qq`, `pet`, `fishdock-hook`, and `ssh` remain isolated in `plugins-official/` and are installed strictly on demand via the Plugin Market.
5. **Zero model token cost for the visual layer**: Wallpapers, 360° Fresnel liquid glass, typography tinting, audio FFT sync, desktop pet staging, and installer screens inject zero tool schemas or prompts into any LLM.

</details>

<details>
<summary><strong>Expand: M1–M5 Delivered Milestones</strong></summary>

| Milestone | Scope Delivered | Status |
| :--- | :--- | :--- |
| **M1** | Monorepo scaffold, read-only `vendor/t3code` submodule lock, `apps/daemon` supervision, env sanitization, Chief Thread Slot & `2 MB` ring-buffered `PersistentPtyPool` | Complete & Verified |
| **M2** | Single-file SQLite WAL + FTS5 + `sqlite-vec` memory, Obsidian importer, `forwardIdentity` isolation, `LifecycleHookBus` (`onFailure: "block"`), `HandoffEngine` (`Dial`) & `WorktreeSandbox` | Complete & Verified |
| **M3** | `cordis-kernel` (top-level `engines.prismux`, zero-leak `ctx.effect()`, script-free npm tarball installer, `managed` lock) & `sync-vault` (Argon2id + AEAD, `If-Match`, `60 s` stall watchdog, portable `data/`) | Complete & Verified |
| **M4** | `apps/desktop-tauri` (audio FFT, `visibility: occluded` 0 FPS suspend, Steam `431960` scanner, 5-step quiet-luxury NSIS installer) & `apps/workbench-ui` (Celestial capsule, 4-region liquid glass, dual presets, `WebWallGL`, 4 built-in enhancers) | Complete & Verified |
| **M5** | `OvernightFactory` end-to-end closed loop, deterministic `.wb-plugin` packaging/verification for `qq`, `pet`, `fishdock-hook`, and `ssh`, plus dual-route auto-updates | Complete & Verified |

</details>

<h2 id="thanks"><picture><source media="(prefers-color-scheme: dark)" srcset="assets/readme/section-thanks-en-dark.png"><img src="assets/readme/section-thanks-en-light.png" alt="THANKS · Credits &amp; License" width="100%"></picture></h2>

### Documentation Index

| Document | Purpose |
| :--- | :--- |
| [`AGENTS.md`](AGENTS.md) | Cross-machine engineering rules, five guardrails, script/plugin contracts & commit conventions |
| [`docs/releases/v0.0.1-alpha.1.md`](docs/releases/v0.0.1-alpha.1.md) | `v0.0.1-alpha.1` public alpha release notes, dual-route downloads & checksums |
| [`docs/specs/ui-ux-design-mandate.md`](docs/specs/ui-ux-design-mandate.md) | UI/UX craftsmanship, Celestial tri-state capsule, four-region glass sync & 5-step installer mandate |
| [`docs/specs/master-prompt-v1.3.md`](docs/specs/master-prompt-v1.3.md) | Full-stack autonomous build specification (architectural constitution) |
| [`docs/agents/README.md`](docs/agents/README.md) | Contributor local environment profile naming rules, template & maintenance workflow |
| [`assets/readme/MAINTAINING.md`](assets/readme/MAINTAINING.md) | README pixel-art header/banner rendering workflow, dimensions & CDN cache guide |
| [`apps/desktop-tauri/README.md`](apps/desktop-tauri/README.md) | Rust / Tauri v2 desktop shell modules & `-j 1` build/test gates |
| [`apps/desktop-tauri/installer/README.md`](apps/desktop-tauri/installer/README.md) | Windows NSIS quiet-luxury installer hooks, portable `data/` mode & zero-preinstall contract |

### Upstream Credits & Inspirations

- [pingdotgg/t3code](https://github.com/pingdotgg/t3code): Read-only upstream runtime, provider service, and server core.
- [yetone/magpie](https://github.com/yetone/magpie): Inspiration for passphrase-sealed AEAD sync, `If-Match` optimistic locking, 60-second stall watchdogs, and portable mode.
- [stablyai/orca](https://github.com/stablyai/orca): Inspiration for server-side persistent PTY ring buffers and worktree state trees.
- [Amp](https://ampcode.com/): Inspiration for `/handoff` distillation and `agent / oracle / review` dial workflows.
- [FISH-Dock](https://github.com/Fish-under-sea/FISH-Dock): Reference for the Warm Paper / Dark Olive stereomorphic README design system, 360° Fresnel liquid-glass theme hooks, and Dynamic Island approval bridging.

### License Boundary

Prismux core source code and README layout tooling are licensed under the **MIT License** (see [`LICENSE`](LICENSE)); the bundled pixel font `Jersey20-Regular.ttf` is licensed under [SIL Open Font License 1.1](assets/readme/OFL-Jersey20.txt); the read-only submodule `vendor/t3code` retains its upstream license and notices.

<p align="center"><sub>Prismux · 24/7 Agent-Agnostic Super Workbench · 0-Token Visual Layer · 4 Official Optional Plugins</sub></p>
