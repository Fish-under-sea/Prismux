import type {
  HookExecutionResult,
  HookInvocationContext,
  InstalledPluginRecord,
  LifecycleHookEvent,
  PluginContext,
  PluginCredentialsHandle,
  PluginDisposable,
  PluginDistribution,
  PluginLogger,
  PluginManifest,
  PluginRealm,
  PrismuxPluginModule
} from "@prismux/protocol";

export interface PluginResourceCounts {
  routes: number;
  hooks: number;
  panels: number;
  styles: number;
  timers: number;
  effects: number;
}

export type HttpRouteMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface RegisteredRouteEntry {
  key: string;
  pluginId: string;
  method: HttpRouteMethod;
  path: string;
  handler: unknown;
}

export type PluginHookHandler = (
  context: HookInvocationContext
) => Promise<HookExecutionResult | void> | HookExecutionResult | void;

export interface RegisteredPluginHookEntry {
  id: string;
  pluginId: string;
  event: LifecycleHookEvent;
  handler: PluginHookHandler;
}

export interface RegisteredPanelEntry {
  pluginId: string;
  panelId: string;
  title: string;
  component?: unknown;
}

export interface RegisteredStyleEntry {
  key: string;
  pluginId: string;
  styleId: string;
  cssText: string;
}

export interface RegisteredTimerEntry {
  id: string;
  pluginId: string;
  kind: "interval" | "timeout" | "custom";
}

export interface CordisPluginContext extends PluginContext {
  registerStyle(styleId: string, cssText: string): void;
  setInterval(fn: () => void, intervalMs: number): ReturnType<typeof setInterval>;
  setTimeout(fn: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  registerTimer(
    cancel: () => void,
    kind?: "interval" | "timeout" | "custom"
  ): void;
}

export interface CordisPluginModule {
  manifest: PluginManifest;
  apply(ctx: CordisPluginContext): void | Promise<void>;
}

export interface CordisPluginHostAdapters {
  onRegisterRoute?: (entry: RegisteredRouteEntry) => (() => void) | void;
  onRegisterPanel?: (entry: RegisteredPanelEntry) => (() => void) | void;
  onRegisterStyle?: (entry: RegisteredStyleEntry) => (() => void) | void;
  loggerFactory?: (pluginId: string, realm: PluginRealm) => PluginLogger;
}

export interface CordisPluginHostOptions {
  adapters?: CordisPluginHostAdapters;
}

/**
 * Thrown when a plugin installed with `distribution: "managed"` attempts
 * an in-app runtime self-update instead of going through the host plugin center.
 */
export class ManagedPluginSelfUpdateError extends Error {
  readonly pluginId: string;
  readonly distribution: PluginDistribution;

  constructor(
    pluginId: string,
    distribution: PluginDistribution = "managed"
  ) {
    super(
      `Plugin "${pluginId}" is protected by managed single-write lock (distribution="${distribution}"); runtime in-app self-update is forbidden.`
    );
    this.name = "ManagedPluginSelfUpdateError";
    this.pluginId = pluginId;
    this.distribution = distribution;
  }
}

/**
 * Enforces the managed single-write lock: managed plugins cannot self-update in-app.
 */
export function assertPluginSelfUpdateAllowed(
  record: Pick<InstalledPluginRecord, "distribution"> & {
    manifest: Pick<PluginManifest, "id">;
  }
): void {
  if (record.distribution === "managed") {
    throw new ManagedPluginSelfUpdateError(
      record.manifest.id,
      record.distribution
    );
  }
}

/**
 * LIFO disposable scope ensuring zero residual listeners, routes, panels, styles,
 * timers, or custom effects upon plugin unload or apply rollback.
 */
export class ReversibleEffectScope {
  private readonly disposables: PluginDisposable[] = [];
  private disposed = false;

  get size(): number {
    return this.disposables.length;
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  add(disposable: PluginDisposable): void {
    if (this.disposed) {
      throw new Error(
        "Cannot attach effect to an already disposed plugin scope."
      );
    }
    this.disposables.push(disposable);
  }

  async disposeAll(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const errors: unknown[] = [];

    while (this.disposables.length > 0) {
      const dispose = this.disposables.pop();
      if (dispose !== undefined) {
        try {
          await dispose();
        } catch (error) {
          errors.push(error);
        }
      }
    }

    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(
        errors,
        `Multiple errors occurred while disposing plugin scope (${errors.length}).`
      );
    }
  }
}

const SAFE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/**
 * Dual-realm (`daemon` / `ui`) reversible Cordis plugin host with real resource registries
 * and atomic LIFO cleanup on unmount, uninstall, or `apply()` failure rollback.
 */
export class CordisPluginHost {
  private readonly records = new Map<string, InstalledPluginRecord>();
  private readonly scopes = new Map<string, ReversibleEffectScope>();
  private readonly realm: PluginRealm;
  private readonly adapters: CordisPluginHostAdapters;

