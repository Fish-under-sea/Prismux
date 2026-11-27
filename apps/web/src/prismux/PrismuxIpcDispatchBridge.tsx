/* oxlint-disable prismux/no-untranslated-copy -- Prismux v3 spec mandates verbatim Chinese confirmation and dispatch status copy */
import {
  scopeProjectRef,
  scopeThreadRef,
  scopedProjectKey,
} from "@prismux/client-runtime/environment";
import {
  findProjectByPath,
  inferProjectTitleFromPath,
} from "@prismux/client-runtime/state/projects";
import {
  deriveLogicalProjectKeyFromSettings,
  selectProjectGroupingSettings,
} from "@prismux/client-runtime/state/project-grouping";
import { squashAtomCommandFailure } from "@prismux/client-runtime/state/runtime";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  defaultInstanceIdForDriver,
  type ModelSelection,
  type PrismuxDispatchActionResult,
  type PrismuxDispatchEnvelope,
  type ProjectId,
  type ProviderOptionSelection,
  type ServerProvider,
  type ThreadId,
} from "@prismux/core-contracts";
import {
  MODEL_REASONING_EFFORT_OPTION_IDS,
  createModelSelection,
} from "@prismux/core-shared/model";
import { useAtomValue } from "@effect/atom-react";
import { useRouter } from "@tanstack/react-router";
import {
  AlertTriangleIcon,
  CheckIcon,
  FolderGit2Icon,
  MailIcon,
  MessageSquareIcon,
  SendIcon,
  ShieldAlertIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { toastManager } from "../components/ui/toast";
import {
  formatUsageModelDisplayName,
  unwrapUsageModelSlug,
} from "../components/usage/usageCallTelemetryStore";
import { useWorkspaceTabsStore } from "../components/workspace/workspaceTabsStore";
import { getClientSettings } from "../hooks/useSettings";
import { useStableCallback } from "../hooks/useStableCallback";
import { cn, newDraftId, newMessageId, newProjectId, newThreadId } from "../lib/utils";
import {
  brandProviderInstanceEntries,
  deriveProviderInstanceEntries,
  disambiguateProviderInstanceDisplayNames,
  orderProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../providerInstances";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readProjects, waitForProject } from "../state/entities";
import { localEnvironmentIdAtom } from "../state/primaryEnvironment";
import { projectEnvironment } from "../state/projects";
import {
  environmentServerConfigsAtom,
  primaryServerProvidersAtom,
  primaryServerSettingsAtom,
} from "../state/server";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE } from "../types";
import { resolveAcpAgentBrandKey, resolveAgentBrandId } from "./agentBrand";
import { prismuxDaemonClient } from "./daemonClient";
import {
  resolveConfiguredProviderDisplayName,
  type ConfiguredProviderSettingsSlice,
} from "./providerDisplayName";
import {
  PRISMUX_SUBSCRIPTION_BLOCKED_EVENT,
  SubscriptionOrchestrationBlockedDialog,
  emitSubscriptionOrchestrationBlocked,
  extractSubscriptionOrchestrationBlockedError,
  resolveBlockedProviderInstanceId,
  type SubscriptionOrchestrationBlockedDetail,
} from "./SubscriptionOrchestrationBlockedDialog";
import { SUBSCRIPTION_WAIVER_ANCHOR_ID } from "./SubscriptionRiskWaiverSection";

export const PRISMUX_DISPATCH_WINDOW_EVENT = "prismux:dispatch-thread";

export interface StagedPrismuxDispatch {
  readonly envelope: PrismuxDispatchEnvelope;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly draftId: DraftId;
  readonly threadId: ThreadId;
  readonly modelSelection: ModelSelection;
  readonly stagedAt: string;
}

const ANTIGRAVITY_PROVIDER_RE =
  /^(?:antigravity(?:[-_:\s].*)?|agy(?:[-_:\s].*)?|google[-_\s]?antigravity|personal[-_\s]?(?:antigravity|agy))$/i;

export function isAntigravityDispatchProvider(provider: string | null | undefined): boolean {
  if (typeof provider !== "string") return false;
  const trimmed = provider.trim();
  if (trimmed.length === 0) return false;
  return ANTIGRAVITY_PROVIDER_RE.test(trimmed) || resolveAgentBrandId(trimmed) === "antigravity";
}

export function isRemoteOrNonHumanCaller(callerKind: string | null | undefined): boolean {
  return callerKind !== "human_desktop";
}

/** Auto-sends only for non-confirm `send` envelopes that do not remotely drive personal AGY. */
export function shouldAutoSendDispatch(envelope: PrismuxDispatchEnvelope): boolean {
  if (envelope.mode !== "send") return false;
  if (envelope.requiresHumanConfirmation) return false;
  if (
    isAntigravityDispatchProvider(envelope.provider) &&
    isRemoteOrNonHumanCaller(envelope.callerKind)
  ) {
    return false;
  }
  return true;
}

export function formatDispatchCallerLabel(envelope: PrismuxDispatchEnvelope): string {
  const kind = envelope.callerKind.trim().toLowerCase();
  if (kind === "secretary_qq") return "QQ 秘书";
  if (kind === "secretary_gmail" || kind === "overnight_factory") return "Gmail 邮件";
  if (kind === "human_desktop") return "桌面端总控";
  if (kind === "antigravity_commander") return "Antigravity 总控";
  if (kind === "agent_subtask" || kind === "internal_script" || kind === "post_stop_loop") {
    return "跨代理任务";
  }
  if (kind === "cron") return "定时任务";
  if (typeof envelope.replyChannel === "string" && envelope.replyChannel.trim().length > 0) {
    return envelope.replyChannel.trim();
  }
  if (
    envelope.replyChannel &&
    typeof envelope.replyChannel === "object" &&
    typeof envelope.replyChannel.label === "string" &&
    envelope.replyChannel.label.trim().length > 0
  ) {
    return envelope.replyChannel.label.trim();
  }
  return "远程调度";
}

export function formatDispatchReplyChannelDetail(
  replyChannel: PrismuxDispatchEnvelope["replyChannel"],
): string | null {
  if (!replyChannel) return null;
  if (typeof replyChannel === "string") {
    const trimmed = replyChannel.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  const parts = [
    replyChannel.label?.trim(),
    replyChannel.recipient?.trim(),
    replyChannel.targetId?.trim(),
  ].filter((part): part is string => Boolean(part && part.length > 0));
  if (parts.length > 0) return parts.join(" · ");
  return replyChannel.kind?.trim() || null;
}

export interface ChiefDispatchContext {
  readonly provider?: string | null;
  readonly model?: string | null;
  readonly reasoningEffort?: string | null;
  readonly workspacePath?: string | null;
  readonly agentsMdContent?: string | null;
  readonly agentsMdPath?: string | null;
}

const CHIEF_PROVIDER_ALIAS_RE = /^(?:chief(?:[-_:\s]slot)?|secretary|主秘书)$/i;
const CHIEF_AGENTS_MD_MARKER = "<!-- prismux:chief-agents-md -->";

function normalizeWorkspacePathForCompare(raw: string | null | undefined): string {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function isChiefWorkspacePathLike(raw: string | null | undefined): boolean {
  const normalized = normalizeWorkspacePathForCompare(raw);
  return (
    normalized.endsWith("/.prismux/chief") ||
    normalized.endsWith("/prismux/chief") ||
    normalized === "~/.prismux/chief"
  );
}

/**
 * Returns true when an incoming IPC dispatch envelope targets the Chief Secretary slot
 * (either via provider alias `"chief"` / `"secretary"` / empty, or via the Chief's workspace path).
 */
export function isChiefDispatchEnvelope(
  envelope: Pick<PrismuxDispatchEnvelope, "provider" | "workspacePath" | "worktreePath">,
  chiefWorkspacePath?: string | null,
): boolean {
  const rawProvider = envelope.provider.trim();
  if (rawProvider.length === 0 || CHIEF_PROVIDER_ALIAS_RE.test(rawProvider)) {
    return true;
  }
  const envPath = normalizeWorkspacePathForCompare(
    envelope.worktreePath?.trim() || envelope.workspacePath,
  );
  if (!envPath) return false;
  if (isChiefWorkspacePathLike(envPath)) {
    return true;
  }
  const normalizedChiefPath = normalizeWorkspacePathForCompare(chiefWorkspacePath);
  return normalizedChiefPath.length > 0 && envPath === normalizedChiefPath;
}

/**
 * Prepends the independent Chief `AGENTS.md` persona & rules into a Chief-routed prompt
 * idempotently (never injects visual/appearance data, preserving the 0-Token visual layer rule).
 */
export function buildChiefDispatchPrompt(
  prompt: string,
  agentsMdContent: string | null | undefined,
): string {
  const trimmedAgentsMd = typeof agentsMdContent === "string" ? agentsMdContent.trim() : "";
  if (trimmedAgentsMd.length === 0) {
    return prompt;
  }
  if (
    prompt.includes(CHIEF_AGENTS_MD_MARKER) ||
    prompt.includes("<!-- prismux:chief-identity:begin -->")
  ) {
    return prompt;
  }
  return `${CHIEF_AGENTS_MD_MARKER}\n[主秘书独立指令（~/.prismux/chief/AGENTS.md）]\n${trimmedAgentsMd}\n\n---\n\n${prompt}`;
}

function isSyntheticDefaultModelId(
  modelId: string,
  providerModels: ReadonlyArray<ServerProvider["models"][number]>,
): boolean {
  const trimmed = modelId.trim();
  if (trimmed.length === 0) return true;
  if (providerModels.some((item) => item.slug === trimmed)) {
    return false;
  }
  const lower = trimmed.toLowerCase();
  return (
    lower === "default" ||
    lower === "auto" ||
    lower.endsWith("-default") ||
    lower.endsWith("_default")
  );
}

function extractAcpCandidateHints(candidate: ServerProvider): {
  readonly agentId?: string;
  readonly commandPath?: string;
} {
  const rec = candidate as unknown as Record<string, unknown>;
  const config =
    rec.config !== null && typeof rec.config === "object" && !Array.isArray(rec.config)
      ? (rec.config as Record<string, unknown>)
      : null;
  const agentId =
    typeof rec.acpRegistryAgentId === "string" && rec.acpRegistryAgentId.trim().length > 0
      ? rec.acpRegistryAgentId.trim()
      : typeof config?.agentId === "string" && config.agentId.trim().length > 0
        ? config.agentId.trim()
        : undefined;
  const commandPath =
    typeof rec.acpCommandPath === "string" && rec.acpCommandPath.trim().length > 0
      ? rec.acpCommandPath.trim()
      : typeof config?.commandPath === "string" && config.commandPath.trim().length > 0
        ? config.commandPath.trim()
        : undefined;
  return {
    ...(agentId ? { agentId } : {}),
    ...(commandPath ? { commandPath } : {}),
  };
}

function matchDispatchProvider(
  rawProvider: string,
  candidates: ReadonlyArray<ServerProvider>,
  mappedDriver: ProviderDriverKind | null,
): ServerProvider | null {
  if (candidates.length === 0) return null;
  const rawProviderLower = rawProvider.toLowerCase();
  const targetBrand = resolveAgentBrandId(rawProvider);
  const hasSpecificTargetBrand = targetBrand !== "custom" && targetBrand !== "acp";

  const exactInstance = candidates.find(
    (candidate) =>
      candidate.instanceId === rawProvider ||
      candidate.instanceId.toLowerCase() === rawProviderLower,
  );
  if (exactInstance) return exactInstance;

  const exactAcpAgent = candidates.find((candidate) => {
    const hints = extractAcpCandidateHints(candidate);
    return (
      (hints.agentId !== undefined && hints.agentId.toLowerCase() === rawProviderLower) ||
      (hints.commandPath !== undefined &&
        hints.commandPath.toLowerCase().includes(rawProviderLower))
    );
  });
  if (exactAcpAgent) return exactAcpAgent;

  const exactDriver = candidates.find(
    (candidate) =>
      candidate.driver === rawProvider ||
      (mappedDriver !== null && candidate.driver === mappedDriver),
  );
  if (exactDriver) return exactDriver;

  if (hasSpecificTargetBrand) {
    const brandMatched = candidates.find((candidate) => {
      const hints = extractAcpCandidateHints(candidate);
      const acpBrandKey =
        candidate.driver === "acpRegistry"
          ? resolveAcpAgentBrandKey({
              agentId: hints.agentId,
              commandPath: hints.commandPath,
              instanceId: candidate.instanceId,
              displayName: candidate.displayName,
            })
          : null;
      return (
        (acpBrandKey !== null && resolveAgentBrandId(acpBrandKey) === targetBrand) ||
        resolveAgentBrandId(hints.agentId) === targetBrand ||
        resolveAgentBrandId(candidate.driver) === targetBrand ||
        resolveAgentBrandId(candidate.instanceId) === targetBrand ||
        resolveAgentBrandId(candidate.displayName) === targetBrand
      );
    });
    if (brandMatched) return brandMatched;
  }

  const displayNameMatched = candidates.find(
    (candidate) =>
      typeof candidate.displayName === "string" &&
      candidate.displayName.trim().toLowerCase() === rawProviderLower,
  );
  return displayNameMatched ?? null;
}

function mapCanonicalProviderDriver(rawProvider: string): ProviderDriverKind | null {
  const brand = resolveAgentBrandId(rawProvider);
  switch (brand) {
    case "codex":
      return ProviderDriverKind.make("codex");
    case "claude-code":
      return ProviderDriverKind.make("claudeAgent");
    case "antigravity":
      return ProviderDriverKind.make("antigravity");
    case "opencode":
      return ProviderDriverKind.make("opencode");
    case "pi":
      return ProviderDriverKind.make("pi");
    case "cursor":
      return ProviderDriverKind.make("cursor");
    default: {
      const cleaned = rawProvider.trim();
      if (/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(cleaned)) {
        return ProviderDriverKind.make(cleaned);
      }
      return null;
    }
  }
}

/** Parameter Backdoor: maps provider/model/effort directly into T3 ModelSelection without UI clicks. */
export function buildDispatchModelSelection(
  envelope: Pick<PrismuxDispatchEnvelope, "provider" | "modelId" | "reasoningEffort">,
  availableProviders: ReadonlyArray<ServerProvider> = [],
): ModelSelection {
  const rawProvider = envelope.provider.trim();
  const mappedDriver = mapCanonicalProviderDriver(rawProvider);

  const healthyProviders = availableProviders.filter(
    (candidate) => candidate.enabled !== false && candidate.status !== "error",
  );
  const matchedProvider =
    matchDispatchProvider(rawProvider, healthyProviders, mappedDriver) ??
    matchDispatchProvider(rawProvider, availableProviders, mappedDriver);

  const instanceId =
    matchedProvider?.instanceId ??
    (mappedDriver !== null
      ? defaultInstanceIdForDriver(mappedDriver)
      : ProviderInstanceId.make("codex"));

  const effectiveDriver =
    matchedProvider?.driver ?? mappedDriver ?? ProviderDriverKind.make("codex");
  const providerModels = matchedProvider?.models ?? [];
  const rawModelId = envelope.modelId.trim();
  const unwrappedRequested = unwrapUsageModelSlug(rawModelId).toLowerCase();

  let matchedModel =
    rawModelId.length > 0
      ? (providerModels.find((item) => item.slug === rawModelId) ??
        providerModels.find(
          (item) =>
            unwrapUsageModelSlug(item.slug).toLowerCase() === unwrappedRequested ||
            item.name.trim().toLowerCase() === unwrappedRequested,
        ))
      : undefined;

  let modelId: string;
  if (rawModelId.length > 0 && !isSyntheticDefaultModelId(rawModelId, providerModels)) {
    modelId = matchedModel?.slug ?? rawModelId;
  } else {
    const defaultCatalogModel = providerModels.find((item) => item.isDefault) ?? providerModels[0];
    matchedModel = defaultCatalogModel;
    modelId =
      defaultCatalogModel?.slug ?? DEFAULT_MODEL_BY_PROVIDER[effectiveDriver] ?? "gpt-6.2-sol";
  }

  const effort = envelope.reasoningEffort.trim();
  let options: ReadonlyArray<ProviderOptionSelection> | undefined;
  if (effort.length > 0 && effort.toLowerCase() !== "default") {
    const descriptorSource =
      matchedModel ?? providerModels.find((item) => item.isDefault) ?? providerModels[0];
    const descriptor = descriptorSource?.capabilities?.optionDescriptors?.find(
      (candidate) =>
        candidate.type === "select" &&
        (candidate.role === "reasoning" ||
          (MODEL_REASONING_EFFORT_OPTION_IDS as readonly string[]).includes(candidate.id)),
    );
    const optionId =
      descriptor?.id ?? (effectiveDriver === "claudeAgent" ? "effort" : "reasoningEffort");
    options = [{ id: optionId, value: effort }];
  }

  return createModelSelection(instanceId, modelId, options);
}

export function deriveDispatchThreadTitle(
  envelope: PrismuxDispatchEnvelope,
  configuredEntries: ReadonlyArray<ProviderInstanceEntry> = [],
  settings?: ConfiguredProviderSettingsSlice | null,
): string {
  const firstLine =
    envelope.prompt
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith("<!--")) ?? "";
  if (firstLine.length > 0) {
    return firstLine.length > 64 ? `${firstLine.slice(0, 61)}...` : firstLine;
  }
  const providerLabel = resolveConfiguredProviderDisplayName({
    provider: envelope.provider,
    providerInstances: configuredEntries,
    settings,
  });
  return `${providerLabel} · ${formatDispatchCallerLabel(envelope)}`;
}

export function isValidDispatchEnvelope(value: unknown): value is PrismuxDispatchEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.taskId === "string" &&
    record.taskId.trim().length > 0 &&
    (record.mode === "send" || record.mode === "draft_only") &&
    typeof record.workspacePath === "string" &&
    typeof record.prompt === "string" &&
    typeof record.provider === "string" &&
    typeof record.modelId === "string" &&
    typeof record.reasoningEffort === "string" &&
    typeof record.callerKind === "string" &&
    typeof record.requiresHumanConfirmation === "boolean"
  );
}

