import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { ImageIcon, RefreshCwIcon } from "lucide-react";
import {
  WallpaperSettingsView,
  useWallpaperStore,
  type WallpaperSettingsTabId,
} from "@prismux/wallpaper";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { SettingsPageContainer } from "../../components/settings/settingsLayout";
import { usePrismuxRuntime } from "../PrismuxRuntimeProvider";

const VALID_TABS: ReadonlySet<WallpaperSettingsTabId> = new Set([
  "library",
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

/**
 * MP-04: /settings/wallpaper mounts @prismux/wallpaper's deduplicated 4-tab settings view
 * (壁纸库 / 画面与播放 / 轮播与隐藏 / 系统与目录), linking appearance/glass controls to /settings/appearance.
 */
export function PrismuxWallpaperSettingsPage() {
  const { wallpaperStore, wallpaperHost, daemonInfo, occluded } = usePrismuxRuntime();
  const snap = useWallpaperStore(wallpaperStore);
  const location = useLocation();
  const navigate = useNavigate();

  const routeTab = resolveTabFromLocation(location.hash, location.searchStr);
  const routeKey = `${location.hash}|${location.searchStr}`;
  const [manualTab, setManualTab] = useState<{
    routeKey: string;
    tab: WallpaperSettingsTabId;
  } | null>(null);
  const activeTab: WallpaperSettingsTabId =
    manualTab && manualTab.routeKey === routeKey ? manualTab.tab : (routeTab ?? "library");
  const [refreshing, setRefreshing] = useState(false);

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
        activeTab={activeTab}
        onTabChange={(tab) => setManualTab({ routeKey, tab })}
        onOpenAppearanceSettings={() => {
          void navigate({ to: "/settings/appearance" });
        }}
      />
    </SettingsPageContainer>
  );
}
