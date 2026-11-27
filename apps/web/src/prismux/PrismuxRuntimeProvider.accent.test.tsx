// @effect-diagnostics-next-line nodeBuiltinImport:off -- Unit test reads local CSS stylesheet source directly.
import * as NodeFS from "node:fs";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Unit test resolves stylesheet path relative to test file.
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import {
  InlineAppearanceStudio,
  ThemePaletteCard,
  applyPrismuxAppearanceToDocument,
  contrastRatioHex,
  normalizeAppearanceConfig,
  resolveReadableAccentText,
  selectHighContrastInk,
  type DocumentLike,
} from "@prismux/appearance";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import providerSrc from "./PrismuxRuntimeProvider.tsx?raw";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const indexCss = NodeFS.readFileSync(NodePath.resolve(here, "../index.css"), "utf8");

function createMockRootDocument() {
  const attrs = new Map<string, string>();
  const classes = new Set<string>();
  const styles = new Map<string, string>();

  const makeEl = () => ({
    attrs,
    classes,
    styles,
    style: {
      setProperty(name: string, value: string) {
        styles.set(name, value);
      },
      removeProperty(name: string) {
        styles.delete(name);
      },
    },
    classList: {
      toggle(token: string, force?: boolean) {
        const next = force ?? !classes.has(token);
        if (next) classes.add(token);
        else classes.delete(token);
        return next;
      },
      remove(...tokens: string[]) {
        for (const t of tokens) classes.delete(t);
      },
    },
    setAttribute(name: string, value: string) {
      attrs.set(name, value);
    },
    removeAttribute(name: string) {
      attrs.delete(name);
    },
  });

  const html = makeEl();
  const body = makeEl();
  const doc: DocumentLike = { documentElement: html, body };
  return { doc, html, body };
}

