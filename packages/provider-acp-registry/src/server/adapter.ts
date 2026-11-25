import {
  extractClaudeSubagentUpdate,
  extractClaudeSubagentSessionEvent,
  isClaudeProvisionalSubagentTool,
} from "./claudeAcp.ts";
import {
  normalizeDevinSessionUpdate,
  normalizeDevinToolCall,
  extractDevinSubagentUpdate,
  devinAnswerablePermissionOptions,
} from "./devinAcp.ts";
import { extractDroidElicitationForm } from "./droidAcp.ts";
import {
  extractDshProposedPlanMarkdown,
  extractDshSubagentUpdate,
  isDeepSeekHarnessAgentInfo,
  isDeepSeekHarnessSettings,
  normalizeDshSessionUpdate,
  normalizeDshToolCall,
  rewriteDshUserText,
} from "./dshAcp.ts";
import { augmentDshAvailableCommands, discoverDshLocalSkills } from "./dshSkills.ts";
import { makeKimiPromptOutcomeWatch } from "./kimiAcp.ts";
import { extractOpenCodeElicitationForm } from "./opencodeAcp.ts";
import {
  copilotClientCapabilitiesMeta,
  extractCopilotSubagentUpdate,
  isCopilotLostSessionError,
  makeCopilotSubagentRouting,
} from "./copilotAcp.ts";
import { prefersHttpMcpTransport } from "./mcpTransport.ts";
import { defaultInstanceIdForDriver, ProviderDriverKind } from "@prismux/core-contracts";
import { readCustomModelEntries } from "@prismux/core-shared/model";
import { AcpRegistrySettings } from "../settings.ts";
import * as HostProcess from "@prismux/core-shared/HostProcess";
import { resolveSelfInvocation, type SelfInvocation } from "@prismux/core-shared/nodeRuntime";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import type * as EffectAcpSchema from "@prismux/effect-acp/compat";
import * as EffectAcpErrors from "@prismux/effect-acp/errors";

import * as McpProviderSessions from "@prismux/provider-core/server/McpProviderSessions";
import * as ProviderContinuationRequests from "@prismux/provider-core/server/ProviderContinuationRequests";
import * as ProviderHost from "@prismux/provider-core/server/ProviderHost";
import {
  normalizeAcpRegistryCommands,
  normalizeAcpRegistryLiveConfiguration,
  normalizeAcpRegistryWebUrl,
} from "./probe.ts";
import * as AcpRegistrySupport from "./AcpRegistrySupport.ts";
import * as AcpRegistryRuntimeCoordinator from "./AcpRegistryRuntimeCoordinator.ts";
import * as AcpSessionRuntime from "@prismux/provider-acp/server/AcpSessionRuntime";
import { makeAcpNativeLoggerFactory } from "@prismux/provider-acp/server/nativeLogging";
import * as ProviderEventLoggers from "@prismux/provider-core/server/ProviderEventLoggers";
import { mergeProviderInstanceEnvironment } from "@prismux/provider-core/server/instanceEnvironment";
import * as IdAllocator from "@prismux/provider-core/server/IdAllocator";
import { makeProviderFailure } from "@prismux/provider-core/server/failure";
import {
  ProviderAdapterDriverCreateError,
  type ProviderAdapterDriver,
  type ProviderAdapterDriverCreateInput,
} from "@prismux/provider-core/server/adapterDriver";
import {
  AcpProviderCapabilitiesV2,
  makeAcpAdapterV2,
  type AcpAdapterV2ExtensionContext,
  type AcpAdapterV2Flavor,
  type AcpAdapterV2RuntimeInput,
} from "@prismux/provider-acp/server/adapter";

export const ACP_REGISTRY_PROVIDER = ProviderDriverKind.make("acpRegistry");
export const ACP_REGISTRY_DEFAULT_INSTANCE_ID = defaultInstanceIdForDriver(ACP_REGISTRY_PROVIDER);

