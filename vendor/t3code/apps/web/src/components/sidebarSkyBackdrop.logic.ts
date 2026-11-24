/**
 * Pure 24-hour dynamic sky & celestial illustration engine (0 LLM token cost, zero canvas/RAF).
 * Interpolates 9 atmospheric keyframes across 288 5-minute steps with WCAG AA header contrast.
 */

export const SKY_MASK_INCLUDE = "#FFFFFF";
export const SKY_MASK_EXCLUDE = "#000000";
export const SKY_SUN_SPECULAR = "#FFFFFF";
export const SKY_SPARKLE_COLOR = "#F6FAFF";
export const SKY_COMPACT_STARS: ReadonlyArray<{
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly color: string;
}> = [
  { cx: 9, cy: 10, r: 0.7, color: "#FFFFFF" },
  { cx: 15, cy: 7.5, r: 0.55, color: "#DCEBFF" },
  { cx: 29, cy: 17, r: 0.55, color: "#FFF2D6" },
];

export const MINUTES_PER_DAY = 1440;
export const SKY_STEP_MINUTES = 5;
export const SKY_FRAMES_PER_DAY = MINUTES_PER_DAY / SKY_STEP_MINUTES;
export const SKY_UPDATE_INTERVAL_MS = SKY_STEP_MINUTES * 60 * 1000;
export const SKY_TIME_CHANGE_EVENT = "prismux:sky-time-change";

export const SKY_VIEWBOX_WIDTH = 288;
export const SKY_VIEWBOX_HEIGHT = 80;

export type SkyPhaseId =
  | "midnight"
  | "dawn"
  | "sunrise"
  | "morning"
  | "noon"
  | "afternoon"
  | "sunset"
  | "blue-hour"
  | "night";

export interface SkyKeyframe {
  readonly id: SkyPhaseId;
  readonly minute: number;
  readonly skyTop: string;
  readonly skyUpper: string;
  readonly skyMid: string;
  readonly skyHorizon: string;
  readonly cloudHighlight: string;
  readonly cloudBody: string;
  readonly cloudShadow: string;
  readonly cloudOpacity: number;
  readonly cirrusOpacity: number;
  readonly atmosphereGlowColor: string;
  readonly atmosphereGlowOpacity: number;
  readonly horizonMistColor: string;
  readonly horizonMistOpacity: number;
  readonly starVisibility: number;
  readonly topScrimColor: string;
  readonly topScrimOpacity: number;
}

export interface SkySunState {
  readonly visible: boolean;
  readonly progress: number;
  readonly elevation: number;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly opacity: number;
  readonly coreColor: string;
  readonly innerGlowColor: string;
  readonly outerGlowColor: string;
}

export interface SkyMoonState {
  readonly visible: boolean;
  readonly progress: number;
  readonly elevation: number;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly opacity: number;
  readonly tiltDeg: number;
  readonly fillColor: string;
  readonly haloColor: string;
}

export interface SkyCloudMotion {
  readonly highDriftX: number;
  readonly midDriftX: number;
  readonly nearDriftX: number;
  readonly rimOffsetX: number;
  readonly rimOffsetY: number;
}

export interface SkyPalette {
  readonly skyTop: string;
  readonly skyUpper: string;
  readonly skyMid: string;
  readonly skyHorizon: string;
  readonly cloudHighlight: string;
  readonly cloudBody: string;
  readonly cloudShadow: string;
  readonly cloudOpacity: number;
  readonly cirrusOpacity: number;
  readonly atmosphereGlowColor: string;
  readonly atmosphereGlowOpacity: number;
  readonly horizonMistColor: string;
  readonly horizonMistOpacity: number;
  readonly starVisibility: number;
  readonly topScrimColor: string;
  readonly topScrimOpacity: number;
}

export interface SkyScene {
  readonly minutes: number;
  readonly stepIndex: number;
  readonly phase: SkyPhaseId;
  readonly palette: SkyPalette;
  readonly sun: SkySunState;
  readonly moon: SkyMoonState;
  readonly clouds: SkyCloudMotion;
}

export interface SkyStarSpec {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly baseOpacity: number;
  readonly color: string;
  readonly phase: number;
}

