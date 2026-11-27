import { useLayoutEffect, useRef, type ComponentProps } from "react";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";

/** Number of overlapping GPU-composited ribbon segments forming the open-gap comet (~58% lit, ~42% open gap). */
export const COMPOSER_SHIMMER_SEGMENT_COUNT = 16;
/** Constant physical perimeter velocity (px/s) for silky, non-distorted flow across any composer width/height. */
export const COMPOSER_SHIMMER_SPEED_PX_PER_SEC = 480;
export const COMPOSER_SHIMMER_MIN_DURATION_MS = 2600;
export const COMPOSER_SHIMMER_MAX_DURATION_MS = 4600;
const COMPOSER_SHIMMER_CORNER_STEPS = 8;
const COMPOSER_SHIMMER_DEFAULT_RADIUS_PX = 20;

interface ComposerShimmerSegmentSpec {
  readonly index: number;
  readonly lag: number;
  readonly lengthFraction: number;
  readonly minPx: number;
  readonly thicknessPx: number;
}

const COMPOSER_SHIMMER_SEGMENTS: readonly ComposerShimmerSegmentSpec[] = [
  { index: 0, lag: 0.0, lengthFraction: 0.044, minPx: 50, thicknessPx: 18 },
  { index: 1, lag: 0.018, lengthFraction: 0.066, minPx: 58, thicknessPx: 20 },
  { index: 2, lag: 0.044, lengthFraction: 0.088, minPx: 68, thicknessPx: 22 },
  { index: 3, lag: 0.078, lengthFraction: 0.095, minPx: 72, thicknessPx: 22 },
  { index: 4, lag: 0.114, lengthFraction: 0.098, minPx: 74, thicknessPx: 22 },
  { index: 5, lag: 0.152, lengthFraction: 0.098, minPx: 74, thicknessPx: 22 },
  { index: 6, lag: 0.192, lengthFraction: 0.1, minPx: 76, thicknessPx: 22 },
  { index: 7, lag: 0.232, lengthFraction: 0.1, minPx: 76, thicknessPx: 22 },
  { index: 8, lag: 0.274, lengthFraction: 0.1, minPx: 76, thicknessPx: 22 },
  { index: 9, lag: 0.314, lengthFraction: 0.098, minPx: 74, thicknessPx: 22 },
  { index: 10, lag: 0.354, lengthFraction: 0.098, minPx: 74, thicknessPx: 22 },
  { index: 11, lag: 0.394, lengthFraction: 0.096, minPx: 72, thicknessPx: 22 },
  { index: 12, lag: 0.432, lengthFraction: 0.094, minPx: 70, thicknessPx: 22 },
  { index: 13, lag: 0.474, lengthFraction: 0.09, minPx: 66, thicknessPx: 20 },
  { index: 14, lag: 0.514, lengthFraction: 0.086, minPx: 62, thicknessPx: 20 },
  { index: 15, lag: 0.554, lengthFraction: 0.08, minPx: 56, thicknessPx: 18 },
] as const;

// Render tail-to-head in DOM order so the bright leading spark (index 0) always composites on top.
const COMPOSER_SHIMMER_SEGMENTS_PAINT_ORDER = [...COMPOSER_SHIMMER_SEGMENTS].reverse();

export interface ComposerShimmerWaypoint {
  readonly offset: number;
  readonly x: number;
  readonly y: number;
  readonly angleDeg: number;
  readonly transform: string;
}

export interface ComposerShimmerMetrics {
  readonly width: number;
  readonly height: number;
  readonly effectiveRadius: number;
  readonly perimeter: number;
  readonly durationMs: number;
  readonly waypoints: readonly ComposerShimmerWaypoint[];
  readonly keyframes: Keyframe[];
}

/**
 * Computes mathematically constant-arc-length GPU `transform` keyframes along a rounded-rectangle
 * perimeter so the shimmer ribbon flows at uniform linear speed on straight edges and all 4 corners.
 */
