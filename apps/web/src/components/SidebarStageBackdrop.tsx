import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentIdentificationMode } from "@prismux/core-contracts";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";

import { APP_STAGE_LABEL } from "../branding";
import { resolveServerBackedAppStageLabel } from "../branding.logic";
import { observeResize } from "../lib/observeResize";
import { cn } from "../lib/utils";
import { primaryServerConfigAtom } from "../state/server";
import {
  SKY_COMPACT_STARS,
  SKY_EXTENSION_DEFAULT_GAP_PX,
  SKY_MASK_EXCLUDE,
  SKY_MASK_INCLUDE,
  SKY_RIGHT_FEATHER_INSET_PX,
  SKY_SPARKLE_COLOR,
  SKY_SPARKLES,
  SKY_STAGE_CORNER_RADIUS_PX,
  SKY_STARS,
  SKY_SUN_SPECULAR,
  SKY_VIEWBOX_HEIGHT,
  SKY_VIEWBOX_WIDTH,
  buildSkyExtensionClipPath,
  computeSkyExtensionMetrics,
  computeSkyScene,
  computeStarStepOpacity,
  getSkyClockServerSnapshot,
  getSkyClockSnapshot,
  normalizeMinutesOfDay,
  resolveCompactSkyButtonTheme,
  subscribeSkyClock,
  type SkyExtensionMetrics,
  type SkyScene,
} from "./sidebarSkyBackdrop.logic";
import { useSidebar } from "./ui/sidebar";

export type SidebarStageBackdropVariant = "sky" | "nightly" | "dev";
export type EnvironmentIdentificationPillLabel = "Dev" | "Nightly";

declare global {
  interface Window {
    __PRISMUX_SKY_MINUTES__?: number;
  }
}

/**
 * Default always-on 24-hour dynamic sky backdrop.
 * Never hidden by "none", "pill", or release channel; preserves exported signature for callers.
 */
export function resolveSidebarStageBackdropVariant(
  _stageLabel?: string,
  _mode?: EnvironmentIdentificationMode,
): SidebarStageBackdropVariant {
  return "sky";
}

/**
 * Legacy Dev / Nightly pill badges are retired in favor of the default-on 24h sky artwork.
 */
export function resolveEnvironmentIdentificationPillLabel(
  _stageLabel?: string,
): EnvironmentIdentificationPillLabel | null {
  return null;
}

export function useEnvironmentStageLabel(): string {
  const primaryServerVersion =
    useAtomValue(primaryServerConfigAtom)?.environment.serverVersion ?? null;

  return resolveServerBackedAppStageLabel({
    primaryServerVersion,
    fallbackStageLabel: APP_STAGE_LABEL,
  });
}

export function useSidebarStageBackdropVariant(
  mode?: EnvironmentIdentificationMode,
): SidebarStageBackdropVariant {
  return resolveSidebarStageBackdropVariant(useEnvironmentStageLabel(), mode);
}

export function useDynamicSkyMinutes(minutesOverride?: number): number {
  const clockMinutes = useSyncExternalStore(
    subscribeSkyClock,
    getSkyClockSnapshot,
    getSkyClockServerSnapshot,
  );
  if (typeof minutesOverride === "number" && Number.isFinite(minutesOverride)) {
    return normalizeMinutesOfDay(minutesOverride);
  }
  return clockMinutes;
}

export function SidebarStageBackdrop({
  variant = "sky",
  minutesOverride,
}: {
  readonly variant?: SidebarStageBackdropVariant;
  readonly minutesOverride?: number;
}) {
  const minutes = useDynamicSkyMinutes(minutesOverride);
  const scene = computeSkyScene(minutes);

  return (
    <div
      aria-hidden="true"
      data-stage-backdrop={variant}
      data-sky-phase={scene.phase}
      data-sky-minutes={String(Math.round(scene.minutes))}
      className="sidebar-stage-backdrop pointer-events-none absolute inset-x-0 top-0 z-0 h-20 select-none overflow-hidden"
    >
      <div className="pointer-events-none absolute top-0 left-0 h-full w-[calc(100%+var(--pmx-sky-ext-width,0px))]">
        <DynamicSkyArt scene={scene} />
      </div>
    </div>
  );
}

