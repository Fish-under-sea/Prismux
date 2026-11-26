import {
  officialAcpRegistryIconUrlForAgentId,
  ProviderDriverKind,
  resolveOfficialAcpRegistryIconUrl,
  TextGenerationError,
  type AcpRegistryOperationError,
  type AcpRegistryProbeModel,
  type CustomModelSetting,
  type ServerProvider,
  type ServerProviderModel,
} from "@prismux/core-contracts";
import { AcpRegistrySettings } from "../settings.ts";
import * as HostProcess from "@prismux/core-shared/HostProcess";
import { createModelCapabilities } from "@prismux/core-shared/model";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { AcpRequestError } from "@prismux/effect-acp/errors";
import * as AcpSessionRuntime from "@prismux/provider-acp/server/AcpSessionRuntime";
import {
  collectSessionConfigOptionValues,
  findModelConfigOption,
} from "@prismux/provider-acp/server/runtimeModel";

import * as ProviderHost from "@prismux/provider-core/server/ProviderHost";
import { AcpRegistryAdapterV2Driver, type AcpRegistryAdapterV2DriverEnv } from "./adapter.ts";
import type { ProviderTextGeneration } from "@prismux/provider-core/server/textGeneration";
import * as TextGenerationOperations from "@prismux/provider-core/server/textGenerationOperations";
import { ProviderDriverError } from "@prismux/provider-core/server/errors";
import { makeManagedServerProvider } from "@prismux/provider-core/server/managedProvider";
import { mergeProviderInstanceEnvironment } from "@prismux/provider-core/server/instanceEnvironment";
import {
  defaultProviderContinuationIdentity,
  type ProviderDriver,
  type ProviderInstance,
} from "@prismux/provider-core/server/driver";
import type { ProviderUsageReader } from "@prismux/provider-core/server/usage";
import {
  providerModelsFromSettings,
  providerProbeEnvironment,
} from "@prismux/provider-core/server/snapshotProbe";
import { makeManualOnlyProviderMaintenanceCapabilities } from "@prismux/provider-core/server/maintenanceResolver";
import {
  haveProviderSnapshotSettingsChanged,
  makeProviderSnapshotSettingsSource,
  type ProviderSnapshotSettings,
} from "@prismux/provider-core/server/snapshotSettings";
import {
  type AcpRegistryAvailableCommands,
  type AcpRegistryConfigurationProbe,
  type AcpRegistryConfigurationProbeResult,
  type AcpRegistryLiveConfiguration,
  deleteAcpRegistrySession,
  disableAcpRegistryProvider,
  isolateDeepSeekProbeHistory,
  listAcpRegistrySessions,
  listAcpRegistryProviders,
  logoutAcpRegistry,
  probeAcpRegistryConfiguration,
  sanitizeAcpOptionDescriptors,
  sanitizeAcpReasoningDescriptor,
  setAcpRegistryProvider,
} from "./probe.ts";
import * as AcpRegistrySupport from "./AcpRegistrySupport.ts";
import * as AcpRegistryRuntimeCoordinator from "./AcpRegistryRuntimeCoordinator.ts";
import * as AcpRegistryAuth from "./auth.ts";
import * as AcpRegistryAuthenticationState from "./authenticationState.ts";
import { isDeepSeekHarnessSettings } from "./dshAcp.ts";
import {
  isPlaceholderDshVersion,
  resolveDshInstalledVersion,
  resolvePackagedDshDesktopSpawn,
  selectPreferredDshVersion,
} from "./dshLocal.ts";
import { augmentDshAvailableCommands } from "./dshSkills.ts";
import {
  dshRateModel,
  makeDshUsageFileCache,
  resolveDshHomeDir,
  scanDshUsageFiles,
} from "./dshSessionUsage.ts";

const DRIVER_KIND = ProviderDriverKind.make("acpRegistry");
const decodeSettings = Schema.decodeSync(AcpRegistrySettings);
// Cache only successful authenticated probes so sign-in changes remain visible.
const PROBE_SUCCESS_TTL_MS = 15 * 60 * 1_000;
const PROBE_PROVISIONAL_TTL_MS = 30 * 1_000;

function acpRegistryProbeTtlMs(provider: ServerProvider): number {
  const discoveredModels = provider.models.filter((model) => !model.isCustom);
  return discoveredModels.length <= 1 ? PROBE_PROVISIONAL_TTL_MS : PROBE_SUCCESS_TTL_MS;
}

interface AcpRegistryEnrichmentCache {
  readonly generation: number;
  readonly entry: {
    readonly provider: ServerProvider;
    readonly expiresAt: number;
  } | null;
}

export function isAcpRegistryCacheValid(
  entry: NonNullable<AcpRegistryEnrichmentCache["entry"]>,
  inspectedVersion: string | null,
  local: boolean,
  now: number,
): boolean {
  return (
    entry.expiresAt > now &&
    ((local && inspectedVersion === null) || entry.provider.version === inspectedVersion)
  );
}

export function updateAcpRegistryEnrichmentCache(input: {
  readonly cache: AcpRegistryEnrichmentCache;
  readonly configuration: AcpRegistryLiveConfiguration;
  readonly customModels: ReadonlyArray<CustomModelSetting>;
  readonly now: number;
}): AcpRegistryEnrichmentCache {
  const { cache, configuration, customModels, now } = input;
  if (cache.entry === null) {
    // No probe has landed yet, but the live session published its
    // configuration to the snapshot. Advance the cache epoch so a probe that
    // was still in flight cannot overwrite that newer state when it lands.
    return { ...cache, generation: cache.generation + 1 };
  }
  const provider = applyAcpRegistryLiveConfiguration(
    cache.entry.provider,
    configuration,
    customModels,
  );
  if (Equal.equals(provider, cache.entry.provider)) return cache;
  return {
    ...cache,
    // The live session advanced the provider past what an in-flight probe
    // started from; bump the epoch so the probe discards its stale result
    // instead of overwriting this entry and publishing it.
    generation: cache.generation + 1,
    entry: {
      ...cache.entry,
      provider,
      expiresAt: now + acpRegistryProbeTtlMs(provider),
    },
  };
}
const EMPTY_CAPABILITIES = createModelCapabilities({ optionDescriptors: [] });
const MAINTENANCE = makeManualOnlyProviderMaintenanceCapabilities({
  provider: DRIVER_KIND,
  packageName: null,
});

const ACP_TEXT_GENERATION_TIMEOUT_MS = 180_000;
const ACP_TEXT_GENERATION_MAX_OUTPUT_CHARS = 128_000;
const ACP_TEXT_GENERATION_SESSION_CLEANUP_TIMEOUT = "5 seconds";
const isTextGenerationError = Schema.is(TextGenerationError);

function isAntigravityAcpSettings(settings: AcpRegistrySettings): boolean {
  if (settings.source === "local") {
    const base = settings.commandPath.trim().split(/[\\/]/u).at(-1) ?? "";
    return /^agy(?:\.exe|\.cmd)?$/iu.test(base);
  }
  const agentId = settings.agentId.trim().toLowerCase();
  return agentId === "antigravity-acp" || agentId === "antigravity" || agentId === "agy";
}

