// @effect-diagnostics nodeBuiltinImport:off -- Unit tests inspect real local temp files and SHA-256 digests.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  buildPrismuxDaemonChildEnv,
  normalizeT3HttpUrl,
  normalizeT3WebSocketUrl,
} from "../../prismux/PrismuxDaemonService.ts";
import {
  computeFileSha256Hex,
  executePrismuxInstallDownloadedUpdate,
  isPathStrictlyWithinDirectory,
  resolvePrismuxUpdateCachePolicy,
  verifySha256ConstantTime,
  type PrismuxInstallDownloadedUpdateDeps,
} from "./prismux.ts";

function sha256Of(contents: Buffer | string): string {
  return NodeCrypto.createHash("sha256").update(contents).digest("hex");
}

async function withTempUpdatesEnv<T>(
  run: (ctx: {
    readonly rootDir: string;
    readonly updatesDir: string;
    readonly outsideDir: string;
    readonly portableDir: string;
    readonly portableUpdatesDir: string;
  }) => Promise<T>,
): Promise<T> {
  const rootDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "prismux-update-ipc-test-"));
  const updatesDir = NodePath.join(rootDir, ".prismux", "updates");
  const outsideDir = NodePath.join(rootDir, "outside");
  const portableDir = NodePath.join(rootDir, "portable-app");
  const portableUpdatesDir = NodePath.join(portableDir, "data", "updates");
  await NodeFSP.mkdir(updatesDir, { recursive: true });
  await NodeFSP.mkdir(outsideDir, { recursive: true });
  await NodeFSP.mkdir(portableUpdatesDir, { recursive: true });
  try {
    return await run({ rootDir, updatesDir, outsideDir, portableDir, portableUpdatesDir });
  } finally {
    await NodeFSP.rm(rootDir, { recursive: true, force: true });
  }
}

