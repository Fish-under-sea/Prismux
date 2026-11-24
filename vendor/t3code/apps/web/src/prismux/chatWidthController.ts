import { useCallback, useEffect, useState } from "react";

/** Primary persisted custom conversation width in exact pixels (`0` = default 960px). */
export const CHAT_WIDTH_PX_STORAGE_KEY = "prismux.chatContentWidthPx.v2";
/** Legacy percentage key kept only for safe cleanup / backward compatibility. */
export const CHAT_WIDTH_STORAGE_KEY = "prismux.chatContentWidthPct.v1";
export const CHAT_WIDTH_CHANGED_EVENT = "prismux:chat-width-changed";

/** Default elongated AGY 2.0 conversation & composer width (px). */
export const DEFAULT_CHAT_CONTENT_MAX_WIDTH_PX = 960;
export const WIDE_CHAT_CONTENT_MAX_WIDTH_PX = 1152;
export const MIN_CHAT_CONTENT_WIDTH_PX = 480;
export const MAX_CHAT_CONTENT_WIDTH_PX = 2400;
/** Minimum plausible raw stored pixel width; smaller positive numbers (e.g. stale %) self-heal to default. */
export const MIN_PLAUSIBLE_STORED_WIDTH_PX = 200;
export const MIN_CHAT_WIDTH_PCT = 45;
export const MAX_CHAT_WIDTH_PCT = 100;
export const CHAT_CANVAS_SAFE_GUTTER_PX = 36;
export const CHAT_RAIL_HANDLE_WIDTH_PX = 14;
export const CHAT_WIDTH_KEYBOARD_STEP_PX = 32;

export type ChatWidthSettingMode = "comfortable" | "wide" | "full" | undefined;

export function clampChatWidthPx(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  const rounded = Math.round(raw);
  if (rounded <= 0) return 0;
  return Math.min(MAX_CHAT_CONTENT_WIDTH_PX, Math.max(MIN_CHAT_CONTENT_WIDTH_PX, rounded));
}

export function clampChatWidthPct(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  const rounded = Math.round(raw);
  if (rounded <= 0) return 0;
  return Math.min(MAX_CHAT_WIDTH_PCT, Math.max(MIN_CHAT_WIDTH_PCT, rounded));
}

/**
 * Parses a persisted pixel width string with strict self-healing:
 * - Empty, non-numeric, NaN, Infinity, non-positive, or suspiciously tiny values (`< 200`, e.g.
 *   corrupted data or accidentally copied percentages) self-heal to `0` (default 960px).
 * - Out-of-range pixel values clamp safely into `[MIN_CHAT_CONTENT_WIDTH_PX, MAX_CHAT_CONTENT_WIDTH_PX]`.
 */
export function parseStoredChatWidthPx(raw: string | null | undefined): number {
  if (raw == null) return 0;
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < MIN_PLAUSIBLE_STORED_WIDTH_PX) {
    return 0;
  }
  return clampChatWidthPx(parsed);
}

export function parseStoredChatWidthPct(raw: string | null | undefined): number {
  if (raw == null || raw.trim() === "") return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 0;
  return clampChatWidthPct(parsed);
}

export function readStoredChatWidthPx(): number {
  if (typeof window === "undefined") return 0;
  try {
    // Clear legacy broken percentage key so old collapsed values never linger.
    if (window.localStorage.getItem(CHAT_WIDTH_STORAGE_KEY) !== null) {
      window.localStorage.removeItem(CHAT_WIDTH_STORAGE_KEY);
    }
    const raw = window.localStorage.getItem(CHAT_WIDTH_PX_STORAGE_KEY);
    if (raw == null) return 0;
    const normalized = parseStoredChatWidthPx(raw);
    if (normalized === 0) {
      // Self-heal invalid / corrupted cache entry by removing it immediately.
      window.localStorage.removeItem(CHAT_WIDTH_PX_STORAGE_KEY);
    } else if (String(normalized) !== raw.trim()) {
      window.localStorage.setItem(CHAT_WIDTH_PX_STORAGE_KEY, String(normalized));
    }
    return normalized;
  } catch {
    return 0;
  }
}

