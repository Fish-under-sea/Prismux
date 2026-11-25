// @effect-diagnostics nodeBuiltinImport:off - Hermetic filesystem migration tests operate directly on temp directories.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, assert, describe, it } from "@effect/vitest";

import {
  isProtectedUserDataPath,
  PRISMUX_UPGRADE_MIGRATION_VERSION,
  resolvePrismuxUpgradeMigrationPaths,
  runPrismuxStartupUpgradeMigration,
  runPrismuxUpgradeMigrations,
  UPGRADE_MIGRATIONS_STATE_FILENAME,
} from "./PrismuxUpgradeMigration.ts";

const createdDirs: string[] = [];

function makeTempSandbox(): {
  readonly root: string;
  readonly homeDir: string;
  readonly baseDir: string;
  readonly stateDir: string;
  readonly appDataDir: string;
  readonly localAppDataDir: string;
} {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "prismux-upgrade-migration-"));
  createdDirs.push(root);
  const homeDir = NodePath.join(root, "home");
  const baseDir = NodePath.join(homeDir, ".prismux");
  const stateDir = NodePath.join(baseDir, "userdata");
  const appDataDir = NodePath.join(homeDir, "AppData", "Roaming");
  const localAppDataDir = NodePath.join(homeDir, "AppData", "Local");
  NodeFS.mkdirSync(stateDir, { recursive: true });
  NodeFS.mkdirSync(appDataDir, { recursive: true });
  NodeFS.mkdirSync(localAppDataDir, { recursive: true });
  return { root, homeDir, baseDir, stateDir, appDataDir, localAppDataDir };
}

function writeFile(filePath: string, content: string): void {
  NodeFS.mkdirSync(NodePath.dirname(filePath), { recursive: true });
  NodeFS.writeFileSync(filePath, content, "utf8");
}

afterEach(() => {
  for (const dir of createdDirs.splice(0)) {
    NodeFS.rmSync(dir, { recursive: true, force: true });
  }
});

