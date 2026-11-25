import { SettingsGroup } from "./SettingsGroup";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import {
  AuthSettingsWriteScope,
  AuthProvidersManageScope,
  AuthOrchestrationReadScope,
} from "@t3tools/contracts";
import { useEnvironmentScope, readEnvironmentScope } from "../../state/session";
import { useAtomValue } from "@effect/atom-react";
import { connectionErrorText, connectionStatusTitle } from "@t3tools/client-runtime/connection";
import {
  errorDisplayMessage,
  safeErrorLogAttributes,
  thrownErrorMessage,
} from "@t3tools/client-runtime/errors";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  defaultInstanceIdForDriver,
  type EnvironmentId,
  type AcpRegistryUrlAuthAction,
  PROVIDER_DISPLAY_NAMES,
  ProviderDriverKind,
  type ProjectId,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
  type ServerProvider,
  resolveEnvironmentMachineKind,
  resolveProjectProviderInstanceEnabled,
  resolveProviderInstanceEnabled,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@t3tools/contracts/settings";
import * as Arr from "effect/Array";
import * as Result from "effect/Result";
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon, PlusIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import { m as resolveNow, type MessageResolver } from "../../i18n/messages";

import { isDesktopLocalConnectionTarget } from "../../connection/desktopLocal";
import {
  useEnvironmentSettings,
  usePersistEnvironmentProviderInstanceMutation,
  useUpdateEnvironmentSettings,
  useUpdateEnvironmentModelPreferences,
  useToggleEnvironmentModelFavorite,
} from "../../hooks/useSettings";
import { useStableCallback } from "../../hooks/useStableCallback";
import { ensureLocalApi } from "../../localApi";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { cn } from "../../lib/utils";
import { resolveAppModelSelectionState } from "../../modelSelection";
import {
  useEnvironments,
  usePrimaryEnvironmentId,
  type EnvironmentPresentation,
} from "../../state/environments";
import {
  EMPTY_SERVER_PROVIDERS,
  providersIgnoringCheckedAtAtom,
  serverEnvironment,
} from "../../state/server";
import { useEnvironmentSessionState } from "../../state/session";
import { useProjects } from "../../state/entities";
import { useAtomCommand } from "../../state/use-atom-command";
import { useRelativeTimeState } from "../../hooks/useRelativeTimeState";
import {
  ConnectionStatusDot,
  connectionPhaseDotClassName,
  connectionPhasePingClassName,
} from "../ConnectionStatusDot";
import {
  isProviderSettingsUpdateCandidate,
  isProviderUpdateActive,
  type ProviderSettingsUpdateCandidate,
} from "../ProviderUpdateLaunchNotification.logic";
import { ProviderUpdatesAction } from "../ProviderUpdatesAction";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { ScrollArea } from "../ui/scroll-area";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { AddProviderInstanceDialog } from "./AddProviderInstanceDialog";
import {
  ProviderDeleteDialog,
  type PendingProviderDeletion,
} from "./ProviderDeleteDialog";
import { useManagedPolicy } from "~/state/managedPolicy";
import { ExpandableText } from "./ExpandableText";
import { ProviderInstanceCard } from "./ProviderInstanceCard";
import { useSecretSources } from "./SecretSourceInput";
import { Badge } from "../ui/badge";
import { TextGeneratorsSettings } from "./TextGeneratorsSettings";
import { UsageProviderSettings } from "./UsageProviderSettings";
import { ProviderSetupSection } from "./ProviderSetupSection";
import { ProviderAuthenticationSection } from "./ProviderAuthenticationSection";
import { CodexSetupSection, CodexManagedRuntimeFields } from "./CodexSetupSection";
import { readCodexSetupMode } from "./CodexSetupSection.logic";
import { providerClients } from "./providerDriverMeta";
import { useSearchableSetting } from "./settingsSearch";
import { CompactIdleThreadsRow, ProviderUpdateChecksRow } from "./SettingsPanels";
import { buildProviderInstanceUpdatePatch } from "./SettingsPanels.logic";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
  useSettingsSearchTargetId,
} from "./settingsLayout";
import {
  buildProviderEnvironmentOptions,
  buildProviderInstanceOverridePatch,
  buildProviderInstanceRows,
  buildProviderRemovalMutation,
  canDeleteProviderRow,
  classifyProviderEnvironmentAccess,
  extractAcpRegistryManagedAgentId,
  isProviderSettingsEnvironmentAvailable,
  type ProviderEnvironmentAccess,
  type ProviderOperateAccess,
  type ProviderSettingsRowDescriptor,
  reorderProviderInstanceIds,
  resolveNextSelectedProviderInstanceId,
  resolveRemoteOperateAccess,
  resolveSelectedProviderEnvironmentId,
} from "./ProviderSettingsPanel.logic";
import { supportsDualLaunchMode } from "./prismuxProviderMeta";
import { AntigravityControlledLockSection } from "../../prismux/AntigravityControlledLockSection";
import { formatAgentBrandName } from "../../prismux/agentBrand";
import {
  resolveEffectiveLaunchMode,
  useProviderLaunchModePreferences,
  type ProviderLaunchMode,
} from "./prismuxProviderMode";

function providerInstanceName(instance: ProviderInstanceConfig): string {
  return (
    instance.displayName?.trim() ||
    providerClients.get(instance.driver)?.label ||
    formatAgentBrandName(String(instance.driver))
  );
}

async function confirmProviderInstanceRemoval(
  question: string,
  consequence = "",
): Promise<boolean> {
  const message = `${question}\n${resolveNow(msg("Its saved settings, including any custom binary path, will be removed."))}${consequence}`;
  const confirmed = await settlePromise(() =>
    ensureLocalApi().dialogs.confirm(message, { variant: "destructive" }),
  );
  return confirmed._tag === "Success" && confirmed.value;
}

function modelListChanges(current: ReadonlyArray<string>, next: ReadonlyArray<string>) {
  const currentSet = new Set(current);
  const nextSet = new Set(next.map((model) => model.trim()).filter(Boolean));
  return [...new Set([...currentSet, ...nextSet])]
    .filter((model) => currentSet.has(model) !== nextSet.has(model))
    .map((model) => ({ model, selected: nextSet.has(model) }));
}

const PROVIDER_SETTINGS = providerClients.definitions.map((definition) => ({
  provider: definition.driverKind,
  hasDefaultInstance: definition.hasDefaultInstance !== false,
}));

function configuredBinaryPath(config: unknown): string {
  if (config === null || typeof config !== "object" || !("binaryPath" in config)) return "";
  return typeof config.binaryPath === "string" ? config.binaryPath.trim() : "";
}

// Subscribe only in the label because every status push restamps all providers' checkedAt.
function ProviderLastChecked({ environmentId }: { environmentId: EnvironmentId }) {
  const serverProviders =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const lastCheckedAt =
    serverProviders.length > 0
      ? serverProviders.reduce(
          (latest, provider) => (provider.checkedAt > latest ? provider.checkedAt : latest),
          serverProviders[0]!.checkedAt,
        )
      : null;
  const lastCheckedRelative = useRelativeTimeState(lastCheckedAt);
  const gt = useGT();

  if (lastCheckedRelative.status === "missing") {
    return null;
  }

  if (lastCheckedRelative.status === "invalid") {
    return (
      <span>
        <T>Checked unavailable</T>
      </span>
    );
  }

  return (
    <span>
      {lastCheckedRelative.suffix ? (
        <T context="the time is an elapsed time such as 5m">
          Checked{" "}
          <span className="font-mono tabular-nums">
            <Var>{lastCheckedRelative.value}</Var>
          </span>{" "}
          ago
        </T>
      ) : (
        gt("Checked {time}", { time: lastCheckedRelative.value })
      )}
    </span>
  );
}

