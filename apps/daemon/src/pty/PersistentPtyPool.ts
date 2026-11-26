import { Buffer } from "node:buffer";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import { StringDecoder } from "node:string_decoder";
import type {
  PtyReplayFrame,
  PtyReplayResult,
  PtySessionDescriptor
} from "@prismux/protocol";

export const DEFAULT_PTY_RING_BUFFER_BYTES = 2 * 1024 * 1024;
export const DEFAULT_DEAD_SESSION_TTL_MS = 30 * 60 * 1000;
export const DEFAULT_MAX_RETAINED_DEAD_SESSIONS = 16;

const DEFAULT_PTY_COLS = 120;
const DEFAULT_PTY_ROWS = 30;
const KILL_GRACE_PERIOD_MS = 1500;
const KILL_FORCE_CLOSE_TIMEOUT_MS = 3000;
const DEFAULT_DEAD_SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export interface PersistentPtyPoolOptions {
  ringBufferBytes?: number;
  /** TTL before dead (`alive: false`) sessions & their ring buffers are evicted (default: 30 min). */
  deadSessionTtlMs?: number;
  /** Maximum number of dead sessions retained concurrently (default: 16). */
  maxRetainedDeadSessions?: number;
  /** Background sweep interval in ms (default: 5 min; 0 disables background timer). */
  sweepIntervalMs?: number;
  /** Injectable clock for deterministic unit tests. */
  now?: () => number;
}

const POLLUTING_ENV_KEYS = new Set<string>([
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_NO_ATTACH_CONSOLE"
]);

export interface PtySpawnOptions {
  ptyId?: string;
  cwd?: string;
  command?: string;
  args?: string[];
  shell?: string;
  env?: Record<string, string | undefined>;
  group?: "default" | "agent-scratch";
  worktreeBranch?: string;
  ringBufferBytes?: number;
  cols?: number;
  rows?: number;
}

export interface ScratchWorktreeScanResult {
  repoRoot: string;
  discoveredWorktrees: string[];
  group: "agent-scratch";
  sessions: PtySessionDescriptor[];
}

export interface AdoptScratchWorktreeResult {
  adoptedThreadId: string;
  session: PtySessionDescriptor;
}

export type PtyFrameListener = (frame: PtyReplayFrame) => void;

export interface PtySubscribeOptions {
  replayFromSeq?: number;
}

interface StoredPtyFrame {
  frame: PtyReplayFrame;
  byteLength: number;
}

interface SubscriberHandle {
  active: boolean;
  deliver: (frame: PtyReplayFrame) => void;
}

export interface PtySessionRuntimeInfo {
  ptyId: string;
  pid: number | null;
  command: string | null;
  cwd: string;
  group: "default" | "agent-scratch";
  worktreeBranch?: string;
  alive: boolean;
  bufferBytes: number;
  createdAt: number;
  lastActivityAt: number;
}

interface PtySessionState {
  ptyId: string;
  cwd: string;
  command?: string;
  group: "default" | "agent-scratch";
  worktreeBranch?: string;
  alive: boolean;
  ringBufferBytes: number;
  frames: StoredPtyFrame[];
  bufferBytes: number;
  droppedBytes: number;
  lastSeq: number;
  cols: number;
  rows: number;
  createdAt: number;
  lastActivityAt: number;
  deadAt?: number;
  child?: ChildProcessWithoutNullStreams;
  closePromise?: Promise<void>;
  killInitiated: boolean;
  subscribers: Set<SubscriberHandle>;
}

/**
 * Removes Electron host-polluting environment variables and `undefined` entries
 * before spawning a PTY child process or sub-shell.
 */
export function sanitizePtyEnv(
  env: Record<string, string | undefined>
): Record<string, string> {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      continue;
    }
    if (POLLUTING_ENV_KEYS.has(key.toUpperCase())) {
      continue;
    }
    cleaned[key] = value;
  }
  return cleaned;
}

/**
 * Resolves the platform default shell when no explicit command or shell is provided.
 */
export function resolveDefaultShell(): string {
  if (process.platform === "win32") {
    const comspec = process.env.COMSPEC?.trim();
    return comspec && comspec.length > 0 ? comspec : "powershell.exe";
  }
  const shell = process.env.SHELL?.trim();
  return shell && shell.length > 0 ? shell : "/bin/sh";
}

function validateRingBufferBytes(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(
      `ringBufferBytes must be a positive finite number, received ${String(value)}`
    );
  }
  return Math.floor(value);
}

