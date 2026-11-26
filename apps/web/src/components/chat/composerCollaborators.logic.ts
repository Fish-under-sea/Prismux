/* oxlint-disable prismux/no-untranslated-copy -- collaborator auth badges and compliance tooltips use concise Chinese copy aligned with SubscriptionRiskWaiverSection */
import type {
  ComposerContextId,
  OrchestrationMessageContext,
  ProviderInstanceId,
  ServerProvider,
  UnknownContextRecord,
} from "@prismux/core-contracts";
import { BTW_GUARDRAIL_CONTEXT_KIND } from "@prismux/core-shared/composerContextReferences";

import type { AppModelOption } from "../../modelSelection";
import { resolveAcpAgentBrandKey, resolveAgentBrandId } from "../../prismux/agentBrand";
import type { DaemonProviderProbeItemDto } from "../../prismux/daemonClient";
import type { ProviderInstanceEntry } from "../../providerInstances";

export const COLLABORATOR_WAIVER_ROUTE = "/settings/providers#subscription-risk-waiver" as const;

export type CollaboratorProviderProbeLike = Pick<
  DaemonProviderProbeItemDto,
  "providerId" | "authMode"
>;

export interface CollaboratorWaiverPolicy {
  readonly signed: boolean;
  readonly allowAntigravityAsControlledAgent: boolean;
  readonly allowExternalSubscriptionAgentsInSwarm: boolean;
}

function isAntigravityIdentifier(raw: string | null | undefined): boolean {
  if (typeof raw !== "string") return false;
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized === "antigravity" ||
    normalized === "agy" ||
    normalized.startsWith("antigravity") ||
    normalized.startsWith("agy-") ||
    normalized.startsWith("agy_") ||
    normalized.startsWith("agy:") ||
    /(?:^|[:/_\-\s(])(?:antigravity|agy)(?:$|[:/_\-\s)])/.test(normalized)
  );
}

function isAntigravityEntry(entry: {
  readonly driverKind?: string | null | undefined;
  readonly instanceId?: string | null | undefined;
  readonly acpRegistryAgentId?: string | null | undefined;
}): boolean {
  return (
    isAntigravityIdentifier(entry.driverKind) ||
    isAntigravityIdentifier(entry.instanceId) ||
    isAntigravityIdentifier(entry.acpRegistryAgentId)
  );
}

function isAntigravityControlledAllowed(
  waiver:
    | Pick<CollaboratorWaiverPolicy, "signed" | "allowAntigravityAsControlledAgent">
    | null
    | undefined,
): boolean {
  return waiver?.signed === true && waiver.allowAntigravityAsControlledAgent === true;
}

function isDshEntry(entry: {
  readonly driverKind: string;
  readonly displayName?: string | null | undefined;
  readonly acpRegistryAgentId?: string | undefined;
  readonly instanceId?: string | undefined;
  readonly acpCommandPath?: string | null | undefined;
}): boolean {
  return (
    resolveAgentBrandId(entry.driverKind) === "dsh" ||
    resolveAcpAgentBrandKey({
      agentId: entry.acpRegistryAgentId,
      instanceId: entry.instanceId,
      displayName: entry.displayName,
      commandPath: entry.acpCommandPath,
    }) === "dsh"
  );
}

export const MIN_COLLABORATOR_COUNT = 1 as const;
export const MAX_COLLABORATOR_COUNT_PER_AGENT = 6 as const;
export const MAX_TOTAL_COLLABORATOR_COUNT = 8 as const;

export const COLLABORATORS_DIRECTIVE_CONTEXT_ID =
  "btw-guardrail_collaborators" as ComposerContextId;

export interface ComposerCollaboratorSelection {
  readonly providerInstanceId: ProviderInstanceId;
  readonly model: string;
  readonly maxCount: number;
}

export type CollaboratorAuthMode =
  | "api_or_custom"
  | "local"
  | "personal_agy"
  | "subscription_oauth";

export type CollaboratorLockReason =
  | "agy_waiver_required"
  | "external_subscription_waiver_required";

