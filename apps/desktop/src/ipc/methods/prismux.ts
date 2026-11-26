// @effect-diagnostics nodeBuiltinImport:off - Installer verification streams SHA-256, resolves realpaths, and spawns the verified local installer directly.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";

import {
  PrismuxDaemonInfoSchema,
  PrismuxInstallDownloadedUpdateRequestSchema,
  PrismuxInstallDownloadedUpdateResultSchema,
  PrismuxKeepAwakeStateSchema,
  PrismuxSetTrayRunningAgentsRequestSchema,
  PrismuxSetTrayRunningAgentsResultSchema,
  PrismuxWindowOcclusionSchema,
  type PrismuxInstallDownloadedUpdateRequest,
  type PrismuxInstallDownloadedUpdateResult,
} from "@prismux/core-contracts";
import * as HostProcess from "@prismux/core-shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Electron from "electron";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as DesktopState from "../../app/DesktopState.ts";
import * as DesktopBackendManager from "../../backend/DesktopBackendManager.ts";
import * as DesktopBackendPool from "../../backend/DesktopBackendPool.ts";
import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as ElectronDialog from "../../electron/ElectronDialog.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as PrismuxDaemonService from "../../prismux/PrismuxDaemonService.ts";
import {
  createElectronKeepAwakeController,
  type PrismuxKeepAwakeController,
} from "../../prismux/PrismuxKeepAwakeController.ts";
import {
  takePendingPrismuxTrayAction,
  updateSharedPrismuxTrayRunningAgentsCount,
} from "../../prismux/PrismuxTrayController.ts";
import * as DesktopSshEnvironment from "../../ssh/DesktopSshEnvironment.ts";
import { toggleWebContentsDevTools } from "../../window/DesktopWindow.ts";
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
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const INSTALLER_QUIT_DELAY_MS = 150;

export class PrismuxInvalidUpdateFeedUrlError extends Schema.TaggedError<PrismuxInvalidUpdateFeedUrlError>()(
  "PrismuxInvalidUpdateFeedUrlError",
  { url: Schema.String },
) {
  override get message(): string {
    return `Rejected invalid Prismux update feed URL: ${this.url}`;
  }
}

export const PrismuxInstallDownloadedUpdateErrorReason = Schema.Literals([
  "invalid_path",
  "path_outside_updates_dir",
  "invalid_extension",
  "file_not_found",
  "invalid_sha256",
  "sha256_mismatch",
  "unverified_download",
  "spawn_failed",
]);
export type PrismuxInstallDownloadedUpdateErrorReason =
  typeof PrismuxInstallDownloadedUpdateErrorReason.Type;

