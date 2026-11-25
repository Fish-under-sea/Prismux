import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import type { CoreSupervisorState } from "@prismux/protocol";

const BLOCKED_CHILD_ENV_KEYS = new Set<string>([
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_NO_ATTACH_CONSOLE"
]);

export const DEFAULT_SUPERVISOR_LOG_CAPACITY = 200;
export const DEFAULT_SUPERVISOR_MAX_RESTARTS = 5;
export const DEFAULT_SUPERVISOR_BASE_BACKOFF_MS = 250;
export const DEFAULT_SUPERVISOR_MAX_BACKOFF_MS = 10_000;
export const DEFAULT_SUPERVISOR_STOP_TIMEOUT_MS = 3_000;
export const DEFAULT_SUPERVISOR_HEALTH_INTERVAL_MS = 50;
export const DEFAULT_SUPERVISOR_HEALTH_TIMEOUT_MS = 1_000;
export const DEFAULT_SUPERVISOR_START_TIMEOUT_MS = 15_000;

/**
 * Resolves the bundled Prismux core server CLI entry point (`vendor/t3code` during Phase 1).
 */
export function resolveDefaultCoreServerEntry(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDir, "../../../../vendor/t3code/apps/server/dist/bin.mjs");
}

/**
 * Removes host-polluting Electron environment flags and `undefined` entries
 * before spawning the core server or provider sub-processes.
 */
export function sanitizeChildEnv(
  env: Record<string, string | undefined> = process.env
): Record<string, string> {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      continue;
    }
    if (
      BLOCKED_CHILD_ENV_KEYS.has(key) ||
      BLOCKED_CHILD_ENV_KEYS.has(key.toUpperCase())
    ) {
      continue;
    }
    cleaned[key] = value;
  }
  return cleaned;
}

export interface CoreServerSupervisorOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  healthUrl?: string;
  host?: string;
  port?: number;
  maxRestarts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  stopTimeoutMs?: number;
  logCapacity?: number;
  healthCheckIntervalMs?: number;
  healthTimeoutMs?: number;
  startTimeoutMs?: number;
  readyDelayMs?: number;
}

export interface CoreSupervisorStatus {
  state: CoreSupervisorState;
  pid?: number;
  restartCount: number;
  lastError?: string;
  lastExitCode?: number | null;
  lastExitSignal?: NodeJS.Signals | null;
  startedAt?: number;
  command: string;
  args: string[];
  host?: string;
  port?: number;
  healthUrl?: string;
}

export interface CoreSupervisorLogLine {
  stream: "stdout" | "stderr";
  line: string;
  timestamp: number;
}

export class CoreServerSupervisor extends EventEmitter {
  private readonly command: string;
  private readonly args: string[];
  private readonly cwd: string | undefined;
  private readonly envOverrides: Record<string, string | undefined> | undefined;
  private readonly healthUrl: string | undefined;
  private readonly host: string | undefined;
  private readonly port: number | undefined;
  private readonly maxRestarts: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly stopTimeoutMs: number;
  private readonly logCapacity: number;
  private readonly healthCheckIntervalMs: number;
  private readonly healthTimeoutMs: number;
  private readonly startTimeoutMs: number;
  private readonly readyDelayMs: number;

  private state: CoreSupervisorState = "stopped";
  private child: ChildProcess | undefined;
  private restartCount = 0;
  private lastError: string | undefined;
  private lastExitCode: number | null | undefined;
  private lastExitSignal: NodeJS.Signals | null | undefined;
  private startedAt: number | undefined;
  private manualStop = false;
  private generation = 0;

  private readonly logs: string[] = [];
  private activeStartPromise: Promise<void> | undefined;
  private activeStopPromise: Promise<void> | undefined;

  private restartTimer: NodeJS.Timeout | undefined;
  private healthPollTimer: NodeJS.Timeout | undefined;
  private startTimeoutTimer: NodeJS.Timeout | undefined;
  private readyDelayTimer: NodeJS.Timeout | undefined;
  private stopKillTimer: NodeJS.Timeout | undefined;
  private stopFallbackTimer: NodeJS.Timeout | undefined;
  private healthAbortController: AbortController | undefined;

  private settlePendingStartup:
    | { resolve: () => void; reject: (error: Error) => void }
    | undefined;