export interface CollaboratorGovernanceState {
  readonly authMode: CollaboratorAuthMode;
  readonly authBadgeLabel: string;
  readonly locked: boolean;
  readonly lockReason: CollaboratorLockReason | null;
  readonly lockTooltip: string | null;
  readonly waiverRoute: typeof COLLABORATOR_WAIVER_ROUTE;
}

export interface ResolvedCollaboratorDescriptor {
  readonly providerInstanceId: ProviderInstanceId;
  readonly displayName: string;
  readonly model: string;
  readonly maxCount: number;
}

let cachedProviderProbes: ReadonlyArray<CollaboratorProviderProbeLike> = [];

export function getCachedProviderProbes(): ReadonlyArray<CollaboratorProviderProbeLike> {
  return cachedProviderProbes;
}

export function setCachedProviderProbes(
  probes: ReadonlyArray<CollaboratorProviderProbeLike> | null | undefined,
): void {
  cachedProviderProbes = Array.isArray(probes) ? [...probes] : [];
}

export function resetCachedProviderProbes(): void {
  cachedProviderProbes = [];
}

export function clampSingleCollaboratorCount(raw: number): number {
  if (!Number.isFinite(raw)) return MIN_COLLABORATOR_COUNT;
  return Math.max(
    MIN_COLLABORATOR_COUNT,
    Math.min(MAX_COLLABORATOR_COUNT_PER_AGENT, Math.floor(raw)),
  );
}

export function getTotalCollaboratorCount(
  selections: ReadonlyArray<Pick<ComposerCollaboratorSelection, "maxCount">>,
): number {
  let total = 0;
  for (const item of selections) {
    total += clampSingleCollaboratorCount(item.maxCount);
  }
  return total;
}

export function getRemainingCollaboratorCapacity(
  selections: ReadonlyArray<Pick<ComposerCollaboratorSelection, "maxCount">>,
): number {
  return Math.max(0, MAX_TOTAL_COLLABORATOR_COUNT - getTotalCollaboratorCount(selections));
}