const DEFAULT_SKY_EXTENSION_METRICS: SkyExtensionMetrics = {
  extensionWidth: SKY_EXTENSION_DEFAULT_GAP_PX,
  topbarHeight: 38,
  seamAlpha: 0.48,
  featherInset: SKY_RIGHT_FEATHER_INSET_PX,
};

function clearSkyExtensionCssVars(wrapper: HTMLElement | null): void {
  if (!wrapper) return;
  wrapper.style.removeProperty("--pmx-sky-ext-width");
  wrapper.style.removeProperty("--pmx-sky-seam-alpha");
  wrapper.style.removeProperty("--pmx-sky-right-feather-inset");
}

/**
 * Softly extends the 24h dynamic sky backdrop rightward across the shell topbar gap
 * until the exact left edge of the first workspace session tab, dissolving smoothly with
 * zero vertical seam, zero click interception, and strict exclusion of the rounded inner stage.
 */
export function SidebarSkyTopbarExtension({
  variant = "sky",
  minutesOverride,
}: {
  readonly variant?: SidebarStageBackdropVariant;
  readonly minutesOverride?: number;
}) {
  const { isMobile, isWidthNarrow, motionPhase } = useSidebar();
  const minutes = useDynamicSkyMinutes(minutesOverride);
  const scene = computeSkyScene(minutes);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState<SkyExtensionMetrics>(DEFAULT_SKY_EXTENSION_METRICS);

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- measures live DOM geometry (sidebar right edge -> first session tab left edge) via ResizeObserver and MutationObserver
  useEffect(() => {
    const anchor = anchorRef.current;
    const wrapper = anchor?.closest<HTMLElement>('[data-slot="sidebar-wrapper"]') ?? null;
    if (!wrapper || isMobile) {
      clearSkyExtensionCssVars(wrapper);
      return;
    }

    let rafId: number | null = null;
    const measure = () => {
      rafId = null;
      const sidebarContainer = wrapper.querySelector<HTMLElement>('[data-slot="sidebar-container"]');
      const tabBar = wrapper.querySelector<HTMLElement>("[data-workspace-tabbar]");
      const firstTab =
        tabBar?.querySelector<HTMLElement>("[data-workspace-tab]") ??
        tabBar?.querySelector<HTMLElement>('[role="tablist"] > *') ??
        null;
      const sidebarRect = sidebarContainer?.getBoundingClientRect() ?? null;
      const tabBarRect = tabBar?.getBoundingClientRect() ?? null;
      const firstTabRect = firstTab?.getBoundingClientRect() ?? null;

      const sidebarRight = sidebarRect ? sidebarRect.right : isWidthNarrow ? 54 : 280;
      const next = computeSkyExtensionMetrics({
        sidebarRight,
        firstTabLeft: firstTabRect ? firstTabRect.left : null,
        topbarHeight: tabBarRect ? tabBarRect.height : 38,
        hasTabBar: tabBar !== null,
      });

      wrapper.style.setProperty("--pmx-sky-ext-width", `${next.extensionWidth}px`);
      wrapper.style.setProperty("--pmx-sky-seam-alpha", String(next.seamAlpha));
      wrapper.style.setProperty("--pmx-sky-right-feather-inset", `${next.featherInset}px`);

      setMetrics((prev) =>
        prev.extensionWidth === next.extensionWidth &&
        prev.topbarHeight === next.topbarHeight &&
        prev.seamAlpha === next.seamAlpha &&
        prev.featherInset === next.featherInset
          ? prev
          : next,
      );
    };

    const scheduleMeasure = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(measure);
    };

    measure();
    if (motionPhase === "collapsing-text" || motionPhase === "expanding-width") {
      scheduleMeasure();
    }

    const resizeTargets: Element[] = [wrapper];
    const sidebarContainer = wrapper.querySelector<HTMLElement>('[data-slot="sidebar-container"]');
    if (sidebarContainer) resizeTargets.push(sidebarContainer);
    const tabBar = wrapper.querySelector<HTMLElement>("[data-workspace-tabbar]");
    if (tabBar) resizeTargets.push(tabBar);
    const stopObservingResize = observeResize(resizeTargets, scheduleMeasure);

    const mutationObserver =
      typeof MutationObserver === "function"
        ? new MutationObserver(scheduleMeasure)
        : null;
    mutationObserver?.observe(wrapper, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "data-workspace-tab", "data-sidebar-state"],
    });
    window.addEventListener("resize", scheduleMeasure);

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      stopObservingResize();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      clearSkyExtensionCssVars(wrapper);
    };
  }, [isMobile, isWidthNarrow, motionPhase]);

  const sidebarOriginVar = isWidthNarrow ? "var(--sidebar-width-icon)" : "var(--sidebar-width)";
  const clippedHeight = Math.min(
    SKY_VIEWBOX_HEIGHT,
    metrics.topbarHeight + SKY_STAGE_CORNER_RADIUS_PX,
  );
  const clipPath = buildSkyExtensionClipPath(
    metrics.extensionWidth,
    metrics.topbarHeight,
    SKY_STAGE_CORNER_RADIUS_PX,
  );

  return (
    <div
      ref={anchorRef}
      aria-hidden="true"
      data-stage-backdrop-extension={variant}
      data-sky-phase={scene.phase}
      data-sky-extension-width={String(metrics.extensionWidth)}
      className={cn(
        "sidebar-stage-backdrop-extension pointer-events-none fixed top-0 z-[9] hidden select-none overflow-hidden md:block",
        (isMobile || metrics.extensionWidth <= 0) && "hidden!",
      )}
      style={
        {
          left: sidebarOriginVar,
          width: `${metrics.extensionWidth}px`,
          height: `${clippedHeight}px`,
          clipPath,
          "--pmx-sky-seam-alpha": String(metrics.seamAlpha),
        } as CSSProperties
      }
    >
      <div
        className="pointer-events-none absolute top-0 left-0 h-20"
        style={{
          width: `calc(${sidebarOriginVar} + ${metrics.extensionWidth}px)`,
          transform: `translateX(calc(-1 * ${sidebarOriginVar}))`,
        }}
      >
        <DynamicSkyArt scene={scene} />
      </div>
    </div>
  );
}

