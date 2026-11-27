import { deadlineStore } from "@prismux/client-runtime/clock";
import {
  MinusIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SkipBackIcon,
  StepBackIcon,
  StepForwardIcon,
  XIcon,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";

import { observeResize } from "~/lib/observeResize";
import { AgentBrandLogo, renderBundledBrandSvg } from "../agentBrand";
import {
  formatAuxPostsOverDuration,
  formatAuxReplayProgress,
  formatAuxWaitingOn,
  getAuxStrings,
} from "./agentAux.i18n";
import {
  computeHiveLayout,
  computeMentionGraphLayout,
  computeReplayDelayMs,
  formatAuxClockTime,
  formatAuxStatusLabel,
  HIVE_LIVE_BEAM_FRESH_MS,
  type AgentAuxViewModel,
  type ReplayPacingMode,
} from "./agentAux.logic";
import { AgentAuxMarkdown } from "./AgentAuxMarkdown";
import { getBeeSpriteDataUrl, SwarmBeeSprite, toPixelBeeState } from "./SwarmBeeSprite";

export interface AgentAuxGraphTabProps {
  readonly model: AgentAuxViewModel;
  readonly onJumpSeq: (seq: number) => void;
  readonly onOpenMemberPosts: (name: string) => void;
}

const SPEED_OPTIONS = [0.5, 1, 2, 4, 8] as const;
const LIVE_MENTION_PULSE_MS = 1_600;

function useDeadlinePassed(deadlineMs: number | null): boolean {
  const store = deadlineStore(deadlineMs);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

interface OneShotMotionDotProps {
  readonly pathD: string;
  readonly endX: number;
  readonly endY: number;
  readonly r: number;
  readonly dur: string;
  readonly durMs: number;
  readonly className: string;
  readonly reducedMotion: boolean;
}

/**
 * 1:1 AGY one-shot travelling dot (`hive.js:1282-1284` & `app.js:1634-1639`):
 * flies exactly once via `repeatCount="1"` + `fill="freeze"` triggered by `beginElement()`,
 * then settles statically at `(endX, endY)` so pausing, zooming, or re-rendering never restarts it.
 */
function OneShotMotionDot({
  pathD,
  endX,
  endY,
  r,
  dur,
  durMs,
  className,
  reducedMotion,
}: OneShotMotionDotProps) {
  const circleRef = useRef<SVGCircleElement | null>(null);
  const motionRef = useRef<SVGElement | null>(null);
  const [settled, setSettled] = useState(reducedMotion);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- triggers SMIL beginElement() once on mount and swaps to a static end dot after the single flight completes
  useEffect(() => {
    if (reducedMotion || settled) return;
    const motionEl = motionRef.current as (SVGElement & { beginElement?: () => void }) | null;
    const circleEl = circleRef.current;
    let rafId = 0;
    if (motionEl && typeof motionEl.beginElement === "function") {
      if (circleEl) circleEl.style.opacity = "0";
      motionEl.beginElement();
      rafId = window.requestAnimationFrame(() => {
        if (circleEl) circleEl.style.opacity = "";
      });
    }
    const timer = window.setTimeout(() => {
      setSettled(true);
    }, durMs + 60);
    return () => {
      if (rafId !== 0) window.cancelAnimationFrame(rafId);
      window.clearTimeout(timer);
    };
  }, [reducedMotion, settled, durMs]);

  if (reducedMotion || settled) {
    return <circle cx={endX} cy={endY} r={r} className={className} data-motion-dot="settled" />;
  }

  return (
    <circle ref={circleRef} r={r} className={className} data-motion-dot="flying">
      <animateMotion
        ref={motionRef}
        dur={dur}
        repeatCount="1"
        begin="indefinite"
        fill="freeze"
        calcMode="spline"
        keyTimes="0;1"
        keySplines="0.3 0 0.2 1"
        path={pathD}
      />
    </circle>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined") return false;
    const rootReduced =
      typeof document !== "undefined" &&
      document.documentElement?.dataset?.pmxReducedMotion === "1";
    const mqReduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return rootReduced || mqReduced;
  });

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- subscribes to browser prefers-reduced-motion MediaQueryList changes
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      const rootReduced =
        typeof document !== "undefined" &&
        document.documentElement?.dataset?.pmxReducedMotion === "1";
      setReduced(rootReduced || mq.matches);
    };
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);

  return reduced;
}

