import type {
  DesktopPreviewColorScheme,
  DesktopPreviewDeviceEmulation,
  PreviewAutomationResizeInput,
  PreviewViewportPresetId,
  PreviewViewportSetting,
} from "@prismux/core-contracts";
import { PREVIEW_VIEWPORT_PRESET_IDS } from "@prismux/core-contracts";

export type PreviewViewportBezelStyle =
  | "dynamic-island"
  | "classic-chin"
  | "punch-hole"
  | "notch"
  | "foldable"
  | "tablet"
  | "none";

export interface PreviewViewportPreset {
  readonly id: PreviewViewportPresetId;
  readonly label: string;
  readonly category: "Desktop" | "Tablet" | "Phone";
  readonly detail: string;
  readonly width: number;
  readonly height: number;
  readonly mobile: boolean;
  readonly deviceScaleFactor: number;
  readonly hasTouch: boolean;
  readonly maxTouchPoints: number;
  readonly userAgent: string;
  readonly bezelStyle: PreviewViewportBezelStyle;
  readonly colorScheme: DesktopPreviewColorScheme;
  /** True for Prismux's 6 curated mobile simulator presets. */
  readonly featuredMobile?: boolean;
}

type PreviewViewportPresetDefinition = Omit<PreviewViewportPreset, "id">;

const UA_IPHONE_18 =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const UA_IPHONE_17 =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const UA_IPAD_18 =
  "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const UA_PIXEL_8 =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const UA_PIXEL_7 =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const UA_ANDROID_CN_FLAGSHIP =
  "Mozilla/5.0 (Linux; Android 14; 23116PN5BC) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const UA_ANDROID_FOLDABLE =
  "Mozilla/5.0 (Linux; Android 14; Foldable) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const UA_GALAXY =
  "Mozilla/5.0 (Linux; Android 13; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const UA_SURFACE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const CURATED_MOBILE_VIEWPORT_PRESET_IDS = [
  "iphone-16-pro",
  "iphone-se",
  "pixel-8",
  "xiaomi-huawei-360",
  "foldable-unfolded",
  "ipad-mini",
] as const satisfies ReadonlyArray<PreviewViewportPresetId>;

export type CuratedMobileViewportPresetId = (typeof CURATED_MOBILE_VIEWPORT_PRESET_IDS)[number];

export const DEFAULT_MOBILE_SIMULATOR_PRESET_ID: CuratedMobileViewportPresetId = "iphone-16-pro";

