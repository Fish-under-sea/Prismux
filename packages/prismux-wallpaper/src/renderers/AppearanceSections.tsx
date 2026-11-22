import type { ReactNode } from "react";
import {
  ACCENT_PRESETS,
  CARET_COLOR_PRESETS,
  COMPONENT_FONT_TARGETS,
  FONT_FAMILY_OPTIONS,
  GLASS_CHILDREN_REGISTRY,
  GLASS_COLOR_PRESETS,
  GLASS_SURFACE_POLICIES,
  SIDEBAR_CORNER_RADIUS_VALUES,
  THEME_COLOR_ROLES,
  TYPOGRAPHY_ROLES,
} from "../defaults.js";
import type { WallpaperStore } from "../store.js";
import { useWallpaperStore } from "../store.js";
import type {
  AppearanceBridge,
  GlassChildId,
  RenderSurface,
  SidebarCornerRadius,
  ThemeHeroRenderContext,
  ThemeMode,
  ThinkingGlassMode,
  WallpaperHostAdapter,
  WallpaperModuleResetKey,
  WallpaperSettingsState,
} from "../types.js";
import { CtlText, SectionHead, SliderRow, SwatchRow, SwitchRow } from "./controls.js";

export interface AppearanceSectionsProps {
  store: WallpaperStore;
  surface: RenderSurface;
  adapter?: WallpaperHostAdapter;
  appearanceBridge?: AppearanceBridge;
  /** Optional custom theme hero / celestial capsule slot (e.g. FISH-Dock 3-state capsule from @prismux/appearance). */
  renderThemeHero?: (ctx: ThemeHeroRenderContext) => ReactNode;
  /** Settings surface section collapse overrides (sidebar uses store.ui localStorage defaults). */
  settingsSectionOpen?: {
    detailOpen?: boolean;
    glassUiOpen?: boolean;
    cornersOpen?: boolean;
    uiColorOpen?: boolean;
    fontOpen?: boolean;
    onToggle?: (key: "detailOpen" | "glassUiOpen" | "cornersOpen" | "uiColorOpen" | "fontOpen") => void;
  };
}

const RADIUS_LABELS: Record<SidebarCornerRadius, string> = {
  native: "跟随原生",
  6: "小 6px",
  12: "中 12px",
  20: "大 20px",
};

const CORNERS = [
  { key: "TL", label: "左上" },
  { key: "TR", label: "右上" },
  { key: "BR", label: "右下" },
  { key: "BL", label: "左下" },
] as const;

const UI_COLOR_ELEMENTS = [
  {
    key: "uiColorSend" as const,
    label: "发送键",
    hint: "输入框右侧圆形箭头按钮（箭头固定白色，建议选中间调）",
  },
  {
    key: "uiColorLink" as const,
    label: "链接文字",
    hint: "会话与面板里的链接、强调文字",
  },
  {
    key: "uiColorFileIcon" as const,
    label: "文件图标",
    hint: "交付物卡片里的代码文件图标（单独覆盖）",
  },
  {
    key: "uiColorTab" as const,
    label: "页签 / 焦点环",
    hint: "页签下划线、焦点环与状态点同源跟色",
  },
  {
    key: "uiColorDeepDiving" as const,
    label: "深度思考状态",
    hint: "思考过程计时文字与微光脉冲",
  },
];