function providerEnvironmentDetail(
  environment: EnvironmentPresentation,
  resolve: MessageResolver,
): string {
  if (environment.entry.target._tag === "PrimaryConnectionTarget")
    return resolve(msg("Primary device"));
  if (environment.relayManaged) return resolve(msg("Remote relay"));
  if (environment.entry.target._tag === "SshConnectionTarget") return "SSH";
  if (isDesktopLocalConnectionTarget(environment.entry.target)) return resolve(msg("Local device"));
  return environment.displayUrl ?? resolve(msg("Remote device"));
}

const providerCardHeightClassName =
  "@min-[48rem]/providers:h-[min(44rem,calc(100dvh-11rem))] @min-[48rem]/providers:min-h-[32rem]";

function ProviderSettingsPlaceholder({
  deviceTabs,
  icon,
  title,
  description,
  children,
}: {
  readonly deviceTabs?: ReactNode;
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly children?: ReactNode;
}) {
  const searchableSetting = useSearchableSetting();
  return (
    <SettingsSection {...searchableSetting("providers")} variant="plain">
      {deviceTabs ? (
        <div className="flex min-h-11 min-w-0 items-center px-3 sm:px-4">{deviceTabs}</div>
      ) : null}
      <SettingsGroup
        divided={false}
        className={cn(
          providerCardHeightClassName,
          "scrollbar-gutter-both flex overflow-x-hidden overflow-y-auto",
        )}
      >
        <Empty>
          <EmptyMedia variant="icon">{icon}</EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>{title}</EmptyTitle>
            <EmptyDescription>{description}</EmptyDescription>
          </EmptyHeader>
          {children ? <EmptyContent className="max-w-xl">{children}</EmptyContent> : null}
        </Empty>
      </SettingsGroup>
    </SettingsSection>
  );
}

function EnvironmentUnavailablePlaceholder({
  environment,
  access,
  deviceTabs,
}: {
  readonly environment: EnvironmentPresentation;
  readonly access: Exclude<ProviderEnvironmentAccess, { kind: "editable" | "read-only" }>;
  readonly deviceTabs?: ReactNode;
}) {
  const gt = useGT();
  const m = useMessages();
  const isLoading = access.kind === "loading";
  const title = isLoading
    ? gt("Loading provider settings")
    : access.kind === "error"
      ? gt("Could not connect to this device")
      : gt("Provider settings are unavailable");
  const description = isLoading
    ? access.reason === "permissions"
      ? gt("Checking what this session is allowed to change.")
      : gt("Waiting for {environment}''s configuration.", { environment: environment.label })
    : connectionStatusTitle(environment.connection, m);
  const error = isLoading ? null : connectionErrorText(environment.connection, m);
  // Wedged devices can remain here indefinitely; a spinner would continuously repaint.
  return (
    <ProviderSettingsPlaceholder
      deviceTabs={deviceTabs}
      icon={
        <EnvironmentMachineIcon kind={resolveEnvironmentMachineKind(environment.serverConfig)} />
      }
      title={title}
      description={description}
    >
      {error ? (
        <ExpandableText
          key={environment.environmentId}
          text={error}
          className="w-full text-left font-mono text-xs leading-relaxed text-muted-foreground"
        />
      ) : null}
    </ProviderSettingsPlaceholder>
  );
}

interface ProviderSettingsTarget {
  readonly environmentId?: EnvironmentId;
  readonly instanceId?: ProviderInstanceId;
  readonly scoped?: boolean;
  readonly environmentIds?: readonly EnvironmentId[];
  readonly projectIds?: readonly ProjectId[];
}

export function ProviderSettingsPanel(target: ProviderSettingsTarget) {
  return (
    <SettingsPageContainer className="@container/providers gap-8">
      <ProviderSettingsPanelContent
        key={`${target.environmentId ?? ""}:${target.instanceId ?? ""}`}
        {...target}
      />
    </SettingsPageContainer>
  );
}

function ProviderSettingsPanelContent(target: ProviderSettingsTarget) {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const m = useMessages();
  const { environments, isReady } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const searchTargetId = useSettingsSearchTargetId();
  const options = buildProviderEnvironmentOptions(
    environments,
    primaryEnvironmentId,
    target.environmentIds,
  );
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<EnvironmentId | null>(
    target.environmentId ?? primaryEnvironmentId,
  );
  const targetEnvironmentMissing =
    target.environmentId !== undefined &&
    selectedEnvironmentId === target.environmentId &&
    !options.some((environment) => environment.environmentId === target.environmentId);
  const effectiveEnvironmentId =
    target.scoped || targetEnvironmentMissing
      ? target.environmentId
      : resolveSelectedProviderEnvironmentId(options, selectedEnvironmentId, primaryEnvironmentId);
  const selectedEnvironment =
    options.find((environment) => environment.environmentId === effectiveEnvironmentId) ?? null;
  const selectedEnvironmentCanRenderSettings =
    selectedEnvironment !== null &&
    isProviderSettingsEnvironmentAvailable({
      connectionPhase: selectedEnvironment.connection.phase,
      hasServerConfig: selectedEnvironment.serverConfig !== null,
    });
  const searchableEnvironmentId = options.find((environment) =>
    isProviderSettingsEnvironmentAvailable({
      connectionPhase: environment.connection.phase,
      hasServerConfig: environment.serverConfig !== null,
    }),
  )?.environmentId;
  let searchRedirectEnvironmentId: EnvironmentId | undefined;
  {
    if (
      !target.scoped &&
      (searchTargetId === searchableSetting("antigravity-controlled-lock").id ||
        searchTargetId === searchableSetting("usage-providers").id) &&
      !selectedEnvironmentCanRenderSettings &&
      searchableEnvironmentId !== undefined
    ) {
      searchRedirectEnvironmentId = searchableEnvironmentId;
    }
  }
  if (
    searchRedirectEnvironmentId !== undefined &&
    searchRedirectEnvironmentId !== selectedEnvironmentId
  ) {
    setSelectedEnvironmentId(searchRedirectEnvironmentId);
  }
  const onlyPrimaryDevice =
    options.length === 1 && options[0]?.entry.target._tag === "PrimaryConnectionTarget";
  const deviceTabs =
    !target.scoped && !onlyPrimaryDevice && options.length > 0 ? (
      <ScrollArea radius="none" hideScrollbars scrollFade className="h-11 min-w-0 flex-1">
        <ToggleGroup
          aria-label={gt("Devices")}
          variant="segmented"
          className="my-2"
          value={effectiveEnvironmentId ? [effectiveEnvironmentId] : []}
          onValueChange={(next) => {
            const environment = options.find((option) => option.environmentId === next[0]);
            if (environment) setSelectedEnvironmentId(environment.environmentId);
          }}
        >
          {options.map((environment) => {
            const machine = resolveEnvironmentMachineKind(environment.serverConfig);
            const detail = providerEnvironmentDetail(environment, m);
            const statusText = connectionStatusTitle(environment.connection, m);
            return (
              <Tooltip key={environment.environmentId}>
                <TooltipTrigger
                  render={
                    <Toggle value={environment.environmentId}>
                      <EnvironmentMachineIcon
                        kind={machine}
                        className="size-3.5 shrink-0"
                        aria-hidden
                      />
                      <span className="max-w-40 truncate">{environment.label}</span>
                      {environment.connection.phase !== "connected" ? (
                        <ConnectionStatusDot
                          dotClassName={connectionPhaseDotClassName(environment.connection.phase)}
                          pingClassName={connectionPhasePingClassName(environment.connection.phase)}
                        />
                      ) : null}
                      <span className="sr-only">
                        {detail}, {statusText}
                      </span>
                    </Toggle>
                  }
                />
                <TooltipPopup side="top">
                  {detail} · {statusText}
                </TooltipPopup>
              </Tooltip>
            );
          })}
        </ToggleGroup>
      </ScrollArea>
    ) : null;

  return (
    <>
      {targetEnvironmentMissing ? (
        <ProviderSettingsPlaceholder
          deviceTabs={deviceTabs}
          icon={<EnvironmentMachineIcon kind={resolveEnvironmentMachineKind(null)} />}
          title={gt("Device unavailable")}
          description={gt(
            "Reconnect this device to set up its provider, or select another device.",
          )}
        />
      ) : null}
      {options.length === 0 && !targetEnvironmentMissing ? (
        <ProviderSettingsPlaceholder
          icon={<EnvironmentMachineIcon kind={resolveEnvironmentMachineKind(null)} />}
          title={isReady ? gt("No connected devices") : gt("Loading devices")}
          description={
            isReady
              ? gt("Connect an execution environment before configuring providers.")
              : gt("Reading connected execution environments.")
          }
        />
      ) : null}

      {selectedEnvironment ? (
        <RemoteSessionGatedProviderSettings
          key={selectedEnvironment.environmentId}
          environment={selectedEnvironment}
          deviceTabs={deviceTabs}
          targetInstanceId={
            target.environmentId === undefined ||
            selectedEnvironment.environmentId === target.environmentId
              ? target.instanceId
              : undefined
          }
          projectIds={target.projectIds ?? []}
        />
      ) : null}
    </>
  );
}