function resolvePrismuxWaiverPath(
  pathService: Path.Path,
  homeDirectory: string,
  environment: NodeJS.ProcessEnv,
): string {
  const overrideDataDir = environment.PRISMUX_DATA_DIR?.trim();
  const dataDir =
    overrideDataDir && overrideDataDir.length > 0
      ? overrideDataDir
      : pathService.join(homeDirectory, ".prismux");
  return pathService.join(dataDir, "config", "subscription-waiver.json");
}

function readAntigravityWaiverSignedEffect(
  fileSystem: FileSystem.FileSystem,
  waiverPath: string,
): Effect.Effect<boolean> {
  return fileSystem.readFileString(waiverPath).pipe(
    Effect.map((raw) => {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          return false;
        }
        const record = parsed as Record<string, unknown>;
        return (
          record.signed === true && record.allowAntigravityAsControlledAgent === true
        );
      } catch {
        return false;
      }
    }),
    Effect.orElseSucceed(() => false),
  );
}

const makeAcpRegistryTextGeneration = (input: {
  readonly settings: AcpRegistrySettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly providerLabel: string;
  readonly isDsh: boolean;
  readonly isAntigravityAcp: boolean;
  readonly isAntigravityWaiverSigned: Effect.Effect<boolean>;
  readonly catalog: AcpRegistrySupport.AcpRegistryCatalog["Service"];
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly random: SecureRandom.SecureRandom["Service"];
}): ProviderTextGeneration => {
  const {
    settings,
    environment,
    providerLabel,
    isDsh,
    isAntigravityAcp,
    isAntigravityWaiverSigned,
    catalog,
    fileSystem,
    path,
    spawner,
    random,
  } = input;

  const runAcpJson: TextGenerationOperations.Runner = Effect.fn("AcpRegistryTextGeneration.runJson")(
    function* <S extends Schema.Top>(request: TextGenerationOperations.Request<S>) {
      const { operation } = request;
      if (isAntigravityAcp && !(yield* isAntigravityWaiverSigned)) {
        return yield* new TextGenerationError({
          operation,
          detail:
            "Antigravity automated text generation is locked by default (ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED). Sign the Subscription Risk Waiver and enable controlled Antigravity mode in Settings → Providers (/settings/providers#subscription-risk-waiver), or choose another text generation model.",
        });
      }

      const helperCwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "prismux-acp-text-" });
      const resolved = yield* catalog.resolve(settings, helperCwd, environment);
      const spawn = isDsh
        ? yield* isolateDeepSeekProbeHistory(settings.commandPath, resolved.spawn)
        : resolved.spawn;

      const runtimeContext = yield* Layer.build(
        AcpSessionRuntime.layer({
          spawn,
          cwd: helperCwd,
          clientCapabilities: {
            auth: { terminal: false },
            elicitation: {},
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
          clientInfo: { name: "prismux-text-generation", version: "0.0.0" },
          mcpServers: [],
          authenticateOnAuthRequired: false,
          ...(settings.authMethodId ? { authMethodId: settings.authMethodId } : {}),
        }).pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner),
              Layer.succeed(SecureRandom.SecureRandom, random),
            ),
          ),
        ),
      );
      const runtime = yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
        Effect.provide(runtimeContext),
      );

      yield* runtime.getEvents().pipe(
        Stream.runForEach((event) =>
          event._tag === "EventStreamBarrier"
            ? Deferred.succeed(event.acknowledge, undefined).pipe(Effect.asVoid)
            : Effect.void,
        ),
        Effect.forkScoped,
      );

      const output = yield* Ref.make("");
      const rejected = yield* Deferred.make<never, TextGenerationError>();
      let sessionId: string | undefined;

      const reject = (detail: string) =>
        Deferred.fail(rejected, new TextGenerationError({ operation, detail })).pipe(Effect.asVoid);
      const rejectToolRequest = () =>
        reject(`${providerLabel} text generation requested a tool or user input.`).pipe(
          Effect.andThen(
            Effect.fail(
              new AcpRequestError({
                code: -32601,
                errorMessage: "Tools and user input are disabled for text generation.",
              }),
            ),
          ),
        );

      yield* runtime.handleRequestPermission(() =>
        reject(`${providerLabel} text generation requested a tool permission or user input.`).pipe(
          Effect.as({ outcome: { outcome: "cancelled" as const } }),
        ),
      );
      yield* runtime.handleElicitation(() =>
        reject(`${providerLabel} text generation requested user input.`).pipe(
          Effect.as({ action: "decline" as const }),
        ),
      );
      yield* runtime.handleReadTextFile(rejectToolRequest);
      yield* runtime.handleWriteTextFile(rejectToolRequest);
      yield* runtime.handleCreateTerminal(rejectToolRequest);
      yield* runtime.handleTerminalOutput(rejectToolRequest);
      yield* runtime.handleTerminalWaitForExit(rejectToolRequest);
      yield* runtime.handleTerminalKill(rejectToolRequest);
      yield* runtime.handleTerminalRelease(rejectToolRequest);
      yield* runtime.handleUnknownExtRequest(rejectToolRequest);
      yield* runtime.handleSessionUpdate((notification) =>
        Effect.gen(function* () {
          const update = notification.update;
          if (
            update.sessionUpdate === "tool_call" ||
            update.sessionUpdate === "tool_call_update"
          ) {
            return yield* reject(`${providerLabel} attempted tool work during text generation.`);
          }
          if (
            (sessionId !== undefined && notification.sessionId !== sessionId) ||
            update.sessionUpdate !== "agent_message_chunk" ||
            update.content.type !== "text"
          ) {
            return;
          }
          const text = update.content.text;
          const exceeded = yield* Ref.modify(output, (current) =>
            current.length + text.length > ACP_TEXT_GENERATION_MAX_OUTPUT_CHARS
              ? [true, current]
              : [false, current + text],
          );
          if (exceeded) {
            return yield* reject(`${providerLabel} text generation exceeded the output limit.`);
          }
        }),
      );

      const rawResult = yield* Effect.gen(function* () {
        const started = yield* runtime.start();
        sessionId = started.sessionId;
        yield* Effect.addFinalizer(() => {
          const caps = started.initializeResult.agentCapabilities?.sessionCapabilities;
          const cleanup =
            caps?.delete != null
              ? runtime.deleteSession(started.sessionId)
              : caps?.close != null
                ? runtime.closeSession(started.sessionId)
                : Effect.void;
          return cleanup.pipe(
            Effect.timeoutOption(ACP_TEXT_GENERATION_SESSION_CLEANUP_TIMEOUT),
            Effect.ignore,
          );
        });

        const initialOptions = yield* runtime.getConfigOptions;
        const modelOption = findModelConfigOption(initialOptions);
        const currentModel =
          modelOption?.type === "select"
            ? modelOption.currentValue
            : started.sessionSetupResult.models?.currentModelId;
        const requestedModel = request.modelSelection.model.trim();
        if (
          requestedModel.length > 0 &&
          requestedModel !== "default" &&
          requestedModel !== currentModel
        ) {
          yield* runtime.setModel(requestedModel).pipe(
            Effect.mapError(
              (cause) =>
                new TextGenerationError({
                  operation,
                  detail: `Could not select the ${providerLabel} model for text generation.`,
                  cause,
                }),
            ),
          );
        }

        const savedOptions = request.modelSelection.options;
        if (savedOptions?.length) {
          const latestOptions = yield* runtime.getConfigOptions;
          for (const saved of savedOptions) {
            if (typeof saved.value !== "string") continue;
            const descriptor = latestOptions.find(
              (option) =>
                option.id === saved.id &&
                option.type === "select" &&
                option.category !== "model" &&
                option.id !== "model",
            );
            if (
              descriptor?.type === "select" &&
              saved.value !== descriptor.currentValue &&
              collectSessionConfigOptionValues(descriptor).includes(saved.value)
            ) {
              yield* runtime.setConfigOption(descriptor.id, saved.value).pipe(
                Effect.catchTags({
                  AcpRequestError: (error) =>
                    error.code === -32602
                      ? Effect.logDebug(`${providerLabel} rejected saved text generation option`, {
                          optionId: descriptor.id,
                          value: saved.value,
                        })
                      : Effect.fail(error),
                }),
              );
            }
          }
        }

        const result = yield* runtime.prompt({
          prompt: [
            {
              type: "text",
              text: [
                "Use only the input below. Do not use tools, read or write files, run commands, or ask questions.",
                "Return only the requested JSON object.",
                "",
                request.prompt,
              ].join("\n"),
            },
          ],
        });
        if (yield* Deferred.isDone(rejected)) {
          return yield* Deferred.await(rejected);
        }
        if (result.stopReason === "cancelled") {
          return yield* new TextGenerationError({
            operation,
            detail: `${providerLabel} text generation was cancelled.`,
          });
        }
        return (yield* Ref.get(output)).trim();
      }).pipe(
        Effect.onInterrupt(() => runtime.cancel.pipe(Effect.timeoutOption(2_000), Effect.ignore)),
        Effect.raceFirst(Deferred.await(rejected)),
      );

      if (!rawResult) {
        return yield* new TextGenerationError({
          operation,
          detail: `${providerLabel} returned empty text generation output.`,
        });
      }
      return yield* TextGenerationOperations.decodeJsonReply(request, providerLabel, rawResult);
    },
    (effect, request) =>
      effect.pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.scoped,
        Effect.timeoutOption(ACP_TEXT_GENERATION_TIMEOUT_MS),
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(
                new TextGenerationError({
                  operation: request.operation,
                  detail: `${providerLabel} text generation timed out.`,
                }),
              ),
            onSome: Effect.succeed,
          }),
        ),
        Effect.mapError((cause) =>
          isTextGenerationError(cause)
            ? cause
            : new TextGenerationError({
                operation: request.operation,
                detail: `${providerLabel} text generation failed.`,
                cause,
              }),
        ),
      ),
  );

  return TextGenerationOperations.fromRunner(
    "AcpRegistryTextGeneration",
    TextGenerationOperations.withoutInvestigation(providerLabel, runAcpJson),
  );
};