describe("Prismux installDownloadedUpdate security & lifecycle", () => {
  it("validates strict directory containment and constant-time SHA-256", () => {
    const root = NodePath.resolve("C:\\Users\\Fish\\.prismux\\updates");
    assert.isTrue(
      isPathStrictlyWithinDirectory(NodePath.join(root, "Prismux-Setup-0.1.1.exe"), root, "win32"),
    );
    assert.isFalse(isPathStrictlyWithinDirectory(root, root, "win32"));
    assert.isFalse(
      isPathStrictlyWithinDirectory(
        NodePath.join(root, "..", "Prismux-Setup-0.1.1.exe"),
        root,
        "win32",
      ),
    );
    assert.isFalse(
      isPathStrictlyWithinDirectory(
        NodePath.resolve("C:\\Users\\Fish\\.prismux\\updates-evil\\setup.exe"),
        root,
        "win32",
      ),
    );

    const hash = sha256Of("prismux-installer-payload");
    assert.isTrue(verifySha256ConstantTime(hash, hash.toUpperCase()));
    assert.isFalse(verifySha256ConstantTime(hash, `${hash.slice(0, 63)}0`));
    assert.isFalse(verifySha256ConstantTime("not-a-sha", hash));
  });

  it("detects portable mode when sibling data directory exists", async () => {
    await withTempUpdatesEnv(async ({ rootDir, portableDir, portableUpdatesDir }) => {
      const regularPolicy = resolvePrismuxUpdateCachePolicy({
        homeDirectory: rootDir,
        baseDir: NodePath.join(rootDir, ".prismux"),
        executablePath: NodePath.join(rootDir, "installed", "Prismux.exe"),
        env: {},
      });
      assert.isFalse(regularPolicy.portableMode);
      assert.include(
        regularPolicy.allowedUpdatesDirs.map((entry) => entry.toLowerCase()),
        NodePath.join(rootDir, ".prismux", "updates").toLowerCase(),
      );

      const portablePolicy = resolvePrismuxUpdateCachePolicy({
        homeDirectory: rootDir,
        baseDir: NodePath.join(rootDir, ".prismux"),
        executablePath: NodePath.join(portableDir, "Prismux.exe"),
        env: {},
      });
      assert.isTrue(portablePolicy.portableMode);
      assert.include(
        portablePolicy.allowedUpdatesDirs.map((entry) => entry.toLowerCase()),
        portableUpdatesDir.toLowerCase(),
      );
    });
  });

  it("rejects path traversal and files outside updates directory", async () => {
    await withTempUpdatesEnv(async ({ updatesDir, outsideDir }) => {
      const outsideExe = NodePath.join(outsideDir, "evil.exe");
      await NodeFSP.writeFile(outsideExe, "MZ-fake-outside-binary");
      const hash = sha256Of("MZ-fake-outside-binary");

      let spawned = false;
      const deps: PrismuxInstallDownloadedUpdateDeps = {
        platform: process.platform,
        portableMode: false,
        allowedUpdatesDirs: [updatesDir],
        showItemInFolder: () => {},
        stopManagedProcesses: () => Effect.void,
        spawnInstaller: () => {
          spawned = true;
        },
        scheduleQuit: () => Effect.void,
        markQuitting: () => Effect.void,
      };

      const traversalPath = NodePath.join(updatesDir, "..", "..", "outside", "evil.exe");
      const err1 = await Effect.runPromise(
        Effect.flip(
          executePrismuxInstallDownloadedUpdate(
            { filePath: traversalPath, expectedSha256: hash },
            deps,
          ),
        ),
      );
      assert.equal(err1.reason, "path_outside_updates_dir");
      assert.isFalse(spawned);

      const err2 = await Effect.runPromise(
        Effect.flip(
          executePrismuxInstallDownloadedUpdate(
            { filePath: outsideExe, expectedSha256: hash },
            deps,
          ),
        ),
      );
      assert.equal(err2.reason, "path_outside_updates_dir");
      assert.isFalse(spawned);
    });
  });

  it("rejects non-.exe extensions in standard mode and tampered SHA-256 digests", async () => {
    await withTempUpdatesEnv(async ({ updatesDir }) => {
      const badScript = NodePath.join(updatesDir, "update.bat");
      await NodeFSP.writeFile(badScript, "@echo off\r\necho pwned");
      const validExe = NodePath.join(updatesDir, "Prismux-Setup-0.1.1-alpha.1-win-x64.exe");
      await NodeFSP.writeFile(validExe, "MZ-original-payload");
      const actualHash = await computeFileSha256Hex(validExe);
      const tamperedHash =
        actualHash.startsWith("a") ? `b${actualHash.slice(1)}` : `a${actualHash.slice(1)}`;

      let spawned = false;
      const deps: PrismuxInstallDownloadedUpdateDeps = {
        platform: process.platform,
        portableMode: false,
        allowedUpdatesDirs: [updatesDir],
        showItemInFolder: () => {},
        stopManagedProcesses: () => Effect.void,
        spawnInstaller: () => {
          spawned = true;
        },
        scheduleQuit: () => Effect.void,
        markQuitting: () => Effect.void,
      };

      const extError = await Effect.runPromise(
        Effect.flip(
          executePrismuxInstallDownloadedUpdate(
            { filePath: badScript, expectedSha256: sha256Of("@echo off\r\necho pwned") },
            deps,
          ),
        ),
      );
      assert.equal(extError.reason, "invalid_extension");
      assert.isFalse(spawned);

      const shaError = await Effect.runPromise(
        Effect.flip(
          executePrismuxInstallDownloadedUpdate(
            { filePath: validExe, expectedSha256: tamperedHash },
            deps,
          ),
        ),
      );
      assert.equal(shaError.reason, "sha256_mismatch");
      assert.isFalse(spawned);
    });
  });

  it("opens folder without launching NSIS in portable mode", async () => {
    await withTempUpdatesEnv(async ({ portableUpdatesDir }) => {
      const portablePkg = NodePath.join(
        portableUpdatesDir,
        "Prismux-Setup-0.1.1-alpha.1-win-x64.exe",
      );
      await NodeFSP.writeFile(portablePkg, "MZ-portable-verified-payload");
      const expectedSha256 = await computeFileSha256Hex(portablePkg);

      const openedPaths: string[] = [];
      let stopped = false;
      let spawned = false;
      let quitScheduled = false;

      const result = await Effect.runPromise(
        executePrismuxInstallDownloadedUpdate(
          { filePath: portablePkg, expectedSha256, silent: true },
          {
            platform: process.platform,
            portableMode: true,
            allowedUpdatesDirs: [portableUpdatesDir],
            showItemInFolder: (filePath) => {
              openedPaths.push(filePath);
            },
            stopManagedProcesses: () =>
              Effect.sync(() => {
                stopped = true;
              }),
            spawnInstaller: () => {
              spawned = true;
            },
            scheduleQuit: () =>
              Effect.sync(() => {
                quitScheduled = true;
              }),
            markQuitting: () => Effect.void,
          },
        ),
      );

      assert.isTrue(result.ok);
      assert.equal(result.mode, "portable-opened");
      assert.equal(result.sha256, expectedSha256);
      assert.equal(openedPaths.length, 1);
      assert.isFalse(stopped);
      assert.isFalse(spawned);
      assert.isFalse(quitScheduled);
    });
  });

  it("stops managed processes, spawns verified NSIS installer, and schedules 150ms quit", async () => {
    await withTempUpdatesEnv(async ({ updatesDir }) => {
      const installerExe = NodePath.join(updatesDir, "Prismux-Setup-0.1.1-alpha.1-win-x64.exe");
      await NodeFSP.writeFile(installerExe, "MZ-verified-nsis-installer");
      const expectedSha256 = await computeFileSha256Hex(installerExe);

      const events: string[] = [];
      const spawnedCalls: Array<{ filePath: string; args: readonly string[] }> = [];
      const quitDelays: number[] = [];

      const result = await Effect.runPromise(
        executePrismuxInstallDownloadedUpdate(
          { filePath: installerExe, expectedSha256, silent: true },
          {
            platform: process.platform,
            portableMode: false,
            allowedUpdatesDirs: [updatesDir],
            showItemInFolder: () => {
              events.push("showItemInFolder");
            },
            markQuitting: (quitting) =>
              Effect.sync(() => {
                events.push(`markQuitting:${quitting}`);
              }),
            stopManagedProcesses: () =>
              Effect.sync(() => {
                events.push("stopManagedProcesses");
              }),
            spawnInstaller: (filePath, args) => {
              events.push("spawnInstaller");
              spawnedCalls.push({ filePath, args });
            },
            scheduleQuit: (delayMs) =>
              Effect.sync(() => {
                events.push(`scheduleQuit:${delayMs}`);
                quitDelays.push(delayMs);
              }),
          },
        ),
      );

      assert.isTrue(result.ok);
      assert.equal(result.mode, "installer-launched");
      assert.equal(result.sha256, expectedSha256);
      assert.deepEqual(events, [
        "markQuitting:true",
        "stopManagedProcesses",
        "spawnInstaller",
        "scheduleQuit:150",
      ]);
      assert.equal(spawnedCalls.length, 1);
      assert.deepEqual(spawnedCalls[0]?.args, ["/S"]);
      assert.deepEqual(quitDelays, [150]);
    });
  });

  it("injects PRISMUX_T3_SERVER_URL, T3CODE_SERVER_URL, PRISMUX_T3_WS_URL and PRISMUX_MAIN_PID into daemon child env", () => {
    assert.equal(normalizeT3HttpUrl("ws://127.0.0.1:3773/ws"), "http://127.0.0.1:3773");
    assert.equal(normalizeT3HttpUrl("http://127.0.0.1:3773/"), "http://127.0.0.1:3773");
    assert.equal(normalizeT3WebSocketUrl("http://127.0.0.1:3773/"), "ws://127.0.0.1:3773/ws");

    const env = buildPrismuxDaemonChildEnv({
      hostEnv: { PATH: "C:\\Windows" },
      catalogPath: "C:\\Prismux\\catalog\\official.json",
      mainPid: 4242,
      t3HttpUrl: "http://127.0.0.1:3773/",
      t3WsUrl: "ws://127.0.0.1:3773/ws",
    });

    assert.equal(env.ELECTRON_RUN_AS_NODE, "1");
    assert.equal(env.PRISMUX_CATALOG_PATH, "C:\\Prismux\\catalog\\official.json");
    assert.equal(env.PRISMUX_MAIN_PID, "4242");
    assert.equal(env.PRISMUX_T3_SERVER_URL, "http://127.0.0.1:3773");
    assert.equal(env.T3CODE_SERVER_URL, "http://127.0.0.1:3773");
    assert.equal(env.PRISMUX_T3_WS_URL, "ws://127.0.0.1:3773/ws");
  });
});
