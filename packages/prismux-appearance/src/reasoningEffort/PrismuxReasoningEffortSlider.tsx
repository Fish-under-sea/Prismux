/**
 * Model-aware dynamic reasoning-effort slider with pixel-matrix radiation track
 * and 8-family running chibi characters.
 *
 * Visual design & sprite artwork adapted with MIT attribution from:
 * - HanaAyane/dsh-reasoning-effort PR #9 (Copyright (c) 2026 HanaAyane, MIT; artwork by xihucuyudaichi)
 * - HaoyueQin/dsh-better-reasoning-effort & dsh-fish (Copyright (c) 2026 HaoyueQin, MIT)
 *
 * Strictly adheres to Prismux design mandates:
 * - Zero `@media (prefers-color-scheme)` (syncs via explicit 3-state Light / Dark / 360° Liquid Glass tokens)
 * - WCAG >= 4.5:1 contrast across all 8 brand accents
 * - `prefers-reduced-motion: reduce` & `data-pmx-gpu="0"` static frame degradation
 * - 0-Token host visual layer
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  computeReasoningEffortStopProgress,
  getReasoningEffortThumbInsetPx,
  normalizeReasoningEffortOptions,
  resolveEffortStopIndex,
  resolveReasoningEffortStopIndexFromPointer,
  type NormalizedReasoningEffortOption,
  type ReasoningEffortLocale,
  type ReasoningEffortOption,
} from './effortLevels.js';
import {
  REASONING_MODEL_THEMES,
  resolveReasoningModelTheme,
  type ReasoningModelFamily,
} from './modelTheme.js';
import {
  detectReasoningSliderDarkPolarity,
  drawReasoningRadiation,
  type ReasoningRadiationState,
} from './radiation.js';

export interface PrismuxReasoningEffortSliderProps {
  /** Model identifier (e.g. "claude-opus-4-6", "gpt-5.4-codex", "gemini-2.5-pro"). */
  readonly modelId?: string | null | undefined;
  /** Optional model display name (evaluated alongside modelId before provider fallback). */
  readonly modelName?: string | null | undefined;
  /** Optional provider identifier (e.g. "claudeAgent", "codex", "antigravity", "opencode"). */
  readonly provider?: string | null | undefined;
  /** Explicit theme family override; defaults to auto-detection via resolveReasoningModelTheme(). */
  readonly themeFamily?: ReasoningModelFamily | undefined;
  /** Available discrete effort levels (string ids or option descriptors). Defaults to family preset. */
  readonly options?: readonly (string | ReasoningEffortOption)[] | undefined;
  /** Currently selected effort value. */
  readonly value?: string | null | undefined;
  /** Invoked when the user selects or commits an effort stop via click, drag, stop pill, or keyboard. */
  readonly onChange?: ((nextValue: string) => void) | undefined;
  /** Optional live preview callback while dragging before pointer release (null when drag ends). */
  readonly onPreviewChange?: ((previewValue: string | null) => void) | undefined;
  /** Disable all pointer & keyboard interactions. */
  readonly disabled?: boolean | undefined;
  /** Locale for built-in default labels ('zh' | 'en', default 'zh'). */
  readonly locale?: ReasoningEffortLocale | undefined;
  /** Header row title (defaults to "推理强度" / "Reasoning effort"); pass null to hide the header row. */
  readonly label?: string | null | undefined;
  /** Render clickable discrete stop buttons below the animated track (default true). */
  readonly showStops?: boolean | undefined;
  /** Show the animated chibi runner sprite (default true; renders glowing orb when false). */
  readonly showRunner?: boolean | undefined;
  /** Compact height variant for tight popovers (default false). */
  readonly compact?: boolean | undefined;
  /** Accessible aria-label for the range input. */
  readonly ariaLabel?: string | undefined;
  /** Optional extra CSS class name on the root container. */
  readonly className?: string | undefined;
}

function clampIndex(raw: number, count: number): number {
  if (count <= 1) return 0;
  return Math.max(0, Math.min(count - 1, Math.round(raw)));
}