export const AgentAuxGraphTab = memo(function AgentAuxGraphTab({
  model,
  onJumpSeq,
  onOpenMemberPosts,
}: AgentAuxGraphTabProps) {
  const s = getAuxStrings(model.locale);
  const reducedMotion = usePrefersReducedMotion();
  const graphIdPrefix = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  const [graphMode, setGraphMode] = useState<"hive" | "mentions">("hive");
  const [replaySeq, setReplaySeq] = useState<number | null>(null);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayPacing, setReplayPacing] = useState<ReplayPacingMode>("even");
  const [replaySpeed, setReplaySpeed] = useState<(typeof SPEED_OPTIONS)[number]>(1);
  const [hideInactive, setHideInactive] = useState(false);
  const [expandAll, setExpandAll] = useState(false);
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [selectedMentionNode, setSelectedMentionNode] = useState<string | null>(null);

  // Zoom & Pan state for Hive stage
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const dragRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageWidth, setStageWidth] = useState(360);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- tracks responsive graph stage container width via observeResize
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => {
      if (el.clientWidth > 0) setStageWidth(el.clientWidth);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    return observeResize(el, update);
  }, []);

  const replayableMessages = useMemo(
    () => model.messages.filter((m) => !m.isControl),
    [model.messages],
  );

  const knownNames = useMemo(() => new Set(model.members.map((m) => m.name)), [model.members]);
  const memberByName = useMemo(
    () => new Map(model.members.map((m) => [m.name, m])),
    [model.members],
  );

  const totalPosts = replayableMessages.length;
  const currentReplayIdx = useMemo(() => {
    if (totalPosts === 0) return -1;
    if (replaySeq === null) return totalPosts - 1;
    const exact = replayableMessages.findIndex((m) => m.seq === replaySeq);
    if (exact >= 0) return exact;
    let best = 0;
    for (let i = 0; i < totalPosts; i += 1) {
      if ((replayableMessages[i]?.seq ?? 0) <= replaySeq) best = i;
    }
    return best;
  }, [replayableMessages, replaySeq, totalPosts]);

  const currentReplayMsg =
    currentReplayIdx >= 0 ? (replayableMessages[currentReplayIdx] ?? null) : null;

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- drives variable-delay historical timeline replay setTimeout loop
  useEffect(() => {
    if (!isReplaying || totalPosts === 0) return;
    const curIdx = replaySeq === null ? -1 : currentReplayIdx;
    const nextIdx = curIdx + 1;
    const delayMs = computeReplayDelayMs(replayableMessages, nextIdx, replayPacing, replaySpeed);
    const timer = window.setTimeout(() => {
      if (nextIdx >= totalPosts) {
        setReplaySeq(null);
        setIsReplaying(false);
        return;
      }
      const nextMsg = replayableMessages[nextIdx];
      if (!nextMsg) {
        setReplaySeq(null);
        setIsReplaying(false);
      } else {
        setReplaySeq(nextMsg.seq);
      }
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [
    isReplaying,
    replaySeq,
    currentReplayIdx,
    totalPosts,
    replayableMessages,
    replayPacing,
    replaySpeed,
  ]);

  const totalSpanMs = useMemo(() => {
    const firstTs = replayableMessages[0]?.ts;
    const lastTs = replayableMessages.at(-1)?.ts;
    if (firstTs != null && lastTs != null && lastTs > firstTs) {
      return lastTs - firstTs;
    }
    return null;
  }, [replayableMessages]);

  const replayDeltaMs = useMemo(() => {
    const firstTs = replayableMessages[0]?.ts;
    const curTs = currentReplayMsg?.ts;
    if (firstTs != null && curTs != null && curTs >= firstTs) {
      return curTs - firstTs;
    }
    return null;
  }, [replayableMessages, currentReplayMsg]);

  const stepToIndex = useCallback(
    (idx: number) => {
      if (totalPosts === 0) return;
      setIsReplaying(false);
      const clamped = Math.max(0, Math.min(totalPosts - 1, idx));
      if (clamped === totalPosts - 1) {
        setReplaySeq(null);
      } else {
        setReplaySeq(replayableMessages[clamped]?.seq ?? null);
      }
    },
    [replayableMessages, totalPosts],
  );

  const handleTogglePlay = useCallback(() => {
    if (totalPosts === 0) return;
    if (isReplaying) {
      setIsReplaying(false);
      return;
    }
    if (replaySeq === null || currentReplayIdx >= totalPosts - 1) {
      setReplaySeq(replayableMessages[0]?.seq ?? null);
    }
    setIsReplaying(true);
  }, [isReplaying, replaySeq, currentReplayIdx, totalPosts, replayableMessages]);

  const handlePlayerKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
      return;
    }
    if (e.key === " ") {
      e.preventDefault();
      handleTogglePlay();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      stepToIndex(currentReplayIdx - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      stepToIndex(currentReplayIdx + 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      stepToIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setIsReplaying(false);
      setReplaySeq(null);
    }
  };

  const isSessionSettled = model.finished || !model.hasLiveActivity;
  const isReplayPaused = replaySeq !== null && !isReplaying;
  const isGraphMotionPaused =
    reducedMotion || isReplayPaused || (replaySeq === null && isSessionSettled);

  // Single-shot deadline timers (zero polling) for AGY 90s Hive beam expiry & 1.6s live Mentions pulse.
  const latestLiveMsg =
    replaySeq === null && !isSessionSettled ? (replayableMessages.at(-1) ?? null) : null;
  const trail1LiveMsg =
    replaySeq === null && !isSessionSettled && replayableMessages.length >= 2
      ? (replayableMessages.at(-2) ?? null)
      : null;
  const trail2LiveMsg =
    replaySeq === null && !isSessionSettled && replayableMessages.length >= 3
      ? (replayableMessages.at(-3) ?? null)
      : null;

  const latestBeamDeadlineMs =
    latestLiveMsg && latestLiveMsg.ts !== null && Number.isFinite(latestLiveMsg.ts)
      ? latestLiveMsg.ts + HIVE_LIVE_BEAM_FRESH_MS
      : null;
  const trail1BeamDeadlineMs =
    trail1LiveMsg && trail1LiveMsg.ts !== null && Number.isFinite(trail1LiveMsg.ts)
      ? trail1LiveMsg.ts + HIVE_LIVE_BEAM_FRESH_MS
      : null;
  const trail2BeamDeadlineMs =
    trail2LiveMsg && trail2LiveMsg.ts !== null && Number.isFinite(trail2LiveMsg.ts)
      ? trail2LiveMsg.ts + HIVE_LIVE_BEAM_FRESH_MS
      : null;
  const livePulseDeadlineMs =
    latestLiveMsg && latestLiveMsg.ts !== null && Number.isFinite(latestLiveMsg.ts)
      ? latestLiveMsg.ts + LIVE_MENTION_PULSE_MS
      : null;

  const isLatestBeamExpired = useDeadlinePassed(latestBeamDeadlineMs);
  const isTrail1BeamExpired = useDeadlinePassed(trail1BeamDeadlineMs);
  const isTrail2BeamExpired = useDeadlinePassed(trail2BeamDeadlineMs);
  const isLivePulseExpired = useDeadlinePassed(livePulseDeadlineMs);

  let effectiveLiveNowMs: number | undefined;
  if (latestBeamDeadlineMs !== null) {
    let now = latestLiveMsg?.ts ?? latestBeamDeadlineMs;
    if (isTrail2BeamExpired && trail2BeamDeadlineMs !== null) {
      now = Math.max(now, trail2BeamDeadlineMs);
    }
    if (isTrail1BeamExpired && trail1BeamDeadlineMs !== null) {
      now = Math.max(now, trail1BeamDeadlineMs);
    }
    if (isLatestBeamExpired) {
      now = Math.max(now, latestBeamDeadlineMs);
    }
    effectiveLiveNowMs = now;
  }

  const livePulseMsg =
    replaySeq === null && !isSessionSettled && !reducedMotion && !isLivePulseExpired
      ? latestLiveMsg
      : null;

  const hiveLayout = useMemo(
    () =>
      computeHiveLayout({
        model,
        containerWidth: stageWidth,
        replaySeq,
        hideInactive,
        zoom,
        selectedCellId,
        ...(effectiveLiveNowMs !== undefined ? { nowMs: effectiveLiveNowMs } : {}),
      }),
    [model, stageWidth, replaySeq, hideInactive, zoom, selectedCellId, effectiveLiveNowMs],
  );

  const mentionLayout = useMemo(
    () =>
      computeMentionGraphLayout({
        model,
        width: stageWidth,
        replaySeq,
        hideInactive,
        expandAll,
      }),
    [model, stageWidth, replaySeq, hideInactive, expandAll],
  );

  const selectedCell = useMemo(
    () => hiveLayout.cells.find((c) => c.id === selectedCellId) ?? null,
    [hiveLayout.cells, selectedCellId],
  );

  const handleZoomOut = () => {
    setZoom((z) => {
      const next = Math.max(1, Number((z - 0.35).toFixed(2)));
      if (next <= 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handleZoomIn = () => {
    setZoom((z) => Math.min(hiveLayout.maxZoom, Number((z + 0.35).toFixed(2))));
  };

  const handleZoomFit = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleStageWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.2 : -0.2;
    setZoom((z) => {
      const next = Math.max(1, Math.min(hiveLayout.maxZoom, Number((z + delta).toFixed(2))));
      if (next <= 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (zoom <= 1) return;
    if ((e.target as HTMLElement).closest("button")) return;
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origX: pan.x,
      origY: pan.y,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag?.active) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const maxOffset = Math.max(40, (hiveLayout.width - stageWidth) / 2 + 80);
    setPan({
      x: Math.max(-maxOffset, Math.min(maxOffset, drag.origX + dx)),
      y: Math.max(-180, Math.min(180, drag.origY + dy)),
    });
  };

  const handlePointerUp = () => {
    if (dragRef.current) dragRef.current.active = false;
  };

  const sliderMax = Math.max(0, totalPosts - 1);
  const sliderVal = currentReplayIdx >= 0 ? currentReplayIdx : sliderMax;
  const sliderPct = sliderMax > 0 ? Math.round((sliderVal / sliderMax) * 100) : 100;
  const isAtLiveHead = replaySeq === null && !isReplaying;
  const isLiveActive = isAtLiveHead && !isSessionSettled;
  const isLiveSettled = isAtLiveHead && isSessionSettled;
  const livePillLabel = isLiveSettled
    ? model.finished
      ? s.headerCompleted
      : s.headerIdle
    : s.graphReplayLive;

  const progressSummaryText =
    replaySeq === null || !currentReplayMsg
      ? formatAuxPostsOverDuration(totalPosts, totalSpanMs, model.locale)
      : formatAuxReplayProgress(
          currentReplayIdx + 1,
          totalPosts,
          currentReplayMsg.seq,
          formatAuxClockTime(currentReplayMsg.ts, currentReplayMsg.time),
          replayDeltaMs,
          model.locale,
        );

  return (
    <div
      className={`pmx-aux-graph-root${isGraphMotionPaused ? " pmx-aux-graph--paused" : ""}`}
      data-aux-section="graph"
      data-graph-motion={isGraphMotionPaused ? "paused" : "active"}
      data-session-settled={isSessionSettled ? "1" : "0"}
      tabIndex={-1}
      onKeyDown={handlePlayerKeyDown}
    >
      {/* 2-Row Replay Player & Controls (1:1 Fig 3) */}
      <div className="pmx-aux-player" data-testid="aux-replay-player">
        {/* Row 1: Transport + Scrubber + Live Pill */}
        <div className="pmx-aux-player-row">
          <button
            type="button"
            className="pmx-aux-icon-btn"
            disabled={totalPosts === 0}
            aria-label={s.graphReplayStart}
            title={s.graphReplayStart}
            onClick={() => stepToIndex(0)}
          >
            <SkipBackIcon className="size-3.5" />
          </button>
          <button
            type="button"
            className="pmx-aux-icon-btn"
            disabled={totalPosts === 0 || currentReplayIdx <= 0}
            aria-label={s.graphReplayPrev}
            title={s.graphReplayPrev}
            onClick={() => stepToIndex(currentReplayIdx - 1)}
          >
            <StepBackIcon className="size-3.5" />
          </button>
          <button
            type="button"
            className="pmx-aux-icon-btn pmx-aux-play-btn"
            disabled={totalPosts === 0}
            aria-label={isReplaying ? s.graphReplayPause : s.graphReplayPlay}
            title={isReplaying ? s.graphReplayPause : s.graphReplayPlay}
            onClick={handleTogglePlay}
          >
            {isReplaying ? <PauseIcon className="size-3.5" /> : <PlayIcon className="size-3.5" />}
          </button>
          <button
            type="button"
            className="pmx-aux-icon-btn"
            disabled={totalPosts === 0 || replaySeq === null}
            aria-label={s.graphReplayNext}
            title={s.graphReplayNext}
            onClick={() => stepToIndex(currentReplayIdx + 1)}
          >
            <StepForwardIcon className="size-3.5" />
          </button>

          <input
            type="range"
            className="pmx-aux-slider"
            min={0}
            max={sliderMax}
            value={sliderVal}
            disabled={totalPosts <= 1}
            aria-label={s.graphReplaySliderAria}
            style={{ "--pmx-slider-pct": `${sliderPct}%` } as CSSProperties}
            onChange={(e) => stepToIndex(Number.parseInt(e.target.value, 10))}
          />

          <button
            type="button"
            className={[
              "pmx-aux-live-pill",
              isLiveActive ? "pmx-aux-live-pill--on" : "",
              isLiveSettled ? "pmx-aux-live-pill--settled" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            data-live-state={isLiveActive ? "live" : isLiveSettled ? "settled" : "replay"}
            aria-pressed={isAtLiveHead}
            onClick={() => {
              setIsReplaying(false);
              setReplaySeq(null);
            }}
          >
            <i className="pmx-aux-live-pill-dot" aria-hidden="true" />
            <span>{livePillLabel}</span>
          </button>
        </div>

        {/* Row 2: Post/Duration counter + Segmented Switch + Pacing + Speed */}
        <div className="pmx-aux-player-row pmx-aux-player-row--meta">
          <span className="pmx-aux-player-stat" data-testid="aux-replay-stat">
            {progressSummaryText}
          </span>

          <div className="pmx-aux-player-controls">
            <div className="pmx-aux-segmented" role="group" aria-label={s.graphModeAria}>
              <button
                type="button"
                className={graphMode === "hive" ? "pmx-aux-seg-on" : ""}
                aria-pressed={graphMode === "hive"}
                onClick={() => setGraphMode("hive")}
              >
                {s.graphModeHive}
              </button>
              <button
                type="button"
                className={graphMode === "mentions" ? "pmx-aux-seg-on" : ""}
                aria-pressed={graphMode === "mentions"}
                onClick={() => setGraphMode("mentions")}
              >
                {s.graphModeMentions}
              </button>
            </div>

            <select
              className="pmx-aux-select pmx-aux-select--compact"
              value={replayPacing}
              aria-label={s.graphPacingAria}
              onChange={(e) => setReplayPacing(e.target.value as ReplayPacingMode)}
            >
              <option value="even">{s.graphPacingEven}</option>
              <option value="real">{s.graphPacingReal}</option>
            </select>

            <select
              className="pmx-aux-select pmx-aux-select--compact"
              value={String(replaySpeed)}
              aria-label={s.graphSpeedAria}
              onChange={(e) =>
                setReplaySpeed(Number(e.target.value) as (typeof SPEED_OPTIONS)[number])
              }
            >
              {SPEED_OPTIONS.map((sp) => (
                <option key={sp} value={String(sp)}>
                  {sp}×
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Mentions-specific toggles */}
        {graphMode === "mentions" ? (
          <div className="pmx-aux-player-row pmx-aux-player-row--switches">
            <label className="pmx-aux-switch">
              <input
                type="checkbox"
                checked={hideInactive}
                onChange={(e) => setHideInactive(e.target.checked)}
              />
              <span>{s.graphHideInactive}</span>
            </label>
            <label className="pmx-aux-switch">
              <input
                type="checkbox"
                checked={expandAll}
                onChange={(e) => setExpandAll(e.target.checked)}
              />
              <span>{s.graphExpandAll}</span>
            </label>
          </div>
        ) : null}
      </div>

      {/* Stage Container */}
      <div
        ref={stageRef}
        className="pmx-aux-graph-stage-wrap"
        onWheel={graphMode === "hive" ? handleStageWheel : undefined}
      >
        {graphMode === "hive" ? (
          /* ============================================================= */
          /* HIVE VIEW (1:1 AGY Fig 3)                                     */
          /* ============================================================= */
          <div
            className={`pmx-aux-hv-stage${zoom > 1 ? " pmx-aux-hv-stage--zoomed" : ""}`}
            data-hive-stage="1"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {/* Floating Zoom Controls */}
            {hiveLayout.maxZoom > 1.05 ? (
              <div className="pmx-aux-hv-zoom">
                <button
                  type="button"
                  disabled={zoom <= 1}
                  aria-label={s.graphZoomOut}
                  title={s.graphZoomOut}
                  onClick={handleZoomOut}
                >
                  <MinusIcon className="size-3" />
                </button>
                <button
                  type="button"
                  disabled={zoom >= hiveLayout.maxZoom}
                  aria-label={s.graphZoomIn}
                  title={s.graphZoomIn}
                  onClick={handleZoomIn}
                >
                  <PlusIcon className="size-3" />
                </button>
                {zoom > 1 ? (
                  <button type="button" className="pmx-aux-hv-zoom-fit" onClick={handleZoomFit}>
                    {s.graphZoomFit}
                  </button>
                ) : null}
              </div>
            ) : null}

            {/* Pannable Canvas Layer */}
            <div
              className="pmx-aux-hv-canvas"
              style={{
                width: `${hiveLayout.width}px`,
                height: `${hiveLayout.height}px`,
                transform: zoom > 1 ? `translate(${pan.x}px, ${pan.y}px)` : undefined,
              }}
            >
              <svg
                className="pmx-aux-hv-svg"
                width={hiveLayout.width}
                height={hiveLayout.height}
                viewBox={`0 0 ${hiveLayout.width} ${hiveLayout.height}`}
                role="img"
                aria-label={s.graphHiveAria}
              >
                {/* Layer 1: Hex Cells + Green Progress Rings */}
                {hiveLayout.cells.map((cell) => {
                  const isSelected = selectedCellId === cell.id;
                  const K = Math.sqrt(3) / 2;
                  const titleY = cell.isHub
                    ? hiveLayout.mode === "full"
                      ? cell.cy + cell.radius * 0.44
                      : cell.cy + cell.radius * 0.46
                    : cell.cy - K * cell.radius + (hiveLayout.mode === "tiny" ? 13 : 20);
                  const subY = cell.isHub
                    ? titleY + 14
                    : titleY + (hiveLayout.mode === "tiny" ? 11 : 13);
                  const maxChars = Math.max(
                    6,
                    Math.floor((cell.radius * (hiveLayout.mode === "tiny" ? 1.2 : 1.35)) / 7),
                  );
                  const shortTitle =
                    cell.title.length > maxChars
                      ? `${cell.title.slice(0, maxChars - 1)}…`
                      : cell.title;

                  return (
                    <g
                      key={cell.id}
                      className="pmx-aux-hv-cell-g"
                      data-hive-cell={cell.id}
                      onClick={() =>
                        setSelectedCellId((prev) => (prev === cell.id ? null : cell.id))
                      }
                    >
                      <path
                        d={cell.pathD}
                        className={[
                          "pmx-aux-hv-cell",
                          cell.isHub ? "pmx-aux-hv-cell--hub" : "",
                          cell.isAcpDelegated ? "pmx-aux-hv-cell--acp" : "",
                          cell.aggregateState ? `pmx-aux-hv-cell--${cell.aggregateState}` : "",
                          isSelected ? "pmx-aux-hv-cell--sel" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      />

                      {cell.progressFraction > 0 ? (
                        <path
                          d={cell.progPathD}
                          pathLength={100}
                          strokeDasharray={`${Math.min(100, Math.round(cell.progressFraction * 100))} 100`}
                          className="pmx-aux-hv-prog"
                        />
                      ) : null}

                      {isSelected ? (
                        <path d={cell.selPathD} className="pmx-aux-hv-sel-ring" />
                      ) : null}

                      <text
                        x={cell.cx}
                        y={titleY}
                        textAnchor="middle"
                        className={`pmx-aux-hv-title${cell.isHub ? " pmx-aux-hv-title--hub" : ""}`}
                      >
                        {shortTitle}
                      </text>

                      {cell.isHub ? (
                        <text
                          x={cell.cx}
                          y={subY}
                          textAnchor="middle"
                          className={`pmx-aux-hv-sub${hiveLayout.hubNeedsYou ? " pmx-aux-hv-sub--warn" : ""}`}
                        >
                          {hiveLayout.hubSubtitle}
                        </text>
                      ) : cell.total > 0 ? (
                        <text x={cell.cx} y={subY} textAnchor="middle" className="pmx-aux-hv-sub">
                          {cell.done}/{cell.total}
                        </text>
                      ) : null}

                      {cell.overflowCount > 0 ? (
                        <text
                          x={cell.overflowX}
                          y={cell.overflowY + 4}
                          textAnchor="middle"
                          className="pmx-aux-hv-more"
                        >
                          +{cell.overflowCount}
                        </text>
                      ) : null}
                    </g>
                  );
                })}

                {/* Layer 2: Waiting-on Dashed Marching Arrows & One-Shot Message Beams */}
                {hiveLayout.beams.map((beam) => {
                  if (beam.kind === "wait") {
                    return (
                      <g key={beam.id} className="pmx-aux-hv-wait-g">
                        <path
                          d={beam.pathD}
                          className={
                            isGraphMotionPaused
                              ? "pmx-aux-hv-wait pmx-aux-hv-wait--paused"
                              : "pmx-aux-hv-wait"
                          }
                        />
                        {beam.arrowPathD ? (
                          <path d={beam.arrowPathD} className="pmx-aux-hv-wait-head" />
                        ) : null}
                      </g>
                    );
                  }
                  const dotKey = `${replaySeq === null ? "live" : "replay"}:${beam.id}`;
                  return (
                    <g key={beam.id} className="pmx-aux-hv-beam-g">
                      <path
                        d={beam.pathD}
                        className={
                          beam.isTrail
                            ? "pmx-aux-hv-beam pmx-aux-hv-beam--trail"
                            : reducedMotion
                              ? "pmx-aux-hv-beam"
                              : "pmx-aux-hv-beam pmx-aux-hv-beam--fresh"
                        }
                      />
                      {!beam.isTrail ? (
                        <OneShotMotionDot
                          key={dotKey}
                          pathD={beam.pathD}
                          endX={beam.x2}
                          endY={beam.y2}
                          r={3}
                          dur="0.7s"
                          durMs={700}
                          className="pmx-aux-hv-beam-dot"
                          reducedMotion={reducedMotion}
                        />
                      ) : null}
                    </g>
                  );
                })}
              </svg>

              {/* Layer 3: Crisp Pixel Bees & Pure Transparent Brand Logos Overlay */}
              {hiveLayout.bees
                .filter((b) => !b.tucked && b.replayState !== "unborn")
                .map((bee) => {
                  const scale: 1 | 2 | 3 = bee.size === "lg" ? 2 : bee.size === "sm" ? 1 : 1;
                  const useBeeSprite = model.useBees && bee.sourceKind !== "acp-delegated";
                  const tooltip = `@${bee.name} · ${formatAuxStatusLabel(bee.state, bee.waitingOn, model.locale)}`;
                  const isBeeWorkingAnimated =
                    !isGraphMotionPaused && bee.replayState === "working";

                  return (
                    <button
                      key={bee.name}
                      type="button"
                      title={tooltip}
                      aria-label={tooltip}
                      data-hive-bee={bee.name}
                      data-hive-x={bee.x.toFixed(1)}
                      data-hive-y={bee.y.toFixed(1)}
                      className={[
                        "pmx-aux-hv-bee",
                        replaySeq !== null && !reducedMotion ? "pmx-aux-hv-bee--replay" : "",
                        isBeeWorkingAnimated ? "pmx-aux-hv-bee--working" : "",
                        bee.replayState === "retired" ? "pmx-aux-hv-bee--retired" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={{
                        left: `${bee.x.toFixed(1)}px`,
                        top: `${bee.y.toFixed(1)}px`,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenMemberPosts(bee.name);
                      }}
                    >
                      {useBeeSprite ? (
                        <SwarmBeeSprite
                          name={bee.name}
                          state={toPixelBeeState(bee.state)}
                          scale={scale}
                          paused={isGraphMotionPaused}
                        />
                      ) : (
                        <span
                          className={`pmx-aux-hv-brand-bare pmx-aux-hv-brand-bare--${bee.size}`}
                          data-hive-brand={bee.providerBrand}
                          data-hive-bare="1"
                        >
                          <AgentBrandLogo
                            provider={bee.providerBrand}
                            size={bee.size === "lg" ? 26 : bee.size === "sm" ? 18 : 15}
                            online={bee.replayState !== "retired"}
                            breathing={isBeeWorkingAnimated}
                          />
                        </span>
                      )}
                      {hiveLayout.showNames && !bee.isQueen ? (
                        <span className="pmx-aux-hv-bee-name">{bee.name}</span>
                      ) : null}
                    </button>
                  );
                })}
            </div>
          </div>
        ) : (
          /* ============================================================= */
          /* MENTIONS GRAPH VIEW (1:1 AGY app.js)                          */
          /* ============================================================= */
          <svg
            className="pmx-aux-graph-svg"
            data-mentions-stage="1"
            viewBox={`0 0 ${mentionLayout.width} ${mentionLayout.height}`}
            role="img"
            aria-label={s.graphMentionsAria}
            onClick={() => setSelectedMentionNode(null)}
          >
            <defs>
              <marker
                id="pmx-aux-arr"
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="5"
                markerHeight="5"
                orient="auto"
              >
                <path d="M0 1 L7 4 L0 7 z" fill="currentColor" />
              </marker>
            </defs>

            {/* Edges */}
            {mentionLayout.edges.map((edge) => {
              const egoDim =
                selectedMentionNode !== null &&
                edge.from !== selectedMentionNode &&
                edge.to !== selectedMentionNode;
              const isLivePulsingEdge = Boolean(
                livePulseMsg &&
                livePulseMsg.agent === edge.from &&
                (livePulseMsg.recipient === edge.to ||
                  livePulseMsg.mentions.includes(edge.to) ||
                  (expandAll && livePulseMsg.all)),
              );
              const shouldPulseEdge = !reducedMotion && (edge.isCurrent || isLivePulsingEdge);
              const pulseSeq = edge.isCurrent
                ? (mentionLayout.currentMessage?.seq ?? 0)
                : isLivePulsingEdge
                  ? (livePulseMsg?.seq ?? 0)
                  : 0;

              return (
                <g key={edge.id} className={egoDim ? "pmx-aux-graph-dim" : undefined}>
                  <path
                    key={shouldPulseEdge ? `${edge.id}:p:${pulseSeq}` : edge.id}
                    d={edge.pathD}
                    strokeWidth={edge.strokeWidth}
                    markerEnd="url(#pmx-aux-arr)"
                    className={[
                      "pmx-aux-graph-edge",
                      edge.viaAllOnly ? "pmx-aux-graph-edge--all" : "",
                      edge.isPast ? "pmx-aux-graph-edge--past" : "",
                      edge.isCurrent ? "pmx-aux-graph-edge--cur" : "",
                      shouldPulseEdge ? "pmx-aux-graph-edge--pulse" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  />
                  {edge.isCurrent ? (
                    <OneShotMotionDot
                      key={`mention:${mentionLayout.currentMessage?.seq ?? 0}:${edge.id}`}
                      pathD={edge.pathD}
                      endX={edge.endX}
                      endY={edge.endY}
                      r={3.5}
                      dur="0.9s"
                      durMs={900}
                      className="pmx-aux-hv-beam-dot"
                      reducedMotion={reducedMotion}
                    />
                  ) : null}
                  {edge.count > 1 ? (
                    <g
                      transform={`translate(${edge.labelX.toFixed(1)}, ${edge.labelY.toFixed(1)})`}
                    >
                      <rect
                        x="-9"
                        y="-7"
                        width="18"
                        height="14"
                        rx="7"
                        className="pmx-aux-graph-count-bg"
                      />
                      <text textAnchor="middle" dy="3.5" className="pmx-aux-graph-count-txt">
                        {edge.count}
                      </text>
                    </g>
                  ) : null}
                </g>
              );
            })}

            {/* Nodes */}
            {mentionLayout.nodes.map((node) => {
              const isSelected = selectedMentionNode === node.name;
              const isNeighbor =
                selectedMentionNode !== null &&
                mentionLayout.edges.some(
                  (e) =>
                    (e.from === selectedMentionNode && e.to === node.name) ||
                    (e.to === selectedMentionNode && e.from === node.name),
                );
              const egoDim = selectedMentionNode !== null && !isSelected && !isNeighbor;
              const useBeeImg = model.useBees && node.sourceKind !== "acp-delegated";
              const beeUrl = useBeeImg
                ? getBeeSpriteDataUrl(node.name, toPixelBeeState(node.status), 0)
                : "";
              const labelMax = Math.max(
                6,
                Math.floor((node.width - (useBeeImg && beeUrl ? 34 : 31)) / 7),
              );
              const shortLabel =
                node.displayName.length > labelMax
                  ? `${node.displayName.slice(0, labelMax - 1)}…`
                  : node.displayName;
              const safeNodeKey = node.name.replace(/[^a-zA-Z0-9_-]/g, "");

              return (
                <g
                  key={node.name}
                  transform={`translate(${(node.x - node.width / 2).toFixed(1)}, ${(node.y - node.height / 2).toFixed(1)})`}
                  className={[
                    "pmx-aux-graph-node",
                    node.isHot ? "pmx-aux-graph-node--hot" : "",
                    node.killed ? "pmx-aux-graph-node--killed" : "",
                    !node.isActiveInReplay || egoDim ? "pmx-aux-graph-dim" : "",
                    isSelected ? "pmx-aux-graph-node--sel" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedMentionNode((prev) => (prev === node.name ? null : node.name));
                  }}
                >
                  {node.unaddressedCount > 0 ? (
                    <rect
                      x="-3"
                      y="-3"
                      width={node.width + 6}
                      height={node.height + 6}
                      rx="10"
                      className="pmx-aux-graph-unaddr"
                    />
                  ) : null}
                  <rect
                    width={node.width}
                    height={node.height}
                    rx="8"
                    className="pmx-aux-graph-node-box"
                  />
                  {useBeeImg && beeUrl ? (
                    <image
                      href={beeUrl}
                      x="5"
                      y="5"
                      width="22"
                      height="18"
                      style={{ imageRendering: "pixelated" }}
                    />
                  ) : (
                    <g
                      className="pmx-aux-graph-node-icon"
                      transform={`translate(6, ${(node.height - 16) / 2})`}
                      data-mention-brand={node.providerBrand}
                    >
                      {renderBundledBrandSvg({
                        brandId: node.providerBrand,
                        gradientPrefix: `${graphIdPrefix}-m-${safeNodeKey}`,
                        size: 16,
                        fallbackLabel: node.displayName,
                      })}
                    </g>
                  )}
                  <text
                    x={useBeeImg && beeUrl ? 31 : 27}
                    y={node.height / 2}
                    dominantBaseline="central"
                    className="pmx-aux-graph-node-txt"
                  >
                    {shortLabel}
                  </text>
                  {node.broadcastCount > 0 ? (
                    <g transform={`translate(${node.width - 14}, -6)`}>
                      <rect
                        x="-14"
                        y="-6"
                        width="32"
                        height="13"
                        rx="6.5"
                        className="pmx-aux-graph-all-bg"
                      />
                      <text x="2" y="3" textAnchor="middle" className="pmx-aux-graph-all-txt">
                        @all {node.broadcastCount}
                      </text>
                    </g>
                  ) : null}
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {/* Localized Legend Bar (1:1 Fig 3 bottom legend) */}
      <div className="pmx-aux-hv-legend" data-testid="aux-graph-legend">
        {graphMode === "hive" ? (
          <>
            <span className="pmx-aux-legend-item">
              <i className="pmx-aux-lg-bar pmx-aux-lg-bar--done" aria-hidden="true" />
              <span>{s.graphLegendTasksDone}</span>
            </span>
            <span className="pmx-aux-legend-item">
              <i className="pmx-aux-lg-arc" aria-hidden="true" />
              <span>{s.graphLegendMessageSent}</span>
            </span>
            <span className="pmx-aux-legend-item">
              <i className="pmx-aux-lg-wait" aria-hidden="true" />
              <span>{s.graphLegendWaitingOn}</span>
            </span>
          </>
        ) : (
          <>
            <span className="pmx-aux-legend-item">
              <i className="pmx-aux-lg-line" aria-hidden="true" />
              <span>{s.graphLegendMentionCount}</span>
            </span>
            <span className="pmx-aux-legend-item">
              <i className="pmx-aux-lg-line pmx-aux-lg-line--dash" aria-hidden="true" />
              <span>{s.graphLegendViaAll}</span>
            </span>
            <span className="pmx-aux-legend-item">
              <i className="pmx-aux-lg-ring" aria-hidden="true" />
              <span>{s.graphLegendUnaddressed}</span>
            </span>
            <span className="pmx-aux-legend-item">
              <i className="pmx-aux-lg-dot" aria-hidden="true" />
              <span>{s.graphLegendActive}</span>
            </span>
          </>
        )}
      </div>

      {/* Selected Hive Cell Detail Card */}
      {graphMode === "hive" && selectedCell ? (
        <div className="pmx-aux-card pmx-aux-hv-detail" data-testid="aux-hive-detail">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <strong className="truncate text-[13px] font-semibold">{selectedCell.title}</strong>
                {selectedCell.isAcpDelegated ? (
                  <span className="pmx-aux-acp-badge">{s.acpDelegatedBadge}</span>
                ) : null}
                {selectedCell.total > 0 ? (
                  <span className="text-[11.5px] text-muted-foreground tabular-nums">
                    {selectedCell.done}/{selectedCell.total}
                  </span>
                ) : null}
              </div>
              {selectedCell.goal ? (
                <p className="mt-0.5 text-[12px] text-muted-foreground">{selectedCell.goal}</p>
              ) : null}
            </div>
            <button
              type="button"
              className="pmx-aux-icon-btn"
              aria-label={s.graphCloseCard}
              onClick={() => setSelectedCellId(null)}
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
          {selectedCell.members.length === 0 ? (
            <p className="mt-2 text-[12px] text-muted-foreground">{s.graphNoMembersInThread}</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {selectedCell.members.map((name) => {
                const m = memberByName.get(name);
                return (
                  <button
                    key={name}
                    type="button"
                    className="pmx-aux-wchip"
                    onClick={() => onOpenMemberPosts(name)}
                  >
                    <span>@{name}</span>
                    {m?.waitingOn ? (
                      <span className="text-[10.5px] text-amber-600 dark:text-amber-300">
                        · {formatAuxWaitingOn(m.waitingOn, model.locale)}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {/* Replay Message Caption Card when scrubbing/replaying */}
      {replaySeq !== null && currentReplayMsg ? (
        <div className="pmx-aux-card pmx-aux-replay-caption" data-testid="aux-replay-caption">
          <div className="pmx-aux-msg-head">
            <div className="pmx-aux-msg-who">
              <strong className="pmx-aux-msg-author">@{currentReplayMsg.agent}</strong>
              {currentReplayMsg.mentions.length > 0 ? (
                <span className="pmx-aux-msg-to">
                  → {currentReplayMsg.mentions.map((n) => `@${n}`).join(" ")}
                </span>
              ) : currentReplayMsg.all ? (
                <span className="pmx-aux-mention pmx-aux-mention--all">@all</span>
              ) : null}
            </div>
            <button
              type="button"
              className="pmx-aux-link-btn"
              onClick={() => onJumpSeq(currentReplayMsg.seq)}
            >
              {s.graphLocateInBoard} #{currentReplayMsg.seq}
            </button>
          </div>
          <div className="mt-1.5">
            <AgentAuxMarkdown
              text={currentReplayMsg.text}
              knownNames={knownNames}
              maxSeq={model.headSeq || totalPosts}
              mentions={currentReplayMsg.mentions}
              all={currentReplayMsg.all}
              stripLeadingMentions
              clamp
              locale={model.locale}
              onJumpSeq={onJumpSeq}
              onClickMention={onOpenMemberPosts}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
});