export function normalizeCollaboratorSelections(
  selections: ReadonlyArray<ComposerCollaboratorSelection> | null | undefined,
): ComposerCollaboratorSelection[] {
  if (!Array.isArray(selections) || selections.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: ComposerCollaboratorSelection[] = [];
  let remaining = MAX_TOTAL_COLLABORATOR_COUNT;

  for (const raw of selections) {
    if (!raw || typeof raw !== "object") continue;
    const providerInstanceId =
      typeof raw.providerInstanceId === "string" ? raw.providerInstanceId.trim() : "";
    if (!providerInstanceId || seen.has(providerInstanceId)) continue;
    if (remaining <= 0) break;

    const clampedCount = Math.min(remaining, clampSingleCollaboratorCount(raw.maxCount));
    const model = typeof raw.model === "string" ? raw.model.trim() : "";
    seen.add(providerInstanceId);
    normalized.push({
      providerInstanceId: providerInstanceId as ProviderInstanceId,
      model,
      maxCount: clampedCount,
    });
    remaining -= clampedCount;
  }

  return normalized;
}

export function resolveDefaultModelForEntry(
  entry: Pick<ProviderInstanceEntry, "models">,
  modelOptions?: ReadonlyArray<Pick<AppModelOption, "slug">> | null,
): string {
  const firstOption = modelOptions?.find((option) => option.slug.trim().length > 0)?.slug.trim();
  if (firstOption) return firstOption;
  const firstModel = entry.models.find((model) => model.slug.trim().length > 0)?.slug.trim();
  return firstModel ?? "";
}

export function toggleCollaboratorSelection(
  selections: ReadonlyArray<ComposerCollaboratorSelection>,
  input: {
    readonly providerInstanceId: ProviderInstanceId;
    readonly defaultModel: string;
  },
): ComposerCollaboratorSelection[] {
  const existing = selections.find((item) => item.providerInstanceId === input.providerInstanceId);
  if (existing) {
    return selections.filter((item) => item.providerInstanceId !== input.providerInstanceId);
  }
  if (getRemainingCollaboratorCapacity(selections) < MIN_COLLABORATOR_COUNT) {
    return normalizeCollaboratorSelections(selections);
  }
  return normalizeCollaboratorSelections([
    ...selections,
    {
      providerInstanceId: input.providerInstanceId,
      model: input.defaultModel.trim(),
      maxCount: MIN_COLLABORATOR_COUNT,
    },
  ]);
}

export function setCollaboratorModel(
  selections: ReadonlyArray<ComposerCollaboratorSelection>,
  providerInstanceId: ProviderInstanceId,
  model: string,
): ComposerCollaboratorSelection[] {
  const trimmedModel = model.trim();
  let changed = false;
  const next = selections.map((item) => {
    if (item.providerInstanceId !== providerInstanceId) return item;
    if (item.model === trimmedModel) return item;
    changed = true;
    return { ...item, model: trimmedModel };
  });
  return changed ? next : [...selections];
}

export function stepCollaboratorCount(
  selections: ReadonlyArray<ComposerCollaboratorSelection>,
  providerInstanceId: ProviderInstanceId,
  delta: 1 | -1,
): ComposerCollaboratorSelection[] {
  const current = selections.find((item) => item.providerInstanceId === providerInstanceId);
  if (!current) return [...selections];
  const remaining = getRemainingCollaboratorCapacity(selections);
  const nextCount =
    delta > 0
      ? Math.min(MAX_COLLABORATOR_COUNT_PER_AGENT, current.maxCount + Math.min(1, remaining))
      : Math.max(MIN_COLLABORATOR_COUNT, current.maxCount - 1);
  if (nextCount === current.maxCount) return [...selections];
  return selections.map((item) =>
    item.providerInstanceId === providerInstanceId ? { ...item, maxCount: nextCount } : item,
  );
}

export function removeCollaboratorSelection(
  selections: ReadonlyArray<ComposerCollaboratorSelection>,
  providerInstanceId: ProviderInstanceId,
): ComposerCollaboratorSelection[] {
  return selections.filter((item) => item.providerInstanceId !== providerInstanceId);
}

function canonicalProbeAliasesForEntry(entry: ProviderInstanceEntry): ReadonlyArray<string> {
  const aliases = new Set<string>();
  const add = (value: string | null | undefined) => {
    const normalized = value?.trim().toLowerCase();
    if (normalized) aliases.add(normalized);
  };
  add(entry.instanceId);
  add(entry.driverKind);
  add(entry.acpRegistryAgentId);

  if (isAntigravityEntry(entry)) {
    add("antigravity");
    add("agy");
  }
  if (entry.driverKind === "claudeAgent") {
    add("claude");
    add("claude-code");
    add("claude_code");
    add("claudeagent");
  }
  if (entry.driverKind === "codex") {
    add("codex");
  }
  if (isDshEntry(entry)) {
    add("dsh");
    add("deepseek-harness");
  }
  return [...aliases];
}

export function findProviderProbeForEntry(
  entry: ProviderInstanceEntry,
  probes: ReadonlyArray<CollaboratorProviderProbeLike> | null | undefined,
): CollaboratorProviderProbeLike | null {
  if (!probes || probes.length === 0) return null;
  const aliases = canonicalProbeAliasesForEntry(entry);
  for (const alias of aliases) {
    const exact = probes.find((probe) => probe.providerId.trim().toLowerCase() === alias);
    if (exact) return exact;
  }
  return null;
}

function isExplicitSnapshotSubscriptionOAuth(snapshot: ServerProvider): boolean {
  const auth = snapshot.auth;
  if (!auth) return false;
  const authType = typeof auth.type === "string" ? auth.type.trim().toLowerCase() : "";
  const subscriptionType =
    typeof auth.subscriptionType === "string" ? auth.subscriptionType.trim().toLowerCase() : "";
  const authLabel = typeof auth.label === "string" ? auth.label.trim().toLowerCase() : "";

  if (
    authType.includes("api") ||
    authType.includes("custom") ||
    authType.includes("key") ||
    authType.includes("local") ||
    authLabel.includes("api") ||
    authLabel.includes("custom")
  ) {
    return false;
  }
  if (subscriptionType.length > 0) {
    return true;
  }
  return (
    authType === "oauth" ||
    authType === "chatgpt" ||
    authType === "claudeai" ||
    authType === "claude_ai" ||
    authType === "subscription" ||
    authType === "subscription_oauth"
  );
}

export function resolveCollaboratorAuthMode(
  entry: ProviderInstanceEntry,
  probes?: ReadonlyArray<CollaboratorProviderProbeLike> | null,
): CollaboratorAuthMode {
  const probe = findProviderProbeForEntry(entry, probes);

  if (isAntigravityEntry(entry)) {
    if (probe?.authMode === "api_or_custom") return "api_or_custom";
    if (probe?.authMode === "local") return "local";
    return "personal_agy";
  }

  if (probe) {
    if (probe.authMode === "subscription_oauth") return "subscription_oauth";
    if (probe.authMode === "local") return "local";
    if (probe.authMode === "api_or_custom") return "api_or_custom";
  }

  if (
    (entry.driverKind === "codex" || entry.driverKind === "claudeAgent") &&
    isExplicitSnapshotSubscriptionOAuth(entry.snapshot)
  ) {
    return "subscription_oauth";
  }

  if (entry.driverKind === "ollama") {
    return "local";
  }

  return "api_or_custom";
}

export function isExternalSubscriptionCollaborationAllowed(
  waiver: CollaboratorWaiverPolicy | null | undefined,
): boolean {
  return waiver?.signed === true && waiver.allowExternalSubscriptionAgentsInSwarm === true;
}

export function evaluateCollaboratorGovernance(input: {
  readonly entry: ProviderInstanceEntry;
  readonly probes?: ReadonlyArray<CollaboratorProviderProbeLike> | null | undefined;
  readonly waiver: CollaboratorWaiverPolicy | null | undefined;
}): CollaboratorGovernanceState {
  const authMode = resolveCollaboratorAuthMode(input.entry, input.probes);

  if (authMode === "personal_agy") {
    const allowed = isAntigravityControlledAllowed(input.waiver);
    return {
      authMode,
      authBadgeLabel: "个人 AGY",
      locked: !allowed,
      lockReason: allowed ? null : "agy_waiver_required",
      lockTooltip: allowed
        ? null
        : "个人 Antigravity 默认锁定：需先在提供商合规设置签署统一免责并允许受控协作",
      waiverRoute: COLLABORATOR_WAIVER_ROUTE,
    };
  }

  if (authMode === "subscription_oauth") {
    const allowed = isExternalSubscriptionCollaborationAllowed(input.waiver);
    return {
      authMode,
      authBadgeLabel: "订阅 OAuth",
      locked: !allowed,
      lockReason: allowed ? null : "external_subscription_waiver_required",
      lockTooltip: allowed
        ? null
        : "外部个人订阅 OAuth 默认锁定：需先在提供商合规设置签署统一免责并允许订阅协作",
      waiverRoute: COLLABORATOR_WAIVER_ROUTE,
    };
  }

  return {
    authMode,
    authBadgeLabel: "API / 本地",
    locked: false,
    lockReason: null,
    lockTooltip: null,
    waiverRoute: COLLABORATOR_WAIVER_ROUTE,
  };
}

export function pruneLockedCollaborators(input: {
  readonly selections: ReadonlyArray<ComposerCollaboratorSelection>;
  readonly entries: ReadonlyArray<ProviderInstanceEntry>;
  readonly probes?: ReadonlyArray<CollaboratorProviderProbeLike> | null | undefined;
  readonly waiver: CollaboratorWaiverPolicy | null | undefined;
}): ComposerCollaboratorSelection[] {
  const normalized = normalizeCollaboratorSelections(input.selections);
  if (normalized.length === 0) return [];
  const entriesById = new Map(input.entries.map((entry) => [entry.instanceId, entry]));

  return normalized.filter((selection) => {
    const entry = entriesById.get(selection.providerInstanceId);
    if (!entry) {
      // Fail-closed for unknown Antigravity-like ids even if the instance snapshot is absent.
      if (isAntigravityEntry({ instanceId: selection.providerInstanceId })) {
        return isAntigravityControlledAllowed(input.waiver);
      }
      return true;
    }
    return !evaluateCollaboratorGovernance({
      entry,
      probes: input.probes,
      waiver: input.waiver,
    }).locked;
  });
}

function sanitizeDirectiveField(value: string): string {
  return value
    .replaceAll(/[\r\n|<>]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

export function resolveCollaboratorDescriptors(
  selections: ReadonlyArray<ComposerCollaboratorSelection>,
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ResolvedCollaboratorDescriptor[] {
  const normalized = normalizeCollaboratorSelections(selections);
  if (normalized.length === 0) return [];
  const entriesById = new Map(entries.map((entry) => [entry.instanceId, entry]));

  return normalized.map((selection) => {
    const entry = entriesById.get(selection.providerInstanceId);
    const displayName = sanitizeDirectiveField(entry?.displayName ?? selection.providerInstanceId);
    const model = sanitizeDirectiveField(
      selection.model || (entry ? resolveDefaultModelForEntry(entry) : "") || "default",
    );
    return {
      providerInstanceId: selection.providerInstanceId,
      displayName: displayName || selection.providerInstanceId,
      model,
      maxCount: selection.maxCount,
    };
  });
}

/**
 * Formats an ultra-lean `<prismux_collaborators>` directive (< ~250 bytes for typical multi-agent
 * selections). Returns `""` (0 bytes) when no collaborators are selected.
 */
export function formatCollaboratorsDirective(
  selections: ReadonlyArray<ComposerCollaboratorSelection>,
  entries: ReadonlyArray<ProviderInstanceEntry>,
): string {
  const descriptors = resolveCollaboratorDescriptors(selections, entries);
  if (descriptors.length === 0) return "";
  const lines = descriptors.map(
    (item) => `- ${item.providerInstanceId}|${item.displayName}|${item.model}|max=${item.maxCount}`,
  );
  return [
    "<prismux_collaborators>",
    "Optional delegate_task targets (use only if helpful; never exceed max):",
    ...lines,
    "</prismux_collaborators>",
  ].join("\n");
}

/**
 * Builds the invisible context record attached to `message.context.records` so `message.text`
 * stays 100% pure user prose with zero raw XML noise in chat bubbles or history recall.
 * Returns `null` when no collaborators are selected (0 bytes injected).
 */
export function buildCollaboratorsContextRecord(
  selections: ReadonlyArray<ComposerCollaboratorSelection>,
  entries: ReadonlyArray<ProviderInstanceEntry>,
): UnknownContextRecord | null {
  const descriptors = resolveCollaboratorDescriptors(selections, entries);
  const directive = formatCollaboratorsDirective(selections, entries);
  if (descriptors.length === 0 || directive.length === 0) {
    return null;
  }
  return {
    version: 1,
    kind: BTW_GUARDRAIL_CONTEXT_KIND,
    contextId: COLLABORATORS_DIRECTIVE_CONTEXT_ID,
    label: "Invited Collaborators",
    payload: {
      mode: "collaborators",
      instruction: directive,
      collaborators: descriptors.map((item) => ({
        providerInstanceId: item.providerInstanceId,
        displayName: item.displayName,
        model: item.model,
        maxCount: item.maxCount,
      })),
    },
  };
}

/**
 * Idempotently attaches `<prismux_collaborators>` to an optional `OrchestrationMessageContext`.
 * Strict 0-byte no-op when `selections` is empty: returns `context` verbatim.
 */
export function attachCollaboratorsContext(
  context: OrchestrationMessageContext | undefined,
  selections: ReadonlyArray<ComposerCollaboratorSelection>,
  entries: ReadonlyArray<ProviderInstanceEntry>,
): OrchestrationMessageContext | undefined {
  const record = buildCollaboratorsContextRecord(selections, entries);
  if (record === null) {
    return context;
  }
  const existingRecords = (context?.records ?? []).filter(
    (candidate) => candidate.contextId !== COLLABORATORS_DIRECTIVE_CONTEXT_ID,
  );
  return {
    version: 1,
    ...(context?.guest ? { guest: context.guest } : {}),
    records: [...existingRecords, record],
  };
}
