import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import {
  AuthProvidersManageScope,
  defaultInstanceIdForDriver,
  type EnvironmentId,
  isUnconfiguredDefaultInstanceEnabled,
  type ProjectId,
  type ProjectSettingsOverrides,
  ProviderDriverKind,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
  type ProviderInstanceMutation,
  resolveProviderInstanceEnabled,
  sessionGrantsScope,
  type ServerSettings,
  type SessionGrantInput,
} from "@t3tools/contracts";

export interface ProviderEnvironmentOptionLike {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

export function isProviderSettingsEnvironmentAvailable(input: {
  readonly connectionPhase: EnvironmentConnectionPhase;
  readonly hasServerConfig: boolean;
}): boolean {
  return input.connectionPhase === "connected" && input.hasServerConfig;
}

export function buildProviderEnvironmentOptions<T extends ProviderEnvironmentOptionLike>(
  environments: ReadonlyArray<T>,
  primaryEnvironmentId: EnvironmentId | null,
  environmentIds?: readonly EnvironmentId[],
): ReadonlyArray<T> {
  const allowed = environmentIds ? new Set(environmentIds) : null;
  return environments
    .filter((environment) => !allowed || allowed.has(environment.environmentId))
    .toSorted((left, right) => {
      const leftIsPrimary = left.environmentId === primaryEnvironmentId;
      const rightIsPrimary = right.environmentId === primaryEnvironmentId;
      if (leftIsPrimary !== rightIsPrimary) {
        return leftIsPrimary ? -1 : 1;
      }
      return (
        left.label.localeCompare(right.label) ||
        String(left.environmentId).localeCompare(String(right.environmentId))
      );
    });
}

export function resolveSelectedProviderEnvironmentId(
  environments: ReadonlyArray<ProviderEnvironmentOptionLike>,
  selectedEnvironmentId: EnvironmentId | null,
  primaryEnvironmentId: EnvironmentId | null,
): EnvironmentId | null {
  if (
    selectedEnvironmentId !== null &&
    environments.some((environment) => environment.environmentId === selectedEnvironmentId)
  ) {
    return selectedEnvironmentId;
  }
  if (
    primaryEnvironmentId !== null &&
    environments.some((environment) => environment.environmentId === primaryEnvironmentId)
  ) {
    return primaryEnvironmentId;
  }
  return environments[0]?.environmentId ?? null;
}

export type ProviderEnvironmentAccess =
  | { readonly kind: "editable" }
  | { readonly kind: "loading"; readonly reason: "config" | "permissions" }
  | { readonly kind: "read-only" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "error" };

export type ProviderOperateAccess = "granted" | "denied" | "pending";

export function resolveRemoteOperateAccess(input: {
  readonly session: SessionGrantInput | null;
  readonly isPending: boolean;
  readonly hasError: boolean;
}): ProviderOperateAccess {
  if (input.hasError) return "denied";
  if (input.session === null) return input.isPending ? "pending" : "denied";
  return sessionGrantsScope(input.session, AuthProvidersManageScope) ? "granted" : "denied";
}

/** Send providerInstances even when empty; omission preserves the stored map for older clients. */

export function buildProviderInstanceOverridePatch(
  settings: Pick<ServerSettings, "projectSettingsOverrides">,
  projectIds: readonly ProjectId[],
  instanceId: ProviderInstanceId,
  value: boolean | undefined,
): Record<ProjectId, ProjectSettingsOverrides | null> {
  const patch: Record<ProjectId, ProjectSettingsOverrides | null> = {};
  for (const projectId of projectIds) {
    const current = settings.projectSettingsOverrides[projectId];
    const instances = { ...current?.providerInstances };
    const instance = { ...instances[instanceId] };
    if (value === undefined) delete instance.enabled;
    else instance.enabled = value;
    if (Object.keys(instance).length > 0) instances[instanceId] = instance;
    else delete instances[instanceId];

    const { providerInstances: _omit, ...rest } = current ?? {};
    const nextEntry: ProjectSettingsOverrides = { ...rest, providerInstances: instances };
    patch[projectId] =
      Object.keys(rest).length === 0 && Object.keys(instances).length === 0 ? null : nextEntry;
  }
  return patch;
}

export function classifyProviderEnvironmentAccess(input: {
  readonly connectionPhase: EnvironmentConnectionPhase;
  readonly hasServerConfig: boolean;
  readonly operateAccess: ProviderOperateAccess;
}): ProviderEnvironmentAccess {
  if (input.connectionPhase === "error") {
    return { kind: "error" };
  }
  if (input.connectionPhase !== "connected") {
    return { kind: "unavailable" };
  }
  if (!input.hasServerConfig) {
    return { kind: "loading", reason: "config" };
  }
  if (input.operateAccess === "pending") {
    return { kind: "loading", reason: "permissions" };
  }
  if (input.operateAccess === "denied") {
    return { kind: "read-only" };
  }
  return { kind: "editable" };
}

export type ProviderRemovalKind = "delete-custom" | "delete-optional" | "remove-builtin";

export interface ProviderSettingsRowDescriptor {
  readonly instanceId: ProviderInstanceId;
  /** Undefined for a default slot the user never configured. */
  readonly explicitInstance: ProviderInstanceConfig | undefined;
  readonly driver: ProviderDriverKind;
  readonly isDefault: boolean;
  readonly isCoreDefault: boolean;
  readonly isDirty: boolean;
  readonly removalKind: ProviderRemovalKind;
}

export function isCoreDefaultProviderInstance(
  driver: ProviderDriverKind,
  instanceId: ProviderInstanceId,
): boolean {
  return (
    instanceId === defaultInstanceIdForDriver(driver) &&
    (isUnconfiguredDefaultInstanceEnabled(instanceId) ||
      resolveProviderInstanceEnabled({ driver }))
  );
}

export function classifyProviderRemoval(input: {
  readonly isDefault: boolean;
  readonly isCoreDefault: boolean;
}): ProviderRemovalKind {
  if (!input.isDefault) return "delete-custom";
  return input.isCoreDefault ? "remove-builtin" : "delete-optional";
}

export function canDeleteProviderRow(input: {
  readonly explicitInstance: ProviderInstanceConfig | undefined;
  readonly isCoreDefault: boolean;
  readonly readOnly: boolean;
}): boolean {
  if (input.readOnly) return false;
  return input.isCoreDefault || input.explicitInstance !== undefined;
}

export function buildProviderInstanceRows(input: {
  readonly visibleProviderSettings: ReadonlyArray<{
    readonly provider: ProviderDriverKind;
    readonly hasDefaultInstance: boolean;
  }>;
  readonly providerInstances: Readonly<Record<string, ProviderInstanceConfig>> | undefined;
  readonly hiddenDefaultProviderInstances?: ReadonlyArray<ProviderInstanceId> | undefined;
  readonly targetInstanceId?: ProviderInstanceId | undefined;
  readonly dismissedInstanceIds?: ReadonlySet<ProviderInstanceId> | undefined;
}): ReadonlyArray<ProviderSettingsRowDescriptor> {
  const instancesByDriver = new Map<
    ProviderDriverKind,
    Array<[ProviderInstanceId, ProviderInstanceConfig]>
  >();
  for (const [rawId, instance] of Object.entries(input.providerInstances ?? {})) {
    const driver = instance.driver;
    const list = instancesByDriver.get(driver) ?? [];
    list.push([rawId as ProviderInstanceId, instance]);
    instancesByDriver.set(driver, list);
  }

  const defaultSlotIdsBySource = new Set<string>(
    input.visibleProviderSettings.map((providerSettings) =>
      String(defaultInstanceIdForDriver(providerSettings.provider)),
    ),
  );
  const hiddenDefaultIds = new Set<string>(input.hiddenDefaultProviderInstances ?? []);
  const visibleDriverKinds = new Set<ProviderDriverKind>(
    input.visibleProviderSettings.map((providerSettings) => providerSettings.provider),
  );

  const rows: ProviderSettingsRowDescriptor[] = [];

  for (const providerSettings of input.visibleProviderSettings) {
    const driver = providerSettings.provider;
    const defaultInstanceId = defaultInstanceIdForDriver(driver);
    const explicitInstance = input.providerInstances?.[defaultInstanceId];
    const isDirty = explicitInstance !== undefined;
    const isCoreDefault = isCoreDefaultProviderInstance(driver, defaultInstanceId);
    const isHiddenDefault = !isDirty && hiddenDefaultIds.has(defaultInstanceId);
    const isDeepLinkedTarget =
      defaultInstanceId === input.targetInstanceId &&
      input.dismissedInstanceIds?.has(defaultInstanceId) !== true;
    const hasDefaultSlot = providerSettings.hasDefaultInstance || isDirty;
    if (
      hasDefaultSlot &&
      !isHiddenDefault &&
      (driver === "codex" ||
        driver === "claudeAgent" ||
        isDirty ||
        resolveProviderInstanceEnabled(explicitInstance ?? { driver }) ||
        isDeepLinkedTarget)
    ) {
      rows.push({
        instanceId: defaultInstanceId,
        explicitInstance,
        driver,
        isDefault: true,
        isCoreDefault,
        isDirty,
        removalKind: classifyProviderRemoval({ isDefault: true, isCoreDefault }),
      });
    }
    for (const [id, instance] of instancesByDriver.get(driver) ?? []) {
      if (id === defaultInstanceId) continue;
      rows.push({
        instanceId: id,
        explicitInstance: instance,
        driver: instance.driver,
        isDefault: false,
        isCoreDefault: false,
        isDirty: true,
        removalKind: "delete-custom",
      });
    }
  }

  for (const [driver, list] of instancesByDriver) {
    if (visibleDriverKinds.has(driver)) continue;
    for (const [id, instance] of list) {
      const isDefault = defaultSlotIdsBySource.has(String(id));
      rows.push({
        instanceId: id,
        explicitInstance: instance,
        driver: instance.driver,
        isDefault,
        isCoreDefault: false,
        isDirty: true,
        removalKind: classifyProviderRemoval({ isDefault, isCoreDefault: false }),
      });
    }
  }

  return rows;
}

export function resolveNextSelectedProviderInstanceId(
  rows: ReadonlyArray<{ readonly instanceId: ProviderInstanceId }>,
  removedInstanceId: ProviderInstanceId,
  currentSelectedInstanceId: ProviderInstanceId | null,
): ProviderInstanceId | null {
  const remaining = rows.filter((row) => row.instanceId !== removedInstanceId);
  if (remaining.length === 0) return null;
  if (
    currentSelectedInstanceId !== null &&
    currentSelectedInstanceId !== removedInstanceId &&
    remaining.some((row) => row.instanceId === currentSelectedInstanceId)
  ) {
    return currentSelectedInstanceId;
  }
  const removedIndex = rows.findIndex((row) => row.instanceId === removedInstanceId);
  if (removedIndex === -1) return remaining[0]?.instanceId ?? null;
  return remaining[removedIndex]?.instanceId ?? remaining[removedIndex - 1]?.instanceId ?? null;
}

export function buildProviderRemovalMutation(input: {
  readonly instanceId: ProviderInstanceId;
  readonly removalKind: ProviderRemovalKind;
}): Extract<ProviderInstanceMutation, { readonly operation: "remove" }> {
  return input.removalKind === "remove-builtin"
    ? { operation: "remove", instanceId: input.instanceId, hideDefault: true }
    : { operation: "remove", instanceId: input.instanceId };
}

export function extractAcpRegistryManagedAgentId(
  instance: Pick<ProviderInstanceConfig, "driver" | "config">,
): string | null {
  if (instance.driver !== ProviderDriverKind.make("acpRegistry")) return null;
  if (instance.config === null || typeof instance.config !== "object") return null;
  const record = instance.config as Record<string, unknown>;
  if (typeof record.source === "string" && record.source.trim() === "local") return null;
  const agentId = typeof record.agentId === "string" ? record.agentId.trim() : "";
  return agentId.length > 0 ? agentId : null;
}