function modelsFromDiscovery(
  discovery:
    | Pick<
        AcpRegistryLiveConfiguration,
        "models" | "currentModelId" | "configOptions" | "modelOptionIds"
      >
    | undefined,
  customModels: ReadonlyArray<CustomModelSetting>,
  previousModels: ReadonlyArray<ServerProviderModel> = [],
): ReadonlyArray<ServerProviderModel> {
  const discovered = discovery?.models ?? [];
  const sanitizedConfigOptions = sanitizeAcpOptionDescriptors(discovery?.configOptions ?? []);
  const capabilities =
    discovery === undefined || sanitizedConfigOptions.length === 0
      ? EMPTY_CAPABILITIES
      : createModelCapabilities({ optionDescriptors: sanitizedConfigOptions });
  // Model-specific options describe only the session's current model; other
  // models keep the shared ones plus what an earlier session reported for them.
  const modelOptionIds = new Set(discovery?.modelOptionIds ?? []);
  const shared = sanitizedConfigOptions.filter((descriptor) => !modelOptionIds.has(descriptor.id));
  const sharedIds = new Set(shared.map((descriptor) => descriptor.id));
  const capabilitiesFor = ({ id: slug, reasoningEffort }: AcpRegistryProbeModel) => {
    if (slug === discovery?.currentModelId) return capabilities;
    const sanitizedReasoningEffort =
      reasoningEffort != null ? sanitizeAcpReasoningDescriptor(reasoningEffort) : reasoningEffort;
    // The levels a model advertises replace the ones an earlier session reported.
    const own = sanitizeAcpOptionDescriptors(
      previousModels.find((model) => model.slug === slug)?.capabilities?.optionDescriptors ?? [],
    ).filter(
      (descriptor) =>
        !sharedIds.has(descriptor.id) &&
        (sanitizedReasoningEffort === undefined ||
          descriptor.type !== "select" ||
          descriptor.role !== "reasoning"),
    );
    const optionDescriptors = [
      ...shared,
      ...own,
      ...(sanitizedReasoningEffort ? [sanitizedReasoningEffort] : []),
    ];
    return optionDescriptors.length === 0
      ? EMPTY_CAPABILITIES
      : createModelCapabilities({ optionDescriptors });
  };
  const builtInModels: ReadonlyArray<ServerProviderModel> =
    discovered.length === 0
      ? [
          {
            slug: "default",
            name: "Default",
            isCustom: false,
            isDefault: true,
            capabilities,
          },
        ]
      : discovered.map((model) => ({
          slug: model.id,
          name: model.name,
          isCustom: false,
          ...(model.id === discovery?.currentModelId ? { isDefault: true } : {}),
          capabilities: capabilitiesFor(model),
        }));
  return providerModelsFromSettings(builtInModels, customModels, capabilities);
}

function acpRegistrySnapshotReadiness(
  inspection:
    | AcpRegistrySupport.AcpRegistryInspection
    | { readonly status: "failed"; readonly message: string },
): Pick<ServerProvider, "installed" | "version" | "status" | "message"> {
  switch (inspection.status) {
    case "ready":
      return { installed: true, version: inspection.version, status: "ready" };
    case "unconfigured":
      return {
        installed: false,
        version: null,
        status: "warning",
        message:
          "Select an ACP Registry agent or configure a local ACP executable before starting a thread.",
      };
    case "not_found":
      return {
        installed: false,
        version: null,
        status: "error",
        message: `ACP Registry does not contain agent '${inspection.agentId}'.`,
      };
    case "unsupported":
      return {
        installed: false,
        version: inspection.version,
        status: "error",
        message: `ACP Registry agent '${inspection.agentId}' has no compatible distribution for this environment.`,
      };
    case "missing_runner":
      return {
        installed: false,
        version: inspection.version,
        status: "error",
        message:
          inspection.distribution === "local"
            ? "Local ACP executable is not available on this environment's PATH."
            : `ACP executable '${inspection.runner}' is not available on this environment's PATH.`,
      };
    case "unprepared":
      return {
        installed: false,
        version: inspection.version,
        status: "warning",
        message: `ACP Registry agent '${inspection.agentId}' has not been prepared on this environment.`,
      };
    case "failed":
      return {
        installed: false,
        version: null,
        status: "error",
        message: inspection.message,
      };
  }
}

