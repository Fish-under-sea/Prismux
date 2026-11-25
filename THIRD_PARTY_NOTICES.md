# Third-Party Notices & Open-Source Attributions

Prismux is distributed under the **MIT License** (see [`LICENSE`](./LICENSE)). This repository incorporates, adapts, and depends on open-source software created by the community. We gratefully acknowledge the following upstream projects and core dependencies, preserving their original licenses and copyright notices.

---

## 1. Historical Upstream Foundation

### `pingdotgg/t3code` (MIT License)

- **Upstream Repository**: <https://github.com/pingdotgg/t3code>
- **License**: MIT License
- **Historical Baseline Commit**: `b23f1e8af9b13af2c4aa1ba8e0d6987550688645` (archived reference lock in [`docs/archive/UPSTREAM_LOCK.json`](./docs/archive/UPSTREAM_LOCK.json))
- **Scope**: Prismux's Electron desktop host (`apps/desktop`), core orchestration server (`apps/server`), React web workbench (`apps/web`), native Rust resource monitor (`native/resource-monitor`), and shared provider/VCS packages originated from a managed fork of `pingdotgg/t3code` and have since been consolidated into the unified first-party `@prismux/*` Monorepo with extensive independent architecture, visual, compliance, memory, plugin, and sync systems.

```text
MIT License

Copyright (c) Ping Labs / t3code contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 2. Design & Reference Open-Source Projects

- **[stablyai/orca](https://github.com/stablyai/orca) (MIT License)** — Reference inspiration for the compact workspace sidebar, Split Anything arbitrary pane layout, port/resource monitoring, ultra-compact status bar, multi-window quota bar, and declarative plugin UI patterns.
- **[can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) (MIT License)** — Reference inspiration for prompt-cache-friendly memory recall and scoped cache architecture.
- **`dsh-better-reasoning-effort-fish` ([HanaAyane/dsh-reasoning-effort](https://github.com/HanaAyane/dsh-reasoning-effort) / [HaoyueQin/dsh-better-reasoning-effort](https://github.com/HaoyueQin/dsh-better-reasoning-effort), MIT License) & DeepSeek Harness (`dsh`)** — Reference and assets for the model-recognizing animated reasoning effort slider and thinking / tool-call work-step presentation.
- **[yetone/magpie](https://github.com/yetone/magpie)** — Architectural inspiration for passphrase-sealed AEAD synchronization, `If-Match` optimistic locking, stall watchdogs, and portable mode.
- **[FISH-Dock](https://github.com/Fish-under-sea/FISH-Dock)** — Reference for the 1:1 optical Celestial tri-state capsule, 360° Fresnel liquid-glass theme tokens, Warm Paper / Dark Olive documentation visuals, and Dynamic Island approval bridge.

---

## 3. Core Runtime, UI, Storage & Build Dependencies

| Project | License | Role in Prismux |
| :--- | :--- | :--- |
| **[Electron](https://www.electronjs.org/)** (`electron` 44) | MIT | Cross-platform desktop shell, native windowing, IPC, preload bridge, and GPU compositing |
| **[Effect](https://effect.website/)** (`effect`, `@effect/*`) | MIT | Structured concurrency, typed errors, dependency injection (`ServiceMap` / `Layer`), Schema validation, and platform abstractions |
| **[Vite / Vite+](https://vite.dev/)** (`vite-plus`, `@voidzero-dev/vite-plus-core`) | MIT | Unified monorepo build, dev server, formatting, Oxlint linting, and test execution (`vp`) |
| **[React & React DOM](https://react.dev/)** (`react`, `react-dom` 19) | MIT | Desktop web workbench and appearance/wallpaper UI rendering |
| **[TanStack](https://tanstack.com/)** (`@tanstack/react-router`, `@tanstack/react-query`, `@tanstack/react-pacer`, `@tanstack/react-virtual`) | MIT | Type-safe routing, query caching, pacing, and virtualized timelines |
| **[Tailwind CSS](https://tailwindcss.com/)** (`tailwindcss` v4) | MIT | Utility-first styling bridged with Prismux 8-zone Liquid Glass tokens |
| **[SQLite](https://www.sqlite.org/) & [`sqlite-vec`](https://github.com/asg017/sqlite-vec)** | Public Domain / MIT & Apache-2.0 | Single-file local persistence (`state.sqlite`) and hybrid FTS5 + vector memory engine (`~/.prismux/data/memory.db`) |
| **[`node-pty`](https://github.com/microsoft/node-pty)** | MIT | Cross-platform native pseudo-terminal hosting for `PersistentPtyPool` and integrated terminals |
| **[`xterm.js` / Ghostty WASM](https://xtermjs.org/)** | MIT | Integrated terminal emulation and rendering |
| **[KaTeX](https://katex.org/)** | MIT | Fast client-side LaTeX math rendering |
| **[Zustand](https://zustand-demo.pmnd.rs/)** | MIT | Lightweight client state management |
| **[`lucide-react`](https://lucide.dev/)** | ISC | Crisp vector iconography across the desktop workbench |
| **[`@dnd-kit`](https://dndkit.com/)** | MIT | Drag-and-drop sorting for providers, models, and workspace panes |
| **[`@noble/hashes` & `@noble/curves`](https://paulmillr.com/noble/)** | MIT | Audited pure-JS cryptographic primitives |
| **[`marked` / `unified` / `remark` / `rehype`](https://unifiedjs.com/)** | MIT | Safe Markdown parsing, sanitization, and rendering |
| **[`@pierre/diffs` & `@pierre/highlights`](https://github.com/pierrecomputer/pierre)** | MIT | High-performance diff and syntax highlighting |
| **[`oxlint` / Oxc](https://oxc.rs/)** | MIT | Fast static analysis and custom `oxlint-plugin-prismux` workspace lint rules |
| **[`7za` (7-Zip)](https://www.7-zip.org/)** | LGPL-2.1+ | Release archive integrity verification and split-volume decompression |
| **[Jersey 20 Font](https://fonts.google.com/specimen/Jersey+20)** (`assets/readme/OFL-Jersey20.txt`) | SIL OFL-1.1 | Pixel display typography used in README visual headers |

---

## 4. Full Transitive License Inventory

Exact dependency versions and resolved licenses across the unified Monorepo are tracked in `pnpm-lock.yaml` and verified during desktop packaging via `scripts/lib/third-party-licenses.ts`.
