import type { AntigravityAuthMethod, ProviderInstanceId } from "@prismux/core-contracts";
import * as HostProcess from "@prismux/core-shared/HostProcess";
import * as Digest from "effect/crypto/Digest";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as AcpErrors from "@prismux/effect-acp/errors";

import type * as AcpSessionRuntime from "@prismux/provider-acp/server/AcpSessionRuntime";
import { resolveAntigravityUserHome } from "./Drivers/AntigravitySkills.ts";

export const ANTIGRAVITY_SIGN_IN_REQUIRED_MESSAGE =
  "Local agy CLI is not signed in. Run 'agy' or 'agy acp --login' in a terminal, then reconnect.";

const isAcpRequestError = Schema.is(AcpErrors.AcpRequestError);
const isAcpTransportError = Schema.is(AcpErrors.AcpTransportError);

const localCliRemovedEnvironmentKeys = new Set([
  "AGY_ACP_FORCE_FILE_STORAGE",
  "AGY_CLI_DISABLE_AUTO_UPDATE",
  "PYTHONUNBUFFERED",
  "ELECTRON_RUN_AS_NODE",
  // An inherited pipe whose owner exited makes Electron-as-Node print Crashpad errors to stderr.
  "CHROME_CRASHPAD_PIPE_NAME",
]);

export interface AntigravityProfile {
  readonly platform: NodeJS.Platform;
  readonly geminiHome: string;
  readonly acpDirectory: string;
  readonly tempDirectory: string;
  readonly caBundlePath?: string;
  readonly localCli: true;
}

export interface AntigravityAuthConfig {
  readonly authMethod: AntigravityAuthMethod;
}

export function antigravityAuthLabel(_authMethod: AntigravityAuthMethod = "local-cli"): string {
  return "Local agy CLI";
}

export function resolveAntigravityLocalCliDataDir(path: Path.Path, userHome: string): string {
  return path.join(userHome, ".gemini", "antigravity-cli");
}

function authSupportError(detail: string) {
  return new AcpErrors.AcpTransportError({ detail, cause: undefined });
}

// The 1.5 CLI answers with this internal error when it has no sign-in and no display.
const NATIVE_CLI_NO_BROWSER_PREFIX = "No browser is available here";

export function isAntigravitySignInRequiredError(error: unknown): boolean {
  return (
    (isAcpRequestError(error) &&
      (error.code === -32000 ||
        (error.code === -32603 && error.errorMessage.startsWith(NATIVE_CLI_NO_BROWSER_PREFIX)))) ||
    (isAcpTransportError(error) && error.detail === ANTIGRAVITY_SIGN_IN_REQUIRED_MESSAGE)
  );
}

export interface AntigravityInstanceDirectories {
  readonly profile: string;
  /** Keep beside the profile: 120-character archive members under its longer name would exceed Windows' 260-character limit. */
  readonly runtimeTemp: string;
}

/** Hashes the instance ID so case-only differences stay separate on case-insensitive filesystems. */
export const resolveAntigravityInstanceDirectories = Effect.fn(
  "resolveAntigravityInstanceDirectories",
)(function* (stateDir: string, instanceId: ProviderInstanceId) {
  const digest = yield* Digest.Digest;
  const path = yield* Path.Path;
  const key = Hex.encode(yield* digest.digest(Digest.sha256, new TextEncoder().encode(instanceId)));
  return {
    profile: path.join(stateDir, "providers", "antigravity", key),
    runtimeTemp: path.join(stateDir, "antigravity-tmp", key.slice(0, 12)),
  } satisfies AntigravityInstanceDirectories;
});