  constructor(options: CoreServerSupervisorOptions = {}) {
    super();

    const useDefaultServer =
      options.command === undefined && options.args === undefined;
    this.command = options.command ?? process.execPath;

    if (options.args !== undefined) {
      this.args = [...options.args];
    } else if (useDefaultServer) {
      const defaultArgs = [resolveDefaultCoreServerEntry(), "--no-browser"];
      if (options.host !== undefined) {
        defaultArgs.push("--host", options.host);
      }
      if (options.port !== undefined) {
        defaultArgs.push("--port", String(options.port));
      }
      this.args = defaultArgs;
    } else {
      this.args = [];
    }

    this.cwd = options.cwd;
    this.envOverrides = options.env;
    this.healthUrl = options.healthUrl;
    this.host = options.host;
    this.port = options.port;
    this.maxRestarts = Math.max(
      0,
      options.maxRestarts ?? DEFAULT_SUPERVISOR_MAX_RESTARTS
    );
    this.baseBackoffMs = Math.max(
      1,
      options.baseBackoffMs ?? DEFAULT_SUPERVISOR_BASE_BACKOFF_MS
    );
    this.maxBackoffMs = Math.max(
      this.baseBackoffMs,
      options.maxBackoffMs ?? DEFAULT_SUPERVISOR_MAX_BACKOFF_MS
    );
    this.stopTimeoutMs = Math.max(
      50,
      options.stopTimeoutMs ?? DEFAULT_SUPERVISOR_STOP_TIMEOUT_MS
    );
    this.logCapacity = Math.max(
      1,
      options.logCapacity ?? DEFAULT_SUPERVISOR_LOG_CAPACITY
    );
    this.healthCheckIntervalMs = Math.max(
      10,
      options.healthCheckIntervalMs ?? DEFAULT_SUPERVISOR_HEALTH_INTERVAL_MS
    );
    this.healthTimeoutMs = Math.max(
      50,
      options.healthTimeoutMs ?? DEFAULT_SUPERVISOR_HEALTH_TIMEOUT_MS
    );
    this.startTimeoutMs = Math.max(
      100,
      options.startTimeoutMs ?? DEFAULT_SUPERVISOR_START_TIMEOUT_MS
    );
    this.readyDelayMs = Math.max(0, options.readyDelayMs ?? 0);
  }

  getStatus(): CoreSupervisorStatus {
    return {
      state: this.state,
      ...(this.child?.pid !== undefined ? { pid: this.child.pid } : {}),
      restartCount: this.restartCount,
      ...(this.lastError !== undefined ? { lastError: this.lastError } : {}),
      ...(this.lastExitCode !== undefined
        ? { lastExitCode: this.lastExitCode }
        : {}),
      ...(this.lastExitSignal !== undefined
        ? { lastExitSignal: this.lastExitSignal }
        : {}),
      ...(this.startedAt !== undefined ? { startedAt: this.startedAt } : {}),
      command: this.command,
      args: [...this.args],
      ...(this.host !== undefined ? { host: this.host } : {}),
      ...(this.port !== undefined ? { port: this.port } : {}),
      ...(this.healthUrl !== undefined ? { healthUrl: this.healthUrl } : {})
    };
  }

  getLogs(): string[] {
    return [...this.logs];
  }

  async start(): Promise<void> {
    if (this.activeStopPromise !== undefined) {
      await this.activeStopPromise;
    }
    if (this.state === "running") {
      return;
    }
    if (this.activeStartPromise !== undefined) {
      return this.activeStartPromise;
    }

    this.manualStop = false;
    this.restartCount = 0;
    this.lastError = undefined;
    this.lastExitCode = undefined;
    this.lastExitSignal = undefined;
    this.clearAllTimers();
    this.setState("starting");

    const run = this.spawnAndAwaitReady(true).finally(() => {
      this.activeStartPromise = undefined;
    });
    this.activeStartPromise = run;
    return run;
  }

  async stop(): Promise<void> {
    if (this.activeStopPromise !== undefined) {
      return this.activeStopPromise;
    }

    const stopRun = this.performStop().finally(() => {
      this.activeStopPromise = undefined;
    });
    this.activeStopPromise = stopRun;
    return stopRun;
  }

  private async performStop(): Promise<void> {
    this.manualStop = true;
    this.generation += 1;
    this.clearAllTimers();

    if (this.settlePendingStartup !== undefined) {
      const { reject } = this.settlePendingStartup;
      this.settlePendingStartup = undefined;
      reject(new Error("CoreServerSupervisor stopped before becoming ready."));
    }

    const child = this.child;
    if (child === undefined) {
      this.setState("stopped");
      return;
    }

    if (child.exitCode !== null || child.signalCode !== null) {
      this.cleanupChildStreams(child);
      this.child = undefined;
      this.setState("stopped");
      return;
    }

    await new Promise<void>((resolveStop) => {
      let finished = false;
      const finish = () => {
        if (finished) {
          return;
        }
        finished = true;
        this.clearStopTimers();
        this.cleanupChildStreams(child);
        if (this.child === child) {
          this.child = undefined;
        }
        this.setState("stopped");
        resolveStop();
      };

      child.once("close", finish);
      child.once("exit", () => {
        if (!finished && this.stopFallbackTimer === undefined) {
          this.stopFallbackTimer = setTimeout(finish, 100);
        }
      });

      try {
        child.kill("SIGTERM");
      } catch {
        finish();
        return;
      }

      this.stopKillTimer = setTimeout(() => {
        if (finished) {
          return;
        }
        try {
          child.kill("SIGKILL");
        } catch {
          // Process may have already exited.
        }
        this.cleanupChildStreams(child);
        if (this.stopFallbackTimer !== undefined) {
          clearTimeout(this.stopFallbackTimer);
        }
        this.stopFallbackTimer = setTimeout(finish, 150);
      }, this.stopTimeoutMs);
    });
  }