export interface SkySparkleSpec {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly baseOpacity: number;
  readonly phase: number;
}

/**
 * 9 hand-tuned atmospheric keyframes spanning 00:00 -> 24:00 (wrapping seamlessly
 * back to midnight). Every zenith & upper-band color is calibrated so white sidebar
 * header typography maintains >= 4.5:1 WCAG AA contrast across all 288 5-minute steps.
 */
export const SKY_KEYFRAMES: ReadonlyArray<SkyKeyframe> = [
  {
    id: "midnight",
    minute: 0, // 00:00
    skyTop: "#070C1E",
    skyUpper: "#0D1736",
    skyMid: "#15254E",
    skyHorizon: "#203668",
    cloudHighlight: "#526A9E",
    cloudBody: "#243866",
    cloudShadow: "#132042",
    cloudOpacity: 0.56,
    cirrusOpacity: 0.16,
    atmosphereGlowColor: "#6E95E8",
    atmosphereGlowOpacity: 0.24,
    horizonMistColor: "#263E74",
    horizonMistOpacity: 0.22,
    starVisibility: 1.0,
    topScrimColor: "#050918",
    topScrimOpacity: 0.04,
  },
  {
    id: "dawn",
    minute: 315, // 05:15
    skyTop: "#161E46",
    skyUpper: "#2D2D66",
    skyMid: "#744B7E",
    skyHorizon: "#E89B8B",
    cloudHighlight: "#F9C6AE",
    cloudBody: "#B47A96",
    cloudShadow: "#4D3C6B",
    cloudOpacity: 0.76,
    cirrusOpacity: 0.26,
    atmosphereGlowColor: "#F6A58A",
    atmosphereGlowOpacity: 0.38,
    horizonMistColor: "#F5B29A",
    horizonMistOpacity: 0.36,
    starVisibility: 0.36,
    topScrimColor: "#0D1330",
    topScrimOpacity: 0.08,
  },
  {
    id: "sunrise",
    minute: 375, // 06:15
    skyTop: "#19448A",
    skyUpper: "#2F63A8",
    skyMid: "#D9856C",
    skyHorizon: "#FFD18C",
    cloudHighlight: "#FFF3D6",
    cloudBody: "#F5B796",
    cloudShadow: "#8F6A8C",
    cloudOpacity: 0.88,
    cirrusOpacity: 0.34,
    atmosphereGlowColor: "#FFCE75",
    atmosphereGlowOpacity: 0.58,
    horizonMistColor: "#FFE0A3",
    horizonMistOpacity: 0.42,
    starVisibility: 0.0,
    topScrimColor: "#0B224D",
    topScrimOpacity: 0.14,
  },
  {
    id: "morning",
    minute: 570, // 09:30
    skyTop: "#1563C4",
    skyUpper: "#237DE0",
    skyMid: "#54AEF7",
    skyHorizon: "#B5E3FF",
    cloudHighlight: "#FFFFFF",
    cloudBody: "#EDF6FF",
    cloudShadow: "#9FC6EC",
    cloudOpacity: 0.95,
    cirrusOpacity: 0.36,
    atmosphereGlowColor: "#FFF6CC",
    atmosphereGlowOpacity: 0.48,
    horizonMistColor: "#D2EEFF",
    horizonMistOpacity: 0.3,
    starVisibility: 0.0,
    topScrimColor: "#082046",
    topScrimOpacity: 0.18,
  },
  {
    id: "noon",
    minute: 780, // 13:00
    skyTop: "#1159BC",
    skyUpper: "#1F75DB",
    skyMid: "#4CA8F5",
    skyHorizon: "#AEE0FF",
    cloudHighlight: "#FFFFFF",
    cloudBody: "#F0F7FF",
    cloudShadow: "#95BFE8",
    cloudOpacity: 0.92,
    cirrusOpacity: 0.34,
    atmosphereGlowColor: "#FFF9DB",
    atmosphereGlowOpacity: 0.52,
    horizonMistColor: "#CCE9FF",
    horizonMistOpacity: 0.28,
    starVisibility: 0.0,
    topScrimColor: "#071D40",
    topScrimOpacity: 0.18,
  },
  {
    id: "afternoon",
    minute: 1005, // 16:45
    skyTop: "#1857AE",
    skyUpper: "#2D70C7",
    skyMid: "#74A8DF",
    skyHorizon: "#F2D3A4",
    cloudHighlight: "#FFF8E6",
    cloudBody: "#F3E4CE",
    cloudShadow: "#95A5C6",
    cloudOpacity: 0.9,
    cirrusOpacity: 0.32,
    atmosphereGlowColor: "#FFE09E",
    atmosphereGlowOpacity: 0.5,
    horizonMistColor: "#F7DCB0",
    horizonMistOpacity: 0.34,
    starVisibility: 0.0,
    topScrimColor: "#0A2145",
    topScrimOpacity: 0.16,
  },
  {
    id: "sunset",
    minute: 1090, // 18:10
    skyTop: "#1F275C",
    skyUpper: "#4F386E",
    skyMid: "#D15E4E",
    skyHorizon: "#FFAE52",
    cloudHighlight: "#FFE09A",
    cloudBody: "#EA7D5E",
    cloudShadow: "#5D365B",
    cloudOpacity: 0.92,
    cirrusOpacity: 0.34,
    atmosphereGlowColor: "#FF9E42",
    atmosphereGlowOpacity: 0.64,
    horizonMistColor: "#FFC16E",
    horizonMistOpacity: 0.45,
    starVisibility: 0.08,
    topScrimColor: "#101433",
    topScrimOpacity: 0.1,
  },
  {
    id: "blue-hour",
    minute: 1170, // 19:30
    skyTop: "#0D1538",
    skyUpper: "#1A2558",
    skyMid: "#313D78",
    skyHorizon: "#6E5A82",
    cloudHighlight: "#9AA9DA",
    cloudBody: "#3F4C82",
    cloudShadow: "#1C2652",
    cloudOpacity: 0.72,
    cirrusOpacity: 0.22,
    atmosphereGlowColor: "#93B8FF",
    atmosphereGlowOpacity: 0.34,
    horizonMistColor: "#7D658F",
    horizonMistOpacity: 0.28,
    starVisibility: 0.62,
    topScrimColor: "#070C22",
    topScrimOpacity: 0.06,
  },
  {
    id: "night",
    minute: 1290, // 21:30
    skyTop: "#090F24",
    skyUpper: "#0F1A38",
    skyMid: "#16254C",
    skyHorizon: "#223666",
    cloudHighlight: "#5A75AD",
    cloudBody: "#263B6B",
    cloudShadow: "#142246",
    cloudOpacity: 0.6,
    cirrusOpacity: 0.18,
    atmosphereGlowColor: "#7EA6F2",
    atmosphereGlowOpacity: 0.28,
    horizonMistColor: "#294078",
    horizonMistOpacity: 0.22,
    starVisibility: 0.96,
    topScrimColor: "#060A18",
    topScrimOpacity: 0.04,
  },
];