function DefaultThemePill({
  themeMode,
  onChange,
}: {
  themeMode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}) {
  const modes: Array<{ id: ThemeMode; label: string }> = [
    { id: "light", label: "浅色" },
    { id: "dark", label: "深色" },
    { id: "glass", label: "液态玻璃" },
  ];
  const idx = Math.max(0, modes.findIndex((m) => m.id === themeMode));
  return (
    <div className="pmx-wp-tabs pmx-wp-theme-fallback" role="radiogroup" aria-label="外观模式">
      <span
        className="pmx-wp-tabs__pill"
        aria-hidden="true"
        style={{
          width: "calc((100% - 6px) / 3)",
          transform: `translateX(${idx * 100}%)`,
        }}
      />
      {modes.map((m) => (
        <button
          key={m.id}
          type="button"
          role="radio"
          aria-checked={themeMode === m.id}
          className={
            "pmx-wp-tabs__tab" + (themeMode === m.id ? " pmx-wp-tabs__tab--active" : "")
          }
          onClick={() => onChange(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Shared 6-section Appearance renderer (100% reused by WallpaperQuickPanel & WallpaperSettingsView).
 * Strict section order matching dsh-wallpaper-engine:
 *   1. 主题 → 2. 细节 → 3. 玻璃 UI → 4. 侧边栏圆角 → 5. 全局 UI 配色 → 6. 全局字体
 *
 * Enforces:
 *   - Per-section ↺ module reset button + collapsible SectionHead
 *   - Sidebar "详细玻璃调节" collapse gate (`surface === 'sidebar' && glassDetailOpen`)
 *   - Zero dead knobs: every gated sub-slider / independent surface control only renders when its master switch is active
 *   - Content surface glass ("内容面玻璃·独立配置") always reachable in both surfaces whenever `sidebarGlass` is ON
 */
export function AppearanceSections({
  store,
  surface,
  adapter,
  appearanceBridge: bridgeProp,
  renderThemeHero,
  settingsSectionOpen,
}: AppearanceSectionsProps) {
  const snap = useWallpaperStore(store);
  const { settings, ui } = snap;
  const sidebarSurface = surface === "sidebar";
  const bridge = bridgeProp ?? adapter?.appearanceBridge;

  const notifyBridge = (next: WallpaperSettingsState) => {
    bridge?.onAppearanceChange?.(next);
  };

  const patchSettings = (patch: Partial<WallpaperSettingsState>) => {
    store.updateSettings(patch);
    notifyBridge(store.getSnapshot().settings);
  };

  const handleThemeMode = (mode: ThemeMode) => {
    patchSettings({ themeMode: mode });
    bridge?.onThemeModeChange?.(mode);
  };

  const handleResetModule = (key: WallpaperModuleResetKey) => {
    store.resetModule(key);
    notifyBridge(store.getSnapshot().settings);
  };

  const detailOpen = sidebarSurface
    ? ui.detailOpen
    : (settingsSectionOpen?.detailOpen ?? true);
  const glassUiOpen = sidebarSurface
    ? ui.glassUiOpen
    : (settingsSectionOpen?.glassUiOpen ?? true);
  const cornersOpen = sidebarSurface
    ? ui.cornersOpen
    : (settingsSectionOpen?.cornersOpen ?? true);
  const uiColorOpen = sidebarSurface
    ? ui.uiColorOpen
    : (settingsSectionOpen?.uiColorOpen ?? false);
  const fontOpen = sidebarSurface
    ? ui.fontOpen
    : (settingsSectionOpen?.fontOpen ?? false);

  const toggleSection = (
    key: "detailOpen" | "glassUiOpen" | "cornersOpen" | "uiColorOpen" | "fontOpen",
  ) => {
    if (sidebarSurface) {
      store.toggleUiSection(key);
    } else if (settingsSectionOpen?.onToggle) {
      settingsSectionOpen.onToggle(key);
    } else {
      store.toggleUiSection(key);
    }
  };

  const glassDetailOpen = sidebarSurface && ui.glassDetailOpen === true;
  const equalWidthCorners = !sidebarSurface;

  const heroCtx: ThemeHeroRenderContext = {
    surface,
    themeMode: settings.themeMode,
    onChangeThemeMode: handleThemeMode,
    settings,
  };

  const heroNode =
    renderThemeHero?.(heroCtx) ??
    bridge?.renderThemeHero?.(heroCtx) ??
    bridge?.renderThemeCapsule?.(heroCtx) ?? (
      <DefaultThemePill themeMode={settings.themeMode} onChange={handleThemeMode} />
    );

  // ── Helper: Sidebar corner group (left / right) ──
  const renderCornerGroup = (side: "left" | "right", sideLabel: string) => {
    const segClass =
      "pmx-wp-seg" + (equalWidthCorners ? " pmx-wp-seg--corners-eq" : "");
    const currentRadius: SidebarCornerRadius =
      side === "left" ? settings.leftSidebarCornerRadius : settings.rightSidebarCornerRadius;

    const isSquare = (corner: "TL" | "TR" | "BR" | "BL"): boolean => {
      const k = `${side}SidebarSquare${corner}` as keyof WallpaperSettingsState;
      return settings[k] === true;
    };

    const setRadius = (val: SidebarCornerRadius) => {
      if (side === "left") patchSettings({ leftSidebarCornerRadius: val });
      else patchSettings({ rightSidebarCornerRadius: val });
    };

    const toggleSquare = (corner: "TL" | "TR" | "BR" | "BL") => {
      const k = `${side}SidebarSquare${corner}` as keyof WallpaperSettingsState;
      patchSettings({ [k]: !isSquare(corner) } as Partial<WallpaperSettingsState>);
    };

    return (
      <>
        <div className="pmx-wp-ctl pmx-wp-ctl--wrap">
          <CtlText label={`${sideLabel} · 统一圆角`} />
          <div className={segClass}>
            {SIDEBAR_CORNER_RADIUS_VALUES.map((r) => (
              <button
                key={String(r)}
                type="button"
                className={
                  "pmx-wp-btn pmx-wp-rate" +
                  (currentRadius === r ? " pmx-wp-rate--active" : "")
                }
                aria-pressed={currentRadius === r}
                onClick={() => setRadius(r)}
              >
                {RADIUS_LABELS[r]}
              </button>
            ))}
          </div>
        </div>
        <div className="pmx-wp-ctl pmx-wp-ctl--wrap">
          <CtlText label={`${sideLabel} · 四角单独`} />
          <div className={segClass}>
            {CORNERS.map((c) => {
              const round = !isSquare(c.key);
              return (
                <button
                  key={c.key}
                  type="button"
                  className={
                    "pmx-wp-btn pmx-wp-rate" + (round ? " pmx-wp-rate--active" : "")
                  }
                  aria-pressed={round}
                  onClick={() => toggleSquare(c.key)}
                >
                  {`${c.label}角 ${round ? "圆角" : "直角"}`}
                </button>
              );
            })}
          </div>
        </div>
      </>
    );
  };

  // ── Helper: Child glass override rows (only constructed when sidebar detailOpen is true) ──
  const renderAdvancedGlassRows = (): ReactNode => {
    if (!glassDetailOpen) return null;
    const rows: ReactNode[] = [];

    // Capsule fine-tuning: ONLY rendered when thinkingMode === 'glass' (zero dead knobs!)
    if (settings.thinkingMode === "glass") {
      rows.push(
        <SliderRow
          key="capsule-blur"
          label="胶囊雾化"
          min={0}
          max={60}
          step={1}
          value={settings.capsuleBlur}
          unit="px"
          tooltip="新会话按钮、导航胶囊的磨砂模糊半径（仅在思考块液态玻璃开启时生效）"
          onChange={(v) => patchSettings({ capsuleBlur: v })}
        />,
        <SwatchRow
          key="capsule-color"
          label="胶囊颜色"
          presets={GLASS_COLOR_PRESETS}
          value={settings.capsuleColor}
          tooltip="行内胶囊、新会话按钮与导航胶囊的雾底色相"
          appearanceBridge={bridge}
          onChange={(hex) => patchSettings({ capsuleColor: hex })}
        />,
      );
    }

    // Left sidebar independent glass: ONLY when leftSidebarGlass === true
    if (settings.leftSidebarGlass) {
      const indep = store.isChildGlassIndependent("leftSidebar");
      const ov = settings.glassChildren.leftSidebar ?? {};
      rows.push(
        <SwitchRow
          key="ls-indep"
          label="左侧栏玻璃·独立配置"
          checked={indep}
          hint="用左侧栏自己的釉层参数覆盖全局"
          onChange={(on) => {
            store.setChildGlassIndependent("leftSidebar", on);
            notifyBridge(store.getSnapshot().settings);
          }}
        />,
      );
      if (indep) {
        rows.push(
          <SliderRow
            key="ls-alpha"
            label="左侧栏玻璃·玻璃透明度"
            min={0}
            max={100}
            step={5}
            value={ov.transparency ?? settings.glassAlpha}
            unit="%"
            onChange={(v) => {
              store.setChildGlassParam("leftSidebar", "transparency", v);
              notifyBridge(store.getSnapshot().settings);
            }}
          />,
          <SliderRow
            key="ls-blur"
            label="左侧栏玻璃·雾化"
            min={0}
            max={60}
            step={1}
            value={ov.blur ?? settings.blur}
            unit="px"
            onChange={(v) => {
              store.setChildGlassParam("leftSidebar", "blur", v);
              notifyBridge(store.getSnapshot().settings);
            }}
          />,
        );
      }
    }

    // Titlebar independent glass: ONLY when titlebarGlass === true
    if (settings.titlebarGlass) {
      const indep = store.isChildGlassIndependent("titlebar");
      const ov = settings.glassChildren.titlebar ?? {};
      rows.push(
        <SwitchRow
          key="tb-indep"
          label="标题栏玻璃·独立配置"
          checked={indep}
          hint="用标题栏自己的釉层参数覆盖全局"
          onChange={(on) => {
            store.setChildGlassIndependent("titlebar", on);
            notifyBridge(store.getSnapshot().settings);
          }}
        />,
      );
      if (indep) {
        rows.push(
          <SliderRow
            key="tb-alpha"
            label="标题栏玻璃·玻璃透明度"
            min={0}
            max={100}
            step={5}
            value={ov.transparency ?? settings.glassAlpha}
            unit="%"
            onChange={(v) => {
              store.setChildGlassParam("titlebar", "transparency", v);
              notifyBridge(store.getSnapshot().settings);
            }}
          />,
          <SliderRow
            key="tb-blur"
            label="标题栏玻璃·雾化"
            min={0}
            max={60}
            step={1}
            value={ov.blur ?? settings.blur}
            unit="px"
            onChange={(v) => {
              store.setChildGlassParam("titlebar", "blur", v);
              notifyBridge(store.getSnapshot().settings);
            }}
          />,
        );
      }
    }

    // Right sidebar independent glass: ONLY when sidebarPresent && sidebarGlass && !sidebarFollowGlobal
    if (settings.sidebarPresent && settings.sidebarGlass && !settings.sidebarFollowGlobal) {
      const indep = store.isChildGlassIndependent("sidebar");
      const ov = settings.glassChildren.sidebar ?? {};
      rows.push(
        <SwitchRow
          key="sb-indep"
          label="侧栏玻璃·独立配置"
          checked={indep}
          hint="用侧栏自己的模糊 / 透明度 / 底色覆盖全局"
          onChange={(on) => {
            store.setChildGlassIndependent("sidebar", on);
            notifyBridge(store.getSnapshot().settings);
          }}
        />,
      );
      if (indep) {
        rows.push(
          <SliderRow
            key="sb-blur"
            label="侧栏模糊"
            min={0}
            max={60}
            step={1}
            value={ov.blur ?? settings.blur}
            unit="px"
            onChange={(v) => {
              store.setChildGlassParam("sidebar", "blur", v);
              notifyBridge(store.getSnapshot().settings);
            }}
          />,
          <SliderRow
            key="sb-alpha"
            label="侧栏透明度"
            min={0}
            max={100}
            step={5}
            value={ov.transparency ?? settings.glassAlpha}
            unit="%"
            onChange={(v) => {
              store.setChildGlassParam("sidebar", "transparency", v);
              notifyBridge(store.getSnapshot().settings);
            }}
          />,
          <SwatchRow
            key="sb-color"
            label="侧栏玻璃颜色"
            presets={GLASS_COLOR_PRESETS}
            value={ov.color ?? settings.glassColor.light}
            appearanceBridge={bridge}
            onChange={(hex) => {
              store.setChildGlassParam("sidebar", "color", hex);
              notifyBridge(store.getSnapshot().settings);
            }}
          />,
        );
      }
    }

    // Registry-driven sub-UI surfaces (zero dead knobs: only wired params rendered)
    for (const child of GLASS_CHILDREN_REGISTRY) {
      if (child.master === "thinkingGlass" && settings.thinkingMode !== "glass") {
        continue;
      }
      const childId: GlassChildId = child.id;
      const indep = store.isChildGlassIndependent(childId);
      const ov = settings.glassChildren[childId] ?? child.defaults ?? {};
      rows.push(
        <SwitchRow
          key={`gi-${child.id}`}
          label={`${child.label}·独立配置`}
          checked={indep}
          hint={child.hint}
          tooltip="打开后紧接在本行下方出现独立配置，覆盖全局玻璃；关闭回到继承全局"
          onChange={(on) => {
            store.setChildGlassIndependent(childId, on);
            notifyBridge(store.getSnapshot().settings);
          }}
        />,
      );
      if (!indep) continue;

      if (child.params.blur !== undefined) {
        rows.push(
          <SliderRow
            key={`gc-blur-${child.id}`}
            label={`${child.label}·雾化`}
            min={0}
            max={child.params.blur}
            step={1}
            value={ov.blur ?? settings.blur}
            unit="px"
            onChange={(v) => {
              store.setChildGlassParam(childId, "blur", v);
              notifyBridge(store.getSnapshot().settings);
            }}
          />,
        );
      }
      if (child.params.transparency !== undefined) {
        rows.push(
          <SliderRow
            key={`gc-alpha-${child.id}`}
            label={`${child.label}·玻璃透明度`}
            min={0}
            max={child.params.transparency}
            step={5}
            value={ov.transparency ?? settings.glassAlpha}
            unit="%"
            onChange={(v) => {
              store.setChildGlassParam(childId, "transparency", v);
              notifyBridge(store.getSnapshot().settings);
            }}
          />,
        );
      }
      if (child.params.fidelity !== undefined) {
        rows.push(
          <SliderRow
            key={`gc-fid-${child.id}`}
            label={`${child.label}·玻璃保真度`}
            min={0}
            max={child.params.fidelity}
            step={5}
            value={ov.fidelity ?? settings.glassFidelity}
            unit="%"
            onChange={(v) => {
              store.setChildGlassParam(childId, "fidelity", v);
              notifyBridge(store.getSnapshot().settings);
            }}
          />,
        );
      }
      if (child.params.color !== undefined) {
        rows.push(
          <SwatchRow
            key={`gc-color-${child.id}`}
            label={`${child.label}·玻璃颜色`}
            presets={GLASS_COLOR_PRESETS}
            value={ov.color ?? settings.glassColor.light}
            appearanceBridge={bridge}
            onChange={(hex) => {
              store.setChildGlassParam(childId, "color", hex);
              notifyBridge(store.getSnapshot().settings);
            }}
          />,
        );
      }
    }

    return rows;
  };

  // ── Helper: Font family options (built-in + system fonts) ──
  const renderFamilyOptions = (skipInherit: boolean, currentVal: string) => {
    const builtins = skipInherit
      ? FONT_FAMILY_OPTIONS.filter((f) => f.value !== "inherit")
      : FONT_FAMILY_OPTIONS;
    const sysFonts = snap.systemFonts.map((name) => ({
      value: `sys:${name}`,
      label: name,
    }));
    if (
      currentVal.startsWith("sys:") &&
      !sysFonts.some((f) => f.value === currentVal)
    ) {
      sysFonts.unshift({ value: currentVal, label: currentVal.slice(4) });
    }
    return (
      <>
        {builtins.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
        {sysFonts.length > 0 ? (
          <optgroup label="本机字体">
            {sysFonts.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </optgroup>
        ) : null}
      </>
    );
  };

  const visibleTypeRoles = TYPOGRAPHY_ROLES.filter((role) => {
    if (!settings.themeTypeOnly) return true;
    const ov = settings.themeTypography[role.id];
    return Boolean(ov && (ov.size !== undefined || ov.weight !== undefined || ov.family));
  });

  const contentSurfaceIndep = store.isChildGlassIndependent("sidebarContent");
  const contentSurfaceOv = settings.glassChildren.sidebarContent ?? {};

  return (
    <div className="pmx-wp-appearance" data-pmx-surface={surface}>
      {/* ── 1. 主题 ── */}
      <div className="pmx-wp-section" data-pmx-section="theme">
        <SectionHead
          label="主题"
          resetModule="theme"
          onResetModule={handleResetModule}
        />
        {heroNode}
        <SwitchRow
          label="主题随壁纸"
          checked={settings.themeFollow}
          hint="试验性功能 · 关 = 不按壁纸自动改深浅主题（默认关）"
          tooltip="开启时按当前壁纸主色自动切换全局浅色/深色；手动切过主题后本张壁纸不再自动覆盖"
          onChange={(on) => patchSettings({ themeFollow: on })}
        />
        {settings.themeFollow && settings.themeFollowLine ? (
          <div className="pmx-wp-hint">当前：{settings.themeFollowLine}</div>
        ) : null}
      </div>

      {/* ── 2. 细节 ── */}
      <div className="pmx-wp-section" data-pmx-section="details">
        <SectionHead
          label="细节"
          open={detailOpen}
          onToggle={() => toggleSection("detailOpen")}
          resetModule="details"
          onResetModule={handleResetModule}
        />
        {detailOpen ? (
          <SliderRow
            label="边框"
            min={0}
            max={90}
            step={5}
            value={Math.round(settings.border * 100)}
            unit="%"
            tooltip="提高边框与分割线的对比度（浅色与深色主题通用）"
            onChange={(pct) => patchSettings({ border: pct / 100 })}
          />
        ) : null}
      </div>

      {/* ── 3. 玻璃 UI（设置页可插拔主题预设在玻璃节之前）── */}
      {!sidebarSurface && bridge?.renderGlassPresets ? (
        <div className="pmx-wp-section" data-pmx-section="presets">
          <SectionHead label="主题预设" />
          {bridge.renderGlassPresets({
            settings,
            onApplyPatch: patchSettings,
          })}
        </div>
      ) : null}

      <div className="pmx-wp-section" data-pmx-section="glass">
        <SectionHead
          label="玻璃 UI"
          open={glassUiOpen}
          onToggle={() => toggleSection("glassUiOpen")}
          resetModule="glass"
          onResetModule={handleResetModule}
        />
        {glassUiOpen ? (
          <>
            {!sidebarSurface ? (
              <details className="pmx-wp-surface-policy">
                <summary>玻璃兼容</summary>
                <div className="pmx-wp-surface-policy__list">
                  {GLASS_SURFACE_POLICIES.map((sp) => (
                    <label key={sp.id} className="pmx-wp-ctl">
                      <span className="pmx-wp-ctl-label">{sp.label}</span>
                      <select
                        className="pmx-wp-select"
                        value={settings.glassSurfacePolicy[sp.id] ?? "auto"}
                        onChange={(e) =>
                          patchSettings({
                            glassSurfacePolicy: {
                              ...settings.glassSurfacePolicy,
                              [sp.id]: e.target.value === "native" ? "native" : "auto",
                            },
                          })
                        }
                      >
                        <option value="auto">自动适配</option>
                        <option value="native">保留原生</option>
                      </select>
                    </label>
                  ))}
                </div>
              </details>
            ) : null}

            {/* 全局四件套 */}
            {!sidebarSurface ? (
              <SwitchRow
                label="深色单独设置"
                checked={settings.glassDarkSeparate}
                tooltip="关闭时一个颜色同时用于浅色与深色两套；开启后浅色/深色分别设置"
                onChange={(on) => patchSettings({ glassDarkSeparate: on })}
              />
            ) : null}

            <SwatchRow
              label="玻璃颜色"
              presets={GLASS_COLOR_PRESETS}
              value={settings.glassColor.light}
              appearanceBridge={bridge}
              onChange={(hex) =>
                patchSettings({
                  glassColor: settings.glassDarkSeparate
                    ? { ...settings.glassColor, light: hex }
                    : { light: hex, dark: hex },
                })
              }
            />

            {!sidebarSurface && settings.glassDarkSeparate ? (
              <SwatchRow
                label="玻璃颜色 · 深色"
                presets={GLASS_COLOR_PRESETS}
                value={settings.glassColor.dark}
                appearanceBridge={bridge}
                onChange={(hex) =>
                  patchSettings({
                    glassColor: { ...settings.glassColor, dark: hex },
                  })
                }
              />
            ) : null}

            <SliderRow
              label="玻璃透明度"
              min={0}
              max={100}
              step={5}
              value={settings.glassAlpha}
              unit="%"
              onChange={(v) => patchSettings({ glassAlpha: v })}
            />

            <SliderRow
              label="雾化"
              min={0}
              max={60}
              step={1}
              value={settings.blur}
              unit="px"
              tooltip="全局玻璃面板（对话卡片、左侧栏、设置窗口、浮层）的模糊半径"
              onChange={(v) => patchSettings({ blur: v })}
            />

            {!sidebarSurface ? (
              <SliderRow
                label="遮罩浓度"
                min={0}
                max={100}
                step={5}
                value={settings.settingsMaskStrength}
                unit="%"
                tooltip="弹窗背后遮罩层浓度（100 = 原值，0 = 完全透明）"
                onChange={(v) => patchSettings({ settingsMaskStrength: v })}
              />
            ) : null}

            <div className="pmx-wp-ctl pmx-wp-ctl--wrap">
              <CtlText
                label="额外补雾化的选择器"
                hint="给第三方扩展面板补毛玻璃（逗号或换行分隔，留空 = 关）"
              />
              <input
                type="text"
                className="pmx-wp-text"
                value={settings.extraGlassSelectors}
                placeholder="例如 .custom-plugin-panel, .floating-drawer"
                spellCheck={false}
                onChange={(e) => patchSettings({ extraGlassSelectors: e.target.value })}
              />
            </div>

            <SliderRow
              label="玻璃保真度"
              min={0}
              max={100}
              step={5}
              value={settings.glassFidelity}
              unit="%"
              tooltip="100 = 完整可读性红线（自动亮度钳制保正文 ≥ 4.5:1）；拉低后更贴近所选原色"
              onChange={(v) => patchSettings({ glassFidelity: v })}
            />

            {/* 思考块液态玻璃三档 */}
            <div className="pmx-wp-ctl pmx-wp-ctl--wrap">
              <CtlText
                label="思考块液态玻璃"
                hint="对话内容三挡：关（半透明）/ 液态玻璃 / 原生（正文实色、输入框保持玻璃）"
              />
              <div className="pmx-wp-seg">
                {(
                  [
                    { id: "off", label: "关" },
                    { id: "glass", label: "液态玻璃" },
                    { id: "native", label: "原生" },
                  ] as Array<{ id: ThinkingGlassMode; label: string }>
                ).map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className={
                      "pmx-wp-btn pmx-wp-rate" +
                      (settings.thinkingMode === g.id ? " pmx-wp-rate--active" : "")
                    }
                    aria-pressed={settings.thinkingMode === g.id}
                    onClick={() => patchSettings({ thinkingMode: g.id })}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 各面总开关 */}
            <SwitchRow
              label="左侧栏液态玻璃"
              checked={settings.leftSidebarGlass}
              hint="左侧会话与项目栏也跟随全局玻璃配方"
              onChange={(on) => patchSettings({ leftSidebarGlass: on })}
            />
            <SwitchRow
              label="标题栏液态玻璃"
              checked={settings.titlebarGlass}
              hint="顶部标题栏与窗口控制条跟随全局玻璃配方"
              onChange={(on) => patchSettings({ titlebarGlass: on })}
            />
            {settings.sidebarPresent ? (
              <>
                <SwitchRow
                  label="侧栏液态玻璃"
                  checked={settings.sidebarGlass}
                  hint="右侧边栏毛玻璃适配（关闭恢复原生实底）"
                  onChange={(on) => patchSettings({ sidebarGlass: on })}
                />
                <SwitchRow
                  label="侧栏全透明"
                  checked={settings.sidebarFullClear}
                  hint="壁纸下撤掉侧栏的可读性底板、色染与模糊"
                  onChange={(on) => patchSettings({ sidebarFullClear: on })}
                />
              </>
            ) : null}

            <SwitchRow
              label="第三方弹窗不透明底"
              checked={settings.floaterSolidBase}
              hint="给第三方插件弹窗与审批卡补实底，避免背后文字透叠"
              onChange={(on) => patchSettings({ floaterSolidBase: on })}
            />

            <SwitchRow
              label="市场吸顶条裁掉下层内容"
              checked={settings.marketStickyClip}
              hint="吸顶搜索/分类条下方滚过的卡片渐隐裁切"
              onChange={(on) => patchSettings({ marketStickyClip: on })}
            />
            {settings.marketStickyClip ? (
              <SliderRow
                label="市场吸顶条·渐隐宽度"
                min={0}
                max={60}
                step={1}
                value={settings.marketStickyFade}
                unit="px"
                onChange={(v) => patchSettings({ marketStickyFade: v })}
              />
            ) : null}

            {settings.sidebarPresent && settings.sidebarGlass ? (
              <SwitchRow
                label="侧栏玻璃跟随全局"
                checked={settings.sidebarFollowGlobal}
                hint="模糊 / 透明度 / 底色与全局玻璃保持一致"
                onChange={(on) => patchSettings({ sidebarFollowGlobal: on })}
              />
            ) : null}

            {/* 内容面独立玻璃配置：不在 detailOpen 折叠门内，只要 sidebarGlass 开着在两侧都可达 */}
            {settings.sidebarGlass ? (
              <>
                <SwitchRow
                  label="内容面玻璃·独立配置"
                  checked={contentSurfaceIndep}
                  hint="阅读文件页 / 编辑器 / 终端的独立底色与透明度"
                  onChange={(on) => {
                    store.setChildGlassIndependent("sidebarContent", on);
                    notifyBridge(store.getSnapshot().settings);
                  }}
                />
                {contentSurfaceIndep ? (
                  <>
                    <SliderRow
                      label="内容面透明度"
                      min={0}
                      max={100}
                      step={5}
                      value={contentSurfaceOv.transparency ?? 22}
                      unit="%"
                      onChange={(v) => {
                        store.setChildGlassParam("sidebarContent", "transparency", v);
                        notifyBridge(store.getSnapshot().settings);
                      }}
                    />
                    <SwatchRow
                      label="内容面底色"
                      presets={GLASS_COLOR_PRESETS}
                      value={contentSurfaceOv.color ?? ""}
                      autoLabel="主题"
                      autoTitle="跟随主题面板色"
                      colorValue={contentSurfaceOv.color || "#1e1f26"}
                      appearanceBridge={bridge}
                      onChange={(hex) => {
                        store.setChildGlassParam("sidebarContent", "color", hex);
                        notifyBridge(store.getSnapshot().settings);
                      }}
                    />
                  </>
                ) : null}
              </>
            ) : null}

            {/* 侧栏专属「详细玻璃调节」折叠门（ADR-0008 D4：默认收起，设置页不画）*/}
            {sidebarSurface ? (
              <>
                <SwitchRow
                  label="详细玻璃调节"
                  checked={ui.glassDetailOpen}
                  hint="各面独立配置、胶囊细调等进阶旋钮（默认收起）"
                  tooltip="展开后显示每个面的独立配置与胶囊细调，在侧栏可实时对照主画面效果"
                  onChange={(on) => store.setUiState("glassDetailOpen", on)}
                />
                {renderAdvancedGlassRows()}
              </>
            ) : null}
          </>
        ) : null}
      </div>

      {/* ── 4. 侧边栏圆角 ── */}
      <div className="pmx-wp-section" data-pmx-section="corners">
        <SectionHead
          label="侧边栏圆角"
          open={cornersOpen}
          onToggle={() => toggleSection("cornersOpen")}
          resetModule="corners"
          onResetModule={handleResetModule}
        />
        {cornersOpen ? (
          <>
            {renderCornerGroup("left", "左侧栏")}
            {renderCornerGroup("right", "右侧栏")}
          </>
        ) : null}
      </div>

      {/* ── 5. 全局 UI 配色 ── */}
      <div className="pmx-wp-section" data-pmx-section="uiColor">
        <SectionHead
          label="全局 UI 配色"
          open={uiColorOpen}
          onToggle={() => toggleSection("uiColorOpen")}
          resetModule="uiColor"
          onResetModule={handleResetModule}
        />
        {uiColorOpen ? (
          <>
            <SwatchRow
              label="全局配色"
              presets={ACCENT_PRESETS}
              value={settings.accent}
              disabled={settings.uiColorCustom}
              hint={
                settings.uiColorCustom
                  ? "已开启「UI 配色自定义」—— 此刻由下方五项分别决定，本行暂不生效"
                  : "一处调全部：强调色、主按钮、选中态与焦点环同步跟随"
              }
              appearanceBridge={bridge}
              onChange={(hex) => {
                if (!settings.uiColorCustom) patchSettings({ accent: hex });
              }}
            />

            <SwitchRow
              label="UI 配色自定义"
              checked={settings.uiColorCustom}
              tooltip="开启后「全局配色」禁用，改由下面五项分别指定；留「跟随」即回到全局配色"
              onChange={(on) => patchSettings({ uiColorCustom: on })}
            />

            {settings.uiColorCustom
              ? UI_COLOR_ELEMENTS.map((item) => (
                  <SwatchRow
                    key={item.key}
                    label={item.label}
                    hint={item.hint}
                    presets={ACCENT_PRESETS}
                    value={settings[item.key]}
                    autoLabel="跟随"
                    autoTitle="跟随「全局配色」"
                    colorValue={settings[item.key] || settings.accent || "#4f8cff"}
                    appearanceBridge={bridge}
                    onChange={(hex) => patchSettings({ [item.key]: hex })}
                  />
                ))
              : null}

            {/* 光标颜色不在 uiColorCustom 门内，始终可调 */}
            <SwatchRow
              label="光标颜色"
              hint="输入框光标看不清时换个颜色（与上方总开关无关，始终可调）"
              presets={CARET_COLOR_PRESETS}
              value={settings.caretColor}
              autoLabel="自动"
              autoTitle="跟随宿主原生光标颜色"
              colorValue={settings.caretColor || "#4f8cff"}
              appearanceBridge={bridge}
              onChange={(hex) => patchSettings({ caretColor: hex })}
            />
          </>
        ) : null}
      </div>

      {/* ── 6. 全局字体 ── */}
      <div className="pmx-wp-section" data-pmx-section="font">
        <SectionHead
          label="全局字体"
          open={fontOpen}
          onToggle={() => toggleSection("fontOpen")}
          resetModule="font"
          onResetModule={handleResetModule}
        />
        {fontOpen ? (
          <>
            <SwitchRow
              label="字体自定义"
              checked={settings.fontCustom}
              tooltip="关闭恢复默认字体；开启后可自定义全局/终端字体、文字颜色角色与排版字号"
              onChange={(on) => {
                patchSettings({ fontCustom: on });
                if (on && snap.systemFonts.length === 0) {
                  void store.refreshSystemFonts(adapter, false);
                }
              }}
            />

            {settings.fontCustom ? (
              <>
                <div className="pmx-wp-ctl">
                  <button
                    type="button"
                    className="pmx-wp-btn pmx-wp-btn--mini"
                    onClick={() => handleResetModule("font")}
                  >
                    恢复默认字体
                  </button>
                  <button
                    type="button"
                    className="pmx-wp-btn pmx-wp-btn--mini"
                    disabled={snap.systemFontsLoading}
                    onClick={() => void store.refreshSystemFonts(adapter, true)}
                  >
                    {snap.systemFontsLoading ? "扫描中…" : "重新扫描本机字体"}
                  </button>
                </div>

                {snap.systemFontsError ? (
                  <div className="pmx-wp-hint">本机字体读取失败：{snap.systemFontsError}</div>
                ) : null}

                <div className="pmx-wp-ctl">
                  <CtlText label="默认字体" hint="整套界面的默认字族" />
                  <select
                    className="pmx-wp-select"
                    value={settings.globalFamily}
                    onChange={(e) => patchSettings({ globalFamily: e.target.value })}
                  >
                    <option value="">跟随系统</option>
                    {renderFamilyOptions(true, settings.globalFamily)}
                  </select>
                </div>

                <div className="pmx-wp-ctl">
                  <CtlText label="终端字体" hint="对话代码块与终端面板等宽字体" />
                  <select
                    className="pmx-wp-select"
                    value={settings.terminalFamily}
                    onChange={(e) => patchSettings({ terminalFamily: e.target.value })}
                  >
                    <option value="">跟随</option>
                    {renderFamilyOptions(false, settings.terminalFamily)}
                  </select>
                </div>

                <div className="pmx-wp-ctl pmx-wp-ctl--wrap">
                  <CtlText label="文字颜色角色" hint="未设置 = 使用主题默认文字层级" />
                </div>
                <SwitchRow
                  label="深色单独设置"
                  checked={settings.themeDarkSeparate}
                  onChange={(on) => patchSettings({ themeDarkSeparate: on })}
                />
                {THEME_COLOR_ROLES.map((role) => {
                  const pair = settings.themeColors[role.id];
                  return (
                    <div key={role.id} className="pmx-wp-ctl">
                      <CtlText label={role.label} />
                      <div className="pmx-wp-ctl-side">
                        <label className="pmx-wp-swatch-custom">
                          <input
                            type="color"
                            value={pair.light || role.defaultLight}
                            aria-label={`${role.label}浅色`}
                            onChange={(e) =>
                              patchSettings({
                                themeColors: {
                                  ...settings.themeColors,
                                  [role.id]: settings.themeDarkSeparate
                                    ? { ...pair, light: e.target.value }
                                    : { light: e.target.value, dark: e.target.value },
                                },
                              })
                            }
                          />
                          <span>{pair.light ? `浅 ${pair.light}` : "跟随"}</span>
                        </label>
                        {settings.themeDarkSeparate ? (
                          <label className="pmx-wp-swatch-custom">
                            <input
                              type="color"
                              value={pair.dark || role.defaultDark}
                              aria-label={`${role.label}深色`}
                              onChange={(e) =>
                                patchSettings({
                                  themeColors: {
                                    ...settings.themeColors,
                                    [role.id]: { ...pair, dark: e.target.value },
                                  },
                                })
                              }
                            />
                            <span>{pair.dark ? `深 ${pair.dark}` : "跟随"}</span>
                          </label>
                        ) : null}
                        {pair.light || pair.dark ? (
                          <button
                            type="button"
                            className="pmx-wp-btn pmx-wp-btn--mini"
                            onClick={() =>
                              patchSettings({
                                themeColors: {
                                  ...settings.themeColors,
                                  [role.id]: { light: "", dark: "" },
                                },
                              })
                            }
                          >
                            清除
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}

                <div className="pmx-wp-ctl pmx-wp-ctl--wrap">
                  <CtlText label="排版角色" hint="绝对字号 px / 字重 100–900 / 字族覆盖" />
                </div>
                <SwitchRow
                  label="只看改过的"
                  checked={settings.themeTypeOnly}
                  onChange={(on) => patchSettings({ themeTypeOnly: on })}
                />
                {visibleTypeRoles.length === 0 ? (
                  <div className="pmx-wp-hint">
                    当前没有改过的角色（共 {TYPOGRAPHY_ROLES.length} 个），关闭「只看改过的」可展开全部。
                  </div>
                ) : (
                  <div className="pmx-wp-table-wrap">
                    <table className="pmx-wp-font-table">
                      <thead>
                        <tr>
                          <th>角色</th>
                          <th>字号</th>
                          <th>字重</th>
                          <th>字体</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleTypeRoles.map((role) => {
                          const ov = settings.themeTypography[role.id] ?? {};
                          const updateRole = (nextOv: typeof ov) =>
                            patchSettings({
                              themeTypography: {
                                ...settings.themeTypography,
                                [role.id]: nextOv,
                              },
                            });
                          return (
                            <tr key={role.id}>
                              <td>{role.label}</td>
                              <td>
                                <input
                                  type="number"
                                  min={10}
                                  max={36}
                                  value={ov.size ?? role.defaultPx}
                                  onChange={(e) => {
                                    const n = Number(e.target.value);
                                    updateRole({
                                      ...ov,
                                      size: e.target.value === "" ? undefined : n,
                                    });
                                  }}
                                />
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min={100}
                                  max={900}
                                  step={100}
                                  value={ov.weight ?? role.defaultWeight}
                                  onChange={(e) => {
                                    const n = Number(e.target.value);
                                    updateRole({
                                      ...ov,
                                      weight: e.target.value === "" ? undefined : n,
                                    });
                                  }}
                                />
                              </td>
                              <td>
                                <select
                                  className="pmx-wp-select"
                                  value={ov.family ?? ""}
                                  onChange={(e) =>
                                    updateRole({ ...ov, family: e.target.value || undefined })
                                  }
                                >
                                  <option value="">跟随</option>
                                  {renderFamilyOptions(false, ov.family ?? "")}
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <SwitchRow
                  label="高级字体设置"
                  checked={settings.fontAdvanced}
                  hint="按组件（侧栏 / 对话 / 输入框 / 代码块 / 终端）细化"
                  onChange={(on) => patchSettings({ fontAdvanced: on })}
                />
                {settings.fontAdvanced ? (
                  <div className="pmx-wp-table-wrap">
                    <table className="pmx-wp-font-table">
                      <thead>
                        <tr>
                          <th>组件</th>
                          <th>字号</th>
                          <th>字重</th>
                          <th>字体</th>
                        </tr>
                      </thead>
                      <tbody>
                        {COMPONENT_FONT_TARGETS.map((target) => {
                          const ov = settings.componentFonts[target.id] ?? {};
                          const updateComp = (nextOv: typeof ov) =>
                            patchSettings({
                              componentFonts: {
                                ...settings.componentFonts,
                                [target.id]: nextOv,
                              },
                            });
                          return (
                            <tr key={target.id}>
                              <td>{target.label}</td>
                              <td>
                                <input
                                  type="number"
                                  min={8}
                                  max={36}
                                  value={ov.size ?? target.defaultPx}
                                  onChange={(e) =>
                                    updateComp({
                                      ...ov,
                                      size:
                                        e.target.value === "" ? undefined : Number(e.target.value),
                                    })
                                  }
                                />
                              </td>
                              <td>
                                <input
                                  type="number"
                                  min={100}
                                  max={900}
                                  step={100}
                                  value={ov.weight ?? target.defaultWeight}
                                  onChange={(e) =>
                                    updateComp({
                                      ...ov,
                                      weight:
                                        e.target.value === "" ? undefined : Number(e.target.value),
                                    })
                                  }
                                />
                              </td>
                              <td>
                                <select
                                  className="pmx-wp-select"
                                  value={ov.family ?? ""}
                                  onChange={(e) =>
                                    updateComp({ ...ov, family: e.target.value || undefined })
                                  }
                                >
                                  <option value="">跟随</option>
                                  {renderFamilyOptions(false, ov.family ?? "")}
                                </select>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