function normalizeDimension(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.floor(value);
}

/**
 * Slices at most `maxBytes` from the tail of a valid UTF-8 buffer, skipping any
 * leading continuation bytes (`10xxxxxx`) so multi-byte code points never tear.
 */
function sliceUtf8Tail(buf: Buffer, maxBytes: number): Buffer {
  if (buf.length <= maxBytes) {
    return buf;
  }
  let start = buf.length - maxBytes;
  while (start < buf.length) {
    const byte = buf[start];
    if (byte === undefined || (byte & 0xc0) !== 0x80) {
      break;
    }
    start += 1;
  }
  return buf.subarray(start);
}

function shortSha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex").slice(0, 8);
}

function toSafeSlug(input: string, fallback: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : fallback;
}

function toDescriptor(state: PtySessionState): PtySessionDescriptor {
  return {
    ptyId: state.ptyId,
    cwd: state.cwd,
    group: state.group,
    ...(state.worktreeBranch !== undefined
      ? { worktreeBranch: state.worktreeBranch }
      : {}),
    alive: state.alive,
    bufferBytes: state.bufferBytes
  };
}

function parseHeadBranch(headContent: string): string | undefined {
  const trimmed = headContent.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const refMatch = /^ref:\s*(.+)$/i.exec(trimmed);
  if (refMatch === null) {
    return undefined;
  }
  const refTarget = refMatch[1]?.trim() ?? "";
  if (refTarget.length === 0) {
    return undefined;
  }
  const headsPrefix = "refs/heads/";
  if (refTarget.startsWith(headsPrefix)) {
    const branch = refTarget.slice(headsPrefix.length).trim();
    return branch.length > 0 ? branch : undefined;
  }
  return refTarget;
}

async function resolveWorktreeBranch(worktreePath: string): Promise<string | undefined> {
  const dotGitPath = join(worktreePath, ".git");
  try {
    const dotGitStat = await stat(dotGitPath);
    let gitDir: string | undefined;
    if (dotGitStat.isDirectory()) {
      gitDir = dotGitPath;
    } else if (dotGitStat.isFile()) {
      const dotGitText = await readFile(dotGitPath, "utf8");
      const gitDirMatch = /^gitdir:\s*(.+)$/im.exec(dotGitText);
      const rawGitDir = gitDirMatch?.[1]?.trim();
      if (rawGitDir !== undefined && rawGitDir.length > 0) {
        gitDir = resolve(worktreePath, rawGitDir);
      }
    }
    if (gitDir === undefined) {
      return undefined;
    }
    const headContent = await readFile(join(gitDir, "HEAD"), "utf8");
    return parseHeadBranch(headContent);
  } catch {
    return undefined;
  }
}

/**
 * Orca-inspired persistent PTY ring-buffer pool (default 2 MB serialized frames per terminal).
 * Survives desktop Tauri window close/reconnect and folds `.claude/worktrees/*` under `agent-scratch`.
 */
export class PersistentPtyPool {
  private readonly sessions = new Map<string, PtySessionState>();
  private readonly ringBufferBytes: number;
  private readonly deadSessionTtlMs: number;
  private readonly maxRetainedDeadSessions: number;
  private readonly sweepIntervalMs: number;
  private readonly now: () => number;
  private deadSweepTimer: NodeJS.Timeout | undefined;

  constructor(
    ringBufferBytesOrOptions: number | PersistentPtyPoolOptions = DEFAULT_PTY_RING_BUFFER_BYTES
  ) {
    if (typeof ringBufferBytesOrOptions === "number") {
      this.ringBufferBytes = validateRingBufferBytes(ringBufferBytesOrOptions);
      this.deadSessionTtlMs = DEFAULT_DEAD_SESSION_TTL_MS;
      this.maxRetainedDeadSessions = DEFAULT_MAX_RETAINED_DEAD_SESSIONS;
      this.sweepIntervalMs = DEFAULT_DEAD_SESSION_SWEEP_INTERVAL_MS;
      this.now = () => Date.now();
    } else {
      this.ringBufferBytes = validateRingBufferBytes(
        ringBufferBytesOrOptions.ringBufferBytes ?? DEFAULT_PTY_RING_BUFFER_BYTES
      );
      this.deadSessionTtlMs = Math.max(
        0,
        ringBufferBytesOrOptions.deadSessionTtlMs ?? DEFAULT_DEAD_SESSION_TTL_MS
      );
      this.maxRetainedDeadSessions = Math.max(
        0,
        Math.floor(
          ringBufferBytesOrOptions.maxRetainedDeadSessions ??
            DEFAULT_MAX_RETAINED_DEAD_SESSIONS
        )
      );
      this.sweepIntervalMs = Math.max(
        0,
        ringBufferBytesOrOptions.sweepIntervalMs ??
          DEFAULT_DEAD_SESSION_SWEEP_INTERVAL_MS
      );
      this.now = ringBufferBytesOrOptions.now ?? (() => Date.now());
    }
  }

