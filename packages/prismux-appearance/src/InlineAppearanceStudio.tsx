import { useCallback, useMemo, useState } from 'react';
import {
  GLASS_REGION_LIMITS,
  GLASS_THEME_BASE_META,
  type AppearanceConfig,
  type GlassPreset,
  type GlassThemeBase,
  type ThemeMode,
} from './types.js';
import {
  applyGlassPreset,
  resolveBasePolarity,
  setGlassThemeBaseWithAutoWake,
  setThemeModeWithGlassAutoWake,
} from './glassEngine.js';
import { normalizeHex } from './colorUtils.js';
import { CelestialThemeCapsule } from './CelestialThemeCapsule.js';
import { FloatingColorPopover } from './FloatingColorPopover.js';
import { GlassZoneConfigurator } from './GlassZoneConfigurator.js';

export interface InlineAppearanceStudioProps {
  config: AppearanceConfig;
  onChange: (next: AppearanceConfig) => void;
  /**
   * Optional explicit theme mode handler (e.g. host runtime sync with Prismux's theme store).
   * Falls back to `onChange(setThemeModeWithGlassAutoWake(config, mode))` when omitted.
   */
  onThemeModeChange?: (mode: ThemeMode) => void;
  /** Host OS system accent hex color (used when `accentMode === 'system'`). */
  systemAccent?: string;
  /** Callback for top-left "← 返回壁纸" button; omitted hides the back button. */
  onBack?: () => void;
  /** Label for the top back button (defaults to `'返回壁纸'`). */
  backLabel?: string;
  /** Header title (defaults to `'外观与玻璃'`). */
  title?: string;
  /** Optional footer shortcut to open `/settings/appearance` (omitted hides footer link). */
  onOpenFullSettings?: () => void;
  /** Label for the optional full settings footer button (defaults to `'打开完整外观设置 ↗'`). */
  fullSettingsLabel?: string;
  /** Optional portal target for `FloatingColorPopover`. */
  popoverPortalContainer?: Element | null;
  className?: string;
}

type InlineColorSlot = 'accent' | 'glassColor' | 'glassDarkColor';

interface InlinePickerState {
  slot: InlineColorSlot;
  title: string;
  fallbackColor: string;
  anchorEl: HTMLElement;
}

const MODE_LABELS: Record<ThemeMode, string> = {
  light: '浅色',
  dark: '深色',
  glass: '玻璃',
};

const PRESET_OPTIONS: ReadonlyArray<{ id: GlassPreset; label: string }> = [
  { id: 'off', label: '关闭' },
  { id: 'light', label: '轻透' },
  { id: 'balanced', label: '均衡' },
  { id: 'clear', label: '全透' },
  { id: 'custom', label: '自定义' },
];

const QUICK_ACCENT_SWATCHES: ReadonlyArray<{ hex: string; label: string }> = [
  { hex: '#5e9bff', label: '晴空蓝' },
  { hex: '#38bdf8', label: '冰川青' },
  { hex: '#8b5cf6', label: '星语紫' },
  { hex: '#f472b6', label: '樱花粉' },
  { hex: '#10b981', label: '薄荷绿' },
  { hex: '#f59e0b', label: '琥珀橙' },
];

/**
 * Compact, zero-horizontal-scroll real-time Appearance & Liquid Glass studio
 * crafted specifically for the 320-420px right wallpaper sidebar.
 * Pure host visual control with 0 LLM token overhead.
 */
