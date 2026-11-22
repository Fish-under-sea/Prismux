import type {
  HookExecutionResult,
  HookInvocationContext,
  LifecycleHookEvent
} from "./hooks.js";

export const OFFICIAL_PLUGIN_IDS = [
  "qq",
  "pet",
  "fishdock-hook",
  "ssh"
] as const;

export type OfficialPluginId = (typeof OFFICIAL_PLUGIN_IDS)[number];

export const PLUGIN_REALMS = ["daemon", "ui"] as const;

export type PluginRealm = (typeof PLUGIN_REALMS)[number];

export type PluginDistribution = "managed" | "local";

export type KnownPluginPermission =
  | "network:outbound"
  | "network:inbound"
  | "memory:private-chief"
  | "memory:workspace"
  | "memory:social-qq"
  | "hooks:subscribe"
  | "hooks:intercept"
  | "pty:spawn"
  | "fs:read"
  | "fs:write"
  | "ui:panel"
  | "ui:status-bar"
  | "pet:lease"
  | "notifications:push";

export type PluginPermission = KnownPluginPermission | (string & {});

export interface PluginBehaviors {
  autostart?: boolean;
  requiresConfiguration?: boolean;
  supportsLoopbackTest?: boolean;
}

export interface PluginManifest {
  id: string;
  version: string;
  realms: PluginRealm[];
  permissions: PluginPermission[];
  modelVisible: boolean;
  behaviors?: PluginBehaviors;
}

export interface PluginPackageEngines {
  prismux: string;
}

export type PluginCatalogStatus = "source-only" | "verified" | "deprecated";

export interface OfficialPluginCatalogEntry {
  id: string;
  packageName: string;
  version: string;
  description: string;
  engines: PluginPackageEngines;
  realms: PluginRealm[];
  permissions: PluginPermission[];
  modelVisible: boolean;
  sha256: string | null;
  bytes?: number | null;
  status: PluginCatalogStatus;
}

export interface OfficialPluginCatalog {
  schemaVersion: 1;
  generatedAt: string;
  plugins: OfficialPluginCatalogEntry[];
}

export interface InstalledPluginRecord {
  manifest: PluginManifest;
  packageName: string;
  distribution: PluginDistribution;
  enabled: boolean;
  installPath: string;
  installedAt: number;
  sha256?: string;
}

export type PluginDisposable = () => void | Promise<void>;

export interface PluginCredentialsHandle {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface PluginLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface PluginContext {
  readonly manifest: PluginManifest;
  readonly realm: PluginRealm;
  readonly distribution: PluginDistribution;
  effect(disposable: PluginDisposable): void;
  credentials: PluginCredentialsHandle;
  logger: PluginLogger;
  onHook?(
    event: LifecycleHookEvent,
    handler: (
      context: HookInvocationContext
    ) => Promise<HookExecutionResult | void> | HookExecutionResult | void
  ): void;
  registerRoute?(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    handler: unknown
  ): void;
  registerPanel?(
    panelId: string,
    definition: { title: string; component?: unknown }
  ): void;
}

export interface PrismuxPluginModule {
  manifest: PluginManifest;
  apply(ctx: PluginContext): void | Promise<void>;
}
