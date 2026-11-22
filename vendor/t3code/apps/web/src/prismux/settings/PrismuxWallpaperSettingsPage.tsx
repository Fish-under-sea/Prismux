import { useEffect, useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { ImageIcon, RefreshCwIcon } from "lucide-react";
import { CelestialThemeCapsule, FloatingColorPopover } from "@prismux/appearance";
import {
  WallpaperSettingsView,
  useWallpaperStore,
  type AppearanceBridge,
  type ColorTriggerRenderContext,
  type ThemeHeroRenderContext,
  type WallpaperSettingsTabId,
} from "@prismux/wallpaper";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { SettingsPageContainer } from "../../components/settings/settingsLayout";
import { usePrismuxRuntime } from "../PrismuxRuntimeProvider";

const VALID_TABS: ReadonlySet<WallpaperSettingsTabId> = new Set([
  "library",
  "appearance",
  "playback",
  "rotation",
  "system",
]);

function resolveTabFromLocation(hash: string, searchStr: string): WallpaperSettingsTabId | null {
  const cleanHash = hash.replace(/^#/, "").trim().toLowerCase();
  if (VALID_TABS.has(cleanHash as WallpaperSettingsTabId)) {
    return cleanHash as WallpaperSettingsTabId;
  }
  if (searchStr) {
    const params = new URLSearchParams(searchStr);
    const paramTab = params.get("tab")?.trim().toLowerCase();
    if (paramTab && VALID_TABS.has(paramTab as WallpaperSettingsTabId)) {
      return paramTab as WallpaperSettingsTabId;
    }
  }
  return null;
}

interface ColorPopoverSession {
  key: string;
  label: string;
  value: string;
  anchorEl: HTMLElement;
  onChange: (hex: string) => void;
  onClear?: () => void;
}

/**
 * MP-04: /settings/wallpaper mounts @prismux/wallpaper's 5-tab settings view.
 */
export function PrismuxWallpaperSettingsPage() {
  const { wallpaperStore, wallpaperHost, appearance, setThemeMode, daemonInfo, occluded } =
    usePrismuxRuntime();
  const snap = useWallpaperStore(wallpaperStore);
  const location = useLocation();

  const routeTab = resolveTabFromLocation(location.hash, location.searchStr);
  const routeKey = `${location.hash}|${location.searchStr}`;
  const [manualTab, setManualTab] = useState<{
    routeKey: string;
    tab: WallpaperSettingsTabId;
  } | null>(null);
  const activeTab: WallpaperSettingsTabId =
    manualTab && manualTab.routeKey === routeKey ? manualTab.tab : (routeTab ?? "library");
  const [refreshing, setRefreshing] = useState(false);
  const [colorPopover, setColorPopover] = useState<ColorPopoverSession | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads initial daemon wallpaper inventory once when opened
  useEffect(() => {
    if (!snap.loaded && !snap.loading && wallpaperHost.listWallpapers) {
      void wallpaperStore.refreshLibrary(wallpaperHost, false);
    }
  }, [snap.loaded, snap.loading, wallpaperHost, wallpaperStore]);

  const handleRefreshInventory = async () => {
    setRefreshing(true);
    try {
      await wallpaperStore.refreshLibrary(wallpaperHost, true);
    } finally {
      setRefreshing(false);
    }
  };

  const renderThemeHero = (ctx: ThemeHeroRenderContext) => (
    <div className="py-1">
      <CelestialThemeCapsule
        mode={appearance.themeMode}
        onChange={(nextMode) => {
          setThemeMode(nextMode);
          ctx.onChangeThemeMode(nextMode);
        }}
        size={ctx.surface === "sidebar" ? "compact" : "default"}
      />
    </div>
  );

  const appearanceBridge: AppearanceBridge = {
    ...wallpaperHost.appearanceBridge,
    onThemeModeChange: (nextMode) => {
      setThemeMode(nextMode);
      wallpaperHost.appearanceBridge?.onThemeModeChange?.(nextMode);
    },
    renderThemeHero,
    renderColorTrigger: (ctx: ColorTriggerRenderContext) => {
      const displayColor = ctx.value || "#5e9bff";
      return (
        <button
          type="button"
          className="inline-flex h-7 items-center gap-2 rounded-md border border-border bg-background/80 px-2 text-xs text-foreground shadow-xs transition-colors hover:bg-accent"
          aria-label={`选择颜色：${ctx.label}`}
          onClick={(event) => {
            const target = event.currentTarget;
            setColorPopover((prev) =>
              prev && prev.key === ctx.label && prev.anchorEl === target
                ? null
                : {
                    key: ctx.label,
                    label: ctx.label,
                    value: ctx.value,
                    anchorEl: target,
                    onChange: ctx.onChange,
                    ...(ctx.onClear ? { onClear: ctx.onClear } : {}),
                  },
            );
          }}
        >
          <span
            className="size-3.5 shrink-0 rounded-full border border-border/80 shadow-inner"
            style={{ backgroundColor: displayColor }}
          />
          <span className="font-mono text-2xs uppercase tabular-nums text-muted-foreground">
            {ctx.value || "自动"}
          </span>
        </button>
      );
    },
  };

  return (
    <SettingsPageContainer width="wide">
      <div
        id="prismux-wallpaper"
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 bg-card/70 px-4 py-3"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <ImageIcon className="size-4 shrink-0 text-primary" />
          <span className="text-sm font-medium text-foreground">
            Prismux 多源壁纸引擎（Z-0 舞台 · 0 Token 纯视觉层）
          </span>
          <Badge variant={daemonInfo.ready ? "success" : "warning"}>
            {daemonInfo.ready ? "Daemon 已连接" : "Daemon 离线（内置 WebWallGL 兜底）"}
          </Badge>
          <Badge variant="outline">共 {snap.wallpapers.length} 项壁纸</Badge>
          {occluded ? <Badge variant="secondary">窗口遮挡 · 0 FPS 挂起</Badge> : null}
        </div>
        <Button
          size="xs"
          variant="outline"
          disabled={refreshing || snap.loading}
          onClick={() => {
            void handleRefreshInventory();
          }}
        >
          <RefreshCwIcon
            className={refreshing || snap.loading ? "size-3.5 animate-spin" : "size-3.5"}
          />
          {refreshing || snap.loading ? "扫描中…" : "重新扫描 Steam / 本地目录"}
        </Button>
      </div>

      <WallpaperSettingsView
        store={wallpaperStore}
        adapter={wallpaperHost}
        appearanceBridge={appearanceBridge}
        renderThemeHero={renderThemeHero}
        activeTab={activeTab}
        onTabChange={(tab) => setManualTab({ routeKey, tab })}
      />

      <FloatingColorPopover
        open={colorPopover !== null}
        value={colorPopover?.value ?? ""}
        fallbackColor="#5e9bff"
        anchorEl={colorPopover?.anchorEl ?? null}
        title={colorPopover?.label ?? "选择颜色"}
        allowClear={Boolean(colorPopover?.onClear)}
        onChange={(hex) => {
          colorPopover?.onChange(hex);
          setColorPopover((prev) => (prev ? { ...prev, value: hex } : null));
        }}
        onClear={() => {
          colorPopover?.onClear?.();
          setColorPopover((prev) => (prev ? { ...prev, value: "" } : null));
        }}
        onClose={() => setColorPopover(null)}
      />
    </SettingsPageContainer>
  );
}
