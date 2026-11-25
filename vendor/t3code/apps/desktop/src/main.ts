import * as MacPermissions from "./permissions/MacPermissions.ts";
import { handleStdioError } from "./app/stdioErrors.ts";

for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", handleStdioError);
}

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
// @effect-diagnostics-next-line nodeBuiltinImport:off - Version output must flush before Electron exits, without acquiring the runtime.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as Electron from "electron";

import type { PrismuxDispatchActionResult, PrismuxDispatchEnvelope } from "@t3tools/contracts";
import * as NetService from "@t3tools/shared/Net";
import * as HostProcess from "@t3tools/shared/HostProcess";

import * as DesktopIpc from "./ipc/DesktopIpc.ts";
import * as ElectronApp from "./electron/ElectronApp.ts";
import * as ElectronDialog from "./electron/ElectronDialog.ts";
import * as ElectronMenu from "./electron/ElectronMenu.ts";
import * as ElectronPowerMonitor from "./electron/ElectronPowerMonitor.ts";
import * as ElectronProtocol from "./electron/ElectronProtocol.ts";
import * as ElectronSafeStorage from "./electron/ElectronSafeStorage.ts";
import * as ElectronShell from "./electron/ElectronShell.ts";
import * as ElectronTheme from "./electron/ElectronTheme.ts";
import * as ElectronUpdater from "./electron/ElectronUpdater.ts";
import * as ElectronWindow from "./electron/ElectronWindow.ts";
import * as DesktopApp from "./app/DesktopApp.ts";
import * as DesktopAppActivation from "./app/DesktopAppActivation.ts";
import * as DesktopWebLinks from "./app/DesktopWebLinks.ts";
import * as DesktopAppIdentity from "./app/DesktopAppIdentity.ts";
import * as DesktopConnectionCatalogStore from "./app/DesktopConnectionCatalogStore.ts";
import * as DesktopAppLinks from "./app/DesktopAppLinks.ts";
import * as DesktopCliCommand from "./app/DesktopCliCommand.ts";
import * as DesktopApplicationMenu from "./window/DesktopApplicationMenu.ts";
import * as DesktopAssets from "./app/DesktopAssets.ts";
import * as DesktopPrimaryPaste from "./app/DesktopPrimaryPaste.ts";
import * as DesktopBackendConfiguration from "./backend/DesktopBackendConfiguration.ts";
import * as DesktopBackendPool from "./backend/DesktopBackendPool.ts";
import * as DesktopLocalEnvironmentAuth from "./backend/DesktopLocalEnvironmentAuth.ts";
import * as DesktopNetworkInterfaces from "./backend/DesktopNetworkInterfaces.ts";
import * as DesktopEnvironment from "./app/DesktopEnvironment.ts";
import * as DesktopManagedPolicy from "./app/DesktopManagedPolicy.ts";
import * as DesktopLifecycle from "./app/DesktopLifecycle.ts";
import * as DesktopLinuxUrlHandler from "./app/DesktopLinuxUrlHandler.ts";
import * as DesktopShutdown from "./app/DesktopShutdown.ts";
import * as DesktopObservability from "./app/DesktopObservability.ts";
import * as DesktopServerExposure from "./backend/DesktopServerExposure.ts";
import * as DesktopClientSettings from "./settings/DesktopClientSettings.ts";
import * as DesktopSavedEnvironments from "./settings/DesktopSavedEnvironments.ts";
import * as DesktopSnapShot from "./snapShot/DesktopSnapShot.ts";
import * as DesktopAppSettings from "./settings/DesktopAppSettings.ts";
import * as DesktopPreReadyFileSystem from "./app/DesktopPreReadyFileSystem.ts";
import * as DesktopPreReadyPlatform from "./app/DesktopPreReadyPlatform.ts";
import * as DesktopShellEnvironment from "./shell/DesktopShellEnvironment.ts";
import * as DesktopSshEnvironment from "./ssh/DesktopSshEnvironment.ts";
import * as DesktopSshPasswordPrompts from "./ssh/DesktopSshPasswordPrompts.ts";
import * as PrismuxDaemonService from "./prismux/PrismuxDaemonService.ts";
import { runPrismuxStartupUpgradeMigration } from "./prismux/PrismuxUpgradeMigration.ts";
import * as DesktopState from "./app/DesktopState.ts";
import * as DesktopLegacyLocalStorage from "./app/DesktopLegacyLocalStorage.ts";
import * as DesktopTelemetryPublisher from "./telemetry/DesktopTelemetryPublisher.ts";
import * as DesktopRendererHistory from "./telemetry/DesktopRendererHistory.ts";
import * as DesktopUpdatePolicy from "./updates/DesktopUpdatePolicy.ts";
import * as DesktopUpdates from "./updates/DesktopUpdates.ts";
import * as BrowserImport from "./preview/BrowserImport/BrowserImport.ts";
import * as LinuxBrowserSecret from "./preview/BrowserImport/LinuxBrowserSecret.ts";
import * as AppleSpeech from "./speech/AppleSpeech.ts";
import * as BrowserSession from "./preview/BrowserSession.ts";
import * as DesktopBrowserHost from "./preview/DesktopBrowserHost.ts";
import * as LoopbackTunnel from "./preview/LoopbackTunnel.ts";
import * as PreviewManager from "./preview/Manager.ts";
import * as PreviewPasskeys from "./preview/Passkeys.ts";
import * as DesktopWindow from "./window/DesktopWindow.ts";
import * as DesktopWslBackend from "./wsl/DesktopWslBackend.ts";
import * as DesktopWslEnvironment from "./wsl/DesktopWslEnvironment.ts";
import * as DesktopWslServerTree from "./wsl/DesktopWslServerTree.ts";

