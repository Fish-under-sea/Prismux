import { useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon, ImageIcon, PaletteIcon } from "lucide-react";
import { AppearanceHeroAndCards, type AppearanceConfig } from "@prismux/appearance";
import { useWallpaperStore } from "@prismux/wallpaper";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { SettingsRow, SettingsSection } from "../../components/settings/settingsLayout";
import { usePrismuxRuntime } from "../PrismuxRuntimeProvider";

/**
 * MP-04: Integrates @prismux/appearance into T3 Code's AppearanceSettingsPanel.
 */
export function PrismuxAppearanceIntegration() {
  const navigate = useNavigate();
  const { appearance, setAppearance, setThemeMode, wallpaperStore, daemonInfo } =
    usePrismuxRuntime();
  const wallpaperSnap = useWallpaperStore(wallpaperStore);

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

  const wallpaperSlot = (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/60 px-3 py-2 text-xs">
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
        管理壁纸引擎
        <ArrowRightIcon className="size-3" />
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
          1:1 FISH-Dock 光学天体三态胶囊（浅色 / 深色 / 玻璃）、360° Fresnel 液态玻璃质感、WCAG ≥
          4.5:1 对比度钳制与主题快照。纯宿主视觉层，对模型 0 Token 开销。
        </p>
        <div className="p-3 sm:p-4">
          <AppearanceHeroAndCards
            config={appearance}
            onChange={handleAppearanceChange}
            alwaysShowGlassCard
            showSnapshotCard
            themeName="Prismux Liquid Glass"
            wallpaperSlot={wallpaperSlot}
          />
        </div>

        <SettingsRow
          title="壁纸引擎与多源舞台"
          description="配置 Steam Workshop (431960) 动态壁纸、本地图片/视频导入、WebWallGL 着色器、轮播分组与遮挡 0 FPS 挂起策略。"
          control={
            <Button size="sm" variant="outline" onClick={handleOpenWallpaperSettings}>
              <ImageIcon className="size-3.5" />
              打开壁纸设置
              <ArrowRightIcon className="size-3.5" />
            </Button>
          }
        />
      </SettingsSection>
    </div>
  );
}
