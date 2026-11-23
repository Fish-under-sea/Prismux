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
import { cardKeyDown, SwitchRow } from "./renderers/controls.js";
import {
  PlaybackAudioSection,
  PlaybackEffectsSection,
} from "./renderers/PlaybackSections.js";
import { UserPropsDrillPanel } from "./renderers/UserPropsDrillPanel.js";
import type { WallpaperStore } from "./store.js";
import {
  computeVirtualWindow,
  filterPlayableWallpapers,
  filterVisibleWallpapers,
  findWallpaperById,
  resolveRotationCandidates,
  useWallpaperStore,
} from "./store.js";
import type {
  AppearanceBridge,
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
  /** @deprecated Appearance controls moved exclusively to /settings/appearance (Issue #3). */
  appearanceBridge?: AppearanceBridge;
  /** @deprecated Appearance controls moved exclusively to /settings/appearance (Issue #3). */
  renderThemeHero?: (ctx: ThemeHeroRenderContext) => ReactNode;
  /** Host layout dock mode: 'official' (fixed-height right sidebar) or 'drawer' (ancestor scrolls). */
  dock?: "official" | "drawer";
  className?: string;
}

type FocusedQuickPanelTabId = Exclude<QuickPanelTabId, "appearance">;

const QP_TABS: readonly { id: FocusedQuickPanelTabId; label: string }[] = [
  { id: "wallpaper", label: "壁纸" },
  { id: "playback", label: "播放" },
];

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

function useQuickPanelVirtualWindow(
  listRef: RefObject<HTMLDivElement | null>,
  count: number,
  itemHeight: number,
  gap: number,
  cardsView: boolean,
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

  const metaRef = useRef({ count, itemHeight, gap, cardsView });
  metaRef.current = { count, itemHeight, gap, cardsView };

  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof window === "undefined") return;

    let rafId = 0;
    let boundScroller: HTMLElement | null = null;

    const measure = () => {
      rafId = 0;
      const meta = metaRef.current;
      let cols = 1;
      if (meta.cardsView) {
        const width = el.clientWidth;
        const firstCard = el.querySelector<HTMLElement>(".pmx-wp-qp__card");
        const cw = firstCard ? firstCard.offsetWidth : 0;
        cols =
          cw > 0
            ? Math.max(1, Math.round((width + meta.gap) / (cw + meta.gap)))
            : Math.max(1, Math.floor((width + meta.gap) / (QP_CARD_MIN + meta.gap)));
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

      const computed = computeVirtualWindow({
        count: meta.count,
        itemHeight: meta.itemHeight,
        gap: meta.gap,
        cols,
        scrollTop,
        viewportHeight,
        overscan: QP_VP_OVERSCAN,
      });

      setWin((prev) =>
        prev.start === computed.start &&
        prev.end === computed.end &&
        prev.cols === computed.cols &&
        prev.cards === meta.cardsView &&
        prev.measured &&
        prev.topSpacerHeight === computed.topSpacerHeight &&
        prev.bottomSpacerHeight === computed.bottomSpacerHeight
          ? prev
          : {
              start: computed.start,
              end: computed.end,
              cols: computed.cols,
              cards: meta.cardsView,
              measured: true,
              topSpacerHeight: computed.topSpacerHeight,
              bottomSpacerHeight: computed.bottomSpacerHeight,
            },
      );
    };

    const schedule = () => {
      if (!rafId) rafId = requestAnimationFrame(measure);
    };

    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    el.scrollTop = 0;
    measure();
    ro?.observe(el);
    window.addEventListener("resize", schedule);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (boundScroller) boundScroller.removeEventListener("scroll", schedule);
      ro?.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [listRef, count, itemHeight, gap, cardsView]);

  return win;
}

function formatTypeMeta(w: WallpaperItem, settings: WallpaperSettingsState): string {
  const live = (w.type === "scene" || w.type === "web") && settings.sceneLive;
  if (w.type === "scene") return live ? "场景 · 实时渲染" : "场景 · 静态帧";
  if (w.type === "web") return live ? "网页 · 实时渲染" : "网页 · 兼容模式";
  return CARD_TYPE_LABELS[w.type] ?? "壁纸";
}

/**
 * Focused Right-sidebar QuickPanel (strictly deduplicated from /settings/appearance per Issue #3):
 *   - Top rotating 40px vinyl card (`clip-path: circle(50%)` + `::after` central ring hole)
 *   - Rotation bar (group select + next + auto-rotation toggle)
 *   - Sliding-pill 2-tab bar (`壁纸 / 播放`)
 *   - In-pane `壁纸属性` drill-down toggle button
 *   - Virtual-scrolled Cards/List library with deterministic 2-row filter bar
 *   - Bottom Audio section & Shared PlaybackSections (`surface="sidebar"`)
 *   - Dual shortcut footer: `外观与玻璃 ›` (/settings/appearance) & `壁纸引擎设置 ›` (/settings/wallpaper)
 */