if (process.argv.includes("--version")) {
  try {
    NodeFS.writeSync(process.stdout.fd, `${Electron.app.getVersion()}\n`);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EPIPE") throw error;
  }
  Electron.app.exit(0);
}

runPrismuxStartupUpgradeMigration();

const layerDesktopEnvironment = Layer.unwrap(
  Effect.gen(function* () {
    const metadata = yield* Effect.service(ElectronApp.ElectronApp).pipe(
      Effect.flatMap((app) => app.metadata),
    );
    const platform = yield* HostProcess.Platform;
    const processArch = yield* HostProcess.Architecture;
    return DesktopEnvironment.layer({
      dirname: __dirname,
      homeDirectory: NodeOS.homedir(),
      platform,
      processArch,
      ...metadata,
    });
  }),
);

const layerDesktopSshEnvironment = Layer.unwrap(
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const env = yield* HostProcess.Environment;
    return DesktopSshEnvironment.layer({
      // Per connect: the login shell's environment is installed after this layer is built.
      resolveCliRunner: Effect.sync(() =>
        DesktopSshEnvironment.resolveDesktopSshCliRunner(environment, env),
      ),
      resolveLauncherId: yield* Effect.cached(
        DesktopSshEnvironment.readOrCreateLauncherId(
          environment.path.join(environment.stateDir, "ssh-launcher-id"),
        ).pipe(
          Effect.provide(
            yield* Effect.context<FileSystem.FileSystem | SecureRandom.SecureRandom>(),
          ),
        ),
      ),
    });
  }),
);

const layerElectron = Layer.mergeAll(
  ElectronApp.layer,
  ElectronDialog.layer,
  ElectronMenu.layer,
  ElectronPowerMonitor.layer,
  ElectronProtocol.layer,
  ElectronSafeStorage.layer,
  ElectronShell.layer,
  ElectronTheme.layer,
  ElectronUpdater.layer,
  ElectronWindow.layer,
  DesktopIpc.layer(Electron.ipcMain).pipe(Layer.provide(ElectronWindow.layer)),
);

const layerDesktopFoundation = Layer.mergeAll(
  MacPermissions.layer,
  DesktopManagedPolicy.layer,
  DesktopState.layer,
  DesktopShutdown.layer,
  DesktopLegacyLocalStorage.layer,
  DesktopAppSettings.layer,
  DesktopClientSettings.layer,
  DesktopConnectionCatalogStore.layer.pipe(Layer.provideMerge(DesktopSavedEnvironments.layer)),
  DesktopAssets.layer,
  DesktopPrimaryPaste.layer,
  DesktopObservability.layer,
  DesktopRendererHistory.layer,
  AppleSpeech.layer,
).pipe(Layer.provideMerge(layerDesktopEnvironment));