export class PrismuxInstallDownloadedUpdateError extends Schema.TaggedError<PrismuxInstallDownloadedUpdateError>()(
  "PrismuxInstallDownloadedUpdateError",
  {
    reason: PrismuxInstallDownloadedUpdateErrorReason,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
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

function normalizePathForComparison(targetPath: string, platform: NodeJS.Platform): string {
  const resolved = NodePath.resolve(targetPath);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function isPathStrictlyWithinDirectory(
  candidatePath: string,
  rootDirectory: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const normalizedRoot = normalizePathForComparison(rootDirectory, platform);
  const normalizedCandidate = normalizePathForComparison(candidatePath, platform);
  const relative = NodePath.relative(normalizedRoot, normalizedCandidate);
  if (relative.length === 0 || relative === "." || relative === "..") {
    return false;
  }
  if (relative.startsWith(`..${NodePath.sep}`) || NodePath.isAbsolute(relative)) {
    return false;
  }
  return true;
}

export function computeFileSha256Hex(filePath: string): Promise<string> {
  return new Promise((resolveHash, rejectHash) => {
    const hash = NodeCrypto.createHash("sha256");
    const stream = NodeFS.createReadStream(filePath);
    stream.on("data", (chunk) => {
      hash.update(chunk);
    });
    stream.on("error", (error) => {
      rejectHash(error);
    });
    stream.on("end", () => {
      resolveHash(hash.digest("hex"));
    });
  });
}

export function verifySha256ConstantTime(actualHex: string, expectedHex: string): boolean {
  const actualNormalized = actualHex.trim().toLowerCase();
  const expectedNormalized = expectedHex.trim().toLowerCase();
  if (!SHA256_HEX_PATTERN.test(actualNormalized) || !SHA256_HEX_PATTERN.test(expectedNormalized)) {
    return false;
  }
  const actualBytes = Buffer.from(actualNormalized, "hex");
  const expectedBytes = Buffer.from(expectedNormalized, "hex");
  return (
    actualBytes.length === expectedBytes.length &&
    NodeCrypto.timingSafeEqual(actualBytes, expectedBytes)
  );
}

export interface PrismuxPortableUpdateEnvironment {
  readonly portableMode: boolean;
  readonly allowedUpdatesDirs: ReadonlyArray<string>;
}

export function resolvePrismuxUpdateCachePolicy(input: {
  readonly homeDirectory: string;
  readonly baseDir: string;
  readonly executablePath: string;
  readonly env: NodeJS.ProcessEnv;
  readonly isDirectorySync?: (candidate: string) => boolean;
}): PrismuxPortableUpdateEnvironment {
  const checkDir =
    input.isDirectorySync ??
    ((candidate: string) => {
      try {
        return NodeFS.statSync(candidate).isDirectory();
      } catch {
        return false;
      }
    });

  const envPortableDir = input.env.PRISMUX_PORTABLE_DIR?.trim();
  const portableRoot =
    envPortableDir && envPortableDir.length > 0
      ? NodePath.resolve(envPortableDir)
      : NodePath.dirname(NodePath.resolve(input.executablePath));
  const portableDataDir = NodePath.join(portableRoot, "data");
  const portableMode = checkDir(portableDataDir);

  const candidates = new Set<string>();
  candidates.add(NodePath.resolve(NodePath.join(input.homeDirectory, ".prismux", "updates")));
  if (input.baseDir.trim().length > 0) {
    candidates.add(NodePath.resolve(NodePath.join(input.baseDir, "updates")));
  }
  if (portableMode) {
    candidates.add(NodePath.resolve(NodePath.join(portableDataDir, "updates")));
  }

  return {
    portableMode,
    allowedUpdatesDirs: [...candidates],
  };
}

export interface PrismuxAuthoritativeDownloadedUpdate {
  readonly downloadedFilePath: string | null;
  readonly downloadedSha256: string | null;
}

export interface PrismuxInstallDownloadedUpdateDeps {
  readonly platform: NodeJS.Platform;
  readonly portableMode: boolean;
  readonly allowedUpdatesDirs: ReadonlyArray<string>;
  readonly resolveAuthoritativeDownload: () => Effect.Effect<PrismuxAuthoritativeDownloadedUpdate | null>;
  readonly showItemInFolder: (filePath: string) => void;
  readonly stopManagedProcesses: () => Effect.Effect<void>;
  readonly spawnInstaller: (filePath: string, args: readonly string[]) => void;
  readonly scheduleQuit: (delayMs: number) => Effect.Effect<void>;
  readonly markQuitting: (quitting: boolean) => Effect.Effect<void>;
}

function fetchAuthoritativeDaemonDownload(
  statusUrl: URL,
  token: string,
): Promise<PrismuxAuthoritativeDownloadedUpdate | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: PrismuxAuthoritativeDownloadedUpdate | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = NodeHttp.request(
      statusUrl,
      {
        method: "GET",
        timeout: 3_000,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
          res.resume();
          finish(null);
          return;
        }
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        res.on("data", (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > 64 * 1024) {
            req.destroy();
            finish(null);
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
              readonly downloadedFilePath?: unknown;
              readonly downloadedSha256?: unknown;
            };
            finish({
              downloadedFilePath:
                typeof body?.downloadedFilePath === "string" ? body.downloadedFilePath : null,
              downloadedSha256:
                typeof body?.downloadedSha256 === "string" ? body.downloadedSha256 : null,
            });
          } catch {
            finish(null);
          }
        });
        res.on("error", () => finish(null));
      },
    );
    req.on("timeout", () => {
      req.destroy();
      finish(null);
    });
    req.on("error", () => finish(null));
    req.end();
  });
}

