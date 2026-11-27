import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { describe, it } from "node:test";
import type { ServiceDiagnosticsResponse } from "@prismux/protocol";
import {
  buildSafeCliSpawnSpec,
  clearCliDiscoveryCaches,
  defaultCliProbe,
  defaultDetectAndroidSdk,
  expandWindowsEnvVars,
  findExecutableOnPath,
  mergeWindowsPathLists,
  parseRegQueryOutput,
  PrismuxDaemon,
  PrismuxProviderProbeService,
  refreshWindowsEnvironmentFromRegistry,
  resolveExecutableExtensions,
  ServiceDiagnosticsService,
  WINDOWS_HKCU_ENV_KEY,
  WINDOWS_HKLM_ENV_KEY,
  type CoreRpcClient
} from "../index.js";

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("WindowsEnvRefresh & CLI resolution (real-machine ENOENT & WinGet adb fixes)", () => {
  it("prioritizes .exe -> .cmd -> .bat -> .com on win32 and never selects extensionless POSIX npm shims", () => {
    const root = createTempDir("prismux-win-cli-");
    try {
      const npmDir = join(root, "npm global bin");
      mkdirSync(npmDir, { recursive: true });

      // Simulate npm global install: extensionless POSIX shim + .ps1 + .cmd
      writeFileSync(join(npmDir, "codex"), "#!/bin/sh\necho posix-shim\n", "utf8");
      writeFileSync(join(npmDir, "codex.ps1"), "Write-Output ps1\n", "utf8");
      writeFileSync(join(npmDir, "codex.cmd"), "@echo off\r\necho codex-cli 0.171.0\r\n", "utf8");

      // Also simulate .exe alongside .cmd and extensionless shim
      writeFileSync(join(npmDir, "mycli"), "#!/bin/sh\n", "utf8");
      writeFileSync(join(npmDir, "mycli.cmd"), "@echo off\r\n", "utf8");
      writeFileSync(join(npmDir, "mycli.exe"), "MZ", "utf8");

      assert.deepEqual(resolveExecutableExtensions("win32"), [
        ".exe",
        ".cmd",
        ".bat",
        ".com"
      ]);
      assert.ok(!resolveExecutableExtensions("win32").includes(""));

      const codexResolved = findExecutableOnPath(["codex"], {
        env: { PATH: npmDir },
        platform: "win32"
      });
      assert.equal(codexResolved, join(npmDir, "codex.cmd"));

      const mycliResolved = findExecutableOnPath(["mycli"], {
        env: { PATH: npmDir },
        platform: "win32"
      });
      assert.equal(mycliResolved, join(npmDir, "mycli.exe"));

      // Directory with ONLY extensionless shim must NOT resolve on win32
      writeFileSync(join(npmDir, "posix-only"), "#!/bin/sh\n", "utf8");
      assert.equal(
        findExecutableOnPath(["posix-only"], {
          env: { PATH: npmDir },
          platform: "win32"
        }),
        null
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("builds cmd.exe /d /s /c spec with windowsVerbatimArguments and strips ELECTRON_RUN_AS_NODE", () => {
    const spec = buildSafeCliSpawnSpec(
      "C:\\Program Files\\Custom Tools\\codex.cmd",
      ["--version"],
      {
        platform: "win32",
        env: {
          COMSPEC: "C:\\Windows\\system32\\cmd.exe",
          ELECTRON_RUN_AS_NODE: "1",
          ELECTRON_NO_ATTACH_CONSOLE: "1",
          KEEP_ME: "yes"
        }
      }
    );

    assert.equal(spec.usesCmdWrapper, true);
    assert.equal(spec.windowsVerbatimArguments, true);
    assert.equal(spec.file, "C:\\Windows\\system32\\cmd.exe");
    assert.deepEqual(spec.args, [
      "/d",
      "/s",
      "/c",
      '""C:\\Program Files\\Custom Tools\\codex.cmd" --version"'
    ]);
    assert.equal(spec.env["ELECTRON_RUN_AS_NODE"], undefined);
    assert.equal(spec.env["ELECTRON_NO_ATTACH_CONSOLE"], undefined);
    assert.equal(spec.env["KEEP_ME"], "yes");
  });

  it("executes a real .cmd shim inside a path with spaces and verifies ELECTRON_RUN_AS_NODE is stripped", async (t) => {
    if (process.platform !== "win32") {
      t.skip("Windows-specific .cmd execution test");
      return;
    }

    const root = createTempDir("prismux-cmd-space-");
    try {
      const spacedDir = join(root, "My Global NPM Bin");
      mkdirSync(spacedDir, { recursive: true });
      // Put extensionless POSIX shim right next to .cmd (exact real-world npm layout)
      writeFileSync(join(spacedDir, "fake-codex"), "#!/bin/sh\nexit 1\n", "utf8");
      writeFileSync(
        join(spacedDir, "fake-codex.cmd"),
        [
          "@echo off",
          "if defined ELECTRON_RUN_AS_NODE (echo LEAKED_ELECTRON) else (echo codex-cli 9.9.9-clean %1)"
        ].join("\r\n") + "\r\n",
        "utf8"
      );

      const probed = await defaultCliProbe("fake-codex", ["--version"], 5_000, {
        env: {
          ...process.env,
          PATH: spacedDir,
          ELECTRON_RUN_AS_NODE: "1"
        },
        platform: "win32",
        includeFallbackDirs: false
      });

      assert.equal(probed.found, true);
      assert.equal(probed.path, join(spacedDir, "fake-codex.cmd"));
      assert.equal(probed.error, undefined);
      assert.equal(probed.version, "codex-cli 9.9.9-clean --version");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("parses reg.exe query output, expands %VAR%, preserves process-only PATH entries, and never overwrites USERNAME", async () => {
    const hklmOut = [
      "",
      "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
      "    OS    REG_SZ    Windows_NT",
      "    USERNAME    REG_SZ    SYSTEM",
      "    Path    REG_EXPAND_SZ    %SystemRoot%\\system32;C:\\Program Files\\GitHub CLI\\",
      "    JAVA_HOME    REG_SZ    C:\\Program Files\\Java\\jdk-21",
      ""
    ].join("\r\n");

    const hkcuOut = [
      "",
      "HKEY_CURRENT_USER\\Environment",
      "    Path    REG_EXPAND_SZ    %LOCALAPPDATA%\\agy\\bin;C:\\Users\\Fish\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Google.PlatformTools_123\\platform-tools;",
      "    ANDROID_HOME    REG_SZ    %LOCALAPPDATA%\\Microsoft\\WinGet\\Packages\\Google.PlatformTools_123",
      "    CARGO_HOME    REG_SZ    D:\\Fish-code\\工具\\Rust\\cargo",
      "    HTTP_PROXY    REG_SZ    ",
      ""
    ].join("\r\n");

    const parsedHkcu = parseRegQueryOutput(hkcuOut);
    assert.ok(parsedHkcu.some((e) => e.name === "ANDROID_HOME" && e.type === "REG_SZ"));
    assert.ok(parsedHkcu.some((e) => e.name === "CARGO_HOME" && e.value.includes("工具")));

    const targetEnv: Record<string, string | undefined> = {
      USERNAME: "Fish",
      SystemRoot: "C:\\Windows",
      LOCALAPPDATA: "C:\\Users\\Fish\\AppData\\Local",
      Path: "C:\\CustomSessionBin;C:\\Windows\\system32"
    };

    const result = await refreshWindowsEnvironmentFromRegistry({
      platform: "win32",
      targetEnv,
      queryRegistryHive: async (hiveKey) => {
        if (hiveKey === WINDOWS_HKLM_ENV_KEY) return hklmOut;
        if (hiveKey === WINDOWS_HKCU_ENV_KEY) return hkcuOut;
        throw new Error(`unexpected hive ${hiveKey}`);
      }
    });

    assert.equal(result.refreshed, true);
    assert.equal(targetEnv["USERNAME"], "Fish", "must NOT overwrite USERNAME with HKLM SYSTEM");
    assert.equal(
      targetEnv["ANDROID_HOME"],
      "C:\\Users\\Fish\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Google.PlatformTools_123"
    );
    assert.equal(targetEnv["JAVA_HOME"], "C:\\Program Files\\Java\\jdk-21");
    assert.equal(targetEnv["CARGO_HOME"], "D:\\Fish-code\\工具\\Rust\\cargo");

    const mergedPath = targetEnv["Path"] ?? "";
    const parts = mergedPath.split(";");
    assert.equal(parts[0], "C:\\CustomSessionBin", "process-only entry stays first");
    assert.ok(parts.includes("C:\\Program Files\\GitHub CLI\\"));
    assert.ok(parts.includes("C:\\Users\\Fish\\AppData\\Local\\agy\\bin"));
    assert.ok(
      parts.includes(
        "C:\\Users\\Fish\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Google.PlatformTools_123\\platform-tools"
      )
    );
    // Deduplication check
    assert.equal(
      parts.filter((p) => p.toLowerCase() === "c:\\windows\\system32").length,
      1
    );

    // Direct helper coverage
    assert.equal(
      expandWindowsEnvVars("%LOCALAPPDATA%\\Sdk", new Map([["LOCALAPPDATA", "C:\\Local"]])),
      "C:\\Local\\Sdk"
    );
    assert.equal(
      mergeWindowsPathLists("C:\\A;C:\\B\\", "C:\\b;C:\\C", "C:\\c\\;C:\\D"),
      "C:\\A;C:\\b;C:\\C;C:\\D"
    );
  });

  it("detects Android SDK / adb across WinGet Packages, ANDROID_HOME, and refreshed PATH", () => {
    const root = createTempDir("prismux-adb-scan-");
    try {
      const fakeLocalAppData = join(root, "AppData", "Local");
      const wingetPkg = join(
        fakeLocalAppData,
        "Microsoft",
        "WinGet",
        "Packages",
        "Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe"
      );
      const platformToolsDir = join(wingetPkg, "platform-tools");
      mkdirSync(platformToolsDir, { recursive: true });
      const adbExe = join(platformToolsDir, "adb.exe");
      writeFileSync(adbExe, "MZ", "utf8");

      // Case 1: Empty PATH and no ANDROID_HOME — WinGet Packages directory scan still finds adb.exe!
      const viaWinGet = defaultDetectAndroidSdk({
        platform: "win32",
        homeDir: root,
        env: {
          PATH: "",
          LOCALAPPDATA: fakeLocalAppData,
          USERPROFILE: root
        }
      });
      assert.equal(viaWinGet.adbPath, adbExe);
      assert.equal(viaWinGet.sdkRoot, wingetPkg);

      // Case 2: Refreshed PATH finds adb.exe and infers sdkRoot even with well-known scan disabled
      const viaPath = defaultDetectAndroidSdk({
        platform: "win32",
        homeDir: root,
        scanWellKnownDirs: false,
        env: {
          PATH: platformToolsDir
        }
      });
      assert.equal(viaPath.adbPath, adbExe);
      assert.equal(viaPath.sdkRoot, wingetPkg);

      // Case 3: Refreshed ANDROID_HOME finds platform-tools/adb.exe directly
      const viaEnv = defaultDetectAndroidSdk({
        platform: "win32",
        homeDir: root,
        scanWellKnownDirs: false,
        env: {
          PATH: "",
          ANDROID_HOME: wingetPkg
        }
      });
      assert.equal(viaEnv.adbPath, adbExe);
      assert.equal(viaEnv.sdkRoot, wingetPkg);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("Diagnostics hot-reload routes, cache invalidation & real-machine smoke", () => {
  it("supports ?force=1, ?refresh=1, POST /v1/diagnostics/refresh, and auto-invalidates cache on config mutations", async () => {
    const dataDir = createTempDir("prismux-diag-routes-");
    let refreshEnvCalls = 0;
    let codexInstalled = false;

    const service = new ServiceDiagnosticsService({
      dataDir,
      version: "0.1.2-preview.2",
      headless: true,
      startedAt: Date.now() - 10_000,
      cacheTtlMs: 30_000,
      refreshEnv: async () => {
        refreshEnvCalls += 1;
      },
      cliProbe: async (cmd) => {
        if (cmd === "codex" && codexInstalled) {
          return {
            found: true,
            path: "C:\\Users\\Fish\\AppData\\Roaming\\npm\\codex.cmd",
            version: "codex-cli 0.171.0",
            latencyMs: 8
          };
        }
        return { found: false, path: null, version: null, latencyMs: 1 };
      },
      networkProbe: async () => ({
        reachable: true,
        statusCode: 200,
        latencyMs: 10
      }),
      detectAndroidSdk: () => ({ sdkRoot: null, adbPath: null }),
      resolve7za: () => null
    });

    try {
      // 1. Cold run populates cache and calls refreshEnv once; uninstalled codex is omitted (NOT degraded)
      const first = await service.runDiagnostics(false);
      assert.equal(first.cached, false);
      assert.equal(refreshEnvCalls, 1);
      assert.equal(
        first.items.find((i) => i.id === "provider.codex"),
        undefined
      );
      const aiGroupInitial = first.groups.find((g) => g.id === "ai_providers");
      assert.ok(aiGroupInitial);
      assert.equal(aiGroupInitial.items.length, 0);
      assert.equal(aiGroupInitial.degradedCount, 0);
      assert.equal(aiGroupInitial.status, "ok");

      // Verify split settings routes (/settings/memory & /settings/sync)
      assert.equal(
        first.items.find((i) => i.id === "memory.sqlite_wal")?.settingsRoute,
        "/settings/memory"
      );
      assert.equal(
        first.items.find((i) => i.id === "memory.sqlite_vec")?.settingsRoute,
        "/settings/memory"
      );
      assert.equal(
        first.items.find((i) => i.id === "sync.vault")?.settingsRoute,
        "/settings/sync"
      );

      // 2. Subsequent non-force run hits cache without calling refreshEnv
      const cached = await service.runDiagnostics(false);
      assert.equal(cached.cached, true);
      assert.equal(refreshEnvCalls, 1);

      // 3. Tool gets installed externally; forced refresh immediately re-reads env and turns green
      codexInstalled = true;
      const forced = await service.runDiagnostics(true);
      assert.equal(forced.cached, false);
      assert.equal(refreshEnvCalls, 2);
      const codexOk = forced.items.find((i) => i.id === "provider.codex");
      assert.equal(codexOk?.status, "ok");
      assert.equal(codexOk?.version, "codex-cli 0.171.0");

      // 4. invalidateCache() forces next non-force run to re-probe
      service.invalidateCache();
      const afterInvalidate = await service.runDiagnostics(false);
      assert.equal(afterInvalidate.cached, false);
      assert.equal(refreshEnvCalls, 3);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("exposes GET /v1/diagnostics?refresh=1, POST /v1/diagnostics/refresh, and invalidates on HTTP mutations", async () => {
    const dataDir = createTempDir("prismux-diag-http-");
    const authToken = "prismux-diag-hot-reload-test-token";
    const daemon = new PrismuxDaemon({
      dataDir,
      host: "127.0.0.1",
      port: 0,
      headless: true,
      authToken,
      disableAutoUpdateCheck: true
    });

    try {
      const ready = await daemon.start();
      const baseUrl = `http://${ready.host}:${ready.port}`;
      const headers = {
        authorization: `Bearer ${authToken}`,
        "content-type": "application/json"
      };

      const r1 = (await fetch(`${baseUrl}/v1/diagnostics/services`, {
        headers
      }).then((r) => r.json())) as ServiceDiagnosticsResponse;
      assert.equal(r1.ok, true);
      assert.equal(r1.cached, false);

      // Second GET hits 30s cache
      const r2 = (await fetch(`${baseUrl}/v1/diagnostics`, {
        headers
      }).then((r) => r.json())) as ServiceDiagnosticsResponse;
      assert.equal(r2.ok, true);
      assert.equal(r2.cached, true);

      // GET /v1/diagnostics?refresh=1 bypasses cache
      const r3 = (await fetch(`${baseUrl}/v1/diagnostics?refresh=1`, {
        headers
      }).then((r) => r.json())) as ServiceDiagnosticsResponse;
      assert.equal(r3.ok, true);
      assert.equal(r3.cached, false);

      // POST /v1/diagnostics/refresh always bypasses cache
      const r4 = (await fetch(`${baseUrl}/v1/diagnostics/refresh`, {
        method: "POST",
        headers
      }).then((r) => r.json())) as ServiceDiagnosticsResponse;
      assert.equal(r4.ok, true);
      assert.equal(r4.cached, false);

      // Subsequent GET is cached...
      const r5 = (await fetch(`${baseUrl}/v1/diagnostics/services`, {
        headers
      }).then((r) => r.json())) as ServiceDiagnosticsResponse;
      assert.equal(r5.cached, true);

      // ...then a Chief profile mutation automatically invalidates diagnostics cache!
      const mutRes = await fetch(`${baseUrl}/v1/chief/profile`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ secretaryName: "Prismux Chief" })
      });
      assert.equal(mutRes.status, 200);

      const r6 = (await fetch(`${baseUrl}/v1/diagnostics/services`, {
        headers
      }).then((r) => r.json())) as ServiceDiagnosticsResponse;
      assert.equal(r6.ok, true);
      assert.equal(
        r6.cached,
        false,
        "diagnostics cache must be invalidated after chief profile update"
      );
    } finally {
      await daemon.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("verifies real-machine codex.cmd & WinGet adb.exe detection without ENOENT", async (t) => {
    if (process.platform !== "win32") {
      t.skip("Windows real-machine probe test");
      return;
    }

    const appData = process.env["APPDATA"] ?? "";
    const localAppData = process.env["LOCALAPPDATA"] ?? "";
    const hasRealCodexCmd = existsSync(join(appData, "npm", "codex.cmd"));
    const hasRealAdb =
      defaultDetectAndroidSdk({
        env: {
          ...process.env,
          LOCALAPPDATA: localAppData
        }
      }).adbPath !== null;

    if (!hasRealCodexCmd && !hasRealAdb) {
      t.skip("Neither codex.cmd nor adb.exe is installed on this runner");
      return;
    }

    const dataDir = createTempDir("prismux-diag-live-");
    try {
      const svc = new ServiceDiagnosticsService({
        dataDir,
        version: "0.1.2-preview.2",
        headless: true,
        startedAt: Date.now(),
        // Stub network probes so this test focuses purely on local CLI/env detection speed & accuracy
        networkProbe: async () => ({
          reachable: true,
          statusCode: 200,
          latencyMs: 5
        })
      });

      const report = await svc.runDiagnostics(true);

      if (hasRealCodexCmd) {
        const codex = report.items.find((i) => i.id === "provider.codex");
        assert.ok(codex, "provider.codex item must exist");
        assert.equal(codex.status, "ok", `expected codex ok, got: ${JSON.stringify(codex)}`);
        assert.ok(codex.version && codex.version.length > 0, "codex version must be populated");
        assert.ok(
          codex.detail?.toLowerCase().endsWith("codex.cmd"),
          `expected codex.cmd path, got: ${codex.detail}`
        );
        assert.ok(!codex.detail?.includes("ENOENT"));
      }

      if (hasRealAdb) {
        const android = report.items.find((i) => i.id === "tool.android_sdk");
        assert.ok(android, "tool.android_sdk item must exist");
        assert.equal(android.status, "ok", `expected android_sdk ok, got: ${JSON.stringify(android)}`);
        assert.ok(
          android.version?.includes("Android Debug Bridge"),
          `expected adb version string, got: ${android.version}`
        );
      }

      const dshExe = join(localAppData, "Programs", "DSH NEXT", "DSH NEXT.exe");
      if (existsSync(dshExe)) {
        const dsh = report.items.find((i) => i.id === "provider.dsh");
        assert.ok(dsh, "provider.dsh item must exist when DSH NEXT is installed");
        assert.equal(dsh.status, "ok", `expected dsh ok, got: ${JSON.stringify(dsh)}`);
        assert.ok(dsh.version && dsh.version.length > 0, "dsh version must be populated");
        assert.notEqual(dsh.version, "0.0.1", "dsh version must not be hardcoded 0.0.1");
      }
      assert.equal(
        report.items.find((i) => i.id === "provider.omp"),
        undefined,
        "provider.omp must be permanently removed"
      );
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("omits uninstalled optional AI Provider CLIs, removes omp, probes dsh, and marks installed-but-broken CLIs as degraded", async () => {
    const dataDir = createTempDir("prismux-diag-ai-providers-");
    const probedCommands: string[] = [];
    const service = new ServiceDiagnosticsService({
      dataDir,
      version: "0.2.0-rc.2",
      headless: true,
      startedAt: Date.now() - 1_000,
      refreshEnv: async () => undefined,
      detectAndroidSdk: () => ({ sdkRoot: null, adbPath: null }),
      resolve7za: () => null,
      networkProbe: async () => ({
        reachable: true,
        statusCode: 200,
        latencyMs: 5
      }),
      cliProbe: async (cmd) => {
        probedCommands.push(cmd);
        if (cmd === "agy") {
          return {
            found: true,
            path: "C:\\Users\\Fish\\AppData\\Local\\agy\\bin\\agy.exe",
            version: "1.5.17",
            latencyMs: 4
          };
        }
        if (cmd === "dsh") {
          return {
            found: true,
            path: "C:\\Users\\Fish\\AppData\\Local\\Programs\\DSH NEXT\\DSH NEXT.exe",
            version: "0.2.2-rc.4",
            latencyMs: 12
          };
        }
        if (cmd === "codex") {
          // Installed binary exists, but fails to launch / crashes during --version
          return {
            found: true,
            path: "C:\\Users\\Fish\\AppData\\Roaming\\npm\\codex.cmd",
            version: null,
            latencyMs: 15,
            error: "Command failed with exit code 1"
          };
        }
        // claude, gemini, opencode are not installed on this machine
        return { found: false, path: null, version: null, latencyMs: 1 };
      }
    });

    try {
      const report = await service.runDiagnostics(true);
      assert.ok(!probedCommands.includes("omp"), "omp must never be probed");
      assert.ok(probedCommands.includes("dsh"), "dsh must be probed");

      const aiGroup = report.groups.find((g) => g.id === "ai_providers");
      assert.ok(aiGroup);
      assert.deepEqual(
        aiGroup.items.map((item) => item.id).sort(),
        ["provider.agy", "provider.codex", "provider.dsh"]
      );
      assert.equal(aiGroup.okCount, 2);
      assert.equal(aiGroup.degradedCount, 1);
      assert.equal(aiGroup.errorCount, 0);
      assert.equal(aiGroup.status, "degraded");

      const agyItem = aiGroup.items.find((i) => i.id === "provider.agy");
      assert.equal(agyItem?.status, "ok");
      assert.equal(agyItem?.version, "1.5.17");

      const dshItem = aiGroup.items.find((i) => i.id === "provider.dsh");
      assert.equal(dshItem?.status, "ok");
      assert.equal(dshItem?.version, "0.2.2-rc.4");

      const brokenCodex = aiGroup.items.find((i) => i.id === "provider.codex");
      assert.equal(brokenCodex?.status, "degraded");
      assert.ok(brokenCodex?.detail?.includes("exit code 1"));

      // Uninstalled CLIs must NOT appear anywhere in items or degrade totals
      assert.equal(report.items.find((i) => i.id === "provider.gemini"), undefined);
      assert.equal(report.items.find((i) => i.id === "provider.opencode"), undefined);
      assert.equal(report.items.find((i) => i.id === "provider.claude"), undefined);
      assert.equal(report.items.find((i) => i.id === "provider.omp"), undefined);

      // When ALL installed CLIs are healthy and uninstalled ones are missing, group is completely ok!
      const healthyOnlyService = new ServiceDiagnosticsService({
        dataDir,
        version: "0.2.0-rc.2",
        headless: true,
        startedAt: Date.now() - 1_000,
        refreshEnv: async () => undefined,
        detectAndroidSdk: () => ({ sdkRoot: null, adbPath: null }),
        resolve7za: () => null,
        networkProbe: async () => ({ reachable: true, statusCode: 200, latencyMs: 5 }),
        cliProbe: async (cmd) =>
          cmd === "agy"
            ? { found: true, path: "/usr/bin/agy", version: "1.5.17", latencyMs: 3 }
            : { found: false, path: null, version: null, latencyMs: 1 }
      });
      const healthyReport = await healthyOnlyService.runDiagnostics(true);
      const healthyAiGroup = healthyReport.groups.find((g) => g.id === "ai_providers");
      assert.ok(healthyAiGroup);
      assert.deepEqual(
        healthyAiGroup.items.map((i) => i.id),
        ["provider.agy"]
      );
      assert.equal(healthyAiGroup.status, "ok");
      assert.equal(healthyAiGroup.okCount, 1);
      assert.equal(healthyAiGroup.degradedCount, 0);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("never degrades uninstalled CLIs or hangs all 6 providers when CoreRpcClient.listProviders() never replies (Effect RPC server)", async () => {
    clearCliDiscoveryCaches();
    const root = createTempDir("prismux-diag-rpc-hang-");
    const binDir = join(root, "bin");
    mkdirSync(binDir, { recursive: true });

    // Only install `codex` on fake PATH; leave agy, claude, dsh, gemini, opencode uninstalled!
    const codexBin =
      process.platform === "win32"
        ? join(binDir, "codex.cmd")
        : join(binDir, "codex");
    writeFileSync(
      codexBin,
      process.platform === "win32"
        ? "@echo off\r\necho codex-cli 0.999.0\r\n"
        : "#!/bin/sh\necho codex-cli 0.999.0\n",
      { mode: 0o755 }
    );

    let listProvidersCalls = 0;
    const hangingCoreRpc = {
      isConnected: () => true,
      getStatus: () => ({
        state: "connected",
        connected: true,
        wsUrl: "ws://127.0.0.1:3773/ws",
        protocolVersion: "2",
        reconnectAttempts: 0,
        pendingRequestCount: 0
      }),
      listProviders: () => {
        listProvidersCalls += 1;
        // Simulate Effect RPC server that accepts WS upgrade but never answers legacy `provider.list`.
        return new Promise<never>(() => {});
      }
    } as unknown as CoreRpcClient;

    const isolatedEnv: Record<string, string | undefined> = {
      PATH: binDir,
      USERPROFILE: root,
      LOCALAPPDATA: join(root, "AppData", "Local"),
      APPDATA: join(root, "AppData", "Roaming"),
      HOME: root,
      COMSPEC: process.env["COMSPEC"],
      OPENAI_BASE_URL: "https://relay.example/v1"
    };

    try {
      const probeService = new PrismuxProviderProbeService({
        coreRpcClient: hangingCoreRpc,
        env: isolatedEnv,
        homeDir: root,
        platform: process.platform,
        refreshEnv: () => undefined
      });
      const diag = new ServiceDiagnosticsService({
        dataDir: root,
        version: "0.2.4-rc.1",
        headless: true,
        startedAt: Date.now() - 1_000,
        coreRpcClient: hangingCoreRpc,
        providerProbeService: probeService,
        refreshEnv: () => undefined,
        detectAndroidSdk: () => ({ sdkRoot: null, adbPath: null }),
        resolve7za: () => null,
        networkProbe: async () => ({ reachable: true, statusCode: 200, latencyMs: 5 })
      });

      const started = performance.now();
      const report = await diag.runDiagnostics(true);
      const elapsedMs = performance.now() - started;

      // Deduplicated single RPC timeout (<=350ms), NOT 6x 15s hangs or 6x >1100ms degraded cards!
      assert.equal(listProvidersCalls, 1, "listProviders must be deduplicated to a single bounded call");
      assert.ok(elapsedMs < 3_000, `Diagnostics took too long (${Math.round(elapsedMs)}ms)`);

      const aiGroup = report.groups.find((g) => g.id === "ai_providers");
      assert.ok(aiGroup);
      assert.equal(aiGroup.status, "ok");
      assert.equal(aiGroup.degradedCount, 0);
      assert.equal(aiGroup.errorCount, 0);

      // Uninstalled CLIs on this isolated PATH must be completely omitted, NEVER degraded!
      assert.equal(aiGroup.items.find((item) => item.id === "provider.gemini"), undefined);
      assert.equal(aiGroup.items.find((item) => item.id === "provider.opencode"), undefined);
      assert.equal(aiGroup.items.find((item) => item.id === "provider.claude"), undefined);
      assert.equal(aiGroup.items.find((item) => item.id === "provider.agy"), undefined);

      const codex = aiGroup.items.find((item) => item.id === "provider.codex");
      assert.ok(codex, "installed codex must be detected");
      assert.equal(codex.status, "ok");
      assert.equal(codex.version, "codex-cli 0.999.0");
      for (const item of aiGroup.items) {
        assert.equal(item.status, "ok");
        assert.ok(!item.summary.includes("探测超时"), `unexpected timeout summary: ${item.summary}`);
      }
    } finally {
      clearCliDiscoveryCaches();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("gracefully marks installed CLIs as ok when --version times out while keeping genuine crashes degraded", async () => {
    const dataDir = createTempDir("prismux-diag-slow-vs-crash-");
    try {
      const probeService = new PrismuxProviderProbeService({
        homeDir: dataDir,
        env: { OPENAI_BASE_URL: "https://relay.example/v1" },
        refreshEnv: () => undefined,
        cliProbe: async (cmd) => {
          if (cmd === "codex") {
            return {
              found: true,
              path: "C:\\Users\\Fish\\AppData\\Roaming\\npm\\codex.cmd",
              version: null,
              latencyMs: 3_500,
              timedOut: true,
              error: "Command timed out"
            };
          }
          if (cmd === "claude") {
            return {
              found: true,
              path: "C:\\Users\\Fish\\.local\\bin\\claude.exe",
              version: null,
              latencyMs: 25,
              timedOut: false,
              error: "Command failed with exit code 1"
            };
          }
          return { found: false, path: null, version: null, latencyMs: 1 };
        }
      });

      const diag = new ServiceDiagnosticsService({
        dataDir,
        version: "0.2.4-rc.1",
        headless: true,
        startedAt: Date.now() - 1_000,
        providerProbeService: probeService,
        refreshEnv: () => undefined,
        detectAndroidSdk: () => ({ sdkRoot: null, adbPath: null }),
        resolve7za: () => null,
        networkProbe: async () => ({ reachable: true, statusCode: 200, latencyMs: 5 })
      });

      const report = await diag.runDiagnostics(true);
      const aiGroup = report.groups.find((g) => g.id === "ai_providers");
      assert.ok(aiGroup);

      const codexItem = aiGroup.items.find((i) => i.id === "provider.codex");
      assert.ok(codexItem, "slow installed codex must be reported");
      assert.equal(codexItem.status, "ok", "installed binary + resolved auth must degrade gracefully to ok on slow --version");
      assert.ok(codexItem.summary.includes("已安装"));
      assert.ok(!codexItem.summary.includes("探测超时"));

      const claudeItem = aiGroup.items.find((i) => i.id === "provider.claude");
      assert.ok(claudeItem, "crashed installed claude must still be reported");
      assert.equal(claudeItem.status, "degraded", "non-timeout CLI crash must stay degraded");
      assert.ok(claudeItem.detail?.includes("exit code 1"));

      // Uninstalled CLIs remain omitted
      assert.equal(aiGroup.items.find((i) => i.id === "provider.gemini"), undefined);
      assert.equal(aiGroup.items.find((i) => i.id === "provider.opencode"), undefined);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