describe("PrismuxUpgradeMigration", () => {
  it("cleans obsolete caches, retired pet/ssh plugins, and deprecated settings keys while strictly preserving user data", () => {
    const sandbox = makeTempSandbox();

    // --- Seed protected user data (MUST remain 100% untouched) ---
    const memoryDb = NodePath.join(sandbox.baseDir, "data", "memory.db");
    const memoryWal = NodePath.join(sandbox.baseDir, "data", "memory.db-wal");
    const qqCred = NodePath.join(sandbox.baseDir, "credentials", "qq.enc");
    const syncCred = NodePath.join(sandbox.baseDir, "credentials", "sync-vault.enc");
    const wallpaperFile = NodePath.join(sandbox.baseDir, "wallpapers", "aurora.mp4");
    const activeQqPlugin = NodePath.join(sandbox.baseDir, "plugins", "qq", "dist", "index.js");
    const activeFishdockPlugin = NodePath.join(
      sandbox.baseDir,
      "plugins",
      "fishdock-hook",
      "dist",
      "index.js",
    );
    const customCommunityPlugin = NodePath.join(
      sandbox.baseDir,
      "plugins",
      "my-custom-theme",
      "index.js",
    );
    const sessionDb = NodePath.join(sandbox.stateDir, "state.sqlite");
    const savedEnvs = NodePath.join(sandbox.stateDir, "saved-environments.json");
    const localState = NodePath.join(sandbox.appDataDir, "Prismux", "Local State");
    const localStorageFile = NodePath.join(
      sandbox.appDataDir,
      "Prismux",
      "Local Storage",
      "leveldb",
      "000001.ldb",
    );
    const portableDataFile = NodePath.join(
      sandbox.localAppDataDir,
      "Prismux",
      "data",
      "portable.db",
    );

    writeFile(memoryDb, "SQLITE_MEMORY_PROTECTED");
    writeFile(memoryWal, "SQLITE_WAL_PROTECTED");
    writeFile(qqCred, "ENCRYPTED_QQ_CRED");
    writeFile(syncCred, "ENCRYPTED_SYNC_CRED");
    writeFile(wallpaperFile, "MP4_WALLPAPER_BYTES");
    writeFile(activeQqPlugin, "export const id = 'qq';");
    writeFile(activeFishdockPlugin, "export const id = 'fishdock-hook';");
    writeFile(customCommunityPlugin, "export const id = 'custom';");
    writeFile(sessionDb, "SESSION_STATE_PROTECTED");
    writeFile(savedEnvs, JSON.stringify({ version: 1, records: [{ environmentId: "env-1" }] }));
    writeFile(localState, JSON.stringify({ os_crypt: { encrypted_key: "KEEP_ME" } }));
    writeFile(localStorageFile, "LEVELDB_USER_PREFS");
    writeFile(portableDataFile, "PORTABLE_DATA_PROTECTED");

    // --- Seed obsolete caches, retired plugins, and T3 Connect leftovers (SHOULD be removed) ---
    const appDataCache = NodePath.join(sandbox.appDataDir, "Prismux", "Cache", "Cache_Data", "f_0");
    const appDataCodeCache = NodePath.join(sandbox.appDataDir, "Prismux", "Code Cache", "js", "a");
    const appDataGpuCache = NodePath.join(sandbox.appDataDir, "Prismux", "GPUCache", "index");
    const appDataAlphaCache = NodePath.join(
      sandbox.appDataDir,
      "Prismux (Alpha)",
      "GPUCache",
      "old",
    );
    const localWebViewCache = NodePath.join(
      sandbox.localAppDataDir,
      "Prismux",
      "EBWebView",
      "Default",
      "Cache",
    );
    const localTauriIdCache = NodePath.join(
      sandbox.localAppDataDir,
      "io.prismux.desktop",
      "EBWebView",
      "stale.dat",
    );
    const updaterPending = NodePath.join(
      sandbox.localAppDataDir,
      "prismux-updater",
      "pending",
      "old-setup.exe",
    );
    const retiredPetDir = NodePath.join(sandbox.baseDir, "plugins", "pet", "dist", "index.js");
    const retiredSshDir = NodePath.join(
      sandbox.baseDir,
      "plugins",
      "prismux-plugin-ssh",
      "index.js",
    );
    const clerkTokens = NodePath.join(sandbox.stateDir, "clerk", "clerk-tokens.json");
    const legacyClerkTokens = NodePath.join(sandbox.stateDir, "clerk-tokens.json");
    const relayClients = NodePath.join(sandbox.stateDir, "relay-clients", "1234.json");
    const t3ConnectState = NodePath.join(sandbox.stateDir, "t3-connect-state.json");

    writeFile(appDataCache, "stale-cache");
    writeFile(appDataCodeCache, "stale-code-cache");
    writeFile(appDataGpuCache, "stale-gpu-cache");
    writeFile(appDataAlphaCache, "stale-alpha-gpu");
    writeFile(localWebViewCache, "stale-webview2");
    writeFile(localTauriIdCache, "stale-tauri-webview2");
    writeFile(updaterPending, "stale-installer");
    writeFile(retiredPetDir, "retired-pet");
    writeFile(retiredSshDir, "retired-ssh");
    writeFile(clerkTokens, '{"token":"old"}');
    writeFile(legacyClerkTokens, '{"token":"legacy"}');
    writeFile(relayClients, '{"pid":1234}');
    writeFile(t3ConnectState, '{"account":"old"}');

    // --- Seed client-settings.json & desktop-settings.json with deprecated + valid keys ---
    const clientSettingsPath = NodePath.join(sandbox.stateDir, "client-settings.json");
    writeFile(
      clientSettingsPath,
      JSON.stringify(
        {
          appearanceContrast: 110,
          chatWidth: "wide",
          t3ConnectActiveTab: "t3-connect",
          clerkUser: { id: "user_old" },
          effortDisplay: "bars",
          mathRenderingEnabled: true,
          timestampFormat: "24-hour",
        },
        null,
        2,
      ),
    );
    const desktopSettingsPath = NodePath.join(sandbox.stateDir, "desktop-settings.json");
    writeFile(
      desktopSettingsPath,
      JSON.stringify(
        {
          localEnvironmentEnabled: true,
          serverExposureMode: "local-only",
          t3ConnectSession: "obsolete-session",
        },
        null,
        2,
      ),
    );

    // --- Execute migration ---
    const fixedIso = "2026-11-25T04:15:00.000Z";
    const result = runPrismuxUpgradeMigrations({
      platform: "win32",
      homeDir: sandbox.homeDir,
      baseDir: sandbox.baseDir,
      stateDir: sandbox.stateDir,
      appDataDir: sandbox.appDataDir,
      localAppDataDir: sandbox.localAppDataDir,
      nowIso: () => fixedIso,
    });

    assert.equal(result.migrationId, PRISMUX_UPGRADE_MIGRATION_VERSION);
    assert.equal(result.skipped, false);
    assert.deepEqual(result.errors, []);
    assert.deepEqual([...result.removedRetiredPlugins].sort(), ["pet", "prismux-plugin-ssh"]);
    assert.deepEqual([...result.strippedSettingsKeys].sort(), [
      "appearanceContrast",
      "chatWidth",
      "clerkUser",
      "t3ConnectActiveTab",
      "t3ConnectSession",
    ]);

    // Verify all obsolete artifacts were removed.
    assert.equal(NodeFS.existsSync(NodePath.join(sandbox.appDataDir, "Prismux", "Cache")), false);
    assert.equal(
      NodeFS.existsSync(NodePath.join(sandbox.appDataDir, "Prismux", "Code Cache")),
      false,
    );
    assert.equal(
      NodeFS.existsSync(NodePath.join(sandbox.appDataDir, "Prismux", "GPUCache")),
      false,
    );
    assert.equal(
      NodeFS.existsSync(NodePath.join(sandbox.appDataDir, "Prismux (Alpha)", "GPUCache")),
      false,
    );
    assert.equal(
      NodeFS.existsSync(NodePath.join(sandbox.localAppDataDir, "Prismux", "EBWebView")),
      false,
    );
    assert.equal(
      NodeFS.existsSync(NodePath.join(sandbox.localAppDataDir, "io.prismux.desktop", "EBWebView")),
      false,
    );
    assert.equal(
      NodeFS.existsSync(NodePath.join(sandbox.localAppDataDir, "prismux-updater", "pending")),
      false,
    );
    assert.equal(NodeFS.existsSync(NodePath.join(sandbox.baseDir, "plugins", "pet")), false);
    assert.equal(
      NodeFS.existsSync(NodePath.join(sandbox.baseDir, "plugins", "prismux-plugin-ssh")),
      false,
    );
    assert.equal(NodeFS.existsSync(clerkTokens), false);
    assert.equal(NodeFS.existsSync(legacyClerkTokens), false);
    assert.equal(NodeFS.existsSync(NodePath.join(sandbox.stateDir, "relay-clients")), false);
    assert.equal(NodeFS.existsSync(t3ConnectState), false);

    // Verify deprecated keys were stripped while valid user settings remain intact.
    const nextClientSettings = JSON.parse(
      NodeFS.readFileSync(clientSettingsPath, "utf8"),
    ) as Record<string, unknown>;
    assert.deepEqual(nextClientSettings, {
      effortDisplay: "bars",
      mathRenderingEnabled: true,
      timestampFormat: "24-hour",
    });
    const nextDesktopSettings = JSON.parse(
      NodeFS.readFileSync(desktopSettingsPath, "utf8"),
    ) as Record<string, unknown>;
    assert.deepEqual(nextDesktopSettings, {
      localEnvironmentEnabled: true,
      serverExposureMode: "local-only",
    });

    // Verify EVERY protected user data file remained 100% untouched.
    assert.equal(NodeFS.readFileSync(memoryDb, "utf8"), "SQLITE_MEMORY_PROTECTED");
    assert.equal(NodeFS.readFileSync(memoryWal, "utf8"), "SQLITE_WAL_PROTECTED");
    assert.equal(NodeFS.readFileSync(qqCred, "utf8"), "ENCRYPTED_QQ_CRED");
    assert.equal(NodeFS.readFileSync(syncCred, "utf8"), "ENCRYPTED_SYNC_CRED");
    assert.equal(NodeFS.readFileSync(wallpaperFile, "utf8"), "MP4_WALLPAPER_BYTES");
    assert.equal(NodeFS.readFileSync(activeQqPlugin, "utf8"), "export const id = 'qq';");
    assert.equal(
      NodeFS.readFileSync(activeFishdockPlugin, "utf8"),
      "export const id = 'fishdock-hook';",
    );
    assert.equal(NodeFS.readFileSync(customCommunityPlugin, "utf8"), "export const id = 'custom';");
    assert.equal(NodeFS.readFileSync(sessionDb, "utf8"), "SESSION_STATE_PROTECTED");
    assert.equal(
      NodeFS.readFileSync(savedEnvs, "utf8"),
      JSON.stringify({ version: 1, records: [{ environmentId: "env-1" }] }),
    );
    assert.equal(
      NodeFS.readFileSync(localState, "utf8"),
      JSON.stringify({ os_crypt: { encrypted_key: "KEEP_ME" } }),
    );
    assert.equal(NodeFS.readFileSync(localStorageFile, "utf8"), "LEVELDB_USER_PREFS");
    assert.equal(NodeFS.readFileSync(portableDataFile, "utf8"), "PORTABLE_DATA_PROTECTED");

    // Verify marker file persisted accurately.
    const markerPath = NodePath.join(sandbox.stateDir, UPGRADE_MIGRATIONS_STATE_FILENAME);
    assert.equal(result.markerPath, markerPath);
    const persistedMarker = JSON.parse(NodeFS.readFileSync(markerPath, "utf8")) as {
      schemaVersion: number;
      completed: Record<string, { completedAt: string; removedRetiredPlugins: string[] }>;
    };
    assert.equal(persistedMarker.schemaVersion, 1);
    assert.equal(
      persistedMarker.completed[PRISMUX_UPGRADE_MIGRATION_VERSION]?.completedAt,
      fixedIso,
    );
  });

  it("is strictly idempotent on subsequent runs once the 0.2.0-rc.1 marker is recorded", () => {
    const sandbox = makeTempSandbox();

    const first = runPrismuxUpgradeMigrations({
      platform: "win32",
      homeDir: sandbox.homeDir,
      baseDir: sandbox.baseDir,
      stateDir: sandbox.stateDir,
      appDataDir: sandbox.appDataDir,
      localAppDataDir: sandbox.localAppDataDir,
    });
    assert.equal(first.skipped, false);

    // Recreate a cache file after v0.2.0-rc.1 has already completed migration;
    // subsequent startups MUST NOT delete freshly generated runtime caches.
    const freshCache = NodePath.join(sandbox.appDataDir, "Prismux", "Cache", "fresh.bin");
    writeFile(freshCache, "FRESH_V020_CACHE");

    const second = runPrismuxUpgradeMigrations({
      platform: "win32",
      homeDir: sandbox.homeDir,
      baseDir: sandbox.baseDir,
      stateDir: sandbox.stateDir,
      appDataDir: sandbox.appDataDir,
      localAppDataDir: sandbox.localAppDataDir,
    });
    assert.equal(second.skipped, true);
    assert.deepEqual(second.removedPaths, []);
    assert.deepEqual(second.strippedSettingsKeys, []);
    assert.equal(NodeFS.readFileSync(freshCache, "utf8"), "FRESH_V020_CACHE");
  });

  it("strips deprecated keys from wrapped { settings: { ... } } client-settings.json and preserves invalid JSON untouched", () => {
    const sandbox = makeTempSandbox();
    const clientSettingsPath = NodePath.join(sandbox.stateDir, "client-settings.json");
    writeFile(
      clientSettingsPath,
      JSON.stringify({
        version: 2,
        settings: {
          appearanceContrast: 90,
          chatWidth: "compact",
          theme: "dark",
        },
      }),
    );

    // Invalid JSON in settings.json must not throw or be overwritten.
    const serverSettingsPath = NodePath.join(sandbox.stateDir, "settings.json");
    writeFile(serverSettingsPath, "{ // jsonc comment\n  broken");

    const result = runPrismuxStartupUpgradeMigration({
      platform: "win32",
      homeDir: sandbox.homeDir,
      baseDir: sandbox.baseDir,
      stateDir: sandbox.stateDir,
      appDataDir: sandbox.appDataDir,
      localAppDataDir: sandbox.localAppDataDir,
    });

    assert.isNotNull(result);
    assert.equal(result.skipped, false);
    assert.deepEqual(result.errors, []);
    assert.deepEqual([...result.strippedSettingsKeys].sort(), ["appearanceContrast", "chatWidth"]);

    const updatedClient = JSON.parse(NodeFS.readFileSync(clientSettingsPath, "utf8")) as {
      version: number;
      settings: Record<string, unknown>;
    };
    assert.deepEqual(updatedClient, {
      version: 2,
      settings: { theme: "dark" },
    });
    assert.equal(NodeFS.readFileSync(serverSettingsPath, "utf8"), "{ // jsonc comment\n  broken");
  });

  it("protects core user data paths via isProtectedUserDataPath guard and respects env overrides", () => {
    const sandbox = makeTempSandbox();
    const resolved = resolvePrismuxUpgradeMigrationPaths({
      platform: "win32",
      homeDir: sandbox.homeDir,
      env: {
        T3CODE_HOME: sandbox.baseDir,
        APPDATA: sandbox.appDataDir,
        LOCALAPPDATA: sandbox.localAppDataDir,
      },
    });

    assert.equal(resolved.baseDir, NodePath.resolve(sandbox.baseDir));
    assert.equal(resolved.stateDir, NodePath.join(NodePath.resolve(sandbox.baseDir), "userdata"));
    assert.equal(
      isProtectedUserDataPath(NodePath.join(sandbox.baseDir, "data", "memory.db"), resolved),
      true,
    );
    assert.equal(
      isProtectedUserDataPath(NodePath.join(sandbox.baseDir, "credentials", "qq.enc"), resolved),
      true,
    );
    assert.equal(
      isProtectedUserDataPath(NodePath.join(sandbox.baseDir, "wallpapers", "bg.png"), resolved),
      true,
    );
    assert.equal(
      isProtectedUserDataPath(NodePath.join(sandbox.baseDir, "plugins", "qq"), resolved),
      true,
    );
    assert.equal(
      isProtectedUserDataPath(NodePath.join(sandbox.baseDir, "plugins", "fishdock-hook"), resolved),
      true,
    );
    assert.equal(
      isProtectedUserDataPath(NodePath.join(sandbox.baseDir, "plugins", "pet"), resolved),
      false,
    );
    assert.equal(
      isProtectedUserDataPath(NodePath.join(sandbox.appDataDir, "Prismux", "Local State"), resolved),
      true,
    );
    assert.equal(
      isProtectedUserDataPath(NodePath.join(sandbox.appDataDir, "Prismux", "Cache"), resolved),
      false,
    );
  });
});
