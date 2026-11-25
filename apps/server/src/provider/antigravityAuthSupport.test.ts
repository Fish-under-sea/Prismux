import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderInstanceId } from "@prismux/core-contracts";
import * as HostProcess from "@prismux/core-shared/HostProcess";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as AcpErrors from "@prismux/effect-acp/errors";

import {
  ANTIGRAVITY_SIGN_IN_REQUIRED_MESSAGE,
  antigravityAuthLabel,
  buildAntigravityAcpSpawnInput,
  isAntigravitySignInRequiredError,
  prepareAntigravityProfile,
  resolveAntigravityInstanceDirectories,
  resolveAntigravityLocalCliDataDir,
  type AntigravityProfile,
} from "./antigravityAuthSupport.ts";

describe("Antigravity compliant local-cli process environment", () => {
  const profile: AntigravityProfile = {
    platform: "linux",
    geminiHome: "/home/developer/.gemini",
    acpDirectory: "/home/developer/.gemini/antigravity-cli",
    tempDirectory: "/t3/userdata/antigravity-tmp/abc123",
    localCli: true,
  };

  it("spawns plain `agy acp` without overriding GEMINI_HOME, BROWSER, SSH_CONNECTION, or file storage", () => {
    const baseEnv = {
      HOME: "/home/developer",
      PATH: "/usr/bin",
      AGY_ACP_FORCE_FILE_STORAGE: "1",
      agy_cli_disable_auto_update: "0",
      PYTHONUNBUFFERED: "0",
      ELECTRON_RUN_AS_NODE: "1",
      CHROME_CRASHPAD_PIPE_NAME: "\\\\.\\pipe\\crashpad_50144_ZUJNJELFHHXPBIRT",
      chrome_crashpad_pipe_name: "\\\\.\\pipe\\crashpad_stale_alias",
      CUSTOM_SETTING: "keep-this",
    };
    const original = { ...baseEnv };
    const spawn = buildAntigravityAcpSpawnInput({
      installation: { executablePath: "/usr/bin/agy" },
      profile,
      cwd: "/project",
      baseEnv,
      auth: { authMethod: "local-cli" },
    });

    expect(baseEnv).toEqual(original);
    expect(spawn).toEqual({
      command: "/usr/bin/agy",
      args: ["acp"],
      cwd: "/project",
      extendEnv: false,
      env: {
        HOME: "/home/developer",
        PATH: "/usr/bin",
        CUSTOM_SETTING: "keep-this",
        AGY_CLI_DISABLE_AUTO_UPDATE: "1",
        PYTHONUNBUFFERED: "1",
        TMPDIR: profile.tempDirectory,
      },
    });
    expect(spawn.env?.GEMINI_HOME).toBeUndefined();
    expect(spawn.env?.SSH_CONNECTION).toBeUndefined();
    expect(spawn.env?.BROWSER).toBeUndefined();
    expect(spawn.env?.AGY_ACP_FORCE_FILE_STORAGE).toBeUndefined();
    expect(spawn.env?.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(spawn.env?.CHROME_CRASHPAD_PIPE_NAME).toBeUndefined();
  });

  it("isolates TEMP and TMP to the runtime temp directory on Windows", () => {
    const windowsProfile: AntigravityProfile = {
      platform: "win32",
      geminiHome: "C:\\Users\\user\\.gemini",
      acpDirectory: "C:\\Users\\user\\.gemini\\antigravity-cli",
      tempDirectory: "C:\\state\\antigravity-tmp\\abc123",
      localCli: true,
    };
    const input = {
      installation: { executablePath: "C:\\Users\\user\\AppData\\Local\\agy\\bin\\agy.exe" },
      profile: windowsProfile,
      cwd: "C:\\project",
      baseEnv: {
        USERPROFILE: "C:\\Users\\user",
        PATH: "C:\\Windows\\system32",
        TEMP: "C:\\Users\\user\\AppData\\Local\\Temp",
      },
    };
    const shared = buildAntigravityAcpSpawnInput(input);
    expect(shared.args).toEqual(["acp"]);
    expect(shared.env?.TEMP).toBe(windowsProfile.tempDirectory);
    expect(shared.env?.TMP).toBe(windowsProfile.tempDirectory);
    expect(shared.env?.USERPROFILE).toBe("C:\\Users\\user");

    const perRun = buildAntigravityAcpSpawnInput({
      ...input,
      runtimeTempDirectory: `${windowsProfile.tempDirectory}\\run-1`,
    });
    expect(perRun.env?.TEMP).toBe(`${windowsProfile.tempDirectory}\\run-1`);
    expect(perRun.env?.TMP).toBe(`${windowsProfile.tempDirectory}\\run-1`);
  });

  it("returns the canonical local-cli auth label", () => {
    expect(antigravityAuthLabel()).toBe("Local agy CLI");
    expect(antigravityAuthLabel("local-cli")).toBe("Local agy CLI");
  });

  it.effect("resolves user-scoped local CLI data dir cleanly", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      expect(resolveAntigravityLocalCliDataDir(path, "/home/dev")).toBe(
        "/home/dev/.gemini/antigravity-cli",
      );
    }).pipe(Effect.provide(NodePath.layerPosix)),
  );

  it.effect("keeps accounts separate even when instance IDs differ only by case", () =>
    Effect.gen(function* () {
      const first = yield* resolveAntigravityInstanceDirectories(
        "/userdata",
        ProviderInstanceId.make("antigravity"),
      );
      const second = yield* resolveAntigravityInstanceDirectories(
        "/userdata",
        ProviderInstanceId.make("Antigravity"),
      );
      expect(first.profile).toBe(
        "/userdata/providers/antigravity/ac0a3dfd6dddb20962cecff6ee5fe65e19d3923be20e52c5ab52ff877f7e4c32",
      );
      expect(first.profile.toLowerCase()).not.toBe(second.profile.toLowerCase());
      expect(first.runtimeTemp.toLowerCase()).not.toBe(second.runtimeTemp.toLowerCase());
    }).pipe(Effect.provide(Layer.mergeAll(NodeCrypto.layer, NodePath.layerPosix))),
  );

  it.effect("keeps the unpacked Windows runtime under MAX_PATH for long user names", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const deepestMember =
        "google3\\cloud\\developer_experience\\antigravity_extensions\\acp_server\\_private__agy_acp_server_bin.lazy_imports_info.json";
      const directories = yield* resolveAntigravityInstanceDirectories(
        "C:\\Users\\a-twenty-char-person\\.t3\\userdata",
        ProviderInstanceId.make("antigravity"),
      );
      const extracted = (tempDirectory: string) =>
        path.join(tempDirectory, "run-AbC123", "_MEI000012ab2", deepestMember);
      expect(extracted(directories.runtimeTemp).length).toBeLessThan(260);
      expect(
        extracted(path.join(directories.profile, "antigravity-acp", "tmp")).length,
      ).toBeGreaterThanOrEqual(260);
    }).pipe(Effect.provide(Layer.mergeAll(NodeCrypto.layer, NodePath.layerWin32))),
  );
});