export const SKY_STARS: ReadonlyArray<SkyStarSpec> = [
  { x: 14, y: 9, r: 0.85, baseOpacity: 0.92, color: "#FFFFFF", phase: 0.2 },
  { x: 29, y: 24, r: 0.55, baseOpacity: 0.68, color: "#DCEBFF", phase: 1.4 },
  { x: 42, y: 11, r: 0.65, baseOpacity: 0.78, color: "#FFF2D6", phase: 2.3 },
  { x: 56, y: 31, r: 0.5, baseOpacity: 0.56, color: "#DCEBFF", phase: 0.7 },
  { x: 68, y: 8, r: 0.9, baseOpacity: 0.9, color: "#FFFFFF", phase: 3.1 },
  { x: 82, y: 19, r: 0.55, baseOpacity: 0.64, color: "#E6F0FF", phase: 1.9 },
  { x: 96, y: 34, r: 0.5, baseOpacity: 0.54, color: "#DCEBFF", phase: 4.0 },
  { x: 109, y: 12, r: 0.75, baseOpacity: 0.84, color: "#FFF4DC", phase: 2.8 },
  { x: 122, y: 25, r: 0.55, baseOpacity: 0.62, color: "#FFFFFF", phase: 0.5 },
  { x: 136, y: 7, r: 0.95, baseOpacity: 0.94, color: "#FFFFFF", phase: 1.1 },
  { x: 149, y: 29, r: 0.5, baseOpacity: 0.58, color: "#DCEBFF", phase: 3.6 },
  { x: 162, y: 14, r: 0.7, baseOpacity: 0.82, color: "#E6F0FF", phase: 2.1 },
  { x: 176, y: 36, r: 0.48, baseOpacity: 0.5, color: "#DCEBFF", phase: 4.5 },
  { x: 188, y: 9, r: 0.85, baseOpacity: 0.88, color: "#FFF2D6", phase: 0.9 },
  { x: 201, y: 22, r: 0.6, baseOpacity: 0.72, color: "#FFFFFF", phase: 3.3 },
  { x: 214, y: 12, r: 0.7, baseOpacity: 0.8, color: "#DCEBFF", phase: 1.6 },
  { x: 227, y: 31, r: 0.52, baseOpacity: 0.56, color: "#E6F0FF", phase: 2.7 },
  { x: 239, y: 8, r: 0.9, baseOpacity: 0.92, color: "#FFFFFF", phase: 4.2 },
  { x: 252, y: 21, r: 0.6, baseOpacity: 0.7, color: "#FFF4DC", phase: 0.4 },
  { x: 266, y: 11, r: 0.78, baseOpacity: 0.85, color: "#FFFFFF", phase: 2.0 },
  { x: 277, y: 27, r: 0.52, baseOpacity: 0.6, color: "#DCEBFF", phase: 3.8 },
  { x: 22, y: 40, r: 0.45, baseOpacity: 0.44, color: "#DCEBFF", phase: 1.2 },
  { x: 74, y: 42, r: 0.45, baseOpacity: 0.42, color: "#E6F0FF", phase: 2.9 },
  { x: 128, y: 39, r: 0.48, baseOpacity: 0.46, color: "#FFFFFF", phase: 4.1 },
  { x: 194, y: 41, r: 0.45, baseOpacity: 0.44, color: "#DCEBFF", phase: 0.8 },
  { x: 260, y: 38, r: 0.48, baseOpacity: 0.48, color: "#E6F0FF", phase: 3.2 },
];