function RemoteSessionGatedProviderSettings({
  environment,
  deviceTabs,
  targetInstanceId,
  projectIds,
}: {
  readonly environment: EnvironmentPresentation;
  readonly deviceTabs?: ReactNode;
  readonly targetInstanceId?: ProviderInstanceId | undefined;
  readonly projectIds: readonly ProjectId[];
}) {
  const sessionState = useEnvironmentSessionState(environment.environmentId);
  const operateAccess = resolveRemoteOperateAccess({
    session: sessionState.data,
    isPending: sessionState.isPending,
    hasError: sessionState.hasError,
  });
  return (
    <AccessGatedProviderSettings
      environment={environment}
      operateAccess={operateAccess}
      deviceTabs={deviceTabs}
      targetInstanceId={targetInstanceId}
      projectIds={projectIds}
    />
  );
}

function AccessGatedProviderSettings({
  environment,
  operateAccess,
  deviceTabs,
  targetInstanceId,
  projectIds,
}: {
  readonly environment: EnvironmentPresentation;
  readonly operateAccess: ProviderOperateAccess;
  readonly deviceTabs?: ReactNode;
  readonly targetInstanceId?: ProviderInstanceId | undefined;
  readonly projectIds: readonly ProjectId[];
}) {
  const access = classifyProviderEnvironmentAccess({
    connectionPhase: environment.connection.phase,
    hasServerConfig: environment.serverConfig !== null,
    operateAccess,
  });
  if (access.kind !== "editable" && access.kind !== "read-only") {
    return (
      <EnvironmentUnavailablePlaceholder
        environment={environment}
        access={access}
        deviceTabs={deviceTabs}
      />
    );
  }
  return (
    <EnvironmentProviderSettings
      environmentId={environment.environmentId}
      environmentLabel={environment.label}
      readOnly={access.kind === "read-only"}
      deviceTabs={deviceTabs}
      targetInstanceId={targetInstanceId}
      projectIds={projectIds}
    />
  );
}

const NO_PROJECT_IDS: readonly ProjectId[] = [];
const NO_FAVORITES: UnifiedSettings["favorites"] = [];