interface SnapshotIdentity {
  readonly instanceId: ProviderInstance["instanceId"];
  readonly displayName: string | undefined;
  readonly accentColor: string | undefined;
  readonly continuationKey: string;
}

function baseSnapshot(
  input: SnapshotIdentity & {
    readonly settings: AcpRegistrySettings;
    readonly checkedAt: string;
    readonly installed: boolean;
    readonly version: string | null;
    readonly status: ServerProvider["status"];
    readonly auth: ServerProvider["auth"];
    readonly documentationUrl?: string;
    readonly message?: string;
    readonly probe?: AcpRegistryConfigurationProbeResult;
    readonly probeError?: AcpRegistryOperationError;
    readonly supportsTextGeneration?: boolean;
  },
): ServerProvider {
  const iconUrl =
    input.settings.source === "local"
      ? null
      : (resolveOfficialAcpRegistryIconUrl(input.probe?.probe.icon) ??
        officialAcpRegistryIconUrlForAgentId(input.settings.agentId));
  return {
    instanceId: input.instanceId,
    driver: DRIVER_KIND,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.accentColor ? { accentColor: input.accentColor } : {}),
    ...(iconUrl ? { iconUrl } : {}),
    continuation: { groupKey: input.continuationKey },
    supportsTextGeneration:
      input.supportsTextGeneration ??
      (input.installed && input.auth.status !== "unauthenticated"),
    enabled: input.settings.enabled,
    installed: input.installed,
    version: input.version,
    status: input.settings.enabled ? input.status : "disabled",
    auth: { ...input.auth, canLogout: input.auth.canLogout ?? false },
    checkedAt: input.checkedAt,
    setup: {
      canInstall: false,
      ...(input.documentationUrl ? { documentationUrl: input.documentationUrl } : {}),
      canAuthenticate:
        input.installed &&
        (input.probe
          ? input.probe.probe.authMethods.length > 0
          : input.settings.source === "local"
            ? (input.probeError?.authMethods?.length ?? 0) > 0
            : input.settings.agentId.length > 0),
    },
    ...(input.message ? { message: input.message } : {}),
    models: modelsFromDiscovery(input.probe?.probe, input.settings.customModels),
    ...(input.probe === undefined
      ? {}
      : {
          nativeSessions: {
            canList: input.probe.probe.sessionManagement.canList,
            canLoad: input.probe.probe.sessionManagement.canLoad,
            canResume: input.probe.probe.sessionManagement.canResume,
            canDelete: input.probe.probe.sessionManagement.canDelete,
          },
          configurableProviders: input.probe.probe.sessionManagement.canConfigureProviders,
        }),
    slashCommands: input.probe?.slashCommands ?? [],
    skills: input.probe?.skills ?? [],
  };
}

export function applyAcpRegistryAvailableCommands(
  provider: ServerProvider,
  commands: Option.Option<AcpRegistryAvailableCommands>,
): ServerProvider {
  return Option.match(commands, {
    onNone: () => provider,
    onSome: ({ slashCommands, skills }) => ({ ...provider, slashCommands, skills }),
  });
}

export function applyAcpRegistryLiveConfiguration(
  provider: ServerProvider,
  configuration: AcpRegistryLiveConfiguration,
  customModels: ReadonlyArray<CustomModelSetting>,
  previousModels: ReadonlyArray<ServerProviderModel> = provider.models,
): ServerProvider {
  const { message: _staleProbeMessage, ...snapshot } = provider;
  // session/load may omit models (Kimi returns `{}`); keep the probed list
  // and apply any live option descriptors to it.
  const probedModels = provider.models.filter((model) => !model.isCustom);
  // A cold-start session can report one placeholder model before its catalog
  // settles, while the probe may already have observed the full catalog. A
  // single model enumerated by an explicit select is not that fallback but
  // the agent's deliberate statement, so it wins over the probe catalog.
  const liveCatalogIsProvisional =
    configuration.models.length === 1 &&
    !configuration.modelsFromModelSelect &&
    probedModels.length > 1;
  const useLiveCatalog =
    configuration.models.length > 1 ||
    (configuration.models.length === 1 && !liveCatalogIsProvisional);
  const selectedProbedModelId =
    configuration.currentModelId !== null &&
    probedModels.some((model) => model.slug === configuration.currentModelId)
      ? configuration.currentModelId
      : (probedModels.find((model) => model.isDefault)?.slug ?? null);
  const discovery = useLiveCatalog
    ? configuration
    : {
        ...configuration,
        models: probedModels.map((model) => ({
          id: model.slug,
          name: model.name,
          description: null,
        })),
        currentModelId: selectedProbedModelId,
      };
  return {
    ...snapshot,
    status: provider.enabled ? "ready" : provider.status,
    models:
      !useLiveCatalog && configuration.configOptions.length === 0
        ? withAcpRegistryDefaultModel(provider.models, selectedProbedModelId)
        : modelsFromDiscovery(
            discovery,
            customModels,
            previousModels.filter((model) => !model.isCustom),
          ),
  };
}

function withAcpRegistryDefaultModel(
  models: ReadonlyArray<ServerProviderModel>,
  currentModelId: string | null,
): ReadonlyArray<ServerProviderModel> {
  if (currentModelId === null) return models;
  let changed = false;
  const next = models.map((model) => {
    if (model.isCustom) return model;
    const isDefault = model.slug === currentModelId;
    if ((model.isDefault ?? false) === isDefault) return model;
    changed = true;
    const { isDefault: _previous, ...rest } = model;
    return isDefault ? { ...rest, isDefault: true } : rest;
  });
  return changed ? next : models;
}

function applyAcpRegistryUrlAuthAction(
  provider: ServerProvider,
  action: Option.Option<NonNullable<ServerProvider["auth"]["action"]>>,
): ServerProvider {
  const { action: _previousAction, ...auth } = provider.auth;
  return {
    ...provider,
    auth: Option.match(action, {
      onNone: () => auth,
      onSome: (nextAction) => ({ ...auth, action: nextAction }),
    }),
  };
}

const buildInitialAcpRegistrySnapshot = Effect.fn("AcpRegistryDriver.buildInitialSnapshot")(
  function* (input: SnapshotIdentity & { readonly settings: AcpRegistrySettings }) {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    return baseSnapshot({
      ...input,
      checkedAt,
      installed: false,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: input.settings.enabled
        ? "Checking ACP Registry agent readiness..."
        : "ACP Registry is disabled in Prismux settings.",
    });
  },
);