export function InlineAppearanceStudio({
  config,
  onChange,
  onThemeModeChange,
  systemAccent = '#0078d4',
  onBack,
  backLabel = '返回壁纸',
  title = '外观与玻璃',
  onOpenFullSettings,
  fullSettingsLabel = '打开完整外观设置 ↗',
  popoverPortalContainer,
  className,
}: InlineAppearanceStudioProps) {
  const [picker, setPicker] = useState<InlinePickerState | null>(null);

  const polarity = resolveBasePolarity(config);
  const fallbackAccent = polarity === 'light' ? '#005fb8' : '#5e9bff';
  const cleanAccent = normalizeHex(config.accent, true);
  const accentCleared = config.accentMode === 'custom' && !cleanAccent;
  const effectiveAccent = accentCleared
    ? fallbackAccent
    : normalizeHex(config.accentMode === 'custom' ? config.accent : systemAccent, true) ||
      fallbackAccent;

  const summaryBadge = useMemo(() => {
    const modeLabel = MODE_LABELS[config.themeMode];
    if (config.themeMode === 'glass') {
      const preset = PRESET_OPTIONS.find((p) => p.id === config.glassPreset)?.label ?? '均衡';
      return `${modeLabel} · ${preset}`;
    }
    return config.accentMode === 'system' ? `${modeLabel} · 跟随系统` : `${modeLabel} · 自定义`;
  }, [config.accentMode, config.glassPreset, config.themeMode]);

  const handleModeChange = useCallback(
    (nextMode: ThemeMode) => {
      if (onThemeModeChange) {
        onThemeModeChange(nextMode);
        return;
      }
      onChange(setThemeModeWithGlassAutoWake(config, nextMode));
    },
    [config, onChange, onThemeModeChange],
  );

  const handleSelectPreset = useCallback(
    (preset: GlassPreset) => {
      const next = applyGlassPreset(config, preset);
      if (preset !== 'off' && config.themeMode !== 'glass') {
        if (onThemeModeChange) {
          onChange({ ...next, themeMode: 'glass' });
          onThemeModeChange('glass');
          return;
        }
        onChange({ ...next, themeMode: 'glass' });
        return;
      }
      onChange(next);
    },
    [config, onChange, onThemeModeChange],
  );

  const handleSelectThemeBase = useCallback(
    (base: GlassThemeBase) => {
      const next = setGlassThemeBaseWithAutoWake(config, base);
      if (base !== 'pure' && config.themeMode !== 'glass' && onThemeModeChange) {
        onChange(next);
        onThemeModeChange('glass');
        return;
      }
      onChange(next);
    },
    [config, onChange, onThemeModeChange],
  );

  const activeThemeBase: GlassThemeBase = config.glassThemeBase ?? 'pure';
  const activeThemeBaseMeta =
    GLASS_THEME_BASE_META.find((item) => item.id === activeThemeBase) ?? GLASS_THEME_BASE_META[0]!;

  const togglePicker = (
    slot: InlineColorSlot,
    pickerTitle: string,
    fallbackColor: string,
    anchorEl: HTMLElement,
  ) => {
    setPicker((prev) =>
      prev && prev.slot === slot ? null : { slot, title: pickerTitle, fallbackColor, anchorEl },
    );
  };

  const applyPickerColor = (slot: InlineColorSlot, hex: string) => {
    if (slot === 'accent') {
      onChange({ ...config, accentMode: 'custom', accent: hex });
    } else if (slot === 'glassColor') {
      onChange({ ...config, glassColor: hex || '#ffffff' });
    } else {
      onChange({ ...config, glassDarkColor: hex || '#0d1524' });
    }
  };

  const activePickerValue = useMemo(() => {
    if (!picker) return '';
    if (picker.slot === 'accent') {
      return config.accentMode === 'custom' ? config.accent : effectiveAccent;
    }
    if (picker.slot === 'glassColor') return config.glassColor;
    return config.glassDarkColor;
  }, [config.accent, config.accentMode, config.glassColor, config.glassDarkColor, effectiveAccent, picker]);

  const isGlassMode = config.themeMode === 'glass';

  return (
    <div
      className={['pmx-appearance', 'pmx-inline-studio', className ?? ''].filter(Boolean).join(' ')}
      data-pmx-inline-appearance-studio="1"
    >
      {/* Top sticky navigation bar */}
      <header className="pmx-inline-studio__head">
        {onBack ? (
          <button
            type="button"
            className="pmx-inline-back-btn"
            data-pmx-inline-back="1"
            onClick={onBack}
          >
            <span aria-hidden="true">←</span>
            <span>{backLabel}</span>
          </button>
        ) : (
          <span className="pmx-inline-studio__title">{title}</span>
        )}
        <div className="pmx-inline-studio__head-right">
          {onBack ? <span className="pmx-inline-studio__title">{title}</span> : null}
          <span className="ilook-hero-badge" data-pmx-inline-summary="1">
            {summaryBadge}
          </span>
        </div>
      </header>

      {/* Scrollable real-time control body (zero horizontal scrollbar) */}
      <div className="pmx-inline-studio__body">
        {/* Section 1: Compact Celestial 3-State Capsule */}
        <section className="pmx-inline-section">
          <div className="pmx-inline-section__head">
            <span className="pmx-inline-section__title">主题模式</span>
            {!isGlassMode ? (
              <button
                type="button"
                className="pbtn sm al"
                data-pmx-inline-wake-glass="1"
                onClick={() => handleModeChange('glass')}
              >
                开启液态玻璃
              </button>
            ) : null}
          </div>
          <CelestialThemeCapsule
            mode={config.themeMode}
            compact
            onChange={handleModeChange}
          />
        </section>

        {/* Section 2: Global Glass Presets, Dimming & Accent / Tint */}
        <section className="pmx-inline-section">
          <div className="pmx-inline-section__head">
            <span className="pmx-inline-section__title">全局玻璃预设</span>
            <span className="pmx-inline-section__hint">实时生效</span>
          </div>

          <div
            className="seg dock-glass-seg pmx-inline-preset-seg"
            role="group"
            aria-label="液态玻璃预设"
          >
            {PRESET_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={config.glassPreset === opt.id ? 'on' : ''}
                data-glass-preset={opt.id}
                aria-pressed={config.glassPreset === opt.id}
                onClick={() => handleSelectPreset(opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="pmx-gz-sliders">
            <label className="pmx-gz-slider-row">
              <span className="pmx-gz-slider-lbl">底图压暗</span>
              <input
                type="range"
                className="rng"
                min={0}
                max={100}
                step={1}
                aria-label="壁纸底图压暗浓度"
                value={config.wallpaperDim}
                onChange={(e) => onChange({ ...config, wallpaperDim: Number(e.target.value) })}
              />
              <output className="rv">{config.wallpaperDim}%</output>
            </label>

            <label className="pmx-gz-slider-row">
              <span className="pmx-gz-slider-lbl">保真下限</span>
              <input
                type="range"
                className="rng"
                min={GLASS_REGION_LIMITS.fidelityMin}
                max={GLASS_REGION_LIMITS.fidelityMax}
                step={5}
                aria-label="玻璃可读性保真度"
                value={config.glassFidelity}
                onChange={(e) => onChange({ ...config, glassFidelity: Number(e.target.value) })}
              />
              <output className="rv">{config.glassFidelity}%</output>
            </label>
          </div>

          {/* Accent color quick swatches + FloatingColorPopover */}
          <div className="pmx-inline-color-row">
            <span className="pmx-inline-color-lbl">强调色</span>
            <div className="pmx-inline-swatches">
              <button
                type="button"
                className={`pbtn sm pmx-inline-mini-btn${config.accentMode === 'system' ? ' al' : ''}`}
                aria-pressed={config.accentMode === 'system'}
                onClick={() => onChange({ ...config, accentMode: 'system' })}
              >
                系统
              </button>
              {QUICK_ACCENT_SWATCHES.map((sw) => {
                const active =
                  config.accentMode === 'custom' && cleanAccent === sw.hex.toLowerCase();
                return (
                  <button
                    key={sw.hex}
                    type="button"
                    className={`pmx-inline-dot${active ? ' on' : ''}`}
                    style={{ backgroundColor: sw.hex }}
                    aria-label={`选择强调色 ${sw.label}`}
                    aria-pressed={active}
                    onClick={() => onChange({ ...config, accentMode: 'custom', accent: sw.hex })}
                  />
                );
              })}
              <button
                type="button"
                className={`typo-pill-btn pmx-inline-color-pill${picker?.slot === 'accent' ? ' on' : ''}`}
                aria-expanded={picker?.slot === 'accent'}
                aria-label="自定义强调色"
                onClick={(e) =>
                  togglePicker('accent', '强调色', effectiveAccent, e.currentTarget)
                }
              >
                <i className="typo-dot" style={{ background: effectiveAccent }} />
                <span className="typo-hex mono">{accentCleared ? '默认' : effectiveAccent}</span>
              </button>
            </div>
          </div>

          {/* Glass base tint + Dark separate toggle */}
          <div className="pmx-inline-color-row">
            <span className="pmx-inline-color-lbl">玻璃底色</span>
            <div className="pmx-inline-swatches">
              <button
                type="button"
                className={`pbtn sm pmx-inline-mini-btn${config.glassDarkSeparate ? ' al' : ''}`}
                aria-pressed={config.glassDarkSeparate}
                onClick={() =>
                  onChange({ ...config, glassDarkSeparate: !config.glassDarkSeparate })
                }
              >
                深色单独
              </button>
              <button
                type="button"
                className={`typo-pill-btn pmx-inline-color-pill${picker?.slot === 'glassColor' ? ' on' : ''}`}
                aria-expanded={picker?.slot === 'glassColor'}
                aria-label={config.glassDarkSeparate ? '浅色玻璃底色' : '玻璃底色'}
                onClick={(e) =>
                  togglePicker(
                    'glassColor',
                    config.glassDarkSeparate ? '浅色玻璃底色' : '玻璃底色',
                    '#ffffff',
                    e.currentTarget,
                  )
                }
              >
                <i className="typo-dot" style={{ background: config.glassColor }} />
                <span className="typo-hex mono">{config.glassColor.toLowerCase()}</span>
              </button>
              {config.glassDarkSeparate ? (
                <button
                  type="button"
                  className={`typo-pill-btn pmx-inline-color-pill${picker?.slot === 'glassDarkColor' ? ' on' : ''}`}
                  aria-expanded={picker?.slot === 'glassDarkColor'}
                  aria-label="深色玻璃底色"
                  onClick={(e) =>
                    togglePicker('glassDarkColor', '深色玻璃底色', '#0d1524', e.currentTarget)
                  }
                >
                  <i className="typo-dot" style={{ background: config.glassDarkColor }} />
                  <span className="typo-hex mono">{config.glassDarkColor.toLowerCase()}</span>
                </button>
              ) : null}
            </div>
          </div>
        </section>

        {/* Section 2.5: Liquid Glass Theme Substrate (2x3 compact visual cards) */}
        <section className="pmx-inline-section" data-pmx-theme-base-section="1">
          <div className="pmx-inline-section__head">
            <span className="pmx-inline-section__title">主题基底</span>
            <span className="pmx-inline-section__hint">{activeThemeBaseMeta.label}</span>
          </div>
          <div className="pmx-theme-base-note" data-pmx-theme-base-note="1">
            {activeThemeBaseMeta.note}
          </div>
          <div
            className="pmx-theme-base-grid is-compact"
            role="group"
            aria-label="液态玻璃主题基底"
          >
            {GLASS_THEME_BASE_META.map((item) => {
              const active = activeThemeBase === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`pmx-theme-base-pill${active ? ' on' : ''}`}
                  data-glass-theme-base={item.id}
                  aria-pressed={active}
                  aria-label={`${item.label}：${item.note}`}
                  onClick={() => handleSelectThemeBase(item.id)}
                >
                  <span
                    className="pmx-theme-base-swatch"
                    data-theme-base-swatch={item.id}
                    style={{ background: item.swatchCss }}
                    aria-hidden="true"
                  />
                  <span className="pmx-theme-base-label">{item.label}</span>
                  <span className="pmx-theme-base-check" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </section>

        {/* Section 3: Unified 8-Zone Configurator (Shell Frame & Right Feature Sidebar pinned first) */}
        <section className="pmx-inline-section">
          <GlassZoneConfigurator
            config={config}
            onChange={onChange}
            compact
            showSaturation
            disabled={!isGlassMode}
            disabledReason={!isGlassMode ? '当前为非玻璃模式，切至「玻璃」即可实时调节各分区通透度与模糊。' : undefined}
          />
        </section>
      </div>

      {/* Optional Footer Shortcut */}
      {onOpenFullSettings ? (
        <footer className="pmx-inline-studio__foot">
          <button
            type="button"
            className="pbtn sm pmx-inline-full-btn"
            data-pmx-inline-open-settings="1"
            onClick={onOpenFullSettings}
          >
            {fullSettingsLabel}
          </button>
        </footer>
      ) : null}

      <FloatingColorPopover
        open={picker !== null}
        value={activePickerValue}
        fallbackColor={picker?.fallbackColor ?? '#5e9bff'}
        anchorEl={picker?.anchorEl ?? null}
        title={picker?.title ?? '选择颜色'}
        portalContainer={popoverPortalContainer}
        onChange={(hex) => {
          if (picker) applyPickerColor(picker.slot, hex);
        }}
        onClear={() => {
          if (picker) applyPickerColor(picker.slot, '');
        }}
        onClose={() => setPicker(null)}
      />
    </div>
  );
}