export function EnvironmentProviderSettings({
  environmentId,
  environmentLabel,
  readOnly = false,
  deviceTabs,
  targetInstanceId,
  projectIds = NO_PROJECT_IDS,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly deviceTabs?: ReactNode;
  readonly targetInstanceId?: ProviderInstanceId | undefined;
  readonly projectIds?: readonly ProjectId[];
  readonly readOnly?: boolean;
}) {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const searchTargetId = useSettingsSearchTargetId();
  const antigravityLockTargetId = searchableSetting("antigravity-controlled-lock").id;
  const settings = useEnvironmentSettings(environmentId);
  const {
    state: launchModeState,
    setGlobalDefaultMode,
    setInstanceMode,
  } = useProviderLaunchModePreferences();
  const managedPolicy = useManagedPolicy(environmentId);
  // A policy that allows no provider leaves nothing to add.
  const canAddProvider =
    !readOnly && managedPolicy?.limits?.providers?.allowedDrivers?.length !== 0;
  const canWriteSettings = useEnvironmentScope(environmentId, AuthSettingsWriteScope);
  const canRefreshProviders = useEnvironmentScope(environmentId, AuthOrchestrationReadScope);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const updateModelPreferences = useUpdateEnvironmentModelPreferences(environmentId);
  const toggleModelFavorite = useToggleEnvironmentModelFavorite(environmentId);
  const persistProviderInstance = usePersistEnvironmentProviderInstanceMutation(environmentId);
  const serverProviders = useAtomValue(providersIgnoringCheckedAtAtom(environmentId));
  // Hide overrides on older servers that silently ignore providerInstances patches.
  const supportsProjectProviderOverrides = useAtomValue(
    serverEnvironment.configValueAtom(environmentId),
    (config) => config?.environment.capabilities.projectProviderInstanceOverrides === true,
  );
  const refreshServerProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const updateProvider = useAtomCommand(serverEnvironment.updateProvider, {
    reportFailure: false,
  });
  const uninstallAcpRegistryManagedBinary = useAtomCommand(
    serverEnvironment.uninstallAcpRegistryManagedBinary,
    { reportFailure: false },
  );
  const acceptAcpRegistryUrlAuth = useAtomCommand(serverEnvironment.acceptAcpRegistryUrlAuth, {
    reportFailure: false,
  });
  const [isRefreshingProviders, setIsRefreshingProviders] = useState(false);
  const [isAddInstanceDialogOpen, setIsAddInstanceDialogOpen] = useState(false);
  const [pendingDeletion, setPendingDeletion] = useState<PendingProviderDeletion | null>(null);
  const [isDeletingProvider, setIsDeletingProvider] = useState(false);
  const [dismissedInstanceIds, setDismissedInstanceIds] = useState<
    ReadonlySet<ProviderInstanceId>
  >(() => new Set());
  const [selectedInstanceId, setSelectedInstanceId] = useState<ProviderInstanceId | null>(
    targetInstanceId ?? null,
  );
  const [seenAntigravityLockTarget, setSeenAntigravityLockTarget] = useState<boolean>(
    () => searchTargetId === antigravityLockTargetId,
  );
  const [updatingProviderInstanceIds, setUpdatingProviderInstanceIds] = useState<
    ReadonlySet<ProviderInstanceId>
  >(() => new Set());
  const [optimisticProviderOrder, setOptimisticProviderOrder] = useState<{
    readonly baseKey: string;
    readonly order: ReadonlyArray<ProviderInstanceId>;
  } | null>(null);
  const [activeDragProviderId, setActiveDragProviderId] = useState<ProviderInstanceId | null>(null);
  const refreshingRef = useRef(false);
  const deletingProviderRef = useRef(false);
  const updatingInstanceIdsRef = useRef<Set<ProviderInstanceId>>(new Set());
  const providerSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const acceptUrlAuthentication = useStableCallback(
    (instanceId: ProviderInstanceId, action: AcpRegistryUrlAuthAction) => {
      void acceptAcpRegistryUrlAuth({
        environmentId,
        input: { instanceId, elicitationId: action.elicitationId },
      }).then((result) => {
        if (result._tag === "Success" && !result.value.accepted) {
          toastManager.add({
            type: "warning",
            title: gt("Authentication request expired"),
            description: gt("Refresh the provider and start the authentication flow again."),
          });
          return;
        }
        if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          toastManager.add({
            type: "error",
            title: gt("Could not continue authentication"),
            description:
              error instanceof Error
                ? (thrownErrorMessage(error, resolveNow) ?? error.message)
                : gt("The authentication request expired."),
          });
        }
      });
    },
  );

  const visibleProviderSettings = PROVIDER_SETTINGS.filter(
    (providerSettings) =>
      providerSettings.provider !== "cursor" ||
      serverProviders.some(
        (provider) =>
          provider.instanceId === defaultInstanceIdForDriver(ProviderDriverKind.make("cursor")),
      ),
  );

  const refreshProviders = () => {
    if (refreshingRef.current || !readEnvironmentScope(environmentId, AuthOrchestrationReadScope))
      return;
    refreshingRef.current = true;
    setIsRefreshingProviders(true);
    void (async () => {
      const result = await refreshServerProviders({
        environmentId,
        input: { refreshModels: true, reloadSecrets: true },
      });
      refreshingRef.current = false;
      setIsRefreshingProviders(false);
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        console.warn("Failed to refresh providers", {
          operation: "refresh-providers",
          environmentId,
          ...safeErrorLogAttributes(squashAtomCommandFailure(result)),
        });
      }
    })();
  };

  const runProviderUpdate = useStableCallback(
    async (
      candidate: Pick<ProviderSettingsUpdateCandidate, "driver" | "instanceId">,
      targetVersion?: string,
    ) => {
      if (!readEnvironmentScope(environmentId, AuthProvidersManageScope)) return;
      // Guard re-entry with a ref; deferred state updates cannot gate dispatch.
      if (updatingInstanceIdsRef.current.has(candidate.instanceId)) {
        return;
      }
      updatingInstanceIdsRef.current.add(candidate.instanceId);
      setUpdatingProviderInstanceIds((previous) => new Set(previous).add(candidate.instanceId));

      const result = await updateProvider({
        environmentId,
        input: {
          provider: candidate.driver,
          instanceId: candidate.instanceId,
          ...(targetVersion ? { targetVersion } : {}),
        },
      });
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: gt("Could not update {provider}", {
              provider: PROVIDER_DISPLAY_NAMES[candidate.driver] ?? candidate.driver,
            }),
            description:
              error instanceof Error
                ? (errorDisplayMessage(error, resolveNow) ?? error.message)
                : gt("The provider update command could not be started."),
          }),
        );
      }
      updatingInstanceIdsRef.current.delete(candidate.instanceId);
      setUpdatingProviderInstanceIds((previous) => {
        if (!previous.has(candidate.instanceId)) {
          return previous;
        }
        const next = new Set(previous);
        next.delete(candidate.instanceId);
        return next;
      });
    },
  );

  const settingsProviderOrderKey = settings.providerOrder.join("\0");
  const effectiveProviderOrder =
    optimisticProviderOrder !== null && optimisticProviderOrder.baseKey === settingsProviderOrderKey
      ? optimisticProviderOrder.order
      : settings.providerOrder;

  const rows = buildProviderInstanceRows({
    visibleProviderSettings,
    providerInstances: settings.providerInstances,
    hiddenDefaultProviderInstances: settings.hiddenDefaultProviderInstances,
    providerOrder: effectiveProviderOrder,
    targetInstanceId,
    dismissedInstanceIds,
  });

  const canReorderProviders = !readOnly && canWriteSettings && rows.length > 1;
  const activeDragIndex =
    activeDragProviderId !== null
      ? rows.findIndex((row) => row.instanceId === activeDragProviderId)
      : -1;

  const handleProviderDragStart = (event: DragStartEvent) => {
    setActiveDragProviderId(String(event.active.id) as ProviderInstanceId);
  };

  const handleProviderDragCancel = () => {
    setActiveDragProviderId(null);
  };

  const handleProviderDragEnd = (event: DragEndEvent) => {
    setActiveDragProviderId(null);
    if (!canReorderProviders || !event.over) return;
    const activeId = String(event.active.id) as ProviderInstanceId;
    const overId = String(event.over.id) as ProviderInstanceId;
    const nextOrder = reorderProviderInstanceIds(
      rows.map((row) => row.instanceId),
      activeId,
      overId,
    );
    if (!nextOrder) return;
    setOptimisticProviderOrder({
      baseKey: settingsProviderOrderKey,
      order: nextOrder,
    });
    updateSettings({ providerOrder: nextOrder });
  };

  const antigravityRow = rows.find((row) => row.driver === "antigravity") ?? null;
  const targetInstanceMissing =
    targetInstanceId !== undefined &&
    selectedInstanceId === targetInstanceId &&
    !dismissedInstanceIds.has(targetInstanceId) &&
    !rows.some((row) => row.instanceId === targetInstanceId);
  const selectedRow =
    rows.find((row) => row.instanceId === selectedInstanceId) ??
    (targetInstanceMissing
      ? null
      : searchTargetId === antigravityLockTargetId && antigravityRow
        ? antigravityRow
        : (rows[0] ?? null));
  if (searchTargetId === antigravityLockTargetId && !seenAntigravityLockTarget) {
    setSeenAntigravityLockTarget(true);
    if (antigravityRow && selectedRow?.instanceId !== antigravityRow.instanceId) {
      setSelectedInstanceId(antigravityRow.instanceId);
    }
  } else if (searchTargetId !== antigravityLockTargetId && seenAntigravityLockTarget) {
    setSeenAntigravityLockTarget(false);
  }

  const persistInstance = async (
    instanceId: ProviderInstanceId,
    next: ProviderInstanceConfig,
    textGenerationModelSelection?: Parameters<
      typeof buildProviderInstanceUpdatePatch
    >[0]["textGenerationModelSelection"],
  ) => {
    const { providerInstances: _providerInstances, ...patch } = buildProviderInstanceUpdatePatch({
      settings,
      instanceId,
      instance: next,
      textGenerationModelSelection,
    });
    const result = await persistProviderInstance(
      { operation: "upsert", instanceId, instance: next },
      patch,
    );
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: gt("Could not update provider instance"),
        description:
          error instanceof Error
            ? (thrownErrorMessage(error, resolveNow) ?? error.message)
            : gt("The settings update failed."),
      });
    }
    return result._tag !== "Failure";
  };

  const updateInstance = useStableCallback(
    (
      instanceId: ProviderInstanceId,
      previous: ProviderInstanceConfig,
      next: ProviderInstanceConfig,
    ) => {
      const isDisabling = next.enabled === false && resolveProviderInstanceEnabled(previous);
      const shouldClearTextGen =
        isDisabling &&
        resolveAppModelSelectionState(settings, serverProviders).instanceId === instanceId &&
        readEnvironmentScope(environmentId, AuthSettingsWriteScope);
      return persistInstance(
        instanceId,
        next,
        shouldClearTextGen ? DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection : undefined,
      );
    },
  );

  const enableInstance = useStableCallback(
    (instanceId: ProviderInstanceId, next: ProviderInstanceConfig) =>
      persistInstance(instanceId, next),
  );

  const requestDeleteInstance = useStableCallback(
    (row: ProviderSettingsRowDescriptor, instance: ProviderInstanceConfig) => {
      if (readOnly || deletingProviderRef.current) return;
      setPendingDeletion({
        instanceId: row.instanceId,
        driver: row.driver,
        instance,
        displayName: providerInstanceName(instance),
        removalKind: row.removalKind,
        managedAcpAgentId: extractAcpRegistryManagedAgentId(instance),
      });
    },
  );

  const confirmDeleteInstance = useStableCallback(async () => {
    if (!pendingDeletion || deletingProviderRef.current) return;
    const target = pendingDeletion;
    deletingProviderRef.current = true;
    setIsDeletingProvider(true);
    try {
      const shouldClearTextGen =
        resolveAppModelSelectionState(settings, serverProviders).instanceId === target.instanceId &&
        readEnvironmentScope(environmentId, AuthSettingsWriteScope);
      const mutation = buildProviderRemovalMutation({
        instanceId: target.instanceId,
        removalKind: target.removalKind,
      });
      const updateResult = shouldClearTextGen
        ? await persistProviderInstance(mutation, {
            textGenerationModelSelection: DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
          })
        : await persistProviderInstance(mutation);
      if (updateResult._tag === "Failure") {
        if (!isAtomCommandInterrupted(updateResult)) {
          const error = squashAtomCommandFailure(updateResult);
          toastManager.add({
            type: "error",
            title: gt("Could not delete provider configuration"),
            description:
              error instanceof Error
                ? (thrownErrorMessage(error, resolveNow) ?? error.message)
                : gt("The settings update failed."),
          });
        }
        return;
      }

      const nextSelected = resolveNextSelectedProviderInstanceId(
        rows,
        target.instanceId,
        selectedRow?.instanceId ?? selectedInstanceId,
      );
      setDismissedInstanceIds((previous) => {
        const next = new Set(previous);
        next.add(target.instanceId);
        return next;
      });
      setSelectedInstanceId(nextSelected);
      setInstanceMode(target.instanceId, null);
      setPendingDeletion(null);
      toastManager.add({
        type: "success",
        title: gt("Provider configuration deleted"),
        description: gt("{provider} ({instanceId}) has been removed.", {
          provider: target.displayName,
          instanceId: target.instanceId,
        }),
      });

      if (target.managedAcpAgentId === null) return;
      // Concurrent removals race client snapshots; let the server decide whether the agent remains in use.
      const uninstallResult = await uninstallAcpRegistryManagedBinary({
        environmentId,
        input: { agentId: target.managedAcpAgentId },
      });
      if (uninstallResult._tag === "Failure" && !isAtomCommandInterrupted(uninstallResult)) {
        const error = squashAtomCommandFailure(uninstallResult);
        toastManager.add({
          type: "warning",
          title: gt("Provider deleted, but managed files remain"),
          description:
            error instanceof Error
              ? (thrownErrorMessage(error, resolveNow) ?? error.message)
              : gt("Managed binary cleanup failed."),
        });
      }
    } finally {
      deletingProviderRef.current = false;
      setIsDeletingProvider(false);
    }
  });

  const resetDefaultInstance = useStableCallback(async (driverKind: ProviderDriverKind) => {
    const instanceId = defaultInstanceIdForDriver(driverKind);
    const instance = settings.providerInstances?.[instanceId] ?? { driver: driverKind };
    const turnsOff =
      resolveProviderInstanceEnabled(instance) &&
      !resolveProviderInstanceEnabled({ driver: driverKind });
    const confirmed = await confirmProviderInstanceRemoval(
      gt("Reset the {provider} provider to its defaults?", {
        provider: providerInstanceName(instance),
      }),
      turnsOff ? ` ${gt("It will also be turned off.")}` : "",
    );
    if (!confirmed) return;
    const result = await persistProviderInstance({ operation: "remove", instanceId });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: gt("Could not reset provider instance"),
        description:
          error instanceof Error
            ? (thrownErrorMessage(error, resolveNow) ?? error.message)
            : gt("The settings update failed."),
      });
    }
  });

  const writeProjectOverride = useStableCallback(
    (instanceId: ProviderInstanceId, next: boolean | undefined) => {
      updateSettings({
        projectSettingsOverrides: buildProviderInstanceOverridePatch(
          settings,
          projectIds,
          instanceId,
          next,
        ),
      });
    },
  );

  const stableUpdateModelPreferences = useStableCallback(updateModelPreferences);
  const stableToggleModelFavorite = useStableCallback(toggleModelFavorite);
  const stableSetInstanceLaunchMode = useStableCallback(
    (instanceId: ProviderInstanceId, mode: ProviderLaunchMode | null) => {
      setInstanceMode(instanceId, mode);
    },
  );
  const actions: ProviderInstanceRowActions = {
    acceptUrlAuthentication,
    runProviderUpdate,
    updateInstance,
    enableInstance,
    requestDeleteInstance,
    resetDefaultInstance,
    writeProjectOverride,
    updateModelPreferences: stableUpdateModelPreferences,
    toggleModelFavorite: stableToggleModelFavorite,
    selectInstance: setSelectedInstanceId,
    setInstanceLaunchMode: stableSetInstanceLaunchMode,
  };
  // resolveModelPreferences falls back to a fresh `[]`; keep it stable for the rows.
  const favorites = settings.favorites.length > 0 ? settings.favorites : NO_FAVORITES;

  const representativeProjectId = projectIds[0];
  const renderProviderInstance = (
    row: ProviderSettingsRowDescriptor,
    mode: "list" | "editor",
    dragHandle?: ReactNode,
  ) => {
    const showProjectOverride =
      representativeProjectId !== undefined && supportsProjectProviderOverrides;
    const dualModeSupported = supportsDualLaunchMode({
      driver: row.driver,
      instanceId: row.instanceId,
      config: row.explicitInstance?.config,
    });
    const effectiveLaunchMode = resolveEffectiveLaunchMode(
      launchModeState,
      row.instanceId,
      dualModeSupported,
    );
    const isLaunchModeOverridden =
      dualModeSupported && launchModeState.perInstanceMode[row.instanceId] !== undefined;
    return (
      <ProviderInstanceRow
        key={row.instanceId}
        environmentId={environmentId}
        environmentLabel={environmentLabel}
        row={row}
        mode={mode}
        selected={mode === "list" && selectedRow?.instanceId === row.instanceId}
        readOnly={readOnly}
        canWriteSettings={canWriteSettings}
        liveProvider={serverProviders.find((candidate) => candidate.instanceId === row.instanceId)}
        isUpdateDispatching={updatingProviderInstanceIds.has(row.instanceId)}
        showProjectOverride={showProjectOverride}
        projectOverrideValue={
          showProjectOverride
            ? settings.projectSettingsOverrides[representativeProjectId]?.providerInstances?.[
                row.instanceId
              ]?.enabled
            : undefined
        }
        projectOverrideEffectiveEnabled={
          showProjectOverride
            ? resolveProjectProviderInstanceEnabled(
                settings,
                representativeProjectId,
                row.instanceId,
              )
            : false
        }
        launchMode={effectiveLaunchMode}
        isLaunchModeOverridden={isLaunchModeOverridden}
        modelPreferences={settings.providerModelPreferences?.[row.instanceId]}
        favorites={favorites}
        actions={actions}
        dragHandle={dragHandle}
      />
    );
  };

  const liveProvidersByInstanceId = new Map(
    serverProviders.map((candidate) => [candidate.instanceId, candidate] as const),
  );
  const installedProviderCount = rows.filter(
    (row) => liveProvidersByInstanceId.get(row.instanceId)?.installed === true,
  ).length;
  const allProvidersProbed =
    rows.length > 0 && rows.every((row) => liveProvidersByInstanceId.has(row.instanceId));

  return (
    <>
      <SettingsSection id="provider-defaults" title={gt("Defaults & CLI updates")}>
        <SettingsRow
          title={gt("Default launch mode")}
          description={gt(
            "Choose whether newly started provider sessions default to integrated Chat or terminal CLI mode.",
          )}
          control={
            <ToggleGroup
              aria-label={gt("Global default launch mode")}
              data-global-launch-mode-toggle
              variant="segmented"
              value={[launchModeState.globalDefaultMode]}
              onValueChange={(next) => {
                const picked = next[0];
                if (picked === "chat" || picked === "cli") {
                  setGlobalDefaultMode(picked);
                }
              }}
            >
              <Toggle value="chat">Chat</Toggle>
              <Toggle value="cli">CLI</Toggle>
            </ToggleGroup>
          }
        />
        <ProviderUpdateChecksRow />
      </SettingsSection>

      <SettingsSection
        {...searchableSetting("providers")}
        variant="plain"
        titleAction={
          <div className="flex items-center gap-1.5">
            {allProvidersProbed ? (
              <Badge
                variant={installedProviderCount > 0 ? "info" : "outline"}
                size="sm"
                className="font-mono text-2xs tabular-nums"
              >
                {gt("{count} detected", { count: installedProviderCount })}
              </Badge>
            ) : null}
            {canAddProvider ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-xs"
                      variant="ghost-muted"
                      onClick={() => setIsAddInstanceDialogOpen(true)}
                      aria-label={gt("Add provider")}
                    >
                      <PlusIcon />
                    </Button>
                  }
                />
                <TooltipPopup side="top">
                  <T>Add provider</T>
                </TooltipPopup>
              </Tooltip>
            ) : null}
          </div>
        }
        headerAction={
          // The ghost button's padding would inset its label, so pull the text to the card edge.
          <div className="-me-2 flex min-w-0 flex-wrap items-center gap-2">
            <ProviderUpdatesAction />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="xs"
                    variant="ghost-muted"
                    disabled={isRefreshingProviders || !canRefreshProviders}
                    aria-busy={isRefreshingProviders}
                    onClick={() => void refreshProviders()}
                  >
                    <RefreshIcon refreshing={isRefreshingProviders} />
                    <span className="sr-only">
                      <T>Refresh provider status</T>
                    </span>
                    <span className="hidden min-w-0 truncate sm:inline">
                      {isRefreshingProviders ? (
                        gt("Refreshing providers")
                      ) : (
                        <ProviderLastChecked environmentId={environmentId} />
                      )}
                    </span>
                  </Button>
                }
              />
              <TooltipPopup side="top">
                <T>Refresh provider status</T>
              </TooltipPopup>
            </Tooltip>
          </div>
        }
      >
        {deviceTabs ? (
          <div className="flex min-h-11 min-w-0 items-center gap-2 px-3 sm:px-4">{deviceTabs}</div>
        ) : null}
        {readOnly ? (
          <SettingsGroup divided={false} className="overflow-hidden">
            <SettingsRow
              title={gt("Limited permissions")}
              description={gt(
                "This session can view {environment}''s providers but can't change their settings.",
                { environment: environmentLabel },
              )}
            />
          </SettingsGroup>
        ) : null}
        <SettingsGroup
          divided={false}
          className={cn(
            providerCardHeightClassName,
            "overflow-hidden @min-[48rem]/providers:grid @min-[48rem]/providers:grid-cols-[23.5rem_minmax(0,1fr)]",
          )}
        >
          <div className="border-b border-border/60 bg-muted/10 @min-[48rem]/providers:flex @min-[48rem]/providers:min-h-0 @min-[48rem]/providers:flex-col @min-[48rem]/providers:border-r @min-[48rem]/providers:border-b-0">
            <ScrollArea
              scrollFade
              chainVerticalScroll
              className="@min-[48rem]/providers:min-h-0 @min-[48rem]/providers:flex-1"
            >
              <div className="divide-y divide-border/50">
                {allProvidersProbed && installedProviderCount === 0 && !isRefreshingProviders ? (
                  <div
                    data-slot="empty-agent-detection-banner"
                    className="flex items-center justify-between gap-2 bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground sm:px-4"
                  >
                    <span className="min-w-0 leading-snug">
                      {gt(
                        "No agents detected. If one is installed, the probe may have timed out.",
                      )}
                    </span>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={!canRefreshProviders}
                      onClick={() => void refreshProviders()}
                    >
                      <RefreshIcon refreshing={isRefreshingProviders} />
                      <span>{gt("Refresh")}</span>
                    </Button>
                  </div>
                ) : null}
                <DndContext
                  sensors={providerSensors}
                  collisionDetection={closestCenter}
                  modifiers={[restrictToVerticalAxis, restrictToParentElement]}
                  onDragStart={handleProviderDragStart}
                  onDragEnd={handleProviderDragEnd}
                  onDragCancel={handleProviderDragCancel}
                >
                  <SortableContext
                    items={rows.map((row) => row.instanceId)}
                    strategy={verticalListSortingStrategy}
                  >
                    {rows.map((row, index) => (
                      <SortableProviderListItem
                        key={row.instanceId}
                        instanceId={row.instanceId}
                        providerName={providerInstanceName(
                          row.explicitInstance ?? { driver: row.driver },
                        )}
                        index={index}
                        activeDragIndex={activeDragIndex}
                        disabled={!canReorderProviders}
                      >
                        {(dragHandle) => renderProviderInstance(row, "list", dragHandle)}
                      </SortableProviderListItem>
                    ))}
                  </SortableContext>
                </DndContext>
                {canAddProvider ? (
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-center gap-3 px-3 py-3 text-left text-sm text-muted-foreground transition-colors outline-none hover:bg-muted/25 hover:text-foreground focus-visible:bg-muted/25 focus-visible:text-foreground sm:px-4"
                    onClick={() => setIsAddInstanceDialogOpen(true)}
                  >
                    <PlusIcon className="size-4 shrink-0" />
                    <T>Add provider</T>
                  </button>
                ) : null}
              </div>
            </ScrollArea>
          </div>

          <div data-provider-detail className="min-w-0 @min-[48rem]/providers:min-h-0">
            {selectedRow ? (
              <ScrollArea scrollFade chainVerticalScroll className="@min-[48rem]/providers:h-full">
                {/* Flat sections run dividers edge to edge and inset text like the list beside them. */}
                <div className="space-y-6 py-4">
                  {renderProviderInstance(selectedRow, "editor")}
                </div>
              </ScrollArea>
            ) : targetInstanceMissing ? (
              <div className="p-6 text-sm text-muted-foreground">
                {gt("This provider instance is no longer available on this device.")}
              </div>
            ) : (
              <div
                data-slot="providers-empty-state"
                className="flex h-full items-center justify-center p-6"
              >
                <Empty>
                  <EmptyHeader>
                    <EmptyTitle>{gt("No providers configured.")}</EmptyTitle>
                    <EmptyDescription>
                      {gt("Add a provider to start chatting with your coding agents.")}
                    </EmptyDescription>
                  </EmptyHeader>
                  {canAddProvider ? (
                    <EmptyContent>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setIsAddInstanceDialogOpen(true)}
                      >
                        <PlusIcon className="size-3.5" />
                        <T>Add provider</T>
                      </Button>
                    </EmptyContent>
                  ) : null}
                </Empty>
              </div>
            )}
          </div>
        </SettingsGroup>
      </SettingsSection>

      <UsageProviderSettings
        key={environmentId}
        environmentId={environmentId}
        environmentLabel={environmentLabel}
        sources={settings.usageLimitSources}
        readOnly={readOnly}
      />

      {/* The server drops text generators under a provider allow-list. */}
      {managedPolicy?.limits?.providers?.allowedDrivers === undefined ? (
        <TextGeneratorsSettings
          key={`text-generators:${environmentId}`}
          environmentId={environmentId}
          environmentLabel={environmentLabel}
          providers={serverProviders}
          readOnly={readOnly}
        />
      ) : null}

      {selectedRow?.driver !== "antigravity" &&
      (antigravityRow !== null || searchTargetId === antigravityLockTargetId) ? (
        <div id={antigravityLockTargetId} tabIndex={-1}>
          <AntigravityControlledLockSection readOnly={readOnly} />
        </div>
      ) : null}

      <SettingsSection title={gt("Advanced")}>
        <CompactIdleThreadsRow />
      </SettingsSection>

      {isAddInstanceDialogOpen && !readOnly ? (
        <AddProviderInstanceDialog
          open
          environmentId={environmentId}
          environmentLabel={environmentLabel}
          onOpenChange={setIsAddInstanceDialogOpen}
          onCreated={(createdId) => {
            setDismissedInstanceIds((previous) => {
              if (!previous.has(createdId)) return previous;
              const next = new Set(previous);
              next.delete(createdId);
              return next;
            });
            setSelectedInstanceId(createdId);
          }}
        />
      ) : null}

      <ProviderDeleteDialog
        target={pendingDeletion}
        isDeleting={isDeletingProvider}
        onCancel={() => setPendingDeletion(null)}
        onConfirm={confirmDeleteInstance}
      />
    </>
  );
}

