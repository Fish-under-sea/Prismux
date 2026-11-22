import {
  PrismuxDaemonInfoSchema,
  PrismuxWindowOcclusionSchema,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ElectronDialog from "../../electron/ElectronDialog.ts";
import * as ElectronUpdater from "../../electron/ElectronUpdater.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as PrismuxDaemonService from "../../prismux/PrismuxDaemonService.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

const WALLPAPER_FILE_FILTERS: readonly Electron.FileFilter[] = [
  {
    name: "Wallpapers (Images & Videos)",
    extensions: [
      "png",
      "jpg",
      "jpeg",
      "webp",
      "gif",
      "bmp",
      "avif",
      "mp4",
      "webm",
      "mov",
      "mkv",
    ],
  },
  {
    name: "All Files",
    extensions: ["*"],
  },
];

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export class PrismuxInvalidUpdateFeedUrlError extends Schema.TaggedError<PrismuxInvalidUpdateFeedUrlError>()(
  "PrismuxInvalidUpdateFeedUrlError",
  { url: Schema.String },
) {
  override get message(): string {
    return `Rejected invalid Prismux update feed URL: ${this.url}`;
  }
}

function parseAllowedFeedUrl(raw: string): URL | null {
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol === "https:") {
      return parsed;
    }
    if (parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export const getPrismuxDaemonInfo = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PRISMUX_GET_DAEMON_INFO_CHANNEL,
  payload: Schema.Void,
  result: PrismuxDaemonInfoSchema,
  handler: Effect.fn("desktop.ipc.prismux.getDaemonInfo")(function* () {
    const daemon = yield* PrismuxDaemonService.PrismuxDaemonService;
    return yield* daemon.getInfo;
  }),
});

export const getPrismuxWindowOcclusion = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PRISMUX_GET_WINDOW_OCCLUSION_CHANNEL,
  payload: Schema.Void,
  result: PrismuxWindowOcclusionSchema,
  handler: Effect.fn("desktop.ipc.prismux.getWindowOcclusion")(function* () {
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const windowOption = yield* electronWindow.currentMainOrFirst;
    if (Option.isNone(windowOption) || windowOption.value.isDestroyed()) {
      return { occluded: true, reason: "no-window" };
    }
    const win = windowOption.value;
    if (win.isMinimized()) {
      return { occluded: true, reason: "minimized" };
    }
    if (!win.isVisible()) {
      return { occluded: true, reason: "hidden" };
    }
    return {
      occluded: false,
      reason: win.isFocused() ? "focused" : "visible",
    };
  }),
});

export const pickPrismuxWallpaperFiles = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PRISMUX_PICK_WALLPAPER_FILES_CHANNEL,
  payload: Schema.Void,
  result: Schema.Array(Schema.String),
  handler: Effect.fn("desktop.ipc.prismux.pickWallpaperFiles")(function* () {
    const dialog = yield* ElectronDialog.ElectronDialog;
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const owner = yield* electronWindow.currentMainOrFirst;
    return yield* dialog.pickFiles({
      owner,
      defaultPath: Option.none(),
      filters: WALLPAPER_FILE_FILTERS,
      multiple: true,
    });
  }),
});

export const pickPrismuxWallpaperDirectory = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PRISMUX_PICK_WALLPAPER_DIRECTORY_CHANNEL,
  payload: Schema.Void,
  result: Schema.NullOr(Schema.String),
  handler: Effect.fn("desktop.ipc.prismux.pickWallpaperDirectory")(function* () {
    const dialog = yield* ElectronDialog.ElectronDialog;
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const owner = yield* electronWindow.currentMainOrFirst;
    const picked = yield* dialog.pickFolder({
      owner,
      defaultPath: Option.none(),
    });
    return Option.getOrNull(picked);
  }),
});

export const setPrismuxUpdateFeedUrl = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PRISMUX_SET_UPDATE_FEED_URL_CHANNEL,
  payload: Schema.String,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.prismux.setUpdateFeedUrl")(function* (rawUrl) {
    const parsed = parseAllowedFeedUrl(rawUrl);
    if (parsed === null) {
      return yield* new PrismuxInvalidUpdateFeedUrlError({ url: rawUrl });
    }
    const updater = yield* ElectronUpdater.ElectronUpdater;
    yield* updater.setFeedURL({
      provider: "generic",
      url: parsed.href,
    });
  }),
});