  private readonly routes = new Map<string, RegisteredRouteEntry>();
  private readonly hooks = new Map<string, RegisteredPluginHookEntry>();
  private readonly panels = new Map<string, RegisteredPanelEntry>();
  private readonly styles = new Map<string, RegisteredStyleEntry>();
  private readonly timers = new Map<string, { entry: RegisteredTimerEntry; cancel: () => void }>();
  private readonly customEffects = new Map<string, Set<string>>();

  private seqCounter = 0;

  constructor(realm: PluginRealm, options?: CordisPluginHostOptions) {
    this.realm = realm;
    this.adapters = options?.adapters ?? {};
  }

  getRealm(): PluginRealm {
    return this.realm;
  }

  listInstalled(): InstalledPluginRecord[] {
    return Array.from(this.records.values());
  }

  getRecord(pluginId: string): InstalledPluginRecord | undefined {
    return this.records.get(pluginId);
  }

  isMounted(pluginId: string): boolean {
    return this.scopes.has(pluginId);
  }

  getRoutes(): readonly RegisteredRouteEntry[] {
    return Array.from(this.routes.values());
  }

  getHooks(event?: LifecycleHookEvent): readonly RegisteredPluginHookEntry[] {
    const all = Array.from(this.hooks.values());
    if (event === undefined) {
      return all;
    }
    return all.filter((entry) => entry.event === event);
  }

  getPanels(): readonly RegisteredPanelEntry[] {
    return Array.from(this.panels.values());
  }

  getStyles(): readonly RegisteredStyleEntry[] {
    return Array.from(this.styles.values());
  }

  async dispatchHook(
    context: HookInvocationContext
  ): Promise<HookExecutionResult[]> {
    const matching = this.getHooks(context.event);
    const results: HookExecutionResult[] = [];
    for (const hook of matching) {
      const outcome = await hook.handler(context);
      if (outcome !== undefined) {
        results.push(outcome);
      }
    }
    return results;
  }

  getActiveResourceCounts(): PluginResourceCounts {
    let effects = 0;
    for (const set of this.customEffects.values()) {
      effects += set.size;
    }
    return {
      routes: this.routes.size,
      hooks: this.hooks.size,
      panels: this.panels.size,
      styles: this.styles.size,
      timers: this.timers.size,
      effects
    };
  }

  getActiveResourceCountsForPlugin(pluginId: string): PluginResourceCounts {
    let routes = 0;
    for (const entry of this.routes.values()) {
      if (entry.pluginId === pluginId) routes += 1;
    }
    let hooks = 0;
    for (const entry of this.hooks.values()) {
      if (entry.pluginId === pluginId) hooks += 1;
    }
    let panels = 0;
    for (const entry of this.panels.values()) {
      if (entry.pluginId === pluginId) panels += 1;
    }
    let styles = 0;
    for (const entry of this.styles.values()) {
      if (entry.pluginId === pluginId) styles += 1;
    }
    let timers = 0;
    for (const entry of this.timers.values()) {
      if (entry.entry.pluginId === pluginId) timers += 1;
    }
    const effects = this.customEffects.get(pluginId)?.size ?? 0;

    return {
      routes,
      hooks,
      panels,
      styles,
      timers,
      effects
    };
  }

  assertSelfUpdateAllowed(pluginId: string): void {
    const record = this.records.get(pluginId);
    if (record !== undefined) {
      assertPluginSelfUpdateAllowed(record);
    }
  }

