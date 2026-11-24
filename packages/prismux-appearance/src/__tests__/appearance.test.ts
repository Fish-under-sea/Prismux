import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_APPEARANCE_CONFIG,
  GLASS_PRESETS,
  GLASS_ZONE_CSS_NAMES,
  GLASS_ZONE_IDS,
  GLASS_ZONE_LIMITS,
  GLASS_ZONE_META,
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
  computeCelestialLabelCenterX,
  computeCelestialOrbCenterX,
  computeCelestialPaintVars,
  createCelestialPhysicsState,
  getCelestialGeometryMetrics,
  ledColorForPosition,
  nearestThemeMode,
  projectReleaseMode,
  stepCelestialPhysics,
  themeModePosition,
} from '../celestialPhysics.js';
import {
  DEFAULT_INNER_STAGE_RADIUS_PX,
  applyGlassPreset,
  applyPrismuxAppearanceToDocument,
  canonicalizeGlassZoneId,
  clampSurfaceColorForContrast,
  clearPrismuxAppearanceFromDocument,
  computeWorstCaseGlassContrast,
  countCustomizedGlassZones,
  normalizeAppearanceConfig,
  resetAllGlassZones,
  resetGlassZone,
  resolveAppearanceRuntime,
  setThemeModeWithGlassAutoWake,
  updateGlassRegion,
  updateGlassZone,
  type DocumentLike,
  type ElementLike,
} from '../glassEngine.js';
import { GlassZoneConfigurator } from '../GlassZoneConfigurator.js';
import type { InlineAppearanceStudioProps } from '../InlineAppearanceStudio.js';
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
  DEFAULT_SCROLL_ACTIVE_HIDE_DELAY_MS,
  DEFAULT_SCROLL_HOVER_HIDE_DELAY_MS,
  PMX_FLOATING_SCROLLBARS_ROOT_ATTR,
  PMX_SCROLL_ACTIVE_ATTR,
  PMX_SCROLL_SCROLLING_ATTR,
  findNearestScrollableContainer,
  installPrismuxFloatingScrollbars,
  isElementScrollable,
  type ComputedOverflowStyleLike,
  type FloatingScrollbarDocumentLike,
  type FloatingScrollbarEventLike,
  type ScrollableElementLike,
} from '../floatingScrollbar.js';
import {
  PMX_CUTOUT_ACTIVE_ATTR,
  PMX_SHELL_BACKDROP_ATTR,
  PMX_SHELL_CUTOUT_MASK_ID,
  PMX_SHELL_CUTOUT_ROOT_ATTR,
  PMX_SHELL_CUTOUT_SVG_ATTR,
  computeShellCutoutGeometry,
  installPrismuxShellCutout,
  type ShellCutoutDocumentLike,
  type ShellCutoutElementLike,
} from '../shellCutout.js';
import {
  CANONICAL_EFFORT_LABELS,
  PrismuxReasoningEffortSlider,
  REASONING_MODEL_THEMES,
  REASONING_RUNNER_FRAME_COUNT,
  REASONING_RUNNER_SPRITES,
  computeReasoningEffortStopPercent,
  computeReasoningEffortStopProgress,
  detectReasoningModelFamily,
  drawReasoningRadiation,
  formatEffortLabel,
  formatReasoningEffortLabel,
  formatReasoningEffortShortLabel,
  getEffortPresetForFamily,
  normalizeReasoningEffortOptions,
  resolveEffortStopIndex,
  resolveReasoningEffortStopIndexFromPointer,
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
    assert.match(popoverCss, /backdrop-filter:\s*blur\(24px\)\s*saturate\(1\.1\)/);
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

  it('maps family effort presets, dynamic option lists, canonical English labels across all locales, and radiation drawing cleanly', () => {
    const claudePreset = getEffortPresetForFamily('claude', 'zh');
    assert.deepEqual(
      claudePreset.map((s) => s.value),
      ['low', 'medium', 'high', 'xhigh', 'max', 'ultracode'],
    );
    assert.deepEqual(
      claudePreset.map((s) => s.label),
      ['Low', 'Medium', 'High', 'XHigh', 'Max', 'Ultracode'],
    );
    assert.deepEqual(
      claudePreset.map((s) => s.shortLabel),
      ['Low', 'Medium', 'High', 'XHigh', 'Max', 'Ultracode'],
    );

    const expectedPairs: Array<[string, string]> = [
      ['off', 'Off'],
      ['none', 'None'],
      ['minimal', 'Minimal'],
      ['low', 'Low'],
      ['medium', 'Medium'],
      ['high', 'High'],
      ['xhigh', 'XHigh'],
      ['extra_high', 'XHigh'],
      ['max', 'Max'],
      ['ultracode', 'Ultracode'],
      ['ultrathink', 'Ultrathink'],
      ['auto', 'Auto'],
    ];
    for (const [level, expected] of expectedPairs) {
      assert.equal(CANONICAL_EFFORT_LABELS[level], expected);
      assert.equal(formatEffortLabel(level), expected);
      assert.equal(formatReasoningEffortLabel(level, 'zh'), expected);
      assert.equal(formatReasoningEffortLabel(level, 'en'), expected);
      assert.equal(formatReasoningEffortShortLabel(level, 'zh'), expected);
      assert.equal(formatReasoningEffortShortLabel(level, 'en'), expected);
    }

    const codexPreset = getEffortPresetForFamily('openai', 'zh');
    assert.deepEqual(
      codexPreset.map((s) => s.value),
      ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    );
    assert.deepEqual(
      codexPreset.map((s) => s.label),
      ['Minimal', 'Low', 'Medium', 'High', 'XHigh', 'Max'],
    );

    // Slider source uses the same stop.label for both header badge and bottom stop buttons
    const here = path.dirname(fileURLToPath(import.meta.url));
    const sliderBuilt = fs.readFileSync(
      path.resolve(here, '../reasoningEffort/PrismuxReasoningEffortSlider.js'),
      'utf8',
    );
    assert.match(sliderBuilt, /stop\.label/);
    assert.equal(sliderBuilt.includes('stop.shortLabel'), false);

    const customStops = normalizeReasoningEffortOptions(
      ['low', { value: 'high', label: 'Deep', shortLabel: 'Deep' }, 'high', 'ultracode'],
      'claude',
      'zh',
    );
    assert.equal(customStops.length, 3);
    assert.equal(customStops[0]?.label, 'Low');
    assert.equal(customStops[1]?.label, 'Deep');
    assert.equal(customStops[2]?.label, 'Ultracode');
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
    assert.match(css, /\.pmx-re-stops\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(var\(--pmx-re-count,\s*4\),\s*minmax\(0,\s*1fr\)\);[^}]*gap:\s*0;/s);
    assert.match(css, /\.pmx-re-root\.is-runner \.pmx-re-knob\s*\{[^}]*left:\s*var\(--pmx-re-progress\);/s);
  });

  it('mathematically centers the runner knob at ((i + 0.5) / N) * 100% with 0.00px error and aligns pointer hit cells across N=2..7', () => {
    const widths = [240, 320, 480, 720, 960];
    const rectLeft = 40;
    for (const count of [2, 3, 4, 5, 6, 7]) {
      for (let i = 0; i < count; i += 1) {
        const expectedRatio = (i + 0.5) / count;
        const actualRatio = computeReasoningEffortStopProgress(i, count);
        const actualPercent = computeReasoningEffortStopPercent(i, count);
        assert.ok(Math.abs(actualRatio - expectedRatio) < 1e-12);
        assert.ok(Math.abs(actualPercent - expectedRatio * 100) < 1e-12);

        for (const width of widths) {
          const cellWidth = width / count;
          const labelCenterX = rectLeft + (i + 0.5) * cellWidth;
          const runnerCenterX = rectLeft + actualRatio * width;
          assert.ok(
            Math.abs(runnerCenterX - labelCenterX) < 1e-9,
            `Expected 0.00px delta for N=${count}, i=${i}, W=${width}`,
          );
          assert.equal(
            resolveReasoningEffortStopIndexFromPointer(labelCenterX, { left: rectLeft, width }, count),
            i,
          );
          // Near left and right interior edges of cell i still map cleanly to i
          assert.equal(
            resolveReasoningEffortStopIndexFromPointer(
              rectLeft + i * cellWidth + 0.01,
              { left: rectLeft, width },
              count,
            ),
            i,
          );
          assert.equal(
            resolveReasoningEffortStopIndexFromPointer(
              rectLeft + (i + 1) * cellWidth - 0.01,
              { left: rectLeft, width },
              count,
            ),
            i,
          );
        }
      }
      // Out-of-bounds drags clamp cleanly to [0, count - 1]
      assert.equal(resolveReasoningEffortStopIndexFromPointer(rectLeft - 50, { left: rectLeft, width: 400 }, count), 0);
      assert.equal(resolveReasoningEffortStopIndexFromPointer(rectLeft + 400, { left: rectLeft, width: 400 }, count), count - 1);
      assert.equal(resolveReasoningEffortStopIndexFromPointer(rectLeft + 500, { left: rectLeft, width: 400 }, count), count - 1);
    }
  });
});

describe('CelestialThemeCapsule orb-to-label geometric alignment & compact mode', () => {
  it('aligns all 3 mode label centers pixel-perfectly (0px delta) with orb centers in default & compact scales', () => {
    const widths = [220, 320, 420, 640, 960];
    for (const compact of [false, true]) {
      const metrics = getCelestialGeometryMetrics(compact);
      assert.equal(metrics.padPx * 2 + metrics.orbDiameterPx, metrics.trackHeightPx);
      const cjkLabelW = compact ? 23 : 24;

      for (const w of widths) {
        for (const mode of ['light', 'dark', 'glass'] as const) {
          const orbCenter = computeCelestialOrbCenterX(themeModePosition(mode), w, compact);
          const labelCenter = computeCelestialLabelCenterX(mode, w, compact, cjkLabelW);
          assert.equal(
            Math.abs(orbCenter - labelCenter),
            0,
            `Expected 0px delta for mode=${mode}, compact=${compact}, width=${w}: orb=${orbCenter}, label=${labelCenter}`,
          );
        }

        // Exact edge formulas: light = pad + orb/2, dark = 50%, glass = width - pad - orb/2.
        const edgeOffset = metrics.padPx + metrics.orbDiameterPx / 2;
        assert.equal(computeCelestialOrbCenterX(0, w, compact), edgeOffset);
        assert.equal(computeCelestialOrbCenterX(0.5, w, compact), w / 2);
        assert.equal(computeCelestialOrbCenterX(1, w, compact), w - edgeOffset);

        // Unusually wide custom edge labels stay clamped inside [0, width] without horizontal clipping.
        const wideLabelW = 72;
        const wideLightCenter = computeCelestialLabelCenterX('light', w, compact, wideLabelW);
        const wideGlassCenter = computeCelestialLabelCenterX('glass', w, compact, wideLabelW);
        assert.ok(wideLightCenter - wideLabelW / 2 >= 0, 'wide light label must not clip past left edge');
        assert.ok(wideGlassCenter + wideLabelW / 2 <= w, 'wide glass label must not clip past right edge');
      }
    }
  });

  it('uses 1fr-auto-1fr + min-width: var(--dtp-h) CSS alignment without the legacy 13cqi offset hack', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const css = fs.readFileSync(path.resolve(here, '../styles/celestial-capsule.css'), 'utf8');
    assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+minmax\(0,\s*1fr\)/);
    assert.match(css, /min-width:\s*var\(--dtp-h,\s*34px\)/);
    assert.match(css, /\.dtp-label-btn:first-child\s*\{[^}]*justify-self:\s*start/s);
    assert.match(css, /\.dtp-label-btn:nth-child\(2\)\s*\{[^}]*justify-self:\s*center/s);
    assert.match(css, /\.dtp-label-btn:last-child\s*\{[^}]*justify-self:\s*end/s);
    assert.equal(css.includes('13cqi'), false, 'legacy misaligned 13cqi padding hack must be removed');
  });
});

