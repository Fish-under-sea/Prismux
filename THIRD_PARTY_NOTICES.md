# Third-Party Notices & Open-Source Attributions

Prismux's first-party source code is distributed under the **MIT License** (see [`LICENSE`](./LICENSE)). This repository incorporates, adapts, and depends on third-party open-source and proprietary software. We gratefully acknowledge all upstream projects and core dependencies, preserving their original licenses, copyright notices, and Apache-2.0 `NOTICE` attributions.

---

## Proprietary Third-Party Component Carve-Out

> [!IMPORTANT]
> **The root MIT [`LICENSE`](./LICENSE) applies solely to first-party Prismux source code.** It does **not** grant MIT or open-source rights to the proprietary third-party component listed below.

### `@anthropic-ai/claude-agent-sdk` (Proprietary — Anthropic PBC)

- **Package**: `@anthropic-ai/claude-agent-sdk@0.3.321` (declared in `apps/server/package.json`)
- **License**: Proprietary (`LicenseRef-Anthropic-Proprietary`, `All rights reserved`)
- **Legal & Compliance Terms**: <https://code.claude.com/docs/en/legal-and-compliance>
- **Upstream Repository**: <https://github.com/anthropics/claude-agent-sdk-typescript>
- **Packaging Note**: Optional platform CLI binaries (`@anthropic-ai/claude-agent-sdk-*`) are excluded from desktop artifacts; users supply their own officially installed local `claude` CLI.
- **Verbatim Upstream Notice** (`LICENSE.md`):

```text
© Anthropic PBC. All rights reserved. Use is subject to the Legal Agreements outlined here: https://code.claude.com/docs/en/legal-and-compliance.
```

---

## 1. Historical & Architectural Upstream Foundations

### `pingdotgg/t3code` (T3 Code — MIT License)

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

### `shigma/cordis` (Cordis — MIT License)

- **Upstream Repository**: <https://github.com/shigma/cordis>
- **License**: MIT License
- **Scope**: Architectural foundation and design inspiration for `@prismux/cordis-kernel` (`packages/cordis-kernel`), including reversible hierarchical plugin contexts, scoped `ctx.effect()` disposers, and zero-residue plugin teardown across daemon and UI realms.