interface ProviderInstanceRowActions {
  readonly acceptUrlAuthentication: (
    instanceId: ProviderInstanceId,
    action: AcpRegistryUrlAuthAction,
  ) => void;
  readonly runProviderUpdate: (
    candidate: Pick<ProviderSettingsUpdateCandidate, "driver" | "instanceId">,
    targetVersion?: string,
  ) => Promise<void>;
  readonly updateInstance: (
    instanceId: ProviderInstanceId,
    previous: ProviderInstanceConfig,
    next: ProviderInstanceConfig,
  ) => Promise<boolean>;
  readonly enableInstance: (
    instanceId: ProviderInstanceId,
    next: ProviderInstanceConfig,
  ) => Promise<boolean>;
  readonly requestDeleteInstance: (
    row: ProviderSettingsRowDescriptor,
    instance: ProviderInstanceConfig,
  ) => void;
  readonly resetDefaultInstance: (driverKind: ProviderDriverKind) => Promise<void>;
  readonly writeProjectOverride: (
    instanceId: ProviderInstanceId,
    next: boolean | undefined,
  ) => void;
  readonly updateModelPreferences: ReturnType<typeof useUpdateEnvironmentModelPreferences>;
  readonly toggleModelFavorite: ReturnType<typeof useToggleEnvironmentModelFavorite>;
  readonly selectInstance: (instanceId: ProviderInstanceId) => void;
  readonly setInstanceLaunchMode: (
    instanceId: ProviderInstanceId,
    mode: ProviderLaunchMode | null,
  ) => void;
}