describe('Unified 5-zone liquid-glass architecture (shellFrame + rightSidebar), CSS emission & legacy migration (#461)', () => {
  it('unifies shellFrame while keeping rightSidebar (defaulting to shellFrame), mainCanvas, composer & overlays independently tunable', () => {
    const html = createMockElement();
    const body = createMockElement();
    const doc: DocumentLike = { documentElement: html, body };

    assert.deepEqual(GLASS_ZONE_IDS, [
      'shellFrame',
      'rightSidebar',
      'mainCanvas',
      'workPanels',
      'composer',
      'overlays',
    ]);
    assert.equal(GLASS_ZONE_META[0]?.id, 'shellFrame');
    assert.match(GLASS_ZONE_META[0]?.title ?? '', /^窗口外框/);
    assert.equal(GLASS_ZONE_META[1]?.id, 'rightSidebar');
    assert.equal(GLASS_ZONE_META[1]?.title, '右侧功能边栏');
    assert.equal(GLASS_ZONE_META[3]?.id, 'workPanels');
    assert.equal(GLASS_ZONE_META[3]?.title, '工作面板');
    assert.equal(GLASS_ZONE_META[3]?.note, '任务面板、工作区板与定时任务统一调节');
    assert.equal(canonicalizeGlassZoneId('leftSidebar'), 'shellFrame');
    assert.equal(canonicalizeGlassZoneId('chromeBars'), 'shellFrame');

    // When rightSidebar is on 'inherit' (default), customizing shellFrame automatically syncs rightSidebar with 0 delta!
    const baseGlass = normalizeAppearanceConfig({ themeMode: 'glass', glassPreset: 'balanced' });
    const customShellOnly = updateGlassZone(baseGlass, 'shellFrame', {
      mode: 'custom',
      opacity: 24,
      blurPx: 14,
      saturation: 112,
    });
    const rtShellSync = resolveAppearanceRuntime(customShellOnly);
    assert.equal(rtShellSync.zones.shellFrame.effectiveMode, 'custom');
    assert.equal(rtShellSync.zones.rightSidebar.effectiveMode, 'inherit');
    assert.equal(rtShellSync.zones.rightSidebar.opacity, 24);
    assert.equal(rtShellSync.zones.rightSidebar.blurPx, 14);
    assert.equal(rtShellSync.zones.rightSidebar.saturation, 112);
    assert.equal(rtShellSync.zones.rightSidebar.bgCss, rtShellSync.zones.shellFrame.bgCss);
    assert.equal(rtShellSync.zones.rightSidebar.backdropCss, rtShellSync.zones.shellFrame.backdropCss);
    assert.equal(rtShellSync.zones.rightSidebar.sheenCss, rtShellSync.zones.shellFrame.sheenCss);
    assert.equal(countCustomizedGlassZones(customShellOnly), 1);

    // Start from balanced glass, make shellFrame solid (via legacy 'leftSidebar' alias too!),
    // rightSidebar ultra-clear custom, composer custom high-opacity, overlays attempted below floor (clamps >= 68%).
    let cfg = normalizeAppearanceConfig({ themeMode: 'glass', glassPreset: 'balanced' });
    cfg = updateGlassZone(cfg, 'leftSidebar', { mode: 'solid' });
    cfg = updateGlassZone(cfg, 'rightSidebar', {
      mode: 'custom',
      opacity: 14,
      blurPx: 6,
      saturation: 185,
    });
    cfg = updateGlassZone(cfg, 'mainCanvas', { mode: 'custom', opacity: 22, blurPx: 12 });
    cfg = updateGlassZone(cfg, 'composer', { mode: 'custom', opacity: 64, blurPx: 20 });
    cfg = updateGlassZone(cfg, 'overlays', { mode: 'custom', opacity: 12, blurPx: 26 });

    assert.equal(cfg.glassZones.overlays.opacity, GLASS_ZONE_LIMITS.overlaysOpacityMin);
    assert.equal(countCustomizedGlassZones(cfg), 5);

    const rt = applyPrismuxAppearanceToDocument(cfg, { document: doc, wallpaperActive: true });

    // 1. shellFrame is strictly solid (and mirrors to legacy left-sidebar & chrome-bars tokens),
    // while rightSidebar remains independently translucent custom!
    assert.equal(rt.zones.shellFrame.effectiveMode, 'solid');
    assert.equal(html.attrs.get('data-pmx-zone-shell-frame-mode'), 'solid');
    assert.equal(html.attrs.get('data-pmx-zone-left-sidebar-mode'), 'solid');
    assert.equal(html.attrs.get('data-pmx-zone-chrome-bars-mode'), 'solid');
    assert.equal(html.styles.get('--pmx-glass-zone-shell-frame-blur'), '0px');
    assert.equal(html.styles.get('--pmx-glass-zone-shell-frame-backdrop'), 'none');
    assert.equal(html.styles.get('--pmx-glass-zone-shell-frame-sheen'), 'none');
    assert.match(html.styles.get('--pmx-glass-zone-shell-frame-bg') ?? '', /^rgb\(/);
    assert.equal(
      html.styles.get('--pmx-glass-zone-left-sidebar-bg'),
      html.styles.get('--pmx-glass-zone-shell-frame-bg'),
    );
    assert.equal(
      html.styles.get('--pmx-glass-zone-chrome-bars-bg'),
      html.styles.get('--pmx-glass-zone-shell-frame-bg'),
    );

    assert.equal(rt.zones.rightSidebar.effectiveMode, 'custom');
    assert.equal(html.attrs.get('data-pmx-zone-right-sidebar-mode'), 'custom');
    assert.equal(html.styles.get('--pmx-glass-zone-right-sidebar-blur'), '6px');
    assert.equal(html.styles.get('--pmx-glass-zone-right-sidebar-opacity'), '0.140');
    assert.equal(html.styles.get('--pmx-glass-zone-right-sidebar-saturation'), '1.85');
    assert.match(html.styles.get('--pmx-glass-zone-right-sidebar-bg') ?? '', /0\.140\)$/);
    assert.match(html.styles.get('--pmx-glass-zone-right-sidebar-backdrop') ?? '', /blur\(6px\) saturate\(1\.85\)/);

    // 2. overlays enforces >= 68% readability floor and >= 4.5:1 WCAG contrast!
    assert.equal(rt.zones.overlays.opacity, GLASS_ZONE_LIMITS.overlaysOpacityMin);
    assert.equal(html.styles.get('--pmx-glass-zone-overlays-opacity'), '0.680');
    assert.ok(
      computeWorstCaseGlassContrast(rt.zones.overlays.tint, true, 100, rt.zones.overlays.opacity) >= 4.5,
    );

    // 3. Inner stage default radius token is always emitted (14px).
    assert.equal(html.styles.get('--pmx-inner-stage-radius'), `${DEFAULT_INNER_STAGE_RADIUS_PX}px`);

    // 4. GPU=0 fallback forces ALL 5 zones (+ legacy shellFrame aliases) to opaque solid with zero blur.
    applyPrismuxAppearanceToDocument(cfg, { document: doc, gpuAvailable: false, wallpaperActive: true });
    for (const id of GLASS_ZONE_IDS) {
      const cssName = GLASS_ZONE_CSS_NAMES[id];
      assert.equal(html.attrs.get(`data-pmx-zone-${cssName}-mode`), 'solid');
      assert.equal(html.styles.get(`--pmx-glass-zone-${cssName}-blur`), '0px');
      assert.equal(html.styles.get(`--pmx-glass-zone-${cssName}-backdrop`), 'none');
      assert.equal(html.styles.get(`--pmx-glass-zone-${cssName}-sheen`), 'none');
    }

    // 5. Single-zone reset (including via legacy alias) & reset-all work cleanly.
    const afterSingleReset = resetGlassZone(cfg, 'chromeBars');
    assert.equal(afterSingleReset.glassZones.shellFrame.mode, 'inherit');
    assert.equal(afterSingleReset.glassZones.rightSidebar.mode, 'custom');
    assert.equal(countCustomizedGlassZones(afterSingleReset), 4);

    const afterAllReset = resetAllGlassZones(cfg);
    assert.equal(countCustomizedGlassZones(afterAllReset), 0);
    for (const id of GLASS_ZONE_IDS) {
      assert.equal(afterAllReset.glassZones[id].mode, 'inherit');
    }

    // 6. clearPrismuxAppearanceFromDocument leaves zero residual attrs/styles.
    clearPrismuxAppearanceFromDocument(doc);
    assert.equal(html.attrs.size, 0);
    assert.equal(body.attrs.size, 0);
    assert.equal(html.styles.size, 0);
  });

  it('maintains 100% backward compatibility with legacy persisted JSON / 6-zone .wb-theme snapshots and roundtrips 5-zone snapshots', () => {
    // 1. Legacy snapshot without `glassZones`
    const legacyJson = JSON.stringify({
      format: WB_THEME_FORMAT,
      version: WB_THEME_VERSION,
      name: 'Legacy Theme',
      appearance: {
        themeMode: 'glass',
        glassPreset: 'balanced',
        leftSidebarGlass: false,
        rightSidebarGlass: true,
        perSurfaceOverrides: {
          rightSidebar: { mode: 'custom', op: 24, blur: 10 },
        },
      },
    });
    const legacyRes = importWbThemeSnapshot(legacyJson);
    assert.equal(legacyRes.ok, true);
    if (!legacyRes.ok) return;
    assert.equal(legacyRes.strippedFields.length, 0);
    for (const id of GLASS_ZONE_IDS) {
      assert.equal(legacyRes.snapshot.appearance.glassZones[id].mode, 'inherit');
    }
    const legacyRt = resolveAppearanceRuntime(legacyRes.snapshot.appearance);
    assert.equal(legacyRt.zones.shellFrame.effectiveMode, 'solid');
    assert.equal(legacyRt.zones.rightSidebar.effectiveMode, 'inherit');
    assert.equal(legacyRt.zones.rightSidebar.blurPx, 10);

    // 2. Legacy 6-zone snapshot with `leftSidebar` / `chromeBars` auto-migrates cleanly into `shellFrame`
    const legacySixZoneJson = JSON.stringify({
      format: WB_THEME_FORMAT,
      version: WB_THEME_VERSION,
      name: 'Legacy 6-Zone Theme',
      appearance: {
        themeMode: 'glass',
        glassPreset: 'balanced',
        glassZones: {
          leftSidebar: { mode: 'inherit' },
          chromeBars: { mode: 'custom', opacity: 26, blurPx: 15, saturation: 112 },
          rightSidebar: { mode: 'custom', opacity: 18, blurPx: 8 },
          mainCanvas: { mode: 'inherit' },
          composer: { mode: 'custom', opacity: 56, blurPx: 16 },
          overlays: { mode: 'custom', opacity: 74, blurPx: 22 },
        },
      },
    });
    const migratedSixZone = importWbThemeSnapshot(legacySixZoneJson);
    assert.equal(migratedSixZone.ok, true);
    if (!migratedSixZone.ok) return;
    assert.equal(migratedSixZone.strippedFields.length, 0);
    assert.deepEqual(migratedSixZone.snapshot.appearance.glassZones.shellFrame, {
      mode: 'custom',
      opacity: 26,
      blurPx: 15,
      saturation: 112,
    });
    assert.equal(migratedSixZone.snapshot.appearance.glassZones.rightSidebar.opacity, 18);

    // 3. Modern snapshot with customized 5 zones roundtrips losslessly
    const modern = normalizeAppearanceConfig({
      themeMode: 'glass',
      glassPreset: 'clear',
      glassZones: {
        shellFrame: { mode: 'solid' },
        rightSidebar: { mode: 'custom', opacity: 18, blurPx: 8, saturation: 175 },
        mainCanvas: { mode: 'custom', opacity: 26, blurPx: 14 },
        composer: { mode: 'custom', opacity: 58, blurPx: 18 },
        overlays: { mode: 'custom', opacity: 76, blurPx: 24 },
      },
    });
    const exported = serializeWbThemeSnapshot(modern, {
      name: 'Prismux 5-Zone Glass',
      exportedAt: '2026-11-23T00:00:00.000Z',
    });
    const reimported = importWbThemeSnapshot(exported);
    assert.equal(reimported.ok, true);
    if (!reimported.ok) return;
    assert.equal(reimported.strippedFields.length, 0);
    assert.deepEqual(reimported.snapshot.appearance, modern);
  });

  it('exports GlassZoneConfigurator & InlineAppearanceStudio, removes corner slider from AppearanceHeroAndCards, and binds all 5 zones + right edge in CSS', () => {
    assert.equal(typeof GlassZoneConfigurator, 'function');
    // Compile-time verification of InlineAppearanceStudioProps contract without requiring optional peer react-dom at node:test runtime.
    const _studioContractCheck: Partial<InlineAppearanceStudioProps> = {
      backLabel: '返回壁纸',
      title: '外观与玻璃',
      fullSettingsLabel: '打开完整外观设置 ↗',
    };
    assert.equal(_studioContractCheck.title, '外观与玻璃');

    const here = path.dirname(fileURLToPath(import.meta.url));
    const indexSource = fs.readFileSync(path.resolve(here, '../index.js'), 'utf8');
    const studioBuilt = fs.readFileSync(path.resolve(here, '../InlineAppearanceStudio.js'), 'utf8');
    assert.match(indexSource, /InlineAppearanceStudio/);
    assert.match(indexSource, /GlassZoneConfigurator/);
    assert.match(studioBuilt, /export function InlineAppearanceStudio/);

    const bridgeCss = fs.readFileSync(path.resolve(here, '../styles/t3-glass-bridge.css'), 'utf8');
    const cardsCss = fs.readFileSync(path.resolve(here, '../styles/appearance-cards.css'), 'utf8');
    const heroBuilt = fs.readFileSync(path.resolve(here, '../AppearanceHeroAndCards.js'), 'utf8');

    // All 5 canonical zone selectors (+ legacy leftSidebar/chromeBars & right-frame-edge), Backdrop-Root elimination,
    // composer pseudo takeover, overlays & zero corner bleed, inner-stage radius.
    for (const id of GLASS_ZONE_IDS) {
      assert.ok(
        bridgeCss.includes(`[data-pmx-glass-zone='${id}']`),
        `t3-glass-bridge.css must bind [data-pmx-glass-zone='${id}']`,
      );
      assert.ok(
        bridgeCss.includes(`--pmx-glass-zone-${GLASS_ZONE_CSS_NAMES[id]}-bg`),
        `t3-glass-bridge.css must consume --pmx-glass-zone-${GLASS_ZONE_CSS_NAMES[id]}-bg`,
      );
    }
    assert.ok(bridgeCss.includes("[data-pmx-glass-zone='leftSidebar']"));
    assert.ok(bridgeCss.includes("[data-pmx-glass-zone='chromeBars']"));
    assert.ok(bridgeCss.includes("[data-pmx-right-frame-edge='1']"));
    assert.match(bridgeCss, /main\[data-slot='sidebar-inset'\]:has\(\[data-pmx-glass-zone='mainCanvas'\]\)/);
    assert.match(bridgeCss, /\[data-slot='composer-host'\]::before/);
    assert.match(bridgeCss, /\[data-chat-composer-main-surface='true'\]/);
    assert.match(bridgeCss, /\[data-slot='combobox-positioner'\]/);
    assert.match(bridgeCss, /\[data-slot='tooltip-popup'\]/);
    assert.match(bridgeCss, /\[data-pmx-status-popover='1'\]/);
    assert.match(bridgeCss, /\[data-pmx-overlay-shell\]/);
    assert.match(bridgeCss, /:not\(\[data-pmx-overlay-shell\]\)/);
    assert.match(bridgeCss, /background-clip:\s*padding-box;/);
    assert.match(bridgeCss, /\[data-pmx-inner-stage='1'\]/);
    assert.match(bridgeCss, /--pmx-inner-stage-radius,\s*14px/);

    // #383 AGY 2.0 dual-layer composer, Claude Code Desktop sidebar peek drawer & chat width handles.
    assert.match(bridgeCss, /\[data-pmx-composer-layout='agy'\]/);
    assert.match(bridgeCss, /\[data-pmx-composer-top-tray='1'\]/);
    assert.match(bridgeCss, /\[data-pmx-composer-inner-card='1'\]/);
    assert.match(bridgeCss, /--pmx-chat-content-max-width/);
    assert.match(bridgeCss, /\[data-pmx-sidebar-peek='1'\]/);
    assert.match(bridgeCss, /\[data-pmx-chat-width-handle\]/);
    assert.match(bridgeCss, /\[data-pmx-chat-width-badge='1'\]/);

    // Balanced braces & zero prefers-color-scheme in cardsCss.
    assert.equal((cardsCss.match(/\{/g) ?? []).length, (cardsCss.match(/\}/g) ?? []).length);
    assert.equal(
      cardsCss.replace(/\/\*[\s\S]*?\*\//g, '').includes('prefers-color-scheme'),
      false,
      'appearance-cards.css must NEVER contain prefers-color-scheme',
    );
    assert.match(cardsCss, /\.pmx-gz-root/);
    assert.match(cardsCss, /\.pmx-inline-studio/);

    // Corner radius UI removed from AppearanceHeroAndCards stack (#362).
    const stackFnStart = heroBuilt.indexOf('export function AppearanceHeroAndCards');
    assert.ok(stackFnStart > 0);
    const stackFnBody = heroBuilt.slice(stackFnStart);
    assert.equal(
      stackFnBody.includes('SidebarCornersCard'),
      false,
      'AppearanceHeroAndCards must not render the removed SidebarCornersCard UI',
    );
  });

  it('regression #409: settles dark center-stop within <= 1.5px by 300ms on 840px wide track, backfills stale zero-blur named presets, and hardens warm-wallpaper contrast + peek drawer', () => {
    // 1. Wide-track (840px) celestial dark center-stop landing precision (<= 1.5px by 300ms, <= 0.5px by 350ms, 0px settled).
    for (const startMode of ['light', 'glass'] as const) {
      const st = createCelestialPhysicsState(startMode);
      st.targetMode = 'dark';
      st.kick = 0.22;
      const trackW = 840;
      const targetCenter = computeCelestialLabelCenterX('dark', trackW, false, 24);
      let deltaAt300ms = Infinity;
      let deltaAt350ms = Infinity;
      let settled = false;

      for (let frame = 1; frame <= 90; frame++) {
        settled = stepCelestialPhysics(st, 1 / 60, false);
        const orbCenter = computeCelestialOrbCenterX(st.p, trackW, false);
        const delta = Math.abs(orbCenter - targetCenter);
        if (frame === 18) deltaAt300ms = delta; // 300ms
        if (frame === 21) deltaAt350ms = delta; // 350ms
        if (settled) break;
      }

      assert.ok(
        deltaAt300ms <= 1.5,
        `expected ${startMode} -> dark delta <= 1.5px at 300ms on 840px track, got ${deltaAt300ms.toFixed(2)}px`,
      );
      assert.ok(
        deltaAt350ms <= 0.5,
        `expected ${startMode} -> dark delta <= 0.5px at 350ms on 840px track, got ${deltaAt350ms.toFixed(2)}px`,
      );
      assert.equal(settled, true, `expected ${startMode} -> dark to fully settle within 1.5s`);
      assert.equal(
        Math.abs(computeCelestialOrbCenterX(st.p, trackW, false) - targetCenter),
        0,
        `expected exact 0.00px delta after settling ${startMode} -> dark`,
      );
    }

    // 2. Named active presets ('light' | 'balanced' | 'clear') backfill stale zero/off-state `{ op: 0|100, blur: 0 }` residue.
    for (const preset of ['light', 'balanced', 'clear'] as const) {
      const expected = GLASS_PRESETS[preset];
      const allZero = normalizeAppearanceConfig({
        themeMode: 'glass',
        glassPreset: preset,
        glassRegions: {
          surface: { op: 0, blur: 0 },
          card: { op: 0, blur: 0 },
          overlay: { op: 0, blur: 0 },
          control: { op: 0, blur: 0 },
        },
      });
      assert.deepEqual(allZero.glassRegions, expected, `all-zero residue under '${preset}' must backfill preset`);

      const offResidue = normalizeAppearanceConfig({
        themeMode: 'glass',
        glassPreset: preset,
        glassRegions: {
          surface: { op: 100, blur: 0 },
          card: { op: 100, blur: 0 },
          overlay: { op: 100, blur: 0 },
          control: { op: 100, blur: 0 },
        },
      });
      assert.deepEqual(offResidue.glassRegions, expected, `off-state residue under '${preset}' must backfill preset`);

      const rt = resolveAppearanceRuntime(allZero);
      assert.ok(rt.zones.shellFrame.blurPx > 0, `preset '${preset}' shellFrame must have blurPx > 0`);
      assert.notEqual(
        rt.zones.shellFrame.backdropCss,
        'none',
        `preset '${preset}' shellFrame must not drop to backdrop-filter: none`,
      );
    }

    // Custom preset with explicit blur: 0 must NOT be overwritten.
    const customZero = normalizeAppearanceConfig({
      themeMode: 'glass',
      glassPreset: 'custom',
      glassRegions: {
        surface: { op: 0, blur: 0 },
        card: { op: 0, blur: 0 },
        overlay: { op: 0, blur: 0 },
        control: { op: 0, blur: 0 },
      },
    });
    assert.deepEqual(customZero.glassRegions.surface, { op: 0, blur: 0 });

    // 3. Warm-wallpaper dark-glass contrast lift & anti-bleed-through floating peek drawer CSS contract.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const bridgeCss = fs.readFileSync(path.resolve(here, '../styles/t3-glass-bridge.css'), 'utf8');
    assert.match(bridgeCss, /--sidebar-muted-foreground:\s*rgba\(255,\s*255,\s*255,\s*0\.86\)/);
    assert.match(bridgeCss, /text-shadow:\s*0 1px 2px rgba\(0,\s*0,\s*0,\s*0\.4[58]\)/);
    assert.match(bridgeCss, /filter:\s*drop-shadow\(0 1px 1\.5px rgba\(0,\s*0,\s*0,\s*0\.38\)\)/);
    assert.match(bridgeCss, /\[data-pmx-sidebar-peek='1'\][\s\S]*?isolation:\s*isolate;/);
    assert.match(bridgeCss, /\[data-pmx-sidebar-peek='1'\][\s\S]*?backdrop-filter:\s*blur\(22px\) saturate\(1\.1\) !important;/);
    assert.match(bridgeCss, /var\(--pmx-glass-tint,\s*#0d1524\)\s*80%/);
    assert.match(bridgeCss, /var\(--pmx-glass-tint,\s*#ffffff\)\s*86%/);
  });
});

describe('Arc / AGY 2.0 monolithic outer frame, 4 concave corners & clear mainCanvas defaults (#420)', () => {
  it('defaults mainCanvas to 0px blur + ultra-clear tint across light/balanced/clear while unifying outer-frame optics', () => {
    for (const preset of ['light', 'balanced', 'clear'] as const) {
      const cfg = normalizeAppearanceConfig({ themeMode: 'glass', glassPreset: preset });
      const rt = resolveAppearanceRuntime(cfg);

      // Default mainCanvas is crystal-clear (0px blur, no backdrop filter, no sheen, low opacity)
      assert.equal(rt.zones.mainCanvas.effectiveMode, 'inherit');
      assert.equal(rt.zones.mainCanvas.blurPx, 0, `preset '${preset}' mainCanvas must default to 0px blur`);
      assert.equal(rt.zones.mainCanvas.backdropCss, 'none', `preset '${preset}' mainCanvas backdrop must be none`);
      assert.equal(rt.zones.mainCanvas.sheenCss, 'none', `preset '${preset}' mainCanvas sheen must be none`);
      assert.ok(
        rt.zones.mainCanvas.opacity >= 2 && rt.zones.mainCanvas.opacity <= 16,
        `preset '${preset}' mainCanvas opacity should be ultra-clear (2-16%), got ${rt.zones.mainCanvas.opacity}%`,
      );

      // Monolithic outer frame (shellFrame & rightSidebar) shares 100% identical optics in inherit mode
      assert.equal(rt.zones.rightSidebar.opacity, rt.zones.shellFrame.opacity);
      assert.equal(rt.zones.rightSidebar.blurPx, rt.zones.shellFrame.blurPx);
      assert.equal(rt.zones.rightSidebar.saturation, rt.zones.shellFrame.saturation);
      assert.equal(rt.zones.rightSidebar.bgCss, rt.zones.shellFrame.bgCss);
      assert.equal(rt.zones.rightSidebar.backdropCss, rt.zones.shellFrame.backdropCss);
      assert.equal(rt.zones.rightSidebar.sheenCss, rt.zones.shellFrame.sheenCss);
    }

    // Users retain full freedom to dial custom blur/opacity or solid on mainCanvas at any time
    const base = normalizeAppearanceConfig({ themeMode: 'glass', glassPreset: 'balanced' });
    const customMain = updateGlassZone(base, 'mainCanvas', { mode: 'custom', opacity: 28, blurPx: 16 });
    const rtCustom = resolveAppearanceRuntime(customMain);
    assert.equal(rtCustom.zones.mainCanvas.effectiveMode, 'custom');
    assert.equal(rtCustom.zones.mainCanvas.opacity, 28);
    assert.equal(rtCustom.zones.mainCanvas.blurPx, 16);
    assert.match(rtCustom.zones.mainCanvas.backdropCss, /blur\(16px\)/);

    const solidMain = updateGlassZone(base, 'mainCanvas', { mode: 'solid' });
    const rtSolid = resolveAppearanceRuntime(solidMain);
    assert.equal(rtSolid.zones.mainCanvas.effectiveMode, 'solid');
    assert.equal(rtSolid.zones.mainCanvas.opacity, 100);
    assert.equal(rtSolid.zones.mainCanvas.blurPx, 0);
    assert.equal(rtSolid.zones.mainCanvas.backdropCss, 'none');
  });

  it('defines zero-seam outer chrome, 4 concave corner fillets, radial fallback, 1px inner ring & solid fallbacks in t3-glass-bridge.css', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const bridgeCss = fs.readFileSync(path.resolve(here, '../styles/t3-glass-bridge.css'), 'utf8');

    // Monolithic zero-seam chrome border removal (eliminating ALL internal T-seams & cross-seams in Figs 3–6)
    assert.match(bridgeCss, /html:has\(\[data-pmx-stage-frame='1'\]\)[\s\S]*?\[data-slot='sidebar-container'\][\s\S]*?border-right-width:\s*0 !important/);
    assert.match(bridgeCss, /html:has\(\[data-pmx-stage-frame='1'\]\)[\s\S]*?\[data-workspace-tabbar\][\s\S]*?header\[data-pmx-glass-zone='shellFrame'\][\s\S]*?border-bottom-width:\s*0 !important/);
    assert.match(bridgeCss, /--pmx-native-frame-bg:\s*var\(--sidebar\)[\s\S]*?background-image:\s*none;/);
    assert.match(bridgeCss, /html:has\(\[data-pmx-stage-frame='1'\]\)[\s\S]*?\[data-prismux-status-bar='true'\][\s\S]*?border-top-width:\s*0 !important/);
    assert.match(bridgeCss, /html:has\(\[data-pmx-stage-frame='1'\]\)\s*\[data-pmx-right-frame-edge='1'\][\s\S]*?border:\s*0 !important/);
    assert.match(bridgeCss, /html:has\(\[data-pmx-stage-frame='1'\]\)[\s\S]*?\[data-preview-panel-mode='inline'\][\s\S]*?border-left-width:\s*0 !important/);
    assert.match(bridgeCss, /--pmx-stage-frame-bg:\s*var\(--pmx-glass-zone-shell-frame-bg/);
    assert.match(bridgeCss, /--pmx-stage-frame-backdrop:\s*var\(--pmx-glass-zone-shell-frame-backdrop/);

    // Flush inner stage & 4 concave corners + pure-CSS fallback + continuous 1px ring
    assert.match(bridgeCss, /\[data-pmx-stage-frame='1'\]\s*\{[^}]*margin:\s*0 !important;[^}]*padding:\s*0 !important;/s);
    assert.match(bridgeCss, /\[data-pmx-stage-frame='1'\]\s*>\s*\[data-pmx-inner-stage='1'\][^}]*margin:\s*0 !important;/s);
    for (const corner of ['tl', 'tr', 'bl', 'br']) {
      assert.match(
        bridgeCss,
        new RegExp(`\\[data-pmx-stage-corner='${corner}'\\][^}]*clip-path:\\s*path\\(`, 's'),
        `must define exact SVG clip-path for concave corner '${corner}'`,
      );
    }
    assert.match(bridgeCss, /\[data-pmx-stage-frame='1'\]:not\(:has\(>\s*\[data-pmx-stage-corner\]\)\)::before[\s\S]*?radial-gradient/);
    assert.match(bridgeCss, /\[data-pmx-stage-frame='1'\]::after[\s\S]*?inset 0 0 0 1px/);
    assert.match(bridgeCss, /\[data-pmx-stage-frame='1'\]\[data-pmx-right-open='1'\]/);

    // Clear default mainCanvas fallback (no 18px blur fallback)
    assert.match(bridgeCss, /backdrop-filter:\s*var\(--pmx-glass-zone-main-canvas-backdrop,\s*none\);/);

    // All 3 solid fallbacks + forced-colors cover concave corners & right frame edge
    const fallbackSection = bridgeCss.slice(bridgeCss.indexOf('/* ── 7. Three Mandatory Solid Fallbacks'));
    assert.ok((fallbackSection.match(/\[data-pmx-stage-corner\]/g) ?? []).length >= 4);
    assert.ok((fallbackSection.match(/\[data-pmx-right-frame-edge='1'\]/g) ?? []).length >= 4);
    assert.ok((fallbackSection.match(/--pmx-glass-zone-shell-frame-bg:/g) ?? []).length >= 3);
    assert.ok((fallbackSection.match(/--pmx-stage-frame-backdrop:\s*none;/g) ?? []).length >= 3);
  });
});

describe('Global floating non-layout-shifting pointer-aware auto-hide scrollbars (#420)', () => {
  interface MockScrollNode extends ScrollableElementLike {
    attrs: Map<string, string>;
    classes: Set<string>;
    styleObj: ComputedOverflowStyleLike;
    children: MockScrollNode[];
  }

  function createMockScrollNode(opts: {
    tagName?: string;
    clientHeight?: number;
    scrollHeight?: number;
    clientWidth?: number;
    scrollWidth?: number;
    overflowY?: string;
    overflowX?: string;
    scrollbarWidth?: string;
    parent?: MockScrollNode | null;
    attrs?: Record<string, string>;
    classes?: string[];
  }): MockScrollNode {
    const attrs = new Map<string, string>(Object.entries(opts.attrs ?? {}));
    const classes = new Set<string>(opts.classes ?? []);
    const node: MockScrollNode = {
      nodeType: 1,
      tagName: opts.tagName ?? 'DIV',
      isConnected: true,
      clientHeight: opts.clientHeight ?? 300,
      scrollHeight: opts.scrollHeight ?? 300,
      clientWidth: opts.clientWidth ?? 400,
      scrollWidth: opts.scrollWidth ?? 400,
      parentElement: opts.parent ?? null,
      attrs,
      classes,
      styleObj: {
        ...(opts.overflowY !== undefined ? { overflowY: opts.overflowY } : {}),
        ...(opts.overflowX !== undefined ? { overflowX: opts.overflowX } : {}),
        ...(opts.scrollbarWidth !== undefined ? { scrollbarWidth: opts.scrollbarWidth } : {}),
      },
      children: [],
      classList: {
        contains: (token: string) => classes.has(token),
      },
      getAttribute: (name: string) => attrs.get(name) ?? null,
      setAttribute: (name: string, value: string) => {
        attrs.set(name, value);
      },
      removeAttribute: (name: string) => {
        attrs.delete(name);
      },
      querySelector: (selector: string) => {
        if (selector === '[data-slot="scroll-area-scrollbar"]') {
          return node.children.find((child) => child.attrs.get('data-slot') === 'scroll-area-scrollbar') ?? null;
        }
        return null;
      },
    };
    if (opts.parent) {
      opts.parent.children.push(node);
    }
    return node;
  }

  function createMockScrollbarDocument() {
    const docListeners = new Map<string, Set<(ev: FloatingScrollbarEventLike) => void>>();
    const htmlListeners = new Map<string, Set<(ev: FloatingScrollbarEventLike) => void>>();
    const winListeners = new Map<string, Set<(ev: FloatingScrollbarEventLike) => void>>();
    const htmlAttrs = new Map<string, string>();

    const add = (
      map: Map<string, Set<(ev: FloatingScrollbarEventLike) => void>>,
      type: string,
      fn: (ev: FloatingScrollbarEventLike) => void,
    ) => {
      let set = map.get(type);
      if (!set) {
        set = new Set();
        map.set(type, set);
      }
      set.add(fn);
    };
    const remove = (
      map: Map<string, Set<(ev: FloatingScrollbarEventLike) => void>>,
      type: string,
      fn: (ev: FloatingScrollbarEventLike) => void,
    ) => {
      map.get(type)?.delete(fn);
    };
    const emit = (
      map: Map<string, Set<(ev: FloatingScrollbarEventLike) => void>>,
      type: string,
      target: unknown,
    ) => {
      for (const fn of map.get(type) ?? []) {
        fn({ target });
      }
    };

    const doc: FloatingScrollbarDocumentLike = {
      documentElement: {
        setAttribute: (name, value) => htmlAttrs.set(name, value),
        removeAttribute: (name) => htmlAttrs.delete(name),
        addEventListener: (type, fn) => add(htmlListeners, type, fn),
        removeEventListener: (type, fn) => remove(htmlListeners, type, fn),
      },
      defaultView: {
        getComputedStyle: (el) => (el as MockScrollNode).styleObj ?? null,
        addEventListener: (type, fn) => add(winListeners, type, fn),
        removeEventListener: (type, fn) => remove(winListeners, type, fn),
      },
      addEventListener: (type, fn) => add(docListeners, type, fn),
      removeEventListener: (type, fn) => remove(docListeners, type, fn),
    };

    return {
      doc,
      htmlAttrs,
      docListeners,
      htmlListeners,
      winListeners,
      dispatchDoc: (type: string, target: unknown) => emit(docListeners, type, target),
      dispatchHtml: (type: string, target: unknown) => emit(htmlListeners, type, target),
      dispatchWin: (type: string, target: unknown) => emit(winListeners, type, target),
    };
  }

  it('accurately detects scrollable containers and resolves strictly the nearest scrollable ancestor', () => {
    const getStyle = (el: ScrollableElementLike) => (el as MockScrollNode).styleObj;

    const root = createMockScrollNode({ clientHeight: 900, scrollHeight: 900, overflowY: 'hidden' });
    const outerChat = createMockScrollNode({
      parent: root,
      clientHeight: 600,
      scrollHeight: 2400,
      overflowY: 'auto',
    });
    const innerCode = createMockScrollNode({
      tagName: 'PRE',
      parent: outerChat,
      clientWidth: 500,
      scrollWidth: 1200,
      clientHeight: 160,
      scrollHeight: 160,
      overflowX: 'auto',
      overflowY: 'hidden',
    });
    const codeSpan = createMockScrollNode({
      tagName: 'SPAN',
      parent: innerCode,
      clientHeight: 20,
      scrollHeight: 20,
      overflowY: 'visible',
    });
    const textNodeLike = { nodeType: 3, parentElement: codeSpan };

    const plainTextRow = createMockScrollNode({
      parent: outerChat,
      clientHeight: 40,
      scrollHeight: 41, // <= 1px subpixel tolerance must NOT count as scrollable
      overflowY: 'auto',
    });

    const hiddenStrip = createMockScrollNode({
      parent: root,
      clientWidth: 300,
      scrollWidth: 900,
      overflowX: 'auto',
      classes: ['scrollbar-none'],
    });

    const iframe = createMockScrollNode({
      tagName: 'IFRAME',
      parent: root,
      clientHeight: 300,
      scrollHeight: 900,
      overflowY: 'auto',
    });

    // Base UI ScrollArea with visible overlay scrollbar vs hideScrollbars
    const scrollAreaWithBar = createMockScrollNode({ parent: root, attrs: { 'data-slot': 'scroll-area' } });
    const scrollAreaViewport = createMockScrollNode({
      parent: scrollAreaWithBar,
      clientHeight: 240,
      scrollHeight: 800,
      overflowY: 'auto',
      scrollbarWidth: 'none',
      attrs: { 'data-slot': 'scroll-area-viewport' },
    });
    createMockScrollNode({
      parent: scrollAreaWithBar,
      attrs: { 'data-slot': 'scroll-area-scrollbar' },
    });

    const scrollAreaHidden = createMockScrollNode({ parent: root, attrs: { 'data-slot': 'scroll-area' } });
    const scrollAreaHiddenViewport = createMockScrollNode({
      parent: scrollAreaHidden,
      clientHeight: 240,
      scrollHeight: 800,
      overflowY: 'auto',
      scrollbarWidth: 'none',
      attrs: { 'data-slot': 'scroll-area-viewport' },
    });

    assert.equal(isElementScrollable(outerChat, getStyle), true);
    assert.equal(isElementScrollable(innerCode, getStyle), true);
    assert.equal(isElementScrollable(plainTextRow, getStyle), false);
    assert.equal(isElementScrollable(hiddenStrip, getStyle), false);
    assert.equal(isElementScrollable(iframe, getStyle), false);
    assert.equal(isElementScrollable(scrollAreaViewport, getStyle), true);
    assert.equal(isElementScrollable(scrollAreaHiddenViewport, getStyle), false);

    // Nearest scrollable ancestor resolution (text node inside innerCode -> innerCode, NOT outerChat)
    assert.equal(findNearestScrollableContainer(textNodeLike, undefined, getStyle), innerCode);
    assert.equal(findNearestScrollableContainer(plainTextRow, undefined, getStyle), outerChat);
    assert.equal(findNearestScrollableContainer(hiddenStrip, undefined, getStyle), null);
  });

  it('isolates pointer illumination to the active pane, auto-hides after hover/scroll delays, guards drags, and disposes cleanly', async () => {
    // SSR-safe null document guard
    const noopHandle = installPrismuxFloatingScrollbars(null);
    assert.equal(noopHandle.getActiveElement(), null);
    noopHandle.dispose();

    const env = createMockScrollbarDocument();
    const root = createMockScrollNode({ clientHeight: 900, scrollHeight: 900, overflowY: 'hidden' });
    const header = createMockScrollNode({ parent: root, clientHeight: 38, scrollHeight: 38, overflowY: 'hidden' });
    const paneLeft = createMockScrollNode({ parent: root, clientHeight: 600, scrollHeight: 1800, overflowY: 'auto' });
    const leftItem = createMockScrollNode({ parent: paneLeft, clientHeight: 32, scrollHeight: 32 });
    const paneRight = createMockScrollNode({ parent: root, clientHeight: 600, scrollHeight: 1400, overflowY: 'auto' });
    const rightItem = createMockScrollNode({ parent: paneRight, clientHeight: 32, scrollHeight: 32 });

    assert.equal(DEFAULT_SCROLL_HOVER_HIDE_DELAY_MS, 450);
    assert.equal(DEFAULT_SCROLL_ACTIVE_HIDE_DELAY_MS, 800);

    const handle = installPrismuxFloatingScrollbars(env.doc, {
      hoverHideDelayMs: 35,
      scrollHideDelayMs: 45,
    });

    assert.equal(env.htmlAttrs.get(PMX_FLOATING_SCROLLBARS_ROOT_ATTR), '1');
    // Idle: neither pane illuminated
    assert.equal(paneLeft.attrs.has(PMX_SCROLL_ACTIVE_ATTR), false);
    assert.equal(paneRight.attrs.has(PMX_SCROLL_ACTIVE_ATTR), false);

    // 1. Hover paneLeft -> ONLY paneLeft illuminated, sibling paneRight stays hidden
    env.dispatchDoc('pointermove', leftItem);
    assert.equal(handle.getActiveElement(), paneLeft);
    assert.equal(paneLeft.attrs.get(PMX_SCROLL_ACTIVE_ATTR), '1');
    assert.equal(paneRight.attrs.has(PMX_SCROLL_ACTIVE_ATTR), false);

    // 2. Move directly to paneRight -> paneLeft immediately clears, ONLY paneRight illuminated
    env.dispatchDoc('pointermove', rightItem);
    assert.equal(handle.getActiveElement(), paneRight);
    assert.equal(paneLeft.attrs.has(PMX_SCROLL_ACTIVE_ATTR), false);
    assert.equal(paneRight.attrs.get(PMX_SCROLL_ACTIVE_ATTR), '1');

    // 3. Move to non-scrollable header -> stays gently lit until hoverHideDelayMs expires, then hides
    env.dispatchDoc('pointermove', header);
    assert.equal(handle.getActiveElement(), null);
    assert.equal(paneRight.attrs.get(PMX_SCROLL_ACTIVE_ATTR), '1');
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(paneRight.attrs.has(PMX_SCROLL_ACTIVE_ATTR), false);

    // 4. Dragging scrollbar thumb keeps pane active even if pointer drifts outside until pointerup
    env.dispatchDoc('pointerdown', paneLeft);
    assert.equal(paneLeft.attrs.get(PMX_SCROLL_ACTIVE_ATTR), '1');
    env.dispatchDoc('pointermove', header);
    await new Promise((r) => setTimeout(r, 55));
    assert.equal(paneLeft.attrs.get(PMX_SCROLL_ACTIVE_ATTR), '1');
    env.dispatchDoc('pointerup', header);
    await new Promise((r) => setTimeout(r, 55));
    assert.equal(paneLeft.attrs.has(PMX_SCROLL_ACTIVE_ATTR), false);

    // 5. Scroll event sets data-pmx-scroll-scrolling="1" and auto-hides after scrollHideDelayMs
    env.dispatchDoc('scroll', paneRight);
    assert.equal(paneRight.attrs.get(PMX_SCROLL_SCROLLING_ATTR), '1');
    await new Promise((r) => setTimeout(r, 70));
    assert.equal(paneRight.attrs.has(PMX_SCROLL_SCROLLING_ATTR), false);

    // 6. Dispose cleans up active/scrolling attributes, root attribute, and all listeners (idempotent)
    env.dispatchDoc('pointermove', leftItem);
    env.dispatchDoc('scroll', paneRight);
    handle.dispose();
    handle.dispose();

    assert.equal(env.htmlAttrs.has(PMX_FLOATING_SCROLLBARS_ROOT_ATTR), false);
    assert.equal(paneLeft.attrs.has(PMX_SCROLL_ACTIVE_ATTR), false);
    assert.equal(paneRight.attrs.has(PMX_SCROLL_SCROLLING_ATTR), false);
    for (const set of env.docListeners.values()) assert.equal(set.size, 0);
    for (const set of env.htmlListeners.values()) assert.equal(set.size, 0);
    for (const set of env.winListeners.values()) assert.equal(set.size, 0);
  });

  it('bundles low-presence 4px floating scrollbar CSS with zero layout shift & zero prefers-color-scheme', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const sbCss = fs.readFileSync(path.resolve(here, '../styles/floating-scrollbar.css'), 'utf8');
    const builtStylesCss = fs.readFileSync(path.resolve(here, '../styles.css'), 'utf8');

    assert.equal((sbCss.match(/\{/g) ?? []).length, (sbCss.match(/\}/g) ?? []).length);
    assert.equal(sbCss.replace(/\/\*[\s\S]*?\*\//g, '').includes('prefers-color-scheme'), false);

    // 4px visual pill via 8px track + 2px transparent border + background-clip: content-box
    assert.match(sbCss, /--pmx-scrollbar-size:\s*8px;/);
    assert.match(sbCss, /border:\s*2px solid transparent;/);
    assert.match(sbCss, /border-radius:\s*999px;/);
    assert.match(sbCss, /background-clip:\s*content-box;/);
    assert.match(sbCss, /::-webkit-scrollbar-button\s*\{[^}]*display:\s*none;/s);
    assert.match(sbCss, /rgba\(255,\s*255,\s*255,\s*0\.16\)/);
    assert.match(sbCss, /rgba\(255,\s*255,\s*255,\s*0\.34\)/);
    assert.match(sbCss, /rgba\(15,\s*23,\s*42,\s*0\.16\)/);
    assert.match(sbCss, /rgba\(15,\s*23,\s*42,\s*0\.34\)/);
    assert.match(sbCss, /\[data-pmx-scroll-active='1'\]/);
    assert.match(sbCss, /\[data-pmx-scroll-scrolling='1'\]/);
    assert.match(sbCss, /:not\(\[data-slot='scroll-area-viewport'\]\)/);
    assert.match(sbCss, /\[data-slot='scroll-area-scrollbar'\]/);
    assert.match(sbCss, /@media \(forced-colors: active\)/);

    // Bundled in dist/styles.css
    assert.match(builtStylesCss, /floating-scrollbar\.css/);
    assert.match(builtStylesCss, /\[data-pmx-floating-scrollbars='1'\]/);
  });
});

describe('Wallpaper color fidelity & natural frosted glass saturation (#454)', () => {
  it('calibrates all 6 glass zones to natural 105%-115% default saturation with zero brightness distortion', () => {
    assert.ok(
      GLASS_ZONE_LIMITS.defaultSaturation >= 105 && GLASS_ZONE_LIMITS.defaultSaturation <= 115,
      `defaultSaturation must stay within 105-115%, got ${GLASS_ZONE_LIMITS.defaultSaturation}`,
    );

    for (const meta of GLASS_ZONE_META) {
      assert.ok(
        meta.defaultSaturation >= 105 && meta.defaultSaturation <= 115,
        `zone '${meta.id}' defaultSaturation must stay within 105-115%, got ${meta.defaultSaturation}`,
      );
    }

    for (const polarity of ['dark', 'light'] as const) {
      for (const preset of ['light', 'balanced', 'clear'] as const) {
        const cfg = normalizeAppearanceConfig({
          themeMode: 'glass',
          glassBasePolarity: polarity,
          glassPreset: preset,
        });
        const rt = resolveAppearanceRuntime(cfg);

        for (const id of GLASS_ZONE_IDS) {
          const z = rt.zones[id];
          assert.equal(
            z.backdropCss.includes('brightness('),
            false,
            `zone '${id}' (${polarity}/${preset}) backdropCss must not apply brightness() distortion: ${z.backdropCss}`,
          );
          if (z.blurPx > 0) {
            assert.match(z.backdropCss, /^blur\(\d+px\) saturate\((?:1\.0[58]|1\.10)\)$/);
          }
        }
      }
    }
  });

  it('keeps default mainCanvas strictly achromatic (zero warm/tinted cast) even when glass tint is colored, while preserving custom overrides', () => {
    const warmTintedDark = normalizeAppearanceConfig({
      themeMode: 'glass',
      glassBasePolarity: 'dark',
      glassPreset: 'balanced',
      glassColor: '#ff9b42',
      glassDarkSeparate: true,
      glassDarkColor: '#0d1524',
    });
    const rtDark = resolveAppearanceRuntime(warmTintedDark);
    assert.equal(rtDark.zones.mainCanvas.backdropCss, 'none');
    assert.equal(rtDark.zones.mainCanvas.sheenCss, 'none');
    assert.match(
      rtDark.zones.mainCanvas.bgCss,
      /^rgba\(0, 0, 0, (?:0\.0[2-9]\d|0\.1[0-2]\d)\)$/,
      `default dark mainCanvas must stay strictly achromatic black veil, got ${rtDark.zones.mainCanvas.bgCss}`,
    );

    const warmTintedLight = normalizeAppearanceConfig({
      themeMode: 'glass',
      glassBasePolarity: 'light',
      glassPreset: 'balanced',
      glassColor: '#ff9b42',
    });
    const rtLight = resolveAppearanceRuntime(warmTintedLight);
    assert.equal(rtLight.zones.mainCanvas.backdropCss, 'none');
    assert.equal(rtLight.zones.mainCanvas.sheenCss, 'none');
    assert.match(
      rtLight.zones.mainCanvas.bgCss,
      /^rgba\(255, 255, 255, (?:0\.0[2-9]\d|0\.1[0-2]\d)\)$/,
      `default light mainCanvas must stay strictly achromatic white veil, got ${rtLight.zones.mainCanvas.bgCss}`,
    );

    // Custom user saturation & custom mainCanvas tint remain fully customizable
    const customMain = updateGlassZone(warmTintedDark, 'mainCanvas', {
      mode: 'custom',
      opacity: 20,
      blurPx: 10,
      saturation: 145,
      tint: '#224466',
    });
    const rtCustom = resolveAppearanceRuntime(customMain);
    assert.equal(rtCustom.zones.mainCanvas.backdropCss, 'blur(10px) saturate(1.45)');
    assert.notEqual(rtCustom.zones.mainCanvas.bgCss, rtDark.zones.mainCanvas.bgCss);
  });

  it('removes oversaturated 1.4-1.65 and brightness() backdrop fallbacks from all appearance stylesheets', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const bridgeCss = fs.readFileSync(path.resolve(here, '../styles/t3-glass-bridge.css'), 'utf8');
    const cardsCss = fs.readFileSync(path.resolve(here, '../styles/appearance-cards.css'), 'utf8');
    const popoverCss = fs.readFileSync(path.resolve(here, '../styles/color-popover.css'), 'utf8');

    for (const [name, css] of [
      ['t3-glass-bridge.css', bridgeCss],
      ['appearance-cards.css', cardsCss],
      ['color-popover.css', popoverCss],
    ] as const) {
      assert.doesNotMatch(
        css,
        /backdrop-filter:[^;]*saturate\(1\.[4-9]/,
        `${name} must not hardcode oversaturated backdrop-filter >= 1.4`,
      );
      assert.doesNotMatch(
        css,
        /backdrop-filter:[^;]*brightness\(/,
        `${name} must not append brightness() onto backdrop-filter`,
      );
    }
  });
});

describe('Single-layer viewport SVG <mask> shell cutout backdrop (#468)', () => {
  interface MockCutoutNode extends ShellCutoutElementLike {
    readonly tagName: string;
    readonly attrs: Map<string, string>;
    readonly styleMap: Map<string, string>;
    readonly children: MockCutoutNode[];
    parent: MockCutoutNode | null;
    rect: { left: number; top: number; width: number; height: number };
    visibility?: string;
    display?: string;
  }

  function createMockCutoutNode(
    tagName: string,
    rect = { left: 0, top: 0, width: 0, height: 0 },
  ): MockCutoutNode {
    const attrs = new Map<string, string>();
    const styleMap = new Map<string, string>();
    const children: MockCutoutNode[] = [];
    const node: MockCutoutNode = {
      nodeType: 1,
      tagName: tagName.toUpperCase(),
      attrs,
      styleMap,
      children,
      parent: null,
      rect,
      isConnected: true,
      style: {
        setProperty(name: string, value: string) {
          styleMap.set(name, value);
        },
        removeProperty(name: string) {
          styleMap.delete(name);
        },
        getPropertyValue(name: string) {
          return styleMap.get(name) ?? '';
        },
      },
      getBoundingClientRect() {
        return {
          left: node.rect.left,
          top: node.rect.top,
          width: node.rect.width,
          height: node.rect.height,
          right: node.rect.left + node.rect.width,
          bottom: node.rect.top + node.rect.height,
        };
      },
      getAttribute(name: string) {
        return attrs.get(name) ?? null;
      },
      setAttribute(name: string, value: string) {
        attrs.set(name, String(value));
      },
      removeAttribute(name: string) {
        attrs.delete(name);
      },
      appendChild(child: unknown) {
        const c = child as MockCutoutNode;
        c.parent = node;
        children.push(c);
        return c;
      },
      remove() {
        if (node.parent) {
          const idx = node.parent.children.indexOf(node);
          if (idx >= 0) node.parent.children.splice(idx, 1);
          node.parent = null;
        }
      },
      closest(selector: string) {
        if (
          selector.includes('[data-pmx-stage-frame="1"]') &&
          attrs.get('data-pmx-stage-frame') === '1'
        ) {
          return node;
        }
        if (
          selector.includes('[data-slot="sidebar-gap"]') &&
          attrs.get('data-slot') === 'sidebar-gap'
        ) {
          return node;
        }
        if (
          selector.includes('[data-preview-panel-mode="inline"]') &&
          attrs.get('data-preview-panel-mode') === 'inline'
        ) {
          return node;
        }
        return null;
      },
    };
    return node;
  }

  function createMockCutoutEnv(viewport = { width: 1440, height: 900 }) {
    const htmlAttrs = new Map<string, string>();
    const html = {
      clientWidth: viewport.width,
      clientHeight: viewport.height,
      getAttribute: (name: string) => htmlAttrs.get(name) ?? null,
      setAttribute: (name: string, value: string) => {
        htmlAttrs.set(name, value);
      },
      removeAttribute: (name: string) => {
        htmlAttrs.delete(name);
      },
    };
    const body = createMockCutoutNode('body', {
      left: 0,
      top: 0,
      width: viewport.width,
      height: viewport.height,
    });
    const stageNodes: MockCutoutNode[] = [];
    const rightNodes: MockCutoutNode[] = [];
    const sidebarNodes: MockCutoutNode[] = [];
    const docListeners = new Map<string, Set<(event: unknown) => void>>();
    const winListeners = new Map<string, Set<(event: unknown) => void>>();
    const rafQueue = new Map<number, (ts: number) => void>();
    let nextRafId = 1;
    let fakeNow = 1000;
    let stageRadiusCss = '14px';

    const resizeCallbacks: Array<() => void> = [];
    const observedResize = new Set<unknown>();
    const mutationCallbacks: Array<(records: MutationRecord[]) => void> = [];
    let resizeDisconnected = false;
    let mutationDisconnectedCount = 0;

    class MockResizeObserver {
      private cb: () => void;
      constructor(cb: () => void) {
        this.cb = cb;
        resizeCallbacks.push(cb);
      }
      observe(target: Element) {
        observedResize.add(target);
      }
      unobserve(target: Element) {
        observedResize.delete(target);
      }
      disconnect() {
        resizeDisconnected = true;
        observedResize.clear();
        const idx = resizeCallbacks.indexOf(this.cb);
        if (idx >= 0) resizeCallbacks.splice(idx, 1);
      }
    }

    class MockMutationObserver {
      private cb: (records: MutationRecord[]) => void;
      constructor(cb: (records: MutationRecord[]) => void) {
        this.cb = cb;
        mutationCallbacks.push(cb);
      }
      observe() {}
      disconnect() {
        mutationDisconnectedCount += 1;
        const idx = mutationCallbacks.indexOf(this.cb);
        if (idx >= 0) mutationCallbacks.splice(idx, 1);
      }
      takeRecords() {
        return [];
      }
    }

    const addMapListener = (
      map: Map<string, Set<(e: unknown) => void>>,
      type: string,
      fn: (e: unknown) => void,
    ) => {
      let set = map.get(type);
      if (!set) {
        set = new Set();
        map.set(type, set);
      }
      set.add(fn);
    };
    const removeMapListener = (
      map: Map<string, Set<(e: unknown) => void>>,
      type: string,
      fn: (e: unknown) => void,
    ) => {
      map.get(type)?.delete(fn);
    };

    const win = {
      innerWidth: viewport.width,
      innerHeight: viewport.height,
      getComputedStyle: (el: unknown) => {
        if (el === html) {
          return {
            getPropertyValue: (prop: string) =>
              prop === '--pmx-inner-stage-radius' ? stageRadiusCss : '',
          };
        }
        const node = el as MockCutoutNode;
        return {
          getPropertyValue: () => '',
          visibility: node?.visibility ?? 'visible',
          display: node?.display ?? 'flex',
        };
      },
      requestAnimationFrame: (cb: (ts: number) => void) => {
        const id = nextRafId++;
        rafQueue.set(id, cb);
        return id;
      },
      cancelAnimationFrame: (id: number) => {
        rafQueue.delete(id);
      },
      addEventListener: (type: string, fn: (e: unknown) => void) =>
        addMapListener(winListeners, type, fn),
      removeEventListener: (type: string, fn: (e: unknown) => void) =>
        removeMapListener(winListeners, type, fn),
      ResizeObserver: MockResizeObserver as unknown as typeof ResizeObserver,
      MutationObserver: MockMutationObserver as unknown as typeof MutationObserver,
    };

    const doc: ShellCutoutDocumentLike = {
      documentElement: html,
      body: {
        appendChild: (child: unknown) => body.appendChild!(child),
        querySelectorAll: (selector: string) => {
          return body.children.filter((c) => {
            if (
              selector.includes(`[${PMX_SHELL_BACKDROP_ATTR}="1"]`) &&
              c.getAttribute?.(PMX_SHELL_BACKDROP_ATTR) === '1'
            ) {
              return true;
            }
            if (
              selector.includes(`[${PMX_SHELL_CUTOUT_SVG_ATTR}="1"]`) &&
              c.getAttribute?.(PMX_SHELL_CUTOUT_SVG_ATTR) === '1'
            ) {
              return true;
            }
            return false;
          });
        },
      },
      defaultView: win,
      createElement: (tag: string) => createMockCutoutNode(tag),
      createElementNS: (_ns: string, tag: string) => createMockCutoutNode(tag),
      querySelectorAll: (selector: string) => {
        if (selector === '[data-pmx-stage-frame="1"]') return stageNodes;
        if (selector === '[data-preview-panel-mode="inline"]') return rightNodes;
        if (selector.includes('sidebar-gap')) return sidebarNodes;
        return [];
      },
      addEventListener: (type: string, fn: (e: unknown) => void) =>
        addMapListener(docListeners, type, fn),
      removeEventListener: (type: string, fn: (e: unknown) => void) =>
        removeMapListener(docListeners, type, fn),
    };

    const flushRaf = (advanceMs = 16) => {
      fakeNow += advanceMs;
      const entries = Array.from(rafQueue.entries());
      rafQueue.clear();
      for (const [, cb] of entries) {
        cb(fakeNow);
      }
    };

    return {
      doc,
      html,
      htmlAttrs,
      body,
      win,
      stageNodes,
      rightNodes,
      sidebarNodes,
      docListeners,
      winListeners,
      observedResize,
      flushRaf,
      triggerResize: () => {
        for (const cb of [...resizeCallbacks]) cb();
      },
      triggerRootAttrMutation: () => {
        for (const cb of [...mutationCallbacks]) cb([]);
      },
      dispatchDoc: (type: string, event: unknown) => {
        for (const fn of [...(docListeners.get(type) ?? [])]) fn(event);
      },
      dispatchWin: (type: string, event: unknown) => {
        for (const fn of [...(winListeners.get(type) ?? [])]) fn(event);
      },
      setStageRadiusCss: (val: string) => {
        stageRadiusCss = val;
      },
      getNow: () => fakeNow,
      isResizeDisconnected: () => resizeDisconnected,
      getMutationDisconnectedCount: () => mutationDisconnectedCount,
      getPendingRafCount: () => rafQueue.size,
    };
  }

  it('computes subpixel-tucked rounded stage holes, split-pane holes, and right-sidebar cutout separation accurately', () => {
    // 1. Glass mode + rightSidebar inherit -> 1 stage hole with 0.5px tuck, 0 right-sidebar holes
    const gInherit = computeShellCutoutGeometry({
      viewportWidth: 1440,
      viewportHeight: 900,
      stageRects: [{ x: 240, y: 38, width: 1193, height: 842 }],
      stageRadiusPx: 14,
      glassActive: true,
      rightSidebarMode: 'inherit',
      rightSidebarFullClear: false,
      rightSidebarRects: [{ x: 1080, y: 38, width: 360, height: 842 }],
    });
    assert.equal(gInherit.active, true);
    assert.equal(gInherit.stageHoles.length, 1);
    assert.deepEqual(gInherit.stageHoles[0], {
      x: 240.5,
      y: 38.5,
      width: 1192,
      height: 841,
      rx: 13.5,
      ry: 13.5,
    });
    assert.equal(gInherit.rightSidebarHoles.length, 0, 'inherit rightSidebar must share single shell sheet');

    // 2. Glass mode + rightSidebar custom / solid / fullClear -> punches crisp secondary hole so 0 double-blur occurs
    for (const variant of [
      { rightSidebarMode: 'custom', rightSidebarFullClear: false },
      { rightSidebarMode: 'solid', rightSidebarFullClear: false },
      { rightSidebarMode: 'inherit', rightSidebarFullClear: true },
    ]) {
      const gSep = computeShellCutoutGeometry({
        viewportWidth: 1440,
        viewportHeight: 900,
        stageRects: [{ x: 240, y: 38, width: 840, height: 842 }],
        stageRadiusPx: 14,
        glassActive: true,
        ...variant,
        rightSidebarRects: [{ x: 1080, y: 38, width: 360, height: 842 }],
      });
      assert.equal(gSep.active, true);
      assert.equal(gSep.rightSidebarHoles.length, 1);
      assert.deepEqual(gSep.rightSidebarHoles[0], {
        x: 1080,
        y: 38,
        width: 360,
        height: 842,
      });
    }

    // 3. Non-glass mode (even when data-pmx-zone-right-sidebar-mode="solid") -> shares single sheet (0 right holes)
    const gNonGlass = computeShellCutoutGeometry({
      viewportWidth: 1440,
      viewportHeight: 900,
      stageRects: [{ x: 240, y: 38, width: 840, height: 842 }],
      stageRadiusPx: 14,
      glassActive: false,
      rightSidebarMode: 'solid',
      rightSidebarRects: [{ x: 1080, y: 38, width: 360, height: 842 }],
    });
    assert.equal(gNonGlass.active, true);
    assert.equal(gNonGlass.rightSidebarHoles.length, 0);

    // 4. Multi-pane split layout -> punches one rounded hole per visible stage frame
    const gSplit = computeShellCutoutGeometry({
      viewportWidth: 1440,
      viewportHeight: 900,
      stageRects: [
        { x: 240, y: 38, width: 590, height: 842 },
        { x: 836, y: 38, width: 597, height: 842 },
        { x: 0, y: 0, width: 0, height: 0 }, // hidden pane ignored
      ],
      stageRadiusPx: 14,
      glassActive: true,
      rightSidebarMode: 'inherit',
    });
    assert.equal(gSplit.active, true);
    assert.equal(gSplit.stageHoles.length, 2);

    // 5. No visible stage frame (Welcome / Pair / maximized preview) -> deactivates cleanly
    const gEmpty = computeShellCutoutGeometry({
      viewportWidth: 1440,
      viewportHeight: 900,
      stageRects: [{ x: 0, y: 0, width: 0, height: 0 }],
      glassActive: true,
    });
    assert.equal(gEmpty.active, false);
    assert.equal(gEmpty.stageHoles.length, 0);
  });

  it('installs SVG <mask> backdrop, tracks resize/attributes/transitions, deactivates on non-stage views, and disposes with zero leaks', () => {
    const env = createMockCutoutEnv({ width: 1440, height: 900 });
    env.htmlAttrs.set('data-pmx-glass', '1');
    env.htmlAttrs.set('data-pmx-zone-right-sidebar-mode', 'inherit');

    const stageEl = createMockCutoutNode('div', { left: 240, top: 38, width: 1193, height: 842 });
    stageEl.setAttribute('data-pmx-stage-frame', '1');
    env.stageNodes.push(stageEl);

    const rightEl = createMockCutoutNode('div', { left: 1080, top: 38, width: 360, height: 842 });
    rightEl.setAttribute('data-preview-panel-mode', 'inline');
    env.rightNodes.push(rightEl);

    const sidebarGapEl = createMockCutoutNode('div', { left: 0, top: 0, width: 240, height: 880 });
    sidebarGapEl.setAttribute('data-slot', 'sidebar-gap');
    env.sidebarNodes.push(sidebarGapEl);

    const handle = installPrismuxShellCutout(env.doc, { now: env.getNow });

    // 1. Injected SVG + backdrop div exist in body with exact mask wiring & active root flag
    assert.equal(handle.isActive(), true);
    assert.equal(env.htmlAttrs.get(PMX_SHELL_CUTOUT_ROOT_ATTR), '1');

    const svgEl = env.body.children.find((c) => c.getAttribute?.(PMX_SHELL_CUTOUT_SVG_ATTR) === '1');
    const backdropEl = env.body.children.find(
      (c) => c.getAttribute?.(PMX_SHELL_BACKDROP_ATTR) === '1',
    );
    assert.ok(svgEl, 'must inject inline SVG mask host');
    assert.ok(backdropEl, 'must inject single continuous backdrop div');
    assert.equal(backdropEl.getAttribute?.(PMX_CUTOUT_ACTIVE_ATTR), '1');
    assert.equal(backdropEl.styleMap.get('mask-image'), `url(#${PMX_SHELL_CUTOUT_MASK_ID})`);
    assert.equal(
      backdropEl.styleMap.get('-webkit-mask-image'),
      `url(#${PMX_SHELL_CUTOUT_MASK_ID})`,
    );

    const maskEl = svgEl.children[0]?.children[0];
    assert.ok(maskEl, 'must construct <defs><mask>');
    assert.equal(maskEl.getAttribute?.('id'), PMX_SHELL_CUTOUT_MASK_ID);
    assert.equal(maskEl.getAttribute?.('maskUnits'), 'userSpaceOnUse');
    assert.equal(maskEl.getAttribute?.('width'), '1440');
    assert.equal(maskEl.getAttribute?.('height'), '900');

    // White base rect + 1 black rounded stage rect (0 right rects while inherit)
    const stageRects1 = maskEl.children.filter((c) => c.getAttribute?.('data-pmx-cutout-stage') !== null);
    const rightRects1 = maskEl.children.filter((c) => c.getAttribute?.('data-pmx-cutout-right') !== null);
    assert.equal(stageRects1.length, 1);
    assert.equal(rightRects1.length, 0);
    assert.equal(stageRects1[0]!.getAttribute?.('x'), '240.5');
    assert.equal(stageRects1[0]!.getAttribute?.('y'), '38.5');
    assert.equal(stageRects1[0]!.getAttribute?.('width'), '1192');
    assert.equal(stageRects1[0]!.getAttribute?.('height'), '841');
    assert.equal(stageRects1[0]!.getAttribute?.('rx'), '13.5');
    assert.equal(stageRects1[0]!.getAttribute?.('ry'), '13.5');

    // 2. Switching rightSidebar zone to 'custom' dynamically adds crisp secondary cutout rect
    env.htmlAttrs.set('data-pmx-zone-right-sidebar-mode', 'custom');
    stageEl.rect = { left: 240, top: 38, width: 840, height: 842 };
    env.triggerRootAttrMutation();
    env.flushRaf();

    const rightRects2 = maskEl.children.filter((c) => c.getAttribute?.('data-pmx-cutout-right') !== null);
    assert.equal(rightRects2.length, 1);
    assert.equal(rightRects2[0]!.getAttribute?.('x'), '1080');
    assert.equal(rightRects2[0]!.getAttribute?.('width'), '360');
    assert.equal(rightRects2[0]!.getAttribute?.('shape-rendering'), 'crispEdges');

    // 3. Sidebar CSS width transition tracks frame-by-frame and stops cleanly on transitionend
    env.dispatchDoc('transitionrun', { propertyName: 'width', target: sidebarGapEl });
    stageEl.rect = { left: 120, top: 38, width: 960, height: 842 };
    env.flushRaf(16);
    assert.equal(stageRects1[0]!.getAttribute?.('x'), '120.5');
    assert.equal(stageRects1[0]!.getAttribute?.('width'), '959');
    env.dispatchDoc('transitionend', { propertyName: 'width', target: sidebarGapEl });
    env.flushRaf(16);
    assert.equal(env.getPendingRafCount(), 0, 'transition loop must halt with 0 idle rAFs after transitionend');

    // 4. Navigating to non-stage page (Welcome) deactivates backdrop cleanly
    env.stageNodes.length = 0;
    env.triggerResize();
    env.flushRaf();
    assert.equal(handle.isActive(), false);
    assert.equal(backdropEl.getAttribute?.(PMX_CUTOUT_ACTIVE_ATTR), '0');
    assert.equal(env.htmlAttrs.get(PMX_SHELL_CUTOUT_ROOT_ATTR), undefined);

    // 5. Idempotent disposal removes all DOM nodes, attributes, listeners & observers
    handle.dispose();
    handle.dispose();
    assert.equal(env.body.children.length, 0, 'dispose must remove both <svg> and backdrop <div>');
    assert.equal(env.htmlAttrs.get(PMX_SHELL_CUTOUT_ROOT_ATTR), undefined);
    assert.equal(env.isResizeDisconnected(), true);
    assert.ok(env.getMutationDisconnectedCount() >= 2);
    assert.equal(env.winListeners.get('resize')?.size ?? 0, 0);
    assert.equal(env.docListeners.get('transitionrun')?.size ?? 0, 0);
  });

  it('defines single-layer continuous cutout CSS rules, hides legacy 4 corners, preserves peek drawer & all 3 solid fallbacks', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const bridgeCss = fs.readFileSync(path.resolve(here, '../styles/t3-glass-bridge.css'), 'utf8');

    // Balanced braces & zero prefers-color-scheme
    const opens = (bridgeCss.match(/\{/g) ?? []).length;
    const closes = (bridgeCss.match(/\}/g) ?? []).length;
    assert.equal(opens, closes, 't3-glass-bridge.css braces must stay balanced');
    assert.doesNotMatch(bridgeCss, /prefers-color-scheme/);

    // Section 2.7 single-layer continuous backdrop & active cutout rules
    assert.match(
      bridgeCss,
      /\[data-pmx-shell-backdrop='1'\]\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*z-index:\s*0;[^}]*pointer-events:\s*none;[^}]*display:\s*none;/s,
    );
    assert.match(bridgeCss, /\[data-pmx-shell-backdrop='1'\]\[data-pmx-cutout-active='1'\]\s*\{\s*display:\s*block;\s*\}/);
    assert.match(
      bridgeCss,
      /html\[data-pmx-glass='1'\]\s*\[data-pmx-shell-backdrop='1'\][\s\S]*?--pmx-glass-zone-shell-frame-bg[\s\S]*?--pmx-glass-zone-shell-frame-backdrop/,
    );
    assert.match(
      bridgeCss,
      /html\[data-pmx-shell-cutout='1'\][\s\S]*?\[data-workspace-tabbar\][\s\S]*?\[data-prismux-status-bar\][\s\S]*?\[data-pmx-right-frame-edge='1'\][\s\S]*?background-color:\s*transparent !important;[\s\S]*?backdrop-filter:\s*none !important;/,
    );
    assert.match(
      bridgeCss,
      /html\[data-pmx-shell-cutout='1'\]\s*\[data-pmx-stage-frame='1'\]\s*>\s*\[data-pmx-stage-corner\][\s\S]*?display:\s*none !important;/,
    );
    // Floating collapsed sidebar peek drawer & mobile sheet stay excluded from cutout transparentization
    assert.match(
      bridgeCss,
      /\[data-pmx-glass-zone='shellFrame'\]:not\(\[data-pmx-sidebar-peek='1'\]\):not\(\[data-mobile='true'\]\)/,
    );
    // Inline right sidebar inherits continuous sheet in Glass inherit & Non-Glass modes
    assert.match(
      bridgeCss,
      /html\[data-pmx-shell-cutout='1'\]\[data-pmx-glass='1'\]:is\([\s\S]*?\[data-pmx-zone-right-sidebar-mode='inherit'\][\s\S]*?\):not\(\[data-pmx-right-sidebar-fullclear='1'\]\)[\s\S]*?\[data-preview-panel-mode='inline'\]/,
    );

    // All 3 mandatory solid fallbacks + forced-colors explicitly cover [data-pmx-shell-backdrop='1']
    const fallbackSection = bridgeCss.slice(
      bridgeCss.indexOf('/* ── 7. Three Mandatory Solid Fallbacks'),
    );
    assert.ok(
      (fallbackSection.match(/\[data-pmx-shell-backdrop='1'\]/g) ?? []).length >= 6,
      'every solid fallback path + forced-colors must cover [data-pmx-shell-backdrop="1"]',
    );
  });
});

describe('6th glass zone `workPanels` (Tasks / Workspace Board / Scheduled Tasks) & anti-whiteout bridge (#490)', () => {
  it('provides high-readability frosted defaults, emits --pmx-glass-work-panels-* tokens, supports custom/solid & migrates legacy 5-zone configs', () => {
    const html = createMockElement();
    const body = createMockElement();
    const doc: DocumentLike = { documentElement: html, body };

    // Legacy 5-zone config missing `workPanels` migrates cleanly to `{ mode: 'inherit' }`
    const migrated = normalizeAppearanceConfig({
      themeMode: 'glass',
      glassBasePolarity: 'dark',
      glassPreset: 'balanced',
      glassZones: {
        shellFrame: { mode: 'inherit' },
        rightSidebar: { mode: 'inherit' },
        mainCanvas: { mode: 'inherit' },
        composer: { mode: 'inherit' },
        overlays: { mode: 'inherit' },
      },
    });
    assert.deepEqual(migrated.glassZones.workPanels, { mode: 'inherit' });

    // Dark balanced default: readable frosted glass (>= 60% opacity, >= 16px blur), NOT bare mainCanvas
    const darkRt = applyPrismuxAppearanceToDocument(migrated, { document: doc, wallpaperActive: true });
    assert.equal(darkRt.zones.workPanels.effectiveMode, 'inherit');
    assert.ok(
      darkRt.zones.workPanels.opacity >= 60 && darkRt.zones.workPanels.opacity <= 90,
      `dark balanced workPanels opacity should be high-readability frosted glass, got ${darkRt.zones.workPanels.opacity}`,
    );
    assert.ok(
      darkRt.zones.workPanels.blurPx >= 16,
      `dark balanced workPanels blur should be >= 16px, got ${darkRt.zones.workPanels.blurPx}`,
    );
    assert.equal(html.attrs.get('data-pmx-zone-work-panels-mode'), 'inherit');
    assert.equal(
      html.styles.get('--pmx-glass-work-panels-bg'),
      html.styles.get('--pmx-glass-zone-work-panels-bg'),
    );
    assert.match(html.styles.get('--pmx-glass-work-panels-card-bg') ?? '', /^rgba\(/);
    assert.equal(html.styles.get('--pmx-glass-work-panels-blur'), `${darkRt.zones.workPanels.blurPx}px`);
    assert.match(html.styles.get('--pmx-glass-work-panels-border') ?? '', /^rgba\(/);
    assert.match(html.styles.get('--pmx-glass-work-panels-backdrop') ?? '', /^blur\(\d+px\) saturate\(1\.08\)$/);

    // Light balanced default: crisp light milk-glass (>= 68% opacity)
    const lightCfg = normalizeAppearanceConfig({
      themeMode: 'glass',
      glassBasePolarity: 'light',
      glassPreset: 'balanced',
    });
    const lightRt = applyPrismuxAppearanceToDocument(lightCfg, { document: doc, wallpaperActive: true });
    assert.ok(lightRt.zones.workPanels.opacity >= 68);
    assert.match(html.styles.get('--pmx-glass-work-panels-card-bg') ?? '', /^rgba\(255, 255, 255,/);

    // Custom live adjustment of workPanels updates both zone & alias CSS variables
    const customCfg = updateGlassZone(migrated, 'workPanels', {
      mode: 'custom',
      opacity: 52,
      blurPx: 26,
    });
    const customRt = applyPrismuxAppearanceToDocument(customCfg, { document: doc, wallpaperActive: true });
    assert.equal(customRt.zones.workPanels.effectiveMode, 'custom');
    assert.equal(customRt.zones.workPanels.opacity, 52);
    assert.equal(customRt.zones.workPanels.blurPx, 26);
    assert.equal(html.attrs.get('data-pmx-zone-work-panels-mode'), 'custom');
    assert.equal(html.styles.get('--pmx-glass-work-panels-blur'), '26px');
    assert.match(html.styles.get('--pmx-glass-work-panels-bg') ?? '', /0\.520\)$/);

    // Solid mode drops blur/sheen and emits opaque solid bg + elevated solid card bg
    const solidCfg = updateGlassZone(migrated, 'workPanels', { mode: 'solid' });
    applyPrismuxAppearanceToDocument(solidCfg, { document: doc, wallpaperActive: true });
    assert.equal(html.attrs.get('data-pmx-zone-work-panels-mode'), 'solid');
    assert.equal(html.styles.get('--pmx-glass-work-panels-blur'), '0px');
    assert.equal(html.styles.get('--pmx-glass-work-panels-backdrop'), 'none');
    assert.match(html.styles.get('--pmx-glass-work-panels-bg') ?? '', /^rgb\(/);
    assert.match(html.styles.get('--pmx-glass-work-panels-card-bg') ?? '', /^rgb\(/);

    // Clear removes all workPanels CSS variables and mode attribute cleanly
    clearPrismuxAppearanceFromDocument(doc);
    assert.equal(html.attrs.get('data-pmx-zone-work-panels-mode'), undefined);
    assert.equal(html.styles.get('--pmx-glass-work-panels-bg'), undefined);
    assert.equal(html.styles.get('--pmx-glass-work-panels-card-bg'), undefined);
    assert.equal(html.styles.get('--pmx-glass-work-panels-blur'), undefined);
    assert.equal(html.styles.get('--pmx-glass-work-panels-border'), undefined);
  });

  it('wires [data-pmx-work-panel="1"], [data-pmx-work-panel-card="1"], and global .text-background glass safety guard in t3-glass-bridge.css', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const bridgeCss = fs.readFileSync(path.resolve(here, '../styles/t3-glass-bridge.css'), 'utf8');

    assert.match(bridgeCss, /html\.dark\[data-pmx-glass='1'\]\s+\.text-background[\s\S]*?color:\s*#0b0f17;/);
    assert.match(bridgeCss, /html:not\(\.dark\)\[data-pmx-glass='1'\]\s+\.text-background[\s\S]*?color:\s*#ffffff;/);
    assert.match(bridgeCss, /\[data-pmx-work-panel='1'\][\s\S]*?--pmx-glass-work-panels-bg/);
    assert.match(bridgeCss, /\[data-pmx-work-panel-card='1'\][\s\S]*?--pmx-glass-work-panels-card-bg/);
    assert.match(
      bridgeCss,
      /main\[data-slot='sidebar-inset'\]:has\(\[data-pmx-glass-zone='workPanels'\]\)/,
    );

    const fallbackSection = bridgeCss.slice(
      bridgeCss.indexOf('/* ── 7. Three Mandatory Solid Fallbacks'),
    );
    assert.ok(
      (fallbackSection.match(/--pmx-glass-work-panels-bg/g) ?? []).length >= 3,
      'all 3 solid fallbacks must reset --pmx-glass-work-panels-bg',
    );
    assert.ok(
      (fallbackSection.match(/\[data-pmx-work-panel='1'\]/g) ?? []).length >= 5,
      'all solid fallbacks + forced-colors must cover [data-pmx-work-panel="1"]',
    );
  });

  it('enforces high-contrast 3-state (Light / Dark / Glass) active highlighting on shared segmented controls, ToggleGroup & Tabs (#505)', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const bridgeCss = fs.readFileSync(path.resolve(here, '../styles/t3-glass-bridge.css'), 'utf8');
    const cardsCss = fs.readFileSync(path.resolve(here, '../styles/appearance-cards.css'), 'utf8');

    // Balanced braces & zero prefers-color-scheme in both stylesheets
    for (const [name, css] of [
      ['t3-glass-bridge.css', bridgeCss],
      ['appearance-cards.css', cardsCss],
    ] as const) {
      const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
      assert.equal(noComments.includes('prefers-color-scheme'), false, `${name} must never use prefers-color-scheme`);
      assert.equal(
        (noComments.match(/\{/g) ?? []).length,
        (noComments.match(/\}/g) ?? []).length,
        `${name} must have balanced braces`,
      );
    }

    // 1. t3-glass-bridge.css covers ToggleGroup segmented, Toggle [data-pressed], TabsList & TabsTrigger across Light / Dark / Glass
    assert.match(bridgeCss, /\[data-slot='toggle-group'\]\[data-variant='segmented'\],\s*\[data-slot='tabs-list'\]/);
    assert.match(bridgeCss, /html\.dark \[data-slot='toggle-group'\]\[data-variant='segmented'\]/);
    assert.match(bridgeCss, /html\.dark\[data-pmx-glass='1'\] \[data-slot='toggle-group'\]\[data-variant='segmented'\]/);
    assert.match(bridgeCss, /html:not\(\.dark\)\[data-pmx-glass='1'\] \[data-slot='toggle-group'\]\[data-variant='segmented'\]/);
    assert.match(bridgeCss, /\[data-slot='toggle'\]\[data-variant='segmented'\]\[data-pressed\]/);
    assert.match(bridgeCss, /html\.dark \[data-slot='toggle'\]\[data-variant='segmented'\]\[data-pressed\][\s\S]*?font-weight:\s*600;/);
    assert.match(bridgeCss, /html\.dark\[data-pmx-glass='1'\] \[data-slot='toggle'\]\[data-pressed\][\s\S]*?color:\s*#ffffff;/);
    assert.match(bridgeCss, /html:not\(\.dark\)\[data-pmx-glass='1'\] \[data-slot='toggle'\]\[data-pressed\][\s\S]*?color:\s*#0f172a;/);
    assert.match(bridgeCss, /\[data-slot='tabs-trigger'\]\[data-active\]/);
    assert.match(bridgeCss, /\[data-slot='tabs-trigger'\]\[aria-selected='true'\]/);

    // 2. appearance-cards.css reinforces .seg > button.on / [aria-pressed='true'] and .pmx-gz-pill.on across Dark / Light / Glass
    assert.match(cardsCss, /\.pmx-appearance \.seg > button\.on,\s*\.pmx-appearance \.seg > button\[aria-pressed='true'\][\s\S]*?font-weight:\s*600;/);
    assert.match(cardsCss, /html\.dark\[data-pmx-glass='1'\] \.pmx-appearance \.seg > button\.on[\s\S]*?color:\s*#ffffff;/);
    assert.match(cardsCss, /html:not\(\.dark\)\[data-pmx-glass='1'\] \.pmx-appearance \.seg > button\.on[\s\S]*?color:\s*#0f172a;/);
    assert.match(cardsCss, /\.pmx-appearance \.pmx-gz-pill\.on[\s\S]*?font-weight:\s*600;/);
  });
});
