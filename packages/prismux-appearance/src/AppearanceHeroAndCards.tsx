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
  DEFAULT_TYPOGRAPHY_FALLBACKS,
  GLASS_REGION_LIMITS,
  type AppearanceConfig,
  type BaseThemePolarity,
  type GlassPreset,
  type GlassRegionId,
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

export type ActiveColorPickerSlot =
  | { kind: 'accent' }
  | { kind: 'glassColor' }
  | { kind: 'glassDarkColor' }
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
  { id: 'surface', title: '主界面与侧栏', note: '侧边栏、顶栏与工作台底板' },
  { id: 'card', title: '卡片与内容', note: '对话卡片、分组面板与代码块底' },
  { id: 'overlay', title: '浮层与弹窗', note: '审批弹层、下拉菜单与浮窗' },
  { id: 'control', title: '交互控件', note: '按钮、输入框与分段开关' },
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

function isSameSlot(a: ActiveColorPickerSlot | null, b: ActiveColorPickerSlot): boolean {
  if (!a || a.kind !== b.kind) return false;
  if (a.kind === 'typography' && b.kind === 'typography') {
    return a.polarity === b.polarity && a.role === b.role;
  }
  if (a.kind === 'uiColor' && b.kind === 'uiColor') {
    return a.key === b.key;
  }
  return true;
}

export interface ThemeHeroCardProps {
  config: AppearanceConfig;
  onChange: (next: AppearanceConfig) => void;
  systemAccent?: string;
  size?: 'default' | 'compact';
  title?: string;
  note?: string;
  /** Optional slot for embedding wallpaper controls right beneath the header or capsule. */
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
  note = '合并调节动态壁纸与浅色、深色、全工作台液态玻璃模式；接入钩子的面板同步更新。',
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
  /** Compact sidebar mode collapses detailed per-chrome/corner controls behind a disclosure. */
  compact?: boolean;
  className?: string;
}

