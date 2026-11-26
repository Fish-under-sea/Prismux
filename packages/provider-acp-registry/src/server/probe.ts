import { resolveProviderProbeTimeoutMs } from "@prismux/provider-core/server/snapshotProbe";
import {
  AcpRegistryListProvidersResult,
  AcpRegistryOperationError,
  AcpRegistryListSessionsResult,
  AcpRegistryProbeResult,
  type AcpRegistryProbeAuthMethod,
  type AcpRegistryProbeModel,
  type AcpRegistryUrlAuthAction,
  type ProviderInstanceId,
  type ProviderOptionChoice,
  type ProviderOptionDescriptor,
  type ServerProviderSkill,
  type ServerProviderSlashCommand,
} from "@prismux/core-contracts";
import { AcpRegistrySettings } from "../settings.ts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import type * as EffectAcpErrors from "@prismux/effect-acp/errors";
import type * as EffectAcpSchema from "@prismux/effect-acp/compat";

import * as HostProcess from "@prismux/core-shared/HostProcess";
import * as PtyAdapter from "@prismux/core-shared/PtyAdapter";
import * as AcpRegistrySupport from "./AcpRegistrySupport.ts";
import {
  findModelConfigOption,
  parseSessionModeState,
} from "@prismux/provider-acp/server/runtimeModel";
import {
  ACP_EMPTY_OPTION_VALUE,
  acpProviderOptionDescriptors,
  flattenSelectChoices,
  isAcpThoughtLevelOption,
} from "@prismux/provider-acp/server/sessionConfig";
import * as AcpRegistryRuntimeCoordinator from "./AcpRegistryRuntimeCoordinator.ts";
import * as AcpSessionRuntime from "@prismux/provider-acp/server/AcpSessionRuntime";
import {
  findDeepSeekCliArgStart,
  isDeepSeekHarnessSpawn,
  resolveDshInstalledVersion,
  selectPreferredDshVersion,
} from "./dshLocal.ts";
import { isDeepSeekHarnessAgentInfo } from "./dshAcp.ts";
import { augmentDshAvailableCommands } from "./dshSkills.ts";

const MAX_AUTH_METHODS = 32;
const MAX_MODELS = 256;
const MAX_PROBED_THINKING_MODELS = 24;
const MAX_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 160;
const MAX_DESCRIPTION_LENGTH = 1_024;
const MAX_COMMAND_LINE_LENGTH = 2_048;
const PROBE_TIMEOUT_MS = 60_000;
const COMMAND_ADVERTISEMENT_GRACE = "1200 millis";
// Agents that fetch their catalog after session setup (Qoder CLI, OpenCode)
// settle it in seconds, not milliseconds; commands arrive much sooner.
const MODEL_ADVERTISEMENT_GRACE = "5 seconds";
const PER_MODEL_THINKING_PROBE_TIMEOUT = "4 seconds";
const TOTAL_THINKING_PROBE_TIMEOUT = "15 seconds";
const PROBE_SESSION_DELETE_TIMEOUT = "5 seconds";
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const boundedText = (value: string, maximumLength: number): string =>
  value.trim().slice(0, maximumLength);

const boundedOpaqueValue = (value: string, maximumLength: number): string | undefined =>
  value.length > 0 && value === value.trim() && value.length <= maximumLength ? value : undefined;

const REASONING_OPTION_DESCRIPTOR_IDS = new Set([
  "effort",
  "reasoningEffort",
  "reasoning_effort",
  "thought_level",
  "thinking_level",
  "thinking",
  "variant",
]);

const PHANTOM_REASONING_CHOICE_IDS = new Set([
  "",
  ACP_EMPTY_OPTION_VALUE.toLowerCase(),
  "default",
  "t3:default",
  "provider_default",
  "provider-default",
  "providerdefault",
  "provider default",
  "model_default",
  "model-default",
  "modeldefault",
  "model default",
  "system_default",
  "system-default",
  "systemdefault",
  "system default",
  "agent_default",
  "agent-default",
  "agentdefault",
  "agent default",
  "unset",
  "inherit",
]);

const PHANTOM_REASONING_CHOICE_LABELS = new Set([
  "",
  "default",
  "provider default",
  "model default",
  "system default",
  "agent default",
  "use default",
  "use provider default",
  "默认",
  "提供商默认",
  "模型默认",
  "系统默认",
]);

/**
 * Identifies phantom/sentinel placeholder choices (such as DeepSeek Harness / ACP
 * `"Provider default"`, `"provider_default"`, `"default"`, or empty `""` / `_t3/empty`)
 * that should not appear alongside concrete reasoning effort levels.
 */
