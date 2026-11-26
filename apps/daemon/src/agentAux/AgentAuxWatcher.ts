import { watch as watchFs, type FSWatcher } from "node:fs";
import type {
  AgentAuxInspectQuery,
  AgentAuxInspectResponse,
  AgentAuxService
} from "./AgentAuxService.js";

export const MAX_WATCHED_DIRS = 16;
export const MAX_SUBSCRIBERS_PER_DIR = 8;
export const DEFAULT_WATCH_DEBOUNCE_MS = 250;
export const DEFAULT_IDLE_GRACE_MS = 5_000;
export const DEFAULT_PROMOTE_POLL_MS = 3_000;

export interface AgentAuxWatcherOptions {
  readonly debounceMs?: number;
  readonly idleGraceMs?: number;
  readonly promotePollMs?: number;
  readonly maxWatchedDirs?: number;
  readonly maxSubscribersPerDir?: number;
}

export type AgentAuxWatchListener = (snapshot: AgentAuxInspectResponse) => void;

interface SubscriptionEntry {
  readonly id: number;
  readonly query: AgentAuxInspectQuery;
  readonly listener: AgentAuxWatchListener;
  lastEtag: string;
  watchedDirs: Set<string>;
  resolvedExact: boolean;
  disposed: boolean;
  inFlight: boolean;
  pendingInspect: boolean;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  promoteTimer: ReturnType<typeof setInterval> | null;
}

interface DirWatchPoolEntry {
  readonly dirPath: string;
  readonly watcher: FSWatcher;
  readonly subscribers: Set<SubscriptionEntry>;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Ref-counted, bounded, debounced `fs.watch` multiplexer for local AgentAux
 * directories (AGY swarm JSON/JSONL, Claude teams/tasks, Codex state).
 *
 * Strictly read-only; never touches `state.vscdb`, Keyring, OAuth, or Cookies.
 */
export class AgentAuxWatcher {
  private readonly service: AgentAuxService;
  private readonly debounceMs: number;
  private readonly idleGraceMs: number;
  private readonly promotePollMs: number;
  private readonly maxWatchedDirs: number;
  private readonly maxSubscribersPerDir: number;

  private readonly dirPool = new Map<string, DirWatchPoolEntry>();
  private readonly subscriptions = new Set<SubscriptionEntry>();
  private nextSubscriptionId = 1;
  private disposed = false;

  constructor(service: AgentAuxService, options: AgentAuxWatcherOptions = {}) {
    this.service = service;
    this.debounceMs = Math.max(20, options.debounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS);
    this.idleGraceMs = Math.max(0, options.idleGraceMs ?? DEFAULT_IDLE_GRACE_MS);
    this.promotePollMs = Math.max(250, options.promotePollMs ?? DEFAULT_PROMOTE_POLL_MS);
    this.maxWatchedDirs = Math.max(1, options.maxWatchedDirs ?? MAX_WATCHED_DIRS);
    this.maxSubscribersPerDir = Math.max(
      1,
      options.maxSubscribersPerDir ?? MAX_SUBSCRIBERS_PER_DIR
    );
  }

  getActiveWatcherCount(): number {
    return this.dirPool.size;
  }

  getActiveSubscriberCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Subscribes to live AgentAux snapshot changes for a query.
   * Returns an unsubscribe function accepting optional `immediate` flag
   * (true on server shutdown to tear down idle watchers synchronously).
   */
  subscribe(
    query: AgentAuxInspectQuery,
    listener: AgentAuxWatchListener,
    initialEtag = ""
  ): (immediate?: boolean) => void {
    if (this.disposed) {
      return () => {};
    }

    const sub: SubscriptionEntry = {
      id: this.nextSubscriptionId++,
      query: {
        ...(query.provider !== undefined ? { provider: query.provider } : {}),
        ...(query.sessionId !== undefined ? { sessionId: query.sessionId } : {}),
        ...(query.cwd !== undefined ? { cwd: query.cwd } : {})
      },
      listener,
      lastEtag: initialEtag,
      watchedDirs: new Set(),
      resolvedExact: false,
      disposed: false,
      inFlight: false,
      pendingInspect: false,
      debounceTimer: null,
      promoteTimer: null
    };

    this.subscriptions.add(sub);
    void this.attachTargets(sub);

    return (immediate = false) => {
      this.unsubscribeEntry(sub, immediate);
    };
  }