const NO_MODELS: ReadonlyArray<string> = [];

function SortableProviderListItem({
  instanceId,
  providerName,
  index,
  activeDragIndex,
  disabled,
  children,
}: {
  readonly instanceId: ProviderInstanceId;
  readonly providerName: string;
  readonly index: number;
  readonly activeDragIndex: number;
  readonly disabled: boolean;
  readonly children: (dragHandle: ReactNode) => ReactNode;
}) {
  const gt = useGT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
    useSortable({
      id: instanceId,
      disabled,
    });
  const showDropIndicatorBefore =
    isOver && !isDragging && activeDragIndex !== -1 && activeDragIndex > index;
  const showDropIndicatorAfter =
    isOver && !isDragging && activeDragIndex !== -1 && activeDragIndex < index;

  const dragHandle = disabled ? null : (
    <button
      type="button"
      {...attributes}
      {...listeners}
      data-provider-drag-handle={instanceId}
      aria-label={gt("Drag to reorder {provider}", { provider: providerName })}
      className="flex h-6 w-4 shrink-0 cursor-grab items-center justify-center rounded-sm text-muted-foreground/45 opacity-60 transition-opacity hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing group-hover:opacity-100"
      onClick={(event) => event.stopPropagation()}
    >
      <GripVerticalIcon className="size-3.5" />
    </button>
  );

  return (
    <div
      ref={setNodeRef}
      data-sortable-provider={instanceId}
      data-dragging={isDragging ? "true" : undefined}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      onPointerDown={
        disabled
          ? undefined
          : (event) => {
              listeners?.onPointerDown?.(event);
            }
      }
      className={cn(
        "relative",
        isDragging &&
          "z-20 scale-[1.01] rounded-lg bg-card/95 shadow-lg ring-1 ring-primary/45 backdrop-blur-sm",
      )}
    >
      {showDropIndicatorBefore ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-3 top-0 z-30 h-0.5 rounded-full bg-primary"
        />
      ) : null}
      {children(dragHandle)}
      {showDropIndicatorAfter ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-3 bottom-0 z-30 h-0.5 rounded-full bg-primary"
        />
      ) : null}
    </div>
  );
}