export function computeComposerShimmerMetrics(
  rawWidth: number,
  rawHeight: number,
  rawBorderRadius = COMPOSER_SHIMMER_DEFAULT_RADIUS_PX,
): ComposerShimmerMetrics {
  const width = Math.max(4, Number.isFinite(rawWidth) ? rawWidth : 4);
  const height = Math.max(4, Number.isFinite(rawHeight) ? rawHeight : 4);
  const clampedRadius = Math.max(
    0,
    Math.min(
      Number.isFinite(rawBorderRadius) ? rawBorderRadius : COMPOSER_SHIMMER_DEFAULT_RADIUS_PX,
      width / 2,
      height / 2,
    ),
  );

  const straightH = Math.max(0, width - 2 * clampedRadius);
  const straightV = Math.max(0, height - 2 * clampedRadius);
  const cornerArc = (Math.PI / 2) * clampedRadius;
  const perimeter = 2 * straightH + 2 * straightV + 4 * cornerArc;
  const safePerimeter = perimeter > 0 ? perimeter : 1;

  const durationMs = Math.max(
    COMPOSER_SHIMMER_MIN_DURATION_MS,
    Math.min(
      COMPOSER_SHIMMER_MAX_DURATION_MS,
      Math.round((safePerimeter / COMPOSER_SHIMMER_SPEED_PX_PER_SEC) * 1000),
    ),
  );

  const waypoints: ComposerShimmerWaypoint[] = [];
  let distance = 0;

  const pushPoint = (x: number, y: number, angleDeg: number) => {
    const offset = Math.min(1, Math.max(0, distance / safePerimeter));
    waypoints.push({
      offset,
      x,
      y,
      angleDeg,
      transform: `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${angleDeg.toFixed(2)}deg)`,
    });
  };

  // Start after top-left corner at (r, 0), travelling clockwise (0deg -> 360deg).
  pushPoint(clampedRadius, 0, 0);

  if (straightH > 0) {
    distance += straightH;
    pushPoint(width - clampedRadius, 0, 0);
  }

  // Top-right 90° corner (0deg -> 90deg)
  if (clampedRadius > 0) {
    const stepArc = cornerArc / COMPOSER_SHIMMER_CORNER_STEPS;
    for (let i = 1; i <= COMPOSER_SHIMMER_CORNER_STEPS; i += 1) {
      const frac = i / COMPOSER_SHIMMER_CORNER_STEPS;
      const theta = frac * (Math.PI / 2);
      distance += stepArc;
      pushPoint(
        width - clampedRadius + clampedRadius * Math.sin(theta),
        clampedRadius - clampedRadius * Math.cos(theta),
        frac * 90,
      );
    }
  } else {
    pushPoint(width, 0, 90);
  }

  if (straightV > 0) {
    distance += straightV;
    pushPoint(width, height - clampedRadius, 90);
  }

  // Bottom-right 90° corner (90deg -> 180deg)
  if (clampedRadius > 0) {
    const stepArc = cornerArc / COMPOSER_SHIMMER_CORNER_STEPS;
    for (let i = 1; i <= COMPOSER_SHIMMER_CORNER_STEPS; i += 1) {
      const frac = i / COMPOSER_SHIMMER_CORNER_STEPS;
      const theta = frac * (Math.PI / 2);
      distance += stepArc;
      pushPoint(
        width - clampedRadius + clampedRadius * Math.cos(theta),
        height - clampedRadius + clampedRadius * Math.sin(theta),
        90 + frac * 90,
      );
    }
  } else {
    pushPoint(width, height, 180);
  }

  if (straightH > 0) {
    distance += straightH;
    pushPoint(clampedRadius, height, 180);
  }

  // Bottom-left 90° corner (180deg -> 270deg)
  if (clampedRadius > 0) {
    const stepArc = cornerArc / COMPOSER_SHIMMER_CORNER_STEPS;
    for (let i = 1; i <= COMPOSER_SHIMMER_CORNER_STEPS; i += 1) {
      const frac = i / COMPOSER_SHIMMER_CORNER_STEPS;
      const theta = frac * (Math.PI / 2);
      distance += stepArc;
      pushPoint(
        clampedRadius - clampedRadius * Math.sin(theta),
        height - clampedRadius + clampedRadius * Math.cos(theta),
        180 + frac * 90,
      );
    }
  } else {
    pushPoint(0, height, 270);
  }

  if (straightV > 0) {
    distance += straightV;
    pushPoint(0, clampedRadius, 270);
  }

  // Top-left 90° corner (270deg -> 360deg) closing seamlessly to (r, 0)
  if (clampedRadius > 0) {
    const stepArc = cornerArc / COMPOSER_SHIMMER_CORNER_STEPS;
    for (let i = 1; i <= COMPOSER_SHIMMER_CORNER_STEPS; i += 1) {
      const frac = i / COMPOSER_SHIMMER_CORNER_STEPS;
      const theta = frac * (Math.PI / 2);
      distance += stepArc;
      pushPoint(
        clampedRadius - clampedRadius * Math.cos(theta),
        clampedRadius - clampedRadius * Math.sin(theta),
        270 + frac * 90,
      );
    }
  } else {
    pushPoint(0, 0, 360);
  }

  const last = waypoints[waypoints.length - 1];
  if (last && last.offset !== 1) {
    waypoints[waypoints.length - 1] = { ...last, offset: 1 };
  }

  const keyframes: Keyframe[] = waypoints.map((pt) => ({
    offset: pt.offset,
    transform: pt.transform,
  }));

  return {
    width,
    height,
    effectiveRadius: clampedRadius,
    perimeter: safePerimeter,
    durationMs,
    waypoints,
    keyframes,
  };
}