export function StageBackdropButtonArt({
  variant = "sky",
  minutesOverride,
}: {
  readonly variant?: SidebarStageBackdropVariant;
  readonly minutesOverride?: number;
}) {
  const minutes = useDynamicSkyMinutes(minutesOverride);
  const scene = computeSkyScene(minutes);

  return <CompactSkyButtonArt scene={scene} variant={variant} />;
}

function sparkleDiamondPath(x: number, y: number, size: number): string {
  const s = size;
  return `M${x} ${y - s} Q${x} ${y} ${x + s} ${y} Q${x} ${y} ${x} ${y + s} Q${x} ${y} ${x - s} ${y} Q${x} ${y} ${x} ${y - s} Z`;
}

// Layered sculpted cumulus cloud silhouettes crafted for the 288x80 panoramic header.
const MID_CLOUD_LEFT_PATH =
  "M-28 84 L-28 60 C-18 59 -10 53 -2 54 C4 44 16 39 28 42 C36 37 48 39 54 47 C62 45 71 49 75 56 C83 56 90 61 93 68 L102 84 Z";
const MID_CLOUD_CENTER_PATH =
  "M112 84 L118 68 C124 60 134 57 143 60 C149 51 161 48 171 53 C178 49 188 51 193 58 C201 58 208 64 211 72 L218 84 Z";
const MID_CLOUD_RIGHT_PATH =
  "M214 84 L220 64 C227 56 238 52 248 55 C255 44 268 39 280 43 C289 40 299 44 304 52 C311 53 317 59 318 67 L318 84 Z";

const NEAR_CLOUD_LEFT_BODY =
  "M-22 86 L-22 65 C-14 64 -7 59 1 60 C7 49 20 43 33 46 C42 40 56 42 63 51 C72 48 82 52 87 60 C96 59 105 64 109 72 C116 73 121 78 123 86 Z";
const NEAR_CLOUD_RIGHT_BODY =
  "M166 86 C169 76 177 70 186 70 C191 59 203 53 215 55 C223 45 238 41 251 47 C260 43 272 46 278 55 C287 54 297 59 301 68 C307 69 312 76 312 86 Z";
const NEAR_CLOUD_CENTER_PUFF =
  "M100 86 C104 77 112 72 121 73 C127 65 138 62 148 66 C155 62 165 64 170 71 C177 72 183 77 185 86 Z";

