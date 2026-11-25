import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { RefreshCwIcon } from "lucide-react";
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
 * (壁纸库 / 画面与播放 / 轮播与隐藏 / 系统与目录) directly with a single header (<= 2 badges)
 * and one consolidated rescan action in the Tab bar trailing slot.
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

  const isScanning = refreshing || snap.loading;
  const headerStatusBadge = occluded ? (
    <Badge variant="secondary" size="sm">
      已挂起
    </Badge>
  ) : (
    <Badge variant={daemonInfo.ready ? "success" : "warning"} size="sm">
      {daemonInfo.ready ? "服务在线" : "离线模式"}
    </Badge>
  );

  return (
    <SettingsPageContainer width="wide">
      <WallpaperSettingsView
        id="prismux-wallpaper"
        store={wallpaperStore}
        adapter={wallpaperHost}
        activeTab={activeTab}
        onTabChange={(tab) => setManualTab({ routeKey, tab })}
        onOpenAppearanceSettings={() => {
          void navigate({ to: "/settings/appearance" });
        }}
        headerStatusBadge={headerStatusBadge}
        trailingAction={
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={isScanning}
            onClick={() => {
              void handleRefreshInventory();
            }}
          >
            <RefreshCwIcon className={isScanning ? "size-3.5 animate-spin" : "size-3.5"} />
            {isScanning ? "扫描中…" : "重新扫描"}
          </Button>
        }
      />
    </SettingsPageContainer>
  );
}
