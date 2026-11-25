export {
  WALLPAPER_ENGINE_APP_ID,
  isPathInsideDir,
  resolveSafeMediaPath,
  getMimeType,
  parseByteRange,
  prepareMediaRangeResponse,
  serveMediaFileWithRange,
  orientationFromDimensions,
  readImageDimensions,
  readVideoDimensions,
  parseLibraryFoldersVdf,
  discoverSteamLibraryDirs,
  scanSteamWorkshop431960,
  getDefaultCustomWallpaperDir,
  scanCustomWallpaperDir,
  importLocalWallpaperFile,
  scanAllLocalWallpapers,
} from "./scanner.js";

export type {
  SafeMediaPathResult,
  ParsedByteRange,
  MediaRangeResponseDescriptor,
  ImageDimensions,
  SteamDiscoveryOptions,
  ScanSteamOptions,
  ScanSteamResult,
  ScanCustomOptions,
  ImportLocalWallpaperOptions,
  CombinedScanOptions,
  CombinedScanResult,
} from "./scanner.js";

export {
  parseUserPropDefs,
  applyUserPropOverrides,
  weEvalCondition,
  weColorToHex,
  weHexToColor,
  schemeToCss,
  sameUserPropValue,
  stripWeHtml,
} from "../userProps.js";
