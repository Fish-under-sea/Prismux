import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import type { AppearanceBridge, WallpaperModuleResetKey } from "../types.js";

export interface CtlTextProps {
  label: string;
  hint?: string;
  tooltip?: string;
  onDoubleClick?: () => void;
}

export function CtlText({ label, hint, tooltip, onDoubleClick }: CtlTextProps) {
  return (
    <div className="pmx-wp-ctl-text" title={tooltip} onDoubleClick={onDoubleClick}>
      <span className="pmx-wp-ctl-label">{label}</span>
      {hint ? <span className="pmx-wp-ctl-hint">{hint}</span> : null}
    </div>
  );
}

export interface SectionHeadProps {
  label: string;
  open?: boolean;
  onToggle?: () => void;
  resetModule?: WallpaperModuleResetKey;
  onResetModule?: (key: WallpaperModuleResetKey) => void;
  tooltip?: string;
}

export function SectionHead({
  label,
  open,
  onToggle,
  resetModule,
  onResetModule,
  tooltip,
}: SectionHeadProps) {
  const collapsible = typeof onToggle === "function";

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!collapsible) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    <div
      className={
        "pmx-wp-section-head" + (collapsible ? " pmx-wp-section-head--toggle" : "")
      }
      role={collapsible ? "button" : undefined}
      tabIndex={collapsible ? 0 : undefined}
      aria-expanded={collapsible ? Boolean(open) : undefined}
      onClick={collapsible ? onToggle : undefined}
      onKeyDown={handleKeyDown}
      title={tooltip}
    >
      <span className="pmx-wp-section-label">{label}</span>
      {resetModule && onResetModule ? (
        <button
          type="button"
          className="pmx-wp-reset-btn"
          title="把这一块的参数恢复为默认值（不需要确认）"
          aria-label={`重置${label}`}
          onClick={(e) => {
            e.stopPropagation();
            onResetModule(resetModule);
          }}
        >
          ↺
        </button>
      ) : null}
      {collapsible ? (
        <span
          className={"pmx-wp-section-caret" + (open ? " is-open" : "")}
          aria-hidden="true"
        >
          ▾
        </span>
      ) : null}
    </div>
  );
}

export interface SliderRowProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  displayValue?: string;
  tooltip?: string;
  numberEdit?: boolean;
  onLabelDoubleClick?: () => void;
  disabled?: boolean;
}

export function SliderRow({
  label,
  min,
  max,
  step,
  value,
  onChange,
  unit = "",
  displayValue,
  tooltip,
  numberEdit = false,
  onLabelDoubleClick,
  disabled = false,
}: SliderRowProps) {
  const safeVal = Number.isFinite(value) ? value : min;
  const pct = max > min ? Math.max(0, Math.min(100, ((safeVal - min) / (max - min)) * 100)) : 0;
  const sliderStyle = { "--pmx-wp-fill": `${pct}%` } as CSSProperties;

  return (
    <div
      className={"pmx-wp-slider-row" + (disabled ? " pmx-wp-ctl--disabled" : "")}
      title={tooltip}
    >
      <span
        className="pmx-wp-label"
        onDoubleClick={onLabelDoubleClick}
        title={tooltip}
      >
        {label}
      </span>
      <input
        type="range"
        className="pmx-wp-slider"
        min={min}
        max={max}
        step={step}
        value={safeVal}
        disabled={disabled}
        style={sliderStyle}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="pmx-wp-value">
        {numberEdit ? (
          <>
            <input
              type="number"
              className="pmx-wp-value-input"
              min={min}
              max={max}
              step={step}
              value={safeVal}
              disabled={disabled}
              aria-label={`${label}数值`}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) {
                  onChange(Math.max(min, Math.min(max, n)));
                }
              }}
            />
            {unit ? <span className="pmx-wp-value-unit">{unit}</span> : null}
          </>
        ) : (
          displayValue ?? `${safeVal}${unit}`
        )}
      </span>
    </div>
  );
}

export interface SwitchRowProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  tooltip?: string;
  disabled?: boolean;
}

export function SwitchRow({
  label,
  checked,
  onChange,
  hint,
  tooltip,
  disabled = false,
}: SwitchRowProps) {
  return (
    <div
      className={"pmx-wp-ctl" + (disabled ? " pmx-wp-ctl--disabled" : "")}
      title={tooltip}
    >
      <CtlText label={label} hint={hint} tooltip={tooltip} />
      <label className="pmx-wp-switch">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-label={label}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="pmx-wp-switch-track">
          <span className="pmx-wp-switch-thumb" />
        </span>
      </label>
    </div>
  );
}

