import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_APPEARANCE_CONFIG,
  GLASS_PRESETS,
  WB_THEME_FORMAT,
  WB_THEME_VERSION,
  type AppearanceConfig,
  type GlassRegionId,
} from '../types.js';
import {
  contrastRatioHex,
  hexToRgb,
  hsvToRgb,
  normalizeHex,
  rgbToHex,
  rgbToHsv,
  selectHighContrastInk,
} from '../colorUtils.js';
import {
  CELESTIAL_LED_ANGLES,
  applyRubberBand,
  computeCelestialPaintVars,
  createCelestialPhysicsState,
  ledColorForPosition,
  nearestThemeMode,
  projectReleaseMode,
  stepCelestialPhysics,
} from '../celestialPhysics.js';
import {
  applyGlassPreset,
  applyPrismuxAppearanceToDocument,
  clampSurfaceColorForContrast,
  clearPrismuxAppearanceFromDocument,
  computeWorstCaseGlassContrast,
  normalizeAppearanceConfig,
  setThemeModeWithGlassAutoWake,
  updateGlassRegion,
  type DocumentLike,
  type ElementLike,
} from '../glassEngine.js';
import {
  exportWbThemeSnapshot,
  importWbThemeSnapshot,
  serializeWbThemeSnapshot,
} from '../themeSnapshot.js';
import {
  DECLARATIVE_UI_NODE_TYPES,
  DeclarativeUiValidationError,
  assertJsonSafeProps,
  validateDeclarativePanelSpec,
  validateDeclarativeUiTree,
  type DeclarativeUiPanelSpec,
} from '../declarativeUiTypes.js';
import {
  DECLARATIVE_GLASS_CONTRAST_TOKENS,
  DEFAULT_DECLARATIVE_GESTURE_SETTLE_MS,
  DeclarativeGlassRenderer,
  createDeclarativeGestureTracker,
  nextDeclarativeTableRow,
  resolveDeclarativeRenderPlan,
} from '../DeclarativeGlassRenderer.js';
import {
  PrismuxReasoningEffortSlider,
  REASONING_MODEL_THEMES,
  REASONING_RUNNER_FRAME_COUNT,
  REASONING_RUNNER_SPRITES,
  detectReasoningModelFamily,
  drawReasoningRadiation,
  formatReasoningEffortLabel,
  formatReasoningEffortShortLabel,
  getEffortPresetForFamily,
  normalizeReasoningEffortOptions,
  resolveEffortStopIndex,
  resolveReasoningModelTheme,
  type ReasoningModelFamily,
} from '../reasoningEffort/index.js';

function createMockElement(): ElementLike & {
  attrs: Map<string, string>;
  styles: Map<string, string>;
  classes: Set<string>;
} {
  const attrs = new Map<string, string>();
  const styles = new Map<string, string>();
  const classes = new Set<string>();
  return {
    attrs,
    styles,
    classes,
    setAttribute(name: string, value: string) {
      attrs.set(name, value);
    },
    removeAttribute(name: string) {
      attrs.delete(name);
    },
    style: {
      setProperty(name: string, value: string) {
        styles.set(name, value);
      },
      removeProperty(name: string) {
        const prev = styles.get(name) ?? '';
        styles.delete(name);
        return prev;
      },
    },
    classList: {
      toggle(token: string, force?: boolean) {
        if (force === undefined) {
          if (classes.has(token)) {
            classes.delete(token);
            return false;
          }
          classes.add(token);
          return true;
        }
        if (force) {
          classes.add(token);
          return true;
        }
        classes.delete(token);
        return false;
      },
      remove(...tokens: string[]) {
        for (const t of tokens) classes.delete(t);
      },
    },
  };
}

describe('Color utilities & contrast luminance clamping', () => {
  it('roundtrips RGB <-> HSV <-> HEX cleanly', () => {
    const samples = ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#5e9bff', '#f59e0b'];
    for (const hex of samples) {
      const rgb = hexToRgb(hex);
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      const back = hsvToRgb(hsv.h, hsv.s, hsv.v);
      assert.equal(rgbToHex(back.r, back.g, back.b), hex);
    }
    assert.equal(normalizeHex('#abc', true), '#aabbcc');
    assert.equal(normalizeHex('5E9BFF', false), '#5e9bff');
    assert.equal(normalizeHex('not-a-color'), '');
  });

  it('guarantees >= 4.5:1 WCAG contrast on worst-case wallpaper at fidelity=100 for all colors & opacities', () => {
    const testColors = [
      '#000000',
      '#ffffff',
      '#ff0000',
      '#00ff00',
      '#0000ff',
      '#ffff00',
      '#00ffff',
      '#ff00ff',
      '#777777',
      '#8b5cf6',
      '#f59e0b',
      '#10b981',
      '#0d1524',
      '#f8fafc',
      '#f472b6',
    ];
    const testOps = [0, 12, 22, 38, 62, 100];

    for (const isDark of [false, true]) {
      for (const hex of testColors) {
        const clamped = clampSurfaceColorForContrast(hex, isDark, 100);
        for (const op of testOps) {
          const contrast = computeWorstCaseGlassContrast(clamped, isDark, 100, op);
          assert.ok(
            contrast >= 4.5,
            `Expected >= 4.5:1 for ${hex} -> ${clamped} (isDark=${isDark}, op=${op}), got ${contrast.toFixed(3)}`,
          );
        }
      }
    }
  });

  it('keeps already-readable stock colors untouched and interpolates monotonically with fidelity', () => {
    assert.equal(clampSurfaceColorForContrast('#ffffff', false, 100), '#ffffff');
    assert.equal(clampSurfaceColorForContrast('#0d1524', true, 100), '#0d1524');
    assert.equal(clampSurfaceColorForContrast('invalid', true, 100), '#0d1524');
    assert.equal(clampSurfaceColorForContrast('invalid', false, 100), '#ffffff');

    // Bright yellow in dark mode must clamp darker at fidelity=100, stay raw at fidelity=0, and stay strictly between at 50.
    const c100 = hexToRgb(clampSurfaceColorForContrast('#ffff00', true, 100));
    const c50 = hexToRgb(clampSurfaceColorForContrast('#ffff00', true, 50));
    const c0 = hexToRgb(clampSurfaceColorForContrast('#ffff00', true, 0));

    assert.equal(rgbToHex(c0.r, c0.g, c0.b), '#ffff00');
    assert.ok(c100.r < c50.r && c50.r < c0.r);
    assert.ok(c100.g < c50.g && c50.g < c0.g);
  });

  it('selectHighContrastInk guarantees >= 4.58:1 across full grayscale & accent spectrum', () => {
    for (let v = 0; v <= 255; v += 15) {
      const bg = rgbToHex(v, v, v);
      const ink = selectHighContrastInk(bg);
      assert.ok(contrastRatioHex(bg, ink) >= 4.58);
    }
    assert.equal(selectHighContrastInk('#005fb8'), '#ffffff');
    assert.equal(selectHighContrastInk('#facc15'), '#000000');
  });
});