  private ensureDeadSweepTimer(): void {
    if (this.deadSweepTimer !== undefined || this.sweepIntervalMs <= 0) {
      return;
    }
    this.deadSweepTimer = setInterval(() => {
      this.evictDeadSessions();
    }, this.sweepIntervalMs);
    this.deadSweepTimer.unref();
  }

  private stopDeadSweepTimer(): void {
    if (this.deadSweepTimer !== undefined) {
      clearInterval(this.deadSweepTimer);
      this.deadSweepTimer = undefined;
    }
  }

  private markSessionDead(state: PtySessionState): void {
    state.alive = false;
    if (state.deadAt === undefined) {
      state.deadAt = this.now();
    }
    this.ensureDeadSweepTimer();
    this.evictDeadSessions();
  }

  /**
   * Evicts dead (`alive: false`) sessions that have exceeded `deadSessionTtlMs` (30m default)
   * or exceed `maxRetainedDeadSessions` (16 default), immediately releasing their 2 MiB ring buffers.
   */
  evictDeadSessions(nowMs: number = this.now()): number {
    let evicted = 0;
    const retainedDead: PtySessionState[] = [];

    for (const [ptyId, state] of this.sessions.entries()) {
      if (state.alive) continue;
      const deadSince = state.deadAt ?? state.lastActivityAt;
      if (this.deadSessionTtlMs > 0 && nowMs - deadSince >= this.deadSessionTtlMs) {
        this.releaseSessionState(ptyId, state);
        evicted += 1;
      } else {
        retainedDead.push(state);
      }
    }

    if (retainedDead.length > this.maxRetainedDeadSessions) {
      retainedDead.sort((a, b) => {
        const aSub = a.subscribers.size > 0 ? 1 : 0;
        const bSub = b.subscribers.size > 0 ? 1 : 0;
        if (aSub !== bSub) return aSub - bSub;
        const aTs = a.deadAt ?? a.lastActivityAt;
        const bTs = b.deadAt ?? b.lastActivityAt;
        return aTs - bTs;
      });
      const overflow = retainedDead.length - this.maxRetainedDeadSessions;
      for (let i = 0; i < overflow; i += 1) {
        const victim = retainedDead[i]!;
        this.releaseSessionState(victim.ptyId, victim);
        evicted += 1;
      }
    }

    const hasRemainingDead = Array.from(this.sessions.values()).some((s) => !s.alive);
    if (!hasRemainingDead) {
      this.stopDeadSweepTimer();
    }
    return evicted;
  }

  private releaseSessionState(ptyId: string, state: PtySessionState): void {
    for (const subscriber of state.subscribers) {
      subscriber.active = false;
    }
    state.subscribers.clear();
    state.frames.length = 0;
    state.bufferBytes = 0;
    this.sessions.delete(ptyId);
  }

  getRingBufferLimitBytes(): number {
    return this.ringBufferBytes;
  }

  listSessions(): PtySessionDescriptor[] {
    return Array.from(this.sessions.values(), (state) => toDescriptor(state));
  }

  listSessionRuntimeInfos(): PtySessionRuntimeInfo[] {
    return Array.from(this.sessions.values(), (state) => ({
      ptyId: state.ptyId,
      pid: typeof state.child?.pid === "number" ? state.child.pid : null,
      command: state.command ?? null,
      cwd: state.cwd,
      group: state.group,
      ...(state.worktreeBranch !== undefined
        ? { worktreeBranch: state.worktreeBranch }
        : {}),
      alive: state.alive,
      bufferBytes: state.bufferBytes,
      createdAt: state.createdAt,
      lastActivityAt: state.lastActivityAt
    }));
  }