export interface DispatchExecutionDeps {
  readonly resolveChiefContext?: () => Promise<ChiefDispatchContext | null>;
  readonly getConfiguredEntries?: () => ReadonlyArray<ProviderInstanceEntry>;
  readonly resolveTargetProject: (
    workspacePath: string,
    worktreePath: string | null,
  ) => Promise<{
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
    readonly logicalProjectKey: string;
    readonly providers: ReadonlyArray<ServerProvider>;
  } | null>;
  readonly allocateIds?: () => {
    readonly draftId: DraftId;
    readonly threadId: ThreadId;
    readonly messageId: ReturnType<typeof newMessageId>;
  };
  readonly setLogicalProjectDraftThreadId: (
    logicalProjectKey: string,
    projectRef: ReturnType<typeof scopeProjectRef>,
    draftId: DraftId,
    options: {
      threadId: ThreadId;
      branch: string | null;
      worktreePath: string | null;
      createdAt: string;
      envMode: "local" | "worktree";
      runtimeMode: typeof DEFAULT_RUNTIME_MODE;
      interactionMode: typeof DEFAULT_INTERACTION_MODE;
      preservePreviousDraft: boolean;
    },
  ) => void;
  readonly setModelSelection: (
    draftId: DraftId,
    modelSelection: ModelSelection,
    opts: { explicit: boolean; replaceOptions: boolean },
  ) => void;
  readonly setPrompt: (draftId: DraftId, prompt: string) => void;
  readonly getPrompt: (draftId: DraftId) => string | null;
  readonly markDraftThreadPromoting: (
    draftId: DraftId,
    promotedTo: ReturnType<typeof scopeThreadRef>,
  ) => void;
  readonly clearComposerContent: (draftId: DraftId) => void;
  readonly openWorkspaceDraftTab: (input: {
    readonly title: string;
    readonly providerId: string;
    readonly instanceId: ProviderInstanceId;
    readonly model: string;
    readonly environmentId: EnvironmentId;
    readonly threadId: ThreadId;
    readonly draftId: DraftId;
  }) => void;
  readonly promoteWorkspaceDraftTab: (
    draftId: DraftId,
    threadRef: ReturnType<typeof scopeThreadRef>,
    metadata: { readonly title: string; readonly providerId: string },
  ) => void;
  readonly navigateToDraft: (draftId: DraftId) => Promise<void>;
  readonly navigateToThread: (environmentId: EnvironmentId, threadId: ThreadId) => Promise<void>;
  readonly startThreadTurn: (input: {
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
    readonly threadId: ThreadId;
    readonly messageId: ReturnType<typeof newMessageId>;
    readonly prompt: string;
    readonly modelSelection: ModelSelection;
    readonly title: string;
    readonly branch: string | null;
    readonly worktreePath: string | null;
    readonly createdAt: string;
  }) => Promise<{ readonly ok: boolean; readonly error?: string }>;
  readonly onStagedForConfirmation: (staged: StagedPrismuxDispatch) => void;
  readonly onAutoSent?: (envelope: PrismuxDispatchEnvelope, threadId: ThreadId) => void;
  readonly onSubscriptionBlocked?: (detail: SubscriptionOrchestrationBlockedDetail) => void;
  readonly onError?: (message: string) => void;
}