describe('Celestial 3-state spring physics & settling', () => {
  it('interpolates light -> glass with underdamped overshoot, squash/stretch, LED arc & settles cleanly', () => {
    const state = createCelestialPhysicsState('light');
    state.targetMode = 'glass';
    state.kick = 0.22;

    let maxP = 0;
    let maxStretchX = 1;
    let settledAtStep = -1;

    for (let step = 1; step <= 240; step++) {
      const settled = stepCelestialPhysics(state, 1 / 60, false);
      const vars = computeCelestialPaintVars(state);
      if (state.p > maxP) maxP = state.p;
      if (vars.sx > maxStretchX) maxStretchX = vars.sx;
      if (settled) {
        settledAtStep = step;
        break;
      }
    }

    assert.ok(settledAtStep > 10 && settledAtStep < 240, `Expected settling within 4s, got step ${settledAtStep}`);
    assert.ok(maxP > 1.0, `Expected slight underdamped overshoot past 1.0, got ${maxP}`);
    assert.ok(maxStretchX > 1.02, `Expected velocity horizontal stretch, got ${maxStretchX}`);
    assert.equal(state.p, 1);
    assert.equal(state.v, 0);
    assert.equal(state.ledDeg, CELESTIAL_LED_ANGLES.glass);
    assert.equal(state.ledV, 0);
    assert.equal(state.kick, 0);

    const finalVars = computeCelestialPaintVars(state);
    assert.equal(finalVars.wLight, 0);
    assert.equal(finalVars.wDark, 0);
    assert.equal(finalVars.wGlass, 1);
    assert.equal(finalVars.ledColor, 'rgb(92, 212, 255)');
  });

  it('respects rubber-band damping, momentum release projection, LED color interpolation & reducedMotion', () => {
    assert.equal(applyRubberBand(0.5), 0.5);
    assert.ok(Math.abs(applyRubberBand(-0.5) - -0.11) < 1e-6);
    assert.ok(Math.abs(applyRubberBand(1.5) - 1.11) < 1e-6);

    assert.equal(nearestThemeMode(0.1), 'light');
    assert.equal(nearestThemeMode(0.5), 'dark');
    assert.equal(nearestThemeMode(0.9), 'glass');

    // Flicking right from light (p=0.12) with strong dragV=+2.5 projects to 0.12 + 0.35 = 0.47 -> 'dark'.
    assert.equal(projectReleaseMode(0.12, 2.5), 'dark');
    // Flicking right from dark (p=0.55) with dragV=+2.0 projects to 0.55 + 0.28 = 0.83 -> 'glass'.
    assert.equal(projectReleaseMode(0.55, 2.0), 'glass');

    assert.equal(ledColorForPosition(0), 'rgb(255, 174, 46)');
    assert.equal(ledColorForPosition(0.5), 'rgb(111, 134, 255)');
    assert.equal(ledColorForPosition(1), 'rgb(92, 212, 255)');

    // Reduced motion snaps immediately in a single step.
    const st = createCelestialPhysicsState('light');
    st.targetMode = 'dark';
    const settledImmediately = stepCelestialPhysics(st, 1 / 60, true);
    assert.equal(settledImmediately, true);
    assert.equal(st.p, 0.5);
    assert.equal(st.ledDeg, 180);
  });
});