  async killAndRemoveSession(
    ptyId: string,
    signal: NodeJS.Signals | number | (string & {}) = "SIGTERM"
  ): Promise<{ existed: boolean; killed: boolean; removed: boolean }> {
    const state = this.sessions.get(ptyId);
    if (state === undefined) {
      return { existed: false, killed: false, removed: false };
    }
    const killed = await this.kill(ptyId, signal);
    for (const subscriber of state.subscribers) {
      subscriber.active = false;
    }
    state.subscribers.clear();
    const removed = this.sessions.delete(ptyId);
    return { existed: true, killed, removed };
  }

  getSession(ptyId: string): PtySessionDescriptor | undefined {
    const state = this.sessions.get(ptyId);
    return state === undefined ? undefined : toDescriptor(state);
  }

  getSessionDimensions(ptyId: string): { cols: number; rows: number } | undefined {
    const state = this.sessions.get(ptyId);
    if (state === undefined) {
      return undefined;
    }
    return { cols: state.cols, rows: state.rows };
  }

  registerSession(options: PtySpawnOptions): PtySessionDescriptor {
    const ptyId =
      options.ptyId !== undefined && options.ptyId.length > 0
        ? options.ptyId
        : `pty-${randomUUID()}`;
    const existing = this.sessions.get(ptyId);
    if (existing?.child !== undefined && existing.alive) {
      throw new Error(`PTY session "${ptyId}" already has an active child process.`);
    }

    const state = this.createSessionState({
      ptyId,
      cwd: options.cwd !== undefined && options.cwd.length > 0 ? options.cwd : process.cwd(),
      group: options.group ?? "default",
      worktreeBranch: options.worktreeBranch,
      alive: true,
      ringBufferBytes:
        options.ringBufferBytes !== undefined
          ? validateRingBufferBytes(options.ringBufferBytes)
          : this.ringBufferBytes,
      cols: normalizeDimension(options.cols, DEFAULT_PTY_COLS),
      rows: normalizeDimension(options.rows, DEFAULT_PTY_ROWS)
    });
    this.sessions.set(ptyId, state);
    return toDescriptor(state);
  }

  spawnSession(options: PtySpawnOptions = {}): PtySessionDescriptor {
    const ptyId =
      options.ptyId !== undefined && options.ptyId.length > 0
        ? options.ptyId
        : `pty-${randomUUID()}`;
    const existing = this.sessions.get(ptyId);
    if (existing?.child !== undefined && existing.alive) {
      throw new Error(`PTY session "${ptyId}" is already running.`);
    }

    const cwd =
      options.cwd !== undefined && options.cwd.length > 0
        ? options.cwd
        : (existing?.cwd ?? process.cwd());
    const cols = normalizeDimension(
      options.cols,
      existing?.cols ?? DEFAULT_PTY_COLS
    );
    const rows = normalizeDimension(
      options.rows,
      existing?.rows ?? DEFAULT_PTY_ROWS
    );
    const limitBytes =
      options.ringBufferBytes !== undefined
        ? validateRingBufferBytes(options.ringBufferBytes)
        : (existing?.ringBufferBytes ?? this.ringBufferBytes);
    const group = options.group ?? existing?.group ?? "default";
    const worktreeBranch = options.worktreeBranch ?? existing?.worktreeBranch;

    const command =
      options.command !== undefined && options.command.length > 0
        ? options.command
        : options.shell !== undefined && options.shell.length > 0
          ? options.shell
          : resolveDefaultShell();
    const args = options.args ?? [];

    const cleanedEnv = sanitizePtyEnv({
      ...process.env,
      ...options.env
    });
    if (options.cols !== undefined && cleanedEnv.COLUMNS === undefined) {
      cleanedEnv.COLUMNS = String(cols);
    }
    if (options.rows !== undefined && cleanedEnv.LINES === undefined) {
      cleanedEnv.LINES = String(rows);
    }

    const state =
      existing !== undefined
        ? Object.assign(existing, {
            cwd,
            command,
            group,
            worktreeBranch,
            alive: true,
            deadAt: undefined,
            ringBufferBytes: limitBytes,
            cols,
            rows,
            lastActivityAt: this.now(),
            killInitiated: false
          })
        : this.createSessionState({
            ptyId,
            cwd,
            command,
            group,
            worktreeBranch,
            alive: true,
            ringBufferBytes: limitBytes,
            cols,
            rows
          });
    this.sessions.set(ptyId, state);

    const child = spawn(command, args, {
      cwd,
      env: cleanedEnv,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    state.child = child;

    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");

    let resolveClose: (() => void) | undefined;
    state.closePromise = new Promise<void>((resolvePromise) => {
      resolveClose = resolvePromise;
    });

    let finalized = false;
    const finalizeChild = (): void => {
      if (finalized) {
        return;
      }
      finalized = true;
      state.child = undefined;
      this.markSessionDead(state);
      resolveClose?.();
    };

    child.stdin.on("error", () => {
      // Ignore EPIPE or stream errors when process exits mid-write.
    });

    child.stdout.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : stdoutDecoder.write(chunk);
      if (text.length > 0) {
        this.appendFrame(ptyId, text);
      }
    });

    child.stdout.on("end", () => {
      const tail = stdoutDecoder.end();
      if (tail.length > 0) {
        this.appendFrame(ptyId, tail);
      }
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : stderrDecoder.write(chunk);
      if (text.length > 0) {
        this.appendFrame(ptyId, text);
      }
    });

    child.stderr.on("end", () => {
      const tail = stderrDecoder.end();
      if (tail.length > 0) {
        this.appendFrame(ptyId, tail);
      }
    });

    child.on("exit", () => {
      state.alive = false;
    });

    child.on("error", (error) => {
      this.appendFrame(ptyId, `[pty error] ${error.message}\n`);
      finalizeChild();
    });

    child.on("close", () => {
      finalizeChild();
    });

    return toDescriptor(state);
  }