export function writeStoredChatWidthPx(widthPx: number): number {
  const normalized = clampChatWidthPx(widthPx);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(CHAT_WIDTH_STORAGE_KEY);
      if (normalized === 0) {
        window.localStorage.removeItem(CHAT_WIDTH_PX_STORAGE_KEY);
      } else {
        window.localStorage.setItem(CHAT_WIDTH_PX_STORAGE_KEY, String(normalized));
      }
    } catch {
      // Ignore storage quota or private mode errors.
    }
    try {
      window.dispatchEvent(
        new CustomEvent<{ widthPx: number }>(CHAT_WIDTH_CHANGED_EVENT, {
          detail: { widthPx: normalized },
        }),
      );
    } catch {
      // Ignore event dispatch failures in non-DOM test runtimes.
    }
  }
  return normalized;
}

/**
 * Resolves the CSS value for `--pmx-chat-content-max-width` and `--chat-content-max-width`.
 *
 * Crucially uses length-based `min(100%, <N>px)` rather than percentage expressions because the
 * composer stack nests multiple elements sharing `--pmx-chat-content-max-width`
 * (`[data-chat-composer-stack]` -> `ComposerSurface.Shell` -> `[data-chat-composer-form]` ->
 * `[data-pmx-composer-layout="agy"]`). A percentage expression compounds across nested containers
 * (`pct^4`) and collapses to `480px`, whereas `min(100%, <N>px)` is strictly idempotent at any
 * nesting depth while still shrinking seamlessly to `100%` whenever the viewport narrows.
 */
export function resolveChatContentMaxWidthCss(
  widthPx: number,
  settingMode?: ChatWidthSettingMode,
): string {
  const normalized = clampChatWidthPx(widthPx);
  if (normalized >= MIN_CHAT_CONTENT_WIDTH_PX) {
    return `min(100%, ${normalized}px)`;
  }
  if (settingMode === "full") {
    return "100%";
  }
  if (settingMode === "wide") {
    return `min(100%, ${WIDE_CHAT_CONTENT_MAX_WIDTH_PX}px)`;
  }
  return `min(100%, ${DEFAULT_CHAT_CONTENT_MAX_WIDTH_PX}px)`;
}

/**
 * Measures the true maximum content-box width available to the centered conversation/composer
 * column inside its immediate lane wrapper (accounting for `.chat-composer-lane` or welcome
 * wrapper horizontal padding), falling back to the stage inner width.
 */
export function measureAvailableColumnWidth(
  stage: HTMLElement,
  column: HTMLElement | null,
): number {
  const parent = column?.parentElement;
  if (parent) {
    const parentWidth = parent.clientWidth || parent.getBoundingClientRect().width;
    const cs = typeof getComputedStyle === "function" ? getComputedStyle(parent) : null;
    const padLeft = cs ? Number.parseFloat(cs.paddingLeft) || 0 : 0;
    const padRight = cs ? Number.parseFloat(cs.paddingRight) || 0 : 0;
    const inner = Math.round(parentWidth - padLeft - padRight);
    if (Number.isFinite(inner) && inner >= 320) {
      return inner;
    }
  }
  const stageWidth = stage.clientWidth || stage.getBoundingClientRect().width;
  return Math.max(320, Math.round(stageWidth - CHAT_CANVAS_SAFE_GUTTER_PX));
}

export interface SymmetricDragWidthInput {
  readonly side: "left" | "right";
  readonly startWidthPx: number;
  readonly deltaX: number;
  readonly containerInnerWidthPx: number;
}

export interface SymmetricDragWidthResult {
  readonly targetPx: number;
  readonly pct: number;
}

/**
 * Computes symmetric left/right edge drag width (2x delta since the conversation column is centered):
 * - Dragging the LEFT handle left (`deltaX < 0`) expands; right (`deltaX > 0`) narrows.
 * - Dragging the RIGHT handle right (`deltaX > 0`) expands; left (`deltaX < 0`) narrows.
 * Clamped safely inside `[min(480, innerWidth), min(2400, innerWidth)]` so bounds can never invert.
 */