export function isPhantomReasoningEffortChoice(choice: {
  readonly id: string;
  readonly label?: string | null | undefined;
}): boolean {
  const normalizedId = choice.id.trim().toLowerCase();
  if (PHANTOM_REASONING_CHOICE_IDS.has(normalizedId)) {
    return true;
  }
  const normalizedLabel = (choice.label ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/gu, " ");
  if (
    PHANTOM_REASONING_CHOICE_LABELS.has(normalizedLabel) ||
    /^provider default(?:\s*\(|$)/u.test(normalizedLabel)
  ) {
    return true;
  }
  return false;
}

function resolveConcreteReasoningFallbackId(
  concreteOptions: ReadonlyArray<ProviderOptionChoice>,
): string | undefined {
  if (concreteOptions.length === 0) return undefined;
  const markedDefault = concreteOptions.find((choice) => choice.isDefault);
  if (markedDefault) return markedDefault.id;
  const medium = concreteOptions.find((choice) => choice.id.trim().toLowerCase() === "medium");
  if (medium) return medium.id;
  const high = concreteOptions.find((choice) => choice.id.trim().toLowerCase() === "high");
  if (high) return high.id;
  return concreteOptions[Math.floor((concreteOptions.length - 1) / 2)]?.id;
}

/**
 * Strips phantom `"Provider default"` / `"default"` / empty sentinel choices from a reasoning
 * effort select descriptor whenever concrete effort levels exist, and cleanly re-homes
 * `currentValue` onto a real concrete level if it pointed at a stripped sentinel.
 */
export function sanitizeAcpReasoningDescriptor<T extends ProviderOptionDescriptor>(
  descriptor: T,
): T {
  if (descriptor.type !== "select") {
    return descriptor;
  }
  const isReasoning =
    descriptor.role === "reasoning" ||
    REASONING_OPTION_DESCRIPTOR_IDS.has(descriptor.id.trim());
  if (!isReasoning || descriptor.options.length === 0) {
    return descriptor;
  }
  const concreteOptions = descriptor.options.filter(
    (choice) => !isPhantomReasoningEffortChoice(choice),
  );
  if (concreteOptions.length === 0) {
    return descriptor;
  }
  const removedPhantom = concreteOptions.length !== descriptor.options.length;
  const currentValueIsPhantom =
    descriptor.currentValue !== undefined &&
    isPhantomReasoningEffortChoice({ id: descriptor.currentValue, label: "" });
  if (!removedPhantom && !currentValueIsPhantom) {
    return descriptor;
  }
  const currentMatchesConcrete =
    descriptor.currentValue !== undefined &&
    concreteOptions.some((choice) => choice.id === descriptor.currentValue);
  const nextCurrentValue = currentMatchesConcrete
    ? descriptor.currentValue
    : resolveConcreteReasoningFallbackId(concreteOptions);
  return {
    ...descriptor,
    options: concreteOptions,
    ...(nextCurrentValue !== undefined ? { currentValue: nextCurrentValue } : {}),
  } as T;
}

export function sanitizeAcpOptionDescriptors(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
): ReadonlyArray<ProviderOptionDescriptor> {
  return descriptors.map((descriptor) => sanitizeAcpReasoningDescriptor(descriptor));
}

function extractReasoningDescriptor(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null | undefined,
): NonNullable<AcpRegistryProbeModel["reasoningEffort"]> | null {
  const found =
    acpProviderOptionDescriptors({ configOptions, modeState: undefined }).find(
      (descriptor) => descriptor.type === "select" && descriptor.role === "reasoning",
    ) ?? null;
  return found ? sanitizeAcpReasoningDescriptor(found) : null;
}

/**
 * The session's reasoning option with the levels a model advertises in `_meta`, in the
 * shape Grok uses. Null when the model has none, undefined when it says nothing.
 */
function advertisedReasoningEffort(
  option: EffectAcpSchema.SessionConfigOption | undefined,
  meta: Readonly<Record<string, unknown>> | null | undefined,
): AcpRegistryProbeModel["reasoningEffort"] {
  if (option?.type !== "select" || meta == null) return undefined;
  if (meta.supportsReasoningEffort === false) return null;
  if (!Array.isArray(meta.reasoningEfforts)) return undefined;
  const options = meta.reasoningEfforts.flatMap((level: unknown) =>
    typeof level === "object" &&
    level !== null &&
    "value" in level &&
    typeof level.value === "string"
      ? [
          {
            value: level.value,
            name: "label" in level && typeof level.label === "string" ? level.label : level.value,
          },
        ]
      : [],
  );
  const currentValue = typeof meta.reasoningEffort === "string" ? meta.reasoningEffort : "";
  const descriptor =
    acpProviderOptionDescriptors({
      configOptions: [{ ...option, options, currentValue }],
      modeState: undefined,
    })[0] ?? null;
  return descriptor ? sanitizeAcpReasoningDescriptor(descriptor) : null;
}

export function normalizeAcpRegistryWebUrl(value: string): string | undefined {
  if (value.length > 2_048 || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
}

function normalizedModel(id: string, candidate: AcpRegistryProbeModel): AcpRegistryProbeModel {
  return {
    id,
    name: boundedText(candidate.name, MAX_NAME_LENGTH) || id,
    description:
      candidate.description === null
        ? null
        : boundedText(candidate.description, MAX_DESCRIPTION_LENGTH) || null,
  };
}

function normalizeModels(
  candidates: ReadonlyArray<AcpRegistryProbeModel>,
  currentModelId: string | null,
): ReadonlyArray<AcpRegistryProbeModel> {
  const seen = new Set<string>();
  const models: Array<AcpRegistryProbeModel> = [];
  for (const candidate of candidates) {
    if (models.length === MAX_MODELS) break;
    const id = boundedOpaqueValue(candidate.id, MAX_ID_LENGTH);
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    models.push(normalizedModel(id, candidate));
  }
  // Keep the running model visible even when its advertised position exceeds the cap.
  if (currentModelId !== null && models.length === MAX_MODELS && !seen.has(currentModelId)) {
    const current = candidates.find((candidate) => candidate.id === currentModelId);
    if (current !== undefined) {
      models[MAX_MODELS - 1] = normalizedModel(currentModelId, current);
    }
  }
  return models;
}

export interface AcpRegistryAuthSpawnContext {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

const SHELL_SAFE_TOKEN = /^[A-Za-z0-9_@%+=:,./-]+$/u;

function shellDisplayToken(token: string): string {
  return SHELL_SAFE_TOKEN.test(token) ? token : `'${token.replaceAll("'", `'\\''`)}'`;
}

function terminalAuthCommand(
  method: Extract<EffectAcpSchema.AuthMethod, { readonly type: "terminal" }>,
  spawn: AcpRegistryAuthSpawnContext,
): string | undefined {
  const environmentPrefix = Object.entries(method.env ?? {}).map(
    ([name, value]) => `${name}=${shellDisplayToken(value)}`,
  );
  const command = [spawn.command, ...spawn.args, ...(method.args ?? [])].map(shellDisplayToken);
  const displayCommand = [...environmentPrefix, ...command].join(" ");
  return displayCommand.length <= MAX_COMMAND_LINE_LENGTH ? displayCommand : undefined;
}

export function normalizeAcpRegistryAuthMethods(
  methods: ReadonlyArray<EffectAcpSchema.AuthMethod> | undefined,
  spawn?: AcpRegistryAuthSpawnContext,
): ReadonlyArray<AcpRegistryProbeAuthMethod> {
  const normalized: Array<AcpRegistryProbeAuthMethod> = [];
  for (const method of methods ?? []) {
    const id = boundedOpaqueValue(method.id, MAX_ID_LENGTH);
    if (id === undefined) continue;
    const type = method.type ?? "agent";
    const envVarNames =
      type === "env_var" && "vars" in method
        ? method.vars
            .flatMap((variable) => {
              const name = boundedOpaqueValue(variable.name, MAX_ID_LENGTH);
              return name === undefined ? [] : [name];
            })
            .slice(0, 16)
        : [];
    const command =
      spawn !== undefined && "type" in method && method.type === "terminal"
        ? terminalAuthCommand(method, spawn)
        : undefined;
    const link =
      type === "env_var" && "link" in method && method.link
        ? normalizeAcpRegistryWebUrl(method.link)
        : undefined;
    normalized.push({
      id,
      name: boundedText(method.name, MAX_NAME_LENGTH) || id,
      description:
        method.description == null
          ? null
          : boundedText(method.description, MAX_DESCRIPTION_LENGTH) || null,
      type,
      ...(command === undefined ? {} : { command }),
      ...(envVarNames.length > 0 ? { envVarNames } : {}),
      ...(link === undefined ? {} : { link }),
    });
    if (normalized.length === MAX_AUTH_METHODS) break;
  }
  return normalized;
}

export interface AcpRegistryAvailableCommands {
  readonly slashCommands: ReadonlyArray<ServerProviderSlashCommand>;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
}

export interface AcpRegistryLiveConfiguration {
  readonly models: ReadonlyArray<AcpRegistryProbeModel>;
  readonly currentModelId: string | null;
  readonly configOptions: AcpRegistryProbeResult["configOptions"];
  readonly modelOptionIds?: NonNullable<AcpRegistryProbeResult["modelOptionIds"]>;
  // A single model from an explicit select is the agent's deliberate catalog
  // (e.g. an entitlement change), not a cold-start placeholder.
  readonly modelsFromModelSelect?: boolean;
}

export function normalizeAcpRegistryLiveConfiguration(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption>,
  modeState?: Parameters<typeof acpProviderOptionDescriptors>[0]["modeState"],
  modelState?: EffectAcpSchema.SessionModelState | null,
): AcpRegistryLiveConfiguration {
  const modelOption = findModelConfigOption(configOptions);
  const currentModelId =
    modelOption?.type === "select" ? modelOption.currentValue : modelState?.currentModelId;
  const candidates =
    modelOption === undefined
      ? (modelState?.availableModels ?? []).map((model) => ({
          id: model.modelId,
          name: model.name,
          description: model.description ?? null,
        }))
      : flattenSelectChoices(modelOption.options).map((model) => ({
          id: model.value,
          name: model.name,
          description: model.description ?? null,
        }));
  const boundedCurrentModelId =
    currentModelId === undefined
      ? null
      : (boundedOpaqueValue(currentModelId, MAX_ID_LENGTH) ?? null);
  const effortOption =
    configOptions.find((option) => option.category === "thought_level") ??
    configOptions.find(isAcpThoughtLevelOption);
  const models = normalizeModels(candidates, boundedCurrentModelId).map((model) => {
    const reasoningEffort = advertisedReasoningEffort(
      effortOption,
      modelState?.availableModels.find((info) => info.modelId === model.id)?._meta,
    );
    return reasoningEffort === undefined ? model : { ...model, reasoningEffort };
  });
  const descriptors = sanitizeAcpOptionDescriptors(
    acpProviderOptionDescriptors({ configOptions, modeState }),
  );
  const modelOptionIds = new Set(
    configOptions
      .filter((option) => isAcpThoughtLevelOption(option) || option.category === "model_config")
      .map((option) => option.id),
  );
  return {
    models,
    currentModelId: models.some((model) => model.id === boundedCurrentModelId)
      ? boundedCurrentModelId
      : null,
    configOptions: descriptors,
    modelOptionIds: descriptors
      .filter((descriptor) => modelOptionIds.has(descriptor.id))
      .map((descriptor) => descriptor.id),
    modelsFromModelSelect: modelOption !== undefined,
  };
}

const emptyAcpRegistryAvailableCommands = (): AcpRegistryAvailableCommands => ({
  slashCommands: [],
  skills: [],
});

export function acpRegistryAdvertisesModelCatalog(
  configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> | null | undefined,
  modelState?: EffectAcpSchema.SessionModelState | null,
): boolean {
  const modelOption = findModelConfigOption(configOptions);
  return (
    (modelOption !== undefined && flattenSelectChoices(modelOption.options).length > 1) ||
    (modelState?.availableModels?.length ?? 0) > 1
  );
}

function isAdvertisedSkillMeta(meta: unknown): boolean {
  if (meta === null || typeof meta !== "object" || Array.isArray(meta)) return false;
  const record = meta as Record<string, unknown>;
  return (
    record.isSkill === true ||
    record.kind === "skill" ||
    record.type === "skill" ||
    record.category === "skill"
  );
}

export function normalizeAcpRegistryCommands(
  commands: ReadonlyArray<EffectAcpSchema.AvailableCommand>,
): AcpRegistryAvailableCommands {
  const seenSlash = new Set<string>();
  const seenSkills = new Set<string>();
  const slashCommands: Array<ServerProviderSlashCommand> = [];
  const skills: Array<ServerProviderSkill> = [];
  for (const command of commands) {
    const trimmedRaw = command.name.trim();
    if (trimmedRaw.length === 0) continue;
    const withoutLeadingSlash = trimmedRaw.replace(/^\/+/u, "");
    if (withoutLeadingSlash.length === 0) continue;
    const description = boundedText(command.description ?? "", MAX_DESCRIPTION_LENGTH);
    const hint = command.input ? boundedText(command.input.hint ?? "", MAX_DESCRIPTION_LENGTH) : "";
    const metaSkill = isAdvertisedSkillMeta("_meta" in command ? command._meta : undefined);
    const isDollarSkill = withoutLeadingSlash.startsWith("$");
    const isPrefixedSkill = /^skill:/iu.test(withoutLeadingSlash);

    if (isDollarSkill || isPrefixedSkill || metaSkill) {
      const rawSkillName = isDollarSkill
        ? withoutLeadingSlash.slice(1)
        : isPrefixedSkill
          ? withoutLeadingSlash.slice("skill:".length)
          : withoutLeadingSlash;
      const skillName = boundedOpaqueValue(rawSkillName.trim(), MAX_ID_LENGTH);
      if (skillName === undefined) continue;
      const key = skillName.toLowerCase();
      if (seenSkills.has(key)) continue;
      seenSkills.add(key);
      skills.push({
        name: skillName,
        ...(description ? { description } : {}),
        path: `acp://skill/${encodeURIComponent(skillName)}`,
        scope: "agent",
        enabled: true,
      });
    } else {
      const name = boundedOpaqueValue(withoutLeadingSlash, MAX_ID_LENGTH);
      if (name === undefined) continue;
      const key = name.toLowerCase();
      if (seenSlash.has(key)) continue;
      seenSlash.add(key);
      slashCommands.push({
        name,
        ...(description ? { description } : {}),
        ...(hint ? { input: { hint } } : {}),
      });
    }
  }
  return { slashCommands, skills };
}