function DynamicSkyArt({ scene }: { readonly scene: SkyScene }) {
  const idPrefix = useId().replaceAll(":", "");
  const skyGradId = `${idPrefix}-sky-grad`;
  const atmoGlowId = `${idPrefix}-atmo-glow`;
  const horizonMistId = `${idPrefix}-horizon-mist`;
  const sunOuterId = `${idPrefix}-sun-outer`;
  const sunInnerId = `${idPrefix}-sun-inner`;
  const sunCoreId = `${idPrefix}-sun-core`;
  const moonHaloId = `${idPrefix}-moon-halo`;
  const moonMaskId = `${idPrefix}-moon-mask`;
  const cloudMidGradId = `${idPrefix}-cloud-mid`;
  const cloudNearGradId = `${idPrefix}-cloud-near`;
  const cloudNearRimGradId = `${idPrefix}-cloud-rim`;
  const topScrimId = `${idPrefix}-top-scrim`;
  const softGlowFilterId = `${idPrefix}-soft-glow`;

  const { palette, sun, moon, clouds, stepIndex } = scene;
  const glowOriginX = sun.visible ? sun.x : moon.visible ? moon.x : 144;
  const glowOriginY = sun.visible ? sun.y : moon.visible ? moon.y : 68;
  const showStars = palette.starVisibility > 0.005;

  return (
    <svg
      data-stage-art="sky"
      data-sky-phase={scene.phase}
      className="h-full w-full"
      fill="none"
      preserveAspectRatio="xMidYMin slice"
      viewBox={`0 0 ${SKY_VIEWBOX_WIDTH} ${SKY_VIEWBOX_HEIGHT}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* 4-stop vertical atmospheric sky gradient */}
        <linearGradient id={skyGradId} x1="0" y1="0" x2="0" y2={SKY_VIEWBOX_HEIGHT} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={palette.skyTop} />
          <stop offset="38%" stopColor={palette.skyUpper} />
          <stop offset="72%" stopColor={palette.skyMid} />
          <stop offset="100%" stopColor={palette.skyHorizon} />
        </linearGradient>

        {/* Celestial atmospheric scatter glow */}
        <radialGradient
          id={atmoGlowId}
          cx={glowOriginX}
          cy={glowOriginY}
          r="116"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor={palette.atmosphereGlowColor} stopOpacity={palette.atmosphereGlowOpacity} />
          <stop
            offset="48%"
            stopColor={palette.atmosphereGlowColor}
            stopOpacity={Math.round(palette.atmosphereGlowOpacity * 0.34 * 100) / 100}
          />
          <stop offset="100%" stopColor={palette.atmosphereGlowColor} stopOpacity="0" />
        </radialGradient>

        {/* Soft atmospheric horizon mist band */}
        <linearGradient
          id={horizonMistId}
          x1="0"
          y1="44"
          x2="0"
          y2={SKY_VIEWBOX_HEIGHT}
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor={palette.horizonMistColor} stopOpacity="0" />
          <stop
            offset="58%"
            stopColor={palette.horizonMistColor}
            stopOpacity={Math.round(palette.horizonMistOpacity * 0.65 * 100) / 100}
          />
          <stop offset="100%" stopColor={palette.horizonMistColor} stopOpacity={palette.horizonMistOpacity} />
        </linearGradient>

        {/* Sun concentric radiance gradients */}
        {sun.visible ? (
          <>
            <radialGradient id={sunOuterId} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={sun.outerGlowColor} stopOpacity="0.56" />
              <stop offset="46%" stopColor={sun.outerGlowColor} stopOpacity="0.2" />
              <stop offset="100%" stopColor={sun.outerGlowColor} stopOpacity="0" />
            </radialGradient>
            <radialGradient id={sunInnerId} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={sun.coreColor} stopOpacity="0.92" />
              <stop offset="52%" stopColor={sun.innerGlowColor} stopOpacity="0.46" />
              <stop offset="100%" stopColor={sun.innerGlowColor} stopOpacity="0" />
            </radialGradient>
            <radialGradient id={sunCoreId} cx="42%" cy="38%" r="62%">
              <stop offset="0%" stopColor={SKY_SUN_SPECULAR} />
              <stop offset="65%" stopColor={sun.coreColor} />
              <stop offset="100%" stopColor={sun.innerGlowColor} />
            </radialGradient>
          </>
        ) : null}

        {/* Crescent moon halo & crisp cutout mask */}
        {moon.visible ? (
          <>
            <radialGradient id={moonHaloId} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={moon.haloColor} stopOpacity="0.48" />
              <stop offset="45%" stopColor={moon.haloColor} stopOpacity="0.16" />
              <stop offset="100%" stopColor={moon.haloColor} stopOpacity="0" />
            </radialGradient>
            <mask id={moonMaskId} maskUnits="userSpaceOnUse" x={moon.x - 16} y={moon.y - 16} width="32" height="32">
              <circle cx={moon.x} cy={moon.y} r={moon.radius} fill={SKY_MASK_INCLUDE} />
              <circle
                cx={moon.x + moon.radius * 0.45}
                cy={moon.y - moon.radius * 0.24}
                r={moon.radius * 0.87}
                fill={SKY_MASK_EXCLUDE}
              />
            </mask>
          </>
        ) : null}

        {/* Sculpted cloud depth gradients (sunlit top -> cool underside) */}
        <linearGradient id={cloudMidGradId} x1="0" y1="38" x2="0" y2="82" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={palette.cloudHighlight} stopOpacity="0.92" />
          <stop offset="48%" stopColor={palette.cloudBody} stopOpacity="0.86" />
          <stop offset="100%" stopColor={palette.cloudShadow} stopOpacity="0.72" />
        </linearGradient>

        <linearGradient id={cloudNearGradId} x1="0" y1="42" x2="0" y2="84" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={palette.cloudHighlight} stopOpacity="0.98" />
          <stop offset="36%" stopColor={palette.cloudBody} stopOpacity="0.96" />
          <stop offset="100%" stopColor={palette.cloudShadow} stopOpacity="0.9" />
        </linearGradient>

        <linearGradient id={cloudNearRimGradId} x1="0" y1="40" x2="0" y2="66" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={palette.cloudHighlight} stopOpacity="0.95" />
          <stop offset="65%" stopColor={palette.cloudHighlight} stopOpacity="0.32" />
          <stop offset="100%" stopColor={palette.cloudHighlight} stopOpacity="0" />
        </linearGradient>

        {/* Subtle zenith depth scrim guaranteeing >= 4.5:1 white text contrast across 24h */}
        <linearGradient id={topScrimId} x1="0" y1="0" x2="0" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={palette.topScrimColor} stopOpacity={palette.topScrimOpacity} />
          <stop
            offset="55%"
            stopColor={palette.topScrimColor}
            stopOpacity={Math.round(palette.topScrimOpacity * 0.62 * 100) / 100}
          />
          <stop offset="100%" stopColor={palette.topScrimColor} stopOpacity="0" />
        </linearGradient>

        {/* Lightweight blur for distant atmospheric wisps */}
        <filter id={softGlowFilterId} x="-12%" y="-18%" width="124%" height="136%">
          <feGaussianBlur stdDeviation="1.4" />
        </filter>
      </defs>

      {/* 1. Primary 24h atmospheric sky */}
      <rect width={SKY_VIEWBOX_WIDTH} height={SKY_VIEWBOX_HEIGHT} fill={`url(#${skyGradId})`} />

      {/* 2. Celestial atmospheric scatter glow */}
      <rect width={SKY_VIEWBOX_WIDTH} height={SKY_VIEWBOX_HEIGHT} fill={`url(#${atmoGlowId})`} />

      {/* 3. Horizon mist */}
      <rect
        y="44"
        width={SKY_VIEWBOX_WIDTH}
        height={SKY_VIEWBOX_HEIGHT - 44}
        fill={`url(#${horizonMistId})`}
      />

      {/* 4. Starfield & 4-point diamond sparkles (dusk / night / dawn) */}
      {showStars ? (
        <g data-sky-layer="stars" opacity={palette.starVisibility}>
          {SKY_STARS.map((star) => (
            <circle
              key={`star-${star.x}-${star.y}`}
              cx={star.x}
              cy={star.y}
              r={star.r}
              fill={star.color}
              fillOpacity={computeStarStepOpacity(star.baseOpacity, star.phase, stepIndex, 1)}
            />
          ))}
          {SKY_SPARKLES.map((sparkle) => (
            <path
              key={`sparkle-${sparkle.x}-${sparkle.y}`}
              d={sparkleDiamondPath(sparkle.x, sparkle.y, sparkle.size)}
              fill={SKY_SPARKLE_COLOR}
              fillOpacity={computeStarStepOpacity(sparkle.baseOpacity, sparkle.phase, stepIndex, 1)}
            />
          ))}
        </g>
      ) : null}

      {/* 5. High-altitude wispy cirrus clouds */}
      <g
        data-sky-layer="clouds-cirrus"
        opacity={palette.cirrusOpacity}
        transform={`translate(${clouds.highDriftX} 0)`}
        filter={`url(#${softGlowFilterId})`}
      >
        <path
          d="M12 22 C30 18 52 19 72 23 C54 24 32 24 12 22 Z"
          fill={palette.cloudHighlight}
          fillOpacity="0.72"
        />
        <path
          d="M148 16 C172 12 204 13 228 18 C202 19 172 19 148 16 Z"
          fill={palette.cloudHighlight}
          fillOpacity="0.65"
        />
        <path
          d="M84 32 C104 28 128 29 144 33 C124 34 102 34 84 32 Z"
          fill={palette.cloudHighlight}
          fillOpacity="0.52"
        />
      </g>

      {/* 6a. Solar orb & concentric glow */}
      {sun.visible ? (
        <g
          data-sky-body="sun"
          data-celestial-x={String(sun.x)}
          data-celestial-y={String(sun.y)}
          opacity={sun.opacity}
        >
          <circle cx={sun.x} cy={sun.y} r={sun.radius * 5.2} fill={`url(#${sunOuterId})`} />
          <circle cx={sun.x} cy={sun.y} r={sun.radius * 2.25} fill={`url(#${sunInnerId})`} />
          <circle cx={sun.x} cy={sun.y} r={sun.radius} fill={`url(#${sunCoreId})`} />
        </g>
      ) : null}

      {/* 6b. Crescent moon & cool lunar halo */}
      {moon.visible ? (
        <g
          data-sky-body="moon"
          data-celestial-x={String(moon.x)}
          data-celestial-y={String(moon.y)}
          opacity={moon.opacity}
        >
          <circle cx={moon.x} cy={moon.y} r={moon.radius * 4.2} fill={`url(#${moonHaloId})`} />
          <g transform={`rotate(${moon.tiltDeg} ${moon.x} ${moon.y})`}>
            <circle
              cx={moon.x}
              cy={moon.y}
              r={moon.radius}
              fill={moon.fillColor}
              mask={`url(#${moonMaskId})`}
            />
          </g>
        </g>
      ) : null}

      {/* 7a. Mid-distance layered cumulus cloud bank */}
      <g
        data-sky-layer="clouds-mid"
        opacity={Math.round(palette.cloudOpacity * 0.64 * 100) / 100}
        transform={`translate(${clouds.midDriftX} 0)`}
      >
        <path d={MID_CLOUD_LEFT_PATH} fill={`url(#${cloudMidGradId})`} />
        <path d={MID_CLOUD_CENTER_PATH} fill={`url(#${cloudMidGradId})`} fillOpacity="0.82" />
        <path d={MID_CLOUD_RIGHT_PATH} fill={`url(#${cloudMidGradId})`} />
      </g>

      {/* 7b. Foreground sculpted cumulus clusters with directional sunlit rims */}
      <g
        data-sky-layer="clouds-near"
        opacity={palette.cloudOpacity}
        transform={`translate(${clouds.nearDriftX} 0)`}
      >
        {/* Directional bright crown highlight */}
        <g transform={`translate(${clouds.rimOffsetX} ${clouds.rimOffsetY})`}>
          <path d={NEAR_CLOUD_LEFT_BODY} fill={`url(#${cloudNearRimGradId})`} />
          <path d={NEAR_CLOUD_RIGHT_BODY} fill={`url(#${cloudNearRimGradId})`} />
          <path d={NEAR_CLOUD_CENTER_PUFF} fill={`url(#${cloudNearRimGradId})`} fillOpacity="0.72" />
        </g>
        {/* Sculpted cloud bodies with sky-tinted underside shading */}
        <path d={NEAR_CLOUD_LEFT_BODY} fill={`url(#${cloudNearGradId})`} />
        <path d={NEAR_CLOUD_CENTER_PUFF} fill={`url(#${cloudNearGradId})`} fillOpacity="0.88" />
        <path d={NEAR_CLOUD_RIGHT_BODY} fill={`url(#${cloudNearGradId})`} />
      </g>

      {/* 8. Subtle luminance-calibrated zenith depth veil for crisp header readability */}
      <rect width={SKY_VIEWBOX_WIDTH} height="42" fill={`url(#${topScrimId})`} />
    </svg>
  );
}

function CompactSkyButtonArt({
  scene,
  variant,
}: {
  readonly scene: SkyScene;
  readonly variant: SidebarStageBackdropVariant;
}) {
  const idPrefix = useId().replaceAll(":", "");
  const gradId = `${idPrefix}-btn-sky`;
  const glowId = `${idPrefix}-btn-glow`;
  const moonMaskId = `${idPrefix}-btn-moon-mask`;
  const { palette, sun, moon } = scene;
  const buttonTheme = resolveCompactSkyButtonTheme(scene);
  const showStars = palette.starVisibility > 0.12;

  return (
    <svg
      data-stage-art={variant === "sky" ? "sky-compact" : variant}
      data-sky-phase={scene.phase}
      data-sky-button-tone={buttonTheme.tone}
      className="h-full w-full"
      fill="none"
      preserveAspectRatio="xMidYMid slice"
      viewBox="0 0 36 36"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={buttonTheme.skyTop} />
          <stop offset="56%" stopColor={buttonTheme.skyMid} />
          <stop offset="100%" stopColor={buttonTheme.skyBottom} />
        </linearGradient>
        <radialGradient id={glowId} cx="72%" cy="24%" r="58%">
          <stop
            offset="0%"
            stopColor={palette.atmosphereGlowColor}
            stopOpacity={Math.round(palette.atmosphereGlowOpacity * 0.68 * 100) / 100}
          />
          <stop offset="100%" stopColor={palette.atmosphereGlowColor} stopOpacity="0" />
        </radialGradient>
        {moon.visible ? (
          <mask id={moonMaskId} maskUnits="userSpaceOnUse" x="18" y="2" width="14" height="14">
            <circle cx="25.5" cy="9.5" r="3.1" fill={SKY_MASK_INCLUDE} />
            <circle cx="26.9" cy="8.7" r="2.7" fill={SKY_MASK_EXCLUDE} />
          </mask>
        ) : null}
      </defs>

      <rect width="36" height="36" fill={`url(#${gradId})`} />
      <rect width="36" height="36" fill={`url(#${glowId})`} />

      {showStars ? (
        <g opacity={palette.starVisibility * 0.85}>
          {SKY_COMPACT_STARS.map((star) => (
            <circle
              key={`btn-star-${star.cx}-${star.cy}`}
              cx={star.cx}
              cy={star.cy}
              r={star.r}
              fill={star.color}
            />
          ))}
        </g>
      ) : null}

      {sun.visible ? (
        <circle cx="26" cy="9.5" r="3.2" fill={sun.coreColor} fillOpacity={sun.opacity * 0.85} />
      ) : moon.visible ? (
        <circle
          cx="25.5"
          cy="9.5"
          r="3.1"
          fill={moon.fillColor}
          fillOpacity={moon.opacity * 0.88}
          mask={`url(#${moonMaskId})`}
        />
      ) : null}

      {/* Soft miniature bottom cloud wisp */}
      <path
        d="M-2 37 C2 31 8 29 13 31 C17 27 24 27 28 31 C32 30 36 32 38 37 Z"
        fill={palette.cloudHighlight}
        fillOpacity={Math.round(palette.cloudOpacity * (buttonTheme.isBrightDaytime ? 0.52 : 0.34) * 100) / 100}
      />

      {/* Luminance-calibrated readability veil guaranteeing >= 4.5:1 day/night send arrow contrast */}
      <rect
        width="36"
        height="36"
        fill={buttonTheme.scrimColor}
        fillOpacity={buttonTheme.scrimOpacity}
      />
    </svg>
  );
}