/**
 * FISH-Dock 1:1 Liquid Glass card: 5 presets + accent & glass tint + fidelity + 4-region sliders + chrome gates.
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
  const [advancedOpen, setAdvancedOpen] = useState(!compact);
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
  const cornerOptions: readonly SidebarCornerRadius[] = ['native', 6, 12, 20];
  const thinkingOptions: ReadonlyArray<{ id: ThinkingGlassMode; label: string }> = [
    { id: 'off', label: '关闭' },
    { id: 'glass', label: '液态玻璃' },
    { id: 'native', label: '正文原生' },
  ];

  const toggleCornerSquare = (corner: keyof SidebarSquareCorners) => {
    onChange({
      ...config,
      sidebarSquareCorners: {
        ...config.sidebarSquareCorners,
        [corner]: !config.sidebarSquareCorners[corner],
      },
    });
  };

  return (
    <section
      data-glass-card
      className={['pmx-appearance', 'ilook-sec-card', className ?? ''].filter(Boolean).join(' ')}
    >
      <div className="ilook-box-head">
        <span className="ilook-box-title">液态玻璃</span>
        <span className="ilook-box-note">
          四区域独立调节不透明度与模糊；内置可读性下限，禁 GPU 时自动回落实底。
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

        {/* Readability Fidelity Slider */}
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
      </div>

      {/* 4-Region Sliders: surface / card / overlay / control */}
      {GLASS_REGION_META.map((reg) => {
        const val = config.glassRegions[reg.id];
        return (
          <div key={reg.id} className="glass-reg">
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

      {/* Per-Chrome Gates, Thinking Mode & Sidebar Corners */}
      <div className="glass-reg">
        <div className="ilook-accent-row">
          <span className="glass-reg-t">高级玻璃面与侧栏几何</span>
          <button
            type="button"
            className="pbtn sm"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((prev) => !prev)}
          >
            {advancedOpen ? '收起' : '展开'}
          </button>
        </div>

        {advancedOpen ? (
          <div className="pmx-advanced-grid">
            <div className="pmx-chip-group" role="group" aria-label="独立壳层玻璃开关">
              <button
                type="button"
                className={`pbtn sm${config.leftSidebarGlass ? ' al' : ''}`}
                aria-pressed={config.leftSidebarGlass}
                onClick={() =>
                  onChange({ ...config, leftSidebarGlass: !config.leftSidebarGlass })
                }
              >
                左侧栏玻璃
              </button>
              <button
                type="button"
                className={`pbtn sm${config.titlebarGlass ? ' al' : ''}`}
                aria-pressed={config.titlebarGlass}
                onClick={() => onChange({ ...config, titlebarGlass: !config.titlebarGlass })}
              >
                标题栏玻璃
              </button>
              <button
                type="button"
                className={`pbtn sm${config.rightSidebarGlass ? ' al' : ''}`}
                aria-pressed={config.rightSidebarGlass}
                onClick={() =>
                  onChange({ ...config, rightSidebarGlass: !config.rightSidebarGlass })
                }
              >
                右侧栏玻璃
              </button>
              <button
                type="button"
                className={`pbtn sm${config.rightSidebarFullClear ? ' al' : ''}`}
                aria-pressed={config.rightSidebarFullClear}
                onClick={() =>
                  onChange({
                    ...config,
                    rightSidebarFullClear: !config.rightSidebarFullClear,
                  })
                }
              >
                右栏全透明
              </button>
            </div>

            <div className="ilook-accent-row">
              <span className="ilook-typo-lbl">思考块与正文玻璃</span>
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

            <div className="ilook-accent-row">
              <span className="ilook-typo-lbl">侧边栏圆角</span>
              <div className="seg" role="group" aria-label="侧边栏圆角">
                {cornerOptions.map((r) => (
                  <button
                    key={String(r)}
                    type="button"
                    className={config.sidebarCornerRadius === r ? 'on' : ''}
                    aria-pressed={config.sidebarCornerRadius === r}
                    onClick={() => onChange({ ...config, sidebarCornerRadius: r })}
                  >
                    {r === 'native' ? '原生' : `${r}px`}
                  </button>
                ))}
              </div>
            </div>

            {config.sidebarCornerRadius !== 'native' ? (
              <div className="ilook-accent-row">
                <span className="ilook-typo-lbl">四角强制方角</span>
                <div className="pmx-chip-group" role="group" aria-label="侧边栏四角方角">
                  {(
                    [
                      ['tl', '左上'],
                      ['tr', '右上'],
                      ['br', '右下'],
                      ['bl', '左下'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={`pbtn sm${config.sidebarSquareCorners[key] ? ' al' : ''}`}
                      aria-pressed={config.sidebarSquareCorners[key]}
                      onClick={() => toggleCornerSquare(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export interface TypographyCardProps {
  config: AppearanceConfig;
  onChange: (next: AppearanceConfig) => void;
  activeSlot?: ActiveColorPickerSlot | null;
  onOpenColorPicker: (req: ColorPickerOpenRequest) => void;
  className?: string;
}

/**
 * Independent Light/Dark typography card (heading / text / muted), caret color, global & code font stacks,
 * and optional 5-item UI custom accent color overrides.
 */
export function TypographyCard({
  config,
  onChange,
  activeSlot = null,
  onOpenColorPicker,
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

  const cleanCaret = normalizeHex(config.caretColor, true);
  const caretFallback = editingPolarity === 'light' ? '#005fb8' : '#5e9bff';
  const caretOpen = isSameSlot(activeSlot, { kind: 'caretColor' });

  return (
    <section
      className={['pmx-appearance', 'ilook-sec-card', className ?? ''].filter(Boolean).join(' ')}
    >
      <div className="ilook-hero-head">
        <div className="ilook-box-head">
          <span className="ilook-box-title">字体与配色</span>
          <span className="ilook-box-note">
            浅色与深色文字颜色完全独立存储；留空即跟随原生主题。
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

      {/* Caret Color */}
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

      {/* Global & Code Font Families */}
      <div className="ilook-typo-item">
        <div className="ilook-typo-row">
          <span className="ilook-typo-lbl">界面字体族</span>
          <select
            className="pmx-select"
            aria-label="界面字体族"
            value={
              FONT_FAMILY_PRESETS.some((p) => p.value === config.typography.fontFamily)
                ? config.typography.fontFamily
                : '__custom__'
            }
            onChange={(e) => {
              if (e.target.value !== '__custom__') {
                onChange({
                  ...config,
                  typography: { ...config.typography, fontFamily: e.target.value },
                });
              }
            }}
          >
            {FONT_FAMILY_PRESETS.map((p) => (
              <option key={p.label} value={p.value}>
                {p.label}
              </option>
            ))}
            {!FONT_FAMILY_PRESETS.some((p) => p.value === config.typography.fontFamily) ? (
              <option value="__custom__">自定义：{config.typography.fontFamily}</option>
            ) : null}
          </select>
        </div>

        <div className="ilook-typo-row">
          <span className="ilook-typo-lbl">代码字体族</span>
          <select
            className="pmx-select"
            aria-label="代码字体族"
            value={
              CODE_FONT_PRESETS.some((p) => p.value === config.typography.codeFontFamily)
                ? config.typography.codeFontFamily
                : '__custom__'
            }
            onChange={(e) => {
              if (e.target.value !== '__custom__') {
                onChange({
                  ...config,
                  typography: { ...config.typography, codeFontFamily: e.target.value },
                });
              }
            }}
          >
            {CODE_FONT_PRESETS.map((p) => (
              <option key={p.label} value={p.value}>
                {p.label}
              </option>
            ))}
            {!CODE_FONT_PRESETS.some((p) => p.value === config.typography.codeFontFamily) ? (
              <option value="__custom__">自定义：{config.typography.codeFontFamily}</option>
            ) : null}
          </select>
        </div>
      </div>

      {/* 5-item UI Custom Colors */}
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
      const safeSlug = themeName
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
  showSnapshotCard?: boolean;
  themeName?: string;
  onExportSnapshot?: (snapshot: WbThemeSnapshot, json: string) => void;
  /** Optional wallpaper slot rendered inside the Hero card. */
  wallpaperSlot?: ReactNode;
  className?: string;
}

/**
 * Complete FISH-Dock-inspired Prismux Appearance stack coordinating a single shared FloatingColorPopover.
 */
export function AppearanceHeroAndCards({
  config,
  onChange,
  systemAccent = '#0078d4',
  size = 'default',
  alwaysShowGlassCard = false,
  showSnapshotCard = true,
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

      <TypographyCard
        config={config}
        onChange={onChange}
        activeSlot={pickerReq?.slot ?? null}
        onOpenColorPicker={handleOpenColorPicker}
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