// Curated Prismux mobile simulator presets first, followed by Chromium EmulatedDevices.ts defaults.
const PREVIEW_VIEWPORT_PRESET_DEFINITIONS = {
  "iphone-16-pro": {
    label: "iPhone 16 Pro",
    category: "Phone",
    detail: "393 × 852 @3x",
    width: 393,
    height: 852,
    mobile: true,
    deviceScaleFactor: 3,
    hasTouch: true,
    maxTouchPoints: 5,
    userAgent: UA_IPHONE_18,
    bezelStyle: "dynamic-island",
    colorScheme: "system",
    featuredMobile: true,
  },
  "iphone-se": {
    label: "iPhone SE",
    category: "Phone",
    detail: "375 × 667 @2x",
    width: 375,
    height: 667,
    mobile: true,
    deviceScaleFactor: 2,
    hasTouch: true,
    maxTouchPoints: 5,
    userAgent: UA_IPHONE_17,
    bezelStyle: "classic-chin",
    colorScheme: "system",
    featuredMobile: true,
  },
  "pixel-8": {
    label: "Pixel 8",
    category: "Phone",
    detail: "412 × 915 @2.625x",
    width: 412,
    height: 915,
    mobile: true,
    deviceScaleFactor: 2.625,
    hasTouch: true,
    maxTouchPoints: 5,
    userAgent: UA_PIXEL_8,
    bezelStyle: "punch-hole",
    colorScheme: "system",
    featuredMobile: true,
  },
  "xiaomi-huawei-360": {
    label: "小米 / 华为常规屏",
    category: "Phone",
    detail: "360 × 800 @3x",
    width: 360,
    height: 800,
    mobile: true,
    deviceScaleFactor: 3,
    hasTouch: true,
    maxTouchPoints: 5,
    userAgent: UA_ANDROID_CN_FLAGSHIP,
    bezelStyle: "punch-hole",
    colorScheme: "system",
    featuredMobile: true,
  },
  "foldable-unfolded": {
    label: "折叠屏展开态",
    category: "Tablet",
    detail: "712 × 1138 @2x",
    width: 712,
    height: 1138,
    mobile: true,
    deviceScaleFactor: 2,
    hasTouch: true,
    maxTouchPoints: 5,
    userAgent: UA_ANDROID_FOLDABLE,
    bezelStyle: "foldable",
    colorScheme: "system",
    featuredMobile: true,
  },
  "ipad-mini": {
    label: "iPad Mini",
    category: "Tablet",
    detail: "744 × 1133 @2x",
    width: 744,
    height: 1133,
    mobile: true,
    deviceScaleFactor: 2,
    hasTouch: true,
    maxTouchPoints: 5,
    userAgent: UA_IPAD_18,
    bezelStyle: "tablet",
    colorScheme: "system",
    featuredMobile: true,
  },
  "iphone-xr": {
    label: "iPhone XR",
    category: "Phone",
    detail: "414 × 896",
    width: 414,
    height: 896,
    mobile: true,
    deviceScaleFactor: 2,
    hasTouch: true,
    maxTouchPoints: 5,
    userAgent: UA_IPHONE_17,
    bezelStyle: "notch",
    colorScheme: "system",
  },
  "iphone-12-pro": {
    label: "iPhone 12 Pro",
    category: "Phone",
    detail: "390 × 844",
    width: 390,
    height: 844,
    mobile: true,
    deviceScaleFactor: 3,
    hasTouch: true,
    maxTouchPoints: 5,
    userAgent: UA_IPHONE_17,
    bezelStyle: "notch",
    colorScheme: "system",
  },
  "iphone-14-pro-max": {
    label: "iPhone 14 Pro Max",
    category: "Phone",
    detail: "430 × 932",
    width: 430,
    height: 932,
    mobile: true,
    deviceScaleFactor: 3,
    hasTouch: true,
    maxTouchPoints: 5,
    userAgent: UA_IPHONE_18,
    bezelStyle: "dynamic-island",
    colorScheme: "system",
  },
  "pixel-7": {
    label: "Pixel 7",
    category: "Phone",
    detail: "412 × 915",
    width: 412,
    height: 915,
    mobile: true,
    deviceScaleFactor: 2.625,
    hasTouch: true,
    maxTouchPoints: 5,
    userAgent: UA_PIXEL_7,
    bezelStyle: "punch-hole",
    colorScheme: "system",
  },
  "samsung-galaxy-s8-plus": {
    label: "Samsung Galaxy S8+",
    category: "Phone",
    detail: "360 × 740",
    width: 360,
    height: 740,
    mobile: true,
    deviceScaleFactor: 4,
    hasTouch: true,
    maxTouchPoints: 5,
    userAgent: UA_GALAXY,
    bezelStyle: "punch-hole",
    colorScheme: "system",
  },
  "samsung-galaxy-s20-ultra": {
    label: "Samsung Galaxy S20 Ultra",
    category: "Phone",
    detail: "412 × 915",
    width: 412,
    height: 915,
    mobile: true,
    deviceScaleFactor: 3.5,
    hasTouch: true,
    maxTouchPoints: 5,
    userAgent: UA_GALAXY,
    bezelStyle: "punch-hole",
    colorScheme: "system",
  },
  "ipad-air": {
    label: "iPad Air",
    category: "Tablet",
    detail: "820 × 1180",
    width: 820,
    height: 1180,
    mobile: true,
    deviceScaleFactor: 2,
    hasTouch: true,
    maxTouchPoints: 5,
    userAgent: UA_IPAD_18,
    bezelStyle: "tablet",
    colorScheme: "system",
  },
  "ipad-pro": {
    label: "iPad Pro",
    category: "Tablet",
    detail: "1024 × 1366",
    width: 1024,
    height: 1366,
    mobile: true,
    deviceScaleFactor: 2,
    hasTouch: true,
    maxTouchPoints: 5,
    userAgent: UA_IPAD_18,
    bezelStyle: "tablet",
    colorScheme: "system",
  },
  "surface-pro-7": {
    label: "Surface Pro 7",
    category: "Tablet",
    detail: "912 × 1368",
    width: 912,
    height: 1368,
    mobile: false,
    deviceScaleFactor: 2,
    hasTouch: true,
    maxTouchPoints: 5,
    userAgent: UA_SURFACE,
    bezelStyle: "tablet",
    colorScheme: "system",
  },
  "surface-duo": {
    label: "Surface Duo",
    category: "Phone",
    detail: "540 × 720",
    width: 540,
    height: 720,
    mobile: true,
    deviceScaleFactor: 2.5,
    hasTouch: true,
    maxTouchPoints: 5,
    userAgent: UA_ANDROID_FOLDABLE,
    bezelStyle: "foldable",
    colorScheme: "system",
  },
  "galaxy-z-fold-5": {
    label: "Galaxy Z Fold 5",
    category: "Phone",
    detail: "344 × 882",
    width: 344,
    height: 882,
    mobile: true,
    deviceScaleFactor: 3,
    hasTouch: true,
    maxTouchPoints: 5,
    userAgent: UA_ANDROID_FOLDABLE,
    bezelStyle: "foldable",
    colorScheme: "system",
  },
  "asus-zenbook-fold": {
    label: "Asus Zenbook Fold",
    category: "Tablet",
    detail: "853 × 1280",
    width: 853,
    height: 1280,
    mobile: false,
    deviceScaleFactor: 2,
    hasTouch: true,
    maxTouchPoints: 5,
    userAgent: UA_SURFACE,
    bezelStyle: "tablet",
    colorScheme: "system",
  },
  "samsung-galaxy-a51-71": {
    label: "Samsung Galaxy A51/71",
    category: "Phone",
    detail: "412 × 914",
    width: 412,
    height: 914,
    mobile: true,
    deviceScaleFactor: 2.625,
    hasTouch: true,
    maxTouchPoints: 5,
    userAgent: UA_GALAXY,
    bezelStyle: "punch-hole",
    colorScheme: "system",
  },
  "nest-hub": {
    label: "Nest Hub",
    category: "Tablet",
    detail: "1024 × 600",
    width: 1024,
    height: 600,
    mobile: false,
    deviceScaleFactor: 2,
    hasTouch: true,
    maxTouchPoints: 5,
    userAgent: UA_ANDROID_FOLDABLE,
    bezelStyle: "none",
    colorScheme: "system",
  },
  "nest-hub-max": {
    label: "Nest Hub Max",
    category: "Tablet",
    detail: "1280 × 800",
    width: 1280,
    height: 800,
    mobile: false,
    deviceScaleFactor: 2,
    hasTouch: true,
    maxTouchPoints: 5,
    userAgent: UA_ANDROID_FOLDABLE,
    bezelStyle: "none",
    colorScheme: "system",
  },
} as const satisfies Record<PreviewViewportPresetId, PreviewViewportPresetDefinition>;