function antigravityEnvironment(
  profile: AntigravityProfile,
  baseEnv: NodeJS.ProcessEnv,
  runtimeTempDirectory?: string,
) {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (!localCliRemovedEnvironmentKeys.has(key.toUpperCase())) environment[key] = value;
  }
  const tempDirectory = runtimeTempDirectory ?? profile.tempDirectory;
  return {
    ...environment,
    ...(profile.caBundlePath !== undefined &&
    baseEnv.SSL_CERT_FILE === undefined &&
    baseEnv.SSL_CERT_DIR === undefined
      ? { SSL_CERT_FILE: profile.caBundlePath }
      : {}),
    AGY_CLI_DISABLE_AUTO_UPDATE: "1",
    PYTHONUNBUFFERED: "1",
    ...(tempDirectory
      ? profile.platform === "win32"
        ? { TEMP: tempDirectory, TMP: tempDirectory }
        : { TMPDIR: tempDirectory }
      : {}),
  };
}

/**
 * Prepares the official local `agy` CLI runtime environment.
 *
 * Strictly compliant: reuses the user's own official `agy` CLI session (`~/.gemini/antigravity-cli`)
 * over stdio ACP without overriding `GEMINI_HOME`, spoofing `SSH_CONNECTION` or `BROWSER`,
 * forcing file token storage, or reading private credentials.
 */
export const prepareAntigravityProfile = Effect.fn("prepareAntigravityProfile")(function* (input: {
  readonly profileDirectory: string;
  readonly baseEnv?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly auth?: AntigravityAuthConfig;
  readonly userHome?: string;
  readonly tempDirectory?: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = input.platform ?? (yield* HostProcess.Platform);
  const userHome =
    input.userHome ??
    resolveAntigravityUserHome(
      platform,
      input.baseEnv ?? process.env,
      yield* HostProcess.HomeDirectory,
    );

  let caBundlePath: string | undefined;
  if (platform === "linux") {
    // Bundled Python may look for certificates at paths absent on this distribution.
    // Relative paths would resolve differently when the agent runs in the project directory.
    for (const candidate of [
      (input.baseEnv ?? process.env).NIX_SSL_CERT_FILE,
      "/etc/ssl/certs/ca-bundle.crt",
      "/etc/ssl/certs/ca-certificates.crt",
      "/etc/pki/tls/certs/ca-bundle.crt",
      "/etc/ssl/cert.pem",
    ]) {
      if (
        candidate &&
        path.isAbsolute(candidate) &&
        (yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false)))
      ) {
        caBundlePath = candidate;
        break;
      }
    }
  }

  const geminiHome = path.join(userHome, ".gemini");
  const acpDirectory = resolveAntigravityLocalCliDataDir(path, userHome);
  const tempDirectory =
    input.tempDirectory ?? path.join(path.resolve(input.profileDirectory), "tmp");
  yield* fs
    .makeDirectory(tempDirectory, { recursive: true, mode: 0o700 })
    .pipe(
      Effect.mapError(() =>
        authSupportError("The Antigravity runtime temp directory could not be created."),
      ),
    );
  if (platform !== "win32") {
    yield* fs
      .chmod(tempDirectory, 0o700)
      .pipe(
        Effect.mapError(() =>
          authSupportError("The Antigravity runtime temp directory permissions could not be set."),
        ),
      );
  }
  return {
    platform,
    geminiHome,
    acpDirectory,
    tempDirectory,
    localCli: true,
    ...(caBundlePath === undefined ? {} : { caBundlePath }),
  } satisfies AntigravityProfile;
});

export function buildAntigravityAcpSpawnInput(input: {
  readonly installation: { readonly executablePath: string };
  readonly profile: AntigravityProfile;
  readonly cwd: string;
  readonly baseEnv?: NodeJS.ProcessEnv;
  readonly auth?: AntigravityAuthConfig;
  readonly runtimeTempDirectory?: string;
}): AcpSessionRuntime.AcpSpawnInput {
  return {
    command: input.installation.executablePath,
    args: ["acp"],
    cwd: input.cwd,
    env: antigravityEnvironment(
      input.profile,
      input.baseEnv ?? process.env,
      input.runtimeTempDirectory,
    ),
    extendEnv: false,
  };
}