const queryAuthoritativeDaemonDownload = Effect.fn(
  "desktop.ipc.prismux.queryAuthoritativeDaemonDownload",
)(function* (
  daemonService: PrismuxDaemonService.PrismuxDaemonService["Service"],
): Effect.fn.Return<PrismuxAuthoritativeDownloadedUpdate | null> {
  const info = yield* daemonService.getInfo.pipe(Effect.orElseSucceed(() => null));
  if (!info || !info.ready || !info.baseUrl.trim() || !info.token.trim()) {
    return null;
  }
  const statusUrl = URL.parse("/v1/updater/status", info.baseUrl);
  if (
    statusUrl === null ||
    statusUrl.protocol !== "http:" ||
    !LOOPBACK_HOSTS.has(statusUrl.hostname.toLowerCase())
  ) {
    return null;
  }
  return yield* Effect.tryPromise({
    try: () => fetchAuthoritativeDaemonDownload(statusUrl, info.token),
    catch: () => null,
  }).pipe(Effect.orElseSucceed(() => null));
});

export const executePrismuxInstallDownloadedUpdate = Effect.fn(
  "desktop.ipc.prismux.executeInstallDownloadedUpdate",
)(function* (
  request: PrismuxInstallDownloadedUpdateRequest,
  deps: PrismuxInstallDownloadedUpdateDeps,
): Effect.fn.Return<PrismuxInstallDownloadedUpdateResult, PrismuxInstallDownloadedUpdateError> {
  const rawFilePath = request.filePath.trim();
  if (rawFilePath.length === 0 || rawFilePath.includes("\0")) {
    return yield* new PrismuxInstallDownloadedUpdateError({
      reason: "invalid_path",
      detail: "Update package file path must be a non-empty path without NUL bytes.",
    });
  }

  const normalizedExpectedSha = request.expectedSha256.trim().toLowerCase();
  if (!SHA256_HEX_PATTERN.test(normalizedExpectedSha)) {
    return yield* new PrismuxInstallDownloadedUpdateError({
      reason: "invalid_sha256",
      detail: "Expected SHA-256 checksum must be a 64-character lowercase hexadecimal digest.",
    });
  }

  const authoritative = yield* deps.resolveAuthoritativeDownload();
  const authoritativeFilePath = authoritative?.downloadedFilePath?.trim() ?? "";
  const authoritativeSha256 = authoritative?.downloadedSha256?.trim().toLowerCase() ?? "";
  if (
    authoritativeFilePath.length === 0 ||
    authoritativeFilePath.includes("\0") ||
    !SHA256_HEX_PATTERN.test(authoritativeSha256)
  ) {
    return yield* new PrismuxInstallDownloadedUpdateError({
      reason: "unverified_download",
      detail:
        "Local Prismux daemon has no verified downloaded update on record; installation aborted.",
    });
  }

  if (!verifySha256ConstantTime(normalizedExpectedSha, authoritativeSha256)) {
    return yield* new PrismuxInstallDownloadedUpdateError({
      reason: "sha256_mismatch",
      detail:
        "Requested SHA-256 digest does not match the local daemon's authoritative verified download.",
    });
  }

  const normalizedCandidate = NodePath.resolve(authoritativeFilePath);
  const normalizedRequested = NodePath.resolve(rawFilePath);
  const insideLexicalRoot = deps.allowedUpdatesDirs.some((rootDir) =>
    isPathStrictlyWithinDirectory(normalizedCandidate, rootDir, deps.platform),
  );
  if (!insideLexicalRoot) {
    return yield* new PrismuxInstallDownloadedUpdateError({
      reason: "path_outside_updates_dir",
      detail: `Rejected update path outside the Prismux updates cache directory: ${normalizedCandidate}`,
    });
  }

  const stat = yield* Effect.tryPromise({
    try: () => NodeFSP.stat(normalizedCandidate),
    catch: () =>
      new PrismuxInstallDownloadedUpdateError({
        reason: "file_not_found",
        detail: `Update installer file does not exist: ${normalizedCandidate}`,
      }),
  });
  if (!stat.isFile() || stat.size <= 0) {
    return yield* new PrismuxInstallDownloadedUpdateError({
      reason: "file_not_found",
      detail: `Update installer path is not a non-empty regular file: ${normalizedCandidate}`,
    });
  }

  // Canonicalize symlinks/junctions so links inside updates/ cannot escape the cache boundary.
  const realFilePath = yield* Effect.tryPromise({
    try: () => NodeFSP.realpath(normalizedCandidate),
    catch: () =>
      new PrismuxInstallDownloadedUpdateError({
        reason: "file_not_found",
        detail: `Could not resolve update installer path: ${normalizedCandidate}`,
      }),
  });
  const realRequestedPath = yield* Effect.tryPromise({
    try: () => NodeFSP.realpath(normalizedRequested),
    catch: () => normalizedRequested,
  }).pipe(Effect.orElseSucceed(() => normalizedRequested));

  if (
    normalizePathForComparison(realRequestedPath, deps.platform) !==
    normalizePathForComparison(realFilePath, deps.platform)
  ) {
    return yield* new PrismuxInstallDownloadedUpdateError({
      reason: "unverified_download",
      detail: "Requested update path does not match the local daemon's verified download path.",
    });
  }

  const realAllowedRoots: string[] = [];
  for (const rootDir of deps.allowedUpdatesDirs) {
    const resolvedRoot = yield* Effect.tryPromise({
      try: () => NodeFSP.realpath(rootDir),
      catch: () => rootDir,
    }).pipe(Effect.orElseSucceed(() => NodePath.resolve(rootDir)));
    realAllowedRoots.push(resolvedRoot);
  }
  const insideRealRoot = realAllowedRoots.some((rootDir) =>
    isPathStrictlyWithinDirectory(realFilePath, rootDir, deps.platform),
  );
  if (!insideRealRoot) {
    return yield* new PrismuxInstallDownloadedUpdateError({
      reason: "path_outside_updates_dir",
      detail: `Rejected update installer whose resolved path escapes the updates cache directory: ${realFilePath}`,
    });
  }

  const extension = NodePath.extname(realFilePath).toLowerCase();
  const allowedExtension = deps.portableMode
    ? extension === ".exe" || extension === ".zip"
    : extension === ".exe";
  if (!allowedExtension) {
    return yield* new PrismuxInstallDownloadedUpdateError({
      reason: "invalid_extension",
      detail: deps.portableMode
        ? `Rejected unsupported portable update file extension "${extension || "(none)"}"; expected .exe or .zip.`
        : `Rejected unsupported installer file extension "${extension || "(none)"}"; expected .exe.`,
    });
  }

  const actualSha256 = yield* Effect.tryPromise({
    try: () => computeFileSha256Hex(realFilePath),
    catch: (cause) =>
      new PrismuxInstallDownloadedUpdateError({
        reason: "file_not_found",
        detail: `Failed to compute SHA-256 checksum for update file: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });

  if (!verifySha256ConstantTime(actualSha256, authoritativeSha256)) {
    return yield* new PrismuxInstallDownloadedUpdateError({
      reason: "sha256_mismatch",
      detail: "Update installer SHA-256 verification failed; installation aborted.",
    });
  }

  if (deps.portableMode) {
    yield* Effect.sync(() => {
      deps.showItemInFolder(realFilePath);
    });
    return {
      ok: true as const,
      mode: "portable-opened" as const,
      filePath: realFilePath,
      sha256: actualSha256,
      message: "Portable mode detected: opened the verified update package folder.",
    };
  }

  yield* deps.markQuitting(true);
  yield* deps.stopManagedProcesses();

  const installerArgs = request.silent === true ? ["/S"] : [];
  const launched = yield* Effect.try({
    try: () => {
      deps.spawnInstaller(realFilePath, installerArgs);
    },
    catch: (cause) =>
      new PrismuxInstallDownloadedUpdateError({
        reason: "spawn_failed",
        detail: `Failed to launch verified update installer: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  }).pipe(
    Effect.tapError(() => deps.markQuitting(false)),
  );
  void launched;

  yield* deps.scheduleQuit(INSTALLER_QUIT_DELAY_MS);
  return {
    ok: true as const,
    mode: "installer-launched" as const,
    filePath: realFilePath,
    sha256: actualSha256,
    message: "Verified installer launched; Prismux is quitting to apply the update.",
  };
});

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
    // Updates are owned exclusively by the local Prismux Daemon AppUpdater (zero electron-updater).
  }),
});