describe("Antigravity sign-in errors", () => {
  it("recognizes native auth-required errors and the local sign-in transport error", () => {
    expect(isAntigravitySignInRequiredError(AcpErrors.AcpRequestError.authRequired())).toBe(true);
    expect(
      isAntigravitySignInRequiredError(
        AcpErrors.AcpRequestError.internalError(
          "No browser is available here (no graphical display is available to open a browser). Run `agy acp --login` in a terminal on this machine, then retry.",
        ),
      ),
    ).toBe(true);
    expect(
      isAntigravitySignInRequiredError(
        new AcpErrors.AcpTransportError({
          detail: ANTIGRAVITY_SIGN_IN_REQUIRED_MESSAGE,
          cause: undefined,
        }),
      ),
    ).toBe(true);
  });

  it("does not treat other failures or arbitrary text as missing authentication", () => {
    const otherErrors = [
      new AcpErrors.AcpTransportError({ detail: "The process stopped.", cause: undefined }),
      AcpErrors.AcpRequestError.internalError(ANTIGRAVITY_SIGN_IN_REQUIRED_MESSAGE),
      new Error(ANTIGRAVITY_SIGN_IN_REQUIRED_MESSAGE),
      { detail: ANTIGRAVITY_SIGN_IN_REQUIRED_MESSAGE },
      ANTIGRAVITY_SIGN_IN_REQUIRED_MESSAGE,
      undefined,
    ];
    for (const error of otherErrors) expect(isAntigravitySignInRequiredError(error)).toBe(false);
  });
});