  appendFrame(ptyId: string, data: string): PtyReplayFrame {
    let state = this.sessions.get(ptyId);
    if (state === undefined) {
      state = this.createSessionState({
        ptyId,
        cwd: process.cwd(),
        group: "default",
        alive: true,
        ringBufferBytes: this.ringBufferBytes,
        cols: DEFAULT_PTY_COLS,
        rows: DEFAULT_PTY_ROWS
      });
      this.sessions.set(ptyId, state);
    }

    state.lastSeq += 1;
    const seq = state.lastSeq;
    const timestamp = Date.now();
    const rawBuf = Buffer.from(data, "utf8");
    const limit = state.ringBufferBytes;

    let storedData = data;
    let storedBytes = rawBuf.length;

    if (rawBuf.length > limit) {
      for (const existing of state.frames) {
        state.droppedBytes += existing.byteLength;
      }
      state.frames.length = 0;
      state.bufferBytes = 0;

      const tailBuf = sliceUtf8Tail(rawBuf, limit);
      state.droppedBytes += rawBuf.length - tailBuf.length;
      storedData = tailBuf.toString("utf8");
      storedBytes = tailBuf.length;
    } else {
      while (state.bufferBytes + storedBytes > limit && state.frames.length > 0) {
        const oldest = state.frames.shift();
        if (oldest !== undefined) {
          state.bufferBytes -= oldest.byteLength;
          state.droppedBytes += oldest.byteLength;
        }
      }
    }

    const frame: PtyReplayFrame = {
      ptyId,
      seq,
      timestamp,
      data: storedData
    };
    state.frames.push({ frame, byteLength: storedBytes });
    state.bufferBytes += storedBytes;
    state.lastActivityAt = timestamp;

    for (const subscriber of Array.from(state.subscribers)) {
      if (subscriber.active) {
        subscriber.deliver({ ...frame });
      }
    }

    return { ...frame };
  }

  replay(ptyId: string, fromSeq = 0): PtyReplayResult {
    const state = this.sessions.get(ptyId);
    if (state === undefined) {
      return {
        frames: [],
        oldestSeq: 0,
        latestSeq: 0,
        droppedBytes: 0,
        bufferBytes: 0
      };
    }

    const firstFrame = state.frames[0];
    const oldestSeq = firstFrame !== undefined ? firstFrame.frame.seq : 0;
    const frames = state.frames
      .filter((entry) => entry.frame.seq > fromSeq)
      .map((entry) => ({ ...entry.frame }));

    return {
      frames,
      oldestSeq,
      latestSeq: state.lastSeq,
      droppedBytes: state.droppedBytes,
      bufferBytes: state.bufferBytes
    };
  }