export function buildCheckedAcpRegistrySnapshot(
  input: SnapshotIdentity & {
    readonly settings: AcpRegistrySettings;
    readonly checkedAt: string;
    readonly inspection:
      | AcpRegistrySupport.AcpRegistryInspection
      | { readonly status: "failed"; readonly message: string };
    readonly probe?: AcpRegistryConfigurationProbeResult;
    readonly probeError?: AcpRegistryOperationError;
  },
): ServerProvider {
  const readiness = acpRegistrySnapshotReadiness(input.inspection);
  const probeFailed = input.probeError !== undefined;
  const advertisedAuthMethod =
    input.probeError?.reason === "authentication_failed"
      ? (input.probeError.authMethods?.find(
          (method) => method.id === input.settings.authMethodId,
        ) ?? input.probeError.authMethods?.[0])
      : undefined;
  const authenticationMessage = advertisedAuthMethod
    ? advertisedAuthMethod.type === "terminal" && advertisedAuthMethod.command
      ? `Sign in in provider settings using "${advertisedAuthMethod.name}". The login terminal runs on this environment.`
      : advertisedAuthMethod.type === "env_var" &&
          (advertisedAuthMethod.envVarNames?.length ?? 0) > 0
        ? `Set ${advertisedAuthMethod.envVarNames!.join(", ")} under this instance's environment variables in provider settings. Prismux will detect it on the next provider refresh.`
        : `Sign in in provider settings using "${advertisedAuthMethod.name}".`
    : undefined;
  return baseSnapshot({
    ...input,
    ...(input.inspection.status === "ready" && input.inspection.documentationUrl
      ? { documentationUrl: input.inspection.documentationUrl }
      : {}),
    installed: readiness.installed,
    version:
      input.settings.source === "local"
        ? isDeepSeekHarnessSettings(input.settings)
          ? (selectPreferredDshVersion(
              isPlaceholderDshVersion(input.probe?.probe.agentVersion)
                ? readiness.version
                : input.probe?.probe.agentVersion,
              readiness.version ?? input.probe?.probe.agentVersion,
            ) ?? null)
          : (input.probe?.probe.agentVersion ?? readiness.version)
        : readiness.version,
    // Failed discovery is a warning: an installed agent may still run real turns.
    status: probeFailed ? "warning" : readiness.status,
    auth: input.probe
      ? {
          // Discovery sessions and an empty auth-method list do not prove sign-in.
          status: "unknown",
          canLogout: input.probe.probe.sessionManagement.canLogout,
        }
      : input.probeError?.reason === "authentication_failed"
        ? {
            status: "unauthenticated",
            ...(advertisedAuthMethod
              ? { type: advertisedAuthMethod.type, label: advertisedAuthMethod.name }
              : {}),
            ...(input.probeError.authAction === undefined
              ? {}
              : { action: input.probeError.authAction }),
          }
        : { status: "unknown" },
    ...(input.probeError
      ? { message: authenticationMessage ?? input.probeError.message }
      : readiness.message
        ? { message: readiness.message }
        : {}),
  });
}

export const checkAcpRegistryProviderStatus = Effect.fn("AcpRegistryDriver.checkProviderStatus")(
  function* <Requirements>(
    input: SnapshotIdentity & {
      readonly settings: AcpRegistrySettings;
      readonly cwd: string;
      readonly environment: NodeJS.ProcessEnv;
    },
    probeConfiguration: AcpRegistryConfigurationProbe<Requirements>,
  ): Effect.fn.Return<ServerProvider, never, AcpRegistrySupport.AcpRegistryCatalog | Requirements> {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    if (!input.settings.enabled) {
      return yield* buildInitialAcpRegistrySnapshot(input);
    }
    const catalog = yield* AcpRegistrySupport.AcpRegistryCatalog;
    const inspected = yield* Effect.result(catalog.inspect(input.settings, input.environment));
    if (Result.isFailure(inspected)) {
      return buildCheckedAcpRegistrySnapshot({
        ...input,
        checkedAt,
        inspection: {
          status: "failed",
          message: `Could not inspect ACP Registry agent: ${inspected.failure.message}`,
        },
      });
    }
    if (inspected.success.status !== "ready") {
      return buildCheckedAcpRegistrySnapshot({
        ...input,
        checkedAt,
        inspection: inspected.success,
      });
    }
    const probed = yield* Effect.result(
      probeConfiguration({
        instanceId: input.instanceId,
        settings: input.settings,
        cwd: input.cwd,
        environment: providerProbeEnvironment(input.environment),
      }),
    );
    return Result.isFailure(probed)
      ? buildCheckedAcpRegistrySnapshot({
          ...input,
          checkedAt,
          inspection: inspected.success,
          probeError: probed.failure,
        })
      : buildCheckedAcpRegistrySnapshot({
          ...input,
          checkedAt,
          inspection: inspected.success,
          probe: probed.success,
        });
  },
);

export const checkAcpRegistryProviderReadiness = Effect.fn(
  "AcpRegistryDriver.checkProviderReadiness",
)(function* (
  input: SnapshotIdentity & {
    readonly settings: AcpRegistrySettings;
    readonly environment: NodeJS.ProcessEnv;
  },
): Effect.fn.Return<ServerProvider, never, AcpRegistrySupport.AcpRegistryCatalog> {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  if (!input.settings.enabled) {
    return yield* buildInitialAcpRegistrySnapshot(input);
  }
  const catalog = yield* AcpRegistrySupport.AcpRegistryCatalog;
  const inspected = yield* Effect.result(catalog.inspect(input.settings, input.environment));
  const snapshot = buildCheckedAcpRegistrySnapshot({
    ...input,
    checkedAt,
    inspection: Result.isFailure(inspected)
      ? {
          status: "failed",
          message: `Could not inspect ACP Registry agent: ${inspected.failure.message}`,
        }
      : inspected.success,
  });
  return inspected._tag === "Success" && inspected.success.status === "ready"
    ? {
        ...snapshot,
        message: "Checking ACP authentication, models, and commands in the background...",
      }
    : snapshot;
});

export type AcpRegistryDriverEnv =
  | AcpRegistryAdapterV2DriverEnv
  | Digest.Digest
  | ProviderHost.ProviderHost;

export type AcpRegistryUsageReaderEnv = FileSystem.FileSystem | Path.Path;

const dshUsageFileCache = makeDshUsageFileCache();

export const dshUsageReader: ProviderUsageReader<AcpRegistrySettings, AcpRegistryUsageReaderEnv> = {
  kind: "scan",
  provider: "dsh",
  rateModel: dshRateModel,
  scan: Effect.fn("dshUsageReader.scan")(function* ({ instances, windowStartMs }) {
    if (instances.length === 0) {
      return [];
    }
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const hostHomeDirectory = yield* HostProcess.HomeDirectory;
    const hostPlatform = yield* HostProcess.Platform;

    const homesBySessionsDir = new Map<string, string>();
    for (const instance of instances) {
      if (
        instance.configured &&
        instance.config !== undefined &&
        !isDeepSeekHarnessSettings(instance.config)
      ) {
        continue;
      }
      const dshHome = resolveDshHomeDir(instance.environment, hostHomeDirectory, hostPlatform);
      const resolvedHome = yield* fileSystem
        .realPath(dshHome)
        .pipe(Effect.orElseSucceed(() => dshHome));
      const sessionsDir = path.join(resolvedHome, "sessions");
      const canonicalDir = yield* fileSystem
        .realPath(sessionsDir)
        .pipe(Effect.orElseSucceed(() => sessionsDir));
      if (!homesBySessionsDir.has(canonicalDir)) {
        homesBySessionsDir.set(canonicalDir, resolvedHome);
      }
    }

    if (homesBySessionsDir.size === 0) {
      return [];
    }

    return yield* Effect.forEach(
      [...homesBySessionsDir.entries()],
      ([dir, dshHome]) =>
        Effect.promise(() =>
          scanDshUsageFiles({
            dshHome,
            sinceMs: windowStartMs,
            cache: dshUsageFileCache,
          }),
        ).pipe(
          Effect.map((result) => ({
            dir,
            files: result.missing && !result.error ? null : result.files,
            status: result.error ? ("partial" as const) : ("ok" as const),
            ...(result.error
              ? { message: "Some DeepSeek Harness history could not be read." }
              : {}),
          })),
        ),
      { concurrency: "unbounded" },
    );
  }),
};

