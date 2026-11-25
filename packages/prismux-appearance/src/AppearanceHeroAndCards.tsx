import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import {
  DEFAULT_APPEARANCE_CONFIG,
  DEFAULT_GLASS_ZONES,
  DEFAULT_TYPOGRAPHY_FALLBACKS,
  GLASS_REGION_LIMITS,
  type AppearanceConfig,
  type BaseThemePolarity,
  type GlassPreset,
  type GlassRegionId,
  type GlassSurfaceId,
  type SidebarCornerRadius,
  type SidebarSquareCorners,
  type ThemeMode,
  type ThinkingGlassMode,
  type WbThemeSnapshot,
} from './types.js';
import {
  applyGlassPreset,
  resolveBasePolarity,
  setThemeModeWithGlassAutoWake,
  updateGlassRegion,
} from './glassEngine.js';
import {
  exportWbThemeSnapshot,
  importWbThemeSnapshot,
  serializeWbThemeSnapshot,
} from './themeSnapshot.js';
import { normalizeHex } from './colorUtils.js';
import { CelestialThemeCapsule } from './CelestialThemeCapsule.js';
import { FloatingColorPopover } from './FloatingColorPopover.js';
import { GlassZoneConfigurator } from './GlassZoneConfigurator.js';

export type ActiveColorPickerSlot =
  | { kind: 'accent' }
  | { kind: 'glassColor' }
  | { kind: 'glassDarkColor' }
  | { kind: 'surfaceColor'; surfaceId: GlassSurfaceId }
  | { kind: 'typography'; polarity: BaseThemePolarity; role: 'headingColor' | 'textColor' | 'mutedColor' }
  | { kind: 'caretColor' }
  | { kind: 'uiColor'; key: 'send' | 'link' | 'fileIcon' | 'tab' | 'deepDiving' };

export interface ColorPickerOpenRequest {
  slot: ActiveColorPickerSlot;
  title: string;
  value: string;
  fallbackColor: string;
  anchorEl: HTMLElement;
}

const MODE_LABELS: Record<ThemeMode, string> = {
  light: '浅色',
  dark: '深色',
  glass: '玻璃',
};

const GLASS_PRESET_LABELS: Record<GlassPreset, string> = {
  off: '关闭',
  light: '轻透',
  balanced: '均衡',
  clear: '全透',
  custom: '自定义',
};

const GLASS_REGION_META: ReadonlyArray<{ id: GlassRegionId; title: string; note: string }> = [
  { id: 'surface', title: '全局底板基准', note: '未独立定制的侧栏与顶底栏默认继承值' },
  { id: 'card', title: '卡片与输入基准', note: '对话卡片、输入框与代码块默认继承值' },
  { id: 'overlay', title: '浮层与弹窗基准', note: '审批弹层、下拉菜单与抽屉默认继承值' },
  { id: 'control', title: '交互控件基准', note: '按钮、输入框与分段开关默认继承值' },
];

const UI_COLOR_ROWS: ReadonlyArray<{
  key: 'send' | 'link' | 'fileIcon' | 'tab' | 'deepDiving';
  label: string;
}> = [
  { key: 'send', label: '发送键与主行动按钮' },
  { key: 'link', label: '链接文字' },
  { key: 'fileIcon', label: '文件与代码图标' },
  { key: 'tab', label: '激活页签与下划线' },
  { key: 'deepDiving', label: '深度思考与推理高亮' },
];

const FONT_FAMILY_PRESETS: ReadonlyArray<{ label: string; value: string }> = [
  { label: '跟随原生（推荐）', value: '' },
  {
    label: 'Inter / 系统现代无衬线',
    value: '"Inter Variable", "Inter", "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif',
  },
  {
    label: '微软雅黑 UI / Segoe UI',
    value: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei UI", sans-serif',
  },
  {
    label: '鸿蒙 / 思源黑体',
    value: '"HarmonyOS Sans SC", "Noto Sans SC", "Source Han Sans SC", system-ui, sans-serif',
  },
];

const CODE_FONT_PRESETS: ReadonlyArray<{ label: string; value: string }> = [
  { label: '跟随原生（推荐）', value: '' },
  {
    label: 'JetBrains Mono',
    value: '"JetBrains Mono", "Cascadia Code", ui-monospace, monospace',
  },
  {
    label: 'Cascadia Code',
    value: '"Cascadia Code", "Fira Code", Consolas, ui-monospace, monospace',
  },
  {
    label: 'Fira Code / SF Mono',
    value: '"Fira Code", "SF Mono", Menlo, Consolas, ui-monospace, monospace',
  },
];

const CORNER_OPTIONS: readonly SidebarCornerRadius[] = ['native', 6, 12, 20];

const CORNER_SQUARE_KEYS: ReadonlyArray<readonly [keyof SidebarSquareCorners, string]> = [
  ['tl', '左上'],
  ['tr', '右上'],
  ['br', '右下'],
  ['bl', '左下'],
];

function isSameSlot(a: ActiveColorPickerSlot | null, b: ActiveColorPickerSlot): boolean {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === 'typography' && b.kind === 'typography') {
    return a.polarity === b.polarity && a.role === b.role;
  }
  if (a.kind === 'uiColor' && b.kind === 'uiColor') {
    return a.key === b.key;
  }
  if (a.kind === 'surfaceColor' && b.kind === 'surfaceColor') {
    return a.surfaceId === b.surfaceId;
  }
  return true;
}