export function acpRegistryProbeResult(
  instanceId: ProviderInstanceId,
  started: AcpSessionRuntime.AcpSessionRuntimeStartResult,
  icon: string | null = null,
  spawn?: AcpRegistryAuthSpawnContext,
  liveConfiguration?: AcpRegistryLiveConfiguration,
  agentVersionOverride?: string | null,
): AcpRegistryProbeResult {
  const configuration =
    liveConfiguration ??
    normalizeAcpRegistryLiveConfiguration(
      started.sessionSetupResult.configOptions ?? [],
      parseSessionModeState(started.sessionSetupResult),
      started.sessionSetupResult.models,
    );
  const rawAgentVersion =
    agentVersionOverride?.trim() || started.initializeResult.agentInfo?.version?.trim() || "";
  return AcpRegistryProbeResult.make({
    instanceId,
    ready: true,
    icon,
    ...(rawAgentVersion ? { agentVersion: boundedText(rawAgentVersion, MAX_ID_LENGTH) } : {}),
    authMethods: normalizeAcpRegistryAuthMethods(started.initializeResult.authMethods, spawn),
    sessionManagement: {
      canList: started.initializeResult.agentCapabilities?.sessionCapabilities?.list != null,
      canLoad: started.initializeResult.agentCapabilities?.loadSession === true,
      canResume: started.initializeResult.agentCapabilities?.sessionCapabilities?.resume != null,
      canLogout: started.initializeResult.agentCapabilities?.auth?.logout != null,
      canDelete: started.initializeResult.agentCapabilities?.sessionCapabilities?.delete != null,
      canConfigureProviders: started.initializeResult.agentCapabilities?.providers != null,
    },
    ...configuration,
  });
}