export const installPrismuxDownloadedUpdate = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PRISMUX_INSTALL_DOWNLOADED_UPDATE_CHANNEL,
  payload: PrismuxInstallDownloadedUpdateRequestSchema,
  result: PrismuxInstallDownloadedUpdateResultSchema,
  handler: Effect.fn("desktop.ipc.prismux.installDownloadedUpdate")(function* (request) {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const desktopState = yield* DesktopState.DesktopState;
    const backendPool = yield* DesktopBackendPool.DesktopBackendPool;
    const sshEnvironment = yield* DesktopSshEnvironment.DesktopSshEnvironment;
    const daemonService = yield* PrismuxDaemonService.PrismuxDaemonService;
    const electronApp = yield* ElectronApp.ElectronApp;
    const executablePath = yield* HostProcess.ExecutablePath;
    const hostEnv = yield* HostProcess.Environment;

    const cachePolicy = resolvePrismuxUpdateCachePolicy({
      homeDirectory: environment.homeDirectory,
      baseDir: environment.baseDir,
      executablePath,
      env: hostEnv,
    });

    return yield* executePrismuxInstallDownloadedUpdate(request, {
      platform: environment.platform,
      portableMode: cachePolicy.portableMode,
      allowedUpdatesDirs: cachePolicy.allowedUpdatesDirs,
      resolveAuthoritativeDownload: () => queryAuthoritativeDaemonDownload(daemonService),
      showItemInFolder: (filePath) => {
        Electron.shell.showItemInFolder(filePath);
      },
      markQuitting: (quitting) => Ref.set(desktopState.quitting, quitting),
      stopManagedProcesses: Effect.fn("desktop.ipc.prismux.stopManagedProcesses")(function* () {
        const instances = yield* backendPool.list;
        yield* Effect.all(
          [
            Effect.forEach(
              instances,
              (instance) =>
                instance
                  .stop({ timeout: DesktopBackendManager.BACKEND_QUIT_STOP_TIMEOUT })
                  .pipe(Effect.ignore),
              { concurrency: "unbounded" },
            ),
            sshEnvironment.closeAllTunnels.pipe(Effect.ignore),
            daemonService.stop.pipe(Effect.ignore),
          ],
          { concurrency: "unbounded", discard: true },
        );
      }),
      spawnInstaller: (filePath, args) => {
        const child = NodeChildProcess.spawn(filePath, [...args], {
          detached: true,
          stdio: "ignore",
        });
        child.unref();
      },
      scheduleQuit: (delayMs) =>
        Effect.sleep(`${delayMs} millis`).pipe(
          Effect.andThen(electronApp.quit),
          Effect.forkDetach,
          Effect.asVoid,
        ),
    });
  }),
});