function readBorderRadiusPx(element: HTMLElement): number {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") {
    return COMPOSER_SHIMMER_DEFAULT_RADIUS_PX;
  }
  const parsed = Number.parseFloat(window.getComputedStyle(element).borderTopLeftRadius);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : COMPOSER_SHIMMER_DEFAULT_RADIUS_PX;
}

/**
 * Dedicated GPU-compositor-accelerated active composer border shimmer.
 * Mounted strictly while `data-pmx-composer-active="1"` (zero idle overhead).
 */
function ComposerShimmerBorder() {
  const prefersReducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const ringRef = useRef<HTMLDivElement | null>(null);
  const segmentRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const hasWebAnimations =
    typeof Element !== "undefined" && typeof Element.prototype.animate === "function";
  const renderStatic = prefersReducedMotion || !hasWebAnimations;

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- manages imperative GPU WAAPI animations and resize subscription synced to DOM ring geometry
  useLayoutEffect(() => {
    if (renderStatic) return;
    const ring = ringRef.current;
    if (!ring) return;

    let activeAnimations: Animation[] = [];
    let leadAnimation: Animation | null = null;
    let lastWidth = 0;
    let lastHeight = 0;
    let lastRadius = -1;
    let currentPhase = 0;

    const cancelAll = () => {
      for (const anim of activeAnimations) {
        anim.cancel();
      }
      activeAnimations = [];
      leadAnimation = null;
    };

    const syncGeometry = () => {
      const rect = ring.getBoundingClientRect();
      const width = rect.width > 0 ? rect.width : ring.offsetWidth;
      const height = rect.height > 0 ? rect.height : ring.offsetHeight;
      if (width < 4 || height < 4) return;

      const radius = readBorderRadiusPx(ring);
      if (
        activeAnimations.length > 0 &&
        Math.abs(width - lastWidth) < 1 &&
        Math.abs(height - lastHeight) < 1 &&
        Math.abs(radius - lastRadius) < 0.5
      ) {
        return;
      }

      if (leadAnimation) {
        const progress = leadAnimation.effect?.getComputedTiming().progress;
        if (typeof progress === "number" && Number.isFinite(progress)) {
          currentPhase = ((progress % 1) + 1) % 1;
        }
      }

      cancelAll();

      const metrics = computeComposerShimmerMetrics(width, height, radius);
      lastWidth = width;
      lastHeight = height;
      lastRadius = radius;
      ring.dataset.pmxShimmerPerimeter = String(Math.round(metrics.perimeter));
      ring.dataset.pmxShimmerDurationMs = String(metrics.durationMs);

      const maxSafeThickness = Math.max(10, Math.floor(height * 0.42));

      for (const segment of COMPOSER_SHIMMER_SEGMENTS) {
        const node = segmentRefs.current[segment.index];
        if (!node || typeof node.animate !== "function") continue;

        const segWidth = Math.max(
          segment.minPx,
          Math.round(metrics.perimeter * segment.lengthFraction),
        );
        const segHeight = Math.min(segment.thicknessPx, maxSafeThickness);
        node.style.width = `${segWidth}px`;
        node.style.height = `${segHeight}px`;
        node.style.marginLeft = `${-segWidth / 2}px`;
        node.style.marginTop = `${-segHeight / 2}px`;

        const segmentPhase = (((currentPhase - segment.lag) % 1) + 1) % 1;
        const anim = node.animate(metrics.keyframes, {
          duration: metrics.durationMs,
          iterations: Infinity,
          easing: "linear",
          delay: -(segmentPhase * metrics.durationMs),
        });
        activeAnimations.push(anim);
        if (segment.index === 0) {
          leadAnimation = anim;
        }
      }
    };

    syncGeometry();

    const unobserve = observeResize(ring, () => {
      syncGeometry();
    });

    return () => {
      unobserve();
      cancelAll();
    };
  }, [renderStatic]);

  return (
    <div
      ref={ringRef}
      aria-hidden="true"
      data-pmx-composer-shimmer="1"
      data-pmx-composer-shimmer-static={renderStatic ? "1" : "0"}
    >
      {!renderStatic
        ? COMPOSER_SHIMMER_SEGMENTS_PAINT_ORDER.map((segment) => (
            <span
              key={segment.index}
              ref={(node) => {
                segmentRefs.current[segment.index] = node;
              }}
              data-pmx-composer-shimmer-segment={segment.index}
              data-pmx-composer-shimmer-head={segment.index === 0 ? "1" : undefined}
            />
          ))
        : null}
    </div>
  );
}