export async function dispatchStagedThreadTurn(
  staged: StagedPrismuxDispatch,
  deps: Pick<
    DispatchExecutionDeps,
    | "allocateIds"
    | "getConfiguredEntries"
    | "getPrompt"
    | "markDraftThreadPromoting"
    | "clearComposerContent"
    | "promoteWorkspaceDraftTab"
    | "navigateToThread"
    | "startThreadTurn"
  >,
): Promise<{ readonly ok: boolean; readonly error?: string }> {
  const livePrompt = deps.getPrompt(staged.draftId);
  const promptText =
    typeof livePrompt === "string" && livePrompt.trim().length > 0
      ? livePrompt
      : staged.envelope.prompt;
  const threadRef = scopeThreadRef(staged.environmentId, staged.threadId);
  const title = deriveDispatchThreadTitle(
    { ...staged.envelope, prompt: promptText },
    deps.getConfiguredEntries?.() ?? [],
  );
  const ids = deps.allocateIds?.();
  const messageId = ids?.messageId ?? newMessageId();
  const createdAt = staged.envelope.createdAt || new Date().toISOString();

  deps.markDraftThreadPromoting(staged.draftId, threadRef);
  const result = await deps.startThreadTurn({
    environmentId: staged.environmentId,
    projectId: staged.projectId,
    threadId: staged.threadId,
    messageId,
    prompt: promptText,
    modelSelection: staged.modelSelection,
    title,
    branch: staged.envelope.branchName ?? null,
    worktreePath: staged.envelope.worktreePath ?? null,
    createdAt,
  });
  if (!result.ok) {
    return result;
  }

  deps.clearComposerContent(staged.draftId);
  deps.promoteWorkspaceDraftTab(staged.draftId, threadRef, {
    title,
    providerId: staged.envelope.provider,
  });
  await deps.navigateToThread(staged.environmentId, staged.threadId);
  return { ok: true };
}