  subscribe(
    ptyId: string,
    listener: PtyFrameListener,
    options?: PtySubscribeOptions
  ): () => void {
    const state = this.sessions.get(ptyId);
    if (state === undefined) {
      throw new Error(`PTY session not found: ${ptyId}`);
    }

    const replayFromSeq = options?.replayFromSeq ?? 0;
    const snapshot = this.replay(ptyId, replayFromSeq).frames;

    let replaying = true;
    let lastDeliveredSeq = replayFromSeq;
    const liveQueue: PtyReplayFrame[] = [];

    const handle: SubscriberHandle = {
      active: true,
      deliver: (frame: PtyReplayFrame) => {
        if (!handle.active) {
          return;
        }
        if (replaying) {
          liveQueue.push(frame);
          return;
        }
        if (frame.seq > lastDeliveredSeq) {
          lastDeliveredSeq = frame.seq;
          listener(frame);
        }
      }
    };

    state.subscribers.add(handle);

    const unsubscribe = (): void => {
      if (!handle.active) {
        return;
      }
      handle.active = false;
      state.subscribers.delete(handle);
    };

    for (const frame of snapshot) {
      if (!handle.active) {
        return unsubscribe;
      }
      if (frame.seq > lastDeliveredSeq) {
        lastDeliveredSeq = frame.seq;
        listener(frame);
      }
    }

    replaying = false;

    for (const queued of liveQueue) {
      if (!handle.active) {
        return unsubscribe;
      }
      if (queued.seq > lastDeliveredSeq) {
        lastDeliveredSeq = queued.seq;
        listener(queued);
      }
    }

    return unsubscribe;
  }

  write(ptyId: string, data: string): boolean {
    const state = this.sessions.get(ptyId);
    if (state === undefined || !state.alive || state.child === undefined) {
      return false;
    }
    const child = state.child;
    if (
      child.killed ||
      child.exitCode !== null ||
      child.signalCode !== null ||
      !child.stdin.writable
    ) {
      return false;
    }
    try {
      child.stdin.write(data, "utf8");
      state.lastActivityAt = Date.now();
      return true;
    } catch {
      return false;
    }
  }

  resize(ptyId: string, cols: number, rows: number): boolean {
    const state = this.sessions.get(ptyId);
    if (state === undefined || !state.alive) {
      return false;
    }
    if (
      !Number.isFinite(cols) ||
      !Number.isFinite(rows) ||
      cols < 1 ||
      rows < 1
    ) {
      return false;
    }
    state.cols = Math.floor(cols);
    state.rows = Math.floor(rows);
    return true;
  }

  async kill(
    ptyId: string,
    signal: NodeJS.Signals | number | (string & {}) = "SIGTERM"
  ): Promise<boolean> {
    const state = this.sessions.get(ptyId);
    if (state === undefined) {
      return false;
    }

    const child = state.child;
    if (child === undefined) {
      if (!state.alive) {
        return false;
      }
      this.markSessionDead(state);
      return true;
    }

    const alreadyDead =
      child.exitCode !== null || child.signalCode !== null || !state.alive;
    if (alreadyDead) {
      await state.closePromise;
      return false;
    }

    if (state.killInitiated) {
      await state.closePromise;
      return false;
    }
    state.killInitiated = true;

    const closePromise = state.closePromise ?? Promise.resolve();

    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    let forceCloseTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      try {
        child.kill(signal as NodeJS.Signals | number);
      } catch {
        child.kill();
      }

      graceTimer = setTimeout(() => {
        if (state.child !== undefined && state.alive) {
          try {
            state.child.kill("SIGKILL");
          } catch {
            // Process may have exited concurrently.
          }
        }
      }, KILL_GRACE_PERIOD_MS);
      graceTimer.unref();

      await Promise.race([
        closePromise,
        new Promise<void>((resolveWait) => {
          forceCloseTimer = setTimeout(() => {
            child.stdin.destroy();
            child.stdout.destroy();
            child.stderr.destroy();
            state.alive = false;
            state.child = undefined;
            resolveWait();
          }, KILL_FORCE_CLOSE_TIMEOUT_MS);
          forceCloseTimer.unref();
        })
      ]);
    } finally {
      if (graceTimer !== undefined) {
        clearTimeout(graceTimer);
      }
      if (forceCloseTimer !== undefined) {
        clearTimeout(forceCloseTimer);
      }
    }