export function acpRegistryProbeFailure(
  error: EffectAcpErrors.AcpError,
  authMethods: ReadonlyArray<AcpRegistryProbeAuthMethod> = [],
  authAction?: AcpRegistryUrlAuthAction,
): AcpRegistryOperationError {
  const detail = error._tag === "AcpTransportError" && error.detail ? error.detail : error.message;
  const authenticationFailed =
    (error._tag === "AcpRequestError" && error.code === -32000) ||
    /\b(?:authenticat(?:e|ed|es|ing|ion)|credentials?|log(?:[\s-]+)?in)\b/iu.test(detail);
  return new AcpRegistryOperationError({
    reason: authenticationFailed ? "authentication_failed" : "probe_failed",
    message: authenticationFailed
      ? "The ACP agent could not complete authentication."
      : "The ACP agent could not create a test session.",
    cause: error,
    ...(authMethods.length > 0 ? { authMethods } : {}),
    ...(authAction === undefined ? {} : { authAction }),
  });
}

export interface AcpRegistryConfigurationProbeInput {
  readonly instanceId: ProviderInstanceId;
  readonly settings: AcpRegistrySettings;
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
}

type AcpRegistryManagementInput = AcpRegistryConfigurationProbeInput;

export interface AcpRegistryConfigurationProbeResult {
  readonly probe: AcpRegistryProbeResult;
  readonly slashCommands: ReadonlyArray<ServerProviderSlashCommand>;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
}

export type AcpRegistryConfigurationProbe<Requirements = never> = (
  input: AcpRegistryConfigurationProbeInput,
) => Effect.Effect<AcpRegistryConfigurationProbeResult, AcpRegistryOperationError, Requirements>;

export const isolateDeepSeekProbeHistory = Effect.fn("AcpRegistryProbe.isolateDeepSeekProbeHistory")(
  function* (commandPath: string, spawn: AcpSessionRuntime.AcpSpawnInput) {
    if (!isDeepSeekHarnessSpawn(commandPath || spawn.command, spawn.args)) return spawn;

    const argumentSeparator = spawn.args.indexOf("--");
    const launcherArgs =
      argumentSeparator === -1 ? spawn.args : spawn.args.slice(0, argumentSeparator);
    const cliArgs = launcherArgs.slice(findDeepSeekCliArgStart(launcherArgs));
    const usesAcpProfile =
      cliArgs[0] === "acp" ||
      cliArgs.includes("--profile=acp") ||
      cliArgs.some((arg, index) => arg === "--profile" && cliArgs[index + 1] === "acp");
    if (!usesAcpProfile) return spawn;

    // DeepSeek persists session/new before any prompt and does not advertise session/delete.
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "prismux-dsh-acp-probe-" });
    const patchPath = path.join(directory, "probe.json");
    const patch = yield* encodeJson([
      { id: "session-persistence-jsonl", config: { root: path.join(directory, "sessions") } },
      { id: "session-projection-cache", disabled: true },
    ]);
    yield* fs.writeFileString(patchPath, patch);
    return {
      ...spawn,
      args: [...launcherArgs, "--patch", patchPath, ...spawn.args.slice(launcherArgs.length)],
    };
  },
);