  async mountPlugin(
    record: InstalledPluginRecord,
    module: PrismuxPluginModule | CordisPluginModule,
    credentials: PluginCredentialsHandle
  ): Promise<void> {
    if (!this.validateManifest(record.manifest)) {
      throw new Error(
        `Invalid plugin manifest for "${record?.manifest?.id ?? "unknown"}".`
      );
    }
    if (record.manifest.id !== module.manifest.id) {
      throw new Error(
        `Plugin manifest ID mismatch: record="${record.manifest.id}", module="${module.manifest.id}".`
      );
    }
    if (!record.manifest.realms.includes(this.realm)) {
      return;
    }

    const pluginId = record.manifest.id;
    if (this.scopes.has(pluginId)) {
      await this.unmountPlugin(pluginId);
    }

    const scope = new ReversibleEffectScope();
    const pluginEffectSet = new Set<string>();
    this.customEffects.set(pluginId, pluginEffectSet);

    const nextSeq = (): string => {
      this.seqCounter += 1;
      return `${pluginId}#${this.seqCounter}`;
    };

    const logger: PluginLogger =
      this.adapters.loggerFactory?.(pluginId, this.realm) ?? {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined
      };

    const registerTimerEntry = (
      kind: RegisteredTimerEntry["kind"],
      cancel: () => void
    ): string => {
      const id = nextSeq();
      const entry: RegisteredTimerEntry = { id, pluginId, kind };
      this.timers.set(id, { entry, cancel });
      scope.add(() => {
        const active = this.timers.get(id);
        if (active !== undefined) {
          this.timers.delete(id);
          active.cancel();
        }
      });
      return id;
    };

    const ctx: CordisPluginContext = {
      manifest: module.manifest,
      realm: this.realm,
      distribution: record.distribution,
      credentials,
      logger,

      effect: (disposable: PluginDisposable): void => {
        const effectId = nextSeq();
        pluginEffectSet.add(effectId);
        scope.add(async () => {
          pluginEffectSet.delete(effectId);
          await disposable();
        });
      },

      onHook: (event, handler): void => {
        const id = nextSeq();
        const entry: RegisteredPluginHookEntry = {
          id,
          pluginId,
          event,
          handler
        };
        this.hooks.set(id, entry);
        scope.add(() => {
          this.hooks.delete(id);
        });
      },

      registerRoute: (method, path, handler): void => {
        const key = `${method} ${path}`;
        if (this.routes.has(key)) {
          throw new Error(
            `Route "${key}" is already registered by plugin "${this.routes.get(key)!.pluginId}".`
          );
        }
        const entry: RegisteredRouteEntry = {
          key,
          pluginId,
          method,
          path,
          handler
        };
        this.routes.set(key, entry);
        const adapterCleanup = this.adapters.onRegisterRoute?.(entry);
        scope.add(() => {
          this.routes.delete(key);
          adapterCleanup?.();
        });
      },

      registerPanel: (panelId, definition): void => {
        const existing = this.panels.get(panelId);
        if (existing !== undefined) {
          throw new Error(
            `Panel "${panelId}" is already registered by plugin "${existing.pluginId}".`
          );
        }
        const entry: RegisteredPanelEntry = {
          pluginId,
          panelId,
          title: definition.title,
          component: definition.component
        };
        this.panels.set(panelId, entry);
        const adapterCleanup = this.adapters.onRegisterPanel?.(entry);
        scope.add(() => {
          this.panels.delete(panelId);
          adapterCleanup?.();
        });
      },

      registerStyle: (styleId, cssText): void => {
        const key = `${pluginId}:${styleId}`;
        if (this.styles.has(key)) {
          throw new Error(
            `Style "${styleId}" is already registered by plugin "${pluginId}".`
          );
        }
        const entry: RegisteredStyleEntry = {
          key,
          pluginId,
          styleId,
          cssText
        };
        this.styles.set(key, entry);
        const adapterCleanup = this.adapters.onRegisterStyle?.(entry);
        scope.add(() => {
          this.styles.delete(key);
          adapterCleanup?.();
        });
      },

      setInterval: (fn, intervalMs): ReturnType<typeof setInterval> => {
        const handle = globalThis.setInterval(fn, intervalMs);
        registerTimerEntry("interval", () => {
          globalThis.clearInterval(handle);
        });
        return handle;
      },

      setTimeout: (fn, delayMs): ReturnType<typeof setTimeout> => {
        let timerId = "";
        const handle = globalThis.setTimeout(() => {
          this.timers.delete(timerId);
          fn();
        }, delayMs);
        timerId = registerTimerEntry("timeout", () => {
          globalThis.clearTimeout(handle);
        });
        return handle;
      },

      registerTimer: (cancel, kind = "custom"): void => {
        registerTimerEntry(kind, cancel);
      }
    };

    this.records.set(pluginId, { ...record, enabled: true });
    this.scopes.set(pluginId, scope);

    try {
      await module.apply(ctx);
    } catch (error) {
      try {
        await scope.disposeAll();
      } catch {
        // Ensure original apply() failure is surfaced after full rollback attempt.
      } finally {
        this.scopes.delete(pluginId);
        this.customEffects.delete(pluginId);
        this.records.set(pluginId, { ...record, enabled: false });
      }
      throw error;
    }
  }

  async unmountPlugin(pluginId: string): Promise<void> {
    const scope = this.scopes.get(pluginId);
    try {
      if (scope !== undefined) {
        await scope.disposeAll();
      }
    } finally {
      this.scopes.delete(pluginId);
      this.customEffects.delete(pluginId);
      const existing = this.records.get(pluginId);
      if (existing !== undefined) {
        this.records.set(pluginId, { ...existing, enabled: false });
      }
    }
  }

  async uninstallPlugin(pluginId: string): Promise<void> {
    await this.unmountPlugin(pluginId);
    this.records.delete(pluginId);
  }

  validateManifest(manifest: PluginManifest): boolean {
    if (typeof manifest !== "object" || manifest === null) {
      return false;
    }
    if (
      typeof manifest.id !== "string" ||
      manifest.id.trim().length === 0 ||
      manifest.id.includes("..") ||
      !SAFE_ID_PATTERN.test(manifest.id)
    ) {
      return false;
    }
    if (typeof manifest.version !== "string" || manifest.version.trim().length === 0) {
      return false;
    }
    if (!Array.isArray(manifest.realms) || manifest.realms.length === 0) {
      return false;
    }
    if (!Array.isArray(manifest.permissions)) {
      return false;
    }
    return typeof manifest.modelVisible === "boolean";
  }
}