describe('.wb-theme export, import & sanitization roundtrip', () => {
  it('roundtrips a fully customized AppearanceConfig without data loss', () => {
    const custom: AppearanceConfig = normalizeAppearanceConfig({
      themeMode: 'glass',
      glassBasePolarity: 'dark',
      accentMode: 'custom',
      accent: '#8b5cf6',
      glassPreset: 'custom',
      glassRegions: {
        surface: { op: 30, blur: 20 },
        card: { op: 18, blur: 14 },
        overlay: { op: 50, blur: 22 },
        control: { op: 24, blur: 10 },
      },
      glassColor: '#e2e8f0',
      glassDarkSeparate: true,
      glassDarkColor: '#111827',
      glassFidelity: 85,
      fresnelStrength: 90,
      wallpaperDim: 42,
      thinkingMode: 'glass',
      leftSidebarGlass: true,
      titlebarGlass: false,
      rightSidebarGlass: true,
      rightSidebarFullClear: true,
      perSurfaceOverrides: {
        leftSidebar: { mode: 'custom', op: 25, blur: 16 },
        conversation: { mode: 'custom', color: '#1e293b', fidelity: 90 },
      },
      sidebarCornerRadius: 20,
      sidebarSquareCorners: { tl: true, tr: false, br: false, bl: true },
      uiColorCustom: {
        enabled: true,
        send: '#38bdf8',
        link: '#60a5fa',
        fileIcon: '#c084fc',
        tab: '#f472b6',
        deepDiving: '#6cb6ff',
      },
      caretColor: '#38bdf8',
      typography: {
        light: { headingColor: '#0f172a', textColor: '#1e293b', mutedColor: '#475569' },
        dark: { headingColor: '#f8fafc', textColor: '#e2e8f0', mutedColor: '#94a3b8' },
        fontFamily: '"Inter", system-ui, sans-serif',
        codeFontFamily: '"JetBrains Mono", monospace',
        fontWeight: 500,
      },
    });

    const json = serializeWbThemeSnapshot(custom, {
      name: 'Prismux Aurora',
      author: 'Fish',
      description: 'Liquid glass preset',
      exportedAt: '2026-11-22T00:00:00.000Z',
    });

    const outcome = importWbThemeSnapshot(json);
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;

    assert.equal(outcome.strippedFields.length, 0);
    assert.equal(outcome.snapshot.format, WB_THEME_FORMAT);
    assert.equal(outcome.snapshot.version, WB_THEME_VERSION);
    assert.equal(outcome.snapshot.name, 'Prismux Aurora');
    assert.deepEqual(outcome.snapshot.appearance, custom);
  });

  it('strips local filesystem paths, credentials, and unknown fields during import & export', () => {
    const dirtyJson = JSON.stringify({
      format: WB_THEME_FORMAT,
      version: WB_THEME_VERSION,
      name: 'C:\\Users\\Fish\\secret-theme',
      author: 'ghp_1234567890abcdef1234567890abcdef',
      apiKey: 'sk-proj-supersecret123456',
      steamPath: 'D:\\SteamLibrary\\steamapps\\workshop\\content\\431960',
      appearance: {
        themeMode: 'glass',
        accent: '#38bdf8',
        wallpaperPath: 'C:\\Users\\Fish\\Pictures\\bg.png',
        token: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
        typography: {
          light: { headingColor: '#111111' },
          dark: { headingColor: '#ffffff' },
          fontFamily: 'C:\\Windows\\Fonts\\msyh.ttc',
          codeFontFamily: 'JetBrains Mono; background: url(file:///etc/passwd)',
        },
      },
    });

    const outcome = importWbThemeSnapshot(dirtyJson);
    assert.equal(outcome.ok, true);
    if (!outcome.ok) return;

    assert.ok(outcome.strippedFields.includes('apiKey'));
    assert.ok(outcome.strippedFields.includes('steamPath'));
    assert.ok(outcome.strippedFields.includes('appearance.wallpaperPath'));
    assert.ok(outcome.strippedFields.includes('appearance.token'));
    assert.ok(outcome.strippedFields.includes('appearance.typography.fontFamily'));
    assert.equal(outcome.snapshot.name, '导入的主题预设');
    assert.equal(outcome.snapshot.author, undefined);
    assert.equal(outcome.snapshot.appearance.themeMode, 'glass');
    assert.equal(outcome.snapshot.appearance.accent, '#38bdf8');
    assert.equal(outcome.snapshot.appearance.typography.fontFamily, '');
    assert.equal(outcome.snapshot.appearance.typography.codeFontFamily, '');

    // Export sanitizer also strips path-like metadata.
    const exported = exportWbThemeSnapshot(DEFAULT_APPEARANCE_CONFIG, {
      name: '/Users/admin/.ssh/id_rsa',
      author: 'sk-secretkeyvalue123456789',
    });
    assert.equal(exported.name, 'Prismux Theme');
    assert.equal(exported.author, undefined);
  });

  it('rejects malformed or unsupported theme payloads with clear errors', () => {
    assert.equal(importWbThemeSnapshot('').ok, false);
    assert.equal(importWbThemeSnapshot('{bad json').ok, false);
    assert.equal(importWbThemeSnapshot({ format: 'unknown.format', version: 1 }).ok, false);
    assert.equal(importWbThemeSnapshot({ format: WB_THEME_FORMAT, version: 99 }).ok, false);
    assert.equal(importWbThemeSnapshot({ foo: 'bar' }).ok, false);
  });
});

