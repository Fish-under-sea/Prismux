import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ReactNode, RefObject } from "react";
import {
  CARD_TYPE_LABELS,
  RATING_LABELS,
  RATING_TIER_VALUES,
  TYPE_TIER_VALUES,
} from "./defaults.js";
import {
  cardKeyDown,
  ConfirmRow,
  CtlText,
  SectionHead,
  SwitchRow,
  VinylRecord,
} from "./renderers/controls.js";
import {
  PlaybackAudioSection,
  PlaybackEffectsSection,
} from "./renderers/PlaybackSections.js";
import { UserPropsDrillPanel } from "./renderers/UserPropsDrillPanel.js";
import type { BlobUrlRegistry, WallpaperStore } from "./store.js";
import {
  computeFilterCounts,
  computeVirtualWindow,
  createBlobUrlRegistry,
  filterVisibleWallpapers,
  findWallpaperById,
  isWallpaperGatedByEngine,
  useWallpaperStore,
} from "./store.js";
import type {
  AppearanceBridge,
  OrientationFilter,
  RotationGroup,
  ThemeHeroRenderContext,
  WallpaperHostAdapter,
  WallpaperItem,
  WallpaperSettingsTabId,
} from "./types.js";
import { schedulePrewarmVideo } from "./videoPrewarm.js";

export interface WallpaperSettingsViewProps {
  store: WallpaperStore;
  adapter?: WallpaperHostAdapter;
  /** @deprecated Appearance controls moved exclusively to /settings/appearance (Issue #3). */
  appearanceBridge?: AppearanceBridge;
  /** @deprecated Appearance controls moved exclusively to /settings/appearance (Issue #3). */
  renderThemeHero?: (ctx: ThemeHeroRenderContext) => ReactNode;
  initialTab?: WallpaperSettingsTabId;
  activeTab?: WallpaperSettingsTabId;
  onTabChange?: (tab: WallpaperSettingsTabId) => void;
  /** Optional explicit shortcut callback to jump directly to /settings/appearance. */
  onOpenAppearanceSettings?: () => void;
  /** Optional anchor ID attached to the root container for settings search deep links. */
  id?: string;
  /** Optional single status badge displayed beside the playable count (keeps header <= 2 badges). */
  headerStatusBadge?: ReactNode;
  /** Optional right-slot action rendered in the segmented Tab bar row (replaces default rescan button). */
  trailingAction?: ReactNode;
  className?: string;
}

type FocusedWallpaperSettingsTabId = Exclude<WallpaperSettingsTabId, "appearance">;

const SETTINGS_TABS: readonly { id: FocusedWallpaperSettingsTabId; label: string }[] = [
  { id: "library", label: "壁纸库" },
  { id: "playback", label: "画面与播放" },
  { id: "rotation", label: "轮播与隐藏" },
  { id: "system", label: "系统与目录" },
];

function normalizeFocusedTab(tab: WallpaperSettingsTabId): FocusedWallpaperSettingsTabId {
  return tab === "appearance" ? "library" : tab;
}

/** Virtualize the settings thumbnail grid once item count exceeds this threshold so Chromium's 6-socket HTTP/1.1 pool is never flooded. */
export const SETTINGS_VIRTUALIZE_THRESHOLD = 24;
export const SETTINGS_VP_FIRST = 24;
const SETTINGS_GRID_GAP = 10;
const SETTINGS_CARD_MIN_FIXED = 156;
const SETTINGS_CARD_MIN_CLASSIC = 112;
const SETTINGS_VP_OVERSCAN = 4;

function findSettingsScrollContainer(el: HTMLElement): HTMLElement | null {
  for (
    let node: HTMLElement | null = el.parentElement;
    node && node !== document.body && node !== document.documentElement;
    node = node.parentElement
  ) {
    try {
      const oy = getComputedStyle(node).overflowY;
      if ((oy === "auto" || oy === "scroll") && node.scrollHeight > node.clientHeight + 1) {
        return node;
      }
    } catch {
      // Ignore
    }
  }
  return null;
}