const layerDesktopSsh = layerDesktopSshEnvironment.pipe(
  Layer.provideMerge(DesktopSshPasswordPrompts.layer()),
);

const layerDesktopServerExposure = DesktopServerExposure.layer.pipe(
  Layer.provideMerge(DesktopNetworkInterfaces.layer),
  Layer.provideMerge(layerDesktopFoundation),
);

const layerDesktopPreview = PreviewManager.layer.pipe(
  Layer.provideMerge(LoopbackTunnel.layer),
  Layer.provideMerge(DesktopBrowserHost.layer),
  // IPC needs both services on the same BrowserSession.
  Layer.provideMerge(BrowserImport.layer.pipe(Layer.provide(LinuxBrowserSecret.layer))),
  Layer.provideMerge(BrowserSession.layer),
  Layer.provideMerge(PreviewPasskeys.layer),
  Layer.provideMerge(layerDesktopFoundation),
);

const layerDesktopWindow = DesktopWindow.layer.pipe(
  Layer.provideMerge(layerDesktopServerExposure),
  Layer.provideMerge(layerDesktopPreview),
);

const layerDesktopSnapShot = DesktopSnapShot.layer.pipe(
  Layer.provideMerge(layerDesktopWindow),
  Layer.provideMerge(layerDesktopFoundation),
);
const layerDesktopAppActivation = DesktopAppActivation.layer.pipe(
  Layer.provide(layerDesktopWindow),
);

const layerDesktopBackend = DesktopBackendPool.layer.pipe(
  Layer.provideMerge(DesktopAppIdentity.layer),
  Layer.provideMerge(DesktopBackendConfiguration.layer),
  Layer.provideMerge(DesktopWslEnvironment.layer),
  Layer.provideMerge(DesktopWslServerTree.layer),
  Layer.provideMerge(DesktopTelemetryPublisher.layer),
  Layer.provideMerge(DesktopShellEnvironment.layer),
  Layer.provideMerge(layerDesktopWindow),
);

const layerDesktopWslBackend = DesktopWslBackend.layer.pipe(
  Layer.provideMerge(layerDesktopBackend),
);

const layerDesktopLocalEnvironmentAuth = DesktopLocalEnvironmentAuth.layer.pipe(
  Layer.provideMerge(layerDesktopBackend),
);

const layerDesktopApplication = Layer.mergeAll(
  DesktopLifecycle.layer,
  layerDesktopAppActivation,
  DesktopWebLinks.layer,
  DesktopApplicationMenu.layer,
  DesktopLinuxUrlHandler.layer,
  DesktopCliCommand.layer,
  PrismuxDaemonService.layer,
).pipe(
  Layer.provideMerge(layerDesktopSnapShot),
  Layer.provideMerge(
    DesktopUpdates.layer.pipe(
      Layer.provide(DesktopUpdatePolicy.layer),
      // The same layer as the foundation's, so the policy is still read once.
      Layer.provide(DesktopManagedPolicy.layer),
    ),
  ),
  // Updates closes the same tunnels the SSH IPC opens before quitAndInstall.
  Layer.provideMerge(layerDesktopSsh),
  Layer.provideMerge(layerDesktopWslBackend),
  Layer.provideMerge(layerDesktopLocalEnvironmentAuth),
);

// Resolve userData and acquire the single-instance lock synchronously before Electron is ready.
const layerDesktopAppLinks = DesktopAppLinks.layer.pipe(
  Layer.provide(DesktopPreReadyFileSystem.layer),
  Layer.provideMerge(ElectronShell.layer),
  Layer.provideMerge(layerDesktopEnvironment),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  Layer.provideMerge(ElectronApp.layer),
);

const layerDesktopApplicationRuntime = layerDesktopApplication.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  Layer.provideMerge(NodeHttpClient.layerUndici),
  Layer.provideMerge(NetService.layer),
  Layer.provideMerge(layerElectron),
);