const DEFAULT_ACP_REGISTRY_SETTINGS = Schema.decodeSync(AcpRegistrySettings)({});
const isAcpRequestError = Schema.is(EffectAcpErrors.AcpRequestError);

export interface AcpRegistryAdapterV2Options {
  readonly instanceId: Parameters<typeof makeAcpAdapterV2>[0]["instanceId"];
  readonly settings: AcpRegistrySettings;
  readonly environment: NodeJS.ProcessEnv;
  readonly selfInvocation: SelfInvocation;
  readonly nativeLogging?: Parameters<typeof makeAcpAdapterV2>[0]["nativeLogging"];
  readonly makeRuntime?: (
    input: AcpAdapterV2RuntimeInput,
  ) => Effect.Effect<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    EffectAcpErrors.AcpError,
    ChildProcessSpawner.ChildProcessSpawner | SecureRandom.SecureRandom | Scope.Scope
  >;
  readonly continuationRequests?: Parameters<typeof makeAcpAdapterV2>[0]["continuationRequests"];
  readonly assertComplete?: Effect.Effect<void, EffectAcpErrors.AcpError>;
}

// Mistral Vibe's application rate-limit code, outside ACP.
const MISTRAL_VIBE_RATE_LIMITED = -31001;

const MistralVibeSessionRetrying = Schema.Struct({
  sessionId: Schema.String,
  category: Schema.Literals(["rate_limited", "server_error", "timed_out", "connection", "unknown"]),
  detail: Schema.String,
});

/** Mistral Vibe (v2.25.5) reports SDK backoff through this ACP extension. */
export function registerMistralVibeAcpExtensions(context: AcpAdapterV2ExtensionContext) {
  return context.runtime.handleExtNotification(
    "_session/retrying",
    MistralVibeSessionRetrying,
    (notice) =>
      context.reportProviderRetry({
        sessionId: notice.sessionId,
        failure: makeProviderFailure({
          message: notice.detail,
          class:
            notice.category === "rate_limited"
              ? "usage_limit"
              : notice.category === "unknown"
                ? "provider_error"
                : "transport_error",
          retryable: true,
        }),
      }),
  );
}

export function acpRegistryPromptFailure(agentId: string, cause: unknown) {
  return makeProviderFailure({
    cause,
    ...(isAcpRequestError(cause)
      ? {
          message: cause.errorMessage,
          code: String(cause.code),
          class:
            agentId === "mistral-vibe" && cause.code === MISTRAL_VIBE_RATE_LIMITED
              ? ("usage_limit" as const)
              : ("provider_error" as const),
        }
      : { class: "provider_error" as const }),
  });
}

function makeAcpRegistryRuntime(
  options: AcpRegistryAdapterV2Options,
  catalog: AcpRegistrySupport.AcpRegistryCatalog["Service"],
  hooks?: {
    readonly onInitialized?: (initializeResult: EffectAcpSchema.InitializeResponse) => void;
  },
) {
  return (
    input: AcpAdapterV2RuntimeInput,
  ): Effect.Effect<
    AcpSessionRuntime.AcpSessionRuntime["Service"],
    EffectAcpErrors.AcpError,
    ChildProcessSpawner.ChildProcessSpawner | SecureRandom.SecureRandom | Scope.Scope
  > =>
    Effect.gen(function* () {
      const { processEnvironment, ...runtimeInput } = input;
      const resolved = yield* catalog
        .resolve(options.settings, input.cwd, options.environment)
        .pipe(
          Effect.mapError(
            (cause) =>
              new EffectAcpErrors.AcpSpawnError({
                command: options.settings.agentId || ACP_REGISTRY_PROVIDER,
                cause,
              }),
          ),
        );
      const context = yield* Layer.build(
        AcpSessionRuntime.layer({
          ...runtimeInput,
          ...(hooks?.onInitialized === undefined
            ? {}
            : {
                onInitialized: (initializeResult) =>
                  Effect.sync(() => hooks.onInitialized?.(initializeResult)),
              }),
          spawn:
            processEnvironment === undefined
              ? resolved.spawn
              : {
                  ...resolved.spawn,
                  env: { ...resolved.spawn.env, ...processEnvironment },
                },
          ...(options.settings.authMethodId ? { authMethodId: options.settings.authMethodId } : {}),
          customModels: readCustomModelEntries(options.settings.customModels).map(
            (entry) => entry.slug,
          ),
        }),
      );
      return yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
        Effect.provide(context),
      );
    });
}

