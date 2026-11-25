import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import {
  CHAT_RAIL_HANDLE_WIDTH_PX,
  CHAT_WIDTH_KEYBOARD_STEP_PX,
  DEFAULT_CHAT_CONTENT_MAX_WIDTH_PX,
  MAX_CHAT_CONTENT_WIDTH_PX,
  MIN_CHAT_CONTENT_WIDTH_PX,
  computeRailHandleOffsets,
  computeSymmetricDragWidth,
  measureAvailableColumnWidth,
  resolveChatContentMaxWidthCss,
  type ChatWidthSettingMode,
} from "./chatWidthController";

export interface ChatWidthDragHandlesProps {
  /** Reference to the `[data-pmx-glass-zone="mainCanvas"]` inner stage container. */
  readonly stageRef: RefObject<HTMLDivElement | null>;
  /** Current persisted width in exact pixels (`0` = default 960px, `480..2400` = custom px). */
  readonly widthPx: number;
  /** Optional T3 `chatWidth` setting fallback (`comfortable` / `wide` / `full`). */
  readonly settingMode?: ChatWidthSettingMode;
  /** Commits the finalized pixel width (`0` resets to default). */
  readonly onCommitWidthPx: (nextWidthPx: number) => void;
  /** Disabled for embedded split/side chats or maximized right panels. */
  readonly disabled?: boolean;
}

interface ActiveBadgeState {
  readonly left: number;
  readonly top: number;
  readonly text: string;
}

function findTrackedColumn(stage: HTMLElement): HTMLElement | null {
  return (
    stage.querySelector<HTMLElement>('[data-chat-composer-stack="true"]') ??
    stage.querySelector<HTMLElement>('[data-pmx-welcome-bottom="1"]') ??
    stage.querySelector<HTMLElement>('[data-pmx-composer-layout="agy"]')
  );
}

/**
 * Full-height invisible vertical drag rails flanking the centered conversation & composer column.
 * - Hover/focus reveals a glowing accent vertical bar aligned to the pointer's Y coordinate (`--pmx-rail-y`).
 * - Dragging symmetrically updates `--pmx-chat-content-max-width` & `--chat-content-max-width` at 60fps
 *   using exact `min(100%, <N>px)` values so nested containers never compound-shrink.
 * - Double-clicking (or pressing `Home`/`0`) restores the default elongated 960px AGY width.
 * - Automatically coordinates with left sidebar drag/collapse & right panel animations via ResizeObserver.
 */