export function WallpaperQuickPanel({
  store,
  adapter,
  dock = "official",
  className,
}: WallpaperQuickPanelProps) {
  const snap = useWallpaperStore(store);
  const { settings, ui, wallpapers } = snap;
  const listRef = useRef<HTMLDivElement | null>(null);

  const current = useMemo(
    () => findWallpaperById(wallpapers, settings.selectedId),
    [wallpapers, settings.selectedId],
  );

  const playbackLive = Boolean(current && settings.playing && !snap.occluded);
  const resolvedProps = current ? store.getResolvedUserProps(current.id) : [];
  const propsAvailable = Boolean(
    current &&
      (current.type === "scene" ||
        current.type === "web" ||
        resolvedProps.length > 0),
  );

  const playable = useMemo(
    () => filterPlayableWallpapers(wallpapers, settings),
    [wallpapers, settings.hiddenIds, settings.contentRatingFilter],
  );

  const filtered = useMemo(
    () => filterVisibleWallpapers(wallpapers, settings, snap.qpSearch),
    [
      wallpapers,
      settings.hiddenIds,
      settings.contentRatingFilter,
      settings.typeFilter,
      settings.orientationFilter,
      snap.qpSearch,
    ],
  );

  const rotationCandidates = useMemo(
    () => resolveRotationCandidates(wallpapers, settings),
    [wallpapers, settings],
  );

  const cardsView = ui.qpView === "cards";
  const vItemH = cardsView ? QP_CARD_H : QP_ROW_H;
  const vGap = cardsView ? QP_CARD_GAP : QP_ROW_GAP;
  const vwin = useQuickPanelVirtualWindow(listRef, filtered.length, vItemH, vGap, cardsView);

  const isMeasured = vwin.measured && vwin.cards === cardsView && vwin.cols > 0;
  const vStart = isMeasured ? Math.min(vwin.start, filtered.length) : 0;
  const vEnd = isMeasured
    ? Math.max(vStart, Math.min(vwin.end, filtered.length))
    : Math.min(QP_VP_FIRST, filtered.length);
  const visibleRows = filtered.slice(vStart, vEnd);
  const vTopH = isMeasured ? vwin.topSpacerHeight : 0;
  const vBtmH = isMeasured ? vwin.bottomSpacerHeight : 0;

  const effectiveTab: FocusedQuickPanelTabId = ui.qpTab === "playback" ? "playback" : "wallpaper";
  const tabIdx = Math.max(0, QP_TABS.findIndex((t) => t.id === effectiveTab));
  const showPropsDrill = effectiveTab === "wallpaper" && snap.propsPanelOpen && propsAvailable;

  const handleCardPointer = (w: WallpaperItem, immediate: boolean) => {
    if (w.type === "video" && w.mediaUrl) {
      schedulePrewarmVideo(w.mediaUrl, immediate);
    }
  };

  const renderCard = (w: WallpaperItem) => {
    const isCurrent = w.id === settings.selectedId;
    return (
      <div
        key={w.id}
        data-pmx-wp-id={w.id}
        className={"pmx-wp-qp__card" + (isCurrent ? " pmx-wp-qp__card--current" : "")}
        role="option"
        tabIndex={0}
        aria-selected={isCurrent}
        title={w.title}
        onPointerOver={() => handleCardPointer(w, false)}
        onPointerDown={() => handleCardPointer(w, true)}
        onClick={() => store.selectWallpaper(w.id)}
        onKeyDown={cardKeyDown}
      >
        {w.previewUrl ? (
          <img
            src={w.previewUrl}
            alt=""
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
            onLoad={(e) => {
              e.currentTarget.style.opacity = "1";
            }}
          />
        ) : (
          <span className="pmx-wp-qp__card-empty">无预览</span>
        )}
        <span className="pmx-wp-qp__card-type">{CARD_TYPE_LABELS[w.type]}</span>
        {isCurrent ? <span className="pmx-wp-qp__card-badge">当前</span> : null}
        <span className="pmx-wp-qp__card-title">{w.title}</span>
      </div>
    );
  };

  const renderListRow = (w: WallpaperItem) => {
    const isCurrent = w.id === settings.selectedId;
    return (
      <div
        key={w.id}
        data-pmx-wp-id={w.id}
        className={"pmx-wp-qp__item" + (isCurrent ? " pmx-wp-qp__item--current" : "")}
        role="option"
        tabIndex={0}
        aria-selected={isCurrent}
        title={w.title}
        onPointerOver={() => handleCardPointer(w, false)}
        onPointerDown={() => handleCardPointer(w, true)}
        onClick={() => store.selectWallpaper(w.id)}
        onKeyDown={cardKeyDown}
      >
        <span className="pmx-wp-qp__item-thumb">
          {w.previewUrl ? (
            <img
              src={w.previewUrl}
              alt=""
              loading="lazy"
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
              onLoad={(e) => {
                e.currentTarget.style.opacity = "1";
              }}
            />
          ) : null}
        </span>
        <span className="pmx-wp-qp__item-title">{w.title}</span>
        {isCurrent ? (
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
        `pmx-wp-qp pmx-wp-qp--${dock}` + (className ? ` ${className}` : "")
      }
      data-pmx-quick-panel="1"
    >
      {/* ① 当前壁纸顶卡（旋转黑胶圆盘 + 播放/刷新/清除） */}
      <div
        className={
          "pmx-wp-qp__current" + (playbackLive ? " pmx-wp-qp__current--playing" : "")
        }
      >
        <span className="pmx-wp-qp__thumb">
          {current?.previewUrl ? (
            <img
              src={current.previewUrl}
              alt=""
              loading="lazy"
              onLoad={(e) => {
                e.currentTarget.style.opacity = "1";
              }}
            />
          ) : null}
        </span>
        <div className="pmx-wp-qp__current-info">
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
            title="重新扫描 Steam Workshop 431960 与本地自定义壁纸库"
            onClick={() => void store.refreshLibrary(adapter, true)}
          >
            {snap.loading ? "刷新中…" : "刷新"}
          </button>
          <button
            type="button"
            className="pmx-wp-btn"
            disabled={!current}
            title="清除当前壁纸，回到无壁纸状态"
            onClick={() => store.clearWallpaper()}
          >
            清除
          </button>
        </div>
      </div>

      {/* ② 轮播条（常驻：分组下拉 + 下一张 + 自动轮播） */}
      <div className="pmx-wp-qp__section">
        <div className="pmx-wp-qp__row">
          <select
            className="pmx-wp-select pmx-wp-qp__group"
            value={settings.rotationGroupId}
            disabled={settings.rotationGroups.length === 0}
            aria-label="轮播列表"
            onChange={(e) => store.setSetting("rotationGroupId", e.target.value)}
          >
            <option value="">
              {settings.rotationGroups.length > 0 ? "— 选择轮播列表 —" : "— 暂无轮播列表 —"}
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
      </div>

      {/* ③ 滑动胶囊双档页签（壁纸 / 播放） */}
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
            className={
              "pmx-wp-tabs__tab" + (effectiveTab === t.id ? " pmx-wp-tabs__tab--active" : "")
            }
            onClick={() => store.setUiState("qpTab", t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ③b 壁纸属性页内下钻开关按钮 */}
      {propsAvailable ? (
        <button
          type="button"
          className={
            "pmx-wp-btn pmx-wp-qp__propsbtn" + (snap.propsPanelOpen ? " is-on" : "")
          }
          aria-expanded={snap.propsPanelOpen}
          title="调节壁纸作者提供的自定义属性（改动立即生效）"
          onClick={() => {
            if (effectiveTab === "wallpaper") {
              store.setPropsPanelOpen(!snap.propsPanelOpen);
            } else {
              store.setUiState("qpTab", "wallpaper");
              store.setPropsPanelOpen(true);
            }
          }}
        >
          {snap.propsPanelOpen ? "收起壁纸属性" : "壁纸属性"}
        </button>
      ) : null}

      {/* ④ 主内容区（含滚动链隔离 overscroll-behavior: contain） */}
      <div
        className={
          "pmx-wp-qp__tabbody" +
          (effectiveTab === "wallpaper" ? " pmx-wp-qp__tabbody--library" : "")
        }
      >
        {showPropsDrill ? (
          <div className="pmx-wp-qp__propsview pmx-wp-qp__propsview--drill">
            <UserPropsDrillPanel store={store} adapter={adapter} />
          </div>
        ) : effectiveTab === "playback" ? (
          <>
            <PlaybackEffectsSection
              store={store}
              surface="sidebar"
              onPickWallpaper={() => store.setUiState("qpTab", "wallpaper")}
            />
            <PlaybackAudioSection store={store} />
          </>
        ) : (
          <>
            {/* 壁纸库（搜索 + 分级/类型/方向筛选 + 列表/卡片切换 + 虚拟滚动列表） */}
            <div className="pmx-wp-qp__section pmx-wp-qp__library">
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

            {/* 底部声音节（与播放页同源渲染器） */}
            <div className="pmx-wp-qp__section">
              <PlaybackAudioSection store={store} />
            </div>
          </>
        )}
      </div>

      {/* ⑤ 双并列深链底栏（外观与玻璃 + 壁纸引擎设置） */}
      <div className="pmx-wp-qp__foot">
        <button
          type="button"
          className="pmx-wp-btn pmx-wp-qp__settings"
          title="打开设置页「外观」分区（主题胶囊、液态玻璃、侧边栏圆角、全局配色与字体）"
          onClick={() => adapter?.openSettingsSection?.("appearance")}
        >
          外观与玻璃 ›
        </button>
        <button
          type="button"
          className="pmx-wp-btn pmx-wp-qp__settings"
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
