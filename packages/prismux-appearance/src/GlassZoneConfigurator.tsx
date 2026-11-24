import { useMemo, useState } from 'react';
import {
  GLASS_ZONE_IDS,
  GLASS_ZONE_LIMITS,
  GLASS_ZONE_META,
  type AppearanceConfig,
  type GlassZoneDescriptor,
  type GlassZoneId,
  type GlassZoneMode,
} from './types.js';
import {
  countCustomizedGlassZones,
  resetAllGlassZones,
  resetGlassZone,
  resolveAppearanceRuntime,
  updateGlassZone,
  type ResolvedGlassZone,
} from './glassEngine.js';

export interface GlassZoneConfiguratorProps {
  config: AppearanceConfig;
  onChange: (next: AppearanceConfig) => void;
  /** Compact layout tailored for 320-420px right sidebar with zero horizontal overflow. */
  compact?: boolean;
  /** Optional subset/ordering of zones to render (defaults to all 6 unified workbench zones). */
  zones?: readonly GlassZoneId[];
  /** Whether to show optional saturation slider when a zone is in 'custom' mode (defaults to true). */
  showSaturation?: boolean;
  /** In compact mode, whether the secondary 4 zones start expanded together (defaults to false). */
  defaultExpandAllZones?: boolean;
  /** Disables interaction and shows inline disabledReason when provided. */
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
}

const ZONE_META_BY_ID: Readonly<Record<GlassZoneId, GlassZoneDescriptor>> = Object.fromEntries(
  GLASS_ZONE_META.map((item) => [item.id, item]),
) as Record<GlassZoneId, GlassZoneDescriptor>;

const MODE_OPTIONS: ReadonlyArray<{ id: GlassZoneMode; label: string; compactLabel: string }> = [
  { id: 'inherit', label: '跟随全局', compactLabel: '跟随' },
  { id: 'custom', label: '自定义', compactLabel: '自定义' },
  { id: 'solid', label: '实底', compactLabel: '实底' },
];

const MODE_STATUS_LABELS: Record<GlassZoneMode, string> = {
  inherit: '跟随',
  custom: '自定义',
  solid: '实底',
};

interface ZoneCardProps {
  meta: GlassZoneDescriptor;
  resolved: ResolvedGlassZone;
  compact: boolean;
  showSaturation: boolean;
  disabled: boolean;
  onSelectMode: (zoneId: GlassZoneId, mode: GlassZoneMode) => void;
  onChangeOpacity: (zoneId: GlassZoneId, opacity: number) => void;
  onChangeBlur: (zoneId: GlassZoneId, blurPx: number) => void;
  onChangeSaturation: (zoneId: GlassZoneId, saturation: number) => void;
  onResetZone: (zoneId: GlassZoneId) => void;
}