/** Stages a dispatch envelope in the visible draft tab and auto-sends only when permitted by policy. */
export async function handlePrismuxDispatchEnvelope(
  envelope: PrismuxDispatchEnvelope,
  deps: DispatchExecutionDeps,
): Promise<
  | { readonly outcome: "auto_sent"; readonly staged: StagedPrismuxDispatch }
  | { readonly outcome: "staged_confirmation"; readonly staged: StagedPrismuxDispatch }
  | { readonly outcome: "failed"; readonly error: string }
> {
  let effectiveEnvelope: PrismuxDispatchEnvelope = envelope;
  let chiefPromptForDraft = envelope.prompt;

  if (deps.resolveChiefContext && isChiefDispatchEnvelope(envelope)) {
    try {
      const chiefCtx = await deps.resolveChiefContext();
      if (chiefCtx) {
        const rawProvider = envelope.provider.trim();
        const shouldUseChiefProvider =
          rawProvider.length === 0 || CHIEF_PROVIDER_ALIAS_RE.test(rawProvider);
        const resolvedProvider =
          shouldUseChiefProvider && chiefCtx.provider?.trim()
            ? chiefCtx.provider.trim()
            : envelope.provider;
        const rawModel = envelope.modelId.trim();
        const resolvedModelId =
          (rawModel.length === 0 || isSyntheticDefaultModelId(rawModel, [])) &&
          chiefCtx.model?.trim()
            ? chiefCtx.model.trim()
            : envelope.modelId;
        const rawEffort = envelope.reasoningEffort.trim();
        const resolvedEffort =
          (rawEffort.length === 0 || rawEffort.toLowerCase() === "default") &&
          chiefCtx.reasoningEffort?.trim()
            ? chiefCtx.reasoningEffort.trim()
            : envelope.reasoningEffort;
        const resolvedWorkspacePath =
          envelope.workspacePath.trim().length > 0
            ? envelope.workspacePath
            : (chiefCtx.workspacePath?.trim() ?? "");

        chiefPromptForDraft = buildChiefDispatchPrompt(envelope.prompt, chiefCtx.agentsMdContent);
        effectiveEnvelope = {
          ...envelope,
          provider: resolvedProvider,
          modelId: resolvedModelId,
          reasoningEffort: resolvedEffort,
          workspacePath: resolvedWorkspacePath,
        };
      }
    } catch {
      // Proceed gracefully with original envelope if daemon chief context lookup fails.
    }
  }

  const worktreePath =
    typeof effectiveEnvelope.worktreePath === "string" &&
    effectiveEnvelope.worktreePath.trim().length > 0
      ? effectiveEnvelope.worktreePath.trim()
      : null;
  const targetProject = await deps.resolveTargetProject(
    effectiveEnvelope.workspacePath,
    worktreePath,
  );
  if (targetProject === null) {
    const error = `未找到或无法初始化工作区：${worktreePath ?? effectiveEnvelope.workspacePath}`;
    deps.onError?.(error);
    return { outcome: "failed", error };
  }

  const ids = deps.allocateIds?.() ?? {
    draftId: newDraftId(),
    threadId: newThreadId(),
    messageId: newMessageId(),
  };
  const createdAt = effectiveEnvelope.createdAt || new Date().toISOString();
  const projectRef = scopeProjectRef(targetProject.environmentId, targetProject.projectId);
  const modelSelection = buildDispatchModelSelection(effectiveEnvelope, targetProject.providers);
  const tabTitle = deriveDispatchThreadTitle(
    effectiveEnvelope,
    deps.getConfiguredEntries?.() ?? [],
  );

  deps.setLogicalProjectDraftThreadId(targetProject.logicalProjectKey, projectRef, ids.draftId, {
    threadId: ids.threadId,
    branch: effectiveEnvelope.branchName ?? null,
    worktreePath,
    createdAt,
    envMode: worktreePath ? "worktree" : "local",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    preservePreviousDraft: true,
  });
  deps.setModelSelection(ids.draftId, modelSelection, {
    explicit: true,
    replaceOptions: true,
  });
  deps.setPrompt(ids.draftId, chiefPromptForDraft);

  deps.openWorkspaceDraftTab({
    title: tabTitle,
    providerId: effectiveEnvelope.provider,
    instanceId: modelSelection.instanceId,
    model: modelSelection.model,
    environmentId: targetProject.environmentId,
    threadId: ids.threadId,
    draftId: ids.draftId,
  });

  await deps.navigateToDraft(ids.draftId);

  const staged: StagedPrismuxDispatch = {
    envelope: {
      ...effectiveEnvelope,
      prompt: chiefPromptForDraft,
    },
    environmentId: targetProject.environmentId,
    projectId: targetProject.projectId,
    draftId: ids.draftId,
    threadId: ids.threadId,
    modelSelection,
    stagedAt: createdAt,
  };

  if (!shouldAutoSendDispatch(effectiveEnvelope)) {
    deps.onStagedForConfirmation(staged);
    return { outcome: "staged_confirmation", staged };
  }

  const sendResult = await dispatchStagedThreadTurn(staged, deps);
  if (!sendResult.ok) {
    const error = sendResult.error ?? "调度任务发送失败。";
    const blocked = extractSubscriptionOrchestrationBlockedError(error, effectiveEnvelope.provider);
    if (blocked) {
      deps.onSubscriptionBlocked?.(blocked);
      return { outcome: "failed", error };
    }
    deps.onError?.(error);
    return { outcome: "failed", error };
  }
  deps.onAutoSent?.(effectiveEnvelope, ids.threadId);
  return { outcome: "auto_sent", staged };
}