    return true;
  }

  async scanAgentScratchWorktrees(
    repoRoot: string
  ): Promise<ScratchWorktreeScanResult> {
    const normalizedRoot = resolve(repoRoot);
    const worktreesRoot = join(normalizedRoot, ".claude", "worktrees");

    let entries;
    try {
      entries = await readdir(worktreesRoot, { withFileTypes: true });
    } catch {
      return {
        repoRoot: normalizedRoot,
        discoveredWorktrees: [],
        group: "agent-scratch",
        sessions: []
      };
    }

    const dirNames: string[] = [];
    for (const entry of entries) {
      const fullPath = join(worktreesRoot, entry.name);
      if (entry.isDirectory()) {
        dirNames.push(entry.name);
      } else if (entry.isSymbolicLink()) {
        try {
          const targetStat = await stat(fullPath);
          if (targetStat.isDirectory()) {
            dirNames.push(entry.name);
          }
        } catch {
          // Ignore broken symlinks.
        }
      }
    }
    dirNames.sort((a, b) => a.localeCompare(b));

    const discoveredWorktrees: string[] = [];
    const sessions: PtySessionDescriptor[] = [];

    for (const dirName of dirNames) {
      const worktreePath = join(worktreesRoot, dirName);
      discoveredWorktrees.push(worktreePath);
      const branch = await resolveWorktreeBranch(worktreePath);

      let existingState: PtySessionState | undefined;
      for (const candidate of this.sessions.values()) {
        if (resolve(candidate.cwd) === worktreePath) {
          existingState = candidate;
          break;
        }
      }

      if (existingState !== undefined) {
        existingState.worktreeBranch = branch;
        sessions.push(toDescriptor(existingState));
        continue;
      }

      const slug = toSafeSlug(dirName, "worktree");
      const ptyId = `scratch-${slug}-${shortSha256(worktreePath)}`;
      const created = this.createSessionState({
        ptyId,
        cwd: worktreePath,
        group: "agent-scratch",
        worktreeBranch: branch,
        alive: false,
        ringBufferBytes: this.ringBufferBytes,
        cols: DEFAULT_PTY_COLS,
        rows: DEFAULT_PTY_ROWS
      });
      this.sessions.set(ptyId, created);
      sessions.push(toDescriptor(created));
    }

    return {
      repoRoot: normalizedRoot,
      discoveredWorktrees,
      group: "agent-scratch",
      sessions
    };
  }

  adoptScratchWorktree(
    ptyId: string,
    projectName?: string
  ): AdoptScratchWorktreeResult {
    const state = this.sessions.get(ptyId);
    if (state === undefined) {
      throw new Error(`Cannot adopt unknown PTY session: ${ptyId}`);
    }

    state.group = "default";

    const rawProject =
      projectName !== undefined && projectName.trim().length > 0
        ? projectName.trim()
        : (state.worktreeBranch ?? basename(state.cwd));
    const projectSlug = toSafeSlug(rawProject, "project");
    const adoptedThreadId = `thread-${projectSlug}-${shortSha256(
      `${ptyId}:${rawProject}`
    )}`;

    return {
      adoptedThreadId,
      session: toDescriptor(state)
    };
  }

  async dispose(): Promise<void> {
    this.stopDeadSweepTimer();
    const killTasks: Array<Promise<boolean>> = [];
    for (const [ptyId, state] of this.sessions.entries()) {
      for (const subscriber of state.subscribers) {
        subscriber.active = false;
      }
      state.subscribers.clear();
      if (state.child !== undefined && state.alive) {
        killTasks.push(this.kill(ptyId));
      } else {
        state.alive = false;
      }
    }
    await Promise.all(killTasks);
    this.stopDeadSweepTimer();
    for (const state of this.sessions.values()) {
      state.alive = false;
    }
  }

  private createSessionState(init: {
    ptyId: string;
    cwd: string;
    command?: string;
    group: "default" | "agent-scratch";
    worktreeBranch?: string;
    alive: boolean;
    ringBufferBytes: number;
    cols: number;
    rows: number;
  }): PtySessionState {
    const now = this.now();
    return {
      ptyId: init.ptyId,
      cwd: init.cwd,
      ...(init.command !== undefined ? { command: init.command } : {}),
      group: init.group,
      worktreeBranch: init.worktreeBranch,
      alive: init.alive,
      ...(init.alive ? {} : { deadAt: now }),
      ringBufferBytes: init.ringBufferBytes,
      frames: [],
      bufferBytes: 0,
      droppedBytes: 0,
      lastSeq: 0,
      cols: init.cols,
      rows: init.rows,
      createdAt: now,
      lastActivityAt: now,
      killInitiated: false,
      subscribers: new Set<SubscriberHandle>()
    };
  }
}