export const AcpRegistryDriver: ProviderDriver<
  AcpRegistrySettings,
  AcpRegistryDriverEnv,
  AcpRegistryUsageReaderEnv
> = {
  driverKind: DRIVER_KIND,
  metadata: {
    displayName: "ACP Registry",
    supportsMultipleInstances: true,
    hasDefaultInstance: false,
  },
  configSchema: AcpRegistrySettings,
  defaultConfig: () => decodeSettings({}),
  usage: dshUsageReader,
  create: Effect.fn("AcpRegistryDriver.create")(function* ({
    instanceId,
    displayName,
    accentColor,
    environment,
    enabled,
    config,
  }) {
    const catalog = yield* AcpRegistrySupport.AcpRegistryCatalog;
    const runtimeCoordinator = yield* Effect.serviceOption(
      AcpRegistryRuntimeCoordinator.AcpRegistryRuntimeCoordinator,
    );
    if (Option.isSome(runtimeCoordinator)) {
      yield* runtimeCoordinator.value.clearAvailableCommands(instanceId);
      yield* runtimeCoordinator.value.clearLiveConfiguration(instanceId);
      yield* Effect.addFinalizer(() =>
        runtimeCoordinator.value
          .clearAvailableCommands(instanceId)
          .pipe(Effect.andThen(runtimeCoordinator.value.clearLiveConfiguration(instanceId))),
      );
    }
    const random = yield* SecureRandom.SecureRandom;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const hostEnvironment = yield* HostProcess.Environment;
    const hostPlatform = yield* HostProcess.Platform;
    const hostHomeDirectory = yield* HostProcess.HomeDirectory;
    const host = yield* ProviderHost.ProviderHost;
    const continuationIdentity = defaultProviderContinuationIdentity({
      driverKind: DRIVER_KIND,
      instanceId,
    });
    const identity = {
      instanceId,
      displayName,
      accentColor,
      continuationKey: continuationIdentity.continuationKey,
    };
    const effectiveConfig = { ...config, enabled } satisfies AcpRegistrySettings;
    const isDsh = isDeepSeekHarnessSettings(effectiveConfig);
    const isAntigravityAcp = isAntigravityAcpSettings(effectiveConfig);
    const processEnvironment = yield* mergeProviderInstanceEnvironment(
      environment,
      hostEnvironment,
    );
    const waiverPath = resolvePrismuxWaiverPath(path, hostHomeDirectory, processEnvironment);
    const isAntigravityWaiverSigned = isAntigravityAcp
      ? readAntigravityWaiverSignedEffect(fileSystem, waiverPath)
      : Effect.succeed(true);
    const resolveLocalDshVersionFast = (): string | null => {
      if (!isDsh || effectiveConfig.source !== "local") return null;
      const direct = resolveDshInstalledVersion({
        command: effectiveConfig.commandPath,
        args: effectiveConfig.commandArgs,
        env: processEnvironment,
        platform: hostPlatform,
      });
      if (direct !== undefined) return direct;
      const packaged = resolvePackagedDshDesktopSpawn({
        commandArgs: effectiveConfig.commandArgs,
        platform: hostPlatform,
        env: processEnvironment,
      });
      if (packaged === undefined) return null;
      return (
        resolveDshInstalledVersion({
          command: packaged.command,
          args: packaged.args,
          env: packaged.env,
          platform: hostPlatform,
        }) ?? null
      );
    };
    const orchestrationAdapter = yield* AcpRegistryAdapterV2Driver.create({
      instanceId,
      displayName,
      accentColor,
      environment,
      enabled,
      config,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: DRIVER_KIND,
            instanceId,
            detail: "Failed to build ACP Registry orchestration adapter.",
            cause,
          }),
      ),
    );
    const readinessInput = {
      ...identity,
      settings: effectiveConfig,
      environment: processEnvironment,
    };
    const confirmedAuthentication =
      yield* AcpRegistryAuthenticationState.makeAcpRegistryAuthenticationState({
        cacheDir: host.paths.providerStatusCacheDir,
        instanceId,
        settings: effectiveConfig,
        environment,
        processEnvironment,
      });
    // Refreshes rebuild the snapshot from the probe, so per-model options
    // learned from earlier sessions are kept here.
    const learnedModels = yield* Ref.make<ReadonlyArray<ServerProviderModel>>([]);
    const applyLiveConfiguration = (
      provider: ServerProvider,
      configuration: AcpRegistryLiveConfiguration,
    ) =>
      Ref.modify(learnedModels, (learned) => {
        const next = applyAcpRegistryLiveConfiguration(
          provider,
          configuration,
          effectiveConfig.customModels,
          learned.length > 0 ? learned : provider.models,
        );
        return [next, next.models === provider.models ? learned : next.models];
      });
    const clearLearnedModels = Ref.set(learnedModels, []);
    const overlayDshCommandsForCwd = (
      provider: ServerProvider,
      cwd: string,
      replaceProjectSkills = false,
    ): ServerProvider => {
      if (!isDsh || !provider.installed) return provider;
      const baseSkills = replaceProjectSkills
        ? provider.skills.filter((skill) => skill.path.startsWith("acp://skill/"))
        : provider.skills;
      const augmented = augmentDshAvailableCommands(
        {
          slashCommands: provider.slashCommands,
          skills: baseSkills,
        },
        {
          cwd,
          env: processEnvironment,
          platform: hostPlatform,
        },
      );
      return {
        ...provider,
        slashCommands: augmented.slashCommands,
        skills: augmented.skills,
      };
    };
    const withLiveRuntimeState = Effect.fn("AcpRegistryDriver.withLiveRuntimeState")(function* (
      input: ServerProvider,
    ) {
      if (input.auth.status === "unauthenticated") yield* confirmedAuthentication.set(false);
      const provider =
        input.enabled &&
        input.installed &&
        input.auth.status === "unknown" &&
        (yield* confirmedAuthentication.get)
          ? { ...input, auth: { ...input.auth, status: "authenticated" as const } }
          : input;
      const merged = yield* Option.isNone(runtimeCoordinator)
        ? Effect.succeed(provider)
        : Effect.all({
            commands: runtimeCoordinator.value.getAvailableCommands(instanceId),
            configuration: runtimeCoordinator.value.getLiveConfiguration(instanceId),
            authAction: runtimeCoordinator.value.getUrlAuthAction(instanceId),
          }).pipe(
            Effect.flatMap(({ commands, configuration, authAction }) => {
              const withCommands = applyAcpRegistryAvailableCommands(provider, commands);
              return Option.match(configuration, {
                onNone: () => Effect.succeed(withCommands),
                onSome: (liveConfiguration) =>
                  applyLiveConfiguration(withCommands, liveConfiguration),
              }).pipe(
                Effect.map((withConfiguration) =>
                  applyAcpRegistryUrlAuthAction(withConfiguration, authAction),
                ),
              );
            }),
          );
      const withCommandsAndConfig = overlayDshCommandsForCwd(merged, host.paths.cwd);
      const waiverAllowsTextGen = isAntigravityAcp ? yield* isAntigravityWaiverSigned : true;
      const resolvedSupportsTextGen =
        withCommandsAndConfig.installed &&
        withCommandsAndConfig.auth.status !== "unauthenticated" &&
        waiverAllowsTextGen;
      return withCommandsAndConfig.supportsTextGeneration === resolvedSupportsTextGen
        ? withCommandsAndConfig
        : { ...withCommandsAndConfig, supportsTextGeneration: resolvedSupportsTextGen };
    });
    // A local executable's version comes only from probing it, so readiness checks reuse the last report.
    const reportedLocalVersion = yield* Ref.make<string | null>(null);
    const checkProvider = checkAcpRegistryProviderReadiness(readinessInput).pipe(
      Effect.provideService(AcpRegistrySupport.AcpRegistryCatalog, catalog),
      Effect.flatMap((provider) =>
        Ref.get(reportedLocalVersion).pipe(
          Effect.map((version) => {
            if (!provider.installed) return provider;
            const resolvedVersion =
              provider.version !== null && (!isDsh || !isPlaceholderDshVersion(provider.version))
                ? provider.version
                : version !== null && (!isDsh || !isPlaceholderDshVersion(version))
                  ? version
                  : resolveLocalDshVersionFast() ?? provider.version;
            return resolvedVersion !== provider.version
              ? { ...provider, version: resolvedVersion }
              : provider;
          }),
        ),
      ),
      Effect.flatMap(withLiveRuntimeState),
    );
    const enrichProvider = checkAcpRegistryProviderStatus(
      {
        ...readinessInput,
        cwd: host.paths.cwd,
      },
      probeAcpRegistryConfiguration,
    ).pipe(
      Effect.provideService(AcpRegistrySupport.AcpRegistryCatalog, catalog),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
      Effect.provideService(SecureRandom.SecureRandom, random),
    );
    const enrichmentCache = yield* Ref.make<AcpRegistryEnrichmentCache>({
      generation: 0,
      entry: null,
    });
    const liveSnapshotSemaphore = yield* Semaphore.make(1);
    const invalidateEnrichmentCache = Ref.update(enrichmentCache, (current) => ({
      generation: current.generation + 1,
      entry: null,
    }));
    const enrichProviderCached = Effect.fn("AcpRegistryDriver.enrichProviderCached")(function* (
      baseSnapshot: ServerProvider,
    ) {
      const now = yield* Clock.currentTimeMillis;
      const cacheState = yield* Ref.get(enrichmentCache);
      const cached = cacheState.entry;
      if (
        cached !== null &&
        isAcpRegistryCacheValid(
          cached,
          baseSnapshot.version,
          effectiveConfig.source === "local",
          now,
        )
      ) {
        return {
          provider: { ...cached.provider, checkedAt: baseSnapshot.checkedAt },
          generation: cacheState.generation,
        };
      }
      const enriched = yield* enrichProvider;
      if (effectiveConfig.source === "local" && enriched.status === "ready") {
        yield* Ref.set(reportedLocalVersion, enriched.version);
      }
      if (enriched.status === "ready") {
        const completedAt = yield* Clock.currentTimeMillis;
        yield* Ref.update(enrichmentCache, (current) =>
          current.generation === cacheState.generation
            ? {
                ...current,
                entry: {
                  provider: enriched,
                  expiresAt: completedAt + acpRegistryProbeTtlMs(enriched),
                },
              }
            : current,
        );
      }
      return { provider: enriched, generation: cacheState.generation };
    });
    const snapshotSettings = yield* makeProviderSnapshotSettingsSource(effectiveConfig);
    const snapshot = yield* makeManagedServerProvider<
      ProviderSnapshotSettings<AcpRegistrySettings>
    >({
      resolveMaintenance: () => Effect.succeed(MAINTENANCE),
      getSettings: snapshotSettings.getSettings,
      streamSettings: snapshotSettings.streamSettings,
      haveSettingsChanged: haveProviderSnapshotSettingsChanged,
      // Inspection may fetch the registry when its disk cache is missing; creation must not wait on that.
      initialSnapshot: () => buildInitialAcpRegistrySnapshot(readinessInput),
      checkProvider,
      enrichSnapshot: Effect.fn("enrichSnapshot")(function ({
        snapshot,
        getSnapshot,
        publishSnapshot,
      }) {
        if (!snapshot.installed) return Effect.void;
        const publishEnrichment = (
          Option.isSome(runtimeCoordinator)
            ? runtimeCoordinator.value.runBackgroundProbe(
                effectiveConfig.source === "local"
                  ? `local:${instanceId}`
                  : effectiveConfig.agentId,
                enrichProviderCached(snapshot),
              )
            : enrichProviderCached(snapshot).pipe(Effect.asSome)
        ).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.void,
              onSome: ({ provider, generation }) =>
                liveSnapshotSemaphore.withPermit(
                  Ref.get(enrichmentCache).pipe(
                    Effect.flatMap((current) =>
                      current.generation === generation
                        ? withLiveRuntimeState(provider).pipe(Effect.flatMap(publishSnapshot))
                        : Effect.void,
                    ),
                  ),
                ),
            }),
          ),
        );
        if (Option.isNone(runtimeCoordinator)) return publishEnrichment;

        const publishLiveCommands = runtimeCoordinator.value.watchAvailableCommands(
          instanceId,
          ({ slashCommands, skills }) =>
            liveSnapshotSemaphore.withPermit(
              getSnapshot.pipe(
                Effect.map((current) =>
                  overlayDshCommandsForCwd(
                    {
                      ...current,
                      slashCommands,
                      skills,
                    },
                    host.paths.cwd,
                  ),
                ),
                Effect.tap((next) =>
                  Ref.update(enrichmentCache, (cache) =>
                    cache.entry === null
                      ? cache
                      : {
                          ...cache,
                          entry: {
                            ...cache.entry,
                            provider: {
                              ...cache.entry.provider,
                              slashCommands: next.slashCommands,
                              skills: next.skills,
                            },
                          },
                        },
                  ),
                ),
                Effect.flatMap(publishSnapshot),
              ),
            ),
        );
        const publishLiveConfiguration = runtimeCoordinator.value.watchLiveConfiguration(
          instanceId,
          (configuration) =>
            liveSnapshotSemaphore.withPermit(
              getSnapshot.pipe(
                Effect.flatMap((current) => applyLiveConfiguration(current, configuration)),
                Effect.tap(() =>
                  Clock.currentTimeMillis.pipe(
                    Effect.flatMap((now) =>
                      Ref.update(enrichmentCache, (cache) =>
                        updateAcpRegistryEnrichmentCache({
                          cache,
                          configuration,
                          customModels: effectiveConfig.customModels,
                          now,
                        }),
                      ),
                    ),
                  ),
                ),
                Effect.flatMap(publishSnapshot),
              ),
            ),
        );
        const publishUrlAuthAction = runtimeCoordinator.value.watchUrlAuthAction(
          instanceId,
          (action) =>
            liveSnapshotSemaphore.withPermit(
              getSnapshot.pipe(
                Effect.flatMap((current) =>
                  publishSnapshot(
                    applyAcpRegistryUrlAuthAction(current, Option.fromNullishOr(action)),
                  ),
                ),
              ),
            ),
        );
        return Effect.all(
          [publishEnrichment, publishLiveCommands, publishLiveConfiguration, publishUrlAuthAction],
          {
            concurrency: "unbounded",
            discard: true,
          },
        );
      }),
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ProviderDriverError({
            driver: DRIVER_KIND,
            instanceId,
            detail: "Failed to build the ACP Registry provider snapshot.",
            cause,
          }),
      ),
    );

    const provideAcpManagementServices = <A, E>(
      effect: Effect.Effect<
        A,
        E,
        | AcpRegistrySupport.AcpRegistryCatalog
        | ChildProcessSpawner.ChildProcessSpawner
        | SecureRandom.SecureRandom
      >,
    ): Effect.Effect<A, E> => {
      const provided = effect.pipe(
        Effect.provideService(AcpRegistrySupport.AcpRegistryCatalog, catalog),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        Effect.provideService(SecureRandom.SecureRandom, random),
      );
      return Option.isSome(runtimeCoordinator)
        ? provided.pipe(
            Effect.provideService(
              AcpRegistryRuntimeCoordinator.AcpRegistryRuntimeCoordinator,
              runtimeCoordinator.value,
            ),
          )
        : provided;
    };

    const clearLiveState = (
      Option.isSome(runtimeCoordinator)
        ? runtimeCoordinator.value
            .clearLiveConfiguration(instanceId)
            .pipe(Effect.andThen(runtimeCoordinator.value.clearAvailableCommands(instanceId)))
        : Effect.void
    ).pipe(Effect.andThen(clearLearnedModels));
    const controller = yield* AcpRegistryAuth.makeAcpRegistryAuth({
      instanceId,
      settings: effectiveConfig,
      cwd: host.paths.cwd,
      environment: processEnvironment,
      onChanged: (authenticated) =>
        confirmedAuthentication
          .set(authenticated)
          .pipe(
            Effect.andThen(authenticated ? Effect.void : clearLiveState),
            Effect.andThen(liveSnapshotSemaphore.withPermit(invalidateEnrichmentCache)),
            Effect.andThen(snapshot.refresh),
            Effect.asVoid,
          ),
    }).pipe(
      Effect.provideService(AcpRegistrySupport.AcpRegistryCatalog, catalog),
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      Effect.provideService(SecureRandom.SecureRandom, random),
    );
    const auth = {
      ...controller,
      invalidate: (controller.invalidate ?? Effect.void).pipe(
        Effect.andThen(confirmedAuthentication.set(false)),
        Effect.andThen(clearLiveState),
        Effect.andThen(liveSnapshotSemaphore.withPermit(invalidateEnrichmentCache)),
        Effect.andThen(snapshot.refresh),
        Effect.asVoid,
      ),
    };

    return {
      instanceId,
      driverKind: DRIVER_KIND,
      continuationIdentity,
      displayName,
      accentColor,
      enabled,
      auth,
      snapshot: {
        ...snapshot,
        refresh: snapshot.refresh.pipe(Effect.tap(() => controller.refreshMethods ?? Effect.void)),
      },
      snapshotForCwd: (cwd) =>
        snapshot.getSnapshot.pipe(
          Effect.map((current) =>
            isDsh && current.installed
              ? {
                  ...overlayDshCommandsForCwd(current, cwd, true),
                  slashCommandsPending: false,
                }
              : current,
          ),
        ),
      invalidateCaches: (Option.isSome(runtimeCoordinator)
        ? runtimeCoordinator.value.clearLiveConfiguration(instanceId)
        : Effect.void
      ).pipe(
        Effect.andThen(clearLearnedModels),
        Effect.andThen(liveSnapshotSemaphore.withPermit(invalidateEnrichmentCache)),
      ),
      orchestrationAdapter,
      textGeneration: makeAcpRegistryTextGeneration({
        settings: effectiveConfig,
        environment: processEnvironment,
        providerLabel:
          displayName?.trim() ||
          (isDsh ? "DeepSeek Harness" : effectiveConfig.agentId || "ACP Registry"),
        isDsh,
        isAntigravityAcp,
        isAntigravityWaiverSigned,
        catalog,
        fileSystem,
        path,
        spawner,
        random,
      }),
      acpSessionManagement: {
        listSessions: ({ cwd, cursor }) =>
          provideAcpManagementServices(
            listAcpRegistrySessions({
              instanceId,
              settings: effectiveConfig,
              cwd,
              environment: processEnvironment,
              ...(cursor === undefined ? {} : { cursor }),
            }),
          ),
        deleteSession: ({ cwd, sessionId }) =>
          provideAcpManagementServices(
            deleteAcpRegistrySession({
              instanceId,
              settings: effectiveConfig,
              cwd,
              environment: processEnvironment,
              sessionId,
            }),
          ),
        listProviders: (cwd) =>
          provideAcpManagementServices(
            listAcpRegistryProviders({
              instanceId,
              settings: effectiveConfig,
              cwd,
              environment: processEnvironment,
            }),
          ),
        setProvider: ({ cwd, providerId, apiType, baseUrl, headers }) =>
          provideAcpManagementServices(
            setAcpRegistryProvider({
              instanceId,
              settings: effectiveConfig,
              cwd,
              environment: processEnvironment,
              providerId,
              apiType,
              baseUrl,
              ...(headers === undefined ? {} : { headers }),
            }),
          ).pipe(Effect.tap(() => liveSnapshotSemaphore.withPermit(invalidateEnrichmentCache))),
        disableProvider: ({ cwd, providerId }) =>
          provideAcpManagementServices(
            disableAcpRegistryProvider({
              instanceId,
              settings: effectiveConfig,
              cwd,
              environment: processEnvironment,
              providerId,
            }),
          ).pipe(Effect.tap(() => liveSnapshotSemaphore.withPermit(invalidateEnrichmentCache))),
        logout: (cwd) => {
          const logout = logoutAcpRegistry({
            instanceId,
            settings: effectiveConfig,
            cwd,
            environment: processEnvironment,
          }).pipe(
            Effect.provideService(AcpRegistrySupport.AcpRegistryCatalog, catalog),
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
            Effect.provideService(SecureRandom.SecureRandom, random),
            Effect.tap(() => confirmedAuthentication.set(false)),
            Effect.tap(() =>
              liveSnapshotSemaphore.withPermit(
                invalidateEnrichmentCache.pipe(
                  Effect.andThen(
                    Option.isSome(runtimeCoordinator)
                      ? Effect.all(
                          [
                            runtimeCoordinator.value.clearAvailableCommands(instanceId),
                            runtimeCoordinator.value.clearLiveConfiguration(instanceId),
                          ],
                          { concurrency: "unbounded", discard: true },
                        )
                      : Effect.void,
                  ),
                ),
              ),
            ),
          );
          return Option.isSome(runtimeCoordinator)
            ? logout.pipe(
                Effect.provideService(
                  AcpRegistryRuntimeCoordinator.AcpRegistryRuntimeCoordinator,
                  runtimeCoordinator.value,
                ),
              )
            : logout;
        },
      },
    } satisfies ProviderInstance;
  }),
};