export interface SwatchRowProps {
  label: string;
  presets: readonly string[];
  value: string;
  onChange: (hex: string) => void;
  hint?: string;
  tooltip?: string;
  autoLabel?: string;
  autoTitle?: string;
  colorValue?: string;
  disabled?: boolean;
  appearanceBridge?: AppearanceBridge;
}

export function SwatchRow({
  label,
  presets,
  value,
  onChange,
  hint,
  tooltip,
  autoLabel,
  autoTitle,
  colorValue,
  disabled = false,
  appearanceBridge,
}: SwatchRowProps) {
  const normalized = value.toLowerCase();
  const pickerVal = (colorValue || value || "#4f8cff").toLowerCase();

  return (
    <div
      className={
        "pmx-wp-ctl pmx-wp-ctl--wrap" + (disabled ? " pmx-wp-ctl--disabled" : "")
      }
      title={tooltip}
    >
      <CtlText label={label} hint={hint} tooltip={tooltip} />
      <div className="pmx-wp-swatches">
        {autoLabel ? (
          <button
            type="button"
            className={
              "pmx-wp-swatch pmx-wp-swatch--auto" +
              (value === "" ? " pmx-wp-swatch--active" : "")
            }
            disabled={disabled}
            title={autoTitle ?? autoLabel}
            aria-label={`${label} ${autoLabel}`}
            onClick={() => onChange("")}
          >
            {autoLabel}
          </button>
        ) : null}
        {presets.map((hex) => {
          const active = normalized === hex.toLowerCase();
          return (
            <button
              key={hex}
              type="button"
              className={"pmx-wp-swatch" + (active ? " pmx-wp-swatch--active" : "")}
              style={{ backgroundColor: hex }}
              disabled={disabled}
              title={hex}
              aria-label={`${label} ${hex}`}
              aria-pressed={active}
              onClick={() => onChange(hex)}
            />
          );
        })}
        {appearanceBridge?.renderColorTrigger ? (
          appearanceBridge.renderColorTrigger({
            value: pickerVal,
            label,
            onChange,
            onClear: autoLabel ? () => onChange("") : undefined,
          })
        ) : (
          <label className="pmx-wp-swatch-custom" title={`${label}自定义颜色`}>
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(pickerVal) ? pickerVal : "#4f8cff"}
              disabled={disabled}
              aria-label={`${label}自定义取色`}
              onChange={(e) => onChange(e.target.value)}
            />
            <span>自定义</span>
          </label>
        )}
      </div>
    </div>
  );
}

export interface ConfirmRowProps {
  armed: boolean;
  prompt: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
}

export function ConfirmRow({
  armed,
  prompt,
  onConfirm,
  onCancel,
  confirmLabel = "确认",
}: ConfirmRowProps) {
  if (!armed) return null;
  return (
    <div className="pmx-wp-confirm-row" role="alert">
      <span className="pmx-wp-hint">{prompt}</span>
      <button
        type="button"
        className="pmx-wp-btn pmx-wp-btn--danger"
        onClick={onConfirm}
      >
        {confirmLabel}
      </button>
      <button type="button" className="pmx-wp-btn" onClick={onCancel}>
        取消
      </button>
    </div>
  );
}

export interface VinylRecordProps {
  cover?: string | null;
  title?: string;
  playing: boolean;
  size?: "sm" | "lg";
}

export function VinylRecord({
  cover,
  title,
  playing,
  size = "lg",
}: VinylRecordProps) {
  return (
    <div
      className={
        "pmx-wp-vinyl" +
        (size === "sm" ? " pmx-wp-vinyl--sm" : "") +
        (playing ? " pmx-wp-vinyl--playing" : "")
      }
      title={title}
      aria-hidden="true"
    >
      <div className="pmx-wp-vinyl__cover">
        {cover ? (
          <img src={cover} alt="" />
        ) : (
          <span className="pmx-wp-vinyl__empty">♪</span>
        )}
      </div>
      <div className="pmx-wp-vinyl__hole" />
    </div>
  );
}

export function cardKeyDown(e: KeyboardEvent<HTMLElement>): void {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    e.currentTarget.click();
  }
}

export type OptionalNode = ReactNode;