export const probeAcpRegistryConfiguration = Effect.fn("AcpRegistryProbe.probeConfiguration")(
  function* (
    input: AcpRegistryConfigurationProbeInput,
  ): Effect.fn.Return<
    AcpRegistryConfigurationProbeResult,
    AcpRegistryOperationError,
    | AcpRegistrySupport.AcpRegistryCatalog
    | ChildProcessSpawner.ChildProcessSpawner
    | FileSystem.FileSystem
    | Path.Path
    | SecureRandom.SecureRandom
  > {
    const catalog = yield* AcpRegistrySupport.AcpRegistryCatalog;
    const probeTimeoutMs = resolveProviderProbeTimeoutMs(
      "acp_registry",
      PROBE_TIMEOUT_MS,
      input.environment,
    );
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const random = yield* SecureRandom.SecureRandom;
    const pty = yield* Effect.serviceOption(PtyAdapter.PtyAdapter);

    const result = yield* Effect.gen(function* () {
      // Resolution may install packages; bound it by the probe deadline.
      const resolved = yield* catalog
        .resolve(input.settings, input.cwd, input.environment)
        .pipe(Effect.mapError(AcpRegistrySupport.toAcpRegistryOperationError));
      const spawn = yield* isolateDeepSeekProbeHistory(
        input.settings.commandPath,
        resolved.spawn,
      ).pipe(
        Effect.mapError(
          (cause) =>
            new AcpRegistryOperationError({
              reason: "probe_failed",
              message: "Could not prepare temporary history for the DeepSeek Harness probe.",
              cause,
            }),
        ),
      );
      const authMethodsRef = yield* Ref.make<ReadonlyArray<AcpRegistryProbeAuthMethod>>([]);
      const authActionRef = yield* Ref.make<AcpRegistryUrlAuthAction | undefined>(undefined);
      const runtimeCoordinator = yield* Effect.serviceOption(
        AcpRegistryRuntimeCoordinator.AcpRegistryRuntimeCoordinator,
      );
      const runtimeContext = yield* Layer.build(
        AcpSessionRuntime.layer({
          spawn,
          cwd: input.cwd,
          clientCapabilities: {
            auth: { terminal: Option.isSome(pty) },
            elicitation: { url: {} },
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
          clientInfo: { name: "prismux-provider-test", version: "0.0.0" },
          authenticateOnAuthRequired: false,
          onInitialized: (initializeResult) =>
            Ref.set(
              authMethodsRef,
              normalizeAcpRegistryAuthMethods(initializeResult.authMethods, {
                command: resolved.spawn.command,
                args: resolved.spawn.args,
              }),
            ),
          ...(input.settings.authMethodId ? { authMethodId: input.settings.authMethodId } : {}),
        }).pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner),
              Layer.succeed(SecureRandom.SecureRandom, random),
            ),
          ),
        ),
      );
      const runtime = yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
        Effect.provide(runtimeContext),
      );
      const commandsRef = yield* Ref.make<AcpRegistryAvailableCommands>(
        emptyAcpRegistryAvailableCommands(),
      );
      const commandsAdvertised = yield* Deferred.make<void>();
      const configOptionsRef = yield* Ref.make<
        ReadonlyArray<EffectAcpSchema.SessionConfigOption> | undefined
      >(undefined);
      const modelsAdvertised = yield* Deferred.make<void>();
      yield* runtime.handleElicitation((request) =>
        Effect.gen(function* () {
          if (
            request.mode !== "url" ||
            !("url" in request) ||
            !("elicitationId" in request) ||
            typeof request.url !== "string" ||
            typeof request.elicitationId !== "string"
          ) {
            return { action: "decline" } as const;
          }
          const url = normalizeAcpRegistryWebUrl(request.url);
          const elicitationId = boundedOpaqueValue(request.elicitationId, MAX_ID_LENGTH);
          if (url === undefined || elicitationId === undefined) {
            return { action: "decline" } as const;
          }
          const action: AcpRegistryUrlAuthAction = {
            elicitationId,
            url,
            message: boundedText(request.message, MAX_DESCRIPTION_LENGTH),
          };
          yield* Ref.set(authActionRef, action);
          const accepted = yield* Option.match(runtimeCoordinator, {
            onNone: () => Effect.succeed(false),
            onSome: (coordinator) => coordinator.requestUrlAuthentication(input.instanceId, action),
          });
          return accepted ? ({ action: "accept" } as const) : ({ action: "decline" } as const);
        }),
      );
      yield* runtime.handleSessionUpdate((notification) => {
        const update = notification.update;
        if (update.sessionUpdate === "available_commands_update") {
          const normalized = normalizeAcpRegistryCommands(update.availableCommands);
          const hasEntries =
            normalized.slashCommands.length > 0 || normalized.skills.length > 0;
          return Ref.set(commandsRef, normalized).pipe(
            Effect.andThen(
              hasEntries
                ? Deferred.succeed(commandsAdvertised, undefined).pipe(Effect.asVoid)
                : Effect.void,
            ),
          );
        }
        if (update.sessionUpdate === "config_option_update") {
          const hasAdvertisedModels = acpRegistryAdvertisesModelCatalog(update.configOptions);
          return Ref.set(configOptionsRef, update.configOptions).pipe(
            Effect.andThen(
              hasAdvertisedModels
                ? Deferred.succeed(modelsAdvertised, undefined).pipe(Effect.asVoid)
                : Effect.void,
            ),
          );
        }
        return Effect.void;
      });
      const startResult = yield* Effect.result(runtime.start());
      if (Result.isFailure(startResult)) {
        return yield* acpRegistryProbeFailure(
          startResult.failure,
          yield* Ref.get(authMethodsRef),
          yield* Ref.get(authActionRef),
        );
      }
      const started = startResult.success;
      // Agents that persist sessions (OpenCode) would otherwise keep one empty session per probe.
      // Prefer session/delete when advertised; fall back to session/close (e.g. DeepSeek Harness)
      // for clean quiescent session teardown.
      yield* Effect.addFinalizer(() => {
        const caps = started.initializeResult.agentCapabilities?.sessionCapabilities;
        const cleanup =
          caps?.delete != null
            ? runtime.deleteSession(started.sessionId)
            : caps?.close != null
              ? runtime.closeSession(started.sessionId)
              : Effect.void;
        return cleanup.pipe(Effect.timeoutOption(PROBE_SESSION_DELETE_TIMEOUT), Effect.ignore);
      });
      const hasInitialModels = acpRegistryAdvertisesModelCatalog(
        started.sessionSetupResult.configOptions,
        started.sessionSetupResult.models,
      );

      yield* Effect.all(
        [
          hasInitialModels
            ? Effect.void
            : Deferred.await(modelsAdvertised).pipe(
                Effect.timeoutOption(MODEL_ADVERTISEMENT_GRACE),
              ),
          Deferred.await(commandsAdvertised).pipe(
            Effect.timeoutOption(COMMAND_ADVERTISEMENT_GRACE),
          ),
        ],
        { concurrency: "unbounded" },
      );

      // config_option_update replaces the full option set, so an empty notice is authoritative.
      const initialConfigOptions =
        (yield* Ref.get(configOptionsRef)) ?? (yield* runtime.getConfigOptions);
      let liveConfiguration = normalizeAcpRegistryLiveConfiguration(
        initialConfigOptions,
        (yield* runtime.getModeState) ?? parseSessionModeState(started.sessionSetupResult),
        started.sessionSetupResult.models,
      );

      // ACP reports thought_level only for the active model unless each model advertises it in
      // `_meta`. For compact model-select catalogs (e.g., agy acp, Mistral Vibe), cycle once to
      // observe every model's thinking levels while keeping the probe bounded.
      const isLocalAgy =
        input.settings.source === "local" &&
        /^agy(\.exe|\.cmd)?$/i.test(input.settings.commandPath.split(/[\\/]/).pop() ?? "");
      const shouldProbePerModelThinking =
        liveConfiguration.modelsFromModelSelect === true &&
        liveConfiguration.currentModelId !== null &&
        liveConfiguration.models.length > 1 &&
        liveConfiguration.models.length <= MAX_PROBED_THINKING_MODELS &&
        liveConfiguration.models.every(
          (model) =>
            model.id === liveConfiguration.currentModelId || model.reasoningEffort === undefined,
        ) &&
        (initialConfigOptions.some(isAcpThoughtLevelOption) ||
          started.initializeResult.agentInfo?.name === "antigravity-acp" ||
          isLocalAgy);

      if (shouldProbePerModelThinking && liveConfiguration.currentModelId !== null) {
        const initialModelId = liveConfiguration.currentModelId;
        const observedReasoning = new Map<string, AcpRegistryProbeModel["reasoningEffort"]>([
          [initialModelId, extractReasoningDescriptor(initialConfigOptions)],
        ]);
        let switched = false;
        yield* Effect.gen(function* () {
          for (const model of liveConfiguration.models) {
            if (model.id === initialModelId) continue;
            yield* Ref.set(configOptionsRef, undefined);
            const switchedModel = yield* runtime.setModel(model.id).pipe(
              Effect.timeoutOption(PER_MODEL_THINKING_PROBE_TIMEOUT),
              Effect.map(Option.isSome),
              Effect.orElseSucceed(() => false),
            );
            if (!switchedModel) continue;
            switched = true;
            const latestOptions =
              (yield* Ref.get(configOptionsRef)) ?? (yield* runtime.getConfigOptions);
            const latestModelId = findModelConfigOption(latestOptions)?.currentValue;
            if (latestModelId === undefined || latestModelId === model.id) {
              observedReasoning.set(model.id, extractReasoningDescriptor(latestOptions));
            }
          }
        }).pipe(Effect.timeoutOption(TOTAL_THINKING_PROBE_TIMEOUT));
        if (switched) {
          yield* runtime
            .setModel(initialModelId)
            .pipe(Effect.timeoutOption(PER_MODEL_THINKING_PROBE_TIMEOUT), Effect.ignore);
        }
        liveConfiguration = {
          ...liveConfiguration,
          models: liveConfiguration.models.map((model) =>
            observedReasoning.has(model.id)
              ? { ...model, reasoningEffort: observedReasoning.get(model.id) ?? null }
              : model,
          ),
        };
      }

      const rawCommands = yield* Ref.get(commandsRef);
      const platform = yield* HostProcess.Platform;
      const isDsh =
        isDeepSeekHarnessSpawn(input.settings.commandPath || resolved.spawn.command, resolved.spawn.args) ||
        isDeepSeekHarnessAgentInfo(started.initializeResult);
      const commands = isDsh
        ? augmentDshAvailableCommands(rawCommands, {
            cwd: input.cwd,
            env: resolved.spawn.env ?? input.environment,
            platform,
          })
        : rawCommands;

      const installedDshVersion = isDsh
        ? resolveDshInstalledVersion({
            command: resolved.spawn.command,
            args: resolved.spawn.args,
            env: resolved.spawn.env ?? input.environment,
            platform,
          })
        : undefined;
      const preferredAgentVersion = isDsh
        ? selectPreferredDshVersion(
            installedDshVersion,
            started.initializeResult.agentInfo?.version,
          )
        : undefined;

      return {
        resolved,
        started,
        commands,
        liveConfiguration,
        preferredAgentVersion,
      };
    }).pipe(
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: probeTimeoutMs,
        orElse: () =>
          Effect.fail(
            new AcpRegistryOperationError({
              reason: "probe_failed",
              message: `The ACP agent did not resolve and create a test session within ${probeTimeoutMs / 1_000} seconds. Package installation or agent startup may be slow; this check retries on the next provider refresh.`,
            }),
          ),
      }),
      Effect.mapError((error) =>
        error._tag === "AcpRegistryOperationError" ? error : acpRegistryProbeFailure(error),
      ),
    );
    return {
      probe: acpRegistryProbeResult(
        input.instanceId,
        result.started,
        result.resolved.agent?.icon ?? null,
        {
          command: result.resolved.spawn.command,
          args: result.resolved.spawn.args,
        },
        result.liveConfiguration,
        result.preferredAgentVersion,
      ),
      slashCommands: result.commands.slashCommands,
      skills: result.commands.skills,
    };
  },
);