// Pre-ready setup must not yield before privileged schemes and the single-instance lock are registered.
const layerDesktopRuntime = layerDesktopAppLinks.pipe(
  Layer.flatMap((appLinksContext) =>
    layerDesktopApplicationRuntime.pipe(Layer.provideMerge(Layer.succeedContext(appLinksContext))),
  ),
  Layer.provideMerge(DesktopPreReadyPlatform.layer),
);

const PRISMUX_DISPATCH_THREAD_CHANNEL = "prismux:dispatch-thread";
const PRISMUX_DISPATCH_CONFIRM_CHANNEL = "prismux:dispatch:confirm";
const PRISMUX_DISPATCH_CANCEL_CHANNEL = "prismux:dispatch:cancel";
const PRISMUX_DISPATCH_QUEUE_LIMIT = 100;
const PRISMUX_DISPATCH_SSE_INITIAL_RETRY_MS = 1_000;
const PRISMUX_DISPATCH_SSE_MAX_RETRY_MS = 15_000;

interface PrismuxDispatchDaemonConnection {
  readonly baseUrl: string;
  readonly token: string;
}

function parsePrismuxDispatchEnvelope(raw: unknown): PrismuxDispatchEnvelope | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const taskId = typeof record.taskId === "string" ? record.taskId.trim() : "";
  const mode = record.mode;
  if (
    taskId.length === 0 ||
    (mode !== "send" && mode !== "draft_only") ||
    typeof record.workspacePath !== "string" ||
    typeof record.prompt !== "string" ||
    typeof record.provider !== "string" ||
    typeof record.modelId !== "string" ||
    typeof record.reasoningEffort !== "string" ||
    typeof record.callerKind !== "string" ||
    typeof record.requiresHumanConfirmation !== "boolean"
  ) {
    return null;
  }

  const replyChannel =
    typeof record.replyChannel === "string"
      ? record.replyChannel
      : typeof record.replyChannel === "object" &&
          record.replyChannel !== null &&
          !Array.isArray(record.replyChannel) &&
          typeof (record.replyChannel as { kind?: unknown }).kind === "string"
        ? (record.replyChannel as PrismuxDispatchEnvelope["replyChannel"])
        : null;

  return {
    taskId,
    status: typeof record.status === "string" ? record.status : "queued",
    mode,
    workspacePath: record.workspacePath,
    ...(typeof record.worktreePath === "string" || record.worktreePath === null
      ? { worktreePath: record.worktreePath }
      : {}),
    ...(typeof record.branchName === "string" || record.branchName === null
      ? { branchName: record.branchName }
      : {}),
    prompt: record.prompt,
    provider: record.provider,
    modelId: record.modelId,
    reasoningEffort: record.reasoningEffort,
    callerKind: record.callerKind,
    ...(typeof record.taskCategory === "string" ? { taskCategory: record.taskCategory } : {}),
    createdAt:
      typeof record.createdAt === "string" && record.createdAt.length > 0
        ? record.createdAt
        : DateTime.formatIso(DateTime.nowUnsafe()),
    requiresHumanConfirmation: record.requiresHumanConfirmation,
    ...(typeof record.confirmationReason === "string" || record.confirmationReason === null
      ? { confirmationReason: record.confirmationReason }
      : {}),
    ...(typeof record.memoryContextSummary === "string" || record.memoryContextSummary === null
      ? { memoryContextSummary: record.memoryContextSummary }
      : {}),
    ...(replyChannel !== null ? { replyChannel } : {}),
    ...(typeof record.threadId === "string" || record.threadId === null
      ? { threadId: record.threadId }
      : {}),
  };
}

