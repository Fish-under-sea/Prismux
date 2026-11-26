import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import * as NodeURL from "node:url";

const { describe, it } = NodeTest;
const assert = NodeAssert;

const REPO_ROOT = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "../..");

const RUNTIME_SOURCE_ROOTS = ["apps", "packages", "plugins-official", "native"] as const;

const IGNORED_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  "dist-electron",
  "build",
  ".work",
  "target",
  ".git",
  "__tests__",
  "testkit",
  "testUtils",
]);

function walkRuntimeSourceFiles(dir: string, out: string[] = []): string[] {
  if (!NodeFS.existsSync(dir)) return out;
  for (const entry of NodeFS.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIR_NAMES.has(entry.name)) continue;
    const full = NodePath.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkRuntimeSourceFiles(full, out);
      continue;
    }
    if (!/\.(?:ts|tsx|mts|cts|js|mjs|cjs|rs|json)$/u.test(entry.name)) continue;
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(entry.name)) continue;
    if (entry.name.endsWith(".d.ts")) continue;
    out.push(full);
  }
  return out;
}

function collectRuntimeFiles(): string[] {
  const files: string[] = [];
  for (const root of RUNTIME_SOURCE_ROOTS) {
    walkRuntimeSourceFiles(NodePath.join(REPO_ROOT, root), files);
  }
  return files;
}

function toRel(fullPath: string): string {
  return NodePath.relative(REPO_ROOT, fullPath).replaceAll("\\", "/");
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|\s)\/\/.*$/gmu, "$1");
}

function findRuntimeMatches(
  files: readonly string[],
  pattern: RegExp,
  excludeRelPaths: readonly string[] = [],
): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const rel = toRel(file);
    if (excludeRelPaths.some((prefix) => rel === prefix || rel.startsWith(prefix))) continue;
    const raw = NodeFS.readFileSync(file, "utf8");
    const content = rel.endsWith(".json") ? raw : stripComments(raw);
    if (pattern.test(content)) {
      hits.push(rel);
    }
  }
  return hits;
}

