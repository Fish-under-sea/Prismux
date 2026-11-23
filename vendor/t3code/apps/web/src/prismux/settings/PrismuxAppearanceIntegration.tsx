import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, ImageIcon, PaletteIcon } from "lucide-react";
import { AppearanceHeroAndCards, type AppearanceConfig } from "@prismux/appearance";
import { useWallpaperStore } from "@prismux/wallpaper";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { SettingsSection } from "../../components/settings/settingsLayout";
import { usePrismuxRuntime } from "../PrismuxRuntimeProvider";

/**
 * MP-04 / Issue #3: Unified Prismux Appearance settings hub inside /settings/appearance.
 * Consolidates all 6 appearance cards (Theme Hero, Liquid Glass + Per-Surface fold,
 * Sidebar Corners, Global UI & Caret Colors, System Fonts & Typography Colors, .wb-theme Snapshot)
 * while linking cleanly to /settings/wallpaper for pure wallpaper management.
 */
export function PrismuxAppearanceIntegration() {
  const navigate = useNavigate();
  const {
    appearance,
    setAppearance,
    setThemeMode,
    wallpaperStore,
    daemonInfo,
    systemFonts,
    refreshSystemFonts,
  } = usePrismuxRuntime();
  const wallpaperSnap = useWallpaperStore(wallpaperStore);
  const [fontsLoading, setFontsLoading] = useState(false);

  const selectedId = wallpaperSnap.settings.selectedId;
  const activeWallpaper = selectedId
    ? (wallpaperSnap.wallpapers.find((item) => item.id === selectedId) ?? null)
    : null;

  const handleAppearanceChange = (next: AppearanceConfig) => {
    if (next.themeMode !== appearance.themeMode) {
      setThemeMode(next.themeMode);
      return;
    }
    setAppearance(next);
  };

  const handleOpenWallpaperSettings = () => {
    void navigate({ to: "/settings/wallpaper" });
  };

  const handleRefreshSystemFonts = () => {
    if (fontsLoading) return;
    setFontsLoading(true);
    void refreshSystemFonts(true).finally(() => {
      setFontsLoading(false);
    });
  };

  const wallpaperSlot = (
    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/60 px-3 py-2 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-foreground">
          {activeWallpaper ? `当前壁纸：${activeWallpaper.title}` : "未启用壁纸（纯色 / 默认舞台）"}
        </span>
        {activeWallpaper ? (
          <Badge variant={wallpaperSnap.settings.playing ? "success" : "secondary"}>
            {wallpaperSnap.settings.playing ? "渲染中" : "已暂停"}
          </Badge>
        ) : null}
      </div>
      <Button size="xs" variant="outline" onClick={handleOpenWallpaperSettings}>
        前往壁纸引擎
        <ChevronRightIcon className="size-3.5" />
      </Button>
    </div>
  );

  return (
    <div className="pt-3">
      <SettingsSection
        id="prismux-appearance"
        title="Prismux 液态玻璃与光学主题"
        headerAction={
          <Badge variant={daemonInfo.ready ? "info" : "outline"}>
            <PaletteIcon className="size-3" />
            {daemonInfo.ready ? "Daemon 实时持久化" : "本地预览模式"}
          </Badge>
        }
      >
        <p className="px-4 pt-3 text-xs leading-relaxed text-muted-foreground">
          统一管理光学天体三态胶囊、360° Fresnel 液态玻璃与各面独立调节、侧边栏圆角、全局 UI
          配色、本机系统字体与主题快照。纯宿主视觉层，对模型 0 Token 开销。
        </p>
        <div className="p-3 sm:p-4">
          <AppearanceHeroAndCards
            config={appearance}
            onChange={handleAppearanceChange}
            alwaysShowGlassCard
            showCornersCard
            showUiColorsCard
            showSnapshotCard
            systemFonts={systemFonts}
            systemFontsLoading={fontsLoading}
            onRefreshSystemFonts={handleRefreshSystemFonts}
            themeName="Prismux Liquid Glass"
            wallpaperSlot={wallpaperSlot}
          />
        </div>
      </SettingsSection>
    </div>
  );
}
