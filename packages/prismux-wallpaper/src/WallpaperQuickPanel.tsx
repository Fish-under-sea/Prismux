import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import {
  CARD_TYPE_LABELS,
  QP_CARD_GAP,
  QP_CARD_H,
  QP_CARD_MIN,
  QP_ROW_GAP,
  QP_ROW_H,
  QP_VP_FIRST,
  QP_VP_OVERSCAN,
  RATING_LABELS,
  RATING_TIER_VALUES,
  TYPE_TIER_VALUES,
} from "./defaults.js";
import { cardKeyDown, SectionHead, SwitchRow } from "./renderers/controls.js";
import {
  PlaybackAudioSection,
  PlaybackEffectsSection,
} from "./renderers/PlaybackSections.js";
import type { WallpaperStore } from "./store.js";
import {
  computeVirtualWindow,
  filterPlayableWallpapers,
  filterVisibleWallpapers,
  findWallpaperById,
  isWallpaperGatedByEngine,
  resolveRotationCandidates,
  useWallpaperStore,
} from "./store.js";
import type {
  AppearanceBridge,
  InlineAppearanceRenderContext,
  OrientationFilter,
  QuickPanelTabId,
  ThemeHeroRenderContext,
  WallpaperHostAdapter,
  WallpaperItem,
  WallpaperSettingsState,
} from "./types.js";
import { schedulePrewarmVideo } from "./videoPrewarm.js";

export interface WallpaperQuickPanelProps {
  store: WallpaperStore;
  adapter?: WallpaperHostAdapter;
  /** Pluggable bridge for injecting inline appearance UI without circular dependencies. */
  appearanceBridge?: AppearanceBridge;
  /** Direct render slot for the in-place Appearance & Liquid Glass studio inside the right panel. */
  renderInlineAppearance?: (ctx: InlineAppearanceRenderContext) => ReactNode;
  /** @deprecated Retained for backwards compatibility only. */
  renderThemeHero?: (ctx: ThemeHeroRenderContext) => ReactNode;
  /** Host layout dock mode: 'official' (fixed-height right sidebar) or 'drawer' (ancestor scrolls). */
  dock?: "official" | "drawer";
  className?: string;
}

const QP_TABS: readonly { id: QuickPanelTabId; label: string }[] = [
  { id: "wallpaper", label: "壁纸" },
  { id: "playback", label: "播放" },
  { id: "appearance", label: "外观与玻璃" },
];

export function resolveQuickPanelTab(tab: QuickPanelTabId | string | undefined): QuickPanelTabId {
  if (tab === "playback" || tab === "appearance") return tab;
  return "wallpaper";
}

export function openInlineAppearanceInStore(
  store: Pick<WallpaperStore, "setUiState">,
): void {
  store.setUiState("qpTab", "appearance");
}

export function closeInlineAppearanceInStore(
  store: Pick<WallpaperStore, "setUiState">,
  returnTab: "wallpaper" | "playback" = "wallpaper",
): void {
  store.setUiState("qpTab", returnTab === "playback" ? "playback" : "wallpaper");
}

