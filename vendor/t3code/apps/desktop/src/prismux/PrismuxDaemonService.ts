// @effect-diagnostics-next-line nodeBuiltinImport:off - Daemon supervision spawns and reaps a local child process directly via node:child_process.
import * as NodeChildProcess from "node:child_process";

import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClient, HttpClientResponse } from "effect/http";

import type { PrismuxDaemonInfo } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NetService from "@t3tools/shared/Net";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { makeComponentLogger } from "../app/DesktopObservability.ts";

class PrismuxDaemonSpawnError extends Schema.TaggedError<PrismuxDaemonSpawnError>()(
  "PrismuxDaemonSpawnError",
  {
    entryPath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to spawn Prismux daemon at ${this.entryPath}.`;
  }
}

const DAEMON_HOST = "127.0.0.1";
const DAEMON_HEALTH_ATTEMPTS = 67;
const DAEMON_HEALTH_POLL_INTERVAL = Duration.millis(150);
const DAEMON_HEALTH_REQUEST_TIMEOUT = Duration.seconds(1);
const DAEMON_STOP_GRACE_MS = 2_500;
const STDERR_TAIL_MAX_CHARS = 2_048;

const { logInfo: logDaemonInfo, logWarning: logDaemonWarning } =
  makeComponentLogger("prismux-daemon");

export function normalizeT3WebSocketUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:") {
      parsed.protocol = "ws:";
    } else if (parsed.protocol === "https:") {
      parsed.protocol = "wss:";
    }
    if (parsed.pathname === "" || parsed.pathname === "/") {
      parsed.pathname = "/ws";
    }
    return parsed.href;
  } catch {
    return trimmed;
  }
}

export function normalizeT3HttpUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "ws:") {
      parsed.protocol = "http:";
    } else if (parsed.protocol === "wss:") {
      parsed.protocol = "https:";
    }
    if (parsed.pathname === "/ws" || parsed.pathname === "/rpc") {
      parsed.pathname = "/";
    }
    return parsed.origin;
  } catch {
    return trimmed;
  }
}

export function buildPrismuxDaemonChildEnv(input: {
  readonly hostEnv: NodeJS.ProcessEnv;
  readonly catalogPath: string;
  readonly mainPid: number;
  readonly t3HttpUrl?: string | undefined;
  readonly t3WsUrl?: string | undefined;
}): NodeJS.ProcessEnv {
  const normalizedHttpUrl = input.t3HttpUrl
    ? normalizeT3HttpUrl(input.t3HttpUrl)
    : input.t3WsUrl
      ? normalizeT3HttpUrl(input.t3WsUrl)
      : undefined;
  const normalizedWsUrl = input.t3WsUrl ? normalizeT3WebSocketUrl(input.t3WsUrl) : undefined;
  return {
    ...input.hostEnv,
    ELECTRON_RUN_AS_NODE: "1",
    PRISMUX_CATALOG_PATH: input.catalogPath,
    PRISMUX_MAIN_PID: String(input.mainPid),
    ...(normalizedHttpUrl
      ? {
          PRISMUX_T3_SERVER_URL: normalizedHttpUrl,
          T3CODE_SERVER_URL: normalizedHttpUrl,
        }
      : {}),
    ...(normalizedWsUrl ? { PRISMUX_T3_WS_URL: normalizedWsUrl } : {}),
  };
}

function appendTailBuffer(current: string, chunk: string, maxChars: number): string {
  const combined = current + chunk;
  return combined.length <= maxChars ? combined : combined.slice(combined.length - maxChars);
}

export interface PrismuxDaemonStartInput {
  readonly t3Url?: string | undefined;
  readonly t3HttpUrl?: string | undefined;
  readonly t3Token?: string | undefined;
}

interface PrismuxDaemonState {
  readonly child: NodeChildProcess.ChildProcess | null;
  readonly baseUrl: string;
  readonly token: string;
  readonly ready: boolean;
  readonly stopping: boolean;
}

const INITIAL_DAEMON_STATE: PrismuxDaemonState = {
  child: null,
  baseUrl: "",
  token: "",
  ready: false,
  stopping: false,
};

export class PrismuxDaemonService extends Context.Service<
  PrismuxDaemonService,
  {
    readonly start: (input?: PrismuxDaemonStartInput) => Effect.Effect<void>;
    readonly stop: Effect.Effect<void>;
    readonly getInfo: Effect.Effect<PrismuxDaemonInfo>;
  }
>()("@t3tools/desktop/prismux/PrismuxDaemonService") {}

function forceKillProcessTree(pid: number, platform: NodeJS.Platform): void {
  if (platform === "win32") {
    try {
      const killer = NodeChildProcess.spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.unref();
    } catch {
      // Fall through to direct signal below.
    }
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Process already exited.
  }
}

function waitForChildExit(child: NodeChildProcess.ChildProcess): Effect.Effect<void> {
  return Effect.callback<void>((resume) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resume(Effect.void);
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      child.off("exit", onExit);
      child.off("error", onExit);
      resume(Effect.void);
    };

    const onExit = () => finish();
    child.once("exit", onExit);
    child.once("error", onExit);

    return Effect.sync(() => {
      child.off("exit", onExit);
      child.off("error", onExit);
    });
  });
}

function terminateChildProcess(
  child: NodeChildProcess.ChildProcess,
  platform: NodeJS.Platform,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    const signalSent = yield* Effect.sync(() => {
      try {
        child.kill("SIGTERM");
        return true;
      } catch {
        return false;
      }
    });
    if (!signalSent) {
      if (child.pid !== undefined) {
        forceKillProcessTree(child.pid, platform);
      }
      return;
    }
    const exited = yield* waitForChildExit(child).pipe(
      Effect.as(true),
      Effect.timeoutOrElse({
        duration: Duration.millis(DAEMON_STOP_GRACE_MS),
        orElse: () => Effect.succeed(false),
      }),
    );
    if (!exited && child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
      forceKillProcessTree(child.pid, platform);
    }
  });
}

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fileSystem = yield* FileSystem.FileSystem;
  const net = yield* NetService.NetService;
  const random = yield* SecureRandom.SecureRandom;
  const httpClient = yield* HttpClient.HttpClient;
  const executablePath = yield* HostProcess.ExecutablePath;
  const hostEnv = yield* HostProcess.Environment;

  const stateRef = yield* Ref.make<PrismuxDaemonState>(INITIAL_DAEMON_STATE);
  const lifecycleMutex = yield* Semaphore.make(1);
  const runtimeContext = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(runtimeContext);

  const resolveEntryPath = Effect.gen(function* () {
    const candidates = environment.isPackaged
      ? [
          environment.path.join(environment.resourcesPath, "prismux-daemon", "cli.js"),
          environment.path.join(environment.resourcesPath, "prismux-daemon", "dist", "cli.js"),
        ]
      : [
          environment.path.resolve(environment.rootDir, "../../apps/daemon/dist/cli.js"),
          environment.path.resolve(environment.dirname, "../../../../../apps/daemon/dist/cli.js"),
        ];

    for (const candidate of candidates) {
      const exists = yield* fileSystem
        .exists(candidate)
        .pipe(Effect.orElseSucceed(() => false));
      if (exists) {
        return Option.some(candidate);
      }
    }
    return Option.none<string>();
  });

  const probeHealth = (baseUrl: string) =>
    httpClient.get(new URL("/health", baseUrl)).pipe(
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.timeout(DAEMON_HEALTH_REQUEST_TIMEOUT),
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );

  const waitForDaemonHealth = (
    baseUrl: string,
    child: NodeChildProcess.ChildProcess,
  ): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      for (let attempt = 0; attempt < DAEMON_HEALTH_ATTEMPTS; attempt += 1) {
        if (child.exitCode !== null || child.signalCode !== null) {
          return false;
        }
        const ok = yield* probeHealth(baseUrl);
        if (ok) {
          return true;
        }
        yield* Effect.sleep(DAEMON_HEALTH_POLL_INTERVAL);
      }
      return false;
    });

  const stop = lifecycleMutex.withPermits(1)(
    Effect.gen(function* () {
      const current = yield* Ref.getAndUpdate(stateRef, (state) => ({
        ...state,
        child: null,
        ready: false,
        stopping: true,
      }));
      if (current.child === null) {
        return;
      }
      yield* logDaemonInfo("stopping prismux daemon", {
        pid: current.child.pid ?? null,
        baseUrl: current.baseUrl,
      });
      yield* terminateChildProcess(current.child, environment.platform);
    }),
  );

  const start = Effect.fn("desktop.prismux.daemon.start")(function* (
    input?: PrismuxDaemonStartInput,
  ) {
    yield* lifecycleMutex.withPermits(1)(
      Effect.gen(function* () {
        const current = yield* Ref.get(stateRef);
        if (
          current.child !== null &&
          current.child.exitCode === null &&
          current.child.signalCode === null
        ) {
          return;
        }

        const entryOption = yield* resolveEntryPath;
        if (Option.isNone(entryOption)) {
          yield* logDaemonWarning("prismux daemon entry not found; continuing without daemon", {
            isPackaged: environment.isPackaged,
            resourcesPath: environment.resourcesPath,
            rootDir: environment.rootDir,
          });
          return;
        }
        const entryPath = entryOption.value;

        const portResult = yield* net
          .reserveLoopbackPort(DAEMON_HOST)
          .pipe(Effect.option);
        if (Option.isNone(portResult)) {
          yield* logDaemonWarning("failed to reserve loopback port for prismux daemon");
          return;
        }
        const port = portResult.value;
        const tokenBytes = yield* random.randomBytes(32);
        const token = Hex.encode(tokenBytes);
        const baseUrl = `http://${DAEMON_HOST}:${port}`;

        const args: string[] = [
          entryPath,
          "start",
          "--headless",
          "--host",
          DAEMON_HOST,
          "--port",
          String(port),
          "--auth-token",
          token,
        ];
        const normalizedT3Url = input?.t3Url
          ? normalizeT3WebSocketUrl(input.t3Url)
          : input?.t3HttpUrl
            ? normalizeT3WebSocketUrl(input.t3HttpUrl)
            : undefined;
        const normalizedT3HttpUrl = input?.t3HttpUrl
          ? normalizeT3HttpUrl(input.t3HttpUrl)
          : input?.t3Url
            ? normalizeT3HttpUrl(input.t3Url)
            : undefined;
        if (normalizedT3Url) {
          args.push("--t3-url", normalizedT3Url);
        }
        if (input?.t3Token) {
          args.push("--t3-token", input.t3Token);
        }

        const catalogPath = environment.isPackaged
          ? environment.path.join(
              environment.resourcesPath,
              "prismux-daemon",
              "catalog",
              "official.json",
            )
          : environment.path.resolve(
              environment.rootDir,
              "../../plugins-official/catalog/official.json",
            );

        // Only set ELECTRON_RUN_AS_NODE on the isolated daemon child env; never mutate parent process.env.
        const childEnv = buildPrismuxDaemonChildEnv({
          hostEnv,
          catalogPath,
          mainPid: process.pid,
          t3HttpUrl: normalizedT3HttpUrl,
          t3WsUrl: normalizedT3Url,
        });

        const child = yield* Effect.try({
          try: () =>
            NodeChildProcess.spawn(executablePath, args, {
              cwd: environment.path.dirname(entryPath),
              env: childEnv,
              stdio: ["ignore", "pipe", "pipe"],
              windowsHide: true,
            }),
          catch: (cause) => new PrismuxDaemonSpawnError({ entryPath, cause }),
        }).pipe(
          Effect.match({
            onFailure: () => null,
            onSuccess: (spawned) => spawned,
          }),
        );

        if (child === null) {
          yield* logDaemonWarning("failed to spawn prismux daemon process", { entryPath });
          return;
        }

        let stderrTail = "";
        child.stderr?.setEncoding("utf8");
        child.stderr?.on("data", (chunk: string) => {
          stderrTail = appendTailBuffer(stderrTail, chunk, STDERR_TAIL_MAX_CHARS);
        });
        child.stdout?.resume();

        yield* Ref.set(stateRef, {
          child,
          baseUrl,
          token,
          ready: false,
          stopping: false,
        });

        child.once("exit", (code, signal) => {
          void runPromise(
            Ref.modify(stateRef, (state) => {
              if (state.child !== child) {
                return [false, state] as const;
              }
              return [
                !state.stopping || (code !== null && code !== 0),
                {
                  ...state,
                  child: null,
                  ready: false,
                },
              ] as const;
            }).pipe(
              Effect.flatMap((shouldLog) =>
                shouldLog
                  ? logDaemonWarning("prismux daemon exited unexpectedly", {
                      code,
                      signal,
                      stderrTail: stderrTail.trim(),
                    })
                  : Effect.void,
              ),
            ),
          );
        });

        child.once("error", (error) => {
          void runPromise(
            logDaemonWarning("prismux daemon process error", {
              message: error.message,
              stderrTail: stderrTail.trim(),
            }),
          );
        });

        yield* logDaemonInfo("spawned prismux daemon", {
          pid: child.pid ?? null,
          baseUrl,
          entryPath,
          catalogPath,
          t3Url: normalizedT3Url ?? null,
          hasT3Token: Boolean(input?.t3Token),
        });

        const healthy = yield* waitForDaemonHealth(baseUrl, child);
        if (healthy) {
          yield* Ref.update(stateRef, (state) =>
            state.child === child ? { ...state, ready: true } : state,
          );
          yield* logDaemonInfo("prismux daemon ready", { baseUrl });
        } else {
          yield* logDaemonWarning("prismux daemon did not pass /health within timeout; continuing", {
            baseUrl,
            exitCode: child.exitCode,
            stderrTail: stderrTail.trim(),
          });
        }
      }),
    );
  });

  yield* Effect.addFinalizer(() => stop.pipe(Effect.ignore));

  return PrismuxDaemonService.of({
    start,
    stop,
    getInfo: Ref.get(stateRef).pipe(
      Effect.map(({ baseUrl, token, ready }) => ({
        baseUrl,
        token,
        ready,
      })),
    ),
  });
});

export const layer = Layer.effect(PrismuxDaemonService, make);