  /**
   * Synchronously closes all active FSWatchers and timers.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const sub of Array.from(this.subscriptions)) {
      this.unsubscribeEntry(sub, true);
    }
    this.subscriptions.clear();

    for (const entry of Array.from(this.dirPool.values())) {
      if (entry.graceTimer !== null) {
        clearTimeout(entry.graceTimer);
        entry.graceTimer = null;
      }
      try {
        entry.watcher.close();
      } catch {
        // ignore close errors
      }
    }
    this.dirPool.clear();
  }

  private unsubscribeEntry(sub: SubscriptionEntry, immediate: boolean): void {
    if (sub.disposed) return;
    sub.disposed = true;
    this.subscriptions.delete(sub);

    if (sub.debounceTimer !== null) {
      clearTimeout(sub.debounceTimer);
      sub.debounceTimer = null;
    }
    if (sub.promoteTimer !== null) {
      clearInterval(sub.promoteTimer);
      sub.promoteTimer = null;
    }

    for (const dirPath of Array.from(sub.watchedDirs)) {
      this.detachDir(sub, dirPath, immediate);
    }
    sub.watchedDirs.clear();
  }

  private async attachTargets(sub: SubscriptionEntry): Promise<void> {
    if (sub.disposed || this.disposed) return;
    let resolved: { dirs: string[]; resolvedExact: boolean };
    try {
      resolved = await this.service.resolveWatchTargets(sub.query);
    } catch {
      resolved = { dirs: [], resolvedExact: false };
    }
    if (sub.disposed || this.disposed) return;

    const nextDirs = new Set(resolved.dirs);
    sub.resolvedExact = resolved.resolvedExact;

    // Detach stale dirs no longer needed
    for (const prevDir of Array.from(sub.watchedDirs)) {
      if (!nextDirs.has(prevDir)) {
        this.detachDir(sub, prevDir, false);
        sub.watchedDirs.delete(prevDir);
      }
    }

    // Attach newly discovered dirs
    let newlyAttached = false;
    for (const dirPath of nextDirs) {
      if (!sub.watchedDirs.has(dirPath)) {
        if (this.attachDir(sub, dirPath)) {
          sub.watchedDirs.add(dirPath);
          newlyAttached = true;
        }
      }
    }

    // Close any TOCTOU window between initial inspect() and async fs.watch mount
    if (newlyAttached) {
      this.scheduleInspect(sub);
    }

    // If the exact swarm dir does not exist yet (e.g. `agy acp` just started before writing plan.json),
    // periodically check for promotion AND re-inspect until the exact dir appears.
    if (!sub.resolvedExact && sub.promoteTimer === null) {
      const timer = setInterval(() => {
        if (sub.disposed || this.disposed) return;
        void this.attachTargets(sub);
        this.scheduleInspect(sub);
      }, this.promotePollMs);
      timer.unref?.();
      sub.promoteTimer = timer;
    } else if (sub.resolvedExact && sub.promoteTimer !== null) {
      clearInterval(sub.promoteTimer);
      sub.promoteTimer = null;
    }
  }

  private attachDir(sub: SubscriptionEntry, dirPath: string): boolean {
    const existing = this.dirPool.get(dirPath);
    if (existing) {
      if (existing.graceTimer !== null) {
        clearTimeout(existing.graceTimer);
        existing.graceTimer = null;
      }
      if (
        !existing.subscribers.has(sub) &&
        existing.subscribers.size >= this.maxSubscribersPerDir
      ) {
        return false;
      }
      existing.subscribers.add(sub);
      return true;
    }

    if (this.dirPool.size >= this.maxWatchedDirs) {
      // Evict an idle grace-window watcher first if available
      let evicted = false;
      for (const [k, v] of this.dirPool.entries()) {
        if (v.subscribers.size === 0) {
          this.closePoolEntry(k, v);
          evicted = true;
          break;
        }
      }
      if (!evicted) {
        return false;
      }
    }

    let watcher: FSWatcher;
    try {
      watcher = watchFs(dirPath, { persistent: false }, () => {
        const entry = this.dirPool.get(dirPath);
        if (!entry) return;
        for (const subscriber of entry.subscribers) {
          if (!subscriber.resolvedExact) {
            void this.attachTargets(subscriber);
          }
          this.scheduleInspect(subscriber);
        }
      });
    } catch {
      return false;
    }

    const entry: DirWatchPoolEntry = {
      dirPath,
      watcher,
      subscribers: new Set([sub]),
      graceTimer: null
    };

    watcher.on("error", () => {
      const cur = this.dirPool.get(dirPath);
      if (cur === entry) {
        for (const subscriber of Array.from(cur.subscribers)) {
          subscriber.watchedDirs.delete(dirPath);
        }
        this.closePoolEntry(dirPath, cur);
      }
    });

    this.dirPool.set(dirPath, entry);
    return true;
  }

  private detachDir(
    sub: SubscriptionEntry,
    dirPath: string,
    immediate: boolean
  ): void {
    const entry = this.dirPool.get(dirPath);
    if (!entry) return;
    entry.subscribers.delete(sub);
    if (entry.subscribers.size > 0) return;

    if (immediate || this.idleGraceMs === 0) {
      this.closePoolEntry(dirPath, entry);
      return;
    }

    if (entry.graceTimer === null) {
      const timer = setTimeout(() => {
        entry.graceTimer = null;
        if (entry.subscribers.size === 0) {
          this.closePoolEntry(dirPath, entry);
        }
      }, this.idleGraceMs);
      timer.unref?.();
      entry.graceTimer = timer;
    }
  }

  private closePoolEntry(dirPath: string, entry: DirWatchPoolEntry): void {
    if (entry.graceTimer !== null) {
      clearTimeout(entry.graceTimer);
      entry.graceTimer = null;
    }
    this.dirPool.delete(dirPath);
    try {
      entry.watcher.close();
    } catch {
      // ignore close errors
    }
  }

  private scheduleInspect(sub: SubscriptionEntry): void {
    if (sub.disposed || this.disposed) return;
    if (sub.debounceTimer !== null) {
      clearTimeout(sub.debounceTimer);
    }
    const timer = setTimeout(() => {
      sub.debounceTimer = null;
      void this.runInspect(sub);
    }, this.debounceMs);
    timer.unref?.();
    sub.debounceTimer = timer;
  }

  private async runInspect(sub: SubscriptionEntry): Promise<void> {
    if (sub.disposed || this.disposed) return;
    if (sub.inFlight) {
      sub.pendingInspect = true;
      return;
    }
    sub.inFlight = true;
    try {
      const snapshot = await this.service.inspect({
        ...sub.query,
        ...(sub.lastEtag ? { etag: sub.lastEtag } : {})
      });
      if (sub.disposed || this.disposed) return;

      const nextEtag = snapshot.etag ?? "";
      if (snapshot.unchanged === true && nextEtag && nextEtag === sub.lastEtag) {
        return;
      }
      if (nextEtag && nextEtag === sub.lastEtag) {
        return;
      }
      sub.lastEtag = nextEtag;
      // If swarm just became active, ensure we promote to watching the exact swarm dir
      if (snapshot.active && !sub.resolvedExact) {
        void this.attachTargets(sub);
      }
      sub.listener(snapshot);
    } catch {
      // Ignore transient read errors during concurrent atomic writes
    } finally {
      sub.inFlight = false;
      if (sub.pendingInspect && !sub.disposed && !this.disposed) {
        sub.pendingInspect = false;
        this.scheduleInspect(sub);
      }
    }
  }
}