let sharedKeepAwakeController: PrismuxKeepAwakeController | null = null;

function getSharedKeepAwakeController(): PrismuxKeepAwakeController {
  if (sharedKeepAwakeController === null) {
    sharedKeepAwakeController = createElectronKeepAwakeController();
  }
  return sharedKeepAwakeController;
}

export const setPrismuxKeepAwake = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PRISMUX_SET_KEEP_AWAKE_CHANNEL,
  payload: Schema.Boolean,
  result: PrismuxKeepAwakeStateSchema,
  handler: Effect.fn("desktop.ipc.prismux.setKeepAwake")(function* (enabled) {
    return yield* Effect.sync(() => getSharedKeepAwakeController().setEnabled(enabled));
  }),
});

export const getPrismuxKeepAwakeState = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PRISMUX_GET_KEEP_AWAKE_STATE_CHANNEL,
  payload: Schema.Void,
  result: PrismuxKeepAwakeStateSchema,
  handler: Effect.fn("desktop.ipc.prismux.getKeepAwakeState")(function* () {
    return yield* Effect.sync(() => getSharedKeepAwakeController().getState());
  }),
});

export const setPrismuxTrayRunningAgentsCount = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PRISMUX_SET_TRAY_RUNNING_AGENTS_CHANNEL,
  payload: PrismuxSetTrayRunningAgentsRequestSchema,
  result: PrismuxSetTrayRunningAgentsResultSchema,
  handler: Effect.fn("desktop.ipc.prismux.setTrayRunningAgentsCount")(function* (request) {
    const result = yield* Effect.sync(() =>
      updateSharedPrismuxTrayRunningAgentsCount(
        request.count,
        request.mobileUrl !== undefined ? { mobileUrl: request.mobileUrl } : undefined,
      ),
    );
    const pendingAction = yield* Effect.sync(() => takePendingPrismuxTrayAction());
    if (pendingAction !== null) {
      const electronWindow = yield* ElectronWindow.ElectronWindow;
      const windowOption = yield* electronWindow.main;
      if (Option.isSome(windowOption) && !windowOption.value.isDestroyed()) {
        yield* Effect.sync(() => {
          try {
            windowOption.value.webContents.send(
              IpcChannels.PRISMUX_TRAY_ACTION_CHANNEL,
              pendingAction,
            );
          } catch {
            // Ignore send errors if the renderer closed during startup handoff.
          }
        });
      }
    }
    return result;
  }),
});