describe('Default/custom merge boundaries & document application', () => {
  it('clamps out-of-range numeric fields, handles preset transitions, and auto-wakes glass off -> balanced', () => {
    const merged = normalizeAppearanceConfig({
      themeMode: 'invalid' as unknown as AppearanceConfig['themeMode'],
      glassFidelity: 250,
      fresnelStrength: -20,
      glassRegions: {
        surface: { op: 140, blur: 88 },
        card: { op: -10, blur: -5 },
      },
      sidebarCornerRadius: 12,
      typography: {
        fontWeight: 999,
      },
    });

    assert.equal(merged.themeMode, DEFAULT_APPEARANCE_CONFIG.themeMode);
    assert.equal(merged.glassFidelity, 100);
    assert.equal(merged.fresnelStrength, 0);
    assert.deepEqual(merged.glassRegions.surface, { op: 100, blur: 40 });
    assert.deepEqual(merged.glassRegions.card, { op: 0, blur: 0 });
    assert.equal(merged.sidebarCornerRadius, 12);
    assert.equal(merged.typography.fontWeight, 700);

    // Preset off -> switching to glass auto-wakes balanced.
    const offGlass = applyGlassPreset({ ...DEFAULT_APPEARANCE_CONFIG, themeMode: 'dark' }, 'off');
    for (const id of ['surface', 'card', 'overlay', 'control'] as GlassRegionId[]) {
      assert.deepEqual(offGlass.glassRegions[id], GLASS_PRESETS.off[id]);
    }
    const woke = setThemeModeWithGlassAutoWake(offGlass, 'glass');
    assert.equal(woke.themeMode, 'glass');
    assert.equal(woke.glassPreset, 'balanced');
    assert.deepEqual(woke.glassRegions.surface, GLASS_PRESETS.balanced.surface);

    // Mutating a region flips preset to 'custom'.
    const tweaked = updateGlassRegion(woke, 'card', { op: 15 });
    assert.equal(tweaked.glassPreset, 'custom');
    assert.equal(tweaked.glassRegions.card.op, 15);
  });

  it('applies native fallback when glass is off, full glass/typography tokens when on, and clears cleanly', () => {
    const html = createMockElement();
    const body = createMockElement();
    const doc: DocumentLike = { documentElement: html, body };

    // 1. Dark native mode: glass gate MUST be '0' for 100% T3 Code native fallback.
    const nativeState = normalizeAppearanceConfig({
      themeMode: 'dark',
      typography: {
        light: { textColor: '#112233' },
        dark: { textColor: '' },
      },
    });
    const rtNative = applyPrismuxAppearanceToDocument(nativeState, {
      document: doc,
      systemAccent: '#0078d4',
    });

    assert.equal(rtNative.glassActive, false);
    assert.equal(html.attrs.get('data-pmx-theme'), 'dark');
    assert.equal(html.attrs.get('data-pmx-glass'), '0');
    assert.equal(html.attrs.get('data-pmx-sidebar-glass'), '0');
    assert.equal(html.attrs.get('data-pmx-titlebar-glass'), '0');
    assert.equal(html.attrs.get('data-pmx-thinking-mode'), 'off');
    // Light typography override must NOT leak into dark mode.
    assert.equal(html.attrs.has('data-pmx-custom-text'), false);
    assert.equal(html.styles.has('--pmx-text-color'), false);

    // 2. Glass mode with custom per-surface override, corners, dark typography & GPU=0 fallback.
    const glassState = normalizeAppearanceConfig({
      themeMode: 'glass',
      glassPreset: 'clear',
      glassRegions: GLASS_PRESETS.clear,
      glassColor: '#ffff00',
      glassFidelity: 100,
      thinkingMode: 'glass',
      leftSidebarGlass: true,
      titlebarGlass: true,
      rightSidebarGlass: true,
      rightSidebarFullClear: true,
      sidebarCornerRadius: 20,
      sidebarSquareCorners: { tl: true, tr: false, br: false, bl: true },
      perSurfaceOverrides: {
        leftSidebar: { mode: 'custom', op: 26, blur: 14 },
      },
      uiColorCustom: { enabled: true, send: '#38bdf8' },
      caretColor: '#f472b6',
      typography: {
        dark: { headingColor: '#ffffff', textColor: '#f1f5f9', mutedColor: '#94a3b8' },
        fontFamily: '"Inter", sans-serif',
        codeFontFamily: '"JetBrains Mono", monospace',
      },
    });

    const rtGlass = applyPrismuxAppearanceToDocument(glassState, {
      document: doc,
      gpuAvailable: false,
      wallpaperActive: true,
      syncT3DarkClass: true,
    });

    assert.equal(rtGlass.glassActive, true);
    assert.equal(html.attrs.get('data-pmx-glass'), '1');
    assert.equal(html.attrs.get('data-prismux-glass'), '1');
    assert.equal(html.attrs.get('data-pmx-gpu'), '0');
    assert.equal(html.attrs.get('data-prismux-gpu'), '0');
    assert.equal(html.attrs.get('data-pmx-wallpaper'), '1');
    assert.equal(html.attrs.get('data-pmx-wallpaper-visible'), '1');
    assert.equal(html.attrs.get('data-pmx-sidebar-glass'), '1');
    assert.equal(html.attrs.get('data-pmx-right-sidebar-fullclear'), '1');
    assert.equal(html.attrs.get('data-pmx-thinking-mode'), 'glass');
    assert.equal(html.attrs.get('data-pmx-corner-radius'), '20');
    assert.equal(html.attrs.get('data-pmx-corner-square'), 'tl bl');
    assert.equal(html.attrs.get('data-pmx-ui-colors'), '1');
    assert.equal(html.attrs.get('data-pmx-caret'), '1');
    assert.equal(html.attrs.get('data-pmx-custom-text'), '1');
    assert.equal(html.styles.get('--pmx-left-sidebar-fill'), '26%');
    assert.equal(html.styles.get('--pmx-left-sidebar-blur'), '14px');
    assert.equal(html.styles.get('--pmx-sidebar-radius'), '20px');
    assert.equal(html.styles.get('--pmx-ui-send'), '#38bdf8');
    assert.equal(html.styles.get('--pmx-caret-color'), '#f472b6');
    assert.equal(html.styles.get('--pmx-font-sans'), '"Inter", sans-serif');
    assert.equal(html.styles.get('--pmx-font-mono'), '"JetBrains Mono", monospace');
    assert.equal(html.classes.has('dark'), true);
    assert.equal(body.classes.has('pmx-glass'), true);
    // Clamped dark tint from #ffff00 must satisfy >= 4.5:1!
    assert.ok(computeWorstCaseGlassContrast(rtGlass.clampedDarkTint, true, 100, 0) >= 4.5);

    // 3. Clear removes every managed attribute, class, and CSS variable.
    clearPrismuxAppearanceFromDocument(doc);
    assert.equal(html.attrs.size, 0);
    assert.equal(body.attrs.size, 0);
    assert.equal(html.styles.size, 0);
    assert.equal(body.classes.size, 0);
  });
});