const isHermes = (
  initializeResult: AcpSessionRuntime.AcpSessionRuntimeStartResult["initializeResult"],
) => initializeResult.agentInfo?.name === "hermes-agent";

export const makeAcpRegistryAdapterV2 = Effect.fn("makeAcpRegistryAdapterV2")(function* (
  options: AcpRegistryAdapterV2Options,
) {
  const catalog = yield* AcpRegistrySupport.AcpRegistryCatalog;
  const runtimeCoordinator = Option.getOrUndefined(
    yield* Effect.serviceOption(AcpRegistryRuntimeCoordinator.AcpRegistryRuntimeCoordinator),
  );
  const registryAgentId = options.settings.source === "local" ? "" : options.settings.agentId;
  const startupKey =
    options.settings.source === "local" ? `local:${options.instanceId}` : registryAgentId;
  const isDevin = registryAgentId === "devin";
  const isAntigravityCli =
    options.settings.source === "local" &&
    /^agy(\.exe|\.cmd)?$/i.test(options.settings.commandPath.split(/[\\/]/).pop() ?? "");
  const isOpenCode =
    registryAgentId === "opencode" ||
    registryAgentId === "opencode-v2" ||
    (options.settings.source === "local" &&
      /^opencode(?:-v2)?(\.exe|\.cmd)?$/i.test(
        options.settings.commandPath.split(/[\\/]/).pop() ?? "",
      ));
  // Local installs launch the `copilot` binary directly with no registry id.
  const isCopilot =
    registryAgentId === "github-copilot-cli" ||
    (options.settings.source === "local" &&
      /^copilot(\.exe|\.cmd)?$/i.test(options.settings.commandPath.split(/[\\/]/).pop() ?? ""));
  const isKimi =
    registryAgentId === "kimi-code" ||
    (options.settings.source === "local" &&
      /^kimi(\.exe|\.cmd)?$/i.test(options.settings.commandPath.split(/[\\/]/).pop() ?? ""));
  const isClaude =
    registryAgentId === "claude-acp" ||
    (options.settings.source === "local" &&
      /^claude-agent-acp(\.exe|\.cmd)?$/i.test(
        options.settings.commandPath.split(/[\\/]/).pop() ?? "",
      ));
  const isDroid =
    registryAgentId === "factory-droid" ||
    (options.settings.source === "local" &&
      /^(?:factory-)?droid(\.exe|\.cmd)?$/i.test(
        options.settings.commandPath.split(/[\\/]/).pop() ?? "",
      ));
  const isGlm =
    registryAgentId === "glm-acp-agent" ||
    (options.settings.source === "local" &&
      /^glm(?:-acp-agent)?(\.exe|\.cmd)?$/i.test(
        options.settings.commandPath.split(/[\\/]/).pop() ?? "",
      ));
  const isVibe =
    registryAgentId === "mistral-vibe" ||
    (options.settings.source === "local" &&
      /^(?:mistral-)?vibe(?:-acp)?(\.exe|\.cmd)?$/i.test(
        options.settings.commandPath.split(/[\\/]/).pop() ?? "",
      ));
  let isDshRuntime = isDeepSeekHarnessSettings(options.settings);
  let activeWorkspaceCwd: string | undefined;
  const hostPlatform = yield* HostProcess.Platform;
  const runtimeOptions = isClaude
    ? {
        ...options,
        environment: {
          ...options.environment,
          CLAUDE_AGENT_ACP_EXPERIMENTAL_V2:
            options.environment.CLAUDE_AGENT_ACP_EXPERIMENTAL_V2 ?? "1",
        },
      }
    : options;
  const watchKimiPromptOutcome = isKimi
    ? yield* makeKimiPromptOutcomeWatch(options.environment.KIMI_CODE_HOME)
    : undefined;
  const copilotRouting = isCopilot ? makeCopilotSubagentRouting() : undefined;
  // Copilot CLI 1.0.105 rejects stdio MCP servers from the client, and Command Code cannot
  // start the stdio bridge on Windows (it spawns MCP commands through cmd.exe, which splits
  // the unquoted "Prismux (Beta).exe" path). Both take T3's MCP endpoint over ACP HTTP.
  const useHttpMcpServers =
    copilotRouting !== undefined || prefersHttpMcpTransport(options.settings);
  const baseMakeRuntime =
    options.makeRuntime ??
    makeAcpRegistryRuntime(runtimeOptions, catalog, {
      onInitialized: (initializeResult) => {
        if (isDeepSeekHarnessAgentInfo(initializeResult)) {
          isDshRuntime = true;
        }
      },
    });
  const trackedMakeRuntime: AcpAdapterV2Flavor["makeRuntime"] = (input) => {
    activeWorkspaceCwd = input.cwd;
    return baseMakeRuntime(input);
  };
  const flavor: AcpAdapterV2Flavor = {
    driver: ACP_REGISTRY_PROVIDER,
    // Cancelling a Copilot prompt also kills the background agents it started.
    capabilities: isCopilot
      ? {
          ...AcpProviderCapabilitiesV2,
          turns: { ...AcpProviderCapabilitiesV2.turns, supportsSteeringByInterruptRestart: false },
        }
      : AcpProviderCapabilitiesV2,
    customModels: readCustomModelEntries(options.settings.customModels).map((entry) => entry.slug),
    compactViaAdvertisedCommand: true,
    rewriteUserText: (text, turnInput) => {
      if (!isDshRuntime) return Effect.succeed(text);
      return Effect.gen(function* () {
        const localSkills = discoverDshLocalSkills({
          ...(activeWorkspaceCwd === undefined ? {} : { cwd: activeWorkspaceCwd }),
          env: options.environment,
          platform: hostPlatform,
        });
        const advertised =
          runtimeCoordinator === undefined
            ? Option.none()
            : yield* runtimeCoordinator.getAvailableCommands(options.instanceId);
        const knownSkillNames = new Map<string, string>();
        for (const skill of localSkills) {
          if (skill.enabled && skill.userInvocable !== false) {
            knownSkillNames.set(skill.name.toLowerCase(), skill.name);
          }
        }
        if (Option.isSome(advertised)) {
          for (const skill of advertised.value.skills) {
            if (skill.enabled && skill.userInvocable !== false) {
              const key = skill.name.toLowerCase();
              if (!knownSkillNames.has(key)) {
                knownSkillNames.set(key, skill.name);
              }
            }
          }
        }
        return rewriteDshUserText(text, knownSkillNames, turnInput.inlineContextLength ?? 0);
      });
    },
    ...(isAntigravityCli ? { wakeOnDetachedRequest: true, replyEndsWithUsageUpdate: true } : {}),
    promptFailure: (cause) =>
      acpRegistryPromptFailure(isVibe ? "mistral-vibe" : registryAgentId, cause),
    ...(isDroid
      ? { extractElicitationForm: extractDroidElicitationForm }
      : isOpenCode
        ? { extractElicitationForm: extractOpenCodeElicitationForm }
        : {}),
    // glm-acp-agent is the one agent whose per-turn usage a live probe has verified.
    ...(isGlm ? { reportsPerTurnPromptUsage: true } : {}),
    ...(watchKimiPromptOutcome === undefined
      ? {}
      : {
          watchPromptOutcome: (sessionId: string) =>
            Effect.map(
              watchKimiPromptOutcome(sessionId),
              (check) => (result: EffectAcpSchema.PromptResponse) =>
                Effect.map(check(result), (failure) =>
                  failure === undefined
                    ? undefined
                    : { failure, threadDisposition: "reusable" as const },
                ),
            ),
        }),
    ...(isVibe ? { registerExtensions: registerMistralVibeAcpExtensions } : {}),
    ...(isClaude
      ? {
          followAgentWorkState: true,
          extractSubagentUpdate: extractClaudeSubagentUpdate,
          isProvisionalSubagentTool: isClaudeProvisionalSubagentTool,
          extractSubagentSessionEvent: extractClaudeSubagentSessionEvent,
        }
      : {}),
    // Hermes replies on the root session when a background process it started exits; no
    // prompt response follows, so the continuation ends on the deferred-finalize debounce.
    // Hermes is not in the public registry and may run through a wrapper, so only its
    // initialize reply identifies it. agy does the same and is known by its command.
    enablePostSettleContinuation: (initializeResult) =>
      isAntigravityCli || isHermes(initializeResult),
    deferFinalizeForBackgroundWork: (initializeResult) =>
      isAntigravityCli || isHermes(initializeResult),
    ...(isDevin
      ? {
          clientCapabilitiesMeta: {
            "cognition.ai/subagentSupport": true,
            "cognition.ai/messageGrouping": true,
          },
          normalizeSessionUpdate: normalizeDevinSessionUpdate,
          normalizeToolCall: normalizeDevinToolCall,
          extractSubagentUpdate: extractDevinSubagentUpdate,
          answerablePermissionOptions: devinAnswerablePermissionOptions,
        }
      : copilotRouting !== undefined
        ? {}
        : {
            normalizeSessionUpdate: (notification) =>
              isDshRuntime ? normalizeDshSessionUpdate(notification) : notification,
            normalizeToolCall: (toolCall) =>
              isDshRuntime ? normalizeDshToolCall(toolCall) : toolCall,
            extractProposedPlanMarkdown: (toolCall) =>
              isDshRuntime ? extractDshProposedPlanMarkdown(toolCall) : undefined,
            ...(!isClaude
              ? {
                  extractSubagentUpdate: (toolCall) =>
                    isDshRuntime ? extractDshSubagentUpdate(toolCall) : undefined,
                }
              : {}),
          }),
    ...(copilotRouting === undefined
      ? {}
      : {
          clientCapabilitiesMeta: copilotClientCapabilitiesMeta,
          deferMcpTools: true,
          registerExtensions: copilotRouting.registerExtensions,
          normalizeSessionUpdate: copilotRouting.normalizeSessionUpdate,
          extractSubagentUpdate: extractCopilotSubagentUpdate,
          restartRuntimeAfterPromptError: isCopilotLostSessionError,
          // A finished background agent wakes the root after assistant.idle settled the run.
          enablePostSettleContinuation: true,
          // session/new reports a built-in default, not the model Copilot runs (github/copilot-cli#5363).
          alwaysSetModel: true,
        }),
    mcpOverHttp: useHttpMcpServers,
    makeRuntime: trackedMakeRuntime,
    ...(runtimeCoordinator === undefined
      ? {}
      : {
          onAvailableCommandsUpdate: (commands) => {
            const normalized = normalizeAcpRegistryCommands(commands);
            const published = isDshRuntime
              ? augmentDshAvailableCommands(normalized, {
                  ...(activeWorkspaceCwd === undefined ? {} : { cwd: activeWorkspaceCwd }),
                  env: options.environment,
                  platform: hostPlatform,
                })
              : normalized;
            return runtimeCoordinator.publishAvailableCommands(options.instanceId, published);
          },
          // A new Copilot session starts at its own effort, not the one the composer shows.
          ...(isCopilot
            ? {
                unsetOptionDefaults: runtimeCoordinator
                  .getLiveConfiguration(options.instanceId)
                  .pipe(
                    Effect.map(
                      Option.match({
                        onNone: () => [],
                        onSome: ({ configOptions }) =>
                          configOptions.flatMap((descriptor) =>
                            descriptor.type === "select" &&
                            descriptor.role === "reasoning" &&
                            descriptor.currentValue !== undefined
                              ? [{ id: descriptor.id, value: descriptor.currentValue }]
                              : [],
                          ),
                      }),
                    ),
                  ),
              }
            : {}),
          onSessionConfigurationUpdate: (configOptions, modeState, modelState) =>
            runtimeCoordinator.publishLiveConfiguration(
              options.instanceId,
              normalizeAcpRegistryLiveConfiguration(configOptions, modeState, modelState),
            ),
          onUrlElicitation: ({ elicitationId, url, message }) => {
            const normalizedUrl = normalizeAcpRegistryWebUrl(url);
            if (normalizedUrl === undefined || elicitationId.trim().length === 0) {
              return Effect.succeed(false);
            }
            return runtimeCoordinator.requestUrlAuthentication(options.instanceId, {
              elicitationId: elicitationId.trim().slice(0, 256),
              url: normalizedUrl,
              message: message.trim().slice(0, 1_024),
            });
          },
          withRuntimeStartup: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
            runtimeCoordinator.withForegroundStartup(startupKey, effect),
        }),
    ...(options.assertComplete === undefined ? {} : { assertComplete: options.assertComplete }),
  };
  return yield* makeAcpAdapterV2({
    instanceId: options.instanceId,
    flavor,
    selfInvocation: options.selfInvocation,
    ...(options.continuationRequests === undefined
      ? {}
      : { continuationRequests: options.continuationRequests }),
    // Devin runs commands through client terminals and has no ask mode over ACP to fall back on.
    ...(isDevin
      ? {
          clientTerminals: {
            environment: options.environment,
            shellCommands: true,
          },
        }
      : {}),
    ...(options.nativeLogging === undefined ? {} : { nativeLogging: options.nativeLogging }),
  });
});