function isGpuDisabledOnDocument(doc?: Document | null): boolean {
  const target = doc ?? (typeof document !== 'undefined' ? document : null);
  if (!target) return false;
  const root = target.documentElement;
  return (
    root.getAttribute('data-pmx-gpu') === '0' ||
    root.getAttribute('data-prismux-gpu') === '0' ||
    root.getAttribute('data-pmx-reduced-motion') === '1'
  );
}

export function PrismuxReasoningEffortSlider({
  modelId,
  modelName,
  provider,
  themeFamily,
  options,
  value,
  onChange,
  onPreviewChange,
  disabled = false,
  locale = 'zh',
  label,
  showStops = true,
  showRunner = true,
  compact = false,
  ariaLabel,
  className,
}: PrismuxReasoningEffortSliderProps) {
  const labelId = useId();
  const theme = useMemo(
    () =>
      themeFamily
        ? REASONING_MODEL_THEMES[themeFamily]
        : resolveReasoningModelTheme(modelId, modelName, provider),
    [modelId, modelName, provider, themeFamily],
  );

  const stops: readonly NormalizedReasoningEffortOption[] = useMemo(
    () => normalizeReasoningEffortOptions(options, theme.id, locale),
    [locale, options, theme.id],
  );

  const committedIndex = useMemo(
    () => resolveEffortStopIndex(stops, value),
    [stops, value],
  );

  const [previewIndex, setPreviewIndex] = useState<number>(committedIndex);
  const [dragging, setDragging] = useState<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const themeFamilyRef = useRef<ReasoningModelFamily>(theme.id);
  themeFamilyRef.current = theme.id;

  const stopsRef = useRef(stops);
  stopsRef.current = stops;

  const previewIndexRef = useRef(previewIndex);
  previewIndexRef.current = previewIndex;

  const committedIndexRef = useRef(committedIndex);
  committedIndexRef.current = committedIndex;

  const draggingRef = useRef(false);
  const pointerActiveRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const onPreviewChangeRef = useRef(onPreviewChange);
  onPreviewChangeRef.current = onPreviewChange;

  const thumbInsetPx = getReasoningEffortThumbInsetPx({ showRunner, compact });
  const thumbInsetPxRef = useRef(thumbInsetPx);
  thumbInsetPxRef.current = thumbInsetPx;

  const radiationRef = useRef<ReasoningRadiationState>({
    progress: computeReasoningEffortStopProgress(committedIndex, stops.length),
    dragging: false,
    thumbInsetPx,
    isMax: stops.length >= 2 && committedIndex === stops.length - 1,
  });
  const redrawRef = useRef<(() => void) | null>(null);

  // Sync external value changes when not actively dragging
  useEffect(() => {
    if (draggingRef.current) return;
    previewIndexRef.current = committedIndex;
    setPreviewIndex(committedIndex);
  }, [committedIndex]);

  const effectiveIndex = dragging ? previewIndex : committedIndex;
  const activeStop = stops[effectiveIndex] ?? stops[0];
  const stopCount = stops.length;
  const progressRatio = computeReasoningEffortStopProgress(effectiveIndex, stopCount);
  const progressPercent = progressRatio * 100;
  const isMin = stopCount >= 1 && effectiveIndex === 0;
  const isTop = stopCount >= 2 && effectiveIndex === stopCount - 1;
  const interactive = !disabled && stopCount >= 2;

  useEffect(() => {
    radiationRef.current.progress = progressRatio;
    radiationRef.current.dragging = dragging;
    radiationRef.current.thumbInsetPx = thumbInsetPx;
    radiationRef.current.isMax = isTop;
    redrawRef.current?.();
  }, [dragging, isTop, progressRatio, theme.id, thumbInsetPx]);

  // Pixel-matrix radiation canvas lifecycle with strict reduced-motion & no-GPU static fallback
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const mq =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    let width = 1;
    let height = 1;
    let frameId = 0;
    let isVisible = true;
    let lastDrawTime = -Infinity;

    const shouldAnimate = (): boolean => {
      if (!isVisible) return false;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
      if (mq?.matches) return false;
      if (isGpuDisabledOnDocument()) return false;
      return typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function';
    };

    const resize = (): void => {
      const bounds = canvas.getBoundingClientRect();
      const dpr = Math.min(
        typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
        2,
      );
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (time = 1200): void => {
      lastDrawTime = time;
      drawReasoningRadiation(
        context,
        width,
        height,
        time,
        radiationRef.current,
        themeFamilyRef.current,
        detectReasoningSliderDarkPolarity(),
      );
    };

    const stopLoop = (): void => {
      if (frameId !== 0 && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(frameId);
      }
      frameId = 0;
    };

    const tick = (time: number): void => {
      const minInterval = radiationRef.current.dragging ? 0 : 32;
      if (time - lastDrawTime >= minInterval) {
        draw(time);
      }
      if (shouldAnimate()) {
        frameId = window.requestAnimationFrame(tick);
      } else {
        frameId = 0;
      }
    };

    const syncLoop = (): void => {
      stopLoop();
      draw(typeof performance !== 'undefined' ? performance.now() : 1200);
      if (shouldAnimate()) {
        frameId = window.requestAnimationFrame(tick);
      }
    };

    let resizeObserver: ResizeObserver | undefined;
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(() => {
        resize();
        draw(typeof performance !== 'undefined' ? performance.now() : 1200);
      });
      resizeObserver.observe(canvas);
    }

    let intersectionObserver: IntersectionObserver | undefined;
    if (typeof IntersectionObserver === 'function') {
      intersectionObserver = new IntersectionObserver((entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        const nextVisible = entry.isIntersecting;
        if (nextVisible === isVisible) return;
        isVisible = nextVisible;
        if (isVisible) {
          syncLoop();
        } else {
          stopLoop();
        }
      });
      intersectionObserver.observe(canvas);
    }

    let docObserver: MutationObserver | undefined;
    if (typeof MutationObserver === 'function' && typeof document !== 'undefined') {
      docObserver = new MutationObserver(() => {
        syncLoop();
      });
      docObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'data-pmx-theme', 'data-pmx-glass', 'data-pmx-gpu', 'data-prismux-gpu', 'data-pmx-reduced-motion'],
      });
    }

    const handleVisibilityChange = () => syncLoop();
    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    const handleMqChange = () => syncLoop();
    if (mq && typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', handleMqChange);
    }

    redrawRef.current = () => {
      draw(typeof performance !== 'undefined' ? performance.now() : 1200);
    };

    resize();
    syncLoop();

    return () => {
      stopLoop();
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      docObserver?.disconnect();
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (mq && typeof mq.removeEventListener === 'function') {
        mq.removeEventListener('change', handleMqChange);
      }
      redrawRef.current = null;
    };
  }, []);

  const commitIndex = useCallback((rawIndex: number) => {
    const list = stopsRef.current;
    if (list.length === 0) return;
    const nextIdx = clampIndex(rawIndex, list.length);
    const nextStop = list[nextIdx];
    previewIndexRef.current = nextIdx;
    setPreviewIndex(nextIdx);
    onPreviewChangeRef.current?.(null);
    if (nextStop) {
      onChangeRef.current?.(nextStop.value);
    }
  }, []);

  const rawIndexFromClientX = useCallback((input: HTMLInputElement, clientX: number): number => {
    const list = stopsRef.current;
    const bounds = input.getBoundingClientRect();
    if (bounds.width <= 0 || list.length < 2) return previewIndexRef.current;
    return resolveReasoningEffortStopIndexFromPointer(
      clientX,
      bounds,
      list.length,
      thumbInsetPxRef.current,
    );
  }, []);

  const updatePreview = useCallback((rawIndex: number) => {
    const list = stopsRef.current;
    const snapped = clampIndex(rawIndex, list.length);
    if (previewIndexRef.current === snapped) return;
    previewIndexRef.current = snapped;
    setPreviewIndex(snapped);
    const stop = list[snapped];
    if (stop) {
      onPreviewChangeRef.current?.(stop.value);
    }
  }, []);

  const finishDragging = useCallback(
    (input: HTMLInputElement, pointerId?: number, clientX?: number) => {
      if (!pointerActiveRef.current) return;
      if (pointerId !== undefined && activePointerIdRef.current !== pointerId) return;
      const raw =
        clientX === undefined ? previewIndexRef.current : rawIndexFromClientX(input, clientX);
      pointerActiveRef.current = false;
      activePointerIdRef.current = null;
      draggingRef.current = false;
      setDragging(false);
      if (pointerId !== undefined && typeof input.hasPointerCapture === 'function') {
        try {
          if (input.hasPointerCapture(pointerId)) {
            input.releasePointerCapture(pointerId);
          }
        } catch {
          // Ignore release failures when element unmounts mid-gesture.
        }
      }
      commitIndex(raw);
    },
    [commitIndex, rawIndexFromClientX],
  );

  const cancelDragging = useCallback(() => {
    if (!pointerActiveRef.current) return;
    pointerActiveRef.current = false;
    activePointerIdRef.current = null;
    draggingRef.current = false;
    setDragging(false);
    previewIndexRef.current = committedIndexRef.current;
    setPreviewIndex(committedIndexRef.current);
    onPreviewChangeRef.current?.(null);
  }, []);

  // Window-level capture fallback ensures drags complete cleanly even outside the popover bounds
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePointerMove = (event: PointerEvent) => {
      if (!pointerActiveRef.current || activePointerIdRef.current !== event.pointerId) return;
      const input = inputRef.current;
      if (!input) return;
      updatePreview(rawIndexFromClientX(input, event.clientX));
    };
    const handlePointerUp = (event: PointerEvent) => {
      const input = inputRef.current;
      if (!input) return;
      finishDragging(input, event.pointerId, event.clientX);
    };
    const handlePointerCancel = (event: PointerEvent) => {
      if (activePointerIdRef.current !== event.pointerId) return;
      cancelDragging();
    };
    window.addEventListener('pointermove', handlePointerMove, true);
    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('pointercancel', handlePointerCancel, true);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerCancel, true);
    };
  }, [cancelDragging, finishDragging, rawIndexFromClientX, updatePreview]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLInputElement>) => {
    if (!interactive) return;
    event.preventDefault();
    const input = event.currentTarget;
    input.focus();
    pointerActiveRef.current = true;
    activePointerIdRef.current = event.pointerId;
    draggingRef.current = true;
    setDragging(true);
    updatePreview(rawIndexFromClientX(input, event.clientX));
    if (typeof input.setPointerCapture === 'function') {
      try {
        if (!input.hasPointerCapture(event.pointerId)) {
          input.setPointerCapture(event.pointerId);
        }
      } catch {
        // Window capture fallback covers environments without pointer capture.
      }
    }
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!interactive) return;
    const current = clampIndex(effectiveIndex, stopCount);
    let target: number | undefined;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === 'PageDown') {
      target = Math.max(0, current - 1);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'PageUp') {
      target = Math.min(stopCount - 1, current + 1);
    } else if (event.key === 'Home') {
      target = 0;
    } else if (event.key === 'End') {
      target = stopCount - 1;
    }
    if (target === undefined) return;
    event.stopPropagation();
    event.preventDefault();
    commitIndex(target);
  };

  const resolvedHeaderLabel =
    label === undefined ? (locale === 'en' ? 'Reasoning effort' : '推理强度') : label;
  const resolvedAriaLabel =
    ariaLabel ??
    (resolvedHeaderLabel
      ? `${resolvedHeaderLabel} (${theme.displayName})`
      : locale === 'en'
        ? `Reasoning effort (${theme.displayName})`
        : `推理强度 (${theme.displayName})`);

  const rootStyle = {
    '--pmx-progress': String(progressRatio),
    '--pmx-thumb-inset': `${thumbInsetPx}px`,
    '--pmx-re-progress': `${progressPercent}%`,
    '--pmx-re-fill': isTop ? '100%' : 'var(--pmx-re-anchor)',
    '--pmx-re-count': String(Math.max(1, stopCount)),
    '--pmx-re-sprite': `url("${theme.spriteUrl}")`,
    '--pmx-re-accent-light': theme.accentLight,
    '--pmx-re-accent-dark': theme.accentDark,
  } as CSSProperties;

  const rootClassName = [
    'pmx-re-root',
    showRunner ? 'is-runner' : 'is-orb',
    compact ? 'is-compact' : '',
    dragging ? 'is-dragging' : '',
    disabled ? 'is-disabled' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={rootClassName}
      data-pmx-reasoning-slider="1"
      data-pmx-re-theme={theme.id}
      data-pmx-re-value={activeStop?.value ?? ''}
      data-pmx-re-min={isMin ? '1' : undefined}
      data-pmx-re-top={isTop ? '1' : undefined}
      data-pmx-re-runner={showRunner ? '1' : '0'}
      data-pmx-re-compact={compact ? '1' : undefined}
      data-pmx-re-dragging={dragging ? '1' : undefined}
      style={rootStyle}
    >
      {resolvedHeaderLabel !== null ? (
        <div className="pmx-re-header">
          <span id={labelId} className="pmx-re-title">
            {resolvedHeaderLabel}
          </span>
          <span className="pmx-re-current" data-testid="pmx-re-current-label">
            {activeStop?.label ?? ''}
          </span>
        </div>
      ) : null}

      <div className="pmx-re-stage">
        <div
          className="pmx-re-slider"
          data-top={isTop ? 'true' : undefined}
        >
          <div className="pmx-re-track" aria-hidden="true" />
          <div className="pmx-re-fx" aria-hidden="true">
            <canvas ref={canvasRef} className="pmx-re-canvas" />
            <span className="pmx-re-flare" />
          </div>
          <input
            ref={inputRef}
            type="range"
            className="pmx-re-input"
            min={0}
            max={Math.max(0, stopCount - 1)}
            step={1}
            value={effectiveIndex}
            disabled={!interactive}
            aria-label={resolvedAriaLabel}
            aria-labelledby={resolvedHeaderLabel !== null ? labelId : undefined}
            aria-valuetext={activeStop?.label ?? ''}
            onChange={(event) => {
              if (!interactive) return;
              const raw = Number(event.currentTarget.value);
              if (draggingRef.current) {
                updatePreview(raw);
              } else {
                commitIndex(raw);
              }
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={(event) => {
              if (!pointerActiveRef.current || activePointerIdRef.current !== event.pointerId) {
                return;
              }
              updatePreview(rawIndexFromClientX(event.currentTarget, event.clientX));
            }}
            onPointerUp={(event) => {
              finishDragging(event.currentTarget, event.pointerId, event.clientX);
            }}
            onPointerCancel={(event) => {
              if (
                typeof event.currentTarget.hasPointerCapture === 'function' &&
                event.currentTarget.hasPointerCapture(event.pointerId)
              ) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
              cancelDragging();
            }}
            onBlur={(event) => {
              finishDragging(event.currentTarget);
            }}
            onKeyDown={handleKeyDown}
          />
          <span className="pmx-re-knob" aria-hidden="true" />
        </div>
      </div>

      {showStops && stopCount > 0 ? (
        <div
          className="pmx-re-stops"
          role="group"
          aria-label={locale === 'en' ? 'Effort presets' : '思考强度档位'}
        >
          {stops.map((stop, idx) => {
            const selected = idx === effectiveIndex;
            return (
              <button
                key={stop.value}
                type="button"
                className={`pmx-re-stop${selected ? ' is-active' : ''}`}
                data-pmx-re-stop={stop.value}
                aria-pressed={selected}
                title={stop.description ?? stop.label}
                disabled={disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  commitIndex(idx);
                }}
              >
                {stop.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