/** Stable props let this boundary return cached cards even when settings rebuild parent row elements. */
function ProviderInstanceRow({
  environmentId,
  environmentLabel,
  row,
  mode,
  selected,
  readOnly,
  canWriteSettings,
  liveProvider,
  isUpdateDispatching,
  showProjectOverride,
  projectOverrideValue,
  projectOverrideEffectiveEnabled,
  launchMode,
  isLaunchModeOverridden,
  modelPreferences,
  favorites,
  actions,
  dragHandle,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly row: ProviderSettingsRowDescriptor;
  readonly mode: "list" | "editor";
  readonly selected: boolean;
  readonly readOnly: boolean;
  readonly canWriteSettings: boolean;
  readonly liveProvider: ServerProvider | undefined;
  readonly isUpdateDispatching: boolean;
  readonly showProjectOverride: boolean;
  readonly projectOverrideValue: boolean | undefined;
  readonly projectOverrideEffectiveEnabled: boolean;
  readonly launchMode: ProviderLaunchMode;
  readonly isLaunchModeOverridden: boolean;
  readonly modelPreferences:
    | { readonly hiddenModels: ReadonlyArray<string>; readonly modelOrder: ReadonlyArray<string> }
    | undefined;
  readonly favorites: UnifiedSettings["favorites"];
  readonly actions: ProviderInstanceRowActions;
  readonly dragHandle?: ReactNode | undefined;
}) {
  const { instanceId, driver, explicitInstance, isCoreDefault, isDirty, removalKind } = row;
  const gt = useGT();
  const allProjects = useProjects();
  const secretSources = useSecretSources(environmentId);
  const acpProjects =
    mode === "editor" && liveProvider?.driver === "acpRegistry"
      ? allProjects.filter((project) => project.environmentId === environmentId)
      : undefined;
  const instance = explicitInstance ?? { driver };
  const driverOption = providerClients.get(driver);
  const updateCandidate =
    liveProvider !== undefined && isProviderSettingsUpdateCandidate(liveProvider)
      ? liveProvider
      : undefined;
  const isInstanceUpdateRunning =
    isUpdateDispatching || (liveProvider !== undefined && isProviderUpdateActive(liveProvider));
  const hiddenModels = modelPreferences?.hiddenModels ?? NO_MODELS;
  const modelOrder = modelPreferences?.modelOrder ?? NO_MODELS;
  const favoriteModels = Arr.filterMap(favorites, (favorite) =>
    favorite.provider === instanceId ? Result.succeed(favorite.model) : Result.failVoid,
  );
  const resetLabel = driverOption?.label ?? String(driver);
  const projectOverride = showProjectOverride
    ? {
        value: projectOverrideValue,
        effectiveEnabled: projectOverrideEffectiveEnabled,
        onChange: (next: boolean) => actions.writeProjectOverride(instanceId, next),
        onReset: () => actions.writeProjectOverride(instanceId, undefined),
      }
    : undefined;
  const codexSetupMode = driver === "codex" ? readCodexSetupMode(instance.config) : null;
  const recommendedVersion = liveProvider?.compatibilityAdvisory?.recommendedVersion;
  const canInstallRecommended =
    !readOnly &&
    liveProvider !== undefined &&
    Boolean(liveProvider.compatibilityAdvisory?.message) &&
    Boolean(recommendedVersion) &&
    liveProvider.versionAdvisory?.canInstallVersion === true;

  return (
    <ProviderInstanceCard
      environmentId={environmentId}
      secretSources={secretSources}
      acpProjects={acpProjects}
      projectOverride={projectOverride}
      launchMode={launchMode}
      isLaunchModeOverridden={isLaunchModeOverridden}
      onLaunchModeChange={(nextMode) => actions.setInstanceLaunchMode(instanceId, nextMode)}
      onLaunchModeReset={() => actions.setInstanceLaunchMode(instanceId, null)}
      dragHandle={dragHandle}
      onAcceptUrlAuth={
        readOnly ? undefined : (action) => actions.acceptUrlAuthentication(instanceId, action)
      }
      instanceId={instanceId}
      instance={instance}
      driverOption={driverOption}
      liveProvider={liveProvider}
      mode={mode}
      selected={selected}
      onSelect={mode === "list" ? () => actions.selectInstance(instanceId) : undefined}
      readOnly={readOnly}
      runtime={
        mode === "editor" && codexSetupMode === "managed" ? (
          <CodexManagedRuntimeFields
            environmentId={environmentId}
            instanceId={instanceId}
            provider={liveProvider}
          />
        ) : undefined
      }
      canWriteSettings={canWriteSettings}
      setup={
        mode === "editor" && driver === "antigravity" ? (
          <div className="divide-y divide-border/50">
            <ProviderSetupSection
              environmentId={environmentId}
              environmentLabel={environmentLabel}
              instanceId={instanceId}
              provider={liveProvider}
              binaryPath={configuredBinaryPath(instance.config)}
              enabled={resolveProviderInstanceEnabled(instance)}
              readOnly={readOnly}
              onEnable={() => actions.enableInstance(instanceId, { ...instance, enabled: true })}
            />
            <div id="antigravity-controlled-lock" tabIndex={-1} className="px-3 py-3 sm:px-4">
              <AntigravityControlledLockSection readOnly={readOnly} />
            </div>
          </div>
        ) : mode === "editor" && codexSetupMode === "managed" ? (
          <CodexSetupSection
            environmentId={environmentId}
            instanceId={instanceId}
            provider={liveProvider}
            mode={codexSetupMode}
            enabled={resolveProviderInstanceEnabled(instance)}
            readOnly={readOnly}
            onModeChange={(setupMode) =>
              actions.enableInstance(instanceId, {
                ...instance,
                enabled: true,
                config: {
                  ...(instance.config !== null && typeof instance.config === "object"
                    ? instance.config
                    : {}),
                  enabled: true,
                  setupMode,
                },
              })
            }
          />
        ) : mode === "editor" &&
          !readOnly &&
          liveProvider &&
          (liveProvider.setup?.canAuthenticate ||
            (liveProvider.driver === "acpRegistry" && liveProvider.installed)) ? (
          <ProviderAuthenticationSection
            key={`${environmentId}:${instanceId}`}
            environmentId={environmentId}
            environmentLabel={environmentLabel}
            instanceId={instanceId}
            provider={liveProvider}
            readOnly={readOnly}
          />
        ) : mode === "editor" &&
          !readOnly &&
          driver === "cursor" &&
          liveProvider?.setup?.canAuthenticate === false ? (
          <SettingsRow
            title={gt("Cursor account")}
            description={gt(
              "Using CURSOR_API_KEY. Remove it from this provider's environment to use browser sign-in.",
            )}
          />
        ) : null
      }
      onUpdate={(next) => actions.updateInstance(instanceId, instance, next)}
      removalKind={removalKind}
      showDeleteSlot={mode === "list" && !readOnly}
      onDelete={
        canDeleteProviderRow({ explicitInstance, isCoreDefault, readOnly })
          ? () => actions.requestDeleteInstance(row, instance)
          : undefined
      }
      headerAction={
        mode === "editor" && isCoreDefault && isDirty ? (
          <SettingResetButton
            ariaLabel={gt("Reset {provider} provider settings to default", {
              provider: resetLabel,
            })}
            onClick={() => actions.resetDefaultInstance(driver)}
          />
        ) : null
      }
      hiddenModels={hiddenModels}
      favoriteModels={favoriteModels}
      modelOrder={modelOrder}
      onHiddenModelsChange={(next, affectedModels) => {
        const hidden = new Set(next);
        void actions.updateModelPreferences({
          setModelsHidden: affectedModels.map((model) => ({
            provider: instanceId,
            model,
            hidden: hidden.has(model),
          })),
        });
      }}
      onToggleFavorite={(model) => {
        void actions.toggleModelFavorite(instanceId, model);
      }}
      onFavoriteModelsChange={(next) => {
        void actions.updateModelPreferences({
          setModelFavorites: modelListChanges(favoriteModels, next).map(({ model, selected }) => ({
            provider: instanceId,
            model,
            favorite: selected,
          })),
        });
      }}
      onModelOrderChange={(nextOrder) => {
        void actions.updateModelPreferences({
          setProviderModelOrder: { provider: instanceId, modelOrder: nextOrder },
        });
      }}
      onInstallRecommended={
        canInstallRecommended
          ? () => {
              void actions.runProviderUpdate(liveProvider, recommendedVersion ?? undefined);
            }
          : undefined
      }
      onRunUpdate={
        !readOnly && updateCandidate
          ? () => {
              if (!isInstanceUpdateRunning) void actions.runProviderUpdate(updateCandidate);
            }
          : undefined
      }
      isUpdating={isInstanceUpdateRunning}
    />
  );
}