export const ChatWidthDragHandles = memo(function ChatWidthDragHandles({
  stageRef,
  widthPx,
  settingMode,
  onCommitWidthPx,
  disabled = false,
}: ChatWidthDragHandlesProps) {
  const leftHandleRef = useRef<HTMLDivElement | null>(null);
  const rightHandleRef = useRef<HTMLDivElement | null>(null);
  const draggingSideRef = useRef<"left" | "right" | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const resetBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const observedColumnRef = useRef<HTMLElement | null>(null);
  const observedParentRef = useRef<HTMLElement | null>(null);
  const [draggingSide, setDraggingSide] = useState<"left" | "right" | null>(null);
  const [badge, setBadge] = useState<ActiveBadgeState | null>(null);

  const resolveStage = useCallback((): HTMLElement | null => {
    return (
      stageRef.current ??
      leftHandleRef.current?.closest<HTMLElement>('[data-pmx-inner-stage="1"]') ??
      leftHandleRef.current?.parentElement ??
      null
    );
  }, [stageRef]);

  const syncRailPositions = useCallback(() => {
    const stage = resolveStage();
    const leftEl = leftHandleRef.current;
    const rightEl = rightHandleRef.current;
    if (!stage || !leftEl || !rightEl) return;

    const column = findTrackedColumn(stage);
    const observer = resizeObserverRef.current;
    if (observer && column !== observedColumnRef.current) {
      if (observedColumnRef.current) {
        observer.unobserve(observedColumnRef.current);
      }
      if (observedParentRef.current) {
        observer.unobserve(observedParentRef.current);
      }
      observedColumnRef.current = column;
      observedParentRef.current = column?.parentElement ?? null;
      if (column) {
        observer.observe(column);
        if (column.parentElement && column.parentElement !== stage) {
          observer.observe(column.parentElement);
        }
      }
    }

    if (!column) {
      leftEl.style.display = "none";
      rightEl.style.display = "none";
      return;
    }
    const stageRect = stage.getBoundingClientRect();
    const columnRect = column.getBoundingClientRect();
    const offsets = computeRailHandleOffsets({
      stageLeft: stageRect.left,
      stageWidth: stageRect.width,
      columnLeft: columnRect.left,
      columnRight: columnRect.right,
      handleWidth: CHAT_RAIL_HANDLE_WIDTH_PX,
    });
    if (!offsets.visible) {
      leftEl.style.display = "none";
      rightEl.style.display = "none";
      return;
    }
    leftEl.style.display = "";
    rightEl.style.display = "";
    leftEl.style.left = `${offsets.leftX}px`;
    leftEl.style.right = "auto";
    rightEl.style.left = `${offsets.rightX}px`;
    rightEl.style.right = "auto";
  }, [resolveStage]);

  // Keep rail handles glued to column edges across window, sidebar, right-panel, and width changes.
  // Uses `useEffect` (not `useLayoutEffect`) so ancestor `stageRef` (e.g. `PrismuxStageFrame.innerRef`)
  // is guaranteed attached before observers bind, with DOM ancestor fallback via `resolveStage()`.
  useEffect(() => {
    if (disabled) return;
    const stage = resolveStage();
    if (!stage) return;

    let rafId = 0;
    const scheduleSync = () => {
      if (rafId || typeof requestAnimationFrame !== "function") return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        syncRailPositions();
      });
    };

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(scheduleSync);
      resizeObserverRef.current = observer;
      observer.observe(stage);
    }

    syncRailPositions();
    // Catch any sibling layout inset update (e.g. ChatCanvas measuring inline Overview panel on mount).
    scheduleSync();

    // Coordinate smoothly while left sidebar or right panel width CSS transition runs.
    let animRaf = 0;
    let animatingCount = 0;
    const tickAnimation = () => {
      syncRailPositions();
      if (animatingCount > 0 && typeof requestAnimationFrame === "function") {
        animRaf = requestAnimationFrame(tickAnimation);
      } else {
        animRaf = 0;
      }
    };
    const isPanelTransition = (ev: TransitionEvent) => {
      if (ev.propertyName !== "width") return false;
      const target = ev.target as HTMLElement | null;
      return Boolean(
        target?.closest?.('[data-slot="sidebar-gap"], [data-preview-panel-mode="inline"]'),
      );
    };
    const onTransitionStart = (ev: TransitionEvent) => {
      if (!isPanelTransition(ev)) return;
      animatingCount += 1;
      if (!animRaf && typeof requestAnimationFrame === "function") {
        animRaf = requestAnimationFrame(tickAnimation);
      }
    };
    const onTransitionEnd = (ev: TransitionEvent) => {
      if (!isPanelTransition(ev)) return;
      animatingCount = Math.max(0, animatingCount - 1);
      scheduleSync();
    };

    window.addEventListener("resize", scheduleSync);
    document.addEventListener("transitionstart", onTransitionStart, true);
    document.addEventListener("transitionend", onTransitionEnd, true);
    document.addEventListener("transitioncancel", onTransitionEnd, true);

    return () => {
      if (rafId && typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafId);
      if (animRaf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(animRaf);
      observer?.disconnect();
      resizeObserverRef.current = null;
      observedColumnRef.current = null;
      observedParentRef.current = null;
      window.removeEventListener("resize", scheduleSync);
      document.removeEventListener("transitionstart", onTransitionStart, true);
      document.removeEventListener("transitionend", onTransitionEnd, true);
      document.removeEventListener("transitioncancel", onTransitionEnd, true);
    };
  }, [disabled, resolveStage, syncRailPositions, widthPx, settingMode]);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      if (resetBadgeTimerRef.current !== null) {
        clearTimeout(resetBadgeTimerRef.current);
      }
    };
  }, []);

  const flashResetBadge = useCallback((clientX: number, clientY: number) => {
    if (resetBadgeTimerRef.current !== null) {
      clearTimeout(resetBadgeTimerRef.current);
    }
    setBadge({
      left: clientX,
      top: Math.max(40, clientY - 12),
      text: `已还原默认宽度 (${DEFAULT_CHAT_CONTENT_MAX_WIDTH_PX}px)`,
    });
    resetBadgeTimerRef.current = setTimeout(() => {
      resetBadgeTimerRef.current = null;
      setBadge(null);
    }, 900);
  }, []);

  const handlePointerMoveHover = useCallback((ev: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingSideRef.current !== null) return;
    const rect = ev.currentTarget.getBoundingClientRect();
    ev.currentTarget.style.setProperty("--pmx-rail-y", `${Math.round(ev.clientY - rect.top)}px`);
  }, []);

  const handleDoubleClick = useCallback(
    (ev: React.MouseEvent<HTMLDivElement>) => {
      ev.preventDefault();
      ev.stopPropagation();
      const stage = resolveStage();
      const defaultCss = resolveChatContentMaxWidthCss(0, settingMode);
      if (stage) {
        stage.style.setProperty("--pmx-chat-content-max-width", defaultCss);
        stage.style.setProperty("--chat-content-max-width", defaultCss);
      }
      document.documentElement.style.setProperty("--pmx-chat-content-max-width", defaultCss);
      onCommitWidthPx(0);
      flashResetBadge(ev.clientX, ev.clientY);
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(syncRailPositions);
      }
    },
    [flashResetBadge, onCommitWidthPx, resolveStage, settingMode, syncRailPositions],
  );

  const handlePointerDown = useCallback(
    (side: "left" | "right", ev: ReactPointerEvent<HTMLDivElement>) => {
      if (ev.button !== 0) return;
      const stage = resolveStage();
      if (!stage) return;
      ev.preventDefault();
      ev.stopPropagation();

      dragCleanupRef.current?.();
      if (resetBadgeTimerRef.current !== null) {
        clearTimeout(resetBadgeTimerRef.current);
        resetBadgeTimerRef.current = null;
      }

      const handleEl = ev.currentTarget;
      const pointerId = ev.pointerId;
      const initialButtons = ev.buttons;
      const column = findTrackedColumn(stage);
      const availableInnerW = measureAvailableColumnWidth(stage, column);
      const measuredColumnW = column?.getBoundingClientRect().width ?? 0;
      const fallbackStartW =
        widthPx >= MIN_CHAT_CONTENT_WIDTH_PX
          ? Math.min(widthPx, availableInnerW)
          : Math.min(DEFAULT_CHAT_CONTENT_MAX_WIDTH_PX, availableInnerW);
      const startW = measuredColumnW >= 240 ? Math.round(measuredColumnW) : fallbackStartW;
      const startX = ev.clientX;
      let moveClientX = ev.clientX;
      let moveClientY = ev.clientY;
      let latestTargetPx = startW;
      let didMove = false;
      let moveRaf = 0;
      let finished = false;

      const prevBodyUserSelect = document.body.style.userSelect;
      const prevBodyCursor = document.body.style.cursor;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "ew-resize";

      try {
        handleEl.setPointerCapture(pointerId);
      } catch {
        // Synthetic test environments may not implement pointer capture.
      }

      draggingSideRef.current = side;
      setDraggingSide(side);

      const applyLiveFrame = () => {
        moveRaf = 0;
        const liveAvailableW = measureAvailableColumnWidth(stage, column);
        const { targetPx, pct } = computeSymmetricDragWidth({
          side,
          startWidthPx: startW,
          deltaX: moveClientX - startX,
          containerInnerWidthPx: liveAvailableW,
        });
        latestTargetPx = targetPx;
        const liveCss = resolveChatContentMaxWidthCss(targetPx, settingMode);
        stage.style.setProperty("--pmx-chat-content-max-width", liveCss);
        stage.style.setProperty("--chat-content-max-width", liveCss);
        document.documentElement.style.setProperty("--pmx-chat-content-max-width", liveCss);
        const hr = handleEl.getBoundingClientRect();
        handleEl.style.setProperty("--pmx-rail-y", `${Math.round(moveClientY - hr.top)}px`);
        syncRailPositions();
        setBadge({
          left: moveClientX,
          top: Math.max(40, moveClientY - 12),
          text: `对话宽度 ${targetPx}px · ${pct}%`,
        });
      };

      const teardown = () => {
        if (moveRaf && typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(moveRaf);
          moveRaf = 0;
        }
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);
        window.removeEventListener("pointercancel", onCancel, true);
        window.removeEventListener("blur", onCancel);
        try {
          if (handleEl.hasPointerCapture?.(pointerId)) {
            handleEl.releasePointerCapture(pointerId);
          }
        } catch {
          // Ignore pointer capture release failures.
        }
        document.body.style.userSelect = prevBodyUserSelect;
        document.body.style.cursor = prevBodyCursor;
        draggingSideRef.current = null;
        setDraggingSide(null);
        setBadge(null);
        dragCleanupRef.current = null;
      };

      const commitDrag = () => {
        if (finished) return;
        finished = true;
        if (didMove) {
          applyLiveFrame();
        }
        teardown();
        if (!didMove) {
          return;
        }
        const committedCss = resolveChatContentMaxWidthCss(latestTargetPx, settingMode);
        stage.style.setProperty("--pmx-chat-content-max-width", committedCss);
        stage.style.setProperty("--chat-content-max-width", committedCss);
        document.documentElement.style.setProperty("--pmx-chat-content-max-width", committedCss);
        onCommitWidthPx(latestTargetPx);
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(syncRailPositions);
        }
      };

      const onMove = (mv: PointerEvent) => {
        if (mv.pointerId !== pointerId) return;
        if (initialButtons > 0 && mv.buttons === 0) {
          commitDrag();
          return;
        }
        moveClientX = mv.clientX;
        moveClientY = mv.clientY;
        if (Math.abs(moveClientX - startX) >= 1) {
          didMove = true;
        }
        if (!moveRaf) {
          if (typeof requestAnimationFrame === "function") {
            moveRaf = requestAnimationFrame(applyLiveFrame);
          } else {
            applyLiveFrame();
          }
        }
      };

      const onUp = (up: PointerEvent) => {
        if (up.pointerId !== pointerId) return;
        if (Number.isFinite(up.clientX)) {
          moveClientX = up.clientX;
          moveClientY = up.clientY;
          if (Math.abs(moveClientX - startX) >= 1) {
            didMove = true;
          }
        }
        commitDrag();
      };

      const onCancel = () => {
        commitDrag();
      };

      dragCleanupRef.current = teardown;
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
      window.addEventListener("pointercancel", onCancel, true);
      window.addEventListener("blur", onCancel);
    },
    [onCommitWidthPx, resolveStage, settingMode, syncRailPositions, widthPx],
  );

  const handleKeyDown = useCallback(
    (side: "left" | "right", ev: KeyboardEvent<HTMLDivElement>) => {
      if (ev.key === "Home" || ev.key === "0") {
        ev.preventDefault();
        onCommitWidthPx(0);
        return;
      }
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      ev.preventDefault();
      const stage = resolveStage();
      const column = stage ? findTrackedColumn(stage) : null;
      const availableW = stage
        ? measureAvailableColumnWidth(stage, column)
        : MAX_CHAT_CONTENT_WIDTH_PX;
      const measuredW = column?.getBoundingClientRect().width ?? 0;
      const basePx =
        measuredW >= 240
          ? Math.round(measuredW)
          : widthPx >= MIN_CHAT_CONTENT_WIDTH_PX
            ? widthPx
            : DEFAULT_CHAT_CONTENT_MAX_WIDTH_PX;
      const expand =
        (side === "right" && ev.key === "ArrowRight") ||
        (side === "left" && ev.key === "ArrowLeft");
      const maxPx = Math.min(MAX_CHAT_CONTENT_WIDTH_PX, availableW);
      const minPx = Math.min(MIN_CHAT_CONTENT_WIDTH_PX, maxPx);
      const nextPx = Math.max(
        minPx,
        Math.min(maxPx, basePx + (expand ? CHAT_WIDTH_KEYBOARD_STEP_PX : -CHAT_WIDTH_KEYBOARD_STEP_PX)),
      );
      onCommitWidthPx(nextPx);
    },
    [onCommitWidthPx, resolveStage, widthPx],
  );

  if (disabled) return null;

  return (
    <>
      {(["left", "right"] as const).map((side) => (
        <div
          key={side}
          ref={side === "left" ? leftHandleRef : rightHandleRef}
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label="左右拖动调整对话内容宽度（双击还原默认宽度）"
          aria-valuemin={MIN_CHAT_CONTENT_WIDTH_PX}
          aria-valuemax={MAX_CHAT_CONTENT_WIDTH_PX}
          aria-valuenow={widthPx >= MIN_CHAT_CONTENT_WIDTH_PX ? widthPx : DEFAULT_CHAT_CONTENT_MAX_WIDTH_PX}
          title="左右拖动调整对话宽度（双击还原默认）"
          className="[-webkit-app-region:no-drag]"
          data-pmx-chat-width-handle=""
          data-side={side}
          data-mode="rail"
          data-dragging={draggingSide === side ? "1" : undefined}
          onPointerMove={handlePointerMoveHover}
          onPointerDown={(ev) => handlePointerDown(side, ev)}
          onDoubleClick={handleDoubleClick}
          onKeyDown={(ev) => handleKeyDown(side, ev)}
        />
      ))}

      {badge && typeof document !== "undefined"
        ? createPortal(
            <div
              data-pmx-chat-width-badge="1"
              role="status"
              aria-live="polite"
              style={{
                left: `${badge.left}px`,
                top: `${badge.top}px`,
                transform: "translate(-50%, -100%)",
              }}
            >
              {badge.text}
            </div>,
            document.body,
          )
        : null}
    </>
  );
});