function parsePrismuxDispatchSseBlock(block: string): PrismuxDispatchEnvelope | null {
  const lines = block.split(/\r?\n/);
  let eventName = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.length === 0 || line.startsWith(":")) continue;
    const colonIdx = line.indexOf(":");
    const field = colonIdx === -1 ? line : line.slice(0, colonIdx);
    let value = colonIdx === -1 ? "" : line.slice(colonIdx + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }
    if (field === "event" && value.length > 0) {
      eventName = value;
    } else if (field === "data") {
      dataLines.push(value);
    }
  }

  if (dataLines.length === 0) return null;
  if (eventName !== "dispatch_thread" && eventName !== "message") return null;

  try {
    const parsed: unknown = JSON.parse(dataLines.join("\n"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "envelope" in parsed &&
      typeof (parsed as { envelope?: unknown }).envelope === "object"
    ) {
      return parsePrismuxDispatchEnvelope((parsed as { envelope?: unknown }).envelope);
    }
    return parsePrismuxDispatchEnvelope(parsed);
  } catch {
    return null;
  }
}

async function postPrismuxDispatchAction(
  connection: PrismuxDispatchDaemonConnection,
  taskId: string,
  action: "confirm" | "cancel",
): Promise<PrismuxDispatchActionResult> {
  const trimmedTaskId = taskId.trim();
  if (trimmedTaskId.length === 0) {
    return { ok: false, error: "Dispatch taskId must be a non-empty string." };
  }
  const url = `${connection.baseUrl}/v1/dispatch/${encodeURIComponent(trimmedTaskId)}/${action}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (connection.token.length > 0) {
    headers.Authorization = `Bearer ${connection.token}`;
    headers["X-Prismux-Token"] = connection.token;
  }

  try {
    // @effect-diagnostics-next-line globalFetch:off -- Main-process IPC action proxy posts directly to the local loopback Prismux Daemon.
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(
        action === "confirm" ? { confirmedBy: "human_desktop" } : { cancelledBy: "human_desktop" },
      ),
    });
    const rawText = await response.text();
    let parsed: Record<string, unknown> | null = null;
    if (rawText.length > 0) {
      try {
        const json: unknown = JSON.parse(rawText);
        if (typeof json === "object" && json !== null && !Array.isArray(json)) {
          parsed = json as Record<string, unknown>;
        }
      } catch {
        parsed = null;
      }
    }
    if (!response.ok) {
      const nestedError =
        parsed?.error && typeof parsed.error === "object"
          ? (parsed.error as Record<string, unknown>)
          : null;
      const errorMessage =
        typeof nestedError?.message === "string"
          ? nestedError.message
          : typeof parsed?.error === "string"
            ? parsed.error
            : typeof parsed?.message === "string"
              ? parsed.message
              : `Daemon dispatch ${action} failed (HTTP ${response.status}).`;
      return { ok: false, error: errorMessage };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : `Failed to reach Prismux Daemon for ${action}.`,
    };
  }
}

function trySendDispatchToWindow(
  win: Electron.BrowserWindow,
  envelope: PrismuxDispatchEnvelope,
): boolean {
  try {
    // Send over IPC without forcing focus/show so tray and screen-locked dispatches still work.
    win.webContents.send(PRISMUX_DISPATCH_THREAD_CHANNEL, envelope);
    return true;
  } catch {
    return false;
  }
}

const installPrismuxDispatchIpcBridge = Effect.fn("desktop.prismux.dispatchIpcBridge")(function* () {
  const daemonService = yield* PrismuxDaemonService.PrismuxDaemonService;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const hostEnv = yield* HostProcess.Environment;
  const context = yield* Effect.context<
    PrismuxDaemonService.PrismuxDaemonService | ElectronWindow.ElectronWindow
  >();
  const runPromise = Effect.runPromiseWith(context);

  const queuedEnvelopes: PrismuxDispatchEnvelope[] = [];
  const attachedWindows = new WeakSet<Electron.BrowserWindow>();
  let disposed = false;
  const isDisposed = () => disposed;

  const resolveDaemonConnection = Effect.gen(function* () {
    const info = yield* daemonService.getInfo;
    if (info.ready && info.baseUrl.trim().length > 0) {
      return {
        baseUrl: info.baseUrl.trim().replace(/\/+$/, ""),
        token: info.token,
      } satisfies PrismuxDispatchDaemonConnection;
    }
    const envUrl = hostEnv.PRISMUX_DAEMON_URL?.trim();
    if (envUrl && envUrl.length > 0) {
      return {
        baseUrl: envUrl.replace(/\/+$/, ""),
        token: hostEnv.PRISMUX_DAEMON_TOKEN?.trim() ?? "",
      } satisfies PrismuxDispatchDaemonConnection;
    }
    return null;
  });

  const resolveTargetWindow = Effect.gen(function* () {
    const main = yield* electronWindow.main;
    if (Option.isSome(main) && !main.value.isDestroyed()) {
      return main.value;
    }
    const fallback = yield* electronWindow.currentMainOrFirst;
    if (Option.isSome(fallback) && !fallback.value.isDestroyed()) {
      return fallback.value;
    }
    const live = Electron.BrowserWindow.getAllWindows().find((win) => !win.isDestroyed());
    return live ?? null;
  });

  const enqueueEnvelope = (envelope: PrismuxDispatchEnvelope): void => {
    const existingIdx = queuedEnvelopes.findIndex((entry) => entry.taskId === envelope.taskId);
    if (existingIdx >= 0) {
      queuedEnvelopes[existingIdx] = envelope;
      return;
    }
    if (queuedEnvelopes.length >= PRISMUX_DISPATCH_QUEUE_LIMIT) {
      queuedEnvelopes.shift();
    }
    queuedEnvelopes.push(envelope);
  };

  const flushQueuedToWindow = (win: Electron.BrowserWindow): boolean => {
    if (win.isDestroyed() || win.webContents.isLoadingMainFrame()) {
      return false;
    }
    while (queuedEnvelopes.length > 0) {
      const next = queuedEnvelopes[0]!;
      if (!trySendDispatchToWindow(win, next)) {
        return false;
      }
      queuedEnvelopes.shift();
    }
    return true;
  };

  const attachWindowFlush = (win: Electron.BrowserWindow): void => {
    if (win.isDestroyed() || attachedWindows.has(win)) return;
    attachedWindows.add(win);
    win.webContents.on("did-finish-load", () => {
      if (isDisposed()) return;
      flushQueuedToWindow(win);
    });
  };

  const onBrowserWindowCreated = (_event: Electron.Event, win: Electron.BrowserWindow): void => {
    if (isDisposed()) return;
    attachWindowFlush(win);
  };

  const forwardDispatchEnvelope = Effect.fn("desktop.prismux.forwardDispatchEnvelope")(function* (
    envelope: PrismuxDispatchEnvelope,
  ) {
    const win = yield* resolveTargetWindow;
    if (win === null || win.isDestroyed()) {
      enqueueEnvelope(envelope);
      return;
    }
    attachWindowFlush(win);
    if (win.webContents.isLoadingMainFrame()) {
      enqueueEnvelope(envelope);
      return;
    }
    if (queuedEnvelopes.length > 0) {
      enqueueEnvelope(envelope);
      flushQueuedToWindow(win);
      return;
    }
    if (!trySendDispatchToWindow(win, envelope)) {
      enqueueEnvelope(envelope);
    }
  });

  const isTrustedMainWindowSender = Effect.fn("desktop.prismux.isTrustedMainWindowSender")(
    function* (event: Electron.IpcMainInvokeEvent) {
      const win = yield* resolveTargetWindow;
      if (win === null || win.isDestroyed()) return false;
      return (
        win.webContents.id === event.sender.id && win.webContents.mainFrame === event.senderFrame
      );
    },
  );

  const handleDispatchAction =
    (action: "confirm" | "cancel") =>
    async (
      event: Electron.IpcMainInvokeEvent,
      rawTaskId: unknown,
    ): Promise<PrismuxDispatchActionResult> => {
      const trusted = await runPromise(isTrustedMainWindowSender(event)).catch(() => false);
      if (!trusted) {
        return {
          ok: false,
          error: `Rejected prismux:dispatch:${action} from an untrusted sender.`,
        };
      }
      if (typeof rawTaskId !== "string" || rawTaskId.trim().length === 0) {
        return { ok: false, error: "Invalid dispatch taskId." };
      }
      const connection = await runPromise(resolveDaemonConnection).catch(() => null);
      if (connection === null) {
        return { ok: false, error: "Prismux Daemon is not ready." };
      }
      return postPrismuxDispatchAction(connection, rawTaskId, action);
    };

  yield* Effect.sync(() => {
    Electron.app.on("browser-window-created", onBrowserWindowCreated);
    Electron.ipcMain.removeHandler(PRISMUX_DISPATCH_CONFIRM_CHANNEL);
    Electron.ipcMain.removeHandler(PRISMUX_DISPATCH_CANCEL_CHANNEL);
    Electron.ipcMain.handle(PRISMUX_DISPATCH_CONFIRM_CHANNEL, handleDispatchAction("confirm"));
    Electron.ipcMain.handle(PRISMUX_DISPATCH_CANCEL_CHANNEL, handleDispatchAction("cancel"));
  });

  const sseSubscriberLoop = Effect.gen(function* () {
    let retryAttempt = 0;
    while (!isDisposed()) {
      const connection = yield* resolveDaemonConnection;
      if (connection === null) {
        const delayMs = Math.min(
          5_000,
          PRISMUX_DISPATCH_SSE_INITIAL_RETRY_MS * 2 ** Math.min(retryAttempt, 3),
        );
        retryAttempt += 1;
        yield* Effect.sleep(Duration.millis(delayMs));
        continue;
      }

      const streamResult = yield* Effect.tryPromise({
        try: async (signal) => {
          const headers: Record<string, string> = {
            Accept: "text/event-stream",
            "Cache-Control": "no-cache",
          };
          if (connection.token.length > 0) {
            headers.Authorization = `Bearer ${connection.token}`;
            headers["X-Prismux-Token"] = connection.token;
          }
          // @effect-diagnostics-next-line globalFetchInEffect:off -- Long-lived SSE dispatch stream uses Fetch ReadableStream with Effect AbortSignal cancellation.
          const response = await fetch(`${connection.baseUrl}/v1/dispatch/events`, {
            method: "GET",
            headers,
            signal,
          });
          if (!response.ok || !response.body) {
            return { opened: false };
          }

          retryAttempt = 0;
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          while (!isDisposed() && !signal.aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split(/\r?\n\r?\n/);
            buffer = blocks.pop() ?? "";
            for (const block of blocks) {
              if (block.trim().length === 0) continue;
              const envelope = parsePrismuxDispatchSseBlock(block);
              if (envelope !== null) {
                await runPromise(forwardDispatchEnvelope(envelope));
              }
            }
          }

          buffer += decoder.decode();
          if (buffer.trim().length > 0) {
            const envelope = parsePrismuxDispatchSseBlock(buffer);
            if (envelope !== null) {
              await runPromise(forwardDispatchEnvelope(envelope));
            }
          }
          return { opened: true };
        },
        catch: () => ({ opened: false }),
      }).pipe(Effect.orElseSucceed(() => ({ opened: false })));

      if (isDisposed()) break;

      if (streamResult.opened) {
        retryAttempt = 0;
      }
      const backoffMs = Math.min(
        PRISMUX_DISPATCH_SSE_MAX_RETRY_MS,
        PRISMUX_DISPATCH_SSE_INITIAL_RETRY_MS * 2 ** Math.min(retryAttempt, 4),
      );
      retryAttempt += 1;
      yield* Effect.sleep(Duration.millis(backoffMs));
    }
  }).pipe(Effect.ignore);

  yield* Effect.forkScoped(sseSubscriberLoop);

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      disposed = true;
      Electron.app.removeListener("browser-window-created", onBrowserWindowCreated);
      Electron.ipcMain.removeHandler(PRISMUX_DISPATCH_CONFIRM_CHANNEL);
      Electron.ipcMain.removeHandler(PRISMUX_DISPATCH_CANCEL_CHANNEL);
    }),
  );
});

const mainProgram = Effect.scoped(
  Effect.gen(function* () {
    yield* installPrismuxDispatchIpcBridge();
    yield* DesktopApp.program;
  }),
);

mainProgram.pipe(Effect.provide(layerDesktopRuntime), NodeRuntime.runMain);