describe('T3 glass bridge CSS specificity & solid fallback invariants', () => {
  it('outranks T3 Code [data-theme-id] blocks for typography/UI overrides and reverts all glass surfaces to solid in all 3 fallbacks', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const cssPath = path.resolve(here, '../styles/t3-glass-bridge.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    // Balanced braces sanity check.
    const opens = (css.match(/\{/g) ?? []).length;
    const closes = (css.match(/\}/g) ?? []).length;
    assert.equal(opens, closes, 'CSS braces must be balanced');

    // Gap B: custom text, muted, fonts, and UI colors must match [data-theme-id]:not([data-theme-id='']).
    assert.match(css, /html\[data-pmx-custom-text='1'\]\[data-theme-id\]:not\(\[data-theme-id=''\]\)/);
    assert.match(css, /html\[data-pmx-custom-muted='1'\]\[data-theme-id\]:not\(\[data-theme-id=''\]\)/);
    assert.match(css, /html\[data-pmx-ui-colors='1'\]\[data-theme-id\]:not\(\[data-theme-id=''\]\)/);
    assert.match(css, /html\[data-pmx-custom-font-sans='1'\]\[data-theme-id\]:not\(\[data-theme-id=''\]\)/);
    assert.match(css, /html\[data-pmx-custom-font-mono='1'\]\[data-theme-id\]:not\(\[data-theme-id=''\]\)/);

    // Gap A: all 3 fallback sections must appear after section 7 marker and revert independent surfaces + canvas + sheen.
    const fallbackSection = css.slice(css.indexOf('/* ── 7. Three Mandatory Solid Fallbacks'));
    assert.ok(fallbackSection.length > 0);
    assert.match(fallbackSection, /@supports not \(\(backdrop-filter: blur\(1px\)\)/);
    assert.match(fallbackSection, /@media \(prefers-reduced-transparency: reduce\)/);
    assert.match(fallbackSection, /\[data-pmx-gpu='0'\]/);

    // Every fallback path must cover themed root, wallpaper canvas, left/right sidebars, titlebar, and remove sheen.
    assert.ok((fallbackSection.match(/\[data-theme-id\]:not\(\[data-theme-id=''\]\)/g) ?? []).length >= 3);
    assert.ok((fallbackSection.match(/--pmx-left-sidebar-bg:/g) ?? []).length >= 3);
    assert.ok((fallbackSection.match(/--pmx-titlebar-bg:/g) ?? []).length >= 3);
    assert.ok((fallbackSection.match(/--pmx-right-sidebar-bg:/g) ?? []).length >= 3);
    assert.ok((fallbackSection.match(/--message-surface:/g) ?? []).length >= 3);
    assert.ok((fallbackSection.match(/background-image:\s*none;/g) ?? []).length >= 12);
    assert.ok((fallbackSection.match(/\[data-pmx-wallpaper='1'\]/g) ?? []).length >= 6);
  });

  it('beats Tailwind v4 dark specificity, avoids double-compositing, clears Windows 6px seam, and protects color popover', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const bridgeCss = fs.readFileSync(path.resolve(here, '../styles/t3-glass-bridge.css'), 'utf8');
    const popoverCss = fs.readFileSync(path.resolve(here, '../styles/color-popover.css'), 'utf8');

    // Root token bridge must beat :root:is(.dark, .dark *) (0,2,0) via html.dark[data-pmx-glass='1'] (0,2,1).
    assert.match(bridgeCss, /html\.dark\[data-pmx-glass='1'\]/);
    assert.match(bridgeCss, /html:not\(\.dark\)\[data-pmx-glass='1'\]/);
    // Single-pass center canvas + transparent nested ChatView wrapper & unbroken sidebar (zero 256px tiling seam).
    assert.match(bridgeCss, /main\[data-slot='sidebar-inset'\]/);
    assert.match(bridgeCss, /--pmx-canvas-bg:/);
    assert.match(bridgeCss, /main\[data-slot='sidebar-inset'\]\s*>\s*\.bg-background/);
    assert.match(bridgeCss, /background-size:\s*100%\s*100%/);
    assert.match(bridgeCss, /background-repeat:\s*no-repeat/);
    assert.match(bridgeCss, /\[data-slot='sidebar-header'\]/);
    // Windows 6px right-edge seam elimination.
    assert.match(bridgeCss, /--desktop-window-right-resize-inset:\s*0px/);

    // FloatingColorPopover: isolation, 0.98 dark/light opacity, blur(24px), unclipped SV thumb.
    assert.match(popoverCss, /isolation:\s*isolate/);
    assert.match(popoverCss, /rgba\(18,\s*21,\s*32,\s*0\.98\)/);
    assert.match(popoverCss, /rgba\(253,\s*253,\s*255,\s*0\.98\)/);
    assert.match(popoverCss, /backdrop-filter:\s*blur\(24px\)\s*saturate\(1\.5\)/);
    assert.match(popoverCss, /\.cp-sv\s*\{[^}]*overflow:\s*visible/s);
    assert.match(popoverCss, /\.cp-sv-white\s*\{[^}]*border-radius:\s*inherit/s);

    // Issue #4: Non-glass Light & Dark wallpaper reveal (unblurred readability veil) + solid fallbacks.
    assert.match(
      bridgeCss,
      /html:is\(\[data-pmx-wallpaper='1'\],\s*\[data-pmx-wallpaper-visible='1'\]\)\[data-pmx-glass='0'\]:not/,
    );
    assert.match(bridgeCss, /--pmx-wallpaper-veil:\s*rgba\(10,\s*14,\s*22,/);
    assert.match(bridgeCss, /--pmx-wallpaper-veil:\s*rgba\(248,\s*250,\s*255,/);
    assert.match(bridgeCss, /--background:\s*var\(--pmx-wallpaper-veil\);/);
    assert.match(bridgeCss, /--app-chrome-background:\s*var\(--pmx-wallpaper-veil\);/);
    assert.match(bridgeCss, /\[data-chat-column\]\s*\.bg-background:not/);
    const fallbackSection = bridgeCss.slice(
      bridgeCss.indexOf('/* ── 7. Three Mandatory Solid Fallbacks'),
    );
    assert.match(fallbackSection, /--pmx-wallpaper-veil:\s*#000000;/);
    assert.match(fallbackSection, /--pmx-wallpaper-veil:\s*#ffffff;/);
    assert.match(fallbackSection, /--pmx-wallpaper-veil:\s*var\(--background\);/);
  });
});

describe('DeclarativeGlassRenderer (ui: "components") security, contrast, and 3-state tokens', () => {
  it('validates all 8 safe primitives and exports DeclarativeGlassRenderer cleanly', () => {
    assert.equal(typeof DeclarativeGlassRenderer, 'function');
    assert.deepEqual(DECLARATIVE_UI_NODE_TYPES, [
      'Stack',
      'Card',
      'Text',
      'Badge',
      'Button',
      'Switch',
      'Input',
      'Table',
    ]);

    const spec: DeclarativeUiPanelSpec = {
      ui: 'components',
      schemaVersion: 1,
      title: '插件声明式预览',
      atoms: [
        { key: 'syncOn', type: 'boolean', defaultValue: true },
        { key: 'host', type: 'string', defaultValue: 'https://demo.local' },
      ],
      actions: [{ id: 'demo:apply', label: '应用' }],
      root: {
        type: 'Stack',
        direction: 'column',
        gap: 'md',
        children: [
          {
            type: 'Card',
            title: '连接卡片',
            subtitle: '液态玻璃卡片',
            children: [
              { type: 'Text', content: '纯文本内容', variant: 'body' },
              { type: 'Badge', label: '0 Token', variant: 'info' },
              { type: 'Switch', label: '自动同步', atomKey: 'syncOn' },
              { type: 'Input', label: '目标地址', atomKey: 'host', inputType: 'url' },
              {
                type: 'Button',
                label: '应用设置',
                actionId: 'demo:apply',
                variant: 'primary',
                disabled: true,
                disabledReason: '请先连接 Daemon',
              },
            ],
          },
          {
            type: 'Table',
            caption: '节点状态',
            columns: [
              { key: 'node', label: '节点' },
              { key: 'ok', label: '在线', align: 'center' },
            ],
            rows: [{ node: 'local', ok: true }],
          },
        ],
      },
    };

    const plan = resolveDeclarativeRenderPlan(spec);
    assert.equal(plan.ok, true);
    if (plan.ok) {
      assert.equal(plan.spec.ui, 'components');
      assert.equal(plan.spec.root.type, 'Stack');
    }

    const standalone = resolveDeclarativeRenderPlan(validateDeclarativeUiTree(spec.root));
    assert.equal(standalone.ok, true);
  });

  it('blocks malicious trees (unknown nodes, HTML/CSS injection, prototype pollution, function props, excess depth)', () => {
    const maliciousSpecs: Array<{ name: string; payload: unknown; expectedCode: string }> = [
      {
        name: 'unknown Html node',
        payload: { ui: 'components', root: { type: 'Html', content: '<b>pwn</b>' } },
        expectedCode: 'UNKNOWN_NODE_TYPE',
      },
      {
        name: 'dangerouslySetInnerHTML injection',
        payload: {
          ui: 'components',
          root: { type: 'Text', content: 'hi', dangerouslySetInnerHTML: { __html: '<svg/>' } },
        },
        expectedCode: 'FORBIDDEN_INJECTION_KEY',
      },
      {
        name: 'rawCss injection',
        payload: {
          ui: 'components',
          root: { type: 'Card', title: 'bad', rawCss: 'body{display:none}' },
        },
        expectedCode: 'FORBIDDEN_INJECTION_KEY',
      },
      {
        name: 'prototype pollution',
        payload: JSON.parse(
          '{"ui":"components","root":{"type":"Text","content":"ok","__proto__":{"polluted":true}}}',
        ),
        expectedCode: 'PROTOTYPE_POLLUTION_KEY',
      },
      {
        name: 'function prop',
        payload: {
          ui: 'components',
          root: { type: 'Button', label: 'bad', actionId: 'go', payload: { fn: () => 1 } },
        },
        expectedCode: 'NON_JSON_SAFE_VALUE',
      },
    ];

    for (const tc of maliciousSpecs) {
      const plan = resolveDeclarativeRenderPlan(tc.payload);
      assert.equal(plan.ok, false, `${tc.name} must be rejected`);
      if (!plan.ok) {
        assert.equal(plan.code, tc.expectedCode, `${tc.name} expected error code ${tc.expectedCode}`);
      }
    }

    // Depth limit check
    let deep: unknown = { type: 'Text', content: 'leaf' };
    for (let i = 0; i < 10; i += 1) {
      deep = { type: 'Stack', children: [deep] };
    }
    const deepPlan = resolveDeclarativeRenderPlan(deep, 5);
    assert.equal(deepPlan.ok, false);
    if (!deepPlan.ok) {
      assert.equal(deepPlan.code, 'MAX_DEPTH_EXCEEDED');
    }

    assert.throws(
      () => assertJsonSafeProps({ style: 'color:red' }),
      (err: unknown) =>
        err instanceof DeclarativeUiValidationError && err.code === 'FORBIDDEN_INJECTION_KEY',
    );
    assert.throws(
      () => validateDeclarativePanelSpec({ ui: 'iframe', root: { type: 'Text', content: 'x' } }),
      (err: unknown) =>
        err instanceof DeclarativeUiValidationError && err.code === 'UNSUPPORTED_UI_MODE',
    );
  });

  it('guarantees >= 4.5:1 WCAG contrast on all declarative glass tokens and mandatory CSS fallbacks', () => {
    for (const polarity of ['dark', 'light'] as const) {
      const tokens = DECLARATIVE_GLASS_CONTRAST_TOKENS[polarity];
      for (const key of ['fg', 'muted', 'accent', 'success', 'warning', 'danger'] as const) {
        const ratio = contrastRatioHex(tokens[key], tokens.surface);
        assert.ok(
          ratio >= 4.5,
          `expected ${polarity}.${key} (${tokens[key]}) vs surface (${tokens.surface}) >= 4.5:1, got ${ratio.toFixed(2)}`,
        );
      }
      assert.ok(contrastRatioHex(tokens.primaryFg, tokens.primaryBg) >= 4.5);
      assert.ok(contrastRatioHex(tokens.dangerFg, tokens.dangerBg) >= 4.5);
    }

    const here = path.dirname(fileURLToPath(import.meta.url));
    const cardsCss = fs.readFileSync(path.resolve(here, '../styles/appearance-cards.css'), 'utf8');
    const cardsCssNoComments = cardsCss.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(
      cardsCssNoComments.includes('prefers-color-scheme'),
      false,
      'declarative CSS must NEVER use prefers-color-scheme media queries',
    );
    assert.match(cardsCss, /:root\[data-pmx-glass='1'\]\s*\.pmx-appearance\.pmx-decl-root\s*\.pmx-decl-card/);
    assert.match(cardsCss, /@supports not \(\(backdrop-filter: blur\(1px\)\)/);
    assert.match(cardsCss, /@media \(prefers-reduced-transparency: reduce\)/);
    assert.match(cardsCss, /html\[data-pmx-gpu='0'\]\s*\.pmx-appearance\.pmx-decl-root/);
    assert.match(cardsCss, /@media \(forced-colors: active\)/);
    assert.match(cardsCss, /\.pmx-decl-btn:focus-visible/);
    assert.match(cardsCss, /\.pmx-decl-switch:focus-visible/);
    assert.match(cardsCss, /\.pmx-decl-input:focus-visible/);
    assert.match(cardsCss, /\.pmx-decl-table-wrap:focus-visible/);
    assert.match(cardsCss, /\.pmx-plugin-overlay-surface/);
    assert.match(cardsCss, /blur\(24px\)/);
    assert.match(cardsCss, /var\(--pmx-glass-tint, #0d1524\) 95%/);
    assert.match(cardsCss, /var\(--pmx-glass-tint, #f8fafc\) 96%/);
  });

  it('enforces sibling id uniqueness, byte budget, table keyboard navigation, and 500ms stationary gesture settle guard', () => {
    // Duplicate sibling id & metered byte budget
    const dupPlan = resolveDeclarativeRenderPlan({
      type: 'Stack',
      children: [
        { type: 'Text', id: 'same', content: 'a' },
        { type: 'Text', id: 'same', content: 'b' },
      ],
    });
    assert.equal(dupPlan.ok, false);
    if (!dupPlan.ok) assert.equal(dupPlan.code, 'DUPLICATE_SIBLING_ID');

    const bytePlan = resolveDeclarativeRenderPlan(
      {
        type: 'Stack',
        children: [{ type: 'Text', content: 'x'.repeat(600) }],
      },
      undefined,
      400,
    );
    assert.equal(bytePlan.ok, false);
    if (!bytePlan.ok) assert.equal(bytePlan.code, 'MAX_TREE_BYTES_EXCEEDED');

    // Table keyboard row navigation
    assert.equal(nextDeclarativeTableRow('ArrowDown', 0, 5), 1);
    assert.equal(nextDeclarativeTableRow('ArrowUp', 0, 5), 0);
    assert.equal(nextDeclarativeTableRow('End', 0, 5), 4);
    assert.equal(nextDeclarativeTableRow('Home', 4, 5), 0);
    assert.equal(nextDeclarativeTableRow('PageDown', 1, 20, 8), 9);
    assert.equal(nextDeclarativeTableRow('Escape', 1, 5), null);

    // 500ms stationary gesture settle tracker (scroll-invariant, shift-sensitive)
    let now = 1000;
    const tracker = createDeclarativeGestureTracker(() => now);
    let containerScrollTop = 0;
    let btnTop = 100;
    const container = {
      get scrollLeft() {
        return 0;
      },
      get scrollTop() {
        return containerScrollTop;
      },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 600 }),
    };
    const btn = {
      isConnected: true,
      getBoundingClientRect: () => ({ left: 20, top: btnTop - containerScrollTop, width: 100, height: 32 }),
    };
    tracker.setContainer(container);
    tracker.track('cb:confirm', btn);
    assert.equal(tracker.isSettled('cb:confirm', now + 200, DEFAULT_DECLARATIVE_GESTURE_SETTLE_MS), false);

    // Scrolling the panel does NOT reset the settle timer
    now = 1300;
    containerScrollTop = 80;
    tracker.sample(now);
    assert.equal(tracker.isSettled('cb:confirm', 1500, DEFAULT_DECLARATIVE_GESTURE_SETTLE_MS), true);

    // Layout shift DOES reset the 500ms settle window
    now = 1600;
    btnTop = 140;
    tracker.sample(now);
    assert.equal(tracker.isSettled('cb:confirm', 1900, DEFAULT_DECLARATIVE_GESTURE_SETTLE_MS), false);
    assert.equal(tracker.isSettled('cb:confirm', 2100, DEFAULT_DECLARATIVE_GESTURE_SETTLE_MS), true);
  });
});

describe('PrismuxReasoningEffortSlider (dsh-fish model-aware running slider)', () => {
  it('identifies all 8 model families with model-first precedence over multi-model aggregators', () => {
    const modelCases: Array<[string, string | null, string | null, ReasoningModelFamily]> = [
      ['deepseek-v3', null, 'openrouter', 'deepseek'],
      ['deepseek-r1', null, 'openai-compatible', 'deepseek'],
      ['deepseek-v4-pro', null, null, 'deepseek'],
      ['gpt-5.4-codex', null, 'openrouter', 'openai'],
      ['o3', null, 'openrouter', 'openai'],
      ['openai/o4-mini', null, 'openrouter', 'openai'],
      ['codex-mini', null, null, 'openai'],
      ['claude-opus-4-6', null, 'antigravity', 'claude'],
      ['anthropic/claude-sonnet-4', null, 'google', 'claude'],
      ['gemini-2.5-pro', null, 'anthropic', 'gemini'],
      ['gemma-3', null, 'openrouter', 'gemini'],
      ['kimi-k2', null, 'deepseek', 'kimi'],
      ['moonshot-v1', null, null, 'kimi'],
      ['glm-5', null, 'openrouter', 'glm'],
      ['chatglm', null, null, 'glm'],
      ['qwen3-max', null, 'openai', 'qwen'],
      ['qwq-32b', null, 'openrouter', 'qwen'],
      ['MiniMax-M2', null, 'openrouter', 'minimax'],
      ['hailuo', null, null, 'minimax'],
      // Display name precedence & provider fallback
      ['deployment-1', 'Claude Sonnet 4.6', 'openai', 'claude'],
      ['deployment-2', null, 'antigravity', 'gemini'],
      ['deployment-3', null, 'dashscope', 'qwen'],
      ['deployment-4', null, 'bigmodel', 'glm'],
      ['deployment-5', null, 'codex', 'openai'],
      ['unknown-model', null, 'custom-gateway', 'deepseek'],
    ];

    for (const [modelId, modelName, provider, expected] of modelCases) {
      assert.equal(
        detectReasoningModelFamily(modelId, modelName, provider),
        expected,
        `expected (${modelId}, ${modelName}, ${provider}) -> ${expected}`,
      );
      const theme = resolveReasoningModelTheme(modelId, modelName, provider);
      assert.equal(theme.id, expected);
      assert.equal(theme.spriteUrl, REASONING_RUNNER_SPRITES[theme.spriteKey]);
    }
  });

  it('bundles valid RGBA WebP runner sprites and enforces >= 4.5:1 WCAG contrast on all 8 brand themes', () => {
    assert.equal(REASONING_RUNNER_FRAME_COUNT, 8);
    assert.equal(typeof PrismuxReasoningEffortSlider, 'function');

    const families = Object.keys(REASONING_MODEL_THEMES) as ReasoningModelFamily[];
    assert.equal(families.length, 8);

    for (const family of families) {
      const theme = REASONING_MODEL_THEMES[family];
      assert.ok(
        theme.spriteUrl.startsWith('data:image/webp;base64,'),
        `${family} sprite must be embedded WebP data URI`,
      );
      const raw = Buffer.from(theme.spriteUrl.slice('data:image/webp;base64,'.length), 'base64');
      assert.equal(raw.subarray(0, 4).toString('ascii'), 'RIFF', `${family} sprite RIFF header`);
      assert.equal(raw.subarray(8, 12).toString('ascii'), 'WEBP', `${family} sprite WEBP header`);

      const lightRatio = contrastRatioHex(theme.accentLight, '#ffffff');
      assert.ok(
        lightRatio >= 4.5,
        `${family} accentLight (${theme.accentLight}) on #ffffff must be >= 4.5:1, got ${lightRatio.toFixed(2)}`,
      );
      const darkRatio = contrastRatioHex(theme.accentDark, '#0d1524');
      assert.ok(
        darkRatio >= 4.5,
        `${family} accentDark (${theme.accentDark}) on #0d1524 must be >= 4.5:1, got ${darkRatio.toFixed(2)}`,
      );
    }
  });

  it('maps family effort presets, dynamic option lists, bilingual labels, and radiation drawing cleanly', () => {
    const claudePreset = getEffortPresetForFamily('claude', 'zh');
    assert.deepEqual(
      claudePreset.map((s) => s.value),
      ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'],
    );
    assert.equal(formatReasoningEffortLabel('xhigh', 'zh'), '极高');
    assert.equal(formatReasoningEffortLabel('ultracode', 'en'), 'Ultracode');
    assert.equal(formatReasoningEffortShortLabel('medium', 'en'), 'Med');

    const codexPreset = getEffortPresetForFamily('openai', 'zh');
    assert.deepEqual(
      codexPreset.map((s) => s.value),
      ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    );

    const customStops = normalizeReasoningEffortOptions(
      ['low', { value: 'high', label: '深度推理', shortLabel: '深度' }, 'high', 'ultracode'],
      'claude',
      'zh',
    );
    assert.equal(customStops.length, 3);
    assert.equal(customStops[1]?.label, '深度推理');
    assert.equal(resolveEffortStopIndex(customStops, 'HIGH'), 1);
    assert.equal(resolveEffortStopIndex(customStops, null), 1);

    // Smoke-test pixel-matrix radiation renderer across all 8 families in dark & light polarities
    let rectCalls = 0;
    const fakeGradient = { addColorStop: () => undefined };
    const fakeCtx = {
      fillStyle: '',
      clearRect: () => undefined,
      save: () => undefined,
      restore: () => undefined,
      beginPath: () => undefined,
      rect: () => undefined,
      clip: () => undefined,
      fillRect: () => {
        rectCalls += 1;
      },
      createLinearGradient: () => fakeGradient,
      createRadialGradient: () => fakeGradient,
    } as unknown as CanvasRenderingContext2D;

    for (const family of Object.keys(REASONING_MODEL_THEMES) as ReasoningModelFamily[]) {
      drawReasoningRadiation(fakeCtx, 240, 28, 1200, { progress: 0.75, dragging: false }, family, true);
      drawReasoningRadiation(fakeCtx, 240, 28, 2400, { progress: 0.5, dragging: true }, family, false);
    }
    assert.ok(rectCalls > 100, 'radiation canvas should render pixel columns and particle streaks');
  });

  it('exports reasoning slider styles with reduced-motion static fallback and zero prefers-color-scheme', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const builtStylesPath = path.resolve(here, '../styles.css');
    const css = fs.readFileSync(builtStylesPath, 'utf8');
    const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

    assert.equal(
      cssNoComments.includes('prefers-color-scheme'),
      false,
      'built styles.css must NEVER contain prefers-color-scheme media queries',
    );
    assert.match(css, /\.pmx-re-root/);
    assert.match(css, /@keyframes pmx-re-runner-run/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.pmx-re-root\.is-runner \.pmx-re-knob/);
    assert.match(css, /html\[data-pmx-gpu='0'\] \.pmx-re-root\.is-runner \.pmx-re-knob/);
    for (const family of ['openai', 'claude', 'gemini', 'kimi', 'glm', 'qwen', 'minimax']) {
      assert.ok(
        css.includes(`data-pmx-re-theme='${family}'`),
        `styles.css must include track styling for ${family}`,
      );
    }
  });
});
