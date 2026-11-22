import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type {
  AppearanceThemeMode,
  FourRegionGlassSettings,
  GlassPresetKind,
  WallpaperSettings
} from "@prismux/protocol";
import {
  GLASS_PRESETS,
  formatThemeStatusBadge,
  parseWbThemeImport,
  type PrismuxAppearanceState,
  type TypographyColorSettingsExtended,
  type WallpaperCatalogItem
} from "../theme/themeEngine.js";
import { CelestialThemeCapsule } from "./CelestialThemeCapsule.js";

export interface ThemeBackgroundPanelProps {
  state: PrismuxAppearanceState;
  onChange: (next: PrismuxAppearanceState) => void;
  wallpapers: WallpaperCatalogItem[];
  onScanSteam: () => void;
  onExportTheme: () => void;
  onImportTheme: (raw: string) => void;
}

const REGION_META: ReadonlyArray<{
  key: "sidebar" | "content" | "overlay" | "control";
  label: string;
  hint: string;
}> = [
  { key: "sidebar", label: "侧栏与顶栏", hint: "sidebar" },
  { key: "content", label: "主内容画幅", hint: "content" },
  { key: "overlay", label: "浮层与胶囊", hint: "overlay" },
  { key: "control", label: "交互控件", hint: "control" }
];

const GLASS_PRESET_OPTIONS: ReadonlyArray<{
  id: GlassPresetKind;
  label: string;
}> = [
  { id: "off", label: "关闭" },
  { id: "light", label: "轻透" },
  { id: "balanced", label: "均衡" },
  { id: "clear", label: "全透" },
  { id: "custom", label: "自定义" }
];

const BUILTIN_SCENES: ReadonlyArray<{
  id: string;
  label: string;
  sourceType: WallpaperSettings["sourceType"];
}> = [
  { id: "aurora-prism", label: "极光棱镜", sourceType: "scene" },
  { id: "starlight-fluid", label: "星夜流体", sourceType: "scene" },
  { id: "prism-mesh", label: "棱镜网格", sourceType: "scene" },
  { id: "none", label: "纯静底色", sourceType: "none" }
];

const FONT_OPTIONS: ReadonlyArray<{ label: string; value: string }> = [
  {
    label: "默认无衬线（Inter / 苹方 / 微软雅黑）",
    value:
      '"Inter", "PingFang SC", "Microsoft YaHei UI", system-ui, -apple-system, sans-serif'
  },
  {
    label: "等宽工程体（JetBrains Mono / Cascadia）",
    value: '"JetBrains Mono", "Cascadia Mono", "Consolas", monospace'
  },
  {
    label: "系统人文体（Segoe UI / SF Pro）",
    value: 'system-ui, -apple-system, "Segoe UI", sans-serif'
  }
];