const MANAGEMENT_TIMEOUT = Duration.seconds(60);

const makeAcpRegistryManagementRuntime = Effect.fn("AcpRegistryProbe.makeManagementRuntime")(
  function* (input: AcpRegistryManagementInput) {
    const catalog = yield* AcpRegistrySupport.AcpRegistryCatalog;
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const random = yield* SecureRandom.SecureRandom;
    const runtimeCoordinator = yield* Effect.serviceOption(
      AcpRegistryRuntimeCoordinator.AcpRegistryRuntimeCoordinator,
    );
    const resolved = yield* catalog
      .resolve(input.settings, input.cwd, input.environment)
      .pipe(Effect.mapError(AcpRegistrySupport.toAcpRegistryOperationError));
    const runtimeContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        spawn: resolved.spawn,
        cwd: input.cwd,
        clientCapabilities: {
          auth: { terminal: false },
          elicitation: { url: {} },
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: { name: "prismux-session-manager", version: "0.0.0" },
        authenticateOnAuthRequired: false,
        ...(input.settings.authMethodId ? { authMethodId: input.settings.authMethodId } : {}),
      }).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, childProcessSpawner),
            Layer.succeed(SecureRandom.SecureRandom, random),
          ),
        ),
      ),
    );
    const runtime = yield* Effect.service(AcpSessionRuntime.AcpSessionRuntime).pipe(
      Effect.provide(runtimeContext),
    );
    yield* runtime.handleElicitation((request) =>
      Effect.gen(function* () {
        if (
          request.mode !== "url" ||
          !("url" in request) ||
          !("elicitationId" in request) ||
          typeof request.url !== "string" ||
          typeof request.elicitationId !== "string"
        ) {
          return { action: "decline" } as const;
        }
        const url = normalizeAcpRegistryWebUrl(request.url);
        const elicitationId = boundedOpaqueValue(request.elicitationId, MAX_ID_LENGTH);
        if (url === undefined || elicitationId === undefined) {
          return { action: "decline" } as const;
        }
        const action: AcpRegistryUrlAuthAction = {
          elicitationId,
          url,
          message: boundedText(request.message, MAX_DESCRIPTION_LENGTH),
        };
        const accepted = yield* Option.match(runtimeCoordinator, {
          onNone: () => Effect.succeed(false),
          onSome: (coordinator) => coordinator.requestUrlAuthentication(input.instanceId, action),
        });
        return accepted ? ({ action: "accept" } as const) : ({ action: "decline" } as const);
      }),
    );
    return runtime;
  },
);

