import * as NodeTest from 'node:test';
import * as NodeAssert from 'node:assert/strict';
import * as NodeFS from 'node:fs';
import * as NodePath from 'node:path';
import * as NodeURL from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const { describe, it } = NodeTest;
const assert: typeof NodeAssert = NodeAssert;
const fs = NodeFS;
const path = NodePath;
const { fileURLToPath } = NodeURL;

import {
  DEFAULT_APPEARANCE_CONFIG,
  DEFAULT_TYPOGRAPHY_FALLBACKS,
  GLASS_PRESETS,
  GLASS_THEME_BASE_IDS,
  GLASS_THEME_BASE_META,
  GLASS_ZONE_CSS_NAMES,
  GLASS_ZONE_IDS,
  GLASS_ZONE_LIMITS,
  GLASS_ZONE_META,
  WB_THEME_FORMAT,
  WB_THEME_VERSION,
  type AppearanceConfig,
  type GlassRegionId,
  type GlassThemeBase,
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
  setGlassThemeBaseWithAutoWake,
  setThemeModeWithGlassAutoWake,
  updateGlassRegion,
  updateGlassZone,
  type DocumentLike,
  type ElementLike,
} from '../glassEngine.js';
import { GlassZoneConfigurator } from '../GlassZoneConfigurator.js';
import {
  InlineAppearanceStudio,
  type InlineAppearanceStudioProps,
} from '../InlineAppearanceStudio.js';
import { LiquidGlassCard } from '../AppearanceHeroAndCards.js';
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
  DEFAULT_RIGHT_SIDEBAR_SELECTOR,
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
  REASONING_EFFORT_THUMB_INSET_PX,
  REASONING_MODEL_THEMES,
  REASONING_RUNNER_FRAME_COUNT,
  REASONING_RUNNER_SPRITES,
  computeReasoningEffortFillWidth,
  computeReasoningEffortStopPercent,
  computeReasoningEffortStopProgress,
  computeReasoningEffortThumbAnchorX,
  detectReasoningModelFamily,
  drawReasoningRadiation,
  formatEffortLabel,
  formatReasoningEffortLabel,
  formatReasoningEffortShortLabel,
  getEffortPresetForFamily,
  getReasoningEffortThumbInsetPx,
  isPhantomReasoningEffortOption,
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
    assert.equal(clampSurfaceColorForContrast('#000000', true, 100), '#000000');
    assert.equal(clampSurfaceColorForContrast('invalid', true, 100), '#000000');
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
  it('locks v0.2.0-rc.2 glass-dark-clear appearance defaults and low-density card spacing without Layer-3 nested boxes', () => {
    assert.equal(DEFAULT_APPEARANCE_CONFIG.themeMode, 'glass');
    assert.equal(DEFAULT_APPEARANCE_CONFIG.glassBasePolarity, 'dark');
    assert.equal(DEFAULT_APPEARANCE_CONFIG.accentMode, 'system');
    assert.equal(DEFAULT_APPEARANCE_CONFIG.glassPreset, 'clear');
    assert.deepEqual(DEFAULT_APPEARANCE_CONFIG.glassRegions, {
      surface: { op: 18, blur: 24 },
      card: { op: 12, blur: 16 },
      overlay: { op: 25, blur: 20 },
      control: { op: 16, blur: 10 },
    });
    assert.equal(DEFAULT_APPEARANCE_CONFIG.glassColor, '#ffffff');
    assert.equal(DEFAULT_APPEARANCE_CONFIG.glassDarkSeparate, true);
    assert.equal(DEFAULT_APPEARANCE_CONFIG.glassDarkColor, '#000000');

    const normalized = normalizeAppearanceConfig({});
    assert.deepEqual(normalized, DEFAULT_APPEARANCE_CONFIG);

    const rt = resolveAppearanceRuntime(normalized);
    assert.equal(rt.glassActive, true);
    assert.equal(rt.polarity, 'dark');
    assert.equal(rt.activeGlassTint, '#000000');

    const here = path.dirname(fileURLToPath(import.meta.url));
    const cardsCss = fs.readFileSync(path.resolve(here, '../styles/appearance-cards.css'), 'utf8');
    assert.match(cardsCss, /\.pmx-appearance\.ilook-cards-stack\s*\{[^}]*gap:\s*16px;/s);
    assert.match(cardsCss, /\.pmx-appearance\s+\.ilook-sec-card\s*\{[^}]*padding:\s*16px 18px;/s);
    assert.match(
      cardsCss,
      /\.pmx-appearance\s+\.pmx-sub-box\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;/s,
    );
    assert.match(
      cardsCss,
      /\.pmx-appearance\s+\.ilook-sec-card\s+\.ilook-sec-card\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;/s,
    );
  });

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

    // 1. Dark native mode: glass gate MUST be '0' for 100% Prismux native fallback.
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
  it('outranks Prismux [data-theme-id] blocks for typography/UI overrides and reverts all glass surfaces to solid in all 3 fallbacks', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const cssPath = path.resolve(here, '../styles/prismux-glass-bridge.css');
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
    const bridgeCss = fs.readFileSync(path.resolve(here, '../styles/prismux-glass-bridge.css'), 'utf8');
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
    assert.match(
      css,
      /\.pmx-re-root\.is-runner \.pmx-re-knob\s*\{[^}]*left:\s*calc\(var\(--pmx-thumb-inset\)\s*\+\s*\(100%\s*-\s*2\s*\*\s*var\(--pmx-thumb-inset\)\)\s*\*\s*var\(--pmx-progress\)\);/s,
    );
    assert.match(css, /\.pmx-re-track::before\s*\{[^}]*width:\s*var\(--pmx-re-fill\);/s);
    assert.match(css, /\.pmx-re-slider\[data-top\] \.pmx-re-track::before\s*\{[^}]*width:\s*100%;/s);
  });

  it('delivers 100% full-bleed track fill at Max, zero-gap edge-clamped mascot geometry & aligned pointer drag math across all stop counts (N=2..7)', () => {
    assert.equal(getReasoningEffortThumbInsetPx({ showRunner: true, compact: false }), REASONING_EFFORT_THUMB_INSET_PX.runnerRegular);
    assert.equal(getReasoningEffortThumbInsetPx({ showRunner: true, compact: true }), REASONING_EFFORT_THUMB_INSET_PX.runnerCompact);
    assert.equal(getReasoningEffortThumbInsetPx({ showRunner: false, compact: false }), REASONING_EFFORT_THUMB_INSET_PX.orbRegular);
    assert.equal(getReasoningEffortThumbInsetPx({ showRunner: false, compact: true }), REASONING_EFFORT_THUMB_INSET_PX.orbCompact);

    const widths = [240, 320, 480, 720, 960];
    const insets = [
      REASONING_EFFORT_THUMB_INSET_PX.runnerRegular,
      REASONING_EFFORT_THUMB_INSET_PX.runnerCompact,
      REASONING_EFFORT_THUMB_INSET_PX.orbRegular,
      REASONING_EFFORT_THUMB_INSET_PX.orbCompact,
    ];
    const rectLeft = 40;

    for (const count of [2, 3, 4, 5, 6, 7]) {
      // Extreme stops hit exact 0% and 100% universally for every stop count
      assert.equal(computeReasoningEffortStopProgress(0, count), 0);
      assert.equal(computeReasoningEffortStopPercent(0, count), 0);
      assert.equal(computeReasoningEffortStopProgress(count - 1, count), 1);
      assert.equal(computeReasoningEffortStopPercent(count - 1, count), 100);

      for (let i = 0; i < count; i += 1) {
        const expectedRatio = i / (count - 1);
        const actualRatio = computeReasoningEffortStopProgress(i, count);
        const actualPercent = computeReasoningEffortStopPercent(i, count);
        assert.ok(Math.abs(actualRatio - expectedRatio) < 1e-12);
        assert.ok(Math.abs(actualPercent - expectedRatio * 100) < 1e-12);

        for (const width of widths) {
          for (const inset of insets) {
            const anchorX = computeReasoningEffortThumbAnchorX(actualRatio, width, inset);
            const fillWidth = computeReasoningEffortFillWidth(
              actualRatio,
              width,
              inset,
              i === count - 1,
            );

            // Mascot silhouette strictly stays inside [0, width] with zero clipping
            assert.ok(
              anchorX - inset >= -1e-9 && anchorX + inset <= width + 1e-9,
              `Mascot silhouette must stay inside [0, ${width}] for N=${count}, i=${i}, inset=${inset}`,
            );

            if (i === 0) {
              assert.ok(Math.abs(anchorX - inset) < 1e-9, 'Min stop anchor sits at left inset');
              assert.ok(Math.abs(fillWidth - inset) < 1e-9, 'Min stop fill aligns cleanly under mascot with zero dead left gap');
            } else if (i === count - 1) {
              assert.ok(Math.abs(anchorX - (width - inset)) < 1e-9, 'Max stop anchor sits cleanly inside right pill cap');
              assert.equal(fillWidth, width, `Max stop MUST fill 100% (${width}px) with ZERO dark right stub (N=${count})`);
            } else {
              assert.ok(
                Math.abs(fillWidth - anchorX) < 1e-9,
                `Intermediate stop fill must terminate cleanly under mascot center (N=${count}, i=${i})`,
              );
            }

            // Clicking directly on the mascot's anchor X round-trips to stop index `i`
            assert.equal(
              resolveReasoningEffortStopIndexFromPointer(
                rectLeft + anchorX,
                { left: rectLeft, width },
                count,
                inset,
              ),
              i,
            );
          }
        }
      }

      // Extreme left/right pointer drags snap instantaneously to 0 / count - 1 across all insets
      for (const inset of insets) {
        assert.equal(resolveReasoningEffortStopIndexFromPointer(rectLeft - 50, { left: rectLeft, width: 400 }, count, inset), 0);
        assert.equal(resolveReasoningEffortStopIndexFromPointer(rectLeft, { left: rectLeft, width: 400 }, count, inset), 0);
        assert.equal(resolveReasoningEffortStopIndexFromPointer(rectLeft + inset, { left: rectLeft, width: 400 }, count, inset), 0);
        assert.equal(resolveReasoningEffortStopIndexFromPointer(rectLeft + 400 - inset, { left: rectLeft, width: 400 }, count, inset), count - 1);
        assert.equal(resolveReasoningEffortStopIndexFromPointer(rectLeft + 400, { left: rectLeft, width: 400 }, count, inset), count - 1);
        assert.equal(resolveReasoningEffortStopIndexFromPointer(rectLeft + 500, { left: rectLeft, width: 400 }, count, inset), count - 1);
      }
    }

    // Canvas pixel radiation clips to 100% full width at Max (zero un-filled right stub) across all 8 model families
    for (const family of Object.keys(REASONING_MODEL_THEMES) as ReasoningModelFamily[]) {
      let clippedWidth = 0;
      let maxPaintedX = 0;
      const fakeGradient = { addColorStop: () => undefined };
      const fakeCtx = {
        fillStyle: '',
        clearRect: () => undefined,
        save: () => undefined,
        restore: () => undefined,
        beginPath: () => undefined,
        rect: (_x: number, _y: number, w: number) => {
          clippedWidth = w;
        },
        clip: () => undefined,
        fillRect: (x: number, _y: number, w: number) => {
          if (x + w > maxPaintedX) maxPaintedX = x + w;
        },
        createLinearGradient: () => fakeGradient,
        createRadialGradient: () => fakeGradient,
      } as unknown as CanvasRenderingContext2D;

      drawReasoningRadiation(
        fakeCtx,
        320,
        24,
        1200,
        { progress: 1, dragging: false, thumbInsetPx: 16, isMax: true },
        family,
        true,
      );
      assert.equal(clippedWidth, 320, `${family} max stop canvas clip must reach full 320px (100%)`);
      assert.ok(maxPaintedX >= 316, `${family} max stop pixel matrix must illuminate right up to the right cap`);
    }

    // Filters phantom "Provider default" / sentinel options while keeping all real levels intact
    assert.equal(isPhantomReasoningEffortOption('_t3/empty', 'Provider default'), true);
    assert.equal(isPhantomReasoningEffortOption('provider_default', 'Provider default'), true);
    assert.equal(isPhantomReasoningEffortOption('default', 'Default'), true);
    assert.equal(isPhantomReasoningEffortOption('low', 'Low'), false);
    assert.equal(isPhantomReasoningEffortOption('off', 'Off'), false);
    assert.equal(isPhantomReasoningEffortOption('high', 'High'), false);
    assert.equal(isPhantomReasoningEffortOption('max', 'Max'), false);

    const cleanedDsh = normalizeReasoningEffortOptions(
      [
        { value: '_t3/empty', label: 'Provider default' },
        { value: 'provider_default', label: 'Provider default' },
        { value: 'low', label: 'Low' },
        { value: 'high', label: 'High' },
        { value: 'max', label: 'Max' },
      ],
      'deepseek',
      'zh',
    );
    assert.deepEqual(
      cleanedDsh.map((s) => s.value),
      ['low', 'high', 'max'],
    );
    assert.equal(resolveEffortStopIndex(cleanedDsh, 'provider_default'), 1); // cleanly defaults to 'high'
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
      'userBubble',
      'overviewPanel',
    ]);
    assert.equal(GLASS_ZONE_META[0]?.id, 'shellFrame');
    assert.match(GLASS_ZONE_META[0]?.title ?? '', /^窗口外框/);
    assert.equal(GLASS_ZONE_META[1]?.id, 'rightSidebar');
    assert.equal(GLASS_ZONE_META[1]?.title, '右侧功能边栏');
    assert.equal(GLASS_ZONE_META[3]?.id, 'workPanels');
    assert.equal(GLASS_ZONE_META[3]?.title, '工作面板');
    assert.equal(GLASS_ZONE_META[3]?.note, '任务面板、工作区板与定时任务统一调节');
    assert.equal(GLASS_ZONE_META[6]?.id, 'userBubble');
    assert.equal(GLASS_ZONE_META[6]?.title, '用户消息气泡');
    assert.equal(GLASS_ZONE_META[7]?.id, 'overviewPanel');
    assert.equal(GLASS_ZONE_META[7]?.title, '概览面板');
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

    const bridgeCss = fs.readFileSync(path.resolve(here, '../styles/prismux-glass-bridge.css'), 'utf8');
    const cardsCss = fs.readFileSync(path.resolve(here, '../styles/appearance-cards.css'), 'utf8');
    const heroBuilt = fs.readFileSync(path.resolve(here, '../AppearanceHeroAndCards.js'), 'utf8');

    // All 5 canonical zone selectors (+ legacy leftSidebar/chromeBars & right-frame-edge), Backdrop-Root elimination,
    // composer pseudo takeover, overlays & zero corner bleed, inner-stage radius.
    for (const id of GLASS_ZONE_IDS) {
      assert.ok(
        bridgeCss.includes(`[data-pmx-glass-zone='${id}']`),
        `prismux-glass-bridge.css must bind [data-pmx-glass-zone='${id}']`,
      );
      assert.ok(
        bridgeCss.includes(`--pmx-glass-zone-${GLASS_ZONE_CSS_NAMES[id]}-bg`),
        `prismux-glass-bridge.css must consume --pmx-glass-zone-${GLASS_ZONE_CSS_NAMES[id]}-bg`,
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

    // AGY 2.0 dual-layer composer, Claude Code Desktop sidebar peek drawer & chat width handles.
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

    // Corner radius UI removed from AppearanceHeroAndCards stack.
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

    // 3. Calibrated 3-tier dark-glass contrast separation & anti-bleed-through floating peek drawer CSS contract.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const bridgeCss = fs.readFileSync(path.resolve(here, '../styles/prismux-glass-bridge.css'), 'utf8');
    assert.match(bridgeCss, /--sidebar-muted-foreground:\s*rgba\(203,\s*213,\s*225,\s*0\.66\)/);
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

  it('defines zero-seam outer chrome, 4 concave corner fillets, radial fallback, 1px inner ring & solid fallbacks in prismux-glass-bridge.css', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const bridgeCss = fs.readFileSync(path.resolve(here, '../styles/prismux-glass-bridge.css'), 'utf8');

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

  it('isolates pointer illumination to the active pane, auto-hides after hover/scroll delays, guards drags, and disposes cleanly', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
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
    t.mock.timers.tick(60);
    assert.equal(paneRight.attrs.has(PMX_SCROLL_ACTIVE_ATTR), false);

    // 4. Dragging scrollbar thumb keeps pane active even if pointer drifts outside until pointerup
    env.dispatchDoc('pointerdown', paneLeft);
    assert.equal(paneLeft.attrs.get(PMX_SCROLL_ACTIVE_ATTR), '1');
    env.dispatchDoc('pointermove', header);
    t.mock.timers.tick(55);
    assert.equal(paneLeft.attrs.get(PMX_SCROLL_ACTIVE_ATTR), '1');
    env.dispatchDoc('pointerup', header);
    t.mock.timers.tick(55);
    assert.equal(paneLeft.attrs.has(PMX_SCROLL_ACTIVE_ATTR), false);

    // 5. Scroll event sets data-pmx-scroll-scrolling="1" and auto-hides after scrollHideDelayMs
    env.dispatchDoc('scroll', paneRight);
    assert.equal(paneRight.attrs.get(PMX_SCROLL_SCROLLING_ATTR), '1');
    t.mock.timers.tick(70);
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
  it('calibrates all 8 glass zones to natural 105%-115% default saturation with zero brightness distortion', () => {
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
    const bridgeCss = fs.readFileSync(path.resolve(here, '../styles/prismux-glass-bridge.css'), 'utf8');
    const cardsCss = fs.readFileSync(path.resolve(here, '../styles/appearance-cards.css'), 'utf8');
    const popoverCss = fs.readFileSync(path.resolve(here, '../styles/color-popover.css'), 'utf8');

    for (const [name, css] of [
      ['prismux-glass-bridge.css', bridgeCss],
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
    const mutationObserveOptions: MutationObserverInit[] = [];
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
      observe(_target: Node, options?: MutationObserverInit) {
        if (options) mutationObserveOptions.push(options);
      }
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
        if (selector === DEFAULT_RIGHT_SIDEBAR_SELECTOR) {
          return rightNodes.filter((n) => n.getAttribute?.('data-preview-panel-maximized') !== 'true');
        }
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
        for (const cb of Array.from(resizeCallbacks)) cb();
      },
      triggerRootAttrMutation: () => {
        for (const cb of Array.from(mutationCallbacks)) cb([]);
      },
      triggerBodyAttrMutation: (target: unknown, attributeName: string) => {
        const record = {
          type: 'attributes',
          target,
          attributeName,
          addedNodes: [],
          removedNodes: [],
        } as unknown as MutationRecord;
        for (const cb of Array.from(mutationCallbacks)) cb([record]);
      },
      mutationObserveOptions,
      dispatchDoc: (type: string, event: unknown) => {
        for (const fn of Array.from(docListeners.get(type) ?? [])) fn(event);
      },
      dispatchWin: (type: string, event: unknown) => {
        for (const fn of Array.from(winListeners.get(type) ?? [])) fn(event);
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
    const bridgeCss = fs.readFileSync(path.resolve(here, '../styles/prismux-glass-bridge.css'), 'utf8');

    // Balanced braces & zero prefers-color-scheme
    const opens = (bridgeCss.match(/\{/g) ?? []).length;
    const closes = (bridgeCss.match(/\}/g) ?? []).length;
    assert.equal(opens, closes, 'prismux-glass-bridge.css braces must stay balanced');
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

  it('ignores maximized inline right panels as rightSidebar cutout holes while punching out their inner stage frame cleanly (RC.3)', () => {
    assert.equal(
      DEFAULT_RIGHT_SIDEBAR_SELECTOR,
      '[data-preview-panel-mode="inline"]:not([data-preview-panel-maximized="true"])',
    );

    const env = createMockCutoutEnv({ width: 1440, height: 900 });
    env.htmlAttrs.set('data-pmx-glass', '1');
    env.htmlAttrs.set('data-pmx-zone-right-sidebar-mode', 'custom');

    const chatStageEl = createMockCutoutNode('div', { left: 240, top: 38, width: 840, height: 842 });
    chatStageEl.setAttribute('data-pmx-stage-frame', '1');
    env.stageNodes.push(chatStageEl);

    const rightPanelEl = createMockCutoutNode('div', { left: 1080, top: 38, width: 360, height: 842 });
    rightPanelEl.setAttribute('data-preview-panel-mode', 'inline');
    rightPanelEl.setAttribute('data-preview-panel-maximized', 'false');
    env.rightNodes.push(rightPanelEl);

    const handle = installPrismuxShellCutout(env.doc, { now: env.getNow });

    // Body observer watches data-preview-panel-maximized attribute changes for instant mask updates
    const bodyObserverOpts = env.mutationObserveOptions.find(
      (opt) => opt.childList === true && opt.subtree === true,
    );
    assert.ok(bodyObserverOpts, 'must register body MutationObserver');
    assert.equal(bodyObserverOpts.attributes, true);
    assert.ok(
      bodyObserverOpts.attributeFilter?.includes('data-preview-panel-maximized'),
      'body observer must track data-preview-panel-maximized transitions',
    );

    // Non-maximized + custom rightSidebar -> 1 stage hole + 1 square rightSidebar hole
    const gBefore = handle.getGeometry();
    assert.equal(gBefore.active, true);
    assert.equal(gBefore.stageHoles.length, 1);
    assert.equal(gBefore.rightSidebarHoles.length, 1);

    // Maximize the right panel: chat stage unmounts, maximized panel renders its own inner
    // [data-pmx-stage-frame="1"] (leaving 7px right bezel), and sets data-preview-panel-maximized="true".
    rightPanelEl.setAttribute('data-preview-panel-maximized', 'true');
    rightPanelEl.rect = { left: 240, top: 38, width: 1200, height: 842 };
    const maximizedStageEl = createMockCutoutNode('div', {
      left: 240,
      top: 38,
      width: 1193,
      height: 842,
    });
    maximizedStageEl.setAttribute('data-pmx-stage-frame', '1');
    env.stageNodes.splice(0, env.stageNodes.length, maximizedStageEl);

    // Even across custom, solid, and fullclear modes, maximized right panel MUST yield 0 rightSidebar holes
    for (const [mode, fullClear] of [
      ['custom', '0'],
      ['solid', '0'],
      ['inherit', '1'],
    ] as const) {
      env.htmlAttrs.set('data-pmx-zone-right-sidebar-mode', mode);
      env.htmlAttrs.set('data-pmx-right-sidebar-fullclear', fullClear);
      env.triggerBodyAttrMutation(rightPanelEl, 'data-preview-panel-maximized');
      env.flushRaf();

      const geom = handle.getGeometry();
      assert.equal(geom.active, true);
      assert.equal(geom.stageHoles.length, 1, `maximized stage hole must remain active (${mode})`);
      assert.deepEqual(geom.stageHoles[0], {
        x: 240.5,
        y: 38.5,
        width: 1192,
        height: 841,
        rx: 13.5,
        ry: 13.5,
      });
      assert.equal(
        geom.rightSidebarHoles.length,
        0,
        `maximized right panel must never punch a square rightSidebar hole (${mode}, fullclear=${fullClear})`,
      );
    }

    // Restoring from maximized brings the rightSidebar hole back immediately on attribute mutation
    env.htmlAttrs.set('data-pmx-zone-right-sidebar-mode', 'custom');
    env.htmlAttrs.set('data-pmx-right-sidebar-fullclear', '0');
    rightPanelEl.setAttribute('data-preview-panel-maximized', 'false');
    rightPanelEl.rect = { left: 1080, top: 38, width: 360, height: 842 };
    env.stageNodes.splice(0, env.stageNodes.length, chatStageEl);
    env.triggerBodyAttrMutation(rightPanelEl, 'data-preview-panel-maximized');
    env.flushRaf();

    const gRestored = handle.getGeometry();
    assert.equal(gRestored.stageHoles.length, 1);
    assert.equal(gRestored.rightSidebarHoles.length, 1);

    handle.dispose();

    // CSS bridge contract: maximized exclusion + File Tree / FileExplorerPane adaptation & fallbacks
    const here = path.dirname(fileURLToPath(import.meta.url));
    const bridgeCss = fs.readFileSync(path.resolve(here, '../styles/prismux-glass-bridge.css'), 'utf8');
    const noComments = bridgeCss.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(
      (noComments.match(/\{/g) ?? []).length,
      (noComments.match(/\}/g) ?? []).length,
      'prismux-glass-bridge.css braces must stay balanced',
    );
    assert.equal(noComments.includes('prefers-color-scheme'), false);

    // Maximized right panel excluded from rightSidebar fill/backdrop/cutout/substrate rules
    assert.ok(bridgeCss.includes("[data-preview-panel-mode='inline']:not([data-preview-panel-maximized='true'])"));
    assert.ok(
      bridgeCss.includes("[data-preview-panel-mode='inline'][data-preview-panel-maximized='true']:has("),
    );
    assert.ok(bridgeCss.includes("[data-right-panel-maximized-stage='1']"));

    // File tree / FileExplorerPane glass stripping & custom typography propagation
    assert.ok(bridgeCss.includes("[data-pmx-glass-zone='mainCanvas'] [data-file-browser-panel]"));
    assert.ok(bridgeCss.includes("[data-pmx-glass-zone='mainCanvas'] [data-surface-subheader]"));
    assert.ok(bridgeCss.includes("[data-pmx-file-tree='1']"));
    assert.ok(bridgeCss.includes("[data-pmx-file-explorer-pane='1'][data-pmx-file-explorer-resizable='1']"));
    assert.ok(
      (bridgeCss.match(/\[data-pmx-file-tree='1'\]/g) ?? []).length >= 4,
      'custom-text & custom-muted (regular + [data-theme-id]) must include [data-pmx-file-tree="1"]',
    );

    const cssFallbacks = bridgeCss.slice(
      bridgeCss.indexOf('/* ── 7. Three Mandatory Solid Fallbacks'),
    );
    assert.ok(
      (cssFallbacks.match(/\[data-pmx-file-explorer-pane='1'\]\[data-pmx-file-explorer-resizable='1'\]/g) ?? [])
        .length >= 7,
      'all 3 solid fallbacks (Dark + Light) + forced-colors must cover resizable FileExplorerPane',
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

  it('wires [data-pmx-work-panel="1"], [data-pmx-work-panel-card="1"], and global .text-background glass safety guard in prismux-glass-bridge.css', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const bridgeCss = fs.readFileSync(path.resolve(here, '../styles/prismux-glass-bridge.css'), 'utf8');

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
    const bridgeCss = fs.readFileSync(path.resolve(here, '../styles/prismux-glass-bridge.css'), 'utf8');
    const cardsCss = fs.readFileSync(path.resolve(here, '../styles/appearance-cards.css'), 'utf8');

    // Balanced braces & zero prefers-color-scheme in both stylesheets
    for (const [name, css] of [
      ['prismux-glass-bridge.css', bridgeCss],
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

    // 1. prismux-glass-bridge.css covers ToggleGroup segmented, Toggle [data-pressed], TabsList & TabsTrigger across Light / Dark / Glass
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

  it('replaces harsh blue active boxes on topbar icon toggles with Liquid Glass relief + micro-bar and animates RGB Wallpaper Sparkles with reduced-motion fallback', () => {
    const bridgeCss = fs.readFileSync(new URL('../../src/styles/prismux-glass-bridge.css', import.meta.url), 'utf8');

    assert.match(bridgeCss, /@keyframes pmx-wallpaper-rgb-flow\b/);
    assert.match(bridgeCss, /@keyframes pmx-wallpaper-rgb-flow-light\b/);
    assert.match(bridgeCss, /\[data-pmx-topbar-icon-toggle='1'\]::after[\s\S]*?width:\s*12px\s*!important;[\s\S]*?height:\s*2px\s*!important;/);
    assert.match(
      bridgeCss,
      /html\.dark\[data-pmx-glass='1'\] \[data-pmx-topbar-icon-toggle='1'\]:is\(\[data-pressed\], \[aria-pressed='true'\], \[data-popup-open\]\)[\s\S]*?background-color:\s*rgba\(255,\s*255,\s*255,\s*0\.13\)\s*!important;/,
    );
    assert.match(
      bridgeCss,
      /html:not\(\.dark\)\[data-pmx-glass='1'\] \[data-pmx-topbar-icon-toggle='1'\]:is\(\[data-pressed\], \[aria-pressed='true'\], \[data-popup-open\]\)[\s\S]*?background-color:\s*rgba\(255,\s*255,\s*255,\s*0\.88\)\s*!important;/,
    );
    assert.match(
      bridgeCss,
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\[data-pmx-topbar-toggle-kind='wallpaper'\] \[data-pmx-wallpaper-icon='1'\][\s\S]*?animation:\s*none\s*!important;/,
    );
  });

  it('enforces sharp sidebar --contrast-secondary-label tokens, 4-edge sidebar glass cards, active RGB border marquee & breathing logo, and AGY Light/Dark liquid glass user message pills', () => {
    const bridgeCss = fs.readFileSync(new URL('../../src/styles/prismux-glass-bridge.css', import.meta.url), 'utf8');

    // Balanced braces & zero prefers-color-scheme
    const noComments = bridgeCss.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(noComments.includes('prefers-color-scheme'), false);
    assert.equal(
      (noComments.match(/\{/g) ?? []).length,
      (noComments.match(/\}/g) ?? []).length,
      'prismux-glass-bridge.css braces must stay balanced',
    );

    // 1. Sidebar Dark & Light Glass calibrated 3-tier contrast token overrides + custom-muted binding
    assert.match(
      bridgeCss,
      /html\.dark\[data-pmx-glass='1'\]:not\(\[data-pmx-custom-muted='1'\]\)[\s\S]*?\[data-app-sidebar\][\s\S]*?--secondary-label:\s*rgba\(203,\s*213,\s*225,\s*0\.66\);[\s\S]*?--contrast-secondary-label:\s*rgba\(203,\s*213,\s*225,\s*0\.66\);[\s\S]*?--contrast-icon-muted:\s*rgba\(203,\s*213,\s*225,\s*0\.72\);/,
    );
    assert.match(
      bridgeCss,
      /html:not\(\.dark\)\[data-pmx-glass='1'\]:not\(\[data-pmx-custom-muted='1'\]\)[\s\S]*?\[data-app-sidebar\][\s\S]*?--secondary-label:\s*rgba\(51,\s*65,\s*85,\s*0\.70\);[\s\S]*?--contrast-secondary-label:\s*rgba\(51,\s*65,\s*85,\s*0\.70\);[\s\S]*?--contrast-icon-muted:\s*rgba\(51,\s*65,\s*85,\s*0\.72\);/,
    );
    assert.match(
      bridgeCss,
      /html\[data-pmx-custom-muted='1'\]\[data-theme-id\]\s*\[data-app-sidebar\]\s*\{[\s\S]*?--contrast-secondary-label:\s*var\(--pmx-muted-color\);[\s\S]*?--contrast-icon-muted:\s*var\(--pmx-muted-color\);/,
    );

    // 2. 4-edge Sidebar session glass cards (Dark & Light rest/hover/active, zero nested blur)
    assert.match(
      bridgeCss,
      /html\.dark\[data-pmx-glass='1'\]\s+\[data-app-sidebar\]\s+\[data-sidebar-card='1'\][\s\S]*?background:\s*rgba\(16,\s*20,\s*32,\s*0\.34\);[\s\S]*?border:\s*1px solid rgba\(255,\s*255,\s*255,\s*0\.16\);[\s\S]*?backdrop-filter:\s*none;/,
    );
    assert.match(
      bridgeCss,
      /html\.dark\[data-pmx-glass='1'\]\s+\[data-app-sidebar\]\s+\[data-sidebar-card='1'\]\[data-sidebar-card-active='1'\]/,
    );
    assert.match(
      bridgeCss,
      /html:not\(\.dark\)\[data-pmx-glass='1'\]\s+\[data-app-sidebar\]\s+\[data-sidebar-card='1'\][\s\S]*?background:\s*rgba\(255,\s*255,\s*255,\s*0\.52\);[\s\S]*?border:\s*1px solid rgba\(15,\s*23,\s*42,\s*0\.13\);[\s\S]*?backdrop-filter:\s*none;/,
    );
    assert.match(
      bridgeCss,
      /html:not\(\.dark\)\[data-pmx-glass='1'\]\s+\[data-app-sidebar\]\s+\[data-sidebar-card='1'\]\[data-sidebar-card-active='1'\]/,
    );

    // 3. Active agent RGB border marquee + breathing logo + reduced-motion fallback
    assert.match(bridgeCss, /@property --pmx-rgb-border-angle\s*\{[\s\S]*?syntax:\s*'<angle>';/);
    assert.match(bridgeCss, /@keyframes pmx-rgb-border-spin\b/);
    assert.match(bridgeCss, /@keyframes pmx-agent-logo-breathe\b/);
    assert.match(
      bridgeCss,
      /\[data-sidebar-card='1'\]\[data-sidebar-agent-active='1'\]::before[\s\S]*?conic-gradient\([\s\S]*?from var\(--pmx-rgb-border-angle\)[\s\S]*?mask-composite:\s*exclude;[\s\S]*?animation:\s*pmx-rgb-border-spin 3\.2s linear infinite;/,
    );
    assert.match(
      bridgeCss,
      /\[data-agent-logo-breathing='1'\][\s\S]*?animation:\s*pmx-agent-logo-breathe 2\.2s ease-in-out infinite;/,
    );
    assert.match(
      bridgeCss,
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\[data-sidebar-card='1'\]\[data-sidebar-agent-active='1'\]::before[\s\S]*?animation:\s*none\s*!important;[\s\S]*?\[data-agent-logo-breathing='1'\][\s\S]*?animation:\s*none\s*!important;/,
    );

    // 4. AGY flat large-radius user message capsule bubbles (8-zone userBubble + directional Fresnel rim + 3 fallbacks)
    assert.equal(
      bridgeCss.includes('var(--pmx-conversation-tint, #101624) 38%'),
      false,
      'legacy murky ~59% solid color-mix on user bubbles must be removed',
    );
    assert.match(
      bridgeCss,
      /html\.dark\[data-pmx-glass='1'\][\s\S]*?\[data-pmx-glass-zone='userBubble'\][\s\S]*?background-color:\s*var\(--pmx-glass-zone-user-bubble-bg,[\s\S]*?backdrop-filter:\s*var\(--pmx-glass-zone-user-bubble-backdrop,[\s\S]*?border:\s*1px solid transparent;/,
    );
    assert.match(
      bridgeCss,
      /html\.dark\[data-pmx-glass='1'\][\s\S]*?\[data-user-message-bubble\]\[data-user-message-bubble-surface='1'\][\s\S]*?::before[\s\S]*?border-radius:\s*inherit;[\s\S]*?pointer-events:\s*none;[\s\S]*?linear-gradient\(\s*135deg,[\s\S]*?-webkit-mask-composite:\s*xor;[\s\S]*?mask-composite:\s*exclude;/,
    );
    assert.match(
      bridgeCss,
      /html:not\(\.dark\)\[data-pmx-glass='1'\][\s\S]*?\[data-pmx-glass-zone='userBubble'\][\s\S]*?background-color:\s*var\(--pmx-glass-zone-user-bubble-bg,[\s\S]*?backdrop-filter:\s*var\(--pmx-glass-zone-user-bubble-backdrop,[\s\S]*?border:\s*1px solid transparent;/,
    );
    const fallbackSection = bridgeCss.slice(
      bridgeCss.indexOf('/* ── 7. Three Mandatory Solid Fallbacks'),
    );
    assert.ok(
      (fallbackSection.match(/\[data-user-message-bubble\]\[data-user-message-bubble-surface='1'\]/g) ?? []).length >= 10,
      'all 3 solid fallbacks (dark + light + ::before disable) + forced-colors must cover user message capsule bubbles',
    );
    assert.ok(
      (fallbackSection.match(/\[data-sidebar-card='1'\]/g) ?? []).length >= 13,
      'all 3 solid fallbacks (dark + light, rest + active) + forced-colors must cover sidebar cards',
    );
  });
});

describe('8-zone liquid glass expansion (`userBubble` + `overviewPanel`), legacy 6-zone lossless migration & Fresnel rim', () => {
  it('migrates legacy 6-zone persisted configs without losing user customizations while auto-filling userBubble & overviewPanel defaults', () => {
    const legacySixZoneSnapshot = JSON.stringify({
      format: WB_THEME_FORMAT,
      version: WB_THEME_VERSION,
      name: 'Legacy 6-Zone Custom Theme',
      appearance: {
        themeMode: 'glass',
        glassBasePolarity: 'dark',
        glassPreset: 'balanced',
        glassZones: {
          shellFrame: { mode: 'custom', opacity: 28, blurPx: 16, saturation: 115 },
          rightSidebar: { mode: 'custom', opacity: 20, blurPx: 10, saturation: 120 },
          mainCanvas: { mode: 'custom', opacity: 12, blurPx: 4 },
          workPanels: { mode: 'custom', opacity: 64, blurPx: 18 },
          composer: { mode: 'solid' },
          overlays: { mode: 'custom', opacity: 76, blurPx: 22 },
        },
      },
    });

    const imported = importWbThemeSnapshot(legacySixZoneSnapshot);
    assert.equal(imported.ok, true);
    if (!imported.ok) return;
    assert.equal(imported.strippedFields.length, 0);

    const z = imported.snapshot.appearance.glassZones;
    // Original 6 zone user customizations preserved 100% intact
    assert.deepEqual(z.shellFrame, { mode: 'custom', opacity: 28, blurPx: 16, saturation: 115 });
    assert.deepEqual(z.rightSidebar, { mode: 'custom', opacity: 20, blurPx: 10, saturation: 120 });
    assert.deepEqual(z.mainCanvas, { mode: 'custom', opacity: 12, blurPx: 4 });
    assert.deepEqual(z.workPanels, { mode: 'custom', opacity: 64, blurPx: 18 });
    assert.deepEqual(z.composer, { mode: 'solid' });
    assert.deepEqual(z.overlays, { mode: 'custom', opacity: 76, blurPx: 22 });
    // New 7th & 8th zones seamlessly auto-filled to inherit defaults
    assert.deepEqual(z.userBubble, { mode: 'inherit' });
    assert.deepEqual(z.overviewPanel, { mode: 'inherit' });
    assert.equal(countCustomizedGlassZones(imported.snapshot.appearance), 6);
  });

  it('delivers airier translucent defaults for userBubble & overviewPanel in Dark & Light Glass, independent custom/solid controls, and GPU=0 solid fallback', () => {
    const html = createMockElement();
    const body = createMockElement();
    const doc: DocumentLike = { documentElement: html, body };

    // Dark Glass balanced defaults: noticeably airier than legacy ~59% murky bubble / opaque stacked overview
    const darkCfg = normalizeAppearanceConfig({
      themeMode: 'glass',
      glassBasePolarity: 'dark',
      glassPreset: 'balanced',
    });
    const darkRt = applyPrismuxAppearanceToDocument(darkCfg, { document: doc, wallpaperActive: true });
    assert.equal(darkRt.zones.userBubble.effectiveMode, 'inherit');
    assert.ok(
      darkRt.zones.userBubble.opacity >= 18 && darkRt.zones.userBubble.opacity <= 30,
      `dark balanced userBubble should be airy translucent (18-30%), got ${darkRt.zones.userBubble.opacity}%`,
    );
    assert.ok(darkRt.zones.userBubble.blurPx >= 14);
    assert.match(darkRt.zones.userBubble.sheenCss, /^linear-gradient\(135deg,/);
    assert.equal(html.attrs.get('data-pmx-zone-user-bubble-mode'), 'inherit');
    assert.equal(html.styles.get('--pmx-glass-zone-user-bubble-bg'), darkRt.zones.userBubble.bgCss);
    assert.equal(html.styles.get('--pmx-glass-zone-user-bubble-backdrop'), darkRt.zones.userBubble.backdropCss);

    assert.equal(darkRt.zones.overviewPanel.effectiveMode, 'inherit');
    assert.ok(
      darkRt.zones.overviewPanel.opacity >= 28 && darkRt.zones.overviewPanel.opacity <= 42,
      `dark balanced overviewPanel should be airy frosted (28-42%), got ${darkRt.zones.overviewPanel.opacity}%`,
    );
    assert.ok(darkRt.zones.overviewPanel.blurPx >= 16);
    assert.equal(html.attrs.get('data-pmx-zone-overview-panel-mode'), 'inherit');
    assert.equal(html.styles.get('--pmx-glass-zone-overview-panel-bg'), darkRt.zones.overviewPanel.bgCss);
    assert.equal(html.styles.get('--pmx-glass-zone-overview-panel-backdrop'), darkRt.zones.overviewPanel.backdropCss);

    // Light Glass balanced defaults: crisp snow-mist translucency (lighter than legacy 56%)
    const lightCfg = normalizeAppearanceConfig({
      themeMode: 'glass',
      glassBasePolarity: 'light',
      glassPreset: 'balanced',
    });
    const lightRt = resolveAppearanceRuntime(lightCfg);
    assert.ok(
      lightRt.zones.userBubble.opacity >= 30 && lightRt.zones.userBubble.opacity <= 45,
      `light balanced userBubble should be airy pearl glass (30-45%), got ${lightRt.zones.userBubble.opacity}%`,
    );
    assert.ok(
      lightRt.zones.overviewPanel.opacity >= 40 && lightRt.zones.overviewPanel.opacity <= 55,
      `light balanced overviewPanel should be clean frosted glass (40-55%), got ${lightRt.zones.overviewPanel.opacity}%`,
    );

    // Customizing rightSidebar or shellFrame does NOT affect overviewPanel (completely decoupled!)
    let decoupled = updateGlassZone(darkCfg, 'rightSidebar', { mode: 'solid' });
    decoupled = updateGlassZone(decoupled, 'userBubble', {
      mode: 'custom',
      opacity: 18,
      blurPx: 20,
      saturation: 145,
    });
    decoupled = updateGlassZone(decoupled, 'overviewPanel', {
      mode: 'custom',
      opacity: 32,
      blurPx: 22,
      saturation: 130,
    });
    const decoupledRt = applyPrismuxAppearanceToDocument(decoupled, {
      document: doc,
      wallpaperActive: true,
    });
    assert.equal(decoupledRt.zones.rightSidebar.effectiveMode, 'solid');
    assert.equal(decoupledRt.zones.overviewPanel.effectiveMode, 'custom');
    assert.equal(decoupledRt.zones.overviewPanel.opacity, 32);
    assert.equal(decoupledRt.zones.overviewPanel.blurPx, 22);
    assert.equal(decoupledRt.zones.overviewPanel.saturation, 130);
    assert.equal(decoupledRt.zones.userBubble.effectiveMode, 'custom');
    assert.equal(decoupledRt.zones.userBubble.opacity, 18);
    assert.equal(decoupledRt.zones.userBubble.blurPx, 20);
    assert.equal(decoupledRt.zones.userBubble.saturation, 145);
    assert.equal(html.attrs.get('data-pmx-zone-user-bubble-mode'), 'custom');
    assert.equal(html.attrs.get('data-pmx-zone-overview-panel-mode'), 'custom');
    assert.equal(countCustomizedGlassZones(decoupled), 3);

    // Explicit solid mode for userBubble & overviewPanel
    let solidBoth = updateGlassZone(decoupled, 'userBubble', { mode: 'solid' });
    solidBoth = updateGlassZone(solidBoth, 'overviewPanel', { mode: 'solid' });
    const solidRt = applyPrismuxAppearanceToDocument(solidBoth, { document: doc, wallpaperActive: true });
    assert.equal(solidRt.zones.userBubble.effectiveMode, 'solid');
    assert.equal(solidRt.zones.userBubble.blurPx, 0);
    assert.equal(solidRt.zones.userBubble.backdropCss, 'none');
    assert.equal(solidRt.zones.overviewPanel.effectiveMode, 'solid');
    assert.equal(solidRt.zones.overviewPanel.blurPx, 0);
    assert.equal(solidRt.zones.overviewPanel.backdropCss, 'none');

    // Roundtrip export/import of customized 8-zone .wb-theme snapshot
    const serialized = serializeWbThemeSnapshot(decoupled, {
      name: 'Prismux 8-Zone Glass',
      exportedAt: '2026-11-25T00:00:00.000Z',
    });
    const roundtripped = importWbThemeSnapshot(serialized);
    assert.equal(roundtripped.ok, true);
    if (!roundtripped.ok) return;
    assert.deepEqual(roundtripped.snapshot.appearance, decoupled);

    // UI copy & CSS contract checks: 8-zone labels + single-pass overviewPanel stripping overlays/dropdown-glass
    const here = path.dirname(fileURLToPath(import.meta.url));
    const configuratorSrc = fs.readFileSync(
      new URL('../../src/GlassZoneConfigurator.tsx', import.meta.url),
      'utf8',
    );
    const heroSrc = fs.readFileSync(
      new URL('../../src/AppearanceHeroAndCards.tsx', import.meta.url),
      'utf8',
    );
    const bridgeCss = fs.readFileSync(path.resolve(here, '../styles/prismux-glass-bridge.css'), 'utf8');
    const cardsCss = fs.readFileSync(path.resolve(here, '../styles/appearance-cards.css'), 'utf8');

    assert.ok(configuratorSrc.includes('工作台 8 分区精细玻璃控制'));
    assert.equal(configuratorSrc.includes('工作台 6 分区'), false);
    assert.equal(configuratorSrc.includes('展开全部 6 区'), false);
    assert.ok(heroSrc.includes('8 大工作台分区'));
    assert.equal(heroSrc.includes('6 大工作台分区'), false);
    assert.match(cardsCss, /\.pmx-gz-pill-bar\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);

    // Overview panel single-pass glass + popover-popup overlay stripping + solid fallbacks
    assert.match(bridgeCss, /\[data-slot='popover-popup'\]:has\(\[data-pmx-glass-zone='overviewPanel'\]\)/);
    assert.match(bridgeCss, /\[data-thread-details-card\]:has\(\[data-pmx-glass-zone='overviewPanel'\]\)/);
    assert.match(bridgeCss, /--pmx-glass-zone-overview-panel-bg/);
    assert.match(bridgeCss, /--pmx-glass-zone-overview-panel-backdrop/);
    assert.match(bridgeCss, /data-pmx-zone-overview-panel-mode='solid'/);
    assert.match(bridgeCss, /data-pmx-zone-user-bubble-mode='solid'/);
    const fallbackSection = bridgeCss.slice(
      bridgeCss.indexOf('/* ── 7. Three Mandatory Solid Fallbacks'),
    );
    assert.ok(
      (fallbackSection.match(/--pmx-glass-zone-user-bubble-bg:/g) ?? []).length === 3,
      'all 3 solid fallback blocks must reset --pmx-glass-zone-user-bubble-bg',
    );
    assert.ok(
      (fallbackSection.match(/--pmx-glass-zone-overview-panel-bg:/g) ?? []).length === 3,
      'all 3 solid fallback blocks must reset --pmx-glass-zone-overview-panel-bg',
    );
    assert.ok(
      (fallbackSection.match(/\[data-thread-details-card\]:has\(\[data-pmx-glass-zone='overviewPanel'\]\)/g) ?? [])
        .length >= 4,
      'all 3 solid fallback blocks + forced-colors must cover overviewPanel card wrapper',
    );
    assert.ok(
      (
        fallbackSection.match(
          /\[data-pmx-glass-zone='userBubble'\](?:\s*\))?::before/g,
        ) ?? []
      ).length >= 4,
      'all 3 solid fallback blocks + forced-colors must disable userBubble Fresnel ::before rim',
    );
  });

  it('RC.2 low-density 8-zone cards gate sliders on custom mode, use 2-col grid, and export ThemePaletteCard & ThemeSnapshotActions', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const configuratorSrc = fs.readFileSync(
      new URL('../../src/GlassZoneConfigurator.tsx', import.meta.url),
      'utf8',
    );
    const heroSrc = fs.readFileSync(
      new URL('../../src/AppearanceHeroAndCards.tsx', import.meta.url),
      'utf8',
    );
    const indexSrc = fs.readFileSync(path.resolve(here, '../index.js'), 'utf8');
    const cardsCss = fs.readFileSync(path.resolve(here, '../styles/appearance-cards.css'), 'utf8');

    // 3-state compact mode labels + sliders strictly gated on isCustom
    assert.ok(configuratorSrc.includes("label: '跟随'"));
    assert.ok(configuratorSrc.includes("label: '自定义'"));
    assert.ok(configuratorSrc.includes("label: '不透明'"));
    assert.ok(configuratorSrc.includes('{isCustom ? ('));
    assert.ok(configuratorSrc.includes('data-pmx-zone-sliders={meta.id}'));

    // 2-column grid with align-items: start & reduced-motion guard
    assert.match(cardsCss, /\.pmx-appearance\s+\.pmx-gz-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[^}]*align-items:\s*start;/s);
    assert.match(cardsCss, /\.pmx-appearance\s+\.pmx-gz-sliders-expand/);

    // Composable RC.2 Tab components & unified typography font-selector toggle + Fresnel slider
    assert.ok(heroSrc.includes('export function ThemePaletteCard'));
    assert.ok(heroSrc.includes('export function ThemeSnapshotActions'));
    assert.ok(heroSrc.includes('showFontFamilySelectors'));
    assert.ok(heroSrc.includes('config.fresnelStrength'));
    assert.match(indexSrc, /ThemePaletteCard/);
    assert.match(indexSrc, /ThemeSnapshotActions/);
  });

  it('RC.2 #705 binds inline markdown file links and mention/file/citation context chips to --pmx-accent while preserving custom UI colors and bubble ink', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const bridgeCss = fs.readFileSync(path.resolve(here, '../styles/prismux-glass-bridge.css'), 'utf8');

    // Global Prismux theme accent binding for context chips & info-foreground
    assert.match(
      bridgeCss,
      /html\[data-pmx-theme\],\s*html\.dark\[data-pmx-theme\],\s*html:not\(\.dark\)\[data-pmx-theme\],\s*html\[data-pmx-theme\]\[data-theme-id\]:not\(\[data-theme-id=''\]\)\s*\{[^}]*--context-chip-mention:\s*var\(--pmx-accent,\s*#5e9bff\);[^}]*--context-chip-file:\s*var\(--pmx-accent,\s*#5e9bff\);[^}]*--context-chip-citation:\s*var\(--pmx-accent,\s*#5e9bff\);[^}]*--info-foreground:\s*var\(--pmx-accent,\s*#5e9bff\);/s,
    );

    // .chat-markdown-file-link & [data-slot="context-chip"].chat-markdown-file-link follow --pmx-accent and preserve --context-chip-message-ink
    assert.match(
      bridgeCss,
      /html\[data-pmx-theme\] \.chat-markdown-file-link,\s*html\[data-pmx-theme\] \[data-slot="context-chip"\]\.chat-markdown-file-link\s*\{[^}]*--context-chip-accent:\s*var\(--pmx-accent,\s*#5e9bff\);[^}]*--context-chip-ink:\s*var\(--context-chip-message-ink,\s*var\(--pmx-accent,\s*#5e9bff\)\);[^}]*color:\s*var\(--context-chip-ink\);/s,
    );

    // Explicit UI custom colors (data-pmx-ui-colors='1') override afterward while preserving --context-chip-message-ink
    const baseIdx = bridgeCss.indexOf('html[data-pmx-theme] .chat-markdown-file-link');
    const customIdx = bridgeCss.indexOf(
      'html[data-pmx-theme][data-pmx-ui-colors=\'1\'] .chat-markdown-file-link',
    );
    assert.ok(baseIdx > 0 && customIdx > baseIdx, 'custom UI color override must appear after base accent binding');
    assert.match(
      bridgeCss.slice(customIdx),
      /--context-chip-accent:\s*var\(--pmx-ui-file-icon,\s*var\(--pmx-accent,\s*#5e9bff\)\);/,
    );
    assert.match(
      bridgeCss.slice(customIdx),
      /--context-chip-ink:\s*var\(\s*--context-chip-message-ink,\s*var\(--pmx-ui-file-icon,\s*var\(--pmx-accent,\s*#5e9bff\)\)\s*\);/,
    );
  });

  it('RC.3 restores unmistakable 3-tier Level-1/Level-2 text hierarchy in glass & solid modes and upgrades TypographyCard with live hierarchy preview', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const bridgeCss = fs.readFileSync(path.resolve(here, '../styles/prismux-glass-bridge.css'), 'utf8');
    const cardsCss = fs.readFileSync(path.resolve(here, '../styles/appearance-cards.css'), 'utf8');
    const heroSrc = fs.readFileSync(
      new URL('../../src/AppearanceHeroAndCards.tsx', import.meta.url),
      'utf8',
    );

    // 1. Solid typography fallbacks preserve crisp step-down for Level-2 muted copy
    assert.equal(DEFAULT_TYPOGRAPHY_FALLBACKS.light.mutedColor, '#5c6470');
    assert.equal(DEFAULT_TYPOGRAPHY_FALLBACKS.dark.mutedColor, '#98a1b2');

    // 2. Dark & Light Glass 3-tier separation (Primary vs cool/slate Secondary vs Placeholder)
    assert.match(bridgeCss, /--foreground:\s*rgba\(255,\s*255,\s*255,\s*0\.96\);/);
    assert.match(bridgeCss, /--muted-foreground:\s*rgba\(203,\s*213,\s*225,\s*0\.66\);/);
    assert.match(bridgeCss, /--placeholder:\s*rgba\(203,\s*213,\s*225,\s*0\.50\);/);
    assert.match(bridgeCss, /--icon-muted:\s*rgba\(203,\s*213,\s*225,\s*0\.72\);/);

    assert.match(bridgeCss, /--foreground:\s*rgba\(15,\s*23,\s*42,\s*0\.95\);/);
    assert.match(bridgeCss, /--muted-foreground:\s*rgba\(51,\s*65,\s*85,\s*0\.70\);/);
    assert.match(bridgeCss, /--placeholder:\s*rgba\(51,\s*65,\s*85,\s*0\.54\);/);
    assert.match(bridgeCss, /--icon-muted:\s*rgba\(51,\s*65,\s*85,\s*0\.72\);/);

    // 3. Custom typography color overrides scope cleanly across Settings, Work Panels, Sidebar & Status Bar
    assert.ok(bridgeCss.includes("[data-slot='settings-row']"));
    assert.ok(bridgeCss.includes("[data-pmx-work-panel='1']"));
    assert.ok(bridgeCss.includes(":not([data-pmx-setting-title='1'])"));

    // 4. TypographyCard renders clear 3-role labels, subtitles & compact live hierarchy preview
    assert.ok(heroSrc.includes('一级标题字色'));
    assert.ok(heroSrc.includes('正文与设置项名'));
    assert.ok(heroSrc.includes('二级说明与辅助字'));
    assert.ok(heroSrc.includes('设置分区标题、面板大标题与卡片主标题'));
    assert.ok(heroSrc.includes('设置项名称、按钮标签与对话正文'));
    assert.ok(heroSrc.includes('设置项说明、副标题、占位提示与时间戳'));
    assert.ok(heroSrc.includes('主次层级实时预览'));
    assert.ok(heroSrc.includes('data-pmx-typography-preview="1"'));

    // 5. Cards stylesheet defines preview rules & zero @media (prefers-color-scheme) rules
    assert.ok(cardsCss.includes('.pmx-typo-preview'));
    const cardsCssNoComments = cardsCss.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!cardsCssNoComments.includes('prefers-color-scheme'));
  });
});

describe('RC.3 Liquid Glass Theme Substrates (`GlassThemeBase` 6-substrate system)', () => {
  it('defines all 6 GlassThemeBase enums with 4-character Chinese labels, defaults to pure, and falls back invalid values to pure', () => {
    assert.deepEqual(GLASS_THEME_BASE_IDS, [
      'pure',
      'starry-violet',
      'emerald-stars',
      'sakura-drift',
      'ocean-caustics',
      'gilded-lunar',
    ]);
    assert.equal(GLASS_THEME_BASE_META.length, 6);
    assert.deepEqual(
      GLASS_THEME_BASE_META.map((item) => [item.id, item.label]),
      [
        ['pure', '纯净官方'],
        ['starry-violet', '星语紫夜'],
        ['emerald-stars', '翠星漫野'],
        ['sakura-drift', '樱雪浮岚'],
        ['ocean-caustics', '沧海浮光'],
        ['gilded-lunar', '鎏金织月'],
      ],
    );
    for (const item of GLASS_THEME_BASE_META) {
      assert.equal(item.label.length, 4, `${item.id} label must be a 4-char Chinese name`);
      assert.ok(item.note.trim().length >= 12, `${item.id} must have a descriptive poetic note`);
      assert.ok(item.swatchCss.trim().length > 20, `${item.id} must provide miniature swatch CSS`);
      assert.equal(
        /url\(\s*['"]?https?:\/\//i.test(item.swatchCss),
        false,
        `${item.id} swatchCss must make zero external network requests`,
      );
    }

    assert.equal(DEFAULT_APPEARANCE_CONFIG.glassThemeBase, 'pure');
    assert.equal(normalizeAppearanceConfig({}).glassThemeBase, 'pure');

    // All 6 valid enum values normalize cleanly
    for (const base of GLASS_THEME_BASE_IDS) {
      assert.equal(normalizeAppearanceConfig({ glassThemeBase: base }).glassThemeBase, base);
    }

    // Invalid value falls back safely to 'pure', even when overriding a non-pure base config
    const nonPureBase = normalizeAppearanceConfig({ glassThemeBase: 'starry-violet' });
    assert.equal(
      normalizeAppearanceConfig(
        { glassThemeBase: 'unknown-substrate' as unknown as GlassThemeBase },
        nonPureBase,
      ).glassThemeBase,
      'pure',
    );
    // Omitted glassThemeBase preserves base config's existing glassThemeBase
    assert.equal(
      normalizeAppearanceConfig({ wallpaperDim: 40 }, nonPureBase).glassThemeBase,
      'starry-violet',
    );
  });

  it('switches data-pmx-glass-base accurately under active glass, non-glass, GPU=0, reduced-transparency, and auto-wakes glass on selection', () => {
    const html = createMockElement();
    const body = createMockElement();
    const doc: DocumentLike = { documentElement: html, body };

    const violetGlass = normalizeAppearanceConfig({
      themeMode: 'glass',
      glassPreset: 'clear',
      glassThemeBase: 'starry-violet',
    });

    // 1. Active Liquid Glass -> selected substrate applies live
    applyPrismuxAppearanceToDocument(violetGlass, { document: doc });
    assert.equal(html.attrs.get('data-pmx-glass'), '1');
    assert.equal(html.attrs.get('data-pmx-glass-base'), 'starry-violet');
    assert.equal(html.attrs.get('data-pmx-glass-base-selected'), 'starry-violet');
    assert.equal(body.attrs.get('data-pmx-glass-base'), 'starry-violet');
    assert.equal(body.attrs.get('data-pmx-glass-base-selected'), 'starry-violet');

    // 2. Non-glass mode -> effective data-pmx-glass-base falls back to 'pure' while preserving diagnostic selected attr
    const darkNative = normalizeAppearanceConfig({
      themeMode: 'dark',
      glassThemeBase: 'emerald-stars',
    });
    applyPrismuxAppearanceToDocument(darkNative, { document: doc });
    assert.equal(html.attrs.get('data-pmx-glass'), '0');
    assert.equal(html.attrs.get('data-pmx-glass-base'), 'pure');
    assert.equal(html.attrs.get('data-pmx-glass-base-selected'), 'emerald-stars');

    // 3. Glass mode with preset 'off' -> glassActive is false -> falls back to 'pure'
    const offPreset = applyGlassPreset(violetGlass, 'off');
    applyPrismuxAppearanceToDocument(offPreset, { document: doc });
    assert.equal(html.attrs.get('data-pmx-glass'), '0');
    assert.equal(html.attrs.get('data-pmx-glass-base'), 'pure');
    assert.equal(html.attrs.get('data-pmx-glass-base-selected'), 'starry-violet');

    // 4. GPU disabled -> falls back to 'pure'
    applyPrismuxAppearanceToDocument(violetGlass, { document: doc, gpuAvailable: false });
    assert.equal(html.attrs.get('data-pmx-gpu'), '0');
    assert.equal(html.attrs.get('data-pmx-glass-base'), 'pure');
    assert.equal(html.attrs.get('data-pmx-glass-base-selected'), 'starry-violet');

    // 5. Reduced transparency -> falls back to 'pure'
    applyPrismuxAppearanceToDocument(violetGlass, { document: doc, reducedTransparency: true });
    assert.equal(html.attrs.get('data-pmx-reduced-transparency'), '1');
    assert.equal(html.attrs.get('data-pmx-glass-base'), 'pure');
    assert.equal(html.attrs.get('data-pmx-glass-base-selected'), 'starry-violet');

    // 6. Auto-wake helper wakes glass from dark mode or preset 'off' when selecting non-pure base
    const wokeFromDark = setGlassThemeBaseWithAutoWake(darkNative, 'sakura-drift');
    assert.equal(wokeFromDark.themeMode, 'glass');
    assert.equal(wokeFromDark.glassThemeBase, 'sakura-drift');
    assert.equal(resolveAppearanceRuntime(wokeFromDark).glassActive, true);

    const wokeFromOff = setGlassThemeBaseWithAutoWake(offPreset, 'ocean-caustics');
    assert.equal(wokeFromOff.themeMode, 'glass');
    assert.equal(wokeFromOff.glassPreset, 'balanced');
    assert.equal(wokeFromOff.glassThemeBase, 'ocean-caustics');

    // Selecting 'pure' in non-glass mode does not force glass mode on
    const stayedDark = setGlassThemeBaseWithAutoWake(darkNative, 'pure');
    assert.equal(stayedDark.themeMode, 'dark');
    assert.equal(stayedDark.glassThemeBase, 'pure');

    // 7. Clear removes both managed attributes cleanly
    clearPrismuxAppearanceFromDocument(doc);
    assert.equal(html.attrs.has('data-pmx-glass-base'), false);
    assert.equal(html.attrs.has('data-pmx-glass-base-selected'), false);
    assert.equal(body.attrs.has('data-pmx-glass-base'), false);
    assert.equal(body.attrs.has('data-pmx-glass-base-selected'), false);
  });

  it('roundtrips glassThemeBase through .wb-theme export/import and safely defaults legacy or invalid snapshots', () => {
    for (const base of GLASS_THEME_BASE_IDS) {
      const cfg = normalizeAppearanceConfig({ themeMode: 'glass', glassThemeBase: base });
      const json = serializeWbThemeSnapshot(cfg, {
        name: `Theme ${base}`,
        exportedAt: '2026-11-26T00:00:00.000Z',
      });
      const res = importWbThemeSnapshot(json);
      assert.equal(res.ok, true);
      if (!res.ok) continue;
      assert.equal(res.strippedFields.length, 0);
      assert.equal(res.snapshot.appearance.glassThemeBase, base);
      assert.deepEqual(res.snapshot.appearance, cfg);
    }

    // Legacy snapshot without glassThemeBase defaults cleanly to 'pure'
    const legacy = importWbThemeSnapshot(
      JSON.stringify({
        format: WB_THEME_FORMAT,
        version: WB_THEME_VERSION,
        name: 'Pre-RC3 Theme',
        appearance: { themeMode: 'glass', glassPreset: 'balanced' },
      }),
    );
    assert.equal(legacy.ok, true);
    if (legacy.ok) {
      assert.equal(legacy.strippedFields.length, 0);
      assert.equal(legacy.snapshot.appearance.glassThemeBase, 'pure');
    }

    // Invalid glassThemeBase in snapshot falls back to 'pure'
    const invalid = importWbThemeSnapshot(
      JSON.stringify({
        format: WB_THEME_FORMAT,
        version: WB_THEME_VERSION,
        name: 'Bad Substrate',
        appearance: { themeMode: 'glass', glassThemeBase: 'not-real' },
      }),
    );
    assert.equal(invalid.ok, true);
    if (invalid.ok) {
      assert.equal(invalid.snapshot.appearance.glassThemeBase, 'pure');
    }
  });

  it('renders all 6 theme substrate pills with live notes in both InlineAppearanceStudio and LiquidGlassCard and wires CSS layers & fallbacks', () => {
    const selectedCfg = normalizeAppearanceConfig({
      themeMode: 'glass',
      glassPreset: 'clear',
      glassThemeBase: 'emerald-stars',
    });
    const noop = () => undefined;

    const inlineHtml = renderToStaticMarkup(
      createElement(InlineAppearanceStudio, {
        config: selectedCfg,
        onChange: noop,
      }),
    );
    const cardHtml = renderToStaticMarkup(
      createElement(LiquidGlassCard, {
        config: selectedCfg,
        onChange: noop,
        onOpenColorPicker: noop,
      }),
    );

    for (const [name, markup] of [
      ['InlineAppearanceStudio', inlineHtml],
      ['LiquidGlassCard', cardHtml],
    ] as const) {
      assert.ok(markup.includes('主题基底'), `${name} must render 主题基底 heading`);
      assert.ok(
        markup.includes(GLASS_THEME_BASE_META[2]!.note),
        `${name} must display dynamic poetic note for active substrate`,
      );
      for (const item of GLASS_THEME_BASE_META) {
        assert.ok(
          markup.includes(`data-glass-theme-base="${item.id}"`),
          `${name} must render button for ${item.id}`,
        );
        assert.ok(markup.includes(item.label), `${name} must render Chinese label ${item.label}`);
        assert.ok(
          markup.includes(`data-theme-base-swatch="${item.id}"`),
          `${name} must render miniature swatch for ${item.id}`,
        );
      }
      assert.match(
        markup,
        /data-glass-theme-base="emerald-stars"[^>]*aria-pressed="true"/,
        `${name} must mark selected substrate button aria-pressed="true"`,
      );
      assert.match(
        markup,
        /data-glass-theme-base="pure"[^>]*aria-pressed="false"/,
        `${name} must mark unselected substrate button aria-pressed="false"`,
      );
    }

    // Verify source/built switching callbacks and complete CSS substrate + fallback coverage
    const here = path.dirname(fileURLToPath(import.meta.url));
    const inlineSrc = fs.readFileSync(
      new URL('../../src/InlineAppearanceStudio.tsx', import.meta.url),
      'utf8',
    );
    const heroSrc = fs.readFileSync(
      new URL('../../src/AppearanceHeroAndCards.tsx', import.meta.url),
      'utf8',
    );
    const bridgeCss = fs.readFileSync(path.resolve(here, '../styles/prismux-glass-bridge.css'), 'utf8');
    const cardsCss = fs.readFileSync(path.resolve(here, '../styles/appearance-cards.css'), 'utf8');

    assert.ok(inlineSrc.includes('handleSelectThemeBase(item.id)'));
    assert.ok(inlineSrc.includes('setGlassThemeBaseWithAutoWake'));
    assert.ok(heroSrc.includes('setGlassThemeBaseWithAutoWake(config, item.id)'));

    // Balanced braces & zero prefers-color-scheme & zero external http(s) URLs in substrate styles
    for (const [name, css] of [
      ['prismux-glass-bridge.css', bridgeCss],
      ['appearance-cards.css', cardsCss],
    ] as const) {
      const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
      assert.equal(noComments.includes('prefers-color-scheme'), false, `${name} must never use prefers-color-scheme`);
      assert.equal(
        (noComments.match(/\{/g) ?? []).length,
        (noComments.match(/\}/g) ?? []).length,
        `${name} must keep balanced braces`,
      );
      assert.equal(
        /url\(\s*['"]?https?:\/\//i.test(noComments),
        false,
        `${name} must never reference external http(s) URLs`,
      );
    }

    // All 5 patterned substrates defined for both Dark & Light Glass, including exact 1:1 star-neko recipe & SVG patterns
    for (const base of [
      'starry-violet',
      'emerald-stars',
      'sakura-drift',
      'ocean-caustics',
      'gilded-lunar',
    ] as const) {
      assert.ok(
        bridgeCss.includes(`html.dark[data-pmx-glass='1'][data-pmx-glass-base='${base}']`),
        `bridge CSS must define Dark Glass rules for ${base}`,
      );
      assert.ok(
        bridgeCss.includes(`html:not(.dark)[data-pmx-glass='1'][data-pmx-glass-base='${base}']`),
        `bridge CSS must define Light Glass rules for ${base}`,
      );
    }
    assert.ok(bridgeCss.includes('repeating-linear-gradient(135deg, transparent 0 38px, #b994ee12 38px 39.5px)'));
    assert.ok(bridgeCss.includes('rgba(68, 55, 84, 0.42)'));
    assert.ok(bridgeCss.includes('inset 3px 0 #bda2f2'));
    assert.ok(bridgeCss.includes('inset 0 -2px #b99bea'));
    assert.ok(bridgeCss.includes("data:image/svg+xml"));
    assert.ok(bridgeCss.includes("[data-pmx-shell-backdrop='1']::before"));
    assert.ok(bridgeCss.includes("body::before"));
    assert.ok(bridgeCss.includes('--pmx-glass-base-rim'));
    assert.ok(bridgeCss.includes('--pmx-glass-base-glow'));

    // Section 7 fallbacks tear down substrate pseudo-layers cleanly
    const fallbackSection = bridgeCss.slice(
      bridgeCss.indexOf('/* ── 7. Three Mandatory Solid Fallbacks'),
    );
    assert.ok(
      (fallbackSection.match(/\[data-pmx-shell-backdrop='1'\]::before/g) ?? []).length >= 3,
      'solid fallbacks must hide [data-pmx-shell-backdrop="1"]::before',
    );
    assert.ok(
      (fallbackSection.match(/body::before/g) ?? []).length >= 3,
      'solid fallbacks must hide no-wallpaper body::before substrate canvas',
    );

    // Theme base picker styles present in appearance-cards.css
    assert.ok(cardsCss.includes('.pmx-theme-base-grid'));
    assert.ok(cardsCss.includes('.pmx-theme-base-pill'));
    assert.ok(cardsCss.includes('.pmx-theme-base-swatch'));
  });
});