export const SKY_SPARKLES: ReadonlyArray<SkySparkleSpec> = [
  { x: 48, y: 22, size: 2.6, baseOpacity: 0.88, phase: 0.6 },
  { x: 116, y: 17, size: 2.3, baseOpacity: 0.82, phase: 2.1 },
  { x: 170, y: 26, size: 2.9, baseOpacity: 0.9, phase: 3.4 },
  { x: 228, y: 18, size: 2.4, baseOpacity: 0.84, phase: 1.3 },
  { x: 270, y: 32, size: 2.1, baseOpacity: 0.74, phase: 4.3 },
];

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function smoothstep(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

function blendedEase(t: number): number {
  const c = clamp(t, 0, 1);
  // Subtle blend of linear and smoothstep prevents stalling at keyframe knots while remaining silky.
  return 0.3 * c + 0.7 * smoothstep(c);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function parseHexRgb(hex: string): RgbColor {
  const clean = hex.trim().replace(/^#/, "");
  const normalized =
    clean.length === 3
      ? `${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`
      : clean;
  const int = Number.parseInt(normalized.slice(0, 6), 16);
  if (!Number.isFinite(int)) return { r: 0, g: 0, b: 0 };
  return {
    r: (int >> 16) & 0xff,
    g: (int >> 8) & 0xff,
    b: int & 0xff,
  };
}

export function formatHexRgb(rgb: RgbColor): string {
  const toHex = (channel: number) =>
    clamp(Math.round(channel), 0, 255).toString(16).padStart(2, "0");
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

export function lerpHexColor(fromHex: string, toHex: string, t: number): string {
  const factor = clamp(t, 0, 1);
  const a = parseHexRgb(fromHex);
  const b = parseHexRgb(toHex);
  return formatHexRgb({
    r: lerp(a.r, b.r, factor),
    g: lerp(a.g, b.g, factor),
    b: lerp(a.b, b.b, factor),
  });
}

export function compositeHexOver(fgHex: string, fgAlpha: number, bgHex: string): string {
  const a = clamp(fgAlpha, 0, 1);
  const fg = parseHexRgb(fgHex);
  const bg = parseHexRgb(bgHex);
  return formatHexRgb({
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
  });
}

function srgbChannelToLinear(channel255: number): number {
  const s = clamp(channel255 / 255, 0, 1);
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function computeRelativeLuminance(hex: string): number {
  const { r, g, b } = parseHexRgb(hex);
  return (
    0.2126 * srgbChannelToLinear(r) +
    0.7152 * srgbChannelToLinear(g) +
    0.0722 * srgbChannelToLinear(b)
  );
}

export function computeContrastRatio(hexA: string, hexB: string): number {
  const lA = computeRelativeLuminance(hexA);
  const lB = computeRelativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Evaluates the WCAG contrast ratio of pure white header text (#FFFFFF) against the
 * effective sky color behind the 0..36px header bar (including the dynamic zenith scrim).
 */
export function computeEffectiveTopSkyContrast(scene: SkyScene): {
  readonly zenithContrast: number;
  readonly headerMidContrast: number;
  readonly minHeaderContrast: number;
} {
  const zenithEffective = compositeHexOver(
    scene.palette.topScrimColor,
    scene.palette.topScrimOpacity,
    scene.palette.skyTop,
  );
  // Header text center sits around y=20px (~25% of 80px height), between skyTop (0%) and skyUpper (38%).
  const headerBase = lerpHexColor(scene.palette.skyTop, scene.palette.skyUpper, 0.65);
  const headerEffective = compositeHexOver(
    scene.palette.topScrimColor,
    scene.palette.topScrimOpacity * 0.72,
    headerBase,
  );
  const zenithContrast = computeContrastRatio("#ffffff", zenithEffective);
  const headerMidContrast = computeContrastRatio("#ffffff", headerEffective);
  return {
    zenithContrast: round2(zenithContrast),
    headerMidContrast: round2(headerMidContrast),
    minHeaderContrast: round2(Math.min(zenithContrast, headerMidContrast)),
  };
}

export function normalizeMinutesOfDay(minutes: number): number {
  if (!Number.isFinite(minutes)) return 0;
  const wrapped = minutes % MINUTES_PER_DAY;
  return wrapped < 0 ? wrapped + MINUTES_PER_DAY : wrapped;
}

export function quantizeMinutesToSkyStep(minutes: number): number {
  const normalized = normalizeMinutesOfDay(minutes);
  return Math.floor(normalized / SKY_STEP_MINUTES) * SKY_STEP_MINUTES;
}

export function computeMsUntilNextSkyTick(now: Date): number {
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const milliseconds = now.getMilliseconds();
  const minutesPastStep = minutes % SKY_STEP_MINUTES;
  const remainingMs =
    (SKY_STEP_MINUTES - minutesPastStep) * 60_000 - seconds * 1000 - milliseconds;
  return clamp(remainingMs, 250, SKY_UPDATE_INTERVAL_MS);
}

export function readGlobalSkyMinutesOverride(): number | null {
  if (typeof globalThis === "undefined") return null;
  const candidate = (
    globalThis as typeof globalThis & { __PRISMUX_SKY_MINUTES__?: unknown }
  ).__PRISMUX_SKY_MINUTES__;
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    return null;
  }
  return normalizeMinutesOfDay(candidate);
}

export function resolveEffectiveSkyMinutes(options?: {
  readonly now?: Date;
  readonly minutesOverride?: number | null | undefined;
}): number {
  if (typeof options?.minutesOverride === "number" && Number.isFinite(options.minutesOverride)) {
    return normalizeMinutesOfDay(options.minutesOverride);
  }
  const globalOverride = readGlobalSkyMinutesOverride();
  if (globalOverride !== null) {
    return globalOverride;
  }
  const now = options?.now ?? new Date();
  return quantizeMinutesToSkyStep(now.getHours() * 60 + now.getMinutes());
}

function interpolateSkyPalette(minutes: number): {
  readonly phase: SkyPhaseId;
  readonly palette: SkyPalette;
} {
  const count = SKY_KEYFRAMES.length;
  let lowerIndex = count - 1;
  for (let i = 0; i < count; i += 1) {
    if (SKY_KEYFRAMES[i]!.minute <= minutes) {
      lowerIndex = i;
    } else {
      break;
    }
  }
  const upperIndex = (lowerIndex + 1) % count;
  const from = SKY_KEYFRAMES[lowerIndex]!;
  const to = SKY_KEYFRAMES[upperIndex]!;
  const toMinute = upperIndex === 0 ? MINUTES_PER_DAY : to.minute;
  const span = Math.max(1, toMinute - from.minute);
  const rawT = clamp((minutes - from.minute) / span, 0, 1);
  const t = blendedEase(rawT);
  const phase = rawT < 0.5 ? from.id : to.id;

  return {
    phase,
    palette: {
      skyTop: lerpHexColor(from.skyTop, to.skyTop, t),
      skyUpper: lerpHexColor(from.skyUpper, to.skyUpper, t),
      skyMid: lerpHexColor(from.skyMid, to.skyMid, t),
      skyHorizon: lerpHexColor(from.skyHorizon, to.skyHorizon, t),
      cloudHighlight: lerpHexColor(from.cloudHighlight, to.cloudHighlight, t),
      cloudBody: lerpHexColor(from.cloudBody, to.cloudBody, t),
      cloudShadow: lerpHexColor(from.cloudShadow, to.cloudShadow, t),
      cloudOpacity: round2(lerp(from.cloudOpacity, to.cloudOpacity, t)),
      cirrusOpacity: round2(lerp(from.cirrusOpacity, to.cirrusOpacity, t)),
      atmosphereGlowColor: lerpHexColor(from.atmosphereGlowColor, to.atmosphereGlowColor, t),
      atmosphereGlowOpacity: round2(lerp(from.atmosphereGlowOpacity, to.atmosphereGlowOpacity, t)),
      horizonMistColor: lerpHexColor(from.horizonMistColor, to.horizonMistColor, t),
      horizonMistOpacity: round2(lerp(from.horizonMistOpacity, to.horizonMistOpacity, t)),
      starVisibility: round2(lerp(from.starVisibility, to.starVisibility, t)),
      topScrimColor: lerpHexColor(from.topScrimColor, to.topScrimColor, t),
      topScrimOpacity: round2(lerp(from.topScrimOpacity, to.topScrimOpacity, t)),
    },
  };
}

const SUN_RISE_MINUTE = 330; // 05:30
const SUN_SET_MINUTE = 1125; // 18:45
const SUN_ARC_SPAN = SUN_SET_MINUTE - SUN_RISE_MINUTE; // 795 min

function computeSunState(minutes: number): SkySunState {
  const fadeIn = smoothstep((minutes - 320) / 35); // 05:20 -> 05:55
  const fadeOut = 1 - smoothstep((minutes - 1095) / 40); // 18:15 -> 18:55
  const opacity = round2(clamp(fadeIn * fadeOut, 0, 1));
  const progress = clamp((minutes - SUN_RISE_MINUTE) / SUN_ARC_SPAN, 0, 1);
  const elevation = clamp(4 * progress * (1 - progress), 0, 1);
  const x = round2(28 + progress * (260 - 28));
  const y = round2(66 - 48 * elevation);
  const radius = round2(7.2 - 1.4 * elevation);
  const warmMix = smoothstep(elevation);

  return {
    visible: opacity > 0.005,
    progress: round2(progress),
    elevation: round2(elevation),
    x,
    y,
    radius,
    opacity,
    coreColor: lerpHexColor("#FFE3A3", "#FFFDF2", warmMix),
    innerGlowColor: lerpHexColor("#FFA44F", "#FFE8A3", warmMix),
    outerGlowColor: lerpHexColor("#FF7A38", "#FFD378", warmMix),
  };
}

const MOON_RISE_MINUTE = 1140; // 19:00
const MOON_SET_MINUTE = 315; // 05:15
const MOON_ARC_SPAN = MINUTES_PER_DAY - MOON_RISE_MINUTE + MOON_SET_MINUTE; // 615 min

function computeMoonState(minutes: number): SkyMoonState {
  let elapsed: number | null = null;
  if (minutes >= 1125) {
    elapsed = minutes - MOON_RISE_MINUTE;
  } else if (minutes <= 330) {
    elapsed = minutes + (MINUTES_PER_DAY - MOON_RISE_MINUTE);
  }

  if (elapsed === null) {
    return {
      visible: false,
      progress: 0,
      elevation: 0,
      x: 34,
      y: 64,
      radius: 6.2,
      opacity: 0,
      tiltDeg: -26,
      fillColor: "#F6F9FF",
      haloColor: "#9EC2FF",
    };
  }

  const fadeIn = smoothstep((elapsed + 12) / 36); // 18:48 -> 19:24
  const fadeOut = 1 - smoothstep((elapsed - (MOON_ARC_SPAN - 30)) / 36); // 04:45 -> 05:21
  const opacity = round2(clamp(fadeIn * fadeOut, 0, 1));
  const progress = clamp(elapsed / MOON_ARC_SPAN, 0, 1);
  const elevation = clamp(4 * progress * (1 - progress), 0, 1);
  const x = round2(34 + progress * (254 - 34));
  const y = round2(64 - 44 * elevation);
  const tiltDeg = round2(-28 + progress * 18);

  return {
    visible: opacity > 0.005,
    progress: round2(progress),
    elevation: round2(elevation),
    x,
    y,
    radius: 6.2,
    opacity,
    tiltDeg,
    fillColor: lerpHexColor("#EEF4FF", "#FBFDFF", elevation),
    haloColor: lerpHexColor("#7EA4F0", "#B5D2FF", elevation),
  };
}

function computeCloudMotion(
  minutes: number,
  sun: SkySunState,
  moon: SkyMoonState,
): SkyCloudMotion {
  // Periodic harmonic drift across 24h guarantees zero wrap-around pop at 24:00 -> 00:00.
  const theta = (minutes / MINUTES_PER_DAY) * Math.PI * 2;
  const highDriftX = round2(Math.sin(theta) * 14);
  const midDriftX = round2(Math.sin(theta + 0.9) * 10.5);
  const nearDriftX = round2(Math.sin(theta + 1.85) * 7.5);

  const activeSourceX = sun.visible
    ? sun.x
    : moon.visible
      ? moon.x
      : SKY_VIEWBOX_WIDTH / 2;
  const activeSourceY = sun.visible ? sun.y : moon.visible ? moon.y : 24;
  const horizontalRatio = clamp((activeSourceX - SKY_VIEWBOX_WIDTH / 2) / 120, -1, 1);
  const rimOffsetX = round2(horizontalRatio * 1.4);
  const rimOffsetY = round2(clamp((activeSourceY - 50) / 40, -1.35, -0.55));

  return {
    highDriftX,
    midDriftX,
    nearDriftX,
    rimOffsetX,
    rimOffsetY,
  };
}

/**
 * Deterministic subtle per-step twinkle multiplier (zero RAF/CSS animation overhead).
 */
export function computeStarStepOpacity(
  baseOpacity: number,
  phase: number,
  stepIndex: number,
  starVisibility: number,
): number {
  if (starVisibility <= 0.005) return 0;
  const shimmer = 0.8 + 0.2 * Math.sin(stepIndex * 0.45 + phase);
  return round2(clamp(baseOpacity * shimmer * starVisibility, 0, 1));
}

export function computeSkyScene(rawMinutes: number): SkyScene {
  const minutes = normalizeMinutesOfDay(rawMinutes);
  const stepIndex = Math.floor(minutes / SKY_STEP_MINUTES);
  const { phase, palette } = interpolateSkyPalette(minutes);
  const sun = computeSunState(minutes);
  const moon = computeMoonState(minutes);
  const clouds = computeCloudMotion(minutes, sun, moon);

  return {
    minutes: round2(minutes),
    stepIndex,
    phase,
    palette,
    sun,
    moon,
    clouds,
  };
}