  private async spawnAndAwaitReady(isInitialStart: boolean): Promise<void> {
    this.clearStartupTimers();

    if (this.manualStop) {
      throw new Error("CoreServerSupervisor is stopped.");
    }

    const currentGeneration = ++this.generation;
    const childEnv = sanitizeChildEnv({
      ...process.env,
      ...this.envOverrides
    });

    const child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });

    this.child = child;
    this.startedAt = Date.now();
    this.attachOutputCollectors(child);

    return new Promise<void>((resolveReady, rejectReady) => {
      let settled = false;

      const resolveOnce = () => {
        if (settled) {
          return;
        }
        settled = true;
        this.settlePendingStartup = undefined;
        this.clearStartupTimers();
        resolveReady();
      };

      const rejectOnce = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        this.settlePendingStartup = undefined;
        this.clearStartupTimers();
        rejectReady(error);
      };

      this.settlePendingStartup = {
        resolve: resolveOnce,
        reject: rejectOnce
      };

      const onSpawn = () => {
        if (this.manualStop || currentGeneration !== this.generation) {
          return;
        }

        if (this.healthUrl !== undefined) {
          this.awaitHealthReady(currentGeneration, resolveOnce, rejectOnce);
          return;
        }

        if (this.readyDelayMs > 0) {
          this.readyDelayTimer = setTimeout(() => {
            this.readyDelayTimer = undefined;
            if (
              settled ||
              this.manualStop ||
              currentGeneration !== this.generation ||
              child.exitCode !== null ||
              child.signalCode !== null
            ) {
              return;
            }
            this.setState("running");
            resolveOnce();
          }, this.readyDelayMs);
          return;
        }

        this.setState("running");
        resolveOnce();
      };

      const onError = (error: Error) => {
        this.lastError = error.message;
        if (this.child === child) {
          this.child = undefined;
        }
        if (!settled) {
          if (isInitialStart) {
            this.setState("failed");
            rejectOnce(error);
          } else {
            this.handleUnexpectedExit(currentGeneration, null, null, error.message);
            rejectOnce(error);
          }
        }
      };

      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        this.lastExitCode = code;
        this.lastExitSignal = signal;
        if (this.child === child) {
          this.child = undefined;
        }
        this.emit("childExit", { code, signal });

        if (this.manualStop || currentGeneration !== this.generation) {
          if (!settled) {
            rejectOnce(new Error("CoreServerSupervisor stopped."));
          }
          return;
        }

        const exitDesc = `Core server exited unexpectedly (code=${String(code)}, signal=${String(signal)})`;
        this.lastError = exitDesc;

        if (!settled) {
          if (isInitialStart) {
            this.setState("failed");
            rejectOnce(new Error(exitDesc));
            return;
          }
          rejectOnce(new Error(exitDesc));
        }

        this.handleUnexpectedExit(currentGeneration, code, signal, exitDesc);
      };

      child.once("spawn", onSpawn);
      child.once("error", onError);
      child.once("exit", onExit);
    });
  }

  private awaitHealthReady(
    expectedGeneration: number,
    resolveOnce: () => void,
    rejectOnce: (error: Error) => void
  ): void {
    const healthUrl = this.healthUrl;
    if (healthUrl === undefined) {
      this.setState("running");
      resolveOnce();
      return;
    }

    const deadline = Date.now() + this.startTimeoutMs;
    this.startTimeoutTimer = setTimeout(() => {
      this.clearStartupTimers();
      const timeoutError = new Error(
        `Timed out waiting for Core server health check at ${healthUrl} after ${this.startTimeoutMs}ms.`
      );
      this.lastError = timeoutError.message;
      this.setState("failed");
      rejectOnce(timeoutError);
    }, this.startTimeoutMs);

    const poll = async () => {
      if (this.manualStop || expectedGeneration !== this.generation) {
        return;
      }

      const controller = new AbortController();
      this.healthAbortController = controller;
      const perReqTimer = setTimeout(() => controller.abort(), this.healthTimeoutMs);

      try {
        const response = await fetch(healthUrl, { signal: controller.signal });
        clearTimeout(perReqTimer);
        if (this.healthAbortController === controller) {
          this.healthAbortController = undefined;
        }

        if (this.manualStop || expectedGeneration !== this.generation) {
          return;
        }

        if (response.ok) {
          this.setState("running");
          resolveOnce();
          return;
        }
      } catch {
        clearTimeout(perReqTimer);
        if (this.healthAbortController === controller) {
          this.healthAbortController = undefined;
        }
      }

      if (
        this.manualStop ||
        expectedGeneration !== this.generation ||
        Date.now() >= deadline
      ) {
        return;
      }

      this.healthPollTimer = setTimeout(() => {
        this.healthPollTimer = undefined;
        void poll();
      }, this.healthCheckIntervalMs);
    };

    void poll();
  }

  private handleUnexpectedExit(
    expectedGeneration: number,
    _code: number | null,
    _signal: NodeJS.Signals | null,
    reason: string
  ): void {
    if (this.manualStop || expectedGeneration !== this.generation) {
      return;
    }

    if (this.restartCount >= this.maxRestarts) {
      this.lastError = `${reason}; exceeded maxRestarts (${this.maxRestarts})`;
      this.setState("failed");
      return;
    }

    this.restartCount += 1;
    const backoffMs = Math.min(
      this.maxBackoffMs,
      this.baseBackoffMs * 2 ** (this.restartCount - 1)
    );
    this.setState("restarting");

    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      if (this.manualStop || expectedGeneration !== this.generation) {
        return;
      }
      void this.spawnAndAwaitReady(false).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.lastError = message;
        this.emit("supervisorError", err);
      });
    }, backoffMs);
  }

  private attachOutputCollectors(child: ChildProcess): void {
    const bindStream = (
      stream: NodeJS.ReadableStream | null,
      streamName: "stdout" | "stderr"
    ) => {
      if (stream === null) {
        return;
      }
      const decoder = new StringDecoder("utf8");
      let remainder = "";

      const flushLines = (chunkText: string) => {
        remainder += chunkText;
        const parts = remainder.split(/\r?\n/);
        remainder = parts.pop() ?? "";
        for (const line of parts) {
          this.pushLogLine(streamName, line);
        }
      };

      stream.on("data", (chunk: Buffer | string) => {
        const text =
          typeof chunk === "string" ? chunk : decoder.write(chunk);
        if (text.length > 0) {
          flushLines(text);
        }
      });

      stream.on("end", () => {
        const tail = decoder.end();
        if (tail.length > 0) {
          remainder += tail;
        }
        if (remainder.length > 0) {
          this.pushLogLine(streamName, remainder);
          remainder = "";
        }
      });

      stream.on("error", () => {
        // Ignore stream destruction errors during shutdown.
      });
    };

    bindStream(child.stdout, "stdout");
    bindStream(child.stderr, "stderr");
  }

  private pushLogLine(stream: "stdout" | "stderr", line: string): void {
    const entry = `[${stream}] ${line}`;
    this.logs.push(entry);
    while (this.logs.length > this.logCapacity) {
      this.logs.shift();
    }
    const eventPayload: CoreSupervisorLogLine = {
      stream,
      line,
      timestamp: Date.now()
    };
    this.emit("log", eventPayload);
  }

  private cleanupChildStreams(child: ChildProcess): void {
    try {
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
    } catch {
      // Ignore stream cleanup errors.
    }
  }

  private clearStartupTimers(): void {
    if (this.healthPollTimer !== undefined) {
      clearTimeout(this.healthPollTimer);
      this.healthPollTimer = undefined;
    }
    if (this.startTimeoutTimer !== undefined) {
      clearTimeout(this.startTimeoutTimer);
      this.startTimeoutTimer = undefined;
    }
    if (this.readyDelayTimer !== undefined) {
      clearTimeout(this.readyDelayTimer);
      this.readyDelayTimer = undefined;
    }
    if (this.healthAbortController !== undefined) {
      this.healthAbortController.abort();
      this.healthAbortController = undefined;
    }
  }

  private clearStopTimers(): void {
    if (this.stopKillTimer !== undefined) {
      clearTimeout(this.stopKillTimer);
      this.stopKillTimer = undefined;
    }
    if (this.stopFallbackTimer !== undefined) {
      clearTimeout(this.stopFallbackTimer);
      this.stopFallbackTimer = undefined;
    }
  }

  private clearAllTimers(): void {
    this.clearStartupTimers();
    this.clearStopTimers();
    if (this.restartTimer !== undefined) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
  }

  private setState(next: CoreSupervisorState): void {
    if (this.state === next) {
      return;
    }
    const previous = this.state;
    this.state = next;
    this.emit("stateChange", { previous, current: next });
  }
}