it.layer(NodeServices.layer)("Antigravity local-cli profile preparation", (it) => {
  const prepareSpawn = Effect.fn(function* (
    bundles: ReadonlyArray<string>,
    baseEnv: NodeJS.ProcessEnv = {},
    platform: NodeJS.Platform = "linux",
  ) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped();
    const profile = yield* prepareAntigravityProfile({
      profileDirectory: path.join(directory, "profile"),
      userHome: path.join(directory, "home"),
      platform,
      baseEnv,
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, {
        ...fs,
        exists: (candidate) => Effect.succeed(bundles.includes(candidate)),
      }),
    );
    return buildAntigravityAcpSpawnInput({
      installation: { executablePath: "/usr/bin/agy" },
      profile,
      cwd: directory,
      baseEnv,
    }).env;
  });

  it.effect(
    "launches Linux agents with the first available CA bundle, preferring absolute Nix paths",
    () =>
      Effect.gen(function* () {
        const systemBundles = ["/etc/pki/tls/certs/ca-bundle.crt", "/etc/ssl/cert.pem"];
        const nixBundle = "/nix/store/nss-cacert/etc/ssl/certs/ca-bundle.crt";
        expect((yield* prepareSpawn(systemBundles))?.SSL_CERT_FILE).toBe(systemBundles[0]);
        expect(
          (yield* prepareSpawn([nixBundle, ...systemBundles], { NIX_SSL_CERT_FILE: nixBundle }))
            ?.SSL_CERT_FILE,
        ).toBe(nixBundle);
        expect(
          (yield* prepareSpawn(systemBundles, { NIX_SSL_CERT_FILE: nixBundle }))?.SSL_CERT_FILE,
        ).toBe(systemBundles[0]);
        expect(
          (yield* prepareSpawn(["certs/local.pem", ...systemBundles], {
            NIX_SSL_CERT_FILE: "certs/local.pem",
          }))?.SSL_CERT_FILE,
        ).toBe(systemBundles[0]);
        expect((yield* prepareSpawn([]))?.SSL_CERT_FILE).toBeUndefined();
      }),
  );

  it.effect("preserves explicit certificate files and directories in Linux launches", () =>
    Effect.gen(function* () {
      const bundles = ["/etc/ssl/certs/ca-certificates.crt"];
      expect(
        (yield* prepareSpawn(bundles, { SSL_CERT_FILE: "/custom/ca.pem" }))?.SSL_CERT_FILE,
      ).toBe("/custom/ca.pem");
      const directoryEnv = yield* prepareSpawn(bundles, { SSL_CERT_DIR: "/custom/certs" });
      expect(directoryEnv?.SSL_CERT_DIR).toBe("/custom/certs");
      expect(directoryEnv?.SSL_CERT_FILE).toBeUndefined();
    }),
  );

  it.effect(
    "prepares only runtime temp dir and reuses user's official ~/.gemini/antigravity-cli without writing settings or token files",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped();
        const userHome = path.join(root, "home");
        const profileDirectory = path.join(root, "profile");
        const profile = yield* prepareAntigravityProfile({
          profileDirectory,
          userHome,
          platform: "win32",
          auth: { authMethod: "local-cli" },
          baseEnv: {
            USERPROFILE: userHome,
            ELECTRON_RUN_AS_NODE: "1",
            AGY_ACP_FORCE_FILE_STORAGE: "1",
            CHROME_CRASHPAD_PIPE_NAME: "\\\\.\\pipe\\stale",
            PATH: "C:\\Windows\\System32",
          },
        });
        expect(profile.localCli).toBe(true);
        expect(profile.geminiHome).toBe(path.join(userHome, ".gemini"));
        expect(profile.acpDirectory).toBe(path.join(userHome, ".gemini", "antigravity-cli"));
        expect(yield* fs.exists(profile.tempDirectory)).toBe(true);
        expect(
          yield* fs.exists(path.join(profileDirectory, "antigravity-acp", "settings.json")),
        ).toBe(false);
        expect(yield* fs.exists(path.join(userHome, ".gemini"))).toBe(false);
        if ((yield* HostProcess.Platform) !== "win32") {
          expect((yield* fs.stat(profile.tempDirectory)).mode & 0o777).toBe(0o700);
        }
      }),
  );
});