function formatSystemFontStack(fontName: string, kind: 'sans' | 'mono'): string {
  const safe = fontName.replace(/["\\]/g, '').trim();
  if (!safe) return '';
  return kind === 'mono'
    ? `"${safe}", ui-monospace, monospace`
    : `"${safe}", system-ui, sans-serif`;
}

export interface ThemeHeroCardProps {
  config: AppearanceConfig;
  onChange: (next: AppearanceConfig) => void;
  systemAccent?: string;
  size?: 'default' | 'compact';
  title?: string;
  note?: string;
  /** Optional slot for embedding wallpaper status/jump controls right beneath the capsule. */
  children?: ReactNode;
  className?: string;
}

/**
 * FISH-Dock 1:1 "主题与背景" hero card: title + note + live mode/preset badge + CelestialThemeCapsule.
 */
export function ThemeHeroCard({
  config,
  onChange,
  systemAccent = '#0078d4',
  size = 'default',
  title = '主题与背景',
  note = '一键切换浅色、深色与全工作台液态玻璃模式；所有面板毫秒同步。',
  children,
  className,
}: ThemeHeroCardProps) {
  const summary = useMemo(() => {
    const modeLabel = MODE_LABELS[config.themeMode];
    if (config.themeMode === 'glass') {
      return `${modeLabel} · ${GLASS_PRESET_LABELS[config.glassPreset]}`;
    }
    if (config.accentMode === 'custom') {
      return `${modeLabel} · ${config.accent ? config.accent.toLowerCase() : '默认'}`;
    }
    const cleanSys = normalizeHex(systemAccent, true);
    return `${modeLabel} · ${cleanSys ? '跟随系统' : '默认'}`;
  }, [config.accent, config.accentMode, config.glassPreset, config.themeMode, systemAccent]);

  return (
    <section
      className={['pmx-appearance', 'ilook-sec-card', 'ilook-hero-card', className ?? '']
        .filter(Boolean)
        .join(' ')}
    >
      <div className="ilook-hero-head">
        <div className="ilook-box-head">
          <span className="ilook-box-title">{title}</span>
          {size !== 'compact' ? <span className="ilook-box-note">{note}</span> : null}
        </div>
        <span className="ilook-hero-badge" data-ilook-summary>
          {summary}
        </span>
      </div>

      <CelestialThemeCapsule
        mode={config.themeMode}
        size={size}
        onChange={(nextMode) => onChange(setThemeModeWithGlassAutoWake(config, nextMode))}
      />

      {children}
    </section>
  );
}

export interface LiquidGlassCardProps {
  config: AppearanceConfig;
  onChange: (next: AppearanceConfig) => void;
  systemAccent?: string;
  activeSlot?: ActiveColorPickerSlot | null;
  onOpenColorPicker: (req: ColorPickerOpenRequest) => void;
  /** When false (default, matching FISH-Dock), card hides unless themeMode === 'glass'. */
  alwaysShow?: boolean;
  /** Compact sidebar mode collapses detailed per-surface controls behind a disclosure. */
  compact?: boolean;
  className?: string;
}

/**
 * Liquid Glass card: 5 global presets + accent & glass tint + fidelity & dim +
 * unified 8-zone fine-grained glass configurator (shellFrame / rightSidebar / mainCanvas /
 * workPanels / composer / overlays / userBubble / overviewPanel) + optional collapsed global inherit baseline & thinking mode.
 */
export function LiquidGlassCard({
  config,
  onChange,
  systemAccent = '#0078d4',
  activeSlot = null,
  onOpenColorPicker,
  alwaysShow = false,
  compact = false,
  className,
}: LiquidGlassCardProps) {
  const [globalBaselineOpen, setGlobalBaselineOpen] = useState(false);
  const hidden = !alwaysShow && config.themeMode !== 'glass';
  if (hidden) return null;

  const polarity = resolveBasePolarity(config);
  const accentCleared = config.accentMode === 'custom' && !normalizeHex(config.accent, true);
  const fallbackAccent = polarity === 'light' ? '#005fb8' : '#5e9bff';
  const effectiveAccent = accentCleared
    ? fallbackAccent
    : normalizeHex(
        config.accentMode === 'custom' ? config.accent : systemAccent,
        true,
      ) || fallbackAccent;

  const accentLabel = accentCleared ? '默认' : effectiveAccent;
  const accentOpen = isSameSlot(activeSlot, { kind: 'accent' });
  const glassColorOpen = isSameSlot(activeSlot, { kind: 'glassColor' });
  const glassDarkOpen = isSameSlot(activeSlot, { kind: 'glassDarkColor' });

  const presets: readonly GlassPreset[] = ['off', 'light', 'balanced', 'clear', 'custom'];
  const thinkingOptions: ReadonlyArray<{ id: ThinkingGlassMode; label: string }> = [
    { id: 'off', label: '关闭' },
    { id: 'glass', label: '液态玻璃' },
    { id: 'native', label: '原生实色' },
  ];

  return (
    <section
      data-glass-card
      className={['pmx-appearance', 'ilook-sec-card', className ?? ''].filter(Boolean).join(' ')}
    >
      <div className="ilook-box-head">
        <span className="ilook-box-title">液态玻璃</span>
        <span className="ilook-box-note">
          全局预设一键统调，8 大工作台分区精细控制（窗口外框连体统一，右侧功能边栏、主画布、工作面板、输入框、弹窗层、用户消息气泡与概览面板独立可控）；禁 GPU 时自动回落实底。
        </span>
      </div>

      {/* 5-preset segmented pill */}
      <div className="seg dock-glass-seg" role="group" aria-label="液态玻璃预设">
        {presets.map((preset) => (
          <button
            key={preset}
            type="button"
            className={config.glassPreset === preset ? 'on' : ''}
            data-glass-preset={preset}
            aria-pressed={config.glassPreset === preset}
            onClick={() => onChange(applyGlassPreset(config, preset))}
          >
            {GLASS_PRESET_LABELS[preset]}
          </button>
        ))}
      </div>

      {/* Accent & Glass Tint Zone */}
      <div className="glass-accent-zone">
        <div className="ilook-accent-row">
          <div className="grow">
            <div className="glass-reg-t">玻璃色调与强调色</div>
            <div className="glass-reg-d">调节工作台强调色与液态玻璃染色，可跟随系统或自由调色。</div>
          </div>
          <div className="winaccent-mode">
            <button
              type="button"
              className={`pbtn sm${config.accentMode === 'system' ? ' al' : ''}`}
              aria-pressed={config.accentMode === 'system'}
              onClick={() => onChange({ ...config, accentMode: 'system' })}
            >
              跟随系统
            </button>
            <button
              type="button"
              className={`pbtn sm typo-clear-btn${accentCleared ? ' is-ghost' : ''}`}
              disabled={accentCleared}
              onClick={() => onChange({ ...config, accentMode: 'custom', accent: '' })}
            >
              清除
            </button>
            <button
              type="button"
              className={`typo-pill-btn${accentOpen ? ' on' : ''}`}
              aria-expanded={accentOpen}
              title="打开浮窗调色盘自定义强调色"
              onClick={(e) =>
                onOpenColorPicker({
                  slot: { kind: 'accent' },
                  title: '强调色',
                  value: accentCleared ? '' : effectiveAccent,
                  fallbackColor: effectiveAccent,
                  anchorEl: e.currentTarget,
                })
              }
            >
              <i className="typo-dot" style={{ background: effectiveAccent }} />
              <span className="typo-hex mono">{accentLabel}</span>
            </button>
          </div>
        </div>

        {/* Independent Glass Base Color & Dark Separate Toggle */}
        <div className="ilook-accent-row">
          <div className="grow">
            <div className="glass-reg-t">玻璃底色</div>
            <div className="glass-reg-d">与强调色解耦，高保真度下自动亮度钳制保持 ≥ 4.5:1 对比度。</div>
          </div>
          <div className="winaccent-mode">
            <button
              type="button"
              className={`pbtn sm${config.glassDarkSeparate ? ' al' : ''}`}
              aria-pressed={config.glassDarkSeparate}
              onClick={() =>
                onChange({ ...config, glassDarkSeparate: !config.glassDarkSeparate })
              }
            >
              深色单独
            </button>
            <button
              type="button"
              className={`typo-pill-btn${glassColorOpen ? ' on' : ''}`}
              aria-expanded={glassColorOpen}
              title={config.glassDarkSeparate ? '浅色玻璃底色' : '全局玻璃底色'}
              onClick={(e) =>
                onOpenColorPicker({
                  slot: { kind: 'glassColor' },
                  title: config.glassDarkSeparate ? '浅色玻璃底色' : '玻璃底色',
                  value: config.glassColor,
                  fallbackColor: '#ffffff',
                  anchorEl: e.currentTarget,
                })
              }
            >
              <i className="typo-dot" style={{ background: config.glassColor }} />
              <span className="typo-hex mono">{config.glassColor.toLowerCase()}</span>
            </button>
            {config.glassDarkSeparate ? (
              <button
                type="button"
                className={`typo-pill-btn${glassDarkOpen ? ' on' : ''}`}
                aria-expanded={glassDarkOpen}
                title="深色玻璃底色"
                onClick={(e) =>
                  onOpenColorPicker({
                    slot: { kind: 'glassDarkColor' },
                    title: '深色玻璃底色',
                    value: config.glassDarkColor,
                    fallbackColor: '#0d1524',
                    anchorEl: e.currentTarget,
                  })
                }
              >
                <i className="typo-dot" style={{ background: config.glassDarkColor }} />
                <span className="typo-hex mono">{config.glassDarkColor.toLowerCase()}</span>
              </button>
            ) : null}
          </div>
        </div>

        {/* Readability Fidelity & Wallpaper Dim Sliders */}
        <div className="ilook-slider-row">
          <span className="ilook-slider-lbl">保真度</span>
          <span className="ilook-rng">
            <input
              type="range"
              className="rng"
              min={GLASS_REGION_LIMITS.fidelityMin}
              max={GLASS_REGION_LIMITS.fidelityMax}
              step={5}
              aria-label="玻璃可读性保真度"
              value={config.glassFidelity}
              onChange={(e) =>
                onChange({ ...config, glassFidelity: Number(e.target.value) })
              }
            />
            <span className="rv">{config.glassFidelity}%</span>
          </span>
        </div>

        <div className="ilook-slider-row">
          <span className="ilook-slider-lbl">底图压暗</span>
          <span className="ilook-rng">
            <input
              type="range"
              className="rng"
              min={0}
              max={100}
              step={1}
              aria-label="壁纸底图压暗浓度"
              value={config.wallpaperDim}
              onChange={(e) =>
                onChange({ ...config, wallpaperDim: Number(e.target.value) })
              }
            />
            <span className="rv">{config.wallpaperDim}%</span>
          </span>
        </div>
      </div>

      {/* Decoupled 8-Zone Fine-Grained Glass Control */}
      <div className="glass-reg">
        <GlassZoneConfigurator
          config={config}
          onChange={onChange}
          compact={compact}
          showSaturation
        />
      </div>

      {/* Collapsed Advanced Global Baseline & Thinking Block Controls */}
      <div className="glass-reg">
        <div className="ilook-accent-row">
          <div className="grow">
            <span className="glass-reg-t">全局继承基准与思考块</span>
            <span className="glass-reg-d" style={{ marginLeft: 8 }}>
              微调未独立覆盖分区的全局默认曲线与对话思考块质感
            </span>
          </div>
          <button
            type="button"
            className="pbtn sm"
            data-pmx-per-surface-toggle
            aria-expanded={globalBaselineOpen}
            onClick={() => setGlobalBaselineOpen((prev) => !prev)}
          >
            {globalBaselineOpen ? '收起' : '展开'}
          </button>
        </div>

        {globalBaselineOpen ? (
          <div className="pmx-advanced-grid" data-pmx-per-surface-panel>
            <div className="ilook-accent-row">
              <span className="ilook-typo-lbl">对话思考块玻璃</span>
              <div className="seg" role="group" aria-label="思考块玻璃模式">
                {thinkingOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={config.thinkingMode === opt.id ? 'on' : ''}
                    aria-pressed={config.thinkingMode === opt.id}
                    onClick={() => onChange({ ...config, thinkingMode: opt.id })}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {GLASS_REGION_META.map((reg) => {
              const val = config.glassRegions[reg.id];
              return (
                <div key={reg.id} className="pmx-sub-box">
                  <div className="glass-reg-head">
                    <span className="glass-reg-t">{reg.title}</span>
                    <span className="glass-reg-d">{reg.note}</span>
                  </div>
                  <div className="ilook-slider-row">
                    <span className="ilook-slider-lbl">不透明度</span>
                    <span className="ilook-rng">
                      <input
                        type="range"
                        className="rng"
                        min={GLASS_REGION_LIMITS.opMin}
                        max={GLASS_REGION_LIMITS.opMax}
                        step={1}
                        aria-label={`${reg.title}不透明度`}
                        value={val.op}
                        onChange={(e) =>
                          onChange(updateGlassRegion(config, reg.id, { op: Number(e.target.value) }))
                        }
                      />
                      <span className="rv">{val.op}%</span>
                    </span>
                  </div>
                  <div className="ilook-slider-row">
                    <span className="ilook-slider-lbl">模糊</span>
                    <span className="ilook-rng">
                      <input
                        type="range"
                        className="rng"
                        min={GLASS_REGION_LIMITS.blurMin}
                        max={GLASS_REGION_LIMITS.blurMax}
                        step={1}
                        aria-label={`${reg.title}模糊半径`}
                        value={val.blur}
                        onChange={(e) =>
                          onChange(updateGlassRegion(config, reg.id, { blur: Number(e.target.value) }))
                        }
                      />
                      <span className="rv">{val.blur}px</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export interface SidebarCornersCardProps {
  config: AppearanceConfig;
  onChange: (next: AppearanceConfig) => void;
  defaultOpen?: boolean;
  className?: string;
}

/**
 * Dedicated Sidebar Corner Radius & 4-Corner Independent Square Overrides card
 * (consolidated from wallpaper panel into /settings/appearance per Issue #3).
 */
export function SidebarCornersCard({
  config,
  onChange,
  defaultOpen = false,
  className,
}: SidebarCornersCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  const rightLinked = config.rightSidebarCornerRadius === undefined;
  const effectiveRightRadius = config.rightSidebarCornerRadius ?? config.sidebarCornerRadius;
  const effectiveRightSquares = config.rightSidebarSquareCorners ?? config.sidebarSquareCorners;

  const leftSummary =
    config.sidebarCornerRadius === 'native' ? '原生' : `${config.sidebarCornerRadius}px`;
  const rightSummary = rightLinked
    ? '同步左栏'
    : effectiveRightRadius === 'native'
      ? '原生'
      : `${effectiveRightRadius}px`;

  const toggleLeftSquare = (corner: keyof SidebarSquareCorners) => {
    onChange({
      ...config,
      sidebarSquareCorners: {
        ...config.sidebarSquareCorners,
        [corner]: !config.sidebarSquareCorners[corner],
      },
    });
  };

  const toggleRightSquare = (corner: keyof SidebarSquareCorners) => {
    const base = config.rightSidebarSquareCorners ?? { ...config.sidebarSquareCorners };
    onChange({
      ...config,
      rightSidebarCornerRadius: effectiveRightRadius,
      rightSidebarSquareCorners: {
        ...base,
        [corner]: !base[corner],
      },
    });
  };

  return (
    <section
      data-pmx-corners-card
      className={['pmx-appearance', 'ilook-sec-card', className ?? ''].filter(Boolean).join(' ')}
    >
      <div className="ilook-hero-head">
        <div className="ilook-box-head">
          <span className="ilook-box-title">侧边栏圆角</span>
          <span className="ilook-box-note">调节左右侧栏圆角半径，并支持四角独立强制方角。</span>
        </div>
        <div className="ilook-typo-actions">
          <span className="ilook-hero-badge">
            左 {leftSummary} · 右 {rightSummary}
          </span>
          <button
            type="button"
            className="pbtn sm"
            aria-expanded={open}
            onClick={() => setOpen((prev) => !prev)}
          >
            {open ? '收起' : '展开'}
          </button>
        </div>
      </div>

      {open ? (
        <div className="pmx-advanced-grid">
          <div className="ilook-typo-item">
            <div className="ilook-accent-row">
              <span className="ilook-typo-lbl">左侧边栏圆角</span>
              <div className="seg" role="group" aria-label="左侧边栏圆角">
                {CORNER_OPTIONS.map((r) => (
                  <button
                    key={String(r)}
                    type="button"
                    className={config.sidebarCornerRadius === r ? 'on' : ''}
                    aria-pressed={config.sidebarCornerRadius === r}
                    onClick={() => onChange({ ...config, sidebarCornerRadius: r })}
                  >
                    {r === 'native' ? '跟随原生' : `${r}px`}
                  </button>
                ))}
              </div>
            </div>

            {config.sidebarCornerRadius !== 'native' ? (
              <div className="ilook-accent-row">
                <span className="glass-reg-d">左侧栏四角强制方角</span>
                <div className="pmx-chip-group" role="group" aria-label="左侧边栏四角方角">
                  {CORNER_SQUARE_KEYS.map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={`pbtn sm${config.sidebarSquareCorners[key] ? ' al' : ''}`}
                      aria-pressed={config.sidebarSquareCorners[key]}
                      onClick={() => toggleLeftSquare(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="ilook-typo-item">
            <div className="ilook-accent-row">
              <div className="grow">
                <span className="ilook-typo-lbl">右侧边栏圆角</span>
              </div>
              <div className="winaccent-mode">
                <button
                  type="button"
                  className={`pbtn sm${rightLinked ? ' al' : ''}`}
                  aria-pressed={rightLinked}
                  onClick={() => {
                    if (rightLinked) {
                      onChange({
                        ...config,
                        rightSidebarCornerRadius: config.sidebarCornerRadius,
                        rightSidebarSquareCorners: { ...config.sidebarSquareCorners },
                      });
                    } else {
                      const next = { ...config };
                      delete next.rightSidebarCornerRadius;
                      delete next.rightSidebarSquareCorners;
                      onChange(next);
                    }
                  }}
                >
                  {rightLinked ? '与左栏同步' : '已独立设置'}
                </button>
                {!rightLinked ? (
                  <div className="seg" role="group" aria-label="右侧边栏圆角">
                    {CORNER_OPTIONS.map((r) => (
                      <button
                        key={String(r)}
                        type="button"
                        className={effectiveRightRadius === r ? 'on' : ''}
                        aria-pressed={effectiveRightRadius === r}
                        onClick={() =>
                          onChange({ ...config, rightSidebarCornerRadius: r })
                        }
                      >
                        {r === 'native' ? '跟随原生' : `${r}px`}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            {!rightLinked && effectiveRightRadius !== 'native' ? (
              <div className="ilook-accent-row">
                <span className="glass-reg-d">右侧栏四角强制方角</span>
                <div className="pmx-chip-group" role="group" aria-label="右侧边栏四角方角">
                  {CORNER_SQUARE_KEYS.map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={`pbtn sm${effectiveRightSquares[key] ? ' al' : ''}`}
                      aria-pressed={effectiveRightSquares[key]}
                      onClick={() => toggleRightSquare(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export interface UiColorsCardProps {
  config: AppearanceConfig;
  onChange: (next: AppearanceConfig) => void;
  activeSlot?: ActiveColorPickerSlot | null;
  onOpenColorPicker: (req: ColorPickerOpenRequest) => void;
  className?: string;
}

/**
 * Dedicated Global UI Custom Colors (5 elements) & Input Caret Color card.
 */
export function UiColorsCard({
  config,
  onChange,
  activeSlot = null,
  onOpenColorPicker,
  className,
}: UiColorsCardProps) {
  const polarity = resolveBasePolarity(config);
  const cleanCaret = normalizeHex(config.caretColor, true);
  const caretFallback = polarity === 'light' ? '#005fb8' : '#5e9bff';
  const caretOpen = isSameSlot(activeSlot, { kind: 'caretColor' });

  return (
    <section
      data-pmx-uicolors-card
      className={['pmx-appearance', 'ilook-sec-card', className ?? ''].filter(Boolean).join(' ')}
    >
      <div className="ilook-hero-head">
        <div className="ilook-box-head">
          <span className="ilook-box-title">全局 UI 配色与光标色</span>
          <span className="ilook-box-note">
            覆盖关键交互元素高亮色与输入光标色；关闭覆写即跟随全局强调色。
          </span>
        </div>
        <button
          type="button"
          className={`pbtn sm${config.uiColorCustom.enabled ? ' al' : ''}`}
          aria-pressed={config.uiColorCustom.enabled}
          onClick={() =>
            onChange({
              ...config,
              uiColorCustom: {
                ...config.uiColorCustom,
                enabled: !config.uiColorCustom.enabled,
              },
            })
          }
        >
          {config.uiColorCustom.enabled ? '已启用 5 项覆写' : '跟随强调色'}
        </button>
      </div>

      {/* Input Caret Color */}
      <div className="ilook-typo-item">
        <div className="ilook-typo-row">
          <span className="ilook-typo-lbl">输入光标颜色</span>
          <div className="ilook-typo-actions">
            <button
              type="button"
              className={`typo-pill-btn${caretOpen ? ' on' : ''}`}
              aria-expanded={caretOpen}
              onClick={(e) =>
                onOpenColorPicker({
                  slot: { kind: 'caretColor' },
                  title: '输入光标颜色',
                  value: cleanCaret,
                  fallbackColor: caretFallback,
                  anchorEl: e.currentTarget,
                })
              }
            >
              <i className="typo-dot" style={{ background: cleanCaret || caretFallback }} />
              <span className="typo-hex mono">{cleanCaret || '默认'}</span>
            </button>
            <button
              type="button"
              className={`pbtn sm typo-clear-btn${cleanCaret ? '' : ' is-ghost'}`}
              disabled={!cleanCaret}
              onClick={() => onChange({ ...config, caretColor: '' })}
            >
              清除
            </button>
          </div>
        </div>
      </div>

      {/* 5-item UI Custom Colors */}
      {config.uiColorCustom.enabled ? (
        <div className="ilook-typo-item">
          <div className="pmx-uicolor-list">
            {UI_COLOR_ROWS.map((row) => {
              const val = normalizeHex(config.uiColorCustom[row.key], true);
              const fallback =
                row.key === 'deepDiving' && polarity === 'dark'
                  ? '#6cb6ff'
                  : normalizeHex(config.accent, true) || '#5e9bff';
              const open = isSameSlot(activeSlot, { kind: 'uiColor', key: row.key });
              return (
                <div key={row.key} className="ilook-typo-row">
                  <span className="ilook-typo-lbl">{row.label}</span>
                  <div className="ilook-typo-actions">
                    <button
                      type="button"
                      className={`typo-pill-btn${open ? ' on' : ''}`}
                      aria-expanded={open}
                      onClick={(e) =>
                        onOpenColorPicker({
                          slot: { kind: 'uiColor', key: row.key },
                          title: row.label,
                          value: val,
                          fallbackColor: fallback,
                          anchorEl: e.currentTarget,
                        })
                      }
                    >
                      <i className="typo-dot" style={{ background: val || fallback }} />
                      <span className="typo-hex mono">{val || '跟随'}</span>
                    </button>
                    <button
                      type="button"
                      className={`pbtn sm typo-clear-btn${val ? '' : ' is-ghost'}`}
                      disabled={!val}
                      onClick={() =>
                        onChange({
                          ...config,
                          uiColorCustom: { ...config.uiColorCustom, [row.key]: '' },
                        })
                      }
                    >
                      清除
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

export interface TypographyCardProps {
  config: AppearanceConfig;
  onChange: (next: AppearanceConfig) => void;
  activeSlot?: ActiveColorPickerSlot | null;
  onOpenColorPicker: (req: ColorPickerOpenRequest) => void;
  /** Installed system font family names fetched from Daemon `/v1/system/fonts`. */
  systemFonts?: readonly string[];
  systemFontsLoading?: boolean;
  onRefreshSystemFonts?: () => void;
  /** Backward-compatible flag: standalone callers show caret & UI colors unless split into UiColorsCard. */
  showUiColorsAndCaret?: boolean;
  className?: string;
}

/**
 * Independent Light/Dark typography card (heading / text / muted), system & preset font family selectors,
 * and optional caret + 5-item UI custom accent color overrides.
 */
export function TypographyCard({
  config,
  onChange,
  activeSlot = null,
  onOpenColorPicker,
  systemFonts = [],
  systemFontsLoading = false,
  onRefreshSystemFonts,
  showUiColorsAndCaret = true,
  className,
}: TypographyCardProps) {
  const defaultPolarity = resolveBasePolarity(config);
  const [editingPolarity, setEditingPolarity] = useState<BaseThemePolarity>(defaultPolarity);

  const palette = config.typography[editingPolarity];
  const fallbacks = DEFAULT_TYPOGRAPHY_FALLBACKS[editingPolarity];

  const updateTypoColor = (
    role: 'headingColor' | 'textColor' | 'mutedColor',
    value: string,
  ) => {
    onChange({
      ...config,
      typography: {
        ...config.typography,
        [editingPolarity]: {
          ...config.typography[editingPolarity],
          [role]: value,
        },
      },
    });
  };

  const rows: ReadonlyArray<{
    role: 'headingColor' | 'textColor' | 'mutedColor';
    label: string;
    fallback: string;
  }> = [
    { role: 'headingColor', label: '标题与重点字', fallback: fallbacks.headingColor },
    { role: 'textColor', label: '正文与控件字', fallback: fallbacks.textColor },
    { role: 'mutedColor', label: '次要与说明字', fallback: fallbacks.mutedColor },
  ];

  const uniqueSystemFonts = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const font of systemFonts) {
      const clean = font.trim();
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(clean);
    }
    return out;
  }, [systemFonts]);

  const sansSystemOptions = useMemo(
    () => uniqueSystemFonts.map((name) => ({ name, value: formatSystemFontStack(name, 'sans') })),
    [uniqueSystemFonts],
  );
  const monoSystemOptions = useMemo(
    () => uniqueSystemFonts.map((name) => ({ name, value: formatSystemFontStack(name, 'mono') })),
    [uniqueSystemFonts],
  );

  const fontFamilyKnown =
    FONT_FAMILY_PRESETS.some((p) => p.value === config.typography.fontFamily) ||
    sansSystemOptions.some((p) => p.value === config.typography.fontFamily);
  const codeFontKnown =
    CODE_FONT_PRESETS.some((p) => p.value === config.typography.codeFontFamily) ||
    monoSystemOptions.some((p) => p.value === config.typography.codeFontFamily);

  const cleanCaret = normalizeHex(config.caretColor, true);
  const caretFallback = editingPolarity === 'light' ? '#005fb8' : '#5e9bff';
  const caretOpen = isSameSlot(activeSlot, { kind: 'caretColor' });

  return (
    <section
      data-pmx-typography-card
      className={['pmx-appearance', 'ilook-sec-card', className ?? ''].filter(Boolean).join(' ')}
    >
      <div className="ilook-hero-head">
        <div className="ilook-box-head">
          <span className="ilook-box-title">全局字体与排版配色</span>
          <span className="ilook-box-note">
            支持本机系统字体选择；浅色与深色文字颜色完全独立存储，留空即跟随原生主题。
          </span>
        </div>
        <div className="seg" role="group" aria-label="编辑浅色或深色文字配色">
          <button
            type="button"
            className={editingPolarity === 'light' ? 'on' : ''}
            aria-pressed={editingPolarity === 'light'}
            onClick={() => setEditingPolarity('light')}
          >
            浅色组
          </button>
          <button
            type="button"
            className={editingPolarity === 'dark' ? 'on' : ''}
            aria-pressed={editingPolarity === 'dark'}
            onClick={() => setEditingPolarity('dark')}
          >
            深色组
          </button>
        </div>
      </div>

      {/* Global & Code Font Families (Curated Presets + Local System Fonts) */}
      <div className="ilook-typo-item">
        <div className="ilook-typo-row">
          <div className="grow">
            <span className="ilook-typo-lbl">本机系统字体</span>
            <span className="glass-reg-d" style={{ marginLeft: 8 }}>
              {uniqueSystemFonts.length > 0
                ? `已载入 ${uniqueSystemFonts.length} 款本机字体`
                : '可刷新读取本机已安装字体'}
            </span>
          </div>
          {onRefreshSystemFonts ? (
            <button
              type="button"
              className="pbtn sm"
              disabled={systemFontsLoading}
              onClick={onRefreshSystemFonts}
            >
              {systemFontsLoading ? '刷新中…' : '刷新系统字体'}
            </button>
          ) : null}
        </div>

        <div className="ilook-typo-row">
          <span className="ilook-typo-lbl">界面字体族</span>
          <select
            className="pmx-select"
            aria-label="界面字体族"
            value={fontFamilyKnown ? config.typography.fontFamily : '__custom__'}
            onChange={(e) => {
              if (e.target.value !== '__custom__') {
                onChange({
                  ...config,
                  typography: { ...config.typography, fontFamily: e.target.value },
                });
              }
            }}
          >
            <optgroup label="推荐预设">
              {FONT_FAMILY_PRESETS.map((p) => (
                <option key={p.label} value={p.value}>
                  {p.label}
                </option>
              ))}
            </optgroup>
            {sansSystemOptions.length > 0 ? (
              <optgroup label={`本机系统字体 (${sansSystemOptions.length})`}>
                {sansSystemOptions.map((font) => (
                  <option key={font.name} value={font.value}>
                    {font.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {!fontFamilyKnown ? (
              <option value="__custom__">自定义：{config.typography.fontFamily}</option>
            ) : null}
          </select>
        </div>

        <div className="ilook-typo-row">
          <span className="ilook-typo-lbl">代码字体族</span>
          <select
            className="pmx-select"
            aria-label="代码字体族"
            value={codeFontKnown ? config.typography.codeFontFamily : '__custom__'}
            onChange={(e) => {
              if (e.target.value !== '__custom__') {
                onChange({
                  ...config,
                  typography: { ...config.typography, codeFontFamily: e.target.value },
                });
              }
            }}
          >
            <optgroup label="推荐代码字体">
              {CODE_FONT_PRESETS.map((p) => (
                <option key={p.label} value={p.value}>
                  {p.label}
                </option>
              ))}
            </optgroup>
            {monoSystemOptions.length > 0 ? (
              <optgroup label={`本机系统字体 (${monoSystemOptions.length})`}>
                {monoSystemOptions.map((font) => (
                  <option key={font.name} value={font.value}>
                    {font.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {!codeFontKnown ? (
              <option value="__custom__">自定义：{config.typography.codeFontFamily}</option>
            ) : null}
          </select>
        </div>
      </div>

      {/* 3 independent light/dark typography colors */}
      {rows.map(({ role, label, fallback }) => {
        const val = normalizeHex(palette[role], true);
        const preview = val || fallback;
        const open = isSameSlot(activeSlot, {
          kind: 'typography',
          polarity: editingPolarity,
          role,
        });
        return (
          <div key={role} className="ilook-typo-item">
            <div className="ilook-typo-row">
              <span className="ilook-typo-lbl">{label}</span>
              <div className="ilook-typo-actions">
                <button
                  type="button"
                  className={`typo-pill-btn${open ? ' on' : ''}`}
                  aria-expanded={open}
                  onClick={(e) =>
                    onOpenColorPicker({
                      slot: { kind: 'typography', polarity: editingPolarity, role },
                      title: `${editingPolarity === 'light' ? '浅色' : '深色'} · ${label}`,
                      value: val,
                      fallbackColor: fallback,
                      anchorEl: e.currentTarget,
                    })
                  }
                >
                  <i className="typo-dot" style={{ background: preview }} />
                  <span className="typo-hex mono">{val || '默认'}</span>
                </button>
                <button
                  type="button"
                  className={`pbtn sm typo-clear-btn${val ? '' : ' is-ghost'}`}
                  disabled={!val}
                  onClick={() => updateTypoColor(role, '')}
                >
                  清除
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {/* Optional inline Caret + 5-item UI Custom Colors for standalone TypographyCard callers */}
      {showUiColorsAndCaret ? (
        <>
          <div className="ilook-typo-item">
            <div className="ilook-typo-row">
              <span className="ilook-typo-lbl">输入光标颜色</span>
              <div className="ilook-typo-actions">
                <button
                  type="button"
                  className={`typo-pill-btn${caretOpen ? ' on' : ''}`}
                  aria-expanded={caretOpen}
                  onClick={(e) =>
                    onOpenColorPicker({
                      slot: { kind: 'caretColor' },
                      title: '输入光标颜色',
                      value: cleanCaret,
                      fallbackColor: caretFallback,
                      anchorEl: e.currentTarget,
                    })
                  }
                >
                  <i className="typo-dot" style={{ background: cleanCaret || caretFallback }} />
                  <span className="typo-hex mono">{cleanCaret || '默认'}</span>
                </button>
                <button
                  type="button"
                  className={`pbtn sm typo-clear-btn${cleanCaret ? '' : ' is-ghost'}`}
                  disabled={!cleanCaret}
                  onClick={() => onChange({ ...config, caretColor: '' })}
                >
                  清除
                </button>
              </div>
            </div>
          </div>

          <div className="ilook-typo-item">
            <div className="ilook-typo-row">
              <div className="grow">
                <div className="ilook-typo-lbl">自定义元素强调色（5 项）</div>
                <div className="glass-reg-d">独立覆盖发送键、链接、文件图标、激活页签与推理高亮。</div>
              </div>
              <button
                type="button"
                className={`pbtn sm${config.uiColorCustom.enabled ? ' al' : ''}`}
                aria-pressed={config.uiColorCustom.enabled}
                onClick={() =>
                  onChange({
                    ...config,
                    uiColorCustom: {
                      ...config.uiColorCustom,
                      enabled: !config.uiColorCustom.enabled,
                    },
                  })
                }
              >
                {config.uiColorCustom.enabled ? '已启用' : '跟随强调色'}
              </button>
            </div>

            {config.uiColorCustom.enabled ? (
              <div className="pmx-uicolor-list">
                {UI_COLOR_ROWS.map((row) => {
                  const val = normalizeHex(config.uiColorCustom[row.key], true);
                  const fallback =
                    row.key === 'deepDiving' && editingPolarity === 'dark'
                      ? '#6cb6ff'
                      : normalizeHex(config.accent, true) || '#5e9bff';
                  const open = isSameSlot(activeSlot, { kind: 'uiColor', key: row.key });
                  return (
                    <div key={row.key} className="ilook-typo-row">
                      <span className="ilook-typo-lbl">{row.label}</span>
                      <div className="ilook-typo-actions">
                        <button
                          type="button"
                          className={`typo-pill-btn${open ? ' on' : ''}`}
                          aria-expanded={open}
                          onClick={(e) =>
                            onOpenColorPicker({
                              slot: { kind: 'uiColor', key: row.key },
                              title: row.label,
                              value: val,
                              fallbackColor: fallback,
                              anchorEl: e.currentTarget,
                            })
                          }
                        >
                          <i className="typo-dot" style={{ background: val || fallback }} />
                          <span className="typo-hex mono">{val || '跟随'}</span>
                        </button>
                        <button
                          type="button"
                          className={`pbtn sm typo-clear-btn${val ? '' : ' is-ghost'}`}
                          disabled={!val}
                          onClick={() =>
                            onChange({
                              ...config,
                              uiColorCustom: { ...config.uiColorCustom, [row.key]: '' },
                            })
                          }
                        >
                          清除
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

export interface ThemeSnapshotCardProps {
  config: AppearanceConfig;
  onChange: (next: AppearanceConfig) => void;
  themeName?: string;
  onExportSnapshot?: (snapshot: WbThemeSnapshot, json: string) => void;
  className?: string;
}

/**
 * One-click `.wb-theme` export / import card with strict path/credential sanitization & inline status.
 */
export function ThemeSnapshotCard({
  config,
  onChange,
  themeName = 'Prismux Theme',
  onExportSnapshot,
  className,
}: ThemeSnapshotCardProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  const handleExport = () => {
    setErrorMessage('');
    const snapshot = exportWbThemeSnapshot(config, { name: themeName });
    const json = serializeWbThemeSnapshot(config, { name: themeName });

    if (onExportSnapshot) {
      onExportSnapshot(snapshot, json);
      setStatusMessage('已导出纯净 .wb-theme 预设（已自动剥离本机路径与凭据）。');
      return;
    }

    if (typeof document !== 'undefined' && typeof URL !== 'undefined') {
      const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeSlug =
        themeName
          .toLowerCase()
          .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '-')
          .replace(/^-+|-+$/g, '') || 'prismux-theme';
      a.href = url;
      a.download = `${safeSlug}.wb-theme`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatusMessage(`已下载 ${safeSlug}.wb-theme（无本机路径与凭据）。`);
    }
  };

  const handleFileImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setStatusMessage('');
    setErrorMessage('');
    try {
      const text = await file.text();
      const result = importWbThemeSnapshot(text);
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }
      onChange(result.snapshot.appearance);
      const strippedNote =
        result.strippedFields.length > 0
          ? `（已安全过滤 ${result.strippedFields.length} 项非外观/敏感字段）`
          : '';
      setStatusMessage(`已导入主题「${result.snapshot.name}」${strippedNote}。`);
    } catch {
      setErrorMessage('读取主题文件失败，请重新选择有效的 .wb-theme 文件。');
    }
  };

  const handleReset = () => {
    setErrorMessage('');
    onChange({
      ...DEFAULT_APPEARANCE_CONFIG,
      glassRegions: {
        surface: { ...DEFAULT_APPEARANCE_CONFIG.glassRegions.surface },
        card: { ...DEFAULT_APPEARANCE_CONFIG.glassRegions.card },
        overlay: { ...DEFAULT_APPEARANCE_CONFIG.glassRegions.overlay },
        control: { ...DEFAULT_APPEARANCE_CONFIG.glassRegions.control },
      },
      perSurfaceOverrides: {},
      glassZones: {
        shellFrame: { ...DEFAULT_GLASS_ZONES.shellFrame },
        rightSidebar: { ...DEFAULT_GLASS_ZONES.rightSidebar },
        mainCanvas: { ...DEFAULT_GLASS_ZONES.mainCanvas },
        workPanels: { ...DEFAULT_GLASS_ZONES.workPanels },
        composer: { ...DEFAULT_GLASS_ZONES.composer },
        overlays: { ...DEFAULT_GLASS_ZONES.overlays },
        userBubble: { ...DEFAULT_GLASS_ZONES.userBubble },
        overviewPanel: { ...DEFAULT_GLASS_ZONES.overviewPanel },
      },
      sidebarSquareCorners: { ...DEFAULT_APPEARANCE_CONFIG.sidebarSquareCorners },
      uiColorCustom: { ...DEFAULT_APPEARANCE_CONFIG.uiColorCustom },
      typography: {
        ...DEFAULT_APPEARANCE_CONFIG.typography,
        light: { ...DEFAULT_APPEARANCE_CONFIG.typography.light },
        dark: { ...DEFAULT_APPEARANCE_CONFIG.typography.dark },
      },
    });
    setStatusMessage('已恢复出厂外观默认配置。');
  };

  return (
    <section
      className={['pmx-appearance', 'ilook-sec-card', className ?? ''].filter(Boolean).join(' ')}
    >
      <div className="ilook-accent-row">
        <div className="grow">
          <div className="ilook-box-title">主题预设包（.wb-theme）</div>
          <div className="ilook-box-note">
            一键分享或备份外观配置；导出自动剥离一切本机路径与凭据。
          </div>
        </div>
        <div className="ilook-typo-actions">
          <button type="button" className="pbtn sm" onClick={handleExport}>
            导出 .wb-theme
          </button>
          <button
            type="button"
            className="pbtn sm"
            onClick={() => fileInputRef.current?.click()}
          >
            导入
          </button>
          <button type="button" className="pbtn sm" onClick={handleReset}>
            恢复默认
          </button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".wb-theme,.json,application/json"
        hidden
        onChange={handleFileImport}
      />

      {statusMessage ? (
        <div className="pmx-status-note ok" role="status" aria-live="polite">
          {statusMessage}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="pmx-status-note bad" role="alert">
          {errorMessage}
        </div>
      ) : null}
    </section>
  );
}

export interface AppearanceHeroAndCardsProps {
  config: AppearanceConfig;
  onChange: (next: AppearanceConfig) => void;
  systemAccent?: string;
  size?: 'default' | 'compact';
  alwaysShowGlassCard?: boolean;
  /** @deprecated Corner radius controls removed in favor of fixed default inner-stage radius (`--pmx-inner-stage-radius: 14px`). */
  showCornersCard?: boolean;
  showUiColorsCard?: boolean;
  showSnapshotCard?: boolean;
  systemFonts?: readonly string[];
  systemFontsLoading?: boolean;
  onRefreshSystemFonts?: () => void;
  themeName?: string;
  onExportSnapshot?: (snapshot: WbThemeSnapshot, json: string) => void;
  /** Optional wallpaper slot rendered inside the Hero card. */
  wallpaperSlot?: ReactNode;
  className?: string;
}

/**
 * Complete 6-card FISH-Dock-inspired Prismux Appearance stack coordinating a single shared FloatingColorPopover:
 * 1. ThemeHeroCard (Celestial 3-state capsule + wallpaper shortcut slot)
 * 2. LiquidGlassCard (5 presets + tint/fidelity + 4-region sliders + chrome/thinking gates + per-surface fold)
 * 3. SidebarCornersCard (left/right radius + 4-corner square overrides)
 * 4. UiColorsCard (5 UI custom element accents + caret color)
 * 5. TypographyCard (system/preset font families + independent light/dark heading/text/muted colors)
 * 6. ThemeSnapshotCard (.wb-theme export/import/reset)
 */
export function AppearanceHeroAndCards({
  config,
  onChange,
  systemAccent = '#0078d4',
  size = 'default',
  alwaysShowGlassCard = false,
  showCornersCard: _deprecatedShowCornersCard = false,
  showUiColorsCard = true,
  showSnapshotCard = true,
  systemFonts = [],
  systemFontsLoading = false,
  onRefreshSystemFonts,
  themeName = 'Prismux Theme',
  onExportSnapshot,
  wallpaperSlot,
  className,
}: AppearanceHeroAndCardsProps) {
  const [pickerReq, setPickerReq] = useState<ColorPickerOpenRequest | null>(null);

  const handleOpenColorPicker = useCallback((req: ColorPickerOpenRequest) => {
    setPickerReq((prev) => (prev && isSameSlot(prev.slot, req.slot) ? null : req));
  }, []);

  const applySlotColor = useCallback(
    (slot: ActiveColorPickerSlot, hex: string) => {
      switch (slot.kind) {
        case 'accent':
          onChange({ ...config, accentMode: 'custom', accent: hex });
          break;
        case 'glassColor':
          onChange({ ...config, glassColor: hex || '#ffffff' });
          break;
        case 'glassDarkColor':
          onChange({ ...config, glassDarkColor: hex || '#0d1524' });
          break;
        case 'surfaceColor': {
          const prevSurface = config.perSurfaceOverrides[slot.surfaceId];
          onChange({
            ...config,
            perSurfaceOverrides: {
              ...config.perSurfaceOverrides,
              [slot.surfaceId]: {
                ...prevSurface,
                mode: 'custom',
                color: hex,
              },
            },
          });
          break;
        }
        case 'caretColor':
          onChange({ ...config, caretColor: hex });
          break;
        case 'typography':
          onChange({
            ...config,
            typography: {
              ...config.typography,
              [slot.polarity]: {
                ...config.typography[slot.polarity],
                [slot.role]: hex,
              },
            },
          });
          break;
        case 'uiColor':
          onChange({
            ...config,
            uiColorCustom: {
              ...config.uiColorCustom,
              enabled: true,
              [slot.key]: hex,
            },
          });
          break;
      }
    },
    [config, onChange],
  );

  const activeColorValue = useMemo(() => {
    if (!pickerReq) return '';
    const slot = pickerReq.slot;
    switch (slot.kind) {
      case 'accent':
        return config.accentMode === 'custom' ? config.accent : systemAccent;
      case 'glassColor':
        return config.glassColor;
      case 'glassDarkColor':
        return config.glassDarkColor;
      case 'surfaceColor':
        return config.perSurfaceOverrides[slot.surfaceId]?.color ?? '';
      case 'caretColor':
        return config.caretColor;
      case 'typography':
        return config.typography[slot.polarity][slot.role];
      case 'uiColor':
        return config.uiColorCustom[slot.key];
    }
  }, [config, pickerReq, systemAccent]);

  return (
    <div className={['pmx-appearance', 'ilook-cards-stack', className ?? ''].filter(Boolean).join(' ')}>
      <ThemeHeroCard
        config={config}
        onChange={onChange}
        systemAccent={systemAccent}
        size={size}
      >
        {wallpaperSlot}
      </ThemeHeroCard>

      <LiquidGlassCard
        config={config}
        onChange={onChange}
        systemAccent={systemAccent}
        activeSlot={pickerReq?.slot ?? null}
        onOpenColorPicker={handleOpenColorPicker}
        alwaysShow={alwaysShowGlassCard}
        compact={size === 'compact'}
      />

      {showUiColorsCard ? (
        <UiColorsCard
          config={config}
          onChange={onChange}
          activeSlot={pickerReq?.slot ?? null}
          onOpenColorPicker={handleOpenColorPicker}
        />
      ) : null}

      <TypographyCard
        config={config}
        onChange={onChange}
        activeSlot={pickerReq?.slot ?? null}
        onOpenColorPicker={handleOpenColorPicker}
        systemFonts={systemFonts}
        systemFontsLoading={systemFontsLoading}
        onRefreshSystemFonts={onRefreshSystemFonts}
        showUiColorsAndCaret={!showUiColorsCard}
      />

      {showSnapshotCard ? (
        <ThemeSnapshotCard
          config={config}
          onChange={onChange}
          themeName={themeName}
          onExportSnapshot={onExportSnapshot}
        />
      ) : null}

      <FloatingColorPopover
        open={pickerReq !== null}
        value={activeColorValue}
        fallbackColor={pickerReq?.fallbackColor ?? '#5e9bff'}
        anchorEl={pickerReq?.anchorEl ?? null}
        title={pickerReq?.title ?? '选择颜色'}
        onChange={(hex) => {
          if (pickerReq) applySlotColor(pickerReq.slot, hex);
        }}
        onClear={() => {
          if (pickerReq) applySlotColor(pickerReq.slot, '');
        }}
        onClose={() => setPickerReq(null)}
      />
    </div>
  );
}
