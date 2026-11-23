import * as PlatformError from "effect/PlatformError";
import { expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as ProcessRunner from "../processRunner.ts";
import {
  buildDeviceNpmRegistryOrder,
  deviceToolVersions,
  DEVICE_HUB_VERSION,
  DeviceToolchainInstallError,
  ensureDeviceHub,
  isDeviceHubInstalled,
  PRISMUX_NPM_MIRROR_REGISTRY,
  PRISMUX_NPM_OFFICIAL_REGISTRY,
  resolveDeviceNpmRegistries,
} from "./DeviceToolchain.ts";

it.effect("failed installation cleans staging and exposes only a safe failure message", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-device-install-" });
    const result = {
      code: ChildProcessSpawner.ExitCode(1),
      stdout: "",
      stderr: "registry rejected https://private:credential@example.test/package",
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      stdoutInvalidUtf8: false,
      stderrInvalidUtf8: false,
    };
    const error = yield* ensureDeviceHub(baseDir).pipe(
      Effect.provideService(ProcessRunner.ProcessRunner, {
        run: () => Effect.succeed(result),
      }),
      Effect.flip,
    );
    expect(error.message).toBe(
      "Installing expo-device-hub failed while running npm install (exit code 1).",
    );
    expect(error.cause).toBe(result);
    expect(yield* isDeviceHubInstalled(baseDir)).toBe(false);
    expect(yield* fs.readDirectory(path.join(baseDir, "tools", "expo-device-hub"))).toEqual([]);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("inventory reports only completed versions without installing the required version", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const base = yield* fs.makeTempDirectoryScoped();
    for (const [version, sentinel] of [
      ["0.9.0", "0.9.0"],
      [DEVICE_HUB_VERSION, "wrong"],
      [".staging-123", ".staging-123"],
    ]) {
      const dir = path.join(base, "tools", "expo-device-hub", version!);
      yield* fs.makeDirectory(path.join(dir, "node_modules/expo-device-hub/dist/server"), {
        recursive: true,
      });
      yield* fs.writeFileString(
        path.join(dir, "node_modules/expo-device-hub/dist/server/cli.mjs"),
        "",
      );
      yield* fs.writeFileString(path.join(dir, ".install-complete"), sentinel!);
    }
    const tools = yield* deviceToolVersions(base);
    expect(tools?.hub).toEqual({
      requiredVersion: DEVICE_HUB_VERSION,
      installedVersions: ["0.9.0"],
      runningVersion: null,
    });
    expect(tools?.agent.installedVersions).toEqual([]);
    expect(yield* isDeviceHubInstalled(base)).toBe(false);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("unreadable inventory stays unknown instead of reporting no installs", () =>
  Effect.gen(function* () {
    const tools = yield* deviceToolVersions("/unreadable");
    expect(tools).toBeUndefined();
  }).pipe(
    Effect.provideService(
      FileSystem.FileSystem,
      FileSystem.makeNoop({
        readDirectory: () =>
          Effect.fail(
            PlatformError.systemError({
              _tag: "PermissionDenied",
              module: "FileSystem",
              method: "readDirectory",
              description: "denied",
            }),
          ),
      }),
    ),
    Effect.provide(NodeServices.layer),
  ),
);

it.effect("tries npmmirror first and automatically falls back to npmjs.org on failure", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "prismux-device-fallback-" });
    const attemptedRegistries: string[] = [];

    const paths = yield* ensureDeviceHub(baseDir).pipe(
      Effect.provideService(ProcessRunner.ProcessRunner, {
        run: (input) =>
          Effect.gen(function* () {
            const registryIndex = input.args.indexOf("--registry");
            const registry = registryIndex >= 0 ? (input.args[registryIndex + 1] ?? "") : "";
            const prefixIndex = input.args.indexOf("--prefix");
            const prefixDir = prefixIndex >= 0 ? (input.args[prefixIndex + 1] ?? "") : "";
            attemptedRegistries.push(registry);
            if (registry === PRISMUX_NPM_MIRROR_REGISTRY) {
              return {
                code: ChildProcessSpawner.ExitCode(1),
                stdout: "",
                stderr: "ETIMEDOUT connecting to npmmirror",
                timedOut: false,
                stdoutTruncated: false,
                stderrTruncated: false,
                stdoutInvalidUtf8: false,
                stderrInvalidUtf8: false,
              };
            }
            const entryPath = path.join(
              prefixDir,
              "node_modules",
              "expo-device-hub",
              "dist",
              "server",
              "cli.mjs",
            );
            yield* fs.makeDirectory(path.dirname(entryPath), { recursive: true });
            yield* fs.writeFileString(entryPath, "console.log('ok');\n");
            return {
              code: ChildProcessSpawner.ExitCode(0),
              stdout: "added 1 package",
              stderr: "",
              timedOut: false,
              stdoutTruncated: false,
              stderrTruncated: false,
              stdoutInvalidUtf8: false,
              stderrInvalidUtf8: false,
            };
          }).pipe(Effect.orDie),
      }),
    );

    expect(attemptedRegistries).toEqual([
      PRISMUX_NPM_MIRROR_REGISTRY,
      PRISMUX_NPM_OFFICIAL_REGISTRY,
    ]);
    expect(yield* isDeviceHubInstalled(baseDir)).toBe(true);
    expect(paths.entryPath).toContain("expo-device-hub");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("reads pluginRegistryOverride and routePreference from ~/.prismux config and brands npm error as Prismux", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const prismuxHome = yield* fs.makeTempDirectoryScoped({ prefix: "prismux-home-" });
    yield* fs.writeFileString(
      path.join(prismuxHome, "config.json"),
      JSON.stringify({
        pluginRegistryOverride: "https://mirror.internal.example/npm/",
        routePreference: "global",
      }),
    );

    const registries = yield* resolveDeviceNpmRegistries({
      prismuxHomeDir: prismuxHome,
      env: {},
    });
    expect(registries).toEqual([
      "https://mirror.internal.example/npm",
      PRISMUX_NPM_OFFICIAL_REGISTRY,
      PRISMUX_NPM_MIRROR_REGISTRY,
    ]);
    expect(buildDeviceNpmRegistryOrder({})).toEqual([
      PRISMUX_NPM_MIRROR_REGISTRY,
      PRISMUX_NPM_OFFICIAL_REGISTRY,
    ]);

    const npmError = new DeviceToolchainInstallError({
      tool: "expo-device-hub",
      step: "running npm install",
      reason: "npm_not_found",
    });
    expect(npmError.message).toContain("Prismux");
    expect(npmError.message).not.toContain("T3 Code");
    expect(npmError.message).not.toContain("T3 server");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
