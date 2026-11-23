import { useCallback, useEffect, useState } from "react";

export const CHAT_WIDTH_STORAGE_KEY = "prismux.chatContentWidthPct.v1";
export const CHAT_WIDTH_CHANGED_EVENT = "prismux:chat-width-changed";

/** Default elongated AGY 2.0 conversation & composer width (px). */
export const DEFAULT_CHAT_CONTENT_MAX_WIDTH_PX = 960;
export const WIDE_CHAT_CONTENT_MAX_WIDTH_PX = 1152;
export const MIN_CHAT_CONTENT_WIDTH_PX = 480;
export const MIN_CHAT_WIDTH_PCT = 45;
export const MAX_CHAT_WIDTH_PCT = 100;
export const CHAT_CANVAS_SAFE_GUTTER_PX = 36;
export const CHAT_RAIL_HANDLE_WIDTH_PX = 14;

export type ChatWidthSettingMode = "comfortable" | "wide" | "full" | undefined;

export function clampChatWidthPct(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  const rounded = Math.round(raw);
  if (rounded <= 0) return 0;
  return Math.min(MAX_CHAT_WIDTH_PCT, Math.max(MIN_CHAT_WIDTH_PCT, rounded));
}

export function parseStoredChatWidthPct(raw: string | null | undefined): number {
  if (raw == null || raw.trim() === "") return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 0;
  return clampChatWidthPct(parsed);
}

export function readStoredChatWidthPct(): number {
  if (typeof window === "undefined") return 0;
  try {
    return parseStoredChatWidthPct(window.localStorage.getItem(CHAT_WIDTH_STORAGE_KEY));
  } catch {
    return 0;
  }
}

export function writeStoredChatWidthPct(pct: number): number {
  const normalized = clampChatWidthPct(pct);
  if (typeof window !== "undefined") {
    try {
      if (normalized === 0) {
        window.localStorage.removeItem(CHAT_WIDTH_STORAGE_KEY);
      } else {
        window.localStorage.setItem(CHAT_WIDTH_STORAGE_KEY, String(normalized));
      }
    } catch {
      // Ignore storage quota or private mode errors.
    }
    try {
      window.dispatchEvent(
        new CustomEvent<{ pct: number }>(CHAT_WIDTH_CHANGED_EVENT, {
          detail: { pct: normalized },
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
 * - `pct === 0` uses the default elongated AGY width (`960px`, or honors explicit `wide`/`full` setting).
 * - `pct` in `[45, 100]` uses a container-relative `clamp()` so sidebar/right-panel resizes stay fluid.
 */
export function resolveChatContentMaxWidthCss(
  pct: number,
  settingMode?: ChatWidthSettingMode,
): string {
  const normalized = clampChatWidthPct(pct);
  if (normalized >= MIN_CHAT_WIDTH_PCT) {
    return `clamp(${MIN_CHAT_CONTENT_WIDTH_PX}px, ${normalized}%, calc(100% - ${CHAT_CANVAS_SAFE_GUTTER_PX}px))`;
  }
  if (settingMode === "full") {
    return `calc(100% - ${CHAT_CANVAS_SAFE_GUTTER_PX}px)`;
  }
  if (settingMode === "wide") {
    return `min(100%, ${WIDE_CHAT_CONTENT_MAX_WIDTH_PX}px)`;
  }
  return `min(100%, ${DEFAULT_CHAT_CONTENT_MAX_WIDTH_PX}px)`;
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
 * Computes symmetric left/right edge drag width (2x delta since the conversation column is centered),
 * clamped safely inside `[min(480, innerWidth), innerWidth]`.
 */
export function computeSymmetricDragWidth(
  input: SymmetricDragWidthInput,
): SymmetricDragWidthResult {
  const safeInner = Math.max(320, Math.round(input.containerInnerWidthPx));
  const minPx = Math.min(MIN_CHAT_CONTENT_WIDTH_PX, safeInner);
  const rawTarget = input.startWidthPx + (input.side === "left" ? -2 : 2) * input.deltaX;
  const targetPx = Math.round(Math.max(minPx, Math.min(safeInner, rawTarget)));
  const rawPct = Math.round((targetPx / safeInner) * 100);
  const pct = Math.min(MAX_CHAT_WIDTH_PCT, Math.max(MIN_CHAT_WIDTH_PCT, rawPct));
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
  const [widthPct, setWidthPctState] = useState<number>(() => readStoredChatWidthPct());

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleCustom = (event: Event) => {
      const detail = (event as CustomEvent<{ pct?: number }>).detail;
      if (detail && typeof detail.pct === "number") {
        setWidthPctState(clampChatWidthPct(detail.pct));
      }
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === CHAT_WIDTH_STORAGE_KEY) {
        setWidthPctState(parseStoredChatWidthPct(event.newValue));
      }
    };
    window.addEventListener(CHAT_WIDTH_CHANGED_EVENT, handleCustom);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(CHAT_WIDTH_CHANGED_EVENT, handleCustom);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const commitWidthPct = useCallback((nextPct: number) => {
    const normalized = writeStoredChatWidthPct(nextPct);
    setWidthPctState(normalized);
    return normalized;
  }, []);

  const resetWidth = useCallback(() => {
    return commitWidthPct(0);
  }, [commitWidthPct]);

  const maxWidthCss = resolveChatContentMaxWidthCss(widthPct, settingMode);

  // Publish `--pmx-chat-content-max-width` on :root so portals/siblings stay in sync.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty("--pmx-chat-content-max-width", maxWidthCss);
    document.documentElement.dataset.pmxChatWidth = widthPct >= MIN_CHAT_WIDTH_PCT ? "custom" : "default";
  }, [maxWidthCss, widthPct]);

  return {
    widthPct,
    isCustom: widthPct >= MIN_CHAT_WIDTH_PCT,
    maxWidthCss,
    commitWidthPct,
    resetWidth,
  } as const;
}