export function computeSymmetricDragWidth(
  input: SymmetricDragWidthInput,
): SymmetricDragWidthResult {
  const safeInner = Number.isFinite(input.containerInnerWidthPx)
    ? Math.max(320, Math.round(input.containerInnerWidthPx))
    : DEFAULT_CHAT_CONTENT_MAX_WIDTH_PX;
  const maxPx = Math.min(MAX_CHAT_CONTENT_WIDTH_PX, safeInner);
  const minPx = Math.min(MIN_CHAT_CONTENT_WIDTH_PX, maxPx);
  const safeStart =
    Number.isFinite(input.startWidthPx) && input.startWidthPx > 0
      ? input.startWidthPx
      : Math.min(DEFAULT_CHAT_CONTENT_MAX_WIDTH_PX, maxPx);
  const safeDelta = Number.isFinite(input.deltaX) ? input.deltaX : 0;
  const rawTarget = safeStart + (input.side === "left" ? -2 : 2) * safeDelta;
  const targetPx = Math.round(Math.max(minPx, Math.min(maxPx, rawTarget)));
  const pct = Math.min(100, Math.max(1, Math.round((targetPx / safeInner) * 100)));
  return { targetPx, pct };
}

export interface RailHandleOffsetsInput {
  readonly stageLeft: number;
  readonly stageWidth: number;
  readonly columnLeft: number;
  readonly columnRight: number;
  readonly handleWidth?: number;
}

export interface RailHandleOffsets {
  readonly leftX: number;
  readonly rightX: number;
  readonly visible: boolean;
}

/**
 * Positions the invisible full-height vertical rail handles flush along the left and right outer
 * edges of the centered conversation/composer column within the main canvas stage.
 */
export function computeRailHandleOffsets(input: RailHandleOffsetsInput): RailHandleOffsets {
  const handleW = input.handleWidth ?? CHAT_RAIL_HANDLE_WIDTH_PX;
  if (input.stageWidth < 360 || input.columnRight - input.columnLeft < 240) {
    return { leftX: 0, rightX: 0, visible: false };
  }
  const relLeft = Math.round(input.columnLeft - input.stageLeft);
  const relRight = Math.round(input.columnRight - input.stageLeft);
  const leftX = Math.max(0, Math.min(Math.round(input.stageWidth - handleW), relLeft - handleW));
  const rightX = Math.max(0, Math.min(Math.round(input.stageWidth - handleW), relRight));
  return { leftX, rightX, visible: true };
}

export function useChatContentWidth(settingMode?: ChatWidthSettingMode) {
  const [widthPx, setWidthPxState] = useState<number>(() => readStoredChatWidthPx());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleCustom = (event: Event) => {
      const detail = (event as CustomEvent<{ widthPx?: number }>).detail;
      if (detail && typeof detail.widthPx === "number") {
        setWidthPxState(clampChatWidthPx(detail.widthPx));
      }
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === CHAT_WIDTH_PX_STORAGE_KEY) {
        setWidthPxState(parseStoredChatWidthPx(event.newValue));
      }
    };
    window.addEventListener(CHAT_WIDTH_CHANGED_EVENT, handleCustom);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(CHAT_WIDTH_CHANGED_EVENT, handleCustom);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const commitWidthPx = useCallback((nextWidthPx: number) => {
    const normalized = writeStoredChatWidthPx(nextWidthPx);
    setWidthPxState(normalized);
    return normalized;
  }, []);

  const resetWidth = useCallback(() => {
    return commitWidthPx(0);
  }, [commitWidthPx]);

  const maxWidthCss = resolveChatContentMaxWidthCss(widthPx, settingMode);

  // Publish `--pmx-chat-content-max-width` on :root so portals/siblings stay in sync.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty("--pmx-chat-content-max-width", maxWidthCss);
    document.documentElement.dataset.pmxChatWidth =
      widthPx >= MIN_CHAT_CONTENT_WIDTH_PX ? "custom" : "default";
  }, [maxWidthCss, widthPx]);

  return {
    widthPx,
    isCustom: widthPx >= MIN_CHAT_CONTENT_WIDTH_PX,
    maxWidthCss,
    commitWidthPx,
    resetWidth,
  } as const;
}