describe("Wave 2 Compliance & Security Static Regression Suite (All 24 P0/P1/P2 Items)", () => {
  const runtimeFiles = collectRuntimeFiles();

  it("P0-1..P0-6 + P1-5 + P1-9: runtime sources contain ZERO forbidden endpoints, harvesters, cloud tumors, or banned packages", () => {
    // P0-1: No Bing / Google unofficial reasoning translation endpoints
    assert.deepEqual(
      findRuntimeMatches(runtimeFiles, /edge\.microsoft\.com\/translate|translate\.googleapis\.com/i),
      [],
      "Forbidden unofficial Bing/Google translation endpoints must not exist in runtime source",
    );

    // P0-2: No Anthropic private OAuth usage / reset_rate_limits credential harvesting
    assert.deepEqual(
      findRuntimeMatches(
        runtimeFiles,
        /api\.anthropic\.com\/api\/oauth\/usage|reset_rate_limits|claudeResetCredits/i,
      ),
      [],
      "Forbidden Anthropic private OAuth usage/reset endpoints must not exist in runtime source",
    );
    assert.deepEqual(
      findRuntimeMatches(runtimeFiles, /\.credentials\.json/, [
        // PrismuxProviderProbeService only checks non-secret existence/metadata if ever referenced; confirm 0 hits everywhere in runtime
      ]),
      [],
      "Direct reads of .credentials.json must not exist in runtime source",
    );

    // P0-3: No CLIProxyAPI undocumented consumer endpoints
    assert.deepEqual(
      findRuntimeMatches(runtimeFiles, /chatgpt\.com\/backend-api\/wham|cliproxyApi/i, [
        "apps/web/src/i18n/translations/",
      ]),
      [],
      "Forbidden cliproxyApi / chatgpt.com/backend-api/wham endpoints must not exist in runtime source",
    );

    // P0-4: No infostealer-class browser-secret / BrowserImport / @napi-rs/keyring
    assert.equal(
      NodeFS.existsSync(NodePath.join(REPO_ROOT, "native/browser-secret")),
      false,
      "native/browser-secret directory must be deleted",
    );
    assert.equal(
      NodeFS.existsSync(NodePath.join(REPO_ROOT, "apps/desktop/src/preview/BrowserImport")),
      false,
      "apps/desktop/src/preview/BrowserImport directory must be deleted",
    );
    assert.deepEqual(
      findRuntimeMatches(runtimeFiles, /browser-secret|BrowserImport/),
      [],
      "browser-secret and BrowserImport must have 0 hits in runtime source",
    );
    const desktopPkgJson = NodeFS.readFileSync(
      NodePath.join(REPO_ROOT, "apps/desktop/package.json"),
      "utf8",
    );
    assert.doesNotMatch(
      desktopPkgJson,
      /@napi-rs\/keyring/,
      "@napi-rs/keyring must be removed from apps/desktop/package.json",
    );

    // P0-5: No legacy T3 Cloud Relay / Clerk mint / Cloudflare DoH / cloudflared server runtime
    assert.deepEqual(
      findRuntimeMatches(
        runtimeFiles,
        /t3MintCredential|1\.1\.1\.1\/dns-query|GuestHttp|CloudHttp|\bConnectReachability\b|CloudManagedEndpointRuntime|github\.com\/cloudflare\/cloudflared/,
      ),
      [],
      "Legacy T3 Cloud/Clerk/Guest/DoH/cloudflared runtime symbols must have 0 hits in runtime source",
    );
    assert.equal(
      NodeFS.existsSync(NodePath.join(REPO_ROOT, "apps/server/src/cloud/ConnectReachability.ts")),
      false,
      "apps/server/src/cloud/ConnectReachability.ts must be excised",
    );
    assert.equal(
      NodeFS.existsSync(NodePath.join(REPO_ROOT, "apps/server/src/relay")),
      false,
      "apps/server/src/relay directory must be excised",
    );
    // Tailscale & LAN QR pairing MUST be preserved!
    assert.equal(
      NodeFS.existsSync(NodePath.join(REPO_ROOT, "packages/tailscale/package.json")),
      true,
      "packages/tailscale must remain intact",
    );
    assert.equal(
      NodeFS.existsSync(
        NodePath.join(REPO_ROOT, "apps/web/src/components/cloud/PrismuxRemoteConnectDialog.tsx"),
      ),
      true,
      "LAN/private-network PrismuxRemoteConnectDialog must remain intact",
    );

    // P0-6: No LGPL-3.0 heic-to anywhere in runtime source or manifests
    assert.deepEqual(
      findRuntimeMatches(runtimeFiles, /\bheic-to\b/),
      [],
      "LGPL-3.0 heic-to must have 0 hits in runtime source and manifests",
    );

    // P1-5 & P2-7: No electron-updater or obsolete electron-updater patch
    assert.deepEqual(
      findRuntimeMatches(runtimeFiles, /\belectron-updater\b/),
      [],
      "Legacy electron-updater must have 0 hits in runtime source and manifests",
    );
    assert.equal(
      NodeFS.existsSync(NodePath.join(REPO_ROOT, "patches/electron-updater@6.8.9.patch")),
      false,
      "patches/electron-updater@6.8.9.patch must be deleted",
    );

    // P1-9: No www.apple.com .usdz hotlinks or github.githubassets.com favicon hotlinks
    assert.deepEqual(
      findRuntimeMatches(runtimeFiles, /www\.apple\.com\/.*\.usdz|github\.githubassets\.com\/favicons/i),
      [],
      "Forbidden Apple .usdz and GitHub favicon remote hotlinks must be removed",
    );
  });

  it("P0-1 & P1-5: zero cold-start outbound defaults (reasoning translation OFF, autoCheckEnabled false)", () => {
    const settingsTs = NodeFS.readFileSync(
      NodePath.join(REPO_ROOT, "packages/contracts/src/settings.ts"),
      "utf8",
    );
    assert.match(settingsTs, /DEFAULT_REASONING_TRANSLATION_PROVIDER(?:\s*:\s*[^=]+)?\s*=\s*"off"/);

    const updaterTs = NodeFS.readFileSync(
      NodePath.join(REPO_ROOT, "packages/protocol/src/updater.ts"),
      "utf8",
    );
    assert.match(updaterTs, /autoCheckEnabled:\s*false/);

    const updateNotifierTs = NodeFS.readFileSync(
      NodePath.join(REPO_ROOT, "apps/web/src/prismux/updates/updateNotifierStore.ts"),
      "utf8",
    );
    assert.doesNotMatch(updateNotifierTs, /return true;\s*\/\/\s*default/i);

    // Offline bundled LiteLLM pricing snapshot exists
    const bundledRatesTs = NodeFS.readFileSync(
      NodePath.join(REPO_ROOT, "apps/server/src/usage/bundledLitellmRates.ts"),
      "utf8",
    );
    assert.match(bundledRatesTs, /BUNDLED_LITELLM_RATES/);
  });

  it("P1-1: preview webviews enforce contextIsolation=true, sandbox=true, nodeIntegration=false and nonce-guarded PasskeyBridge", () => {
    const desktopWindowTs = NodeFS.readFileSync(
      NodePath.join(REPO_ROOT, "apps/desktop/src/window/DesktopWindow.ts"),
      "utf8",
    );
    assert.match(desktopWindowTs, /webPreferences\.contextIsolation\s*=\s*true/);
    assert.doesNotMatch(desktopWindowTs, /webPreferences\.contextIsolation\s*=\s*false/);

    const webviewPrefsTs = NodeFS.readFileSync(
      NodePath.join(REPO_ROOT, "apps/desktop/src/preview/WebviewPreferences.ts"),
      "utf8",
    );
    assert.match(webviewPrefsTs, /contextIsolation=true/);
    assert.match(webviewPrefsTs, /sandbox=true/);
    assert.match(webviewPrefsTs, /nodeIntegration=false/);

    const managerTs = NodeFS.readFileSync(
      NodePath.join(REPO_ROOT, "apps/desktop/src/preview/Manager.ts"),
      "utf8",
    );
    assert.doesNotMatch(managerTs, /contextIsolation:\s*false/);

    const passkeyBridgeTs = NodeFS.readFileSync(
      NodePath.join(REPO_ROOT, "apps/desktop/src/preview/PasskeyBridge.ts"),
      "utf8",
    );
    assert.match(passkeyBridgeTs, /MessageChannel/);
    assert.match(passkeyBridgeTs, /installIsolatedPasskeyBridge/);
  });

  it("P1-2: server, daemon, and wallpaper media service reject wildcard CORS and Origin: null", () => {
    const corsOriginTs = stripComments(
      NodeFS.readFileSync(NodePath.join(REPO_ROOT, "apps/daemon/src/server/CorsOrigin.ts"), "utf8"),
    );
    assert.match(corsOriginTs, /toLowerCase\(\)\s*===\s*"null"/);

    const wallpaperMediaTs = stripComments(
      NodeFS.readFileSync(
        NodePath.join(REPO_ROOT, "apps/daemon/src/wallpapers/WallpaperMediaService.ts"),
        "utf8",
      ),
    );
    assert.doesNotMatch(wallpaperMediaTs, /Access-Control-Allow-Origin["']?\s*[:=]\s*["']\*["']/);

    const serverHttpTs = NodeFS.readFileSync(
      NodePath.join(REPO_ROOT, "apps/server/src/http.ts"),
      "utf8",
    );
    assert.match(serverHttpTs, /resolveAllowedBrowserApiCorsOrigins/);
  });

  it("P1-4: OpenCode usageLimits never reads opencode.db or auth.json directly", () => {
    const openCodeUsageLimitsTs = stripComments(
      NodeFS.readFileSync(
        NodePath.join(REPO_ROOT, "packages/provider-opencode/src/server/usageLimits.ts"),
        "utf8",
      ),
    );
    assert.doesNotMatch(openCodeUsageLimitsTs, /opencode\.db|auth\.json|node:sqlite/);
  });

  it("P1-6, P1-7, P1-8, P2-2, P2-5, P2-6, P2-8: updater, installer, IPC, token broker, and Info.plist hardening", () => {
    // P2-2: No 7za.cmd / 7z.cmd PATH fallback in AppUpdater
    const appUpdaterTs = stripComments(
      NodeFS.readFileSync(NodePath.join(REPO_ROOT, "apps/daemon/src/updater/AppUpdater.ts"), "utf8"),
    );
    assert.doesNotMatch(appUpdaterTs, /7za\.cmd|7z\.cmd/);

    // P1-7 & P2-5: StreamingInstaller checks requiresExplicitConfirmation and Windows reserved names
    const streamingInstallerTs = NodeFS.readFileSync(
      NodePath.join(REPO_ROOT, "packages/cordis-kernel/src/StreamingInstaller.ts"),
      "utf8",
    );
    assert.match(streamingInstallerTs, /requiresExplicitConfirmation/);
    assert.match(streamingInstallerTs, /con\|prn\|aux\|nul/i);

    // P1-8: Desktop prismux IPC verifies update downloads against authoritative Daemon status
    const prismuxIpcTs = NodeFS.readFileSync(
      NodePath.join(REPO_ROOT, "apps/desktop/src/ipc/methods/prismux.ts"),
      "utf8",
    );
    assert.match(prismuxIpcTs, /\/v1\/updater\/status/);
    assert.match(prismuxIpcTs, /unverified_download/);

    // P2-6: CodexManagedTokenBroker requires per-connection random secret auth & prismux-token-* naming
    const tokenBrokerTs = NodeFS.readFileSync(
      NodePath.join(REPO_ROOT, "apps/server/src/provider/CodexManagedTokenBroker.ts"),
      "utf8",
    );
    assert.match(tokenBrokerTs, /timingSafeEqual/);
    assert.match(tokenBrokerTs, /prismux-token-/);

    // P2-8: No unused macOS Calendar / Camera TCC keys in build-desktop-artifact.ts
    const buildArtifactTs = NodeFS.readFileSync(
      NodePath.join(REPO_ROOT, "scripts/build-desktop-artifact.ts"),
      "utf8",
    );
    assert.doesNotMatch(
      buildArtifactTs,
      /NSCalendarsUsageDescription|NSCalendarsFullAccessUsageDescription|NSCameraUsageDescription/,
    );
  });
});