type ComposerMainProps = ComponentProps<"div"> & {
  "data-pmx-composer-active"?: string;
  "data-pmx-composer-layout"?: string;
};

function Shell({
  contextRow = false,
  className,
  ...props
}: ComponentProps<"div"> & { contextRow?: boolean }) {
  return (
    <div
      data-pmx-glass-zone="composer"
      data-slot="composer-shell"
      data-context-row={contextRow || undefined}
      className={cn(
        "@container/composer-surface group/composer-surface relative isolate mx-auto w-full max-w-(--pmx-chat-content-max-width,var(--chat-content-max-width))",
        "[--chat-composer-drawer-inset:1.375rem] [--chat-composer-glass-surface:var(--card)] [--chat-composer-outline:rgb(0_0_0/8%)]",
        "dark:[--chat-composer-glass-surface:var(--surface-raised)] dark:[--chat-composer-highlight:rgb(255_255_255/3%)] dark:[--chat-composer-outline:color-mix(in_srgb,var(--color-white)_5%,transparent)]",
        "[html[data-theme-id]_&]:[--chat-composer-glass-surface:var(--app-theme-surface-raised)] [html[data-theme-id]_&]:[--chat-composer-outline:var(--app-theme-toolbar-border)]",
        "dark:[html[data-theme-id]:not([data-theme-id=prismux-chat])_&]:[--chat-composer-highlight:color-mix(in_srgb,var(--app-theme-input)_12%,transparent)] dark:[html[data-theme-id]:not([data-theme-id=prismux-chat])_&]:[--chat-composer-outline:color-mix(in_srgb,var(--app-theme-input)_30%,var(--background))]",
        "dark:[html[data-theme-id=prismux-chat]_&]:[--chat-composer-highlight:color-mix(in_srgb,#432d48_12%,transparent)] dark:[html[data-theme-id=prismux-chat]_&]:[--chat-composer-outline:#241e28]",
        "before:pointer-events-none before:absolute before:inset-0 before:z-0 before:rounded-2xl before:bg-(--chat-composer-glass-surface)/(--glass-opacity) before:backdrop-blur-(--glass-blur) before:backdrop-saturate-(--glass-saturation)",
        "not-supports-[((backdrop-filter:blur(1px))_or_(-webkit-backdrop-filter:blur(1px)))]:before:bg-(--chat-composer-glass-surface)",
        "has-data-[composer-banner-surface=attached]:before:hidden",
        // AGY 2.0 dual-layer tray owns the single-pass outer glass; suppress legacy Shell pseudo layers.
        "has-data-[pmx-composer-layout=agy]:shadow-none has-data-[pmx-composer-layout=agy]:before:hidden has-data-[pmx-composer-layout=agy]:after:hidden",
        // With a context row below, the card paints its own glass (see Host) so the row stays bare.
        "data-context-row:before:hidden",
        className,
      )}
      {...props}
    />
  );
}