export const PREVIEW_VIEWPORT_PRESETS: ReadonlyArray<PreviewViewportPreset> =
  PREVIEW_VIEWPORT_PRESET_IDS.map((id) => ({
    id,
    ...PREVIEW_VIEWPORT_PRESET_DEFINITIONS[id],
  }));

export const CURATED_MOBILE_VIEWPORT_PRESETS: ReadonlyArray<PreviewViewportPreset> =
  CURATED_MOBILE_VIEWPORT_PRESET_IDS.map((id) => ({
    id,
    ...PREVIEW_VIEWPORT_PRESET_DEFINITIONS[id],
  }));

export function findPreviewViewportPreset(presetId: string): PreviewViewportPreset | undefined {
  return PREVIEW_VIEWPORT_PRESETS.find((candidate) => candidate.id === presetId);
}

/**
 * Builds the Electron CDP device emulation payload for a viewport setting.
 * Returns `null` when returning to desktop/fill/freeform mode so the host clears all emulation overrides.
 */
export function resolvePreviewDeviceEmulation(
  setting: PreviewViewportSetting,
  colorScheme?: DesktopPreviewColorScheme,
  scale?: number,
): DesktopPreviewDeviceEmulation | null {
  if (setting._tag !== "preset") return null;
  const preset = findPreviewViewportPreset(setting.presetId);
  if (!preset || (!preset.mobile && !preset.hasTouch)) return null;
  const normalizedScale =
    scale !== undefined && Number.isFinite(scale) && scale > 0 ? scale : undefined;
  return {
    enabled: true,
    presetId: preset.id,
    width: setting.width,
    height: setting.height,
    deviceScaleFactor: preset.deviceScaleFactor,
    ...(normalizedScale !== undefined ? { scale: normalizedScale } : {}),
    mobile: preset.mobile,
    hasTouch: preset.hasTouch,
    maxTouchPoints: preset.maxTouchPoints,
    userAgent: preset.userAgent,
    ...(colorScheme !== undefined ? { colorScheme } : { colorScheme: preset.colorScheme }),
  };
}

export function resolvePreviewViewport(
  input: PreviewAutomationResizeInput,
): PreviewViewportSetting {
  if (input.mode === "fill") return { _tag: "fill" };
  if (input.mode === "preset" && input.preset !== undefined) {
    const preset = PREVIEW_VIEWPORT_PRESETS.find((candidate) => candidate.id === input.preset);
    if (!preset) throw new Error(`Unknown preview viewport preset: ${input.preset}`);
    const landscape = input.orientation === "landscape";
    const portrait = input.orientation === "portrait";
    const nativePortrait = preset.height >= preset.width;
    const shouldSwap = (landscape && nativePortrait) || (portrait && !nativePortrait);
    return {
      _tag: "preset",
      width: shouldSwap ? preset.height : preset.width,
      height: shouldSwap ? preset.width : preset.height,
      presetId: preset.id,
    };
  }
  if (input.width === undefined || input.height === undefined) {
    throw new Error("Custom preview viewport requires width and height");
  }
  return {
    _tag: "freeform",
    width: input.width,
    height: input.height,
  };
}