function managementFailure(
  operation:
    | "list"
    | "delete"
    | "providers_list"
    | "providers_set"
    | "providers_disable"
    | "logout",
  error: EffectAcpErrors.AcpError | AcpRegistryOperationError,
): AcpRegistryOperationError {
  if (error._tag === "AcpRegistryOperationError") return error;
  if (error._tag === "AcpRequestError" && error.code === -32601) {
    if (operation === "list") {
      return new AcpRegistryOperationError({
        reason: "session_list_unsupported",
        message: "The ACP agent does not advertise session listing.",
        cause: error,
      });
    }
    if (operation === "delete") {
      return new AcpRegistryOperationError({
        reason: "session_delete_unsupported",
        message: "The ACP agent does not advertise session deletion.",
        cause: error,
      });
    }
    if (operation.startsWith("providers_")) {
      return new AcpRegistryOperationError({
        reason: "providers_unsupported",
        message: "The ACP agent does not advertise provider configuration.",
        cause: error,
      });
    }
    return new AcpRegistryOperationError({
      reason: "logout_unsupported",
      message: "The ACP agent does not advertise logout.",
      cause: error,
    });
  }
  const classified = acpRegistryProbeFailure(error);
  if (classified.reason === "authentication_failed") return classified;
  const failure =
    operation === "delete"
      ? { reason: "session_delete_failed" as const, message: "Could not delete the ACP session." }
      : operation === "providers_list"
        ? { reason: "providers_list_failed" as const, message: "Could not list ACP providers." }
        : operation === "providers_set" || operation === "providers_disable"
          ? {
              reason: "provider_configuration_failed" as const,
              message: "Could not update the ACP provider configuration.",
            }
          : undefined;
  return failure === undefined
    ? classified
    : new AcpRegistryOperationError({ ...failure, cause: error });
}