export function ThemeBackgroundPanel({
  state,
  onChange,
  wallpapers,
  onScanSteam,
  onExportTheme,
  onImportTheme
}: ThemeBackgroundPanelProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [scanningSteam, setScanningSteam] = useState(false);

  useEffect(() => {
    return () => {
      if (scanTimerRef.current !== null) {
        window.clearTimeout(scanTimerRef.current);
      }
    };
  }, []);

  const extTypo = state.typography as TypographyColorSettingsExtended;

  const updateGlass = (
    patch: Partial<FourRegionGlassSettings & { enabled: boolean }>,
    ensureLiquidGlass = false
  ): void => {
    onChange({
      ...state,
      themeMode: ensureLiquidGlass ? "liquid-glass" : state.themeMode,
      glass: {
        ...state.glass,
        ...patch
      }
    });
  };

  const updateWallpaper = (patch: Partial<WallpaperSettings>): void => {
    onChange({
      ...state,
      wallpaper: {
        ...state.wallpaper,
        ...patch
      }
    });
  };

  const updateTypography = (
    patch: Partial<TypographyColorSettingsExtended>
  ): void => {
    onChange({
      ...state,
      typography: {
        ...state.typography,
        ...patch
      } as PrismuxAppearanceState["typography"]
    });
  };

  const handleModeChange = (mode: AppearanceThemeMode): void => {
    if (mode === "liquid-glass") {
      const shouldRestoreBalanced =
        !state.glass.enabled || state.glass.preset === "off";
      onChange({
        ...state,
        themeMode: mode,
        glass: shouldRestoreBalanced
          ? {
              ...state.glass,
              ...GLASS_PRESETS.balanced,
              preset: "balanced",
              enabled: true
            }
          : {
              ...state.glass,
              enabled: true
            }
      });
      return;
    }

    onChange({
      ...state,
      themeMode: mode
    });
  };

  const handlePresetClick = (presetId: GlassPresetKind): void => {
    if (presetId === "custom") {
      updateGlass({ preset: "custom", enabled: true }, true);
      return;
    }
    const presetValues = GLASS_PRESETS[presetId];
    updateGlass(
      {
        ...presetValues,
        sidebar: { ...presetValues.sidebar },
        content: { ...presetValues.content },
        overlay: { ...presetValues.overlay },
        control: { ...presetValues.control },
        preset: presetId,
        enabled: presetId !== "off"
      },
      presetId !== "off"
    );
  };

  const handleRegionChange = (
    regionKey: "sidebar" | "content" | "overlay" | "control",
    field: "fill" | "blur",
    rawVal: number
  ): void => {
    const clamped =
      field === "fill"
        ? Math.min(100, Math.max(0, Math.round(rawVal)))
        : Math.min(40, Math.max(0, Math.round(rawVal)));
    updateGlass(
      {
        [regionKey]: {
          ...state.glass[regionKey],
          [field]: clamped
        },
        preset: "custom",
        enabled: true
      },
      true
    );
  };

  const handleScanClick = (): void => {
    setScanningSteam(true);
    try {
      onScanSteam();
    } finally {
      if (scanTimerRef.current !== null) {
        window.clearTimeout(scanTimerRef.current);
      }
      scanTimerRef.current = window.setTimeout(() => {
        scanTimerRef.current = null;
        setScanningSteam(false);
      }, 320);
    }
  };

  const handleImportFile = async (
    event: ChangeEvent<HTMLInputElement>
  ): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      const rawText = await file.text();
      // Validate strictly before passing upstream
      parseWbThemeImport(rawText);
      setImportError(null);
      onImportTheme(rawText);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : "主题包导入失败，请确认文件为合法 .wb-theme JSON。";
      setImportError(msg);
    }
  };

  const selectedSceneKey =
    state.wallpaper.sourceType === "none"
      ? "none"
      : state.wallpaper.sourceType === "scene"
        ? (state.wallpaper.sourcePath ?? "aurora-prism")
        : "";

  return (
    <section
      className="prismux-theme-panel"
      aria-labelledby="prismux-theme-panel-heading"
    >
      {/* Header Card */}
      <div className="prismux-card-lg prismux-glass-surface prismux-glass-content">
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "var(--sp-3)"
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
            <h2 id="prismux-theme-panel-heading" className="prismux-title">
              主题与背景
            </h2>
            <p className="prismux-subtitle">
              合并调节动态壁纸引擎（WebWallGL / 视频 / 静态背景）与全工作台「浅色 / 深色 / 液态玻璃」三种视觉模式。
            </p>
          </div>
          <span className="prismux-badge" data-testid="theme-status-badge">
            {formatThemeStatusBadge(state)}
          </span>
        </div>

        <div style={{ marginTop: "var(--sp-4)" }}>
          <CelestialThemeCapsule
            mode={state.themeMode}
            onChange={handleModeChange}
          />
        </div>
      </div>

      {/* Wallpaper Engine Section */}
      <div className="prismux-panel-section prismux-glass-surface prismux-glass-content">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--sp-2)",
            flexWrap: "wrap"
          }}
        >
          <h3 className="prismux-section-title">
            动态壁纸引擎（WebWallGL + Steam 431960）
          </h3>
          <button
            type="button"
            className="prismux-btn prismux-btn-sm"
            aria-busy={scanningSteam}
            onClick={handleScanClick}
          >
            <span className="prismux-ico" aria-hidden="true">
              {scanningSteam ? <span className="prismux-spinner" /> : "🔍"}
            </span>
            <span>{scanningSteam ? "正在扫描 431960…" : "扫描 Steam 431960"}</span>
          </button>
        </div>

        {/* Builtin WebWallGL Scene Switcher */}
        <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap" }}>
          {BUILTIN_SCENES.map((scene) => {
            const active = selectedSceneKey === scene.id;
            return (
              <button
                key={scene.id}
                type="button"
                className="prismux-chip prismux-chip-sm"
                aria-pressed={active}
                onClick={() =>
                  updateWallpaper({
                    sourceType: scene.sourceType,
                    ...(scene.sourceType === "scene"
                      ? { sourcePath: scene.id }
                      : { sourcePath: undefined })
                  })
                }
              >
                {scene.label}
              </button>
            );
          })}
        </div>

        {/* Catalog List (if discovered or provided) */}
        {wallpapers.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
            {wallpapers.map((item) => {
              const selected =
                state.wallpaper.sourceType === item.sourceType &&
                state.wallpaper.sourcePath === item.sourcePath;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`prismux-list-item prismux-btn ${selected ? "prismux-is-selected" : ""}`}
                  style={{ justifyContent: "space-between", width: "100%" }}
                  aria-pressed={selected}
                  onClick={() =>
                    updateWallpaper({
                      sourceType: item.sourceType,
                      sourcePath: item.sourcePath
                    })
                  }
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-2)" }}>
                    <span className="prismux-ico" aria-hidden="true">
                      🖼
                    </span>
                    <span>{item.title}</span>
                  </span>
                  <span className="prismux-subtitle">
                    {item.previewLabel ?? item.sourceType}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="prismux-subtitle">
            未挂载本地外部壁纸目录，当前由内置 WebWallGL 实时渲染（对模型 0 Token 开销）。
          </p>
        )}

        {/* Wallpaper Sliders */}
        <div className="prismux-grid-2">
          <label className="prismux-slider-row">
            <span className="prismux-slider-head">
              <span>底图遮罩浓度 (--wall-veil)</span>
              <span className="prismux-tabular">
                {Math.round(state.wallpaper.veilOpacity * 100)}%
              </span>
            </span>
            <input
              type="range"
              className="prismux-range"
              min={0}
              max={100}
              value={Math.round(state.wallpaper.veilOpacity * 100)}
              onChange={(e) =>
                updateWallpaper({ veilOpacity: Number(e.target.value) / 100 })
              }
            />
          </label>

          <label className="prismux-slider-row">
            <span className="prismux-slider-head">
              <span>暗角强度 (Vignette)</span>
              <span className="prismux-tabular">
                {Math.round(state.wallpaper.vignetteStrength * 100)}%
              </span>
            </span>
            <input
              type="range"
              className="prismux-range"
              min={0}
              max={100}
              value={Math.round(state.wallpaper.vignetteStrength * 100)}
              onChange={(e) =>
                updateWallpaper({
                  vignetteStrength: Number(e.target.value) / 100
                })
              }
            />
          </label>

          <label className="prismux-slider-row">
            <span className="prismux-slider-head">
              <span>动态模糊半径</span>
              <span className="prismux-tabular">{state.wallpaper.blurPx} px</span>
            </span>
            <input
              type="range"
              className="prismux-range"
              min={0}
              max={40}
              value={state.wallpaper.blurPx}
              onChange={(e) =>
                updateWallpaper({ blurPx: Number(e.target.value) })
              }
            />
          </label>

          <div className="prismux-slider-row">
            <span className="prismux-slider-head">
              <span>帧率上限 (FPS)</span>
              <span className="prismux-tabular">{state.wallpaper.fpsLimit} FPS</span>
            </span>
            <div style={{ display: "flex", gap: "var(--sp-2)" }}>
              {[30, 60, 120].map((fps) => (
                <button
                  key={fps}
                  type="button"
                  className="prismux-chip prismux-chip-sm prismux-tabular"
                  aria-pressed={state.wallpaper.fpsLimit === fps}
                  onClick={() => updateWallpaper({ fpsLimit: fps })}
                >
                  {fps === 120 ? "原生 120" : `${fps} FPS`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Energy Pause & Audio Reactive Toggles */}
        <div className="prismux-kv-row">
          <span>最小化 / 全屏遮挡时挂起至 0 FPS</span>
          <button
            type="button"
            role="switch"
            aria-checked={state.wallpaper.pauseWhenOccluded}
            aria-label="最小化或全屏遮挡时暂停壁纸渲染至 0 FPS"
            className="prismux-switch"
            onClick={() =>
              updateWallpaper({
                pauseWhenOccluded: !state.wallpaper.pauseWhenOccluded
              })
            }
          >
            <span className="prismux-switch-thumb" />
          </button>
        </div>

        <div className="prismux-kv-row">
          <span>系统音频 FFT 律动（WASAPI / CoreAudio / PipeWire）</span>
          <button
            type="button"
            role="switch"
            aria-checked={state.wallpaper.audioReactive}
            aria-label="启用系统音频 FFT 律动"
            className="prismux-switch"
            onClick={() =>
              updateWallpaper({ audioReactive: !state.wallpaper.audioReactive })
            }
          >
            <span className="prismux-switch-thumb" />
          </button>
        </div>
      </div>

      {/* Four-Region 360° Fresnel Liquid Glass Control */}
      <div className="prismux-panel-section prismux-glass-surface prismux-glass-content">
        <div className="prismux-kv-row">
          <h3 className="prismux-section-title">四区域 360° Fresnel 液态玻璃</h3>
          <button
            type="button"
            role="switch"
            aria-checked={state.glass.enabled}
            aria-label="启用液态玻璃模块"
            className="prismux-switch"
            onClick={() =>
              updateGlass(
                { enabled: !state.glass.enabled },
                !state.glass.enabled
              )
            }
          >
            <span className="prismux-switch-thumb" />
          </button>
        </div>

        {!state.glass.enabled && (
          <p className="prismux-disabled-reason">
            液态玻璃总开关已关闭，工作台当前呈纯净扁平实底，动态壁纸渲染不受影响。
          </p>
        )}

        {/* 5 Presets */}
        <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap" }}>
          {GLASS_PRESET_OPTIONS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="prismux-chip prismux-chip-sm"
              aria-pressed={state.glass.preset === preset.id}
              onClick={() => handlePresetClick(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>

        {/* 4 Independent Regions */}
        <div className="prismux-grid-2">
          {REGION_META.map((region) => {
            const cfg = state.glass[region.key];
            return (
              <div
                key={region.key}
                style={{
                  padding: "var(--sp-3)",
                  borderRadius: "var(--radius-ctl)",
                  border: "1px solid var(--prismux-line)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--sp-2)"
                }}
              >
                <div className="prismux-slider-head">
                  <strong style={{ color: "var(--fg)", fontWeight: 600 }}>
                    {region.label}
                  </strong>
                  <span className="prismux-subtitle">{region.hint}</span>
                </div>

                <label className="prismux-slider-row">
                  <span className="prismux-slider-head">
                    <span>填充不透明度 (fill)</span>
                    <span className="prismux-tabular">{cfg.fill}%</span>
                  </span>
                  <input
                    type="range"
                    className="prismux-range"
                    min={0}
                    max={100}
                    value={cfg.fill}
                    onChange={(e) =>
                      handleRegionChange(
                        region.key,
                        "fill",
                        Number(e.target.value)
                      )
                    }
                  />
                </label>

                <label className="prismux-slider-row">
                  <span className="prismux-slider-head">
                    <span>折射模糊半径 (blur)</span>
                    <span className="prismux-tabular">{cfg.blur} px</span>
                  </span>
                  <input
                    type="range"
                    className="prismux-range"
                    min={0}
                    max={40}
                    value={cfg.blur}
                    onChange={(e) =>
                      handleRegionChange(
                        region.key,
                        "blur",
                        Number(e.target.value)
                      )
                    }
                  />
                </label>
              </div>
            );
          })}
        </div>

        {/* Tint, Fresnel & FISH-Dock Sync */}
        <div className="prismux-grid-2">
          <label className="prismux-slider-row">
            <span className="prismux-slider-head">
              <span>360° Fresnel 边缘高光强度</span>
              <span className="prismux-tabular">
                {Math.round(state.glass.fresnelRimOpacity * 100)}%
              </span>
            </span>
            <input
              type="range"
              className="prismux-range"
              min={0}
              max={100}
              value={Math.round(state.glass.fresnelRimOpacity * 100)}
              onChange={(e) =>
                updateGlass(
                  {
                    fresnelRimOpacity: Number(e.target.value) / 100,
                    preset: "custom",
                    enabled: true
                  },
                  true
                )
              }
            />
          </label>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--sp-2)"
            }}
          >
            <span className="prismux-subtitle">
              独立玻璃色调 (--prismux-glass-tint)
            </span>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "var(--sp-2)" }}>
              <input
                type="color"
                aria-label="选择独立玻璃色调"
                className="prismux-color-input"
                value={state.glass.glassTint ?? "#1b2b48"}
                onChange={(e) =>
                  updateGlass(
                    { glassTint: e.target.value, preset: "custom", enabled: true },
                    true
                  )
                }
              />
              <button
                type="button"
                className="prismux-btn prismux-btn-sm"
                onClick={() => updateGlass({ glassTint: undefined })}
              >
                中性
              </button>
            </div>
          </div>
        </div>

        <div className="prismux-kv-row">
          <span>跟随本机 FISH-Dock 主题（FishDock.theme 桥接）</span>
          <button
            type="button"
            role="switch"
            aria-checked={state.glass.followFishDockTheme}
            aria-label="跟随本机 FISH-Dock 主题"
            className="prismux-switch"
            onClick={() =>
              updateGlass({
                followFishDockTheme: !state.glass.followFishDockTheme
              })
            }
          >
            <span className="prismux-switch-thumb" />
          </button>
        </div>
      </div>

      {/* Independent Light & Dark Typography Palette + .wb-theme Export/Import */}
      <div className="prismux-panel-section prismux-glass-surface prismux-glass-content">
        <h3 className="prismux-section-title">独立文字颜色、排版与 .wb-theme 预设</h3>

        <div className="prismux-grid-2">
          {/* Light Mode Independent Text Colors */}
          <div
            style={{
              padding: "var(--sp-3)",
              borderRadius: "var(--radius-ctl)",
              border: "1px solid var(--prismux-line)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--sp-2)"
            }}
          >
            <strong style={{ fontSize: "var(--text-caption)" }}>
              浅色模式独立调色组
            </strong>
            <div className="prismux-kv-row">
              <span>主文字色 (--fg)</span>
              <input
                type="color"
                aria-label="浅色模式主文字色"
                className="prismux-color-input"
                value={state.typography.lightTextColor}
                onChange={(e) =>
                  updateTypography({ lightTextColor: e.target.value })
                }
              />
            </div>
            <div className="prismux-kv-row">
              <span>次要文字色 (--fg-2)</span>
              <input
                type="color"
                aria-label="浅色模式次要文字色"
                className="prismux-color-input"
                value={state.typography.lightMutedColor}
                onChange={(e) =>
                  updateTypography({ lightMutedColor: e.target.value })
                }
              />
            </div>
            <div className="prismux-kv-row">
              <span>控件前景文字 (--ctl-fg)</span>
              <input
                type="color"
                aria-label="浅色模式控件前景文字色"
                className="prismux-color-input"
                value={extTypo.lightControlFgColor ?? state.typography.lightTextColor}
                onChange={(e) =>
                  updateTypography({ lightControlFgColor: e.target.value })
                }
              />
            </div>
          </div>

          {/* Dark / Glass Mode Independent Text Colors */}
          <div
            style={{
              padding: "var(--sp-3)",
              borderRadius: "var(--radius-ctl)",
              border: "1px solid var(--prismux-line)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--sp-2)"
            }}
          >
            <strong style={{ fontSize: "var(--text-caption)" }}>
              深色 / 玻璃独立调色组
            </strong>
            <div className="prismux-kv-row">
              <span>主文字色 (--fg)</span>
              <input
                type="color"
                aria-label="深色模式主文字色"
                className="prismux-color-input"
                value={state.typography.darkTextColor}
                onChange={(e) =>
                  updateTypography({ darkTextColor: e.target.value })
                }
              />
            </div>
            <div className="prismux-kv-row">
              <span>次要文字色 (--fg-2)</span>
              <input
                type="color"
                aria-label="深色模式次要文字色"
                className="prismux-color-input"
                value={state.typography.darkMutedColor}
                onChange={(e) =>
                  updateTypography({ darkMutedColor: e.target.value })
                }
              />
            </div>
            <div className="prismux-kv-row">
              <span>控件前景文字 (--ctl-fg)</span>
              <input
                type="color"
                aria-label="深色模式控件前景文字色"
                className="prismux-color-input"
                value={extTypo.darkControlFgColor ?? state.typography.controlFgColor}
                onChange={(e) =>
                  updateTypography({
                    darkControlFgColor: e.target.value,
                    controlFgColor: e.target.value
                  })
                }
              />
            </div>
          </div>
        </div>

        {/* Font Family & Weight */}
        <div className="prismux-grid-2">
          <label className="prismux-slider-row">
            <span className="prismux-slider-head">
              <span>界面字体家族</span>
            </span>
            <select
              className="prismux-select"
              value={state.typography.fontFamily ?? FONT_OPTIONS[0]?.value ?? ""}
              onChange={(e) => updateTypography({ fontFamily: e.target.value })}
            >
              {FONT_OPTIONS.map((font) => (
                <option key={font.label} value={font.value}>
                  {font.label}
                </option>
              ))}
            </select>
          </label>

          <label className="prismux-slider-row">
            <span className="prismux-slider-head">
              <span>全局字重 (font-weight)</span>
              <span className="prismux-tabular">
                {state.typography.fontWeight ?? 400}
              </span>
            </span>
            <input
              type="range"
              className="prismux-range"
              min={300}
              max={700}
              step={100}
              value={state.typography.fontWeight ?? 400}
              onChange={(e) =>
                updateTypography({ fontWeight: Number(e.target.value) })
              }
            />
          </label>
        </div>

        {/* .wb-theme Export & Import */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "var(--sp-2)",
            flexWrap: "wrap",
            paddingTop: "var(--sp-2)",
            borderTop: "1px solid var(--prismux-line)"
          }}
        >
          <span className="prismux-subtitle">
            导出时自动剥离本机路径（sourcePath 等）与一切凭据。
          </span>
          <div style={{ display: "inline-flex", gap: "var(--sp-2)" }}>
            <button
              type="button"
              className="prismux-btn prismux-btn-sm"
              onClick={onExportTheme}
            >
              导出 .wb-theme
            </button>
            <button
              type="button"
              className="prismux-btn prismux-btn-sm prismux-btn-primary"
              onClick={() => fileInputRef.current?.click()}
            >
              导入 .wb-theme
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".wb-theme,.json,application/json"
              style={{ display: "none" }}
              onChange={(e) => {
                void handleImportFile(e);
              }}
            />
          </div>
        </div>

        {importError && (
          <div className="prismux-error-alert" role="alert">
            <span>{importError} — 请选择结构完整的 .wb-theme 文件重试。</span>
            <button
              type="button"
              className="prismux-btn prismux-btn-sm"
              onClick={() => setImportError(null)}
            >
              关闭
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