const resolveMainWindowForContentsCommand = Effect.gen(function* () {
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const main = yield* electronWindow.main;
  if (Option.isSome(main) && !main.value.isDestroyed()) {
    return main;
  }
  const fallback = yield* electronWindow.currentMainOrFirst;
  if (Option.isSome(fallback) && !fallback.value.isDestroyed()) {
    return fallback;
  }
  return Option.none<Electron.BrowserWindow>();
});

export const reloadPrismuxWindow = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PRISMUX_RELOAD_WINDOW_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.prismux.reloadWindow")(function* () {
    const windowOption = yield* resolveMainWindowForContentsCommand;
    if (Option.isNone(windowOption)) return;
    yield* Effect.sync(() => {
      windowOption.value.webContents.reload();
    });
  }),
});

export const forceReloadPrismuxWindow = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PRISMUX_FORCE_RELOAD_WINDOW_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.prismux.forceReloadWindow")(function* () {
    const windowOption = yield* resolveMainWindowForContentsCommand;
    if (Option.isNone(windowOption)) return;
    yield* Effect.sync(() => {
      windowOption.value.webContents.reloadIgnoringCache();
    });
  }),
});

export const togglePrismuxDevTools = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PRISMUX_TOGGLE_DEVTOOLS_CHANNEL,
  payload: Schema.Void,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.prismux.toggleDevTools")(function* () {
    const windowOption = yield* resolveMainWindowForContentsCommand;
    if (Option.isNone(windowOption)) return;
    yield* Effect.sync(() => {
      toggleWebContentsDevTools(windowOption.value.webContents);
    });
  }),
});