export async function confirmPrismuxDispatchViaHost(
  taskId: string,
  providerHint?: string,
): Promise<PrismuxDispatchActionResult> {
  if (
    typeof window !== "undefined" &&
    typeof window.desktopBridge?.confirmPrismuxDispatch === "function"
  ) {
    const result = await window.desktopBridge.confirmPrismuxDispatch(taskId);
    if (!result.ok) {
      const blocked = extractSubscriptionOrchestrationBlockedError(result, providerHint);
      if (blocked) {
        emitSubscriptionOrchestrationBlocked(blocked);
      }
    }
    return result;
  }
  try {
    await prismuxDaemonClient.requestJson(`/v1/dispatch/${encodeURIComponent(taskId)}/confirm`, {
      method: "POST",
      body: JSON.stringify({ confirmedBy: "human_desktop" }),
    });
    return { ok: true };
  } catch (error) {
    const blocked = extractSubscriptionOrchestrationBlockedError(error, providerHint);
    if (blocked) {
      emitSubscriptionOrchestrationBlocked(blocked);
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "确认放行请求失败。",
    };
  }
}

export async function cancelPrismuxDispatchViaHost(
  taskId: string,
): Promise<PrismuxDispatchActionResult> {
  if (
    typeof window !== "undefined" &&
    typeof window.desktopBridge?.cancelPrismuxDispatch === "function"
  ) {
    return window.desktopBridge.cancelPrismuxDispatch(taskId);
  }
  try {
    await prismuxDaemonClient.requestJson(`/v1/dispatch/${encodeURIComponent(taskId)}/cancel`, {
      method: "POST",
      body: JSON.stringify({ cancelledBy: "human_desktop" }),
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "取消丢弃请求失败。",
    };
  }
}

export interface PrismuxDispatchConfirmationBannerProps {
  readonly items: ReadonlyArray<StagedPrismuxDispatch>;
  readonly busyTaskId: string | null;
  readonly errorMessage: string | null;
  readonly configuredEntries?: ReadonlyArray<ProviderInstanceEntry>;
  readonly settings?: ConfiguredProviderSettingsSlice | null;
  readonly onConfirm: (staged: StagedPrismuxDispatch) => void;
  readonly onCancel: (staged: StagedPrismuxDispatch) => void;
}

export function PrismuxDispatchConfirmationBanner({
  items,
  busyTaskId,
  errorMessage,
  configuredEntries = [],
  settings = null,
  onConfirm,
  onCancel,
}: PrismuxDispatchConfirmationBannerProps) {
  if (items.length === 0) return null;
  const active = items[0]!;
  const { envelope } = active;
  const isBusy = busyTaskId === envelope.taskId;
  const sourceLabel = formatDispatchCallerLabel(envelope);
  const replyDetail = formatDispatchReplyChannelDetail(envelope.replyChannel);
  const targetPath = envelope.worktreePath?.trim() || envelope.workspacePath.trim();
  const providerDisplay = resolveConfiguredProviderDisplayName({
    provider: envelope.provider,
    providerInstances: configuredEntries,
    settings,
  });
  const modelDisplay =
    formatUsageModelDisplayName(
      envelope.modelId || active.modelSelection.model,
      configuredEntries,
      envelope.provider,
    ) ||
    unwrapUsageModelSlug(envelope.modelId || active.modelSelection.model) ||
    "默认模型";
  const isAgy = isAntigravityDispatchProvider(envelope.provider);
  const headline = isAgy
    ? // oxlint-disable-next-line prismux/no-em-dash-copy -- Prismux v3 spec mandates verbatim Chinese confirmation copy with ——
      "远程请求调用个人版 Antigravity（AGY）——已就位至草稿标签页，等待本人二次确认放行"
    : // oxlint-disable-next-line prismux/no-em-dash-copy -- Prismux v3 spec mandates verbatim Chinese confirmation copy with ——
      `远程请求调用 ${providerDisplay}——已就位至草稿标签页，等待本人二次确认放行`;

  const SourceIcon =
    envelope.callerKind === "secretary_qq"
      ? MessageSquareIcon
      : envelope.callerKind === "secretary_gmail" || envelope.callerKind === "overnight_factory"
        ? MailIcon
        : AlertTriangleIcon;

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label="远程调度二次确认横幅"
      data-pmx-dispatch-confirmation-banner="true"
      data-pmx-dispatch-task-id={envelope.taskId}
      className="pointer-events-none fixed inset-x-0 top-12 z-50 flex justify-center px-4"
    >
      <div
        data-pmx-glass-zone="overlays"
        className={cn(
          "pointer-events-auto w-full max-w-3xl rounded-2xl border border-warning/45 bg-popover/92 p-4 text-popover-foreground shadow-2xl ring-1 ring-warning/25 backdrop-blur-xl [-webkit-app-region:no-drag]",
        )}
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-warning/16 text-warning-foreground">
                <ShieldAlertIcon className="size-4.5" aria-hidden />
              </span>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="warning" size="sm">
                    <SourceIcon className="size-3" aria-hidden />
                    {sourceLabel}
                  </Badge>
                  <Badge variant="outline" size="sm">
                    {providerDisplay} · {modelDisplay}
                  </Badge>
                  {envelope.reasoningEffort ? (
                    <Badge variant="secondary" size="sm">
                      推理档位: {envelope.reasoningEffort}
                    </Badge>
                  ) : null}
                  {items.length > 1 ? (
                    <Badge variant="secondary" size="sm">
                      队列中还有 {items.length - 1} 项
                    </Badge>
                  ) : null}
                </div>
                <p
                  data-pmx-dispatch-warning-copy="true"
                  className="text-sm leading-snug font-semibold text-foreground"
                >
                  {headline}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-1.5 rounded-xl border border-border/70 bg-background/65 px-3 py-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5 font-mono text-2xs text-foreground/90">
              <FolderGit2Icon className="size-3.5 shrink-0 text-warning" aria-hidden />
              <span className="shrink-0 font-sans font-medium text-muted-foreground">
                {envelope.worktreePath ? "就位 Worktree：" : "目标工作区："}
              </span>
              <span className="truncate" data-pmx-dispatch-worktree-path="true">
                {targetPath}
              </span>
            </div>
            {replyDetail ? (
              <div className="truncate text-2xs">
                回执通道：<span className="text-foreground/85">{replyDetail}</span>
              </div>
            ) : null}
            {envelope.memoryContextSummary ? (
              <div className="line-clamp-2 text-2xs">
                记忆上下文：
                <span className="text-foreground/85">{envelope.memoryContextSummary}</span>
              </div>
            ) : null}
            <div className="line-clamp-2 text-2xs">
              待发送指令：<span className="text-foreground">{envelope.prompt}</span>
            </div>
          </div>

          {errorMessage ? (
            <p
              role="alert"
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
            >
              {errorMessage}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isBusy}
              data-pmx-dispatch-cancel={envelope.taskId}
              onClick={() => onCancel(active)}
            >
              <XIcon className="size-3.5" aria-hidden />
              取消丢弃
            </Button>
            <Button
              type="button"
              size="sm"
              variant="default"
              disabled={isBusy}
              data-pmx-dispatch-confirm={envelope.taskId}
              onClick={() => onConfirm(active)}
            >
              {isBusy ? (
                <CheckIcon className="size-3.5" aria-hidden />
              ) : (
                <SendIcon className="size-3.5" aria-hidden />
              )}
              {isBusy ? "正在确认放行…" : "确认放行并发送"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

declare global {
  interface Window {
    __prismuxDispatchThreadForTest?: (envelope: PrismuxDispatchEnvelope) => void;
  }
}

export function PrismuxIpcDispatchBridge() {
  const router = useRouter();
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const startTurnCommand = useAtomCommand(threadEnvironment.startTurn, { reportFailure: false });
  const primaryProviders = useAtomValue(primaryServerProvidersAtom);
  const primarySettings = useAtomValue(primaryServerSettingsAtom);
  const configuredEntries = disambiguateProviderInstanceDisplayNames(
    orderProviderInstanceEntries(
      brandProviderInstanceEntries(
        deriveProviderInstanceEntries(primaryProviders),
        primarySettings,
      ),
      primarySettings.providerOrder,
    ),
  );
  const [stagedQueue, setStagedQueue] = useState<ReadonlyArray<StagedPrismuxDispatch>>([]);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [blockedDetail, setBlockedDetail] = useState<SubscriptionOrchestrationBlockedDetail | null>(
    null,
  );
  const queuePromiseRef = useRef<Promise<void>>(Promise.resolve());

  const resolveLatestConfiguredEntries = (): ReadonlyArray<ProviderInstanceEntry> => {
    const localEnvId = appAtomRegistry.get(localEnvironmentIdAtom) ?? EnvironmentId.make("primary");
    const config = appAtomRegistry.get(environmentServerConfigsAtom).get(localEnvId);
    if (!config) {
      return configuredEntries;
    }
    const derived = deriveProviderInstanceEntries(config.providers);
    const branded = brandProviderInstanceEntries(derived, config.settings);
    return disambiguateProviderInstanceDisplayNames(
      orderProviderInstanceEntries(branded, config.settings.providerOrder),
    );
  };

  const buildExecutionDeps = (): DispatchExecutionDeps => {
    const draftStore = useComposerDraftStore.getState();
    const tabsStore = useWorkspaceTabsStore.getState();

    return {
      getConfiguredEntries: resolveLatestConfiguredEntries,
      resolveChiefContext: async () => {
        const [chiefRes, agentsMdRes] = await Promise.all([
          prismuxDaemonClient.getChief().catch(() => null),
          prismuxDaemonClient.getChiefAgentsMd().catch(() => null),
        ]);
        if (!chiefRes?.slot && !agentsMdRes?.content) {
          return null;
        }
        const slot = chiefRes?.slot;
        const provider =
          (typeof slot?.activeProvider === "string" && slot.activeProvider.trim()) ||
          (typeof slot?.provider === "string" && slot.provider.trim()) ||
          null;
        const model =
          typeof slot?.model === "string" && slot.model.trim() ? slot.model.trim() : null;
        const reasoningEffort =
          (typeof slot?.reasoningEffort === "string" && slot.reasoningEffort.trim()) ||
          (typeof slot?.defaultEffort === "string" && slot.defaultEffort.trim()) ||
          null;
        const agentsMdPath =
          agentsMdRes?.path?.trim() ||
          chiefRes?.agentsMdPath?.trim() ||
          (typeof slot?.agentsMdPath === "string" ? slot.agentsMdPath.trim() : "") ||
          null;
        const derivedWorkspacePath = agentsMdPath
          ? agentsMdPath.replace(/[\\/]AGENTS\.md$/i, "")
          : null;
        return {
          provider,
          model,
          reasoningEffort,
          workspacePath: derivedWorkspacePath,
          agentsMdContent: agentsMdRes?.content ?? null,
          agentsMdPath,
        };
      },
      resolveTargetProject: async (workspacePath, worktreePath) => {
        const localEnvId =
          appAtomRegistry.get(localEnvironmentIdAtom) ?? EnvironmentId.make("primary");
        const allProjects = readProjects();
        const envProjects = allProjects.filter(
          (project) => project.environmentId === localEnvId && project.archivedAt == null,
        );
        const preferredPath = workspacePath.trim() || worktreePath?.trim() || "";
        const groupingSettings = selectProjectGroupingSettings(getClientSettings());
        const configs = appAtomRegistry.get(environmentServerConfigsAtom);
        const providers = configs.get(localEnvId)?.providers ?? [];

        const matched =
          preferredPath.length > 0
            ? (findProjectByPath(envProjects, preferredPath) ??
              (worktreePath ? findProjectByPath(envProjects, worktreePath) : undefined))
            : envProjects[0];

        if (matched) {
          return {
            environmentId: matched.environmentId,
            projectId: matched.id,
            logicalProjectKey: deriveLogicalProjectKeyFromSettings(matched, groupingSettings),
            providers,
          };
        }

        if (preferredPath.length === 0) {
          return null;
        }

        const projectId = newProjectId();
        const createResult = await createProject({
          environmentId: localEnvId,
          input: {
            projectId,
            title: isChiefWorkspacePathLike(preferredPath)
              ? "主秘书工作区"
              : inferProjectTitleFromPath(preferredPath),
            workspaceRoot: preferredPath,
            createWorkspaceRootIfMissing: isChiefWorkspacePathLike(preferredPath),
            defaultModelSelection: null,
          },
        });
        if (createResult._tag === "Failure") {
          const fallbackProject = envProjects[0];
          if (fallbackProject) {
            return {
              environmentId: fallbackProject.environmentId,
              projectId: fallbackProject.id,
              logicalProjectKey: deriveLogicalProjectKeyFromSettings(
                fallbackProject,
                groupingSettings,
              ),
              providers,
            };
          }
          return null;
        }
        const projectRef = scopeProjectRef(localEnvId, projectId);
        await waitForProject(projectRef).catch(() => undefined);
        return {
          environmentId: localEnvId,
          projectId,
          logicalProjectKey: scopedProjectKey(projectRef),
          providers,
        };
      },
      setLogicalProjectDraftThreadId: (logicalProjectKey, projectRef, draftId, options) => {
        draftStore.setLogicalProjectDraftThreadId(logicalProjectKey, projectRef, draftId, options);
      },
      setModelSelection: (draftId, modelSelection, opts) => {
        draftStore.setModelSelection(draftId, modelSelection, opts);
      },
      setPrompt: (draftId, prompt) => {
        draftStore.setPrompt(draftId, prompt);
      },
      getPrompt: (draftId) => draftStore.getComposerDraft(draftId)?.prompt ?? null,
      markDraftThreadPromoting: (draftId, promotedTo) => {
        draftStore.markDraftThreadPromoting(draftId, promotedTo);
      },
      clearComposerContent: (draftId) => {
        draftStore.clearComposerContent(draftId);
      },
      openWorkspaceDraftTab: (input) => {
        tabsStore.openTab({
          kind: "draft",
          title: input.title,
          providerId: input.providerId,
          instanceId: input.instanceId,
          model: input.model,
          environmentId: input.environmentId,
          threadId: input.threadId,
          draftId: input.draftId,
          reuseExisting: true,
        });
      },
      promoteWorkspaceDraftTab: (draftId, threadRef, metadata) => {
        tabsStore.promoteDraftTab(draftId, threadRef, metadata);
      },
      navigateToDraft: async (draftId) => {
        await router.navigate({
          to: "/draft/$draftId",
          params: { draftId },
        });
      },
      navigateToThread: async (environmentId, threadId) => {
        await router.navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId, threadId },
        });
      },
      startThreadTurn: async (input) => {
        const result = await startTurnCommand({
          environmentId: input.environmentId,
          input: {
            threadId: input.threadId,
            message: {
              messageId: input.messageId,
              role: "user",
              text: input.prompt,
              attachments: [],
            },
            modelSelection: input.modelSelection,
            titleSeed: input.title,
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: DEFAULT_INTERACTION_MODE,
            dispatchMode: "auto",
            bootstrap: {
              createThread: {
                projectId: input.projectId,
                title: input.title,
                modelSelection: input.modelSelection,
                runtimeMode: DEFAULT_RUNTIME_MODE,
                interactionMode: DEFAULT_INTERACTION_MODE,
                branch: input.branch,
                worktreePath: input.worktreePath,
                createdAt: input.createdAt,
              },
            },
            createdAt: input.createdAt,
          },
        });
        if (result._tag === "Failure") {
          const failure = squashAtomCommandFailure(result);
          return {
            ok: false,
            error: failure instanceof Error ? failure.message : "无法向当前会话发送指令。",
          };
        }
        return { ok: true };
      },
      onStagedForConfirmation: (staged) => {
        setErrorMessage(null);
        setStagedQueue((prev) => [
          ...prev.filter((item) => item.envelope.taskId !== staged.envelope.taskId),
          staged,
        ]);
      },
      onAutoSent: (envelope) => {
        const entries = resolveLatestConfiguredEntries();
        const providerLabel = resolveConfiguredProviderDisplayName({
          provider: envelope.provider,
          providerInstances: entries,
          settings: primarySettings,
        });
        const readableModel =
          formatUsageModelDisplayName(envelope.modelId, entries, envelope.provider) ||
          unwrapUsageModelSlug(envelope.modelId) ||
          "默认模型";
        const effortSuffix = envelope.reasoningEffort.trim()
          ? ` · ${envelope.reasoningEffort.trim()}`
          : "";
        toastManager.add({
          type: "info",
          title: `已通过工作台派发至 ${providerLabel}`,
          description: `${readableModel}${effortSuffix}`,
        });
      },
      onSubscriptionBlocked: (detail) => {
        setBlockedDetail(detail);
      },
      onError: (message) => {
        toastManager.add({
          type: "error",
          title: "IPC 任务调度失败",
          description: message,
        });
      },
    };
  };

  const enqueueIncomingEnvelope = useStableCallback((envelope: PrismuxDispatchEnvelope) => {
    queuePromiseRef.current = queuePromiseRef.current
      .then(async () => {
        await handlePrismuxDispatchEnvelope(envelope, buildExecutionDeps());
      })
      .catch(() => undefined);
  });

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- subscribes to Electron IPC dispatch events and browser test event hook
  useEffect(() => {
    const unsubscribeDesktop = window.desktopBridge?.onPrismuxDispatchThread?.((envelope) => {
      if (isValidDispatchEnvelope(envelope)) {
        enqueueIncomingEnvelope(envelope);
      }
    });

    const handleWindowEvent = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (isValidDispatchEnvelope(detail)) {
        enqueueIncomingEnvelope(detail);
      }
    };
    const handleBlockedEvent = (event: Event) => {
      const rawDetail = (event as CustomEvent<unknown>).detail;
      const extracted = extractSubscriptionOrchestrationBlockedError(rawDetail);
      if (extracted) {
        setBlockedDetail(extracted);
      }
    };
    window.addEventListener(PRISMUX_DISPATCH_WINDOW_EVENT, handleWindowEvent);
    window.addEventListener(PRISMUX_SUBSCRIPTION_BLOCKED_EVENT, handleBlockedEvent);
    window.__prismuxDispatchThreadForTest = (envelope: PrismuxDispatchEnvelope) => {
      if (isValidDispatchEnvelope(envelope)) {
        enqueueIncomingEnvelope(envelope);
      }
    };

    return () => {
      unsubscribeDesktop?.();
      window.removeEventListener(PRISMUX_DISPATCH_WINDOW_EVENT, handleWindowEvent);
      window.removeEventListener(PRISMUX_SUBSCRIPTION_BLOCKED_EVENT, handleBlockedEvent);
      if (window.__prismuxDispatchThreadForTest) {
        delete window.__prismuxDispatchThreadForTest;
      }
    };
  }, [enqueueIncomingEnvelope]);

  const handleConfirmStaged = (staged: StagedPrismuxDispatch) => {
    if (busyTaskId !== null) return;
    setBusyTaskId(staged.envelope.taskId);
    setErrorMessage(null);
    void (async () => {
      try {
        const confirmed = await confirmPrismuxDispatchViaHost(
          staged.envelope.taskId,
          staged.envelope.provider,
        );
        if (!confirmed.ok) {
          const blocked = extractSubscriptionOrchestrationBlockedError(
            confirmed,
            staged.envelope.provider,
          );
          if (blocked) {
            setBlockedDetail(blocked);
          }
          setErrorMessage(confirmed.error ?? "服务端未批准本次放行，请稍后重试。");
          return;
        }
        const sendResult = await dispatchStagedThreadTurn(staged, buildExecutionDeps());
        if (!sendResult.ok) {
          const blocked = extractSubscriptionOrchestrationBlockedError(
            sendResult.error,
            staged.envelope.provider,
          );
          if (blocked) {
            setBlockedDetail(blocked);
          }
          setErrorMessage(sendResult.error ?? "放行后发送消息失败，草稿仍已保留。");
          return;
        }
        setStagedQueue((prev) =>
          prev.filter((item) => item.envelope.taskId !== staged.envelope.taskId),
        );
        const entries = resolveLatestConfiguredEntries();
        const providerLabel = resolveConfiguredProviderDisplayName({
          provider: staged.envelope.provider,
          providerInstances: entries,
          settings: primarySettings,
        });
        const readableModel =
          formatUsageModelDisplayName(
            staged.envelope.modelId || staged.modelSelection.model,
            entries,
            staged.envelope.provider,
          ) ||
          unwrapUsageModelSlug(staged.envelope.modelId || staged.modelSelection.model) ||
          "默认模型";
        toastManager.add({
          type: "success",
          title: "已确认放行并发送",
          description: `${providerLabel} · ${readableModel}`,
        });
      } finally {
        setBusyTaskId(null);
      }
    })();
  };

  const handleCancelStaged = (staged: StagedPrismuxDispatch) => {
    if (busyTaskId !== null) return;
    setBusyTaskId(staged.envelope.taskId);
    setErrorMessage(null);
    void (async () => {
      try {
        const cancelled = await cancelPrismuxDispatchViaHost(staged.envelope.taskId);
        if (!cancelled.ok) {
          setErrorMessage(cancelled.error ?? "取消任务失败，请重试。");
          return;
        }
        useComposerDraftStore.getState().clearComposerContent(staged.draftId);
        setStagedQueue((prev) =>
          prev.filter((item) => item.envelope.taskId !== staged.envelope.taskId),
        );
        toastManager.add({
          type: "info",
          title: "已取消并丢弃远程草稿任务",
        });
      } finally {
        setBusyTaskId(null);
      }
    })();
  };

  const handleConfigureApiMode = useStableCallback(
    (detail: SubscriptionOrchestrationBlockedDetail) => {
      setBlockedDetail(null);
      const instanceId = resolveBlockedProviderInstanceId(detail.providerId);
      void router.navigate({
        to: "/settings/providers",
        search: instanceId ? { instanceId } : {},
      });
    },
  );

  const handleOpenRiskWaiver = useStableCallback(
    (_detail: SubscriptionOrchestrationBlockedDetail) => {
      setBlockedDetail(null);
      void router.navigate({
        to: "/settings/providers",
        search: {},
        hash: SUBSCRIPTION_WAIVER_ANCHOR_ID,
      });
    },
  );

  return (
    <>
      <PrismuxDispatchConfirmationBanner
        items={stagedQueue}
        busyTaskId={busyTaskId}
        errorMessage={errorMessage}
        configuredEntries={configuredEntries}
        settings={primarySettings}
        onConfirm={handleConfirmStaged}
        onCancel={handleCancelStaged}
      />
      <SubscriptionOrchestrationBlockedDialog
        detail={blockedDetail}
        onClose={() => setBlockedDetail(null)}
        onConfigureApi={handleConfigureApiMode}
        onOpenWaiver={handleOpenRiskWaiver}
      />
    </>
  );
}