function useSettingsGridVirtualWindow(
  gridRef: RefObject<HTMLDivElement | null>,
  count: number,
  layout: "fixed" | "classic",
  active: boolean,
) {
  const [win, setWin] = useState(() => ({
    start: 0,
    end: Math.min(SETTINGS_VP_FIRST, count),
    cols: 4,
    layout,
    measured: false,
    topSpacerHeight: 0,
    bottomSpacerHeight: 0,
  }));

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- virtualizes large settings wallpaper grids via ResizeObserver and scroll container tracking
  useEffect(() => {
    if (!active) return;
    const el = gridRef.current;
    if (!el || typeof window === "undefined") return;

    let rafId = 0;
    let boundScroller: HTMLElement | null = null;
    let lastObservedWidth = -1;
    let lastObservedViewportH = -1;

    const measure = () => {
      rafId = 0;
      const width = el.clientWidth;
      lastObservedWidth = width;
      const minW = layout === "classic" ? SETTINGS_CARD_MIN_CLASSIC : SETTINGS_CARD_MIN_FIXED;
      const cols = Math.max(1, Math.floor((width + SETTINGS_GRID_GAP) / (minW + SETTINGS_GRID_GAP)));
      const colW =
        width > 0 ? Math.max(minW, (width - SETTINGS_GRID_GAP * (cols - 1)) / cols) : minW;
      const rawCardH = Math.max(1, Math.round((colW * 9) / 16));
      const itemHeight = layout === "classic" ? Math.max(28, rawCardH - 34) : rawCardH;

      const sc = findSettingsScrollContainer(el);
      if (sc !== boundScroller) {
        if (boundScroller) {
          boundScroller.removeEventListener("scroll", schedule);
          ro?.unobserve(boundScroller);
        }
        if (sc) {
          sc.addEventListener("scroll", schedule, { passive: true });
          ro?.observe(sc);
        }
        boundScroller = sc;
      }

      let scrollTop = 0;
      let viewportHeight = window.innerHeight || 800;
      if (sc) {
        const scRect = sc.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        scrollTop = Math.max(0, scRect.top - elRect.top);
        viewportHeight = scRect.height > 0 ? scRect.height : viewportHeight;
      } else {
        const elRect = el.getBoundingClientRect();
        scrollTop = Math.max(0, -elRect.top);
      }
      lastObservedViewportH = viewportHeight;

      const computed = computeVirtualWindow({
        count,
        itemHeight,
        gap: SETTINGS_GRID_GAP,
        cols,
        scrollTop,
        viewportHeight,
        overscan: SETTINGS_VP_OVERSCAN,
      });

      setWin((prev) =>
        prev.start === computed.start &&
        prev.end === computed.end &&
        prev.cols === computed.cols &&
        prev.layout === layout &&
        prev.measured &&
        prev.topSpacerHeight === computed.topSpacerHeight &&
        prev.bottomSpacerHeight === computed.bottomSpacerHeight
          ? prev
          : {
              start: computed.start,
              end: computed.end,
              cols: computed.cols,
              layout,
              measured: true,
              topSpacerHeight: computed.topSpacerHeight,
              bottomSpacerHeight: computed.bottomSpacerHeight,
            },
      );
    };

    const schedule = () => {
      if (!rafId) rafId = requestAnimationFrame(measure);
    };

    const handleResize = () => {
      const nextWidth = el.clientWidth;
      const nextViewportH = boundScroller
        ? boundScroller.clientHeight
        : window.innerHeight || 800;
      if (
        lastObservedWidth >= 0 &&
        Math.abs(nextWidth - lastObservedWidth) < 2 &&
        Math.abs(nextViewportH - lastObservedViewportH) < 2
      ) {
        return;
      }
      lastObservedWidth = nextWidth;
      lastObservedViewportH = nextViewportH;
      schedule();
    };

    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(handleResize) : null;
    measure();
    ro?.observe(el);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", handleResize, { passive: true });

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (boundScroller) boundScroller.removeEventListener("scroll", schedule);
      ro?.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", handleResize);
    };
  }, [gridRef, count, layout, active]);

  return win;
}

interface RotationDraft {
  id: string | null;
  name: string;
  intervalMinutes: number;
  order: "sequence" | "random";
  trigger: "timer" | "videoEnd";
  wallpaperIds: string[];
}

/**
 * Focused 4-tab Settings Page Wallpaper View (strictly deduplicated from /settings/appearance per Issue #3):
 *   1. 壁纸库 (library): Vinyl hero, local image/video import, filter bar with counts, batch hide, inline props
 *   2. 画面与播放 (playback): Reuses PlaybackEffectsSection & PlaybackAudioSection (`surface="settings"`)
 *   3. 轮播与隐藏 (rotation): Rotation group CRUD + Hidden wallpapers restore manager
 *   4. 系统与目录 (system): Steam Workshop 431960 directory & local wallpaper directory config, refresh, wallpaper reset
 */