const outlineClasses =
  "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:border after:border-(--chat-composer-outline) dark:after:inset-shadow-2xs dark:after:inset-shadow-(color:--chat-composer-highlight)";

function Host({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-host"
      className={cn(
        "relative z-10 w-full rounded-2xl shadow-composer after:z-1 dark:shadow-none",
        "group-data-context-row/composer-surface:before:pointer-events-none group-data-context-row/composer-surface:before:absolute group-data-context-row/composer-surface:before:inset-0 group-data-context-row/composer-surface:before:-z-1 group-data-context-row/composer-surface:before:rounded-2xl group-data-context-row/composer-surface:before:bg-(--chat-composer-glass-surface)/(--glass-opacity) group-data-context-row/composer-surface:before:backdrop-blur-(--glass-blur) group-data-context-row/composer-surface:before:backdrop-saturate-(--glass-saturation)",
        outlineClasses,
        "group-has-data-[composer-banner-surface=attached]/composer-surface:shadow-none group-has-data-[composer-banner-surface=attached]/composer-surface:before:hidden group-has-data-[composer-banner-surface=attached]/composer-surface:after:hidden",
        "has-data-[pmx-composer-layout=agy]:shadow-none has-data-[pmx-composer-layout=agy]:before:hidden has-data-[pmx-composer-layout=agy]:after:hidden",
        className,
      )}
      {...props}
    />
  );
}

function Main({ className, children, ...props }: ComposerMainProps) {
  const isShimmerActive = props["data-pmx-composer-active"] === "1";
  return (
    <div
      data-chat-composer-main-surface="true"
      className={cn(
        "group relative z-10 rounded-2xl p-px",
        outlineClasses,
        "after:z-20 after:hidden group-has-data-[composer-banner-surface=attached]/composer-surface:after:block",
        "group-has-data-[composer-banner-surface=attached]/composer-surface:bg-(--chat-composer-glass-surface)/(--glass-opacity) group-has-data-[composer-banner-surface=attached]/composer-surface:backdrop-blur-(--glass-blur) group-has-data-[composer-banner-surface=attached]/composer-surface:backdrop-saturate-(--glass-saturation)",
        "group-has-data-[composer-banner-surface=attached]/composer-surface:shadow-composer dark:group-has-data-[composer-banner-surface=attached]/composer-surface:shadow-none",
        "not-supports-[((backdrop-filter:blur(1px))_or_(-webkit-backdrop-filter:blur(1px)))]:group-has-data-[composer-banner-surface=attached]/composer-surface:bg-(--chat-composer-glass-surface)",
        "group-has-data-[composer-banner-surface=attached]/composer-surface:**:data-[chat-composer-mobile-collapsed=true]:min-h-[calc(1rem+1px)]",
        "data-[pmx-composer-layout=agy]:rounded-[20px] data-[pmx-composer-layout=agy]:p-1 data-[pmx-composer-layout=agy]:shadow-none data-[pmx-composer-layout=agy]:before:hidden data-[pmx-composer-layout=agy]:after:hidden",
        className,
      )}
      {...props}
    >
      {isShimmerActive ? <ComposerShimmerBorder /> : null}
      {children}
    </div>
  );
}

/** A lightweight workspace row below the composer card (host, workspace/worktree, branch). */
function ContextStrip({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-context-strip"
      className={cn(
        "group/composer-context relative mt-1 flex min-h-6 w-full items-center gap-1.5 overflow-x-clip px-2.5 text-muted-foreground/90",
        className,
      )}
      {...props}
    />
  );
}

export const ComposerSurface = { Shell, Host, Main, ContextStrip };