describe("apps/web Light, Dark & Glass accent color cascade and runtime synchronization", () => {
  it("index.css delegates --primary, --primary-foreground, --ring, --sidebar-primary and --update-foreground to --pmx-accent tokens while preserving __preview", () => {
    expect(indexCss).toMatch(/--primary:\s*var\(--pmx-accent,\s*oklch\(/);
    expect(indexCss).toMatch(/--primary-foreground:\s*var\(--pmx-accent-ink,\s*var\(--color-white\)\)/);
    expect(indexCss).toMatch(/--ring:\s*var\(--pmx-accent,\s*var\(--primary\)\)/);
    expect(indexCss).toMatch(/--sidebar-primary:\s*var\(--primary\)/);
    expect(indexCss).toMatch(/--sidebar-primary-foreground:\s*var\(--primary-foreground\)/);
    expect(indexCss).toMatch(/--sidebar-ring:\s*var\(--ring\)/);
    expect(indexCss).toMatch(/--update-foreground:\s*var\(--pmx-accent-text,\s*var\(--color-blue-400\)\)/);

    // Theme editor live preview retains precedence over inline accent overrides
    expect(indexCss).toMatch(
      /html\[data-theme-id="__preview"\]\s*\{[^}]*--primary:\s*var\(--app-theme-message-action\)\s*!important;[^}]*--primary-foreground:\s*var\(--app-theme-message-action-foreground\)\s*!important;[^}]*--ring:\s*var\(--app-theme-focus\)\s*!important;/s,
    );
  });

  it("PrismuxRuntimeProvider subscribes to rendered appearance changes to prevent useTheme/applyThemePalette from clobbering inline accent tokens", () => {
    expect(providerSrc).toContain("subscribeRenderedAppearance");
    expect(providerSrc).toMatch(/subscribeRenderedAppearance\s*\(/);
  });

  it("propagates custom, bright, dark, and default accents across light, dark, and glass modes with WCAG >= 4.5:1 foreground & text contrast", () => {
    const { doc, html } = createMockRootDocument();

    const cases = [
      { themeMode: "light" as const, accentMode: "custom" as const, accent: "#10b981", expectGlass: "0", isDark: false },
      { themeMode: "dark" as const, accentMode: "custom" as const, accent: "#f472b6", expectGlass: "0", isDark: true },
      { themeMode: "light" as const, accentMode: "custom" as const, accent: "#facc15", expectGlass: "0", isDark: false },
      { themeMode: "dark" as const, accentMode: "custom" as const, accent: "#0d1524", expectGlass: "0", isDark: true },
      { themeMode: "glass" as const, accentMode: "custom" as const, accent: "#8b5cf6", expectGlass: "1", isDark: true },
      { themeMode: "light" as const, accentMode: "system" as const, accent: "", expectGlass: "0", isDark: false },
      { themeMode: "dark" as const, accentMode: "system" as const, accent: "", expectGlass: "0", isDark: true },
    ];

    for (const tc of cases) {
      // Simulate themePalette.ts writing stale default inline context-chip colors before appearance sync
      html.styles.set("--context-chip-mention", "#2563eb");
      html.styles.set("--context-chip-file", "#2563eb");
      html.styles.set("--context-chip-citation", "#2563eb");

      const cfg = normalizeAppearanceConfig({
        themeMode: tc.themeMode,
        glassBasePolarity: tc.isDark ? "dark" : "light",
        accentMode: tc.accentMode,
        accent: tc.accent,
      });

      const rt = applyPrismuxAppearanceToDocument(cfg, {
        document: doc,
        wallpaperActive: false,
        reducedTransparency: false,
      });

      const expectedAccent = tc.accent || (tc.isDark ? "#5e9bff" : "#005fb8");
      const expectedInk = selectHighContrastInk(expectedAccent);
      const expectedText = resolveReadableAccentText(expectedAccent, tc.isDark);

      expect(html.attrs.get("data-pmx-glass")).toBe(tc.expectGlass);
      expect(html.attrs.get("data-pmx-theme")).toBe(tc.isDark ? "dark" : "light");
      expect(rt.accent).toBe(expectedAccent);

      expect(html.styles.get("--pmx-accent")).toBe(expectedAccent);
      expect(html.styles.get("--pmx-accent-ink")).toBe(expectedInk);
      expect(html.styles.get("--pmx-accent-text")).toBe(expectedText);
      expect(html.styles.get("--primary")).toBe(expectedAccent);
      expect(html.styles.get("--primary-foreground")).toBe(expectedInk);
      expect(html.styles.get("--ring")).toBe(expectedAccent);
      expect(html.styles.get("--sidebar-primary")).toBe(expectedAccent);
      expect(html.styles.get("--sidebar-primary-foreground")).toBe(expectedInk);
      expect(html.styles.get("--sidebar-ring")).toBe(expectedAccent);
      expect(html.styles.get("--message-action")).toBe(expectedAccent);
      expect(html.styles.get("--message-action-foreground")).toBe(expectedInk);

      // Context chips must follow readable accent text rather than stale default blue
      expect(html.styles.get("--context-chip-mention")).toBe(expectedText);
      expect(html.styles.get("--context-chip-file")).toBe(expectedText);
      expect(html.styles.get("--context-chip-citation")).toBe(expectedText);

      // WCAG >= 4.5:1 checks
      expect(contrastRatioHex(expectedInk, expectedAccent)).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatioHex(expectedText, tc.isDark ? "#181a24" : "#f4f4f5"),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps InlineAppearanceStudio and ThemePaletteCard synchronized on the same accent value in light and dark modes", () => {
    for (const themeMode of ["light", "dark"] as const) {
      const sharedConfig = normalizeAppearanceConfig({
        themeMode,
        accentMode: "custom",
        accent: "#f59e0b",
      });
      const inlineMarkup = renderToStaticMarkup(
        createElement(InlineAppearanceStudio, {
          config: sharedConfig,
          onChange: () => {},
        }),
      );
      const settingsMarkup = renderToStaticMarkup(
        createElement(ThemePaletteCard, {
          config: sharedConfig,
          onChange: () => {},
          onOpenColorPicker: () => {},
        }),
      );

      expect(inlineMarkup).toContain("#f59e0b");
      expect(settingsMarkup).toContain("#f59e0b");
      expect(inlineMarkup).toContain('aria-label="选择强调色 琥珀橙"');
      expect(settingsMarkup).toContain("全局强调色");
    }
  });
});