function findScrollContainer(el: HTMLElement): HTMLElement | null {
  for (
    let node: HTMLElement | null = el;
    node && node !== document.body;
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

/** Render all filtered items directly up to this threshold to avoid ResizeObserver spacer feedback jitter. */
export const QP_VIRTUALIZE_THRESHOLD = 160;

function useQuickPanelVirtualWindow(
  listRef: RefObject<HTMLDivElement | null>,
  count: number,
  itemHeight: number,
  gap: number,
  cardsView: boolean,
  active: boolean,
  restoreScrollTopRef?: RefObject<number>,
) {
  const [win, setWin] = useState(() => ({
    start: 0,
    end: Math.min(QP_VP_FIRST, count),
    cols: cardsView ? 2 : 1,
    cards: cardsView,
    measured: false,
    topSpacerHeight: 0,
    bottomSpacerHeight: 0,
  }));

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- tracks ResizeObserver and DOM scroll offsets for large-library virtual windowing
  useEffect(() => {
    if (!active) return;
    const el = listRef.current;
    if (!el || typeof window === "undefined") return;

    let rafId = 0;
    let boundScroller: HTMLElement | null = null;
    let lastObservedWidth = -1;
    let lastObservedViewportH = -1;

    const measure = () => {
      rafId = 0;
      const width = el.clientWidth;
      lastObservedWidth = width;
      let cols = 1;
      let measuredItemH = itemHeight;
      if (cardsView) {
        cols = Math.max(1, Math.floor((width + gap) / (QP_CARD_MIN + gap)));
        if (width > 0 && cols > 0) {
          const colW = Math.max(QP_CARD_MIN, (width - gap * (cols - 1)) / cols);
          measuredItemH = Math.max(1, Math.round((colW * 9) / 16));
        }
      }

      const sc = findScrollContainer(el);
      if (sc && sc !== boundScroller) {
        if (boundScroller) {
          boundScroller.removeEventListener("scroll", schedule);
          ro?.unobserve(boundScroller);
        }
        sc.addEventListener("scroll", schedule, { passive: true });
        if (sc !== el) ro?.observe(sc);
        boundScroller = sc;
      }

      let scrollTop = 0;
      let viewportHeight = Number.POSITIVE_INFINITY;
      if (sc === el) {
        scrollTop = el.scrollTop;
        viewportHeight = el.clientHeight;
      } else if (sc) {
        const scRect = sc.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        scrollTop = Math.max(0, scRect.top - elRect.top);
        viewportHeight = scRect.height;
      }
      lastObservedViewportH = Number.isFinite(viewportHeight) ? viewportHeight : el.clientHeight;

      const computed = computeVirtualWindow({
        count,
        itemHeight: measuredItemH,
        gap,
        cols,
        scrollTop,
        viewportHeight,
        overscan: QP_VP_OVERSCAN,
      });

      setWin((prev) =>
        prev.start === computed.start &&
        prev.end === computed.end &&
        prev.cols === computed.cols &&
        prev.cards === cardsView &&
        prev.measured &&
        prev.topSpacerHeight === computed.topSpacerHeight &&
        prev.bottomSpacerHeight === computed.bottomSpacerHeight
          ? prev
          : {
              start: computed.start,
              end: computed.end,
              cols: computed.cols,
              cards: cardsView,
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
      const nextViewportH = boundScroller ? boundScroller.clientHeight : el.clientHeight;
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
    const savedTop = restoreScrollTopRef?.current ?? 0;
    if (savedTop > 0) {
      el.scrollTop = savedTop;
      if (restoreScrollTopRef) restoreScrollTopRef.current = 0;
      measure();
      rafId = requestAnimationFrame(() => {
        el.scrollTop = savedTop;
        measure();
      });
    } else {
      el.scrollTop = 0;
      measure();
    }
    ro?.observe(el);
    window.addEventListener("resize", handleResize);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (boundScroller) boundScroller.removeEventListener("scroll", schedule);
      ro?.disconnect();
      window.removeEventListener("resize", handleResize);
    };
  }, [listRef, count, itemHeight, gap, cardsView, active, restoreScrollTopRef]);

  return win;
}

function formatTypeMeta(w: WallpaperItem, settings: WallpaperSettingsState): string {
  if (isWallpaperGatedByEngine(w, settings)) {
    return w.type === "scene" ? "场景 · 渲染引擎未开启" : "网页 · 渲染引擎未开启";
  }
  const live =
    (w.type === "scene" || w.type === "web") &&
    settings.advancedEngineEnabled &&
    settings.sceneLive;
  if (w.type === "scene") return live ? "场景 · 实时渲染" : "场景 · 静态帧";
  if (w.type === "web") return live ? "网页 · 实时渲染" : "网页 · 兼容模式";
  return CARD_TYPE_LABELS[w.type] ?? "壁纸";
}

/**
 * Right-sidebar QuickPanel (壁纸 / 播放 / 外观与玻璃) with permanent current-wallpaper header
 * and in-place Appearance & Liquid Glass Studio (never navigates away on tab switch).
 */
export function WallpaperQuickPanel({
  store,
  adapter,
  appearanceBridge,
  renderInlineAppearance,
  dock = "official",
  className,
}: WallpaperQuickPanelProps) {
  const snap = useWallpaperStore(store);
  const { settings, ui, wallpapers } = snap;
  const listRef = useRef<HTMLDivElement | null>(null);
  const lastMediaTabRef = useRef<"wallpaper" | "playback">("wallpaper");
  const savedScrollTopRef = useRef<number>(0);
  const [enablingEngine, setEnablingEngine] = useState(false);

  const effectiveTab: QuickPanelTabId = resolveQuickPanelTab(ui.qpTab);
  const isAppearanceView = effectiveTab === "appearance";

  const current = useMemo(
    () => findWallpaperById(wallpapers, settings.selectedId),
    [wallpapers, settings.selectedId],
  );

  const playbackLive = Boolean(current && settings.playing && !snap.occluded);

  const { hiddenIds, contentRatingFilter, typeFilter, orientationFilter } = settings;

  const playable = useMemo(
    () => filterPlayableWallpapers(wallpapers, { hiddenIds, contentRatingFilter }),
    [wallpapers, hiddenIds, contentRatingFilter],
  );

  const filtered = useMemo(
    () =>
      filterVisibleWallpapers(
        wallpapers,
        { hiddenIds, contentRatingFilter, typeFilter, orientationFilter },
        snap.qpSearch,
      ),
    [wallpapers, hiddenIds, contentRatingFilter, typeFilter, orientationFilter, snap.qpSearch],
  );

  const rotationCandidates = useMemo(
    () => resolveRotationCandidates(wallpapers, settings),
    [wallpapers, settings],
  );

  const cardsView = ui.qpView === "cards";
  const vItemH = cardsView ? QP_CARD_H : QP_ROW_H;
  const vGap = cardsView ? QP_CARD_GAP : QP_ROW_GAP;
  const listActive = effectiveTab === "wallpaper";
  const shouldVirtualize = filtered.length > QP_VIRTUALIZE_THRESHOLD;
  const vwin = useQuickPanelVirtualWindow(
    listRef,
    filtered.length,
    vItemH,
    vGap,
    cardsView,
    listActive && shouldVirtualize,
    savedScrollTopRef,
  );

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- restores imperative DOM scrollTop on listRef when returning to the wallpaper tab
  useEffect(() => {
    if (!listActive || shouldVirtualize) return;
    const el = listRef.current;
    if (!el) return;
    const savedTop = savedScrollTopRef.current;
    if (savedTop > 0) {
      el.scrollTop = savedTop;
      savedScrollTopRef.current = 0;
    }
  }, [listActive, shouldVirtualize]);

  const isMeasured =
    shouldVirtualize && vwin.measured && vwin.cards === cardsView && vwin.cols > 0;
  const vStart = shouldVirtualize
    ? isMeasured
      ? Math.min(vwin.start, filtered.length)
      : 0
    : 0;
  const vEnd = shouldVirtualize
    ? isMeasured
      ? Math.max(vStart, Math.min(vwin.end, filtered.length))
      : Math.min(QP_VP_FIRST, filtered.length)
    : filtered.length;
  const visibleRows = shouldVirtualize ? filtered.slice(vStart, vEnd) : filtered;
  const vTopH = isMeasured ? vwin.topSpacerHeight : 0;
  const vBtmH = isMeasured ? vwin.bottomSpacerHeight : 0;

  const tabIdx = Math.max(0, QP_TABS.findIndex((t) => t.id === effectiveTab));

  const inlineAppearanceSlot =
    renderInlineAppearance ??
    appearanceBridge?.renderInlineAppearance ??
    adapter?.appearanceBridge?.renderInlineAppearance;

  const handleOpenInlineAppearance = () => {
    if (effectiveTab !== "appearance") {
      lastMediaTabRef.current = effectiveTab;
      if (listRef.current) {
        savedScrollTopRef.current = listRef.current.scrollTop;
      }
    }
    openInlineAppearanceInStore(store);
  };

  const handleBackToWallpaper = () => {
    closeInlineAppearanceInStore(store, lastMediaTabRef.current);
  };

  const handleOpenFullAppearanceSettings = adapter?.openSettingsSection
    ? () => adapter.openSettingsSection?.("appearance")
    : undefined;

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

  // Prewarm single metadata slot ONLY on intentional pointer-down (never on hover to prevent D3D11 flicker)
  const handleCardPointerDown = (w: WallpaperItem) => {
    if (w.type === "video" && w.mediaUrl) {
      schedulePrewarmVideo(w.mediaUrl, true);
    }
  };

  const renderCard = (w: WallpaperItem) => {
    const isCurrent = w.id === settings.selectedId;
    const isGated = isWallpaperGatedByEngine(w, settings);
    return (
      <div
        key={w.id}
        data-pmx-wp-id={w.id}
        data-pmx-engine-gated={isGated ? "1" : undefined}
        className={
          "pmx-wp-qp__card" +
          (isCurrent ? " pmx-wp-qp__card--current" : "") +
          (isGated ? " pmx-wp-qp__card--gated" : "")
        }
        role="option"
        tabIndex={0}
        aria-selected={isCurrent}
        aria-disabled={isGated ? "true" : undefined}
        // oxlint-disable-next-line prismux/no-native-title-tooltip -- standalone @prismux/wallpaper package has no host Tooltip component
        title={isGated ? `${w.title}（高级壁纸渲染引擎未开启）` : w.title}
        onPointerDown={() => handleCardPointerDown(w)}
        onClick={() => store.selectWallpaper(w.id)}
        onKeyDown={cardKeyDown}
      >
        {w.previewUrl ? (
          <img
            src={w.previewUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
        ) : (
          <span className="pmx-wp-qp__card-empty">无预览</span>
        )}
        <span className="pmx-wp-qp__card-type">{CARD_TYPE_LABELS[w.type]}</span>
        {isGated ? (
          <span className="pmx-wp-qp__card-badge pmx-wp-qp__card-badge--gated">渲染引擎未开启</span>
        ) : isCurrent ? (
          <span className="pmx-wp-qp__card-badge">当前</span>
        ) : null}
        <span className="pmx-wp-qp__card-title">{w.title}</span>
      </div>
    );
  };

  const renderListRow = (w: WallpaperItem) => {
    const isCurrent = w.id === settings.selectedId;
    const isGated = isWallpaperGatedByEngine(w, settings);
    return (
      <div
        key={w.id}
        data-pmx-wp-id={w.id}
        data-pmx-engine-gated={isGated ? "1" : undefined}
        className={
          "pmx-wp-qp__item" +
          (isCurrent ? " pmx-wp-qp__item--current" : "") +
          (isGated ? " pmx-wp-qp__item--gated" : "")
        }
        role="option"
        tabIndex={0}
        aria-selected={isCurrent}
        aria-disabled={isGated ? "true" : undefined}
        // oxlint-disable-next-line prismux/no-native-title-tooltip -- standalone @prismux/wallpaper package has no host Tooltip component
        title={isGated ? `${w.title}（高级壁纸渲染引擎未开启）` : w.title}
        onPointerDown={() => handleCardPointerDown(w)}
        onClick={() => store.selectWallpaper(w.id)}
        onKeyDown={cardKeyDown}
      >
        <span className="pmx-wp-qp__item-thumb">
          {w.previewUrl ? (
            <img
              src={w.previewUrl}
              alt=""
              loading="lazy"
              decoding="async"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
          ) : null}
        </span>
        <span className="pmx-wp-qp__item-title">{w.title}</span>
        {isGated ? (
          <span className="pmx-wp-qp__item-badge pmx-wp-qp__item-badge--gated">
            渲染引擎未开启
          </span>
        ) : isCurrent ? (
          <span className="pmx-wp-qp__item-badge">当前</span>
        ) : (
          <span className="pmx-wp-qp__item-type">{CARD_TYPE_LABELS[w.type]}</span>
        )}
      </div>
    );
  };

  const ratingSet = new Set(settings.contentRatingFilter);
  const typeSet = new Set(settings.typeFilter);

  return (
    <div
      className={
        `pmx-wp-qp pmx-wp-qp--${dock}` +
        (isAppearanceView ? " pmx-wp-qp--appearance" : "") +
        (className ? ` ${className}` : "")
      }
      data-pmx-quick-panel="1"
      data-pmx-qp-view={effectiveTab}
    >
      {/* ① 当前壁纸顶卡（常驻于 壁纸 / 播放 / 外观与玻璃 全部 3 个页签上方） */}
      <div
        className={
          "pmx-wp-glass-card pmx-wp-qp__current" +
          (playbackLive ? " pmx-wp-qp__current--playing" : "")
        }
      >
        <span className="pmx-wp-qp__thumb">
          {current?.previewUrl ? (
            <img
              src={current.previewUrl}
              alt=""
              loading="lazy"
              decoding="async"
            />
          ) : null}
        </span>
        <div className="pmx-wp-qp__current-info">
          {/* oxlint-disable-next-line prismux/no-native-title-tooltip -- standalone @prismux/wallpaper package has no host Tooltip component */}
          <div className="pmx-wp-qp__title" title={current?.title ?? ""}>
            {current ? current.title : "未选择壁纸"}
          </div>
          <div className="pmx-wp-qp__meta">
            {current
              ? `${formatTypeMeta(current, settings)} · ${playbackLive ? "播放中" : "已暂停"}`
              : "从下方列表挑一张"}
          </div>
          {snap.videoError ? (
            <div className="pmx-wp-error">{snap.videoError}</div>
          ) : null}
        </div>
        <div className="pmx-wp-qp__current-actions">
          <button
            type="button"
            className="pmx-wp-btn"
            disabled={!current}
            onClick={() => store.togglePlay()}
          >
            {playbackLive ? "暂停" : "播放"}
          </button>
          <button
            type="button"
            className="pmx-wp-btn"
            disabled={snap.loading}
            // oxlint-disable-next-line prismux/no-native-title-tooltip -- standalone @prismux/wallpaper package has no host Tooltip component
            title="重新扫描 Steam Workshop 431960 与本地自定义壁纸库"
            onClick={() => void store.refreshLibrary(adapter, true)}
          >
            {snap.loading ? "刷新中…" : "刷新"}
          </button>
          <button
            type="button"
            className="pmx-wp-btn"
            disabled={!current}
            // oxlint-disable-next-line prismux/no-native-title-tooltip -- standalone @prismux/wallpaper package has no host Tooltip component
            title="清除当前壁纸，回到无壁纸状态"
            onClick={() => store.clearWallpaper()}
          >
            清除
          </button>
        </div>
      </div>

      {/* ② 滑动胶囊三档页签（壁纸 / 播放 / 外观与玻璃） */}
      <div className="pmx-wp-tabs pmx-wp-qp__tabs" role="tablist" aria-label="壁纸面板分区">
        <span
          className="pmx-wp-tabs__pill"
          aria-hidden="true"
          style={{
            width: `calc((100% - 6px) / ${QP_TABS.length})`,
            transform: `translateX(${tabIdx * 100}%)`,
          }}
        />
        {QP_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={effectiveTab === t.id}
            data-pmx-qp-tab={t.id}
            className={
              "pmx-wp-tabs__tab" + (effectiveTab === t.id ? " pmx-wp-tabs__tab--active" : "")
            }
            onClick={() => {
              if (effectiveTab === "wallpaper" && t.id !== "wallpaper" && listRef.current) {
                savedScrollTopRef.current = listRef.current.scrollTop;
              }
              if (t.id === "appearance") {
                handleOpenInlineAppearance();
              } else {
                lastMediaTabRef.current = t.id;
                store.setUiState("qpTab", t.id);
              }
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ③ 主内容区（含滚动链隔离 overscroll-behavior: contain） */}
      <div
        className={
          "pmx-wp-qp__tabbody" +
          (effectiveTab === "wallpaper" ? " pmx-wp-qp__tabbody--library" : "") +
          (isAppearanceView ? " pmx-wp-qp__tabbody--appearance" : "")
        }
      >
        {isAppearanceView ? (
          <div className="pmx-wp-qp__inline-appearance" data-pmx-inline-appearance="1">
            {inlineAppearanceSlot ? (
              inlineAppearanceSlot({
                onBack: handleBackToWallpaper,
                ...(handleOpenFullAppearanceSettings
                  ? { onOpenFullSettings: handleOpenFullAppearanceSettings }
                  : {}),
                compact: true,
              })
            ) : (
              <div className="pmx-wp-qp__inline-fallback">
                <div className="pmx-wp-qp__inline-head">
                  <button
                    type="button"
                    className="pmx-wp-btn pmx-wp-btn--mini"
                    data-pmx-inline-appearance-back="1"
                    onClick={handleBackToWallpaper}
                  >
                    ← 返回壁纸
                  </button>
                  <span className="pmx-wp-qp__inline-title">外观与玻璃</span>
                </div>
                <p className="pmx-wp-hint">
                  在当前侧边栏实时调节主题与分区液态玻璃，改动即时生效且不遮挡主界面与壁纸。
                </p>
              </div>
            )}
          </div>
        ) : effectiveTab === "playback" ? (
          <>
            <PlaybackEffectsSection
              store={store}
              adapter={adapter}
              surface="sidebar"
              onPickWallpaper={() => store.setUiState("qpTab", "wallpaper")}
            />
            <PlaybackAudioSection store={store} />
            <section
              className="pmx-wp-glass-card pmx-wp-qp__rotation"
              data-pmx-section="rotation"
              data-pmx-playback-card="rotation"
            >
              <SectionHead label="自动轮播" />
              <div className="pmx-wp-qp__row">
                <select
                  className="pmx-wp-select pmx-wp-qp__group"
                  value={settings.rotationGroupId}
                  disabled={settings.rotationGroups.length === 0}
                  aria-label="轮播列表"
                  onChange={(e) => store.setSetting("rotationGroupId", e.target.value)}
                >
                  <option value="">
                    {settings.rotationGroups.length > 0 ? "请选择轮播列表" : "暂无轮播列表"}
                  </option>
                  {settings.rotationGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {`${g.name}（${g.wallpaperIds.length} 张 · ${g.intervalMinutes} 分钟）`}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="pmx-wp-btn"
                  disabled={rotationCandidates.length < 2}
                  // oxlint-disable-next-line prismux/no-native-title-tooltip -- standalone @prismux/wallpaper package has no host Tooltip component
                  title="切到下一张壁纸"
                  onClick={() => store.nextWallpaper()}
                >
                  下一张
                </button>
              </div>
              <SwitchRow
                label="自动轮播"
                checked={settings.rotationEnabled}
                hint={
                  settings.rotationGroups.length > 0
                    ? "按所选列表定时自动切换"
                    : "先到设置页新建一个轮播列表"
                }
                onChange={(on) => store.setSetting("rotationEnabled", on)}
              />
            </section>
          </>
        ) : (
          /* 壁纸库（搜索 + 分级/类型/方向筛选 + 列表/卡片切换 + 虚拟滚动列表） */
          <div className="pmx-wp-glass-card pmx-wp-qp__library">
              {snap.inventoryError ? (
                <div className="pmx-wp-qp__error-box">
                  <div className="pmx-wp-error">壁纸库扫描失败：{snap.inventoryError}</div>
                  <button
                    type="button"
                    className="pmx-wp-btn"
                    disabled={snap.loading}
                    onClick={() => void store.refreshLibrary(adapter, true)}
                  >
                    {snap.loading ? "刷新中…" : "重试"}
                  </button>
                </div>
              ) : (
                <>
                  <div className="pmx-wp-qp__viewbar">
                    <input
                      type="text"
                      className="pmx-wp-text pmx-wp-qp__search"
                      value={snap.qpSearch}
                      placeholder="搜索壁纸标题…"
                      aria-label="搜索壁纸标题"
                      onChange={(e) => store.setQpSearch(e.target.value)}
                    />

                    {/* 多选内容分级 */}
                    <details className="pmx-wp-menu pmx-wp-qp__rating-menu">
                      <summary className="pmx-wp-menu-btn pmx-wp-qp__rating-btn" aria-label="内容分级">
                        <span className="pmx-wp-menu-text">内容分级</span>
                        <span className="pmx-wp-menu-caret" aria-hidden="true">▾</span>
                      </summary>
                      <div className="pmx-wp-menu-list">
                        {RATING_TIER_VALUES.map((r) => (
                          <label
                            key={r}
                            className={
                              "pmx-wp-menu-item" + (ratingSet.has(r) ? " pmx-wp-menu-item--on" : "")
                            }
                          >
                            <input
                              type="checkbox"
                              checked={ratingSet.has(r)}
                              onChange={() => store.toggleRatingFilter(r)}
                            />
                            <span>{RATING_LABELS[r]}</span>
                          </label>
                        ))}
                      </div>
                    </details>

                    {/* 多选类型 */}
                    <details className="pmx-wp-menu pmx-wp-qp__type-menu">
                      <summary className="pmx-wp-menu-btn pmx-wp-qp__type-btn" aria-label="类型">
                        <span className="pmx-wp-menu-text">类型</span>
                        <span className="pmx-wp-menu-caret" aria-hidden="true">▾</span>
                      </summary>
                      <div className="pmx-wp-menu-list">
                        {TYPE_TIER_VALUES.map((t) => (
                          <label
                            key={t}
                            className={
                              "pmx-wp-menu-item" + (typeSet.has(t) ? " pmx-wp-menu-item--on" : "")
                            }
                          >
                            <input
                              type="checkbox"
                              checked={typeSet.has(t)}
                              onChange={() => store.toggleTypeFilter(t)}
                            />
                            <span>{CARD_TYPE_LABELS[t]}</span>
                          </label>
                        ))}
                      </div>
                    </details>

                    {/* 单选方向 */}
                    <details className="pmx-wp-menu pmx-wp-qp__type-menu">
                      <summary className="pmx-wp-menu-btn pmx-wp-qp__type-btn" aria-label="壁纸方向">
                        <span className="pmx-wp-menu-text">方向</span>
                        <span className="pmx-wp-menu-caret" aria-hidden="true">▾</span>
                      </summary>
                      <div className="pmx-wp-menu-list">
                        {(
                          [
                            { id: "all", label: "全部方向" },
                            { id: "landscape", label: "横屏" },
                            { id: "portrait", label: "竖屏" },
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
                              name="pmx-wp-qp-orientation"
                              checked={settings.orientationFilter === opt.id}
                              onChange={() => store.setSetting("orientationFilter", opt.id)}
                            />
                            <span>{opt.label}</span>
                          </label>
                        ))}
                      </div>
                    </details>

                    {/* 列表 / 卡片滑动胶囊切换 */}
                    <div className="pmx-wp-tabs pmx-wp-qp__viewtabs" role="group" aria-label="视图">
                      <span
                        className="pmx-wp-tabs__pill"
                        aria-hidden="true"
                        style={{
                          width: "calc((100% - 6px) / 2)",
                          transform: `translateX(${cardsView ? 100 : 0}%)`,
                        }}
                      />
                      <button
                        type="button"
                        className={
                          "pmx-wp-tabs__tab pmx-wp-qp__viewtab" +
                          (!cardsView ? " pmx-wp-tabs__tab--active" : "")
                        }
                        aria-pressed={!cardsView}
                        onClick={() => store.setUiState("qpView", "list")}
                      >
                        列表
                      </button>
                      <button
                        type="button"
                        className={
                          "pmx-wp-tabs__tab pmx-wp-qp__viewtab" +
                          (cardsView ? " pmx-wp-tabs__tab--active" : "")
                        }
                        aria-pressed={cardsView}
                        onClick={() => store.setUiState("qpView", "cards")}
                      >
                        卡片
                      </button>
                    </div>
                  </div>

                  {/* 未开启高级渲染引擎时点击 Web/Scene 卡片的内联引导横幅 */}
                  {snap.gatedAttempt && !settings.advancedEngineEnabled ? (
                    <div
                      className="pmx-wp-gate-banner"
                      role="alert"
                      data-pmx-engine-gate-banner="1"
                    >
                      <div className="pmx-wp-gate-banner__head">
                        <span className="pmx-wp-gate-banner__title">
                          高级壁纸渲染引擎未开启
                        </span>
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
                          onClick={() =>
                            void handleQuickEnableEngine(snap.gatedAttempt!.wallpaper.id)
                          }
                        >
                          {enablingEngine ? "正在开启…" : "开启高级渲染引擎"}
                        </button>
                        <button
                          type="button"
                          className="pmx-wp-btn pmx-wp-btn--mini"
                          data-pmx-open-engine-settings="1"
                          onClick={() => {
                            if (adapter?.openSettingsSection) {
                              adapter.openSettingsSection("playback");
                            } else {
                              store.setUiState("qpTab", "playback");
                            }
                          }}
                        >
                          前往引擎设置
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {/* 虚拟滚动壁纸列表 / 卡片网格 */}
                  <div
                    ref={listRef}
                    className={
                      "pmx-wp-qp__list" + (cardsView ? " pmx-wp-qp__list--cards" : "")
                    }
                    role="listbox"
                    aria-label="壁纸列表"
                  >
                    {visibleRows.length > 0 ? (
                      <>
                        {vTopH > 0 ? (
                          <div
                            className="pmx-wp-qp__vspacer"
                            style={{ height: `${vTopH}px` }}
                            aria-hidden="true"
                          />
                        ) : null}
                        {visibleRows.map(cardsView ? renderCard : renderListRow)}
                        {vBtmH > 0 ? (
                          <div
                            className="pmx-wp-qp__vspacer"
                            style={{ height: `${vBtmH}px` }}
                            aria-hidden="true"
                          />
                        ) : null}
                      </>
                    ) : (
                      <span className="pmx-wp-hint">
                        {snap.qpSearch.trim()
                          ? `没有匹配「${snap.qpSearch}」的壁纸`
                          : playable.length === 0
                            ? "当前内容分级下没有可播放的壁纸"
                            : "当前筛选条件下没有壁纸"}
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
        )}
      </div>

      {/* ⑤ 底栏：壁纸/播放页仅保留单颗全宽「壁纸引擎设置 ›」；外观与玻璃页额外保留「更多外观设置 ↗」 */}
      <div className="pmx-wp-qp__foot">
        {isAppearanceView ? (
          <button
            type="button"
            className="pmx-wp-btn pmx-wp-qp__settings"
            data-pmx-open-full-appearance="1"
            // oxlint-disable-next-line prismux/no-native-title-tooltip -- standalone @prismux/wallpaper package has no host Tooltip component
            title="打开完整外观设置页（字体、配色与主题快照）"
            onClick={() => adapter?.openSettingsSection?.("appearance")}
          >
            更多外观设置 ↗
          </button>
        ) : null}
        <button
          type="button"
          className="pmx-wp-btn pmx-wp-qp__settings"
          data-pmx-open-wallpaper-settings="1"
          // oxlint-disable-next-line prismux/no-native-title-tooltip -- standalone @prismux/wallpaper package has no host Tooltip component
          title="打开完整壁纸引擎设置页（本地导入 / 画面播放 / 轮播分组 / Steam 目录）"
          onClick={() =>
            adapter?.openSettingsSection?.(effectiveTab === "playback" ? "playback" : "")
          }
        >
          壁纸引擎设置 ›
        </button>
      </div>
    </div>
  );
}
