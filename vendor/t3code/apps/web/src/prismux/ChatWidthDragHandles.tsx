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
  CHAT_CANVAS_SAFE_GUTTER_PX,
  CHAT_RAIL_HANDLE_WIDTH_PX,
  DEFAULT_CHAT_CONTENT_MAX_WIDTH_PX,
  MAX_CHAT_WIDTH_PCT,
  MIN_CHAT_WIDTH_PCT,
  computeRailHandleOffsets,
  computeSymmetricDragWidth,
  resolveChatContentMaxWidthCss,
  type ChatWidthSettingMode,
} from "./chatWidthController";

export interface ChatWidthDragHandlesProps {
  /** Reference to the `[data-pmx-glass-zone="mainCanvas"]` inner stage container. */
  readonly stageRef: RefObject<HTMLDivElement | null>;
  /** Current persisted width percentage (`0` = default 960px, `45..100` = custom %). */
  readonly widthPct: number;
  /** Optional T3 `chatWidth` setting fallback (`comfortable` / `wide` / `full`). */
  readonly settingMode?: ChatWidthSettingMode;
  /** Commits the finalized percentage (`0` resets to default). */
  readonly onCommitWidthPct: (nextPct: number) => void;
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
 * - Dragging symmetrically updates `--pmx-chat-content-max-width` & `--chat-content-max-width` at 60fps.
 * - Double-clicking (or pressing `Home`/`0`) restores the default elongated 960px AGY width.
 * - Automatically coordinates with left sidebar drag/collapse & right panel animations via ResizeObserver.
 */
export const ChatWidthDragHandles = memo(function ChatWidthDragHandles({
  stageRef,
  widthPct,
  settingMode,
  onCommitWidthPct,
  disabled = false,
}: ChatWidthDragHandlesProps) {
  const leftHandleRef = useRef<HTMLDivElement | null>(null);
  const rightHandleRef = useRef<HTMLDivElement | null>(null);
  const draggingSideRef = useRef<"left" | "right" | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const resetBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [draggingSide, setDraggingSide] = useState<"left" | "right" | null>(null);
  const [badge, setBadge] = useState<ActiveBadgeState | null>(null);

  const syncRailPositions = useCallback(() => {
    const stage = stageRef.current;
    const leftEl = leftHandleRef.current;
    const rightEl = rightHandleRef.current;
    if (!stage || !leftEl || !rightEl) return;

    const column = findTrackedColumn(stage);
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
  }, [stageRef]);

  // Keep rail handles glued to column edges across window, sidebar, right-panel, and width changes.
  useEffect(() => {
    if (disabled) return;
    const stage = stageRef.current;
    if (!stage) return;

    let rafId = 0;
    const scheduleSync = () => {
      if (rafId || typeof requestAnimationFrame !== "function") return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        syncRailPositions();
      });
    };

    syncRailPositions();

    const column = findTrackedColumn(stage);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(scheduleSync);
      observer.observe(stage);
      if (column) observer.observe(column);
    }

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
      window.removeEventListener("resize", scheduleSync);
      document.removeEventListener("transitionstart", onTransitionStart, true);
      document.removeEventListener("transitionend", onTransitionEnd, true);
      document.removeEventListener("transitioncancel", onTransitionEnd, true);
    };
  }, [disabled, stageRef, syncRailPositions, widthPct, settingMode]);

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
      const stage = stageRef.current;
      const defaultCss = resolveChatContentMaxWidthCss(0, settingMode);
      if (stage) {
        stage.style.setProperty("--pmx-chat-content-max-width", defaultCss);
        stage.style.setProperty("--chat-content-max-width", defaultCss);
      }
      document.documentElement.style.setProperty("--pmx-chat-content-max-width", defaultCss);
      onCommitWidthPct(0);
      flashResetBadge(ev.clientX, ev.clientY);
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(syncRailPositions);
      }
    },
    [flashResetBadge, onCommitWidthPct, settingMode, stageRef, syncRailPositions],
  );

  const handlePointerDown = useCallback(
    (side: "left" | "right", ev: ReactPointerEvent<HTMLDivElement>) => {
      if (ev.button !== 0) return;
      const stage = stageRef.current;
      if (!stage) return;
      ev.preventDefault();
      ev.stopPropagation();

      dragCleanupRef.current?.();
      if (resetBadgeTimerRef.current !== null) {
        clearTimeout(resetBadgeTimerRef.current);
        resetBadgeTimerRef.current = null;
      }

      const handleEl = ev.currentTarget;
      const column = findTrackedColumn(stage);
      const stageInnerW = Math.max(360, stage.clientWidth - CHAT_CANVAS_SAFE_GUTTER_PX);
      const startW =
        column?.getBoundingClientRect().width ||
        Math.min(DEFAULT_CHAT_CONTENT_MAX_WIDTH_PX, stageInnerW);
      const startX = ev.clientX;
      let moveClientX = ev.clientX;
      let moveClientY = ev.clientY;
      let latestPct =
        widthPct >= MIN_CHAT_WIDTH_PCT
          ? widthPct
          : Math.min(MAX_CHAT_WIDTH_PCT, Math.max(MIN_CHAT_WIDTH_PCT, Math.round((startW / stageInnerW) * 100)));
      let moveRaf = 0;

      draggingSideRef.current = side;
      setDraggingSide(side);

      const applyLiveFrame = () => {
        moveRaf = 0;
        const { targetPx, pct } = computeSymmetricDragWidth({
          side,
          startWidthPx: startW,
          deltaX: moveClientX - startX,
          containerInnerWidthPx: stageInnerW,
        });
        latestPct = pct;
        const livePx = `${targetPx}px`;
        stage.style.setProperty("--pmx-chat-content-max-width", livePx);
        stage.style.setProperty("--chat-content-max-width", livePx);
        document.documentElement.style.setProperty("--pmx-chat-content-max-width", livePx);
        const hr = handleEl.getBoundingClientRect();
        handleEl.style.setProperty("--pmx-rail-y", `${Math.round(moveClientY - hr.top)}px`);
        syncRailPositions();
        setBadge({
          left: moveClientX,
          top: Math.max(40, moveClientY - 12),
          text: `对话宽度 ${pct}% · ${targetPx}px`,
        });
      };

      const onMove = (mv: PointerEvent) => {
        moveClientX = mv.clientX;
        moveClientY = mv.clientY;
        if (!moveRaf && typeof requestAnimationFrame === "function") {
          moveRaf = requestAnimationFrame(applyLiveFrame);
        }
      };

      const teardown = () => {
        if (moveRaf && typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(moveRaf);
          moveRaf = 0;
        }
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", finishDrag, true);
        window.removeEventListener("pointercancel", finishDrag, true);
        draggingSideRef.current = null;
        setDraggingSide(null);
        setBadge(null);
        dragCleanupRef.current = null;
      };

      const finishDrag = () => {
        applyLiveFrame();
        teardown();
        const committedCss = resolveChatContentMaxWidthCss(latestPct, settingMode);
        stage.style.setProperty("--pmx-chat-content-max-width", committedCss);
        stage.style.setProperty("--chat-content-max-width", committedCss);
        document.documentElement.style.setProperty("--pmx-chat-content-max-width", committedCss);
        onCommitWidthPct(latestPct);
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(syncRailPositions);
        }
      };

      dragCleanupRef.current = teardown;
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", finishDrag, true);
      window.addEventListener("pointercancel", finishDrag, true);
      applyLiveFrame();
    },
    [onCommitWidthPct, settingMode, stageRef, syncRailPositions, widthPct],
  );

  const handleKeyDown = useCallback(
    (side: "left" | "right", ev: KeyboardEvent<HTMLDivElement>) => {
      if (ev.key === "Home" || ev.key === "0") {
        ev.preventDefault();
        onCommitWidthPct(0);
        return;
      }
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      ev.preventDefault();
      const basePct = widthPct >= MIN_CHAT_WIDTH_PCT ? widthPct : 72;
      const expand = (side === "right" && ev.key === "ArrowRight") || (side === "left" && ev.key === "ArrowLeft");
      const nextPct = Math.min(
        MAX_CHAT_WIDTH_PCT,
        Math.max(MIN_CHAT_WIDTH_PCT, basePct + (expand ? 4 : -4)),
      );
      onCommitWidthPct(nextPct);
    },
    [onCommitWidthPct, widthPct],
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
          aria-valuemin={MIN_CHAT_WIDTH_PCT}
          aria-valuemax={MAX_CHAT_WIDTH_PCT}
          aria-valuenow={widthPct >= MIN_CHAT_WIDTH_PCT ? widthPct : undefined}
          title="左右拖动调整对话宽度（双击还原默认）"
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