export function WallpaperSettingsView({
  store,
  adapter,
  initialTab = "library",
  activeTab: controlledTab,
  onTabChange,
  onOpenAppearanceSettings,
  id,
  headerStatusBadge,
  trailingAction,
  className,
}: WallpaperSettingsViewProps) {
  const snap = useWallpaperStore(store);
  const { settings, wallpapers } = snap;
  const [internalTab, setInternalTab] = useState<FocusedWallpaperSettingsTabId>(() =>
    normalizeFocusedTab(initialTab),
  );
  const tab: FocusedWallpaperSettingsTabId = normalizeFocusedTab(controlledTab ?? internalTab);

  const setTab = (next: FocusedWallpaperSettingsTabId) => {
    setInternalTab(next);
    onTabChange?.(next);
  };

  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState<string[]>([]);
  const [armedConfirm, setArmedConfirm] = useState<string | null>(null);
  const [showInlineProps, setShowInlineProps] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [rotDraft, setRotDraft] = useState<RotationDraft | null>(null);
  const [steamDirDraft, setSteamDirDraft] = useState(settings.steamRootOverride);
  const [customDirDraft, setCustomDirDraft] = useState(settings.customWallpaperDir);
  const [enablingEngine, setEnablingEngine] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const offlineBlobRegistryRef = useRef<BlobUrlRegistry | null>(null);
  offlineBlobRegistryRef.current ??= createBlobUrlRegistry();

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- reconciles browser object URLs with external wallpaper inventory to prevent blob memory leaks
  useEffect(() => {
    offlineBlobRegistryRef.current?.reconcile(wallpapers);
  }, [wallpapers]);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- revokes browser object URLs held by this settings view on unmount
  useEffect(() => {
    const registry = offlineBlobRegistryRef.current;
    return () => {
      registry?.revokeAll();
    };
  }, []);

  const current = useMemo(
    () => findWallpaperById(wallpapers, settings.selectedId),
    [wallpapers, settings.selectedId],
  );

  const playbackLive = Boolean(current && settings.playing && !snap.occluded);
  const visibleList = useMemo(
    () => filterVisibleWallpapers(wallpapers, settings, snap.settingsSearch),
    [
      wallpapers,
      settings.hiddenIds,
      settings.contentRatingFilter,
      settings.typeFilter,
      settings.orientationFilter,
      snap.settingsSearch,
    ],
  );
  const hiddenList = useMemo(() => {
    const hiddenSet = new Set(settings.hiddenIds);
    return wallpapers.filter((w) => hiddenSet.has(w.id));
  }, [wallpapers, settings.hiddenIds]);

  const counts = useMemo(
    () => computeFilterCounts(wallpapers, settings),
    [wallpapers, settings.hiddenIds, settings.contentRatingFilter, settings.typeFilter],
  );

  const shouldVirtualizeGrid = visibleList.length > SETTINGS_VIRTUALIZE_THRESHOLD;
  const gridVWin = useSettingsGridVirtualWindow(
    gridRef,
    visibleList.length,
    settings.pickerLayout,
    tab === "library" && shouldVirtualizeGrid,
  );
  const gridMeasured =
    shouldVirtualizeGrid &&
    gridVWin.measured &&
    gridVWin.layout === settings.pickerLayout &&
    gridVWin.cols > 0;
  const gridStart = shouldVirtualizeGrid
    ? gridMeasured
      ? Math.min(gridVWin.start, visibleList.length)
      : 0
    : 0;
  const gridEnd = shouldVirtualizeGrid
    ? gridMeasured
      ? Math.max(gridStart, Math.min(gridVWin.end, visibleList.length))
      : Math.min(SETTINGS_VP_FIRST, visibleList.length)
    : visibleList.length;
  const renderedGridItems = shouldVirtualizeGrid
    ? visibleList.slice(gridStart, gridEnd)
    : visibleList;
  const gridTopSpacerH = gridMeasured ? gridVWin.topSpacerHeight : 0;
  const gridBottomSpacerH = gridMeasured ? gridVWin.bottomSpacerHeight : 0;

  const handleQuickEnableEngine = async (targetId: string) => {
    if (enablingEngine) return;
    setEnablingEngine(true);
    try {
      if (adapter?.onAdvancedEngineToggle) {
        await adapter.onAdvancedEngineToggle(true);
      }
      store.enableAdvancedEngineAndSelect(targetId);
    } finally {
      setEnablingEngine(false);
    }
  };

  const handleLocalFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setImportStatus("正在导入本地壁纸…");
    try {
      if (adapter?.importLocalFiles) {
        await store.importLocalFiles(adapter, files);
        setImportStatus(`已成功导入 ${files.length} 个本地壁纸`);
      } else {
        // Browser standalone fallback using Object URLs so UI works even without a backend daemon
        const created: WallpaperItem[] = [];
        for (const f of Array.from(files)) {
          const isVideo = f.type.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(f.name);
          const id = `custom:local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
          const url = URL.createObjectURL(f);
          offlineBlobRegistryRef.current?.track(id, url);
          created.push({
            id,
            title: f.name.replace(/\.[^.]+$/, ""),
            type: isVideo ? "video" : "image",
            source: "custom",
            previewUrl: isVideo ? null : url,
            mediaUrl: url,
            filePath: null,
            width: null,
            height: null,
            orientation: "unknown",
            contentRating: "everyone",
          });
        }
        store.setWallpapers([...wallpapers, ...created]);
        if (created[0]) store.selectWallpaper(created[0].id);
        setImportStatus(`已导入 ${created.length} 个本地壁纸（临时预览会话）`);
      }
    } catch (err) {
      setImportStatus(`导入失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      e.target.value = "";
    }
  };

  const toggleBatchItem = (id: string) => {
    setBatchSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const openNewRotationGroup = () => {
    setRotDraft({
      id: null,
      name: `轮播分组 ${settings.rotationGroups.length + 1}`,
      intervalMinutes: 15,
      order: "sequence",
      trigger: "timer",
      wallpaperIds: visibleList.slice(0, 4).map((w) => w.id),
    });
  };

  const openEditRotationGroup = (g: RotationGroup) => {
    setRotDraft({
      id: g.id,
      name: g.name,
      intervalMinutes: g.intervalMinutes,
      order: g.order,
      trigger: g.trigger,
      wallpaperIds: [...g.wallpaperIds],
    });
  };

  const saveRotationDraft = () => {
    if (!rotDraft) return;
    if (rotDraft.id) {
      store.updateRotationGroup(rotDraft.id, {
        name: rotDraft.name,
        intervalMinutes: rotDraft.intervalMinutes,
        order: rotDraft.order,
        trigger: rotDraft.trigger,
        wallpaperIds: rotDraft.wallpaperIds,
      });
    } else {
      store.createRotationGroup({
        name: rotDraft.name,
        intervalMinutes: rotDraft.intervalMinutes,
        order: rotDraft.order,
        trigger: rotDraft.trigger,
        wallpaperIds: rotDraft.wallpaperIds,
      });
    }
    setRotDraft(null);
  };

  const tabIdx = Math.max(0, SETTINGS_TABS.findIndex((t) => t.id === tab));
  const ratingSet = new Set(settings.contentRatingFilter);
  const typeSet = new Set(settings.typeFilter);

  const renderTabReset = (targetTab: WallpaperSettingsTabId) => {
    const token = `tab:${targetTab}`;
    return (
      <section className="pmx-wp-glass-card pmx-wp-reset-card">
        <div className="pmx-wp-section-head">
          <span className="pmx-wp-section-reset-label">重置本页</span>
        </div>
        <span className="pmx-wp-hint">
          把这一页的设置恢复为默认值；其他页签与已导入的壁纸文件不受影响。
        </span>
        <div className="pmx-wp-row">
          <button
            type="button"
            className="pmx-wp-btn"
            disabled={armedConfirm === token}
            onClick={() => setArmedConfirm(token)}
          >
            重置本页
          </button>
        </div>
        <ConfirmRow
          armed={armedConfirm === token}
          prompt="确定把这一页的设置恢复为默认值吗？此操作不可撤销。"
          onConfirm={() => {
            store.resetTab(targetTab);
            setArmedConfirm(null);
          }}
          onCancel={() => setArmedConfirm(null)}
        />
      </section>
    );
  };

  return (
    <div
      id={id}
      className={"pmx-wp-settings" + (className ? ` ${className}` : "")}
      data-pmx-cards={settings.pickerLayout}
      data-pmx-settings-view="1"
    >
      {/* 精简单层页头（最多 2 枚状态徽章） */}
      <div className="pmx-wp-card-head">
        <div className="pmx-wp-card-head__main">
          <span className="pmx-wp-card-name">壁纸引擎</span>
          <span className="pmx-wp-card-badge">{visibleList.length} 个可播放</span>
          {headerStatusBadge ?? null}
        </div>
        {onOpenAppearanceSettings || adapter?.openSettingsSection ? (
          <button
            type="button"
            className="pmx-wp-btn pmx-wp-btn--mini pmx-wp-card-head__action"
            title="调整主题模式、液态玻璃与字体设置"
            onClick={() => {
              if (onOpenAppearanceSettings) {
                onOpenAppearanceSettings();
              } else {
                adapter?.openSettingsSection?.("appearance");
              }
            }}
          >
            前往外观与玻璃设置 ›
          </button>
        ) : null}
        <span className="pmx-wp-card-desc">
          支持 Steam 创意工坊壁纸与本地图片或视频，自动适配当前主题。
        </span>
      </div>

      {/* 4 页签滑动胶囊导航 + 右侧唯一重扫操作槽 */}
      <div className="pmx-wp-tabs-row">
        <div className="pmx-wp-tabs" role="tablist" aria-label="壁纸设置分区">
          <span
            className="pmx-wp-tabs__pill"
            aria-hidden="true"
            style={{
              width: `calc((100% - 6px) / ${SETTINGS_TABS.length})`,
              transform: `translateX(${tabIdx * 100}%)`,
            }}
          />
          {SETTINGS_TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={
                "pmx-wp-tabs__tab" + (tab === t.id ? " pmx-wp-tabs__tab--active" : "")
              }
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="pmx-wp-tabs-trailing" data-pmx-wp-tabs-trailing="1">
          {trailingAction ?? (
            <button
              type="button"
              className="pmx-wp-btn"
              disabled={snap.loading}
              onClick={() => void store.refreshLibrary(adapter, true)}
            >
              {snap.loading ? "扫描中…" : "重新扫描"}
            </button>
          )}
        </div>
      </div>

      {/* ── Tab 1: 壁纸库（保持挂载避免切页重挂载 50+ 缩略图引发黑屏闪烁）── */}
      <div
        className="pmx-wp-tabpanel"
        data-pmx-settings-tab="library"
        hidden={tab !== "library"}
      >
        {/* 当前壁纸黑胶大卡 */}
        <section className="pmx-wp-glass-card pmx-wp-current-card">
          <VinylRecord
            cover={current?.previewUrl}
            title={current?.title}
            playing={playbackLive}
            size="sm"
          />
          <div className="pmx-wp-current-card__info">
            <div className="pmx-wp-current-card__title">
              {current ? current.title : "尚未选择壁纸"}
            </div>
            <div className="pmx-wp-current-card__meta">
              {current
                ? `${CARD_TYPE_LABELS[current.type]} · 来源：${
                    current.source === "steam"
                      ? "Steam 创意工坊"
                      : current.source === "custom"
                        ? "本地导入"
                        : "内置动态场景"
                  }${current.width && current.height ? ` · ${current.width}×${current.height}` : ""} · ${
                    playbackLive ? "播放中" : "已暂停"
                  }`
                : "从下方网格选择壁纸或导入本地图片/视频"}
            </div>
            {snap.videoError ? <div className="pmx-wp-error">{snap.videoError}</div> : null}
          </div>
          <div className="pmx-wp-current-card__actions">
            <button
              type="button"
              className="pmx-wp-btn pmx-wp-btn--primary"
              disabled={!current}
              onClick={() => store.togglePlay()}
            >
              {playbackLive ? "暂停" : "播放"}
            </button>
            {current && (current.type === "scene" || current.type === "web" || (current.userProperties?.length ?? 0) > 0) ? (
              <button
                type="button"
                className={"pmx-wp-btn" + (showInlineProps ? " is-on" : "")}
                onClick={() => setShowInlineProps((v) => !v)}
              >
                {showInlineProps ? "收起属性" : "壁纸属性"}
              </button>
            ) : null}
            <button
              type="button"
              className="pmx-wp-btn"
              disabled={!current}
              onClick={() => store.clearWallpaper()}
            >
              清除
            </button>
          </div>
        </section>

        {showInlineProps && current ? (
          <UserPropsDrillPanel store={store} adapter={adapter} />
        ) : null}

        {/* 本地图片 / 视频上传导入栏 */}
        <section className="pmx-wp-glass-card pmx-wp-uploads">
          <div className="pmx-wp-row">
            <CtlText
              label="导入本地图片 / 视频壁纸"
              hint="支持常见图片与视频格式，导入后自动保存到本地壁纸库。"
            />
            <button
              type="button"
              className="pmx-wp-btn"
              onClick={() => {
                if (adapter?.pickLocalFiles) {
                  void adapter.pickLocalFiles().then((added) => {
                    if (added.length > 0) {
                      store.setWallpapers([...wallpapers, ...added]);
                      store.selectWallpaper(added[0]!.id);
                      setImportStatus(`已导入 ${added.length} 个本地壁纸`);
                    }
                  });
                } else {
                  fileInputRef.current?.click();
                }
              }}
            >
              选择本地文件…
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".jpg,.jpeg,.png,.webp,.gif,.bmp,.mp4,.webm,.mov,image/*,video/*"
              style={{ display: "none" }}
              onChange={(e) => void handleLocalFileChange(e)}
            />
          </div>
          {importStatus ? <div className="pmx-wp-note">{importStatus}</div> : null}
        </section>

        {/* 壁纸库筛选与 16:9 网格卡片 */}
        <section className="pmx-wp-glass-card pmx-wp-library-card">
          {/* 工具栏 + 批量管理 */}
          <div className="pmx-wp-row">
            <span className="pmx-wp-section-label">全部壁纸</span>
            <span className="pmx-wp-hint">
              {visibleList.length} 个可播放 · 点击卡片即刻切换
            </span>
            <button
              type="button"
              className={"pmx-wp-btn pmx-wp-btn--mini pmx-wp-library-batch-btn" + (batchMode ? " is-on" : "")}
              disabled={visibleList.length === 0}
              onClick={() => {
                setBatchMode((prev) => !prev);
                setBatchSelected([]);
                setArmedConfirm(null);
              }}
            >
              {batchMode ? "退出批量" : "批量隐藏"}
            </button>
          </div>

          {batchMode ? (
            <div className="pmx-wp-row pmx-wp-batch-bar">
              <span className="pmx-wp-hint">已选 {batchSelected.length} 张</span>
              <button
                type="button"
                className="pmx-wp-btn pmx-wp-btn--danger"
                disabled={batchSelected.length === 0 || armedConfirm === "batchHide"}
                onClick={() => setArmedConfirm("batchHide")}
              >
                隐藏选中
              </button>
              <button
                type="button"
                className="pmx-wp-btn"
                onClick={() => {
                  setBatchMode(false);
                  setBatchSelected([]);
                  setArmedConfirm(null);
                }}
              >
                取消
              </button>
            </div>
          ) : null}

          <ConfirmRow
            armed={armedConfirm === "batchHide"}
            prompt={`隐藏选中的 ${batchSelected.length} 张壁纸？可在「轮播与隐藏」页签随时恢复。`}
            onConfirm={() => {
              store.hideWallpapers(batchSelected);
              setBatchSelected([]);
              setBatchMode(false);
              setArmedConfirm(null);
            }}
            onCancel={() => setArmedConfirm(null)}
          />

          {/* 搜索 + 分级/类型/方向筛选（带精确计数） */}
          <div className="pmx-wp-row pmx-wp-filter-row">
            <input
              type="text"
              className="pmx-wp-text pmx-wp-search"
              value={snap.settingsSearch}
              placeholder="搜索壁纸标题或标签…"
              aria-label="搜索壁纸"
              onChange={(e) => store.setSettingsSearch(e.target.value)}
            />

            <details className="pmx-wp-menu">
              <summary className="pmx-wp-menu-btn">
                <span className="pmx-wp-menu-text">内容分级</span>
                <span className="pmx-wp-menu-caret">▾</span>
              </summary>
              <div className="pmx-wp-menu-list">
                {RATING_TIER_VALUES.map((r) => (
                  <label
                    key={r}
                    className={"pmx-wp-menu-item" + (ratingSet.has(r) ? " pmx-wp-menu-item--on" : "")}
                  >
                    <input
                      type="checkbox"
                      checked={ratingSet.has(r)}
                      onChange={() => store.toggleRatingFilter(r)}
                    />
                    <span>{`${RATING_LABELS[r]}（${counts.ratings[r]}）`}</span>
                  </label>
                ))}
              </div>
            </details>

            <details className="pmx-wp-menu">
              <summary className="pmx-wp-menu-btn">
                <span className="pmx-wp-menu-text">类型</span>
                <span className="pmx-wp-menu-caret">▾</span>
              </summary>
              <div className="pmx-wp-menu-list">
                {TYPE_TIER_VALUES.map((t) => (
                  <label
                    key={t}
                    className={"pmx-wp-menu-item" + (typeSet.has(t) ? " pmx-wp-menu-item--on" : "")}
                  >
                    <input
                      type="checkbox"
                      checked={typeSet.has(t)}
                      onChange={() => store.toggleTypeFilter(t)}
                    />
                    <span>{`${CARD_TYPE_LABELS[t]}（${counts.types[t]}）`}</span>
                  </label>
                ))}
              </div>
            </details>

            <details className="pmx-wp-menu">
              <summary className="pmx-wp-menu-btn">
                <span className="pmx-wp-menu-text">壁纸方向</span>
                <span className="pmx-wp-menu-caret">▾</span>
              </summary>
              <div className="pmx-wp-menu-list">
                {(
                  [
                    { id: "all", label: `全部方向（${counts.orientations.all}）` },
                    { id: "landscape", label: `横屏（${counts.orientations.landscape}）` },
                    { id: "portrait", label: `竖屏（${counts.orientations.portrait}）` },
                  ] as Array<{ id: OrientationFilter; label: string }>
                ).map((opt) => (
                  <label
                    key={opt.id}
                    className={
                      "pmx-wp-menu-item" +
                      (settings.orientationFilter === opt.id ? " pmx-wp-menu-item--on" : "")
                    }
                  >
                    <input
                      type="radio"
                      name="pmx-wp-settings-orientation"
                      checked={settings.orientationFilter === opt.id}
                      onChange={() => store.setSetting("orientationFilter", opt.id)}
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </details>
          </div>

          {/* 未开启高级渲染引擎时点击 Web/Scene 卡片的内联引导横幅 */}
          {snap.gatedAttempt && !settings.advancedEngineEnabled ? (
            <div
              className="pmx-wp-gate-banner"
              role="alert"
              data-pmx-engine-gate-banner="1"
            >
              <div className="pmx-wp-gate-banner__head">
                <span className="pmx-wp-gate-banner__title">高级壁纸渲染引擎未开启</span>
                <button
                  type="button"
                  className="pmx-wp-gate-banner__close"
                  aria-label="关闭提示"
                  onClick={() => store.clearGatedAttempt()}
                >
                  ×
                </button>
              </div>
              <p className="pmx-wp-gate-banner__desc">
                「{snap.gatedAttempt.wallpaper.title}」属于
                {snap.gatedAttempt.wallpaper.type === "scene" ? " Steam 场景" : "网页"}
                壁纸，实时渲染会占用更高 GPU 与显存。如需启用，可一键开启高级渲染引擎。
              </p>
              <div className="pmx-wp-gate-banner__actions">
                <button
                  type="button"
                  className="pmx-wp-btn pmx-wp-btn--danger-solid"
                  data-pmx-enable-advanced-engine="1"
                  disabled={enablingEngine}
                  onClick={() => void handleQuickEnableEngine(snap.gatedAttempt!.wallpaper.id)}
                >
                  {enablingEngine ? "正在开启…" : "开启高级渲染引擎"}
                </button>
                <button
                  type="button"
                  className="pmx-wp-btn pmx-wp-btn--mini"
                  data-pmx-open-engine-settings="1"
                  onClick={() => setTab("playback")}
                >
                  前往引擎设置
                </button>
              </div>
            </div>
          ) : null}

          {/* 壁纸网格（超过阈值自动虚拟化，避免大量缩略图挤爆 Chromium HTTP 连接池） */}
          <div
            ref={gridRef}
            className="pmx-wp-grid"
            data-pmx-grid-virtualized={shouldVirtualizeGrid ? "1" : "0"}
          >
            {visibleList.length === 0 ? (
              <span className="pmx-wp-hint">
                {snap.settingsSearch.trim()
                  ? `没有匹配「${snap.settingsSearch}」的壁纸`
                  : "当前筛选下没有可播放的壁纸"}
              </span>
            ) : (
              <>
                {gridTopSpacerH > 0 ? (
                  <div
                    className="pmx-wp-grid__vspacer"
                    style={{ height: `${gridTopSpacerH}px` }}
                    aria-hidden="true"
                  />
                ) : null}
                {renderedGridItems.map((w) => {
                  const isSelected = w.id === settings.selectedId;
                  const isChecked = batchMode && batchSelected.includes(w.id);
                  const isGated = isWallpaperGatedByEngine(w, settings);
                  return (
                    <div
                      key={w.id}
                      data-pmx-wp-id={w.id}
                      data-pmx-engine-gated={isGated ? "1" : undefined}
                      className={
                        "pmx-wp-card" +
                        (isSelected ? " pmx-wp-card--selected" : "") +
                        (isChecked ? " pmx-wp-card--checked" : "") +
                        (isGated && !batchMode ? " pmx-wp-card--gated" : "")
                      }
                      role="button"
                      tabIndex={0}
                      aria-label={isGated ? `${w.title}（渲染引擎未开启）` : w.title}
                      aria-disabled={isGated && !batchMode ? "true" : undefined}
                      onPointerDown={() => {
                        if (w.type === "video" && w.mediaUrl) {
                          schedulePrewarmVideo(w.mediaUrl, true);
                        }
                      }}
                      onClick={() => {
                        if (batchMode) toggleBatchItem(w.id);
                        else store.selectWallpaper(w.id);
                      }}
                      onKeyDown={cardKeyDown}
                    >
                      {w.previewUrl ? (
                        <img
                          src={w.previewUrl}
                          alt={w.title}
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <span className="pmx-wp-card__placeholder">无预览</span>
                      )}
                      {!batchMode ? (
                        <span className="pmx-wp-card__type">{CARD_TYPE_LABELS[w.type]}</span>
                      ) : (
                        <span className="pmx-wp-card__check">{isChecked ? "✓" : ""}</span>
                      )}
                      {isGated && !batchMode ? (
                        <span className="pmx-wp-card__badge pmx-wp-card__badge--gated">
                          渲染引擎未开启
                        </span>
                      ) : null}
                      <span className="pmx-wp-card__title">{w.title}</span>
                      {!batchMode ? (
                        <button
                          type="button"
                          className="pmx-wp-card__hide"
                          title="隐藏此壁纸（不删源文件，可在「轮播与隐藏」恢复）"
                          onClick={(e) => {
                            e.stopPropagation();
                            store.hideWallpapers([w.id]);
                          }}
                        >
                          隐藏
                        </button>
                      ) : null}
                    </div>
                  );
                })}
                {gridBottomSpacerH > 0 ? (
                  <div
                    className="pmx-wp-grid__vspacer"
                    style={{ height: `${gridBottomSpacerH}px` }}
                    aria-hidden="true"
                  />
                ) : null}
              </>
            )}
          </div>
        </section>
        {renderTabReset("library")}
      </div>

      {/* ── Tab 2: 画面与播放（100% 共享 PlaybackSections）── */}
      {tab === "playback" ? (
        <div className="pmx-wp-tabpanel" data-pmx-settings-tab="playback">
          <PlaybackEffectsSection
            store={store}
            adapter={adapter}
            surface="settings"
            onPickWallpaper={() => setTab("library")}
          />
          <PlaybackAudioSection store={store} />
          {renderTabReset("playback")}
        </div>
      ) : null}

      {/* ── Tab 3: 轮播与隐藏 ── */}
      {tab === "rotation" ? (
        <div className="pmx-wp-tabpanel" data-pmx-settings-tab="rotation">
          <section className="pmx-wp-glass-card">
            <SectionHead label="自动轮播分组" />
            <SwitchRow
              label="启用自动轮播"
              checked={settings.rotationEnabled}
              hint="按所选轮播列表定时切图，或在视频播完时自动切换"
              onChange={(on) => store.setSetting("rotationEnabled", on)}
            />
            <div className="pmx-wp-row">
              <button
                type="button"
                className="pmx-wp-btn pmx-wp-btn--primary"
                onClick={openNewRotationGroup}
              >
                + 新建轮播分组
              </button>
              <button
                type="button"
                className="pmx-wp-btn"
                disabled={wallpapers.length < 2}
                onClick={() => store.nextWallpaper()}
              >
                立即切到下一张
              </button>
            </div>

            {settings.rotationGroups.length === 0 ? (
              <div className="pmx-wp-hint">尚未创建轮播分组，点击上方「新建轮播分组」开始配置。</div>
            ) : (
              <div className="pmx-wp-group-list">
                {settings.rotationGroups.map((g) => (
                  <div
                    key={g.id}
                    className={
                      "pmx-wp-group-item" +
                      (settings.rotationGroupId === g.id ? " pmx-wp-group-item--active" : "")
                    }
                  >
                    <div className="pmx-wp-group-item__info">
                      <strong>{g.name}</strong>
                      <span className="pmx-wp-hint">
                        {`${g.wallpaperIds.length} 张 · ${
                          g.trigger === "videoEnd" ? "视频播完切换" : `每 ${g.intervalMinutes} 分钟`
                        } · ${g.order === "random" ? "随机" : "顺序"}`}
                      </span>
                    </div>
                    <div className="pmx-wp-row">
                      <button
                        type="button"
                        className="pmx-wp-btn pmx-wp-btn--mini"
                        onClick={() => store.setSetting("rotationGroupId", g.id)}
                      >
                        {settings.rotationGroupId === g.id ? "当前使用" : "设为活动"}
                      </button>
                      <button
                        type="button"
                        className="pmx-wp-btn pmx-wp-btn--mini"
                        onClick={() => openEditRotationGroup(g)}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className="pmx-wp-btn pmx-wp-btn--mini pmx-wp-btn--danger"
                        onClick={() => store.deleteRotationGroup(g.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {rotDraft ? (
              <div className="pmx-wp-editor">
                <div className="pmx-wp-row">
                  <input
                    type="text"
                    className="pmx-wp-text"
                    value={rotDraft.name}
                    placeholder="分组名称"
                    onChange={(e) => setRotDraft({ ...rotDraft, name: e.target.value })}
                  />
                  <input
                    type="number"
                    className="pmx-wp-text"
                    style={{ maxWidth: "88px" }}
                    min={1}
                    max={1440}
                    value={rotDraft.intervalMinutes}
                    title="轮播间隔（分钟）"
                    onChange={(e) =>
                      setRotDraft({
                        ...rotDraft,
                        intervalMinutes: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                  />
                  <select
                    className="pmx-wp-select"
                    value={rotDraft.order}
                    onChange={(e) =>
                      setRotDraft({
                        ...rotDraft,
                        order: e.target.value === "random" ? "random" : "sequence",
                      })
                    }
                  >
                    <option value="sequence">顺序</option>
                    <option value="random">随机</option>
                  </select>
                  <select
                    className="pmx-wp-select"
                    value={rotDraft.trigger}
                    onChange={(e) =>
                      setRotDraft({
                        ...rotDraft,
                        trigger: e.target.value === "videoEnd" ? "videoEnd" : "timer",
                      })
                    }
                  >
                    <option value="timer">定时切换</option>
                    <option value="videoEnd">视频播完</option>
                  </select>
                </div>

                <div className="pmx-wp-hint">
                  勾选加入本分组的壁纸（已选 {rotDraft.wallpaperIds.length} 张）：
                </div>
                <div className="pmx-wp-editor-grid">
                  {wallpapers.map((w) => {
                    const included = rotDraft.wallpaperIds.includes(w.id);
                    return (
                      <button
                        key={w.id}
                        type="button"
                        className={
                          "pmx-wp-btn pmx-wp-rate" + (included ? " pmx-wp-rate--active" : "")
                        }
                        onClick={() =>
                          setRotDraft({
                            ...rotDraft,
                            wallpaperIds: included
                              ? rotDraft.wallpaperIds.filter((id) => id !== w.id)
                              : [...rotDraft.wallpaperIds, w.id],
                          })
                        }
                      >
                        {included ? "✓ " : ""}
                        {w.title}
                      </button>
                    );
                  })}
                </div>

                <div className="pmx-wp-row">
                  <button
                    type="button"
                    className="pmx-wp-btn pmx-wp-btn--primary"
                    onClick={saveRotationDraft}
                  >
                    保存分组
                  </button>
                  <button
                    type="button"
                    className="pmx-wp-btn"
                    onClick={() => setRotDraft(null)}
                  >
                    取消
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          {/* 已隐藏壁纸恢复 */}
          <section className="pmx-wp-glass-card">
            <SectionHead label={`已隐藏壁纸（${hiddenList.length}）`} />
            {hiddenList.length === 0 ? (
              <span className="pmx-wp-hint">没有已隐藏的壁纸</span>
            ) : (
              <>
                <div className="pmx-wp-row">
                  <span className="pmx-wp-hint">
                    仅从壁纸库隐藏，不会删除你的磁盘源文件。
                  </span>
                  <button
                    type="button"
                    className="pmx-wp-btn"
                    disabled={armedConfirm === "restoreAll"}
                    onClick={() => setArmedConfirm("restoreAll")}
                  >
                    全部恢复
                  </button>
                </div>
                <ConfirmRow
                  armed={armedConfirm === "restoreAll"}
                  prompt={`确定恢复全部 ${hiddenList.length} 张已隐藏壁纸吗？`}
                  onConfirm={() => {
                    store.restoreAllWallpapers();
                    setArmedConfirm(null);
                  }}
                  onCancel={() => setArmedConfirm(null)}
                />
                <div className="pmx-wp-grid">
                  {hiddenList.map((w) => (
                    <div key={w.id} className="pmx-wp-card pmx-wp-card--hidden">
                      {w.previewUrl ? (
                        <img
                          src={w.previewUrl}
                          alt={w.title}
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <span className="pmx-wp-card__placeholder">无预览</span>
                      )}
                      <span className="pmx-wp-card__type">{CARD_TYPE_LABELS[w.type]}</span>
                      <span className="pmx-wp-card__title">{w.title}</span>
                      <button
                        type="button"
                        className="pmx-wp-card__hide"
                        style={{ opacity: 1 }}
                        onClick={() => store.restoreWallpapers([w.id])}
                      >
                        恢复
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
          {renderTabReset("rotation")}
        </div>
      ) : null}

      {/* ── Tab 4: 系统与目录 ── */}
      {tab === "system" ? (
        <div className="pmx-wp-tabpanel" data-pmx-settings-tab="system">
          <section className="pmx-wp-glass-card">
            <SectionHead label="壁纸来源目录" hint="Steam 431960 & 本地" />
            <div className="pmx-wp-dir-stack">
              <div className="pmx-wp-row">
                <span className="pmx-wp-label">Steam 根目录</span>
                <input
                  type="text"
                  className="pmx-wp-text"
                  value={steamDirDraft}
                  placeholder="留空时自动扫描本机 Steam 创意工坊目录"
                  onChange={(e) => setSteamDirDraft(e.target.value)}
                />
                {adapter?.selectDirectory ? (
                  <button
                    type="button"
                    className="pmx-wp-btn"
                    onClick={() => {
                      void adapter.selectDirectory?.("steam", steamDirDraft).then((picked) => {
                        if (picked) {
                          setSteamDirDraft(picked);
                          store.setSetting("steamRootOverride", picked);
                        }
                      });
                    }}
                  >
                    浏览…
                  </button>
                ) : null}
                <button
                  type="button"
                  className="pmx-wp-btn"
                  onClick={() => {
                    store.setSetting("steamRootOverride", steamDirDraft.trim());
                    void store.refreshLibrary(adapter, true);
                  }}
                >
                  保存
                </button>
              </div>
              {snap.steamRoots.length > 0 ? (
                <div className="pmx-wp-hint">
                  已发现 Steam 库：{snap.steamRoots.join(" ； ")}
                </div>
              ) : null}

              <div className="pmx-wp-row">
                <span className="pmx-wp-label">本地壁纸目录</span>
                <input
                  type="text"
                  className="pmx-wp-text"
                  value={customDirDraft}
                  placeholder="留空时使用默认本地壁纸目录"
                  onChange={(e) => setCustomDirDraft(e.target.value)}
                />
                {adapter?.selectDirectory ? (
                  <button
                    type="button"
                    className="pmx-wp-btn"
                    onClick={() => {
                      void adapter.selectDirectory?.("custom", customDirDraft).then((picked) => {
                        if (picked) {
                          setCustomDirDraft(picked);
                          store.setSetting("customWallpaperDir", picked);
                        }
                      });
                    }}
                  >
                    浏览…
                  </button>
                ) : null}
                <button
                  type="button"
                  className="pmx-wp-btn"
                  onClick={() => {
                    store.setSetting("customWallpaperDir", customDirDraft.trim());
                    void store.refreshLibrary(adapter, true);
                  }}
                >
                  保存
                </button>
              </div>
            </div>
          </section>

          <section className="pmx-wp-glass-card">
            <SectionHead label="浏览与省电偏好" />
            <SwitchRow
              label="紧凑 CD 架网格"
              checked={settings.pickerLayout === "classic"}
              hint={settings.pickerLayout === "classic" ? "层叠唱片架视觉风格" : "标准 16:9 宽屏卡片网格"}
              onChange={(on) => store.setSetting("pickerLayout", on ? "classic" : "fixed")}
            />
            <SwitchRow
              label="使用电池时暂停"
              checked={settings.pauseOnBattery}
              hint="笔记本切换电池供电时自动暂停动态壁纸"
              onChange={(on) => store.setSetting("pauseOnBattery", on)}
            />
            <SwitchRow
              label="启动时默认暂停"
              checked={settings.startPaused}
              hint="下次打开应用时保留已选壁纸但保持静态首帧"
              onChange={(on) => store.setSetting("startPaused", on)}
            />
          </section>

          <section className="pmx-wp-glass-card pmx-wp-reset-card">
            <div className="pmx-wp-section-head">
              <span className="pmx-wp-section-reset-label">重置全部壁纸与播放设置</span>
            </div>
            <span className="pmx-wp-hint">
              把壁纸库筛选、画面与播放、轮播、隐藏列表和目录偏好恢复为出厂默认值；主题/液态玻璃设置与已导入源文件不受影响。
            </span>
            <div className="pmx-wp-row">
              <button
                type="button"
                className="pmx-wp-btn pmx-wp-btn--danger"
                disabled={armedConfirm === "resetAll"}
                onClick={() => setArmedConfirm("resetAll")}
              >
                全部重置
              </button>
            </div>
            <ConfirmRow
              armed={armedConfirm === "resetAll"}
              prompt="确定要将所有壁纸与播放设置恢复为出厂默认吗？此操作不可撤销。"
              onConfirm={() => {
                const registry = offlineBlobRegistryRef.current;
                if (registry && registry.size > 0) {
                  const blobIds = new Set(registry.ids());
                  store.setWallpapers(wallpapers.filter((item) => !blobIds.has(item.id)));
                  if (settings.selectedId && blobIds.has(settings.selectedId)) {
                    store.clearWallpaper();
                  }
                  registry.revokeAll();
                }
                store.resetTab("library");
                store.resetTab("playback");
                store.resetTab("rotation");
                store.resetTab("system");
                setArmedConfirm(null);
              }}
              onCancel={() => setArmedConfirm(null)}
            />
          </section>
        </div>
      ) : null}
    </div>
  );
}