```text
MIT License

Copyright (c) Shigma and Cordis contributors

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
| **[SQLite](https://www.sqlite.org/) & [`sqlite-vec`](https://github.com/asg017/sqlite-vec)** (`vec0.dll` / `vec0.so` / `vec0.dylib` `0.1.9`) | Public Domain / `MIT OR Apache-2.0` | Single-file local persistence (`state.sqlite`) and hybrid FTS5 + vector memory engine (`~/.prismux/data/memory.db`) |
| **[`node-pty`](https://github.com/microsoft/node-pty)** | MIT | Cross-platform native pseudo-terminal hosting for `PersistentPtyPool` and integrated terminals |
| **[`xterm.js` / Ghostty WASM](https://xtermjs.org/)** (`ghostty-vt.wasm`, `ghostty-write-pty.wasm`) | MIT | Integrated terminal emulation and rendering (`native/libghostty-vt/LICENSE`) |
| **[KaTeX](https://katex.org/)** | MIT & SIL OFL-1.1 | Fast client-side LaTeX math rendering and bundled math fonts |
| **[Zustand](https://zustand-demo.pmnd.rs/)** | MIT | Lightweight client state management |
| **[`lucide-react`](https://lucide.dev/)** | ISC | Crisp vector iconography across the desktop workbench |
| **[`@dnd-kit`](https://dndkit.com/)** | MIT | Drag-and-drop sorting for providers, models, and workspace panes |
| **[`@noble/hashes` & `@noble/curves`](https://paulmillr.com/noble/)** | MIT | Audited pure-JS cryptographic primitives |
| **[`marked` / `unified` / `remark` / `rehype`](https://unifiedjs.com/)** | MIT | Safe Markdown parsing, sanitization, and rendering |
| **[`@pierre/{diffs,words,trees,highlights,patches,theme,theming}`](https://github.com/pierrecomputer/pierre)** | Apache-2.0 (with `NOTICE.md`, see Section 4) | High-performance diffing, word/math layout, file tree, syntax highlighting, patching, and themes |
| **[`jszip`](https://github.com/Stuk/jszip)** (`3.10.1`) | MIT (elected over `GPL-3.0-or-later`) | ZIP archive reading/writing in the web workbench |
| **[`dompurify`](https://github.com/cure53/DOMPurify)** (`3.5.0`) | Apache-2.0 (elected over `MPL-2.0`) | HTML/SVG sanitization in the web workbench |
| **[`oxlint` / Oxc](https://oxc.rs/)** | MIT | Fast static analysis and custom `oxlint-plugin-prismux` workspace lint rules |
| **[`7za.exe` / `7z.dll` (7-Zip 24.09)](https://www.7-zip.org/)** | GNU LGPL-2.1+ with unRAR restriction, BSD-3-Clause & BSD-2-Clause | Release archive integrity verification and split-volume decompression (see Section 5) |
| **[Jersey 20 Font](https://fonts.google.com/specimen/Jersey+20)** (`assets/readme/OFL-Jersey20.txt`) | SIL OFL-1.1 | Pixel display typography used in README visual headers |
| **[`@anthropic-ai/claude-agent-sdk`](https://github.com/anthropics/claude-agent-sdk-typescript)** (`0.3.321`) | Proprietary (`All rights reserved`) | Claude Agent SDK bridge (see Proprietary Carve-Out above) |

---

## 4. Apache-2.0 Upstream `NOTICE.md` Attributions (`@pierre/*`)

In compliance with Apache License 2.0 Section 4(d), Prismux preserves the following upstream `NOTICE.md` attributions from the bundled `@pierre/*` packages (`https://github.com/pierrecomputer/pierre`):

### `@pierre/words@0.2.2-t3.4` (Apache-2.0)

- **Vendored Archive**: `apps/web/deps/pierre-words-0.2.2-t3.4-7c04b7f1.tgz` (fork of `pierrecomputer/pierre@b049b9e`, commit `7c04b7f185a34ab3fd80aec53e7e6b9fb780619d`)
- **Upstream `NOTICE.md`**:
  - `@pierre/words` is licensed under Apache 2.0. The material below keeps its original license:
    - **HTML named character references** (`tables/entities.txt`, `dist/words.wasm`): [WHATWG HTML `entities.json`](https://html.spec.whatwg.org/entities.json) — [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
    - **East Asian Width ranges** (`scripts/build.ts`, `dist/words.wasm`): [Unicode `EastAsianWidth.txt`](https://www.unicode.org/Public/UCD/latest/ucd/) — [Unicode License v3](https://www.unicode.org/license.txt)
    - **Math glyph metrics and constants** (`tables/math-metrics.txt`, `src/math.wat`, `dist/words.wasm`): [STIX Two Math](https://github.com/stipub/stixfonts) — [SIL Open Font License 1.1](https://openfontlicense.org)

### `@pierre/trees@1.0.0-beta.6` (Apache-2.0)

- **Upstream `NOTICE.md`**:
  - This project includes code derived from [`@headless-tree/core`](https://github.com/lukasbach/headless-tree).
  - Original license for `headless-tree/core`: **MIT License**, `Copyright (c) 2023 Lukas Bach`.

```text
MIT License

Copyright (c) 2023 Lukas Bach

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### `@pierre/highlights@0.5.1` (Apache-2.0)

- **Upstream `NOTICE.md`**:
  - Community themes are pruned copies of pinned Zed theme files (`zed-industries/extensions` at `ab756766c27fca3de3d275149f6937105f464dec`, Zed defaults at `ce48461`, VS Code dark terminal palette at `3623f17`, Pierre Zed palettes at `861ce3c`) or conversions of pinned Shiki TextMate themes (`tm-themes@1.12.10`). The Zed registry's `aurora-theme` is an MIT-licensed substitute (no GPL-3.0 themes bundled).
  - **Retained MIT Theme Copyrights**:
    - Andromeda: Copyright (c) 2017 `<eliverlara@gmail.com>`; Zed port Copyright (c) 2025 Andrey L.
    - Aurora: Copyright (c) 2026 Raj Joshi
    - Ayu: Copyright (c) 2016 Ike Ku
    - Catppuccin: Copyright (c) 2021 Catppuccin
    - Dracula: Copyright (c) 2016 Dracula Theme; Zed port Copyright (c) 2023 Dracula Theme
    - Everforest: Copyright (c) 2020 sainnhe; Zed port Copyright (c) 2025 Albert Skonieczny
    - GitHub Classic / GitHub Theme: Copyright (c) 2020 Primer; Zed ports Copyright (c) 2021 Catppuccin, Copyright (c) 2025 Pyae Sone Aung
    - Gruvbox: Original palette by Pavel Pertsev (Zed MIT theme)
    - Horizon: Copyright (c) 2018 Jonathan Olaleye; Zed port Copyright (c) 2024 Ayyan
    - Houston: Copyright (c) 2022 The Astro Technology Company; Copyright (c) 2026 `github.com/rudolfjs`
    - Kanagawa: Copyright (c) 2021 Tommaso Laurenzi; Zed port Copyright (c) 2024 Ethan Gilmore
    - LaserWave: Copyright (c) 2019 Jared Jones
    - Min: Copyright (c) 2018-2021 Miguel Solorio; Zed port Copyright (c) 2024 Phillip
    - Night Owl: Copyright (c) 2018 Sarah Drasner
    - Nord: Copyright (c) 2016-present Sven Greb; Zed port Copyright (c) 2025 Sergei Metlenkin
    - One Dark Pro: Copyright (c) 2013-2022 Binaryify; Zed port Copyright (c) 2025 `/devs/hadez`
    - One Light: Copyright (c) 2015 Mahmoud Ali; Zed port Copyright (c) 2026 Alex
    - Plastic: Copyright (c) 2017-present Will Stone; Zed port Copyright (c) 2026 Ibnuh
    - Poimandres: Copyright (c) 2023 drcmda
    - Rosé Pine: Copyright (c) Rosé Pine
    - Slack: Copyright (c) 2017 Felipe Mendes
    - Snazzy Light: Copyright (c) 2020 Florian Reuschel; Zed port Copyright (c) 2026 Christophe TES
    - Synthwave84: Copyright (c) 2019 Robb Owen; Zed port Copyright (c) 2025 DROO
    - TextMate theme collection (`tm-themes`): Copyright (c) 2021 Pine Wu; Copyright (c) 2023 Anthony Fu
    - Tokyo Night: Copyright (c) 2018-present Enkia; Zed port Copyright (c) 2024 Austin Saunders
    - Vesper: Copyright (c) 2023 Rauno Freiberg; Zed port Copyright (c) 2024 Igor Bedesqui
    - Vitesse: Copyright (c) 2020 Primer; Copyright (c) 2021 Anthony Fu; Zed port Copyright (c) 2024 Colin Lienard
    - VS Code Classics: Copyright (c) 2015-present Microsoft Corporation; Zed port Copyright (c) 2026 alanisme
  - **Retained Apache-2.0 Theme Copyrights**:
    - Material themes: `Copyright 2017 Mattia Astorino` (Apache-2.0). `github-dark-default` (Apache-2.0, derived from GitHub/Primer MIT).

### `@pierre/patches@0.0.1` (Apache-2.0)

- **Upstream `NOTICE.md`**:
  - Includes code ported from [`jsdiff`](https://github.com/kpdecker/jsdiff) (Myers diff, tokenizers, and patch format).
  - Original license for `jsdiff`: **BSD 3-Clause License**, `Copyright (c) 2009-2015, Kevin Decker <kpdecker@gmail.com>`.

```text
BSD 3-Clause License

Copyright (c) 2009-2015, Kevin Decker <kpdecker@gmail.com>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### `@pierre/theme@2.0.0` (Apache-2.0)

- **Upstream `NOTICE.md`**:
  - Built on top of [`primer/github-vscode-theme`](https://github.com/primer/github-vscode-theme).
  - Original license for `primer/github-vscode-theme`: **MIT License**, `Copyright (c) 2020 Primer`.

```text
MIT License

Copyright (c) 2020 Primer

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

---

## 5. Bundled Native Binaries & Native Rust Helper Crates

### `7za.exe` / `7z.dll` — 7-Zip (`24.09`, Windows Desktop Packaging)

- **Upstream Source Code**: <https://www.7-zip.org/>
- **Copyright**: `7-Zip Copyright (C) 1999-2024 Igor Pavlov.` (unRAR code Copyright Alexander Roshal; LZFSE Copyright (c) 2015-2016 Apple Inc.; ZSTD Copyright (c) Facebook, Inc.; XXH64 Copyright (c) 2012-2021 Yann Collet)
- **License**: **GNU LGPL-2.1-or-later** with **unRAR license restriction** (plus BSD-3-Clause for LZFSE/ZSTD and BSD-2-Clause for XXH64 in `7z.dll`).
- **unRAR Restriction**: The unRAR decompression sources may not be used to re-create the proprietary RAR compression algorithm or to develop a RAR (WinRAR) compatible archiver.
- **Distribution Compliance**: `7za.exe` is executed purely as a standalone out-of-process CLI utility (never statically linked). Its full license text and GNU LGPL-2.1 terms are tracked in [`scripts/licenses/7zip-LGPL-2.1.LICENSE`](./scripts/licenses/7zip-LGPL-2.1.LICENSE) and staged alongside `7za.exe` at `resources/tools/LICENSE-7zip-LGPL-2.1.txt` in Windows desktop artifacts. Complete upstream source code is available at <https://www.7-zip.org/>.

### `sqlite-vec` (`vec0.dll` / `vec0.so` / `vec0.dylib`, `0.1.9`)

- **Upstream Repository**: <https://github.com/asg017/sqlite-vec>
- **Copyright**: `Copyright (c) 2024 Alex Garcia`
- **License**: Dual-licensed under **`MIT OR Apache-2.0`**
- **Role**: Native SQLite vector search extension staged outside `app.asar` (`resources/native/sqlite-vec/vec0.dll`) for `~/.prismux/data/memory.db`.

### Native Rust Helper Crates (`native/*/Cargo.toml`)

Prismux ships three native Rust helper binaries (`native/resource-monitor/Cargo.toml`, `native/hyprland-snap-shot/Cargo.toml`, and `native/kde-snap-shot/Cargo.toml`). All direct crate dependencies are permissively licensed (zero GPL/LGPL/AGPL crates):

| Crate | Native Helper(s) | License |
| :--- | :--- | :--- |
| `sysinfo` (`0.39.3`) | `native/resource-monitor` | MIT |
| `zbus` (`5.19`) | `native/kde-snap-shot` | MIT |
| `wayland-client`, `wayland-backend`, `wayland-scanner`, `wayland-protocols`, `wayland-protocols-wlr` | `native/hyprland-snap-shot` | MIT |
| `smithay-client-toolkit` (`0.19.2`) | `native/hyprland-snap-shot` | MIT |
| `png` (`0.18`) | `native/hyprland-snap-shot`, `native/kde-snap-shot` | `MIT OR Apache-2.0` |
| `serde` (`1.0.228`) | `native/resource-monitor`, `native/hyprland-snap-shot`, `native/kde-snap-shot` | `MIT OR Apache-2.0` |
| `serde_json` (`1.0.150`) | `native/resource-monitor`, `native/hyprland-snap-shot`, `native/kde-snap-shot` | `MIT OR Apache-2.0` |
| `bitflags` (`2`), `async-channel` (`2`) | `native/hyprland-snap-shot`, `native/kde-snap-shot` | `MIT OR Apache-2.0` |
| `rustix` (`1`) | `native/hyprland-snap-shot` | `Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT` |

---

## 6. Explicit Dual-License Elections & Build-Only / Removed Copyleft Policy

- **`jszip@3.10.1`** (upstream dual license `MIT OR GPL-3.0-or-later`): Prismux explicitly elects the **MIT License** (not `GPL-3.0-or-later`).
- **`dompurify@3.5.0`** (upstream dual license `MPL-2.0 OR Apache-2.0`): Prismux explicitly elects the **Apache License 2.0** (not `MPL-2.0`).
- **`sharp@0.35.5`** (`@img/sharp-libvips-*`, `Apache-2.0 AND LGPL-3.0-or-later`): Strictly **build-script-only** in `scripts/package.json` for offline icon asset generation; never included in runtime dependencies or distributed desktop/server packages.
- **`heic-to`** (`libheif` WASM, `LGPL-3.0-or-later`): **Removed from runtime dependencies** (`P0-6`) to keep Prismux's runtime dependency graph free of LGPL/GPL copyleft packages.

---

## 7. Full Transitive License Inventory & Automated Compliance Gate

Exact dependency versions and resolved licenses across the unified Monorepo are tracked in `pnpm-lock.yaml` and `third-party-licenses.config.json`, synchronized via `scripts/sync-third-party-license-notices.ts`, verified during packaging via `scripts/lib/third-party-licenses.ts`, and continuously enforced by the automated license-blacklist gate in `scripts/__tests__/third-party-license-gate.test.ts`.