export const listAcpRegistrySessions = Effect.fn("AcpRegistryProbe.listSessions")(
  function* (input: AcpRegistryManagementInput & { readonly cursor?: string }) {
    const runtime = yield* makeAcpRegistryManagementRuntime(input);
    const initialized = yield* runtime.initialize();
    const listed = yield* runtime.listSessions(input.cursor);
    const sessions = listed.sessions.slice(0, 256).flatMap((session) => {
      const sessionId = boundedOpaqueValue(session.sessionId, 1_024);
      const cwd = boundedOpaqueValue(session.cwd, 4_096);
      if (sessionId === undefined || cwd === undefined) return [];
      return [
        {
          sessionId,
          cwd,
          additionalDirectories: (session.additionalDirectories ?? [])
            .flatMap((directory) => {
              const normalized = boundedOpaqueValue(directory, 4_096);
              return normalized === undefined ? [] : [normalized];
            })
            .slice(0, 32),
          title:
            session.title === undefined || session.title === null
              ? null
              : boundedText(session.title, 1_024) || null,
          updatedAt:
            session.updatedAt === undefined || session.updatedAt === null
              ? null
              : boundedText(session.updatedAt, 128) || null,
          importedThreadId: null,
        },
      ];
    });
    return AcpRegistryListSessionsResult.make({
      sessions,
      nextCursor:
        listed.nextCursor === undefined || listed.nextCursor === null
          ? null
          : boundedText(listed.nextCursor, 2_048) || null,
      canLoad: initialized.agentCapabilities?.loadSession === true,
      canResume: initialized.agentCapabilities?.sessionCapabilities?.resume != null,
      canDelete: initialized.agentCapabilities?.sessionCapabilities?.delete != null,
    });
  },
  (effect) =>
    effect.pipe(
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: MANAGEMENT_TIMEOUT,
        orElse: () =>
          Effect.fail(
            new AcpRegistryOperationError({
              reason: "probe_failed",
              message: "The ACP session list request timed out.",
            }),
          ),
      }),
      Effect.mapError((error) => managementFailure("list", error)),
    ),
);

export const deleteAcpRegistrySession = Effect.fn("AcpRegistryProbe.deleteSession")(
  function* (input: AcpRegistryManagementInput & { readonly sessionId: string }) {
    const runtime = yield* makeAcpRegistryManagementRuntime(input);
    yield* runtime.deleteSession(input.sessionId);
  },
  (effect) =>
    effect.pipe(
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: MANAGEMENT_TIMEOUT,
        orElse: () =>
          Effect.fail(
            new AcpRegistryOperationError({
              reason: "session_delete_failed",
              message: "The ACP session delete request timed out.",
            }),
          ),
      }),
      Effect.mapError((error) => managementFailure("delete", error)),
    ),
);

export const listAcpRegistryProviders = Effect.fn("AcpRegistryProbe.listProviders")(
  function* (input: AcpRegistryManagementInput) {
    const runtime = yield* makeAcpRegistryManagementRuntime(input);
    const listed = yield* runtime.listProviders;
    return AcpRegistryListProvidersResult.make({
      providers: listed.providers.slice(0, 64).flatMap((provider) => {
        const providerId = boundedOpaqueValue(provider.providerId, 256);
        if (providerId === undefined) return [];
        const supported = provider.supported
          .flatMap((protocol) => {
            const value = boundedOpaqueValue(protocol, 64);
            return value === undefined ? [] : [value];
          })
          .slice(0, 16);
        const current = provider.current;
        const currentApiType =
          current == null ? undefined : boundedOpaqueValue(current.apiType, 64);
        const currentBaseUrl =
          current == null ? undefined : normalizeAcpRegistryWebUrl(current.baseUrl);
        return [
          {
            providerId,
            supported,
            required: provider.required,
            current:
              currentApiType === undefined || currentBaseUrl === undefined
                ? null
                : { apiType: currentApiType, baseUrl: currentBaseUrl },
          },
        ];
      }),
    });
  },
  (effect) =>
    effect.pipe(
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: MANAGEMENT_TIMEOUT,
        orElse: () =>
          Effect.fail(
            new AcpRegistryOperationError({
              reason: "providers_list_failed",
              message: "The ACP provider list request timed out.",
            }),
          ),
      }),
      Effect.mapError((error) => managementFailure("providers_list", error)),
    ),
);

export const setAcpRegistryProvider = Effect.fn("AcpRegistryProbe.setProvider")(
  function* (input: AcpRegistryManagementInput & EffectAcpSchema.SetProviderRequest) {
    const runtime = yield* makeAcpRegistryManagementRuntime(input);
    yield* runtime.setProvider({
      providerId: input.providerId,
      apiType: input.apiType,
      baseUrl: input.baseUrl,
      ...(input.headers === undefined ? {} : { headers: input.headers }),
    });
  },
  (effect) =>
    effect.pipe(
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: MANAGEMENT_TIMEOUT,
        orElse: () =>
          Effect.fail(
            new AcpRegistryOperationError({
              reason: "provider_configuration_failed",
              message: "The ACP provider configuration request timed out.",
            }),
          ),
      }),
      Effect.mapError((error) => managementFailure("providers_set", error)),
    ),
);

export const disableAcpRegistryProvider = Effect.fn("AcpRegistryProbe.disableProvider")(
  function* (input: AcpRegistryManagementInput & { readonly providerId: string }) {
    const runtime = yield* makeAcpRegistryManagementRuntime(input);
    yield* runtime.disableProvider(input.providerId);
  },
  (effect) =>
    effect.pipe(
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: MANAGEMENT_TIMEOUT,
        orElse: () =>
          Effect.fail(
            new AcpRegistryOperationError({
              reason: "provider_configuration_failed",
              message: "The ACP provider disable request timed out.",
            }),
          ),
      }),
      Effect.mapError((error) => managementFailure("providers_disable", error)),
    ),
);

export const logoutAcpRegistry = Effect.fn("AcpRegistryProbe.logout")(
  function* (input: AcpRegistryManagementInput) {
    const runtime = yield* makeAcpRegistryManagementRuntime(input);
    yield* runtime.logout;
  },
  (effect) =>
    effect.pipe(
      Effect.scoped,
      Effect.timeoutOrElse({
        duration: MANAGEMENT_TIMEOUT,
        orElse: () =>
          Effect.fail(
            new AcpRegistryOperationError({
              reason: "probe_failed",
              message: "The ACP logout request timed out.",
            }),
          ),
      }),
      Effect.mapError((error) => managementFailure("logout", error)),
    ),
);