function GlassZoneCard({
  meta,
  resolved,
  compact,
  showSaturation,
  disabled,
  onSelectMode,
  onChangeOpacity,
  onChangeBlur,
  onChangeSaturation,
  onResetZone,
}: ZoneCardProps) {
  const activeMode = resolved.effectiveMode;
  const isCustom = activeMode === 'custom';
  const isSolid = activeMode === 'solid';
  const canReset = resolved.mode !== 'inherit' || activeMode !== 'inherit';

  const displayTitle = compact ? (meta.compactTitle ?? meta.title) : meta.title;
  const displayNote = compact ? meta.compactNote : meta.note;

  return (
    <div
      className={['pmx-gz-card', isCustom ? 'is-custom' : '', isSolid ? 'is-solid' : '']
        .filter(Boolean)
        .join(' ')}
      data-pmx-zone-item={meta.id}
      data-pmx-zone-state={activeMode}
    >
      <div className="pmx-gz-card-head">
        <div className="pmx-gz-card-meta">
          <div className="pmx-gz-title-line">
            <i
              className={`pmx-gz-dot is-${activeMode}`}
              aria-hidden="true"
              title={MODE_STATUS_LABELS[activeMode]}
            />
            <span className="pmx-gz-title" title={meta.title}>
              {displayTitle}
            </span>
            {canReset ? (
              <button
                type="button"
                className="pmx-gz-reset-link"
                data-pmx-zone-reset={meta.id}
                disabled={disabled}
                title={`恢复${meta.title}跟随全局`}
                onClick={() => onResetZone(meta.id)}
              >
                恢复
              </button>
            ) : null}
          </div>
          {displayNote ? <div className="pmx-gz-note">{displayNote}</div> : null}
        </div>

        <div
          className="seg pmx-gz-mode-seg"
          role="group"
          aria-label={`${meta.title}玻璃模式`}
        >
          {MODE_OPTIONS.map((opt) => {
            const selected = activeMode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                className={selected ? 'on' : ''}
                data-pmx-zone-mode-btn={`${meta.id}:${opt.id}`}
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => onSelectMode(meta.id, opt.id)}
              >
                {compact ? opt.compactLabel : opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {isSolid ? (
        <div className="pmx-gz-solid-note">
          已关闭本区毛玻璃并恢复实底；切回「跟随」或「自定义」可立即恢复透视。
        </div>
      ) : (
        <div className="pmx-gz-sliders">
          <label className="pmx-gz-slider-row">
            <span className="pmx-gz-slider-lbl">不透明度</span>
            <input
              type="range"
              className="rng"
              data-pmx-zone-opacity={meta.id}
              min={meta.minOpacity}
              max={GLASS_ZONE_LIMITS.opacityMax}
              step={1}
              disabled={disabled}
              aria-label={`${meta.title}不透明度`}
              value={resolved.opacity}
              onChange={(e) => onChangeOpacity(meta.id, Number(e.target.value))}
            />
            <output className="rv">{resolved.opacity}%</output>
          </label>

          <label className="pmx-gz-slider-row">
            <span className="pmx-gz-slider-lbl">模糊半径</span>
            <input
              type="range"
              className="rng"
              data-pmx-zone-blur={meta.id}
              min={GLASS_ZONE_LIMITS.blurMin}
              max={GLASS_ZONE_LIMITS.blurMax}
              step={1}
              disabled={disabled}
              aria-label={`${meta.title}模糊半径`}
              value={resolved.blurPx}
              onChange={(e) => onChangeBlur(meta.id, Number(e.target.value))}
            />
            <output className="rv">{resolved.blurPx}px</output>
          </label>

          {showSaturation && isCustom ? (
            <label className="pmx-gz-slider-row">
              <span className="pmx-gz-slider-lbl">色彩饱和</span>
              <input
                type="range"
                className="rng"
                data-pmx-zone-saturation={meta.id}
                min={GLASS_ZONE_LIMITS.saturationMin}
                max={GLASS_ZONE_LIMITS.saturationMax}
                step={5}
                disabled={disabled}
                aria-label={`${meta.title}色彩饱和度`}
                value={resolved.saturation}
                onChange={(e) => onChangeSaturation(meta.id, Number(e.target.value))}
              />
              <output className="rv">{resolved.saturation}%</output>
            </label>
          ) : null}

          {meta.minOpacity > 0 ? (
            <div className="pmx-gz-floor-hint">
              已启用 ≥ {meta.minOpacity}% 可读性安全下限，保障弹窗、下拉与抽屉文字清晰。
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * Unified 6-zone liquid-glass configurator covering shellFrame (Left Sidebar + Top Bar +
 * Bottom Status Bar + Right Edge), rightSidebar, mainCanvas, workPanels, composer, and overlays.
 * Pure host visual control with 0 LLM token overhead.
 */
export function GlassZoneConfigurator({
  config,
  onChange,
  compact = false,
  zones = GLASS_ZONE_IDS,
  showSaturation = true,
  defaultExpandAllZones = false,
  disabled = false,
  disabledReason,
  className,
}: GlassZoneConfiguratorProps) {
  const runtime = useMemo(() => resolveAppearanceRuntime(config), [config]);
  const customizedCount = useMemo(() => countCustomizedGlassZones(config), [config]);

  const zoneDescriptors = useMemo(
    () =>
      zones
        .map((id) => ZONE_META_BY_ID[id])
        .filter((item): item is GlassZoneDescriptor => Boolean(item)),
    [zones],
  );

  const pinnedDescriptors = useMemo(
    () => zoneDescriptors.filter((item) => item.pinnedInCompact),
    [zoneDescriptors],
  );
  const secondaryDescriptors = useMemo(
    () => zoneDescriptors.filter((item) => !item.pinnedInCompact),
    [zoneDescriptors],
  );

  const [activeSecondaryId, setActiveSecondaryId] = useState<GlassZoneId>(
    secondaryDescriptors[0]?.id ?? 'mainCanvas',
  );
  const [expandAllSecondary, setExpandAllSecondary] = useState<boolean>(defaultExpandAllZones);

  const effectiveSecondaryId = secondaryDescriptors.some((d) => d.id === activeSecondaryId)
    ? activeSecondaryId
    : (secondaryDescriptors[0]?.id ?? 'mainCanvas');

  const handleSelectMode = (zoneId: GlassZoneId, mode: GlassZoneMode) => {
    if (disabled) return;
    if (mode === 'inherit') {
      onChange(resetGlassZone(config, zoneId));
      return;
    }
    onChange(updateGlassZone(config, zoneId, { mode }));
  };

  const handleChangeOpacity = (zoneId: GlassZoneId, opacity: number) => {
    if (disabled) return;
    onChange(updateGlassZone(config, zoneId, { mode: 'custom', opacity }));
  };

  const handleChangeBlur = (zoneId: GlassZoneId, blurPx: number) => {
    if (disabled) return;
    onChange(updateGlassZone(config, zoneId, { mode: 'custom', blurPx }));
  };

  const handleChangeSaturation = (zoneId: GlassZoneId, saturation: number) => {
    if (disabled) return;
    onChange(updateGlassZone(config, zoneId, { mode: 'custom', saturation }));
  };

  const handleResetZone = (zoneId: GlassZoneId) => {
    if (disabled) return;
    onChange(resetGlassZone(config, zoneId));
  };

  const handleResetAll = () => {
    if (disabled) return;
    onChange(resetAllGlassZones(config));
  };

  const rootClassName = [
    'pmx-appearance',
    'pmx-gz-root',
    compact ? 'is-compact' : '',
    disabled ? 'is-disabled' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const renderCard = (meta: GlassZoneDescriptor) => (
    <GlassZoneCard
      key={meta.id}
      meta={meta}
      resolved={runtime.zones[meta.id]}
      compact={compact}
      showSaturation={showSaturation}
      disabled={disabled}
      onSelectMode={handleSelectMode}
      onChangeOpacity={handleChangeOpacity}
      onChangeBlur={handleChangeBlur}
      onChangeSaturation={handleChangeSaturation}
      onResetZone={handleResetZone}
    />
  );

  return (
    <div
      className={rootClassName}
      data-pmx-zone-configurator="1"
      data-compact={compact ? '1' : '0'}
      aria-disabled={disabled || undefined}
    >
      <div className="pmx-gz-header">
        <div className="pmx-gz-header-text">
          <span className="glass-reg-t">
            {compact ? '工作台分区独立玻璃' : '工作台 6 分区精细玻璃控制'}
          </span>
          {!compact ? (
            <span className="glass-reg-d">
              窗口外框（左侧边栏、顶栏、底栏与右细边）统一连体调节，右侧功能边栏、主画布、工作面板（任务面板/工作区板/定时任务）、输入框与弹窗层独立可控；拖动任意滑块立即实时生效。
            </span>
          ) : null}
        </div>
        <div className="pmx-gz-header-actions">
          <span className="ilook-hero-badge" data-pmx-zone-count={String(customizedCount)}>
            {customizedCount > 0 ? `已独立 ${customizedCount}/${zoneDescriptors.length}` : '全部跟随全局'}
          </span>
          {customizedCount > 0 ? (
            <button
              type="button"
              className="pbtn sm"
              data-pmx-zone-reset-all="1"
              disabled={disabled}
              onClick={handleResetAll}
            >
              全部重置
            </button>
          ) : null}
        </div>
      </div>

      {disabled && disabledReason ? (
        <div className="pmx-gz-disabled-note" role="note">
          {disabledReason}
        </div>
      ) : null}

      {compact ? (
        <div className="pmx-gz-compact-stack">
          {/* Pinned Shell Frame & Right Feature Sidebar directly accessible with zero extra clicks */}
          {pinnedDescriptors.map(renderCard)}

          {/* Secondary 4 workbench zones with crisp pill selector or full expansion */}
          {secondaryDescriptors.length > 0 ? (
            <div className="pmx-gz-secondary-wrap">
              <div className="pmx-gz-secondary-head">
                <span className="pmx-gz-secondary-title">更多工作台分区</span>
                <button
                  type="button"
                  className="pmx-gz-expand-btn"
                  data-pmx-zone-expand-all="1"
                  aria-expanded={expandAllSecondary}
                  disabled={disabled}
                  onClick={() => setExpandAllSecondary((prev) => !prev)}
                >
                  {expandAllSecondary ? '切回单区' : '展开全部 6 区'}
                </button>
              </div>

              {!expandAllSecondary ? (
                <>
                  <div
                    className="pmx-gz-pill-bar"
                    role="tablist"
                    aria-label="其他工作台玻璃分区"
                  >
                    {secondaryDescriptors.map((meta) => {
                      const zState = runtime.zones[meta.id].effectiveMode;
                      const selected = effectiveSecondaryId === meta.id;
                      return (
                        <button
                          key={meta.id}
                          type="button"
                          role="tab"
                          aria-selected={selected}
                          data-pmx-zone-tab={meta.id}
                          className={['pmx-gz-pill', selected ? 'on' : ''].filter(Boolean).join(' ')}
                          disabled={disabled}
                          onClick={() => setActiveSecondaryId(meta.id)}
                        >
                          <i className={`pmx-gz-dot is-${zState}`} aria-hidden="true" />
                          <span>{meta.shortLabel}</span>
                        </button>
                      );
                    })}
                  </div>
                  {secondaryDescriptors
                    .filter((d) => d.id === effectiveSecondaryId)
                    .map(renderCard)}
                </>
              ) : (
                <div className="pmx-gz-compact-stack">
                  {secondaryDescriptors.map(renderCard)}
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="pmx-gz-grid">{zoneDescriptors.map(renderCard)}</div>
      )}
    </div>
  );
}
