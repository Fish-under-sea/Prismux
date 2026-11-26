import { useEffect } from "react";
import type { WallpaperStore } from "../store.js";
import { useWallpaperStore } from "../store.js";
import type { UserPropDef, UserPropWireValue, WallpaperHostAdapter } from "../types.js";
import {
  sameUserPropValue,
  weColorToHex,
  weEvalCondition,
  weHexToColor,
} from "../userProps.js";

export interface UserPropsDrillPanelProps {
  store: WallpaperStore;
  adapter?: WallpaperHostAdapter;
}

/**
 * Shared Wallpaper Engine user-property drill-down panel (slider / bool / color / combo / text / file).
 * Reused inside QuickPanel (in-pane drill-down) and WallpaperSettingsView.
 */
export function UserPropsDrillPanel({ store, adapter }: UserPropsDrillPanelProps) {
  const snap = useWallpaperStore(store);
  const current = snap.wallpapers.find((w) => w.id === snap.settings.selectedId) ?? null;

  useEffect(() => {
    if (current) {
      void store.ensureUserProperties(adapter, current);
    }
  }, [current?.id, adapter, store]);

  if (!current) return null;

  const props = store.getResolvedUserProps(current.id);
  const valueMap: Record<string, UserPropWireValue | null> = {};
  for (const p of props) {
    if (p.ptype !== "text" && p.ptype !== "group") {
      valueMap[p.name] = p.value;
    }
  }

  const visibleDefs = props.filter(
    (p) => !p.hidden && (!p.condition || weEvalCondition(p.condition, valueMap)),
  );
  const hasOverridden = props.some((p) => p.overridden);

  const handleInput = (prop: UserPropDef, nextValue: UserPropWireValue) => {
    if (sameUserPropValue(prop.value, nextValue)) return;
    store.setUserPropOverride(current.id, prop.name, nextValue);
  };

  const note = snap.propsLoading
    ? "读取中…"
    : snap.propsError
      ? snap.propsError
      : visibleDefs.length > 0
        ? ""
        : props.some((p) => !p.hidden)
          ? "当前条件下没有可调项"
          : "这张壁纸没有可调用户属性（general.properties）";

  const liveActive =
    (current.type === "scene" || current.type === "web") &&
    snap.settings.advancedEngineEnabled &&
    snap.settings.sceneLive;

  return (
    <div className="pmx-wp-props" data-pmx-props-panel="1">
      <div className="pmx-wp-props__head">
        <span className="pmx-wp-props__title">壁纸属性</span>
        <span className="pmx-wp-props__note">{note}</span>
        <button
          type="button"
          className="pmx-wp-btn pmx-wp-btn--mini"
          disabled={!hasOverridden}
          onClick={() => store.resetUserProps(current.id)}
        >
          恢复默认
        </button>
      </div>

      {!liveActive && (current.type === "scene" || current.type === "web") ? (
        <div className="pmx-wp-props__hint">
          高级壁纸渲染引擎当前未开启，属性改动将在开启高级渲染引擎后生效。
        </div>
      ) : null}

      {visibleDefs.map((p) => {
        if (p.ptype === "text" || p.ptype === "group") {
          return (
            <div key={p.name} className="pmx-wp-props__section">
              {p.text}
            </div>
          );
        }

        let control;
        if (p.ptype === "bool") {
          control = (
            <input
              type="checkbox"
              className="pmx-wp-props__check"
              checked={p.value === true}
              aria-label={p.text}
              onChange={(e) => handleInput(p, e.target.checked)}
            />
          );
        } else if (p.ptype === "color") {
          control = (
            <input
              type="color"
              className="pmx-wp-props__color"
              value={weColorToHex(p.value)}
              aria-label={p.text}
              onChange={(e) => handleInput(p, weHexToColor(e.target.value))}
            />
          );
        } else if (p.ptype === "slider") {
          const min = typeof p.min === "number" ? p.min : 0;
          const max = typeof p.max === "number" ? p.max : 1;
          const step = typeof p.step === "number" && p.step > 0 ? p.step : (max - min) / 100;
          const digits =
            typeof p.precision === "number" ? Math.max(0, Math.min(6, p.precision)) : 2;
          const numVal = typeof p.value === "number" ? p.value : min;
          control = (
            <>
              <input
                type="range"
                className="pmx-wp-slider"
                min={min}
                max={max}
                step={step}
                value={numVal}
                aria-label={p.text}
                onChange={(e) => handleInput(p, Number(e.target.value))}
              />
              <span className="pmx-wp-props__value">{numVal.toFixed(digits)}</span>
            </>
          );
        } else if (p.ptype === "combo" && Array.isArray(p.options) && p.options.length > 0) {
          const idx = Math.max(
            0,
            p.options.findIndex((o) => sameUserPropValue(o.value, p.value)),
          );
          control = (
            <select
              className="pmx-wp-props__select"
              value={String(idx)}
              aria-label={p.text}
              onChange={(e) => {
                const opt = p.options?.[Number(e.target.value)];
                if (opt) handleInput(p, opt.value);
              }}
            >
              {p.options.map((opt, i) => (
                <option key={i} value={String(i)}>
                  {opt.label}
                </option>
              ))}
            </select>
          );
        } else if ((p.ptype === "file" || p.ptype === "directory") && Array.isArray(p.files)) {
          const cur = typeof p.value === "string" ? p.value : "";
          const list = p.files.includes(cur) || !cur ? p.files : [cur, ...p.files];
          control = (
            <select
              className="pmx-wp-props__select"
              value={cur}
              aria-label={p.text}
              onChange={(e) => handleInput(p, e.target.value)}
            >
              <option value="">（默认）</option>
              {list.map((f, i) => (
                <option key={i} value={f}>
                  {f}
                </option>
              ))}
            </select>
          );
        } else {
          control = (
            <input
              type="text"
              className="pmx-wp-props__text"
              defaultValue={typeof p.value === "string" ? p.value : ""}
              aria-label={p.text}
              onBlur={(e) => handleInput(p, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleInput(p, e.currentTarget.value);
                }
              }}
            />
          );
        }

        return (
          <div key={p.name} className="pmx-wp-props__row">
            <span className="pmx-wp-props__label" title={p.name}>
              {p.text}
              {p.overridden ? (
                <span className="pmx-wp-props__dot" title="已修改（点「恢复默认」还原）">
                  •
                </span>
              ) : null}
            </span>
            {control}
          </div>
        );
      })}
    </div>
  );
}
