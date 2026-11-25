import * as McpProviderSessions from "@prismux/provider-core/server/McpProviderSessions";
import {
  AntigravitySettings,
  ProviderDriverKind,
  ProviderSetupError,
  RuntimeMode,
} from "@prismux/core-contracts";
import { writeFileStringAtomically } from "@prismux/core-shared/atomicWrite";
import * as HostProcess from "@prismux/core-shared/HostProcess";
import { resolveSelfInvocation } from "@prismux/core-shared/nodeRuntime";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { HttpClient } from "effect/http";
import * as AcpErrors from "@prismux/effect-acp/errors";

import * as ProviderHost from "@prismux/provider-core/server/ProviderHost";
import {
  isAntigravityTextGenerationAvailable,
  makeAntigravityTextGeneration,
} from "../../textGeneration/AntigravityTextGeneration.ts";
import { makeAntigravityAuth, type AntigravityAuth } from "../AntigravityAuth.ts";
import * as AntigravityInstallation from "../AntigravityInstallation.ts";
import { brokenRuntimeError } from "../providerCompatibility.ts";
import * as AntigravityUsage from "./AntigravityUsage.ts";
import {
  antigravityAuthLabel,
  buildAntigravityAcpSpawnInput,
  isAntigravitySignInRequiredError,
  prepareAntigravityProfile,
  resolveAntigravityInstanceDirectories,
  type AntigravityAuthConfig,
} from "../antigravityAuthSupport.ts";
import {
  antigravityModelOptions,
  antigravitySessionMode,
  findAntigravityModelConfigOption,
  makeAntigravityAcpRuntime,
} from "../acp/AntigravityAcpSupport.ts";
import type * as AcpSessionRuntime from "@prismux/provider-acp/server/AcpSessionRuntime";
import type { ServerProviderDraft } from "@prismux/provider-core/server/snapshotProbe";
import { retireAntigravityRuntimeTempDirs } from "../acp/AntigravitySessionFiles.ts";
import * as IdAllocator from "@prismux/provider-core/server/IdAllocator";
import * as ProviderContinuationRequests from "@prismux/provider-core/server/ProviderContinuationRequests";
import {
  makeAntigravityAdapterV2,
  type AntigravityAdapterV2RuntimeInput,
} from "../../orchestration-v2/Adapters/AntigravityAdapterV2.ts";
import { makeAcpNativeLoggerFactory } from "@prismux/provider-acp/server/nativeLogging";
import { ProviderDriverError } from "../Errors.ts";
import { makeAntigravityProvider } from "../AntigravityProvider.ts";
import { makeAntigravityUsageProbe } from "../antigravityUsageLimits.ts";
import * as ProviderEventLoggers from "@prismux/provider-core/server/ProviderEventLoggers";
import * as ModelCatalog from "@prismux/provider-core/server/ModelCatalog";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "@prismux/provider-core/server/driver";
import { mergeProviderInstanceEnvironment } from "@prismux/provider-core/server/instanceEnvironment";
import { withInstanceIdentity } from "@prismux/provider-core/server/instanceIdentity";
import { discoverAntigravitySkills, resolveAntigravityUserHome } from "./AntigravitySkills.ts";

const DRIVER = ProviderDriverKind.make("antigravity");
const decodeSettings = Schema.decodeSync(AntigravitySettings);
const isAcpRequestError = Schema.is(AcpErrors.AcpRequestError);
const isProviderSetupError = Schema.is(ProviderSetupError);
const isAcpErrorDetails = Schema.is(Schema.Struct({ details: Schema.String }));
const RememberedRuntimeModes = Schema.fromJsonString(
  Schema.Struct({ authMethod: Schema.String, modes: Schema.Array(RuntimeMode) }),
);
const decodeRememberedRuntimeModes = Schema.decodeUnknownOption(RememberedRuntimeModes);
const encodeRememberedRuntimeModes = Schema.encodeSync(RememberedRuntimeModes);
const REFRESH_FAILED =
  "Could not refresh Antigravity models. The previous model list is unchanged.";
const PYTHON_SOCKS_REQUIRED = "python-socks is required to use a SOCKS proxy";

// Keep upstream diagnostics in cause; only recognized, fixed text reaches clients.
function refreshFailureDetail(cause: unknown) {
  return isAcpRequestError(cause) &&
    cause.operation === "receive-response" &&
    isAcpErrorDetails(cause.data) &&
    cause.data.details.includes(PYTHON_SOCKS_REQUIRED)
    ? `${REFRESH_FAILED} Antigravity reported: ${PYTHON_SOCKS_REQUIRED}`
    : REFRESH_FAILED;
}

