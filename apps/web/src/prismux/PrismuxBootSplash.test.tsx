// @effect-diagnostics-next-line nodeBuiltinImport:off
import { readFileSync } from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  dismissPrismuxBootSplash,
  installPrismuxBootSplashLifecycle,
  PRISMUX_BOOT_CUBE_FACE_INDICES,
  PRISMUX_BOOT_LETTER_DELAYS_SEC,
  PRISMUX_BOOT_SPLASH_FADE_MS,
  PRISMUX_BOOT_SPLASH_ID,
  PRISMUX_BOOT_SPLASH_LETTERS,
  PRISMUX_BOOT_SPLASH_MIN_DURATION_MS,
  PrismuxBootSplashView,
  PrismuxLogoCubeSpinner,
  PrismuxPrismLoader,
  showPrismuxBootSplashPreview,
} from "./PrismuxBootSplash";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, "../..");

function createMockSplashDocument() {
  const nodesById = new Map<string, MockElement>();

  class MockClassList {
    private readonly classes = new Set<string>();
    add(name: string) {
      this.classes.add(name);
    }
    contains(name: string) {
      return this.classes.has(name);
    }
  }

  class MockElement {
    id = "";
    className = "";
    innerHTML = "";
    dataset: Record<string, string> = {};
    attributes = new Map<string, string>();
    classList = new MockClassList();
    children: MockElement[] = [];
    removed = false;

    setAttribute(name: string, value: string) {
      this.attributes.set(name, value);
    }
    getAttribute(name: string) {
      return this.attributes.get(name) ?? null;
    }
    addEventListener() {}
    appendChild(child: MockElement) {
      this.children.push(child);
      if (child.id) nodesById.set(child.id, child);
      return child;
    }
    remove() {
      this.removed = true;
      if (this.id && nodesById.get(this.id) === this) {
        nodesById.delete(this.id);
      }
      const idx = body.children.indexOf(this);
      if (idx >= 0) body.children.splice(idx, 1);
    }
  }

  const body = new MockElement();
  const doc = {
    body,
    createElement: () => new MockElement(),
    getElementById: (id: string) => nodesById.get(id) ?? null,
  };
  return { doc, body, nodesById, MockElement };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PrismuxBootSplash dual-element composition, MIT attribution & lifecycle", () => {
  it("preserves both dexter-st and AqFox MIT copyright headers across index.html, css, and tsx", () => {
    const files = [
      path.join(WEB_ROOT, "index.html"),
      path.join(__dirname, "prismux-boot-splash.css"),
      path.join(__dirname, "PrismuxBootSplash.tsx"),
    ];
    for (const filePath of files) {
      const content = readFileSync(filePath, "utf8");
      expect(content, `${path.basename(filePath)} missing dexter-st attribution`).toContain(
        "From Uiverse.io by dexter-st - https://uiverse.io/dexter-st/wicked-elephant-4",
      );
      expect(content, `${path.basename(filePath)} missing dexter-st MIT line`).toContain(
        "MIT License, Copyright (c) dexter-st",
      );
      expect(content, `${path.basename(filePath)} missing AqFox attribution`).toContain(
        "From Uiverse.io by AqFox - https://uiverse.io/AqFox/young-dragon-29",
      );
      expect(content, `${path.basename(filePath)} missing AqFox MIT line`).toContain(
        "MIT License, Copyright (c) AqFox (Aquilix)",
      );
    }
  });

  it("scopes all CSS classes and keyframes under pmx-boot-* with reduced-motion and grating masks", () => {
    const css = readFileSync(path.join(__dirname, "prismux-boot-splash.css"), "utf8");
    expect(css).toContain(".pmx-boot-loader-wrapper");
    expect(css).toContain(".pmx-boot-loader-beam");
    expect(css).toContain(".pmx-boot-loader-letter");
    expect(css).toContain(".pmx-boot-cube-corner");
    expect(css).toContain(".pmx-boot-cube");
    expect(css).toContain(".pmx-boot-cube-face");
    expect(css).toContain("@keyframes pmx-boot-transform");
    expect(css).toContain("@keyframes pmx-boot-opacity");
    expect(css).toContain("@keyframes pmx-boot-letter-anim");
    expect(css).toContain("@keyframes pmx-boot-cube-spin");
    // Ensures no unscoped `.spinner` or `.loader` global collision
    expect(css).not.toMatch(/(^|\s)\.spinner\b/);
    expect(css).not.toMatch(/(^|\s)\.loader\b/);
    // Preserves vertical grating mask with -webkit-mask for Electron/Chromium
    expect(css).toContain("-webkit-mask: repeating-linear-gradient");
    expect(css).toContain("mask: repeating-linear-gradient");
    // Preserves bottom-right corner placement & 3D cube spin angles + reduced motion
    expect(css).toContain("right: 40px;");
    expect(css).toContain("bottom: 36px;");
    expect(css).toContain("rotate(45deg) rotateX(-385deg) rotateY(385deg)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("renders pure-text center PrismuxPrismLoader with 7 staggered Prismux letters and beam", () => {
    const html = renderToStaticMarkup(<PrismuxPrismLoader />);
    expect(html).toContain('data-pmx-prism-loader="true"');
    expect(html).toContain('data-pmx-loader-beam="true"');
    // Pure text at center stage (no flat logo image next to the center letters)
    expect(html).not.toContain("<img");

    const letterMatches = [...html.matchAll(/data-pmx-loader-letter="([^"]+)"/g)].map((m) => m[1]);
    expect(letterMatches).toEqual([...PRISMUX_BOOT_SPLASH_LETTERS]);

    for (const delay of PRISMUX_BOOT_LETTER_DELAYS_SEC) {
      expect(html).toContain(`animation-delay:${delay}s`);
    }
  });

  it("renders 6-face 3D PrismuxLogoCubeSpinner with Prismux logo mapped on all 6 faces", () => {
    const html = renderToStaticMarkup(<PrismuxLogoCubeSpinner logoSrc="/prismux-logo.png" />);
    expect(html).toContain('data-pmx-logo-cube="true"');
    expect(html).toContain("--pmx-cube-size:44px");

    const faceMatches = [...html.matchAll(/data-pmx-cube-face="(\d+)"/g)].map((m) => Number(m[1]));
    expect(faceMatches).toEqual([...PRISMUX_BOOT_CUBE_FACE_INDICES]);

    const logoMatches = [...html.matchAll(/class="pmx-boot-cube-logo"[^>]*src="\/prismux-logo\.png"/g)];
    expect(logoMatches).toHaveLength(6);
  });

  it("composes center prism text loader and bottom-right 3D logo cube in PrismuxBootSplashView", () => {
    const html = renderToStaticMarkup(<PrismuxBootSplashView />);
    expect(html).toContain('data-pmx-boot-splash="true"');
    expect(html).toContain('data-pmx-prism-loader="true"');
    expect(html).toContain('data-pmx-boot-cube-corner="true"');
    expect(html).toContain('data-pmx-logo-cube="true"');
  });

  it("inlines zero-blocking #pmx-boot-splash in index.html with 7 letters and 6-face bottom-right cube", () => {
    const html = readFileSync(path.join(WEB_ROOT, "index.html"), "utf8");
    expect(html).toContain(`id="${PRISMUX_BOOT_SPLASH_ID}"`);
    expect(html).toContain("pmx-boot-loader-wrapper");
    expect(html).toContain("pmx-boot-loader-beam");
    expect(html).toContain("pmx-boot-cube-corner");
    expect(html).toContain("pmx-boot-cube");
    const faceCount = (html.match(/data-pmx-cube-face="/g) ?? []).length;
    expect(faceCount).toBe(6);
    const letterCount = (html.match(/data-pmx-loader-letter="/g) ?? []).length;
    expect(letterCount).toBe(7);
  });

  it("enforces minimum sweep time, smooth 380ms fade-out, DOM removal, and window.__prismuxShowBootSplash preview hook", async () => {
    vi.useFakeTimers();
    const { doc, nodesById, MockElement } = createMockSplashDocument();
    let now = 100;
    const win: Record<string, unknown> = {
      location: { protocol: "http:" },
      __pmxBootSplashStartedAt: 0,
      matchMedia: () => ({ matches: false }),
      requestAnimationFrame: (cb: () => void) => {
        cb();
        return 1;
      },
    };
    vi.stubGlobal("document", doc);
    vi.stubGlobal("window", win);
    vi.stubGlobal("performance", { now: () => now });

    // Seed an existing cold-start #pmx-boot-splash node (started at t=0, React ready at t=100)
    const initialSplash = new MockElement();
    initialSplash.id = PRISMUX_BOOT_SPLASH_ID;
    doc.body.appendChild(initialSplash);

    installPrismuxBootSplashLifecycle();
    expect(typeof win.__prismuxShowBootSplash).toBe("function");

    // Not yet leaving before minimum display duration (850ms - 100ms = 750ms remaining)
    vi.advanceTimersByTime(PRISMUX_BOOT_SPLASH_MIN_DURATION_MS - 150);
    expect(initialSplash.classList.contains("pmx-boot-splash-leaving")).toBe(false);
    expect(nodesById.has(PRISMUX_BOOT_SPLASH_ID)).toBe(true);

    // At 850ms elapsed, fade-out begins
    vi.advanceTimersByTime(150);
    expect(initialSplash.classList.contains("pmx-boot-splash-leaving")).toBe(true);
    expect(initialSplash.dataset.pmxBootSplashState).toBe("leaving");
    expect(nodesById.has(PRISMUX_BOOT_SPLASH_ID)).toBe(true);

    // After 380ms fade-out, DOM node is completely removed (zero residue)
    vi.advanceTimersByTime(PRISMUX_BOOT_SPLASH_FADE_MS);
    expect(nodesById.has(PRISMUX_BOOT_SPLASH_ID)).toBe(false);
    expect(initialSplash.removed).toBe(true);

    // Replay preview hook mounts a fresh #pmx-boot-splash and auto-removes cleanly
    now = 2000;
    const dispose = showPrismuxBootSplashPreview(600);
    const previewNode = doc.getElementById(PRISMUX_BOOT_SPLASH_ID);
    expect(previewNode).not.toBeNull();
    expect(previewNode?.innerHTML).toContain('data-pmx-prism-loader="true"');
    expect(previewNode?.innerHTML).toContain('data-pmx-cube-face="6"');

    vi.advanceTimersByTime(600);
    expect(previewNode?.classList.contains("pmx-boot-splash-leaving")).toBe(true);
    vi.advanceTimersByTime(PRISMUX_BOOT_SPLASH_FADE_MS);
    expect(doc.getElementById(PRISMUX_BOOT_SPLASH_ID)).toBeNull();

    // Holding preview (durationMs=0) can be dismissed immediately via returned handle or dismiss API
    showPrismuxBootSplashPreview(0);
    expect(doc.getElementById(PRISMUX_BOOT_SPLASH_ID)).not.toBeNull();
    dispose();
    await dismissPrismuxBootSplash({ immediate: true });
    expect(doc.getElementById(PRISMUX_BOOT_SPLASH_ID)).toBeNull();
  });
});