export type AcpRegistryAdapterV2DriverEnv =
  | ChildProcessSpawner.ChildProcessSpawner
  | SecureRandom.SecureRandom
  | FileSystem.FileSystem
  | AcpRegistrySupport.AcpRegistryCatalog
  | IdAllocator.IdAllocatorV2
  | Path.Path
  | McpProviderSessions.McpProviderSessions
  | ProviderEventLoggers.ProviderEventLoggers
  | ProviderHost.ProviderHost;

export const AcpRegistryAdapterV2Driver: ProviderAdapterDriver<
  AcpRegistrySettings,
  AcpRegistryAdapterV2DriverEnv
> = {
  driverKind: ACP_REGISTRY_PROVIDER,
  configSchema: AcpRegistrySettings,
  defaultConfig: (): AcpRegistrySettings => DEFAULT_ACP_REGISTRY_SETTINGS,
  create: Effect.fn("AcpRegistryAdapterV2Driver.create")(
    function* (input: ProviderAdapterDriverCreateInput<AcpRegistrySettings>) {
      const hostEnvironment = yield* HostProcess.Environment;
      const selfInvocation = yield* resolveSelfInvocation();
      const providerEventLoggers = yield* ProviderEventLoggers.ProviderEventLoggers;
      const makeNativeLogger = yield* makeAcpNativeLoggerFactory();
      return yield* makeAcpRegistryAdapterV2({
        instanceId: input.instanceId,
        settings: { ...input.config, enabled: input.enabled },
        environment: yield* mergeProviderInstanceEnvironment(input.environment, hostEnvironment),
        selfInvocation,
        continuationRequests: yield* ProviderContinuationRequests.ProviderContinuationRequests,
        nativeLogging: (threadId) =>
          makeNativeLogger({
            nativeEventLogger: providerEventLoggers.native,
            provider: ACP_REGISTRY_PROVIDER,
            threadId,
          }),
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new ProviderAdapterDriverCreateError({
              driver: ACP_REGISTRY_PROVIDER,
              instanceId: input.instanceId,
              detail: "Failed to create ACP Registry adapter.",
              cause,
            }),
        ),
      ),
  ),
};