export type AntigravityDriverEnv =
  | AntigravityInstallation.AntigravityInstallation
  | ProviderHost.ProviderHost
  | ChildProcessSpawner.ChildProcessSpawner
  | Digest.Digest
  | SecureRandom.SecureRandom
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | IdAllocator.IdAllocatorV2
  | McpProviderSessions.McpProviderSessions
  | ModelCatalog.ModelCatalog
  | Path.Path
  | ProviderEventLoggers.ProviderEventLoggers;

export const AntigravityDriver: ProviderDriver<
  AntigravitySettings,
  AntigravityDriverEnv,
  AntigravityUsage.AntigravityUsage
> = {
  driverKind: DRIVER,
  metadata: { displayName: "Antigravity", supportsMultipleInstances: true },
  configSchema: AntigravitySettings,
  defaultConfig: () => decodeSettings({}),
  usage: AntigravityUsage.antigravityUsageReader,
  create: Effect.fn("AntigravityDriver.create")(function* ({
    instanceId,
    displayName,
    accentColor,
    environment,
    enabled,
    config,
  }) {
    const digest = yield* Digest.Digest;
    const random = yield* SecureRandom.SecureRandom;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const host = yield* ProviderHost.ProviderHost;
    const selfInvocation = yield* resolveSelfInvocation();
    const installation = yield* AntigravityInstallation.AntigravityInstallation;
    const loggers = yield* ProviderEventLoggers.ProviderEventLoggers;
    const modelCatalog = yield* ModelCatalog.ModelCatalog;
    const currentCatalog = modelCatalog.current(DRIVER);
    const continuationRequests = yield* ProviderContinuationRequests.ProviderContinuationRequests;
    const makeNativeLogger = yield* makeAcpNativeLoggerFactory();
    const settings = { ...config, enabled } satisfies AntigravitySettings;
    const auth: AntigravityAuthConfig = {
      authMethod: "local-cli",
    };
    const processEnvironment = yield* mergeProviderInstanceEnvironment(environment);
    const hostPlatform = yield* HostProcess.Platform;
    const userHome = resolveAntigravityUserHome(
      hostPlatform,
      processEnvironment,
      yield* HostProcess.HomeDirectory,
    );
    const localGeminiHome = path.join(userHome, ".gemini");
    const directories = yield* resolveAntigravityInstanceDirectories(
      host.paths.stateDir,
      instanceId,
    ).pipe(
      Effect.provideService(Digest.Digest, digest),
      Effect.provideService(Path.Path, path),
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: DRIVER,
            instanceId,
            detail: "Could not resolve the Antigravity profile directory.",
            cause,
          }),
      ),
    );
    const profileDirectory = directories.profile;
    // Only a session reports whether agy offers Auto, so keep the last answer across restarts.
    const runtimeModesPath = path.join(profileDirectory, "t3-runtime-modes.json");
    const rememberedRuntimeModes = yield* fileSystem.readFileString(runtimeModesPath).pipe(
      Effect.map((contents) =>
        decodeRememberedRuntimeModes(contents).pipe(
          Option.filter((saved) => saved.authMethod === auth.authMethod),
          Option.map((saved) => saved.modes),
          Option.getOrUndefined,
        ),
      ),
      Effect.orElseSucceed(() => undefined),
    );
    for (const directory of [
      directories.runtimeTemp,
      path.join(profileDirectory, "antigravity-acp", "tmp"),
    ]) {
      const removeRetired = yield* retireAntigravityRuntimeTempDirs(directory).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      );
      yield* Effect.forkScoped(removeRetired);
    }
    const continuationIdentity = defaultProviderContinuationIdentity({
      driverKind: DRIVER,
      instanceId,
    });
    const stampIdentity = withInstanceIdentity({
      instanceId,
      driverKind: DRIVER,
      displayName,
      accentColor,
      continuationGroupKey: continuationIdentity.continuationKey,
    });
    const classifyModels = (draft: ServerProviderDraft) =>
      currentCatalog.pipe(
        Effect.map((catalog) => stampIdentity(ModelCatalog.applyModelCatalog(draft, catalog))),
      );

    const prepareSpawn = Effect.fn("AntigravityDriver.prepareSpawn")(function* (
      cwd: string,
      baseEnv: NodeJS.ProcessEnv,
    ): Effect.fn.Return<
      {
        readonly executable: AntigravityInstallation.AntigravityExecutable;
        readonly spawn: AcpSessionRuntime.AcpSpawnInput;
      },
      AcpErrors.AcpError | ProviderSetupError,
      Scope.Scope
    > {
      const executable = yield* installation
        .acquire(settings.binaryPath, processEnvironment, { preferPath: true })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ProviderSetupError({
                instanceId,
                operation: "resolve",
                detail: cause.detail,
                cause,
              }),
          ),
        );
      const profile = yield* prepareAntigravityProfile({
        profileDirectory,
        baseEnv: processEnvironment,
        auth,
        userHome,
        tempDirectory: directories.runtimeTemp,
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
      );
      // Use one directory per process; shared cleanup could delete files another session still reads.
      // Remove after the child dies, best-effort on Windows where handles may outlive the kill;
      // the next driver start sweeps leftovers.
      const runtimeTempDirectory = yield* Effect.acquireRelease(
        fileSystem.makeTempDirectory({ directory: profile.tempDirectory, prefix: "run-" }).pipe(
          Effect.mapError(
            (cause) =>
              new ProviderSetupError({
                instanceId,
                operation: "start",
                detail: "Could not create an Antigravity runtime temp directory.",
                cause,
              }),
          ),
        ),
        (directory) =>
          fileSystem
            .remove(directory, { recursive: true, force: true })
            .pipe(
              Effect.catch(() =>
                Effect.logWarning("Could not remove an Antigravity runtime temp directory."),
              ),
            ),
      );
      return {
        executable,
        spawn: buildAntigravityAcpSpawnInput({
          installation: executable,
          profile,
          cwd,
          baseEnv,
          auth,
          runtimeTempDirectory,
        }),
      };
    });

    const makeRuntime = Effect.fn("AntigravityDriver.makeRuntime")(function* (
      input: AntigravityAdapterV2RuntimeInput,
    ): Effect.fn.Return<
      AcpSessionRuntime.AcpSessionRuntime["Service"],
      AcpErrors.AcpError | ProviderSetupError,
      Scope.Scope
    > {
      // `buildAntigravityAcpSpawnInput` sets `extendEnv: false`, so thread variables only reach the
      // agent's shell through `baseEnv`.
      const { processEnvironment: threadEnvironment, ...runtimeInput } = input;
      const { executable, spawn } = yield* prepareSpawn(
        runtimeInput.cwd,
        threadEnvironment === undefined
          ? processEnvironment
          : { ...processEnvironment, ...threadEnvironment },
      );
      const runtime = yield* makeAntigravityAcpRuntime({
        ...runtimeInput,
        runtimeVersion: executable.version,
        childProcessSpawner: spawner,
        spawn,
      }).pipe(Effect.provideService(SecureRandom.SecureRandom, random));
      // A custom or PATH executable has no version until it answers initialize.
      const startCompatible = Effect.fn("AntigravityDriver.startCompatible")(function* () {
        const version = (yield* runtime.initialize()).agentInfo?.version;
        const advisory = version ? yield* installation.compatibility(version) : undefined;
        const refused =
          version &&
          brokenRuntimeError({
            instanceId,
            name: "Antigravity",
            version,
            advisory,
            action:
              executable.source === "managed"
                ? "Update it in Antigravity setup"
                : `Update the Antigravity executable at ${executable.executablePath}`,
          });
        if (refused) {
          return yield* new AcpErrors.AcpTransportError({ detail: refused.detail, cause: refused });
        }
        return yield* runtime.start();
      });
      return {
        ...runtime,
        setMode: (modeId: string) =>
          runtime.getModeState.pipe(
            Effect.flatMap((modeState) =>
              runtime.setMode(antigravitySessionMode(modeId, modeState)),
            ),
          ),
        start: () =>
          startCompatible().pipe(
            Effect.tapError((cause): Effect.Effect<void> =>
              isAntigravitySignInRequiredError(cause) ? provider.onAuthRequired : Effect.void,
            ),
          ),
      };
    });

    const makeDisposableRuntime = Effect.fn("AntigravityDriver.makeDisposableRuntime")(
      function* () {
        const cwd = yield* fileSystem
          .makeTempDirectoryScoped({ prefix: "t3-antigravity-setup-" })
          .pipe(
            Effect.mapError(
              () =>
                new ProviderSetupError({
                  instanceId,
                  operation: "start",
                  detail: "Could not create an Antigravity setup workspace.",
                }),
            ),
          );
        let sessionId: string | undefined;
        const runtime = yield* makeRuntime({
          cwd,
          mcpServers: [],
        });
        yield* Effect.addFinalizer(() =>
          sessionId
            ? runtime.deleteSession(sessionId).pipe(Effect.timeoutOption("5 seconds"), Effect.ignore)
            : Effect.void,
        );
        return {
          ...runtime,
          start: () =>
            runtime.start().pipe(
              Effect.tap((started) =>
                Effect.sync(() => {
                  sessionId = started.sessionId;
                }),
              ),
            ),
        };
      },
    );

    const publishCatalog = Effect.fn("AntigravityDriver.publishCatalog")(function* (
      started: AcpSessionRuntime.AcpSessionRuntimeStartResult,
      runtime: Pick<
        AcpSessionRuntime.AcpSessionRuntime["Service"],
        "getEvents" | "drainEvents" | "getConfigOptions" | "setModel"
      >,
    ): Effect.fn.Return<void, never, Scope.Scope> {
      yield* provider.onSessionStarted(started);
      yield* authFlow.onSignedInElsewhere;
      yield* Stream.runForEach(runtime.getEvents(), (event) => {
        if (event._tag === "EventStreamBarrier") {
          return Deferred.succeed(event.acknowledge, undefined).pipe(Effect.asVoid);
        }
        if (event._tag === "ConfigOptionsUpdated") {
          return provider.onConfigOptionsUpdated(event.configOptions);
        }
        return event._tag === "AvailableCommandsUpdated"
          ? provider.onAvailableCommands(event.availableCommands)
          : Effect.void;
      }).pipe(Effect.forkScoped);
      // Thinking levels differ per model and are reported only for the selected one.
      // Probe every advertised model even if the initial default model has no thought_level option.
      const configOptions = started.sessionSetupResult.configOptions ?? [];
      const modelOption = findAntigravityModelConfigOption(configOptions);
      const current = modelOption?.currentValue;
      const allModels = antigravityModelOptions(configOptions);
      if (typeof current === "string" && allModels.length > 1) {
        let switched = false;
        for (const model of allModels) {
          if (model.value === current) continue;
          const switchedModel = yield* runtime.setModel(model.value).pipe(
            Effect.timeoutOption("5 seconds"),
            Effect.map(Option.isSome),
            Effect.orElseSucceed(() => false),
          );
          if (switchedModel) {
            switched = true;
            yield* provider.onConfigOptionsUpdated(yield* runtime.getConfigOptions);
          }
        }
        if (switched) {
          yield* runtime.setModel(current).pipe(Effect.timeoutOption("5 seconds"), Effect.ignore);
          yield* provider.onConfigOptionsUpdated(yield* runtime.getConfigOptions);
        }
      }
      yield* runtime.drainEvents;
    }, Effect.scoped);

    const authFlow: AntigravityAuth = yield* makeAntigravityAuth({
      instanceId,
      makeRuntime: makeDisposableRuntime,
      onAuthenticated: (started, runtime) =>
        Effect.suspend(() => provider.onSignedIn).pipe(
          Effect.andThen(publishCatalog(started, runtime)),
        ),
      onSignedOut: Effect.suspend(() => provider.onSignedOut),
    });

    // The probe must not spawn. The agent is a PyInstaller one-file bundle
    // that unpacks about 1 GB per launch, and the health check runs every
    // minute.
    const probe = Effect.gen(function* () {
      yield* modelCatalog.refreshInBackground;
      const executable = yield* installation
        .resolve(settings.binaryPath, processEnvironment, { preferPath: true })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ProviderSetupError({
                instanceId,
                operation: "resolve",
                detail: cause.detail,
                cause,
              }),
          ),
        );
      return {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: { image: true, audio: true, embeddedContext: true },
          sessionCapabilities: { list: {}, resume: {} },
        },
        authMethods: [],
        agentInfo: {
          name: "antigravity-acp",
          title: "Google Antigravity",
          version: executable.version ?? "unknown",
        },
      };
    });

    const usage = yield* makeAntigravityUsageProbe({
      profileDirectory,
      userHome,
      authMethod: auth.authMethod,
    });
    const provider = yield* makeAntigravityProvider(settings, {
      environment: processEnvironment,
      stampIdentity: classifyModels,
      probe,
      probeUsage: usage.probe,
      clearUsage: usage.clear,
      hydrateCatalog: Effect.suspend(
        (): Effect.Effect<void> => refreshModels().pipe(Effect.ignore),
      ),
      auth: { type: auth.authMethod, label: antigravityAuthLabel(auth.authMethod) },
      ...(rememberedRuntimeModes ? { rememberedRuntimeModes } : {}),
      rememberRuntimeModes: (modes) =>
        writeFileStringAtomically({
          filePath: runtimeModesPath,
          contents: encodeRememberedRuntimeModes({ authMethod: auth.authMethod, modes }),
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
          Effect.catch(() => Effect.logWarning("Could not save Antigravity permission modes.")),
        ),
      supportsTextGeneration: isAntigravityTextGenerationAvailable(localGeminiHome).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.orElseSucceed(() => false),
      ),
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: DRIVER,
            instanceId,
            detail: "Could not prepare the Antigravity provider status.",
            cause,
          }),
      ),
    );
    const defaultModel = currentCatalog.pipe(Effect.map((catalog) => catalog?.defaultChatModel));
    const orchestrationAdapter = yield* makeAntigravityAdapterV2({
      instanceId,
      selfInvocation,
      makeRuntime,
      withProcess: authFlow.withProcess,
      defaultModel,
      supportsNativeGoals: provider.snapshot.getSnapshot.pipe(
        Effect.map(
          (snapshot) => snapshot.slashCommands?.some((command) => command.name === "goal") === true,
        ),
      ),
      onSessionStarted: (started, cwd) =>
        provider.onSessionStarted(started, cwd).pipe(Effect.andThen(authFlow.onSignedInElsewhere)),
      onSessionEvent: (event, cwd) => {
        if (event._tag === "ConfigOptionsUpdated") {
          return provider.onConfigOptionsUpdated(event.configOptions);
        }
        return event._tag === "AvailableCommandsUpdated"
          ? provider.onAvailableCommands(event.availableCommands, cwd)
          : Effect.void;
      },
      continuationRequests,
      nativeLogging: (threadId) =>
        makeNativeLogger({
          nativeEventLogger: loggers.native,
          provider: DRIVER,
          threadId,
        }),
    });
    const textGeneration = yield* makeAntigravityTextGeneration({
      profileDirectory: localGeminiHome,
      defaultModel,
      withProcess: authFlow.withProcess,
      makeRuntime: (cwd) =>
        makeRuntime({
          cwd,
          mcpServers: [],
        }),
    });

    const refreshModels = Effect.fn("AntigravityDriver.refreshModels")(
      function* () {
        const processScope = yield* Scope.make();
        yield* Effect.addFinalizer((exit) => Scope.close(processScope, exit));
        yield* authFlow
          .withProcess(
            Scope.close(processScope, Exit.void),
            Effect.gen(function* () {
              const runtime = yield* makeDisposableRuntime();
              const started = yield* runtime.start();
              yield* publishCatalog(started, runtime);
            }),
          )
          .pipe(Effect.provideService(Scope.Scope, processScope));
      },
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: "90 seconds",
        orElse: () =>
          Effect.fail(
            new ProviderDriverError({
              driver: DRIVER,
              instanceId,
              detail:
                "Antigravity model refresh timed out. Try again or check your local agy CLI sign-in.",
            }),
          ),
      }),
      Effect.tapError((cause) =>
        isAntigravitySignInRequiredError(cause) ? provider.onAuthRequired : Effect.void,
      ),
      Effect.mapError((cause) =>
        cause._tag === "ProviderDriverError"
          ? cause
          : new ProviderDriverError({
              driver: DRIVER,
              instanceId,
              detail: isAntigravitySignInRequiredError(cause)
                ? "Local agy CLI is not signed in. Run 'agy' or 'agy acp --login' in a terminal, then refresh models."
                : cause._tag === "ProviderSetupError" &&
                    (cause.operation === "configure" || cause.operation === "start")
                  ? cause.detail
                  : cause._tag === "AcpTransportError" &&
                      isProviderSetupError(cause.cause) &&
                      cause.cause.operation === "runtime"
                    ? cause.cause.detail
                    : refreshFailureDetail(cause),
              cause,
            }),
      ),
    );

    return {
      instanceId,
      driverKind: DRIVER,
      continuationIdentity,
      displayName,
      accentColor,
      enabled,
      snapshot: provider.snapshot,
      snapshotForCwd: (cwd) =>
        !enabled
          ? provider.snapshot.getSnapshot
          : discoverAntigravitySkills({
              cwd,
              userHome,
              profileDirectory: localGeminiHome,
            }).pipe(
              Effect.provideService(FileSystem.FileSystem, fileSystem),
              Effect.provideService(Path.Path, path),
              Effect.flatMap((skills) => provider.snapshotForCwd(cwd, skills)),
              Effect.mapError(
                (cause) =>
                  new ProviderDriverError({
                    driver: DRIVER,
                    instanceId,
                    detail: "Could not read Antigravity workspace skills.",
                    cause,
                  }),
              ),
            ),
      orchestrationAdapter,
      textGeneration,
      auth: authFlow.controller,
      refreshModels,
    } satisfies ProviderInstance;
  }),
};
