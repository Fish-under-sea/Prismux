import { thrownErrorMessage } from "@prismux/client-runtime/errors";
import { m as resolveMessage } from "~/i18n/messages";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";

import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { useAtomValue } from "@effect/atom-react";
import { ArrowUpCircleIcon, CheckIcon, ChevronDownIcon, ExternalLinkIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import type { MessageResolver } from "../../i18n/messages";
import {
  deriveAvailableInstanceId,
  deriveInstanceId,
} from "@prismux/client-runtime/provider-instance-ids";
import { squashAtomCommandFailure } from "@prismux/client-runtime/state/runtime";
import type { ProviderClientDefinition } from "@prismux/provider-core/client";
import {
  type AcpRegistrySearchAgent,
  AuthProvidersManageScope,
  ProviderInstanceId,
  ProviderDriverKind,
  type EnvironmentId,
  type ProviderInstanceConfig,
  type ProviderInstanceEnvironmentVariable,
  isManagedDriverAllowed,
} from "@prismux/core-contracts";

import {
  useEnvironmentSettings,
  usePersistEnvironmentProviderInstanceMutation,
} from "../../hooks/useSettings";

import { cn } from "../../lib/utils";
import { normalizeProviderAccentColor } from "../../providerInstances";
import { managedInstanceLocks, useManagedPolicy } from "../../state/managedPolicy";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { Button } from "../ui/button";
import { ChatGptConnectionButton } from "./ChatGptConnectionButton";
import { Dialog } from "../ui/dialog";
import { Badge } from "../ui/badge";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Input } from "../ui/input";
import { RadioGroup } from "../ui/radio-group";
import { toastManager } from "../ui/toast";
import { providerClients } from "./providerDriverMeta";
import { ProviderAccentColorPicker } from "./ProviderAccentColorPicker";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsRow } from "./settingsLayout";
import { ProviderSettingsForm, deriveProviderSettingsFields } from "./ProviderSettingsForm";
import { WizardPanel, WizardPopup, WizardHeader, WizardFooter } from "../ui/wizard";
import {
  ADD_PROVIDER_WIZARD_STEPS,
  ACP_REGISTRY_WIZARD_STEPS,
  LOCAL_ACP_WIZARD_STEPS,
  resolveAcpRegistryWizardNavigation,
  resolveWizardNavigation,
  updateProviderIdentityDraft,
  type ProviderIdentityDraft,
  type WizardNavigation,
} from "./AddProviderInstanceDialog.logic";
import { AddProviderInstanceWizardSteps } from "./AddProviderInstanceWizardSteps";
import { AcpRegistrySearchStep, useAcpRegistrySearch } from "./AcpRegistrySearchStep";
import { ProviderWizardAuthenticationStep } from "./ProviderWizardAuthenticationStep";
import { resolveOfficialAcpRegistryIconUrl } from "./AcpRegistryIcon";
import { AddManagedCodexAccountDialog } from "./CodexSetupSection";
import { MultipleAccountsNote } from "./MultipleAccountsNote";
import { ProviderEnvironmentSection } from "./ProviderInstanceCard";
import { useSecretSources } from "./SecretSourceInput";
import { serverEnvironment } from "../../state/server";
import {
  DSH_LOCAL_ACP_PRESET,
  openSafeExternalHttpsFromAnchor,
  resolveAgentCliMeta,
  resolveSafeAgentHomepageUrl,
  validateSafeHttpsUrl,
} from "./prismuxProviderMeta";
import { AgentInstallPrompt } from "./AgentInstallPrompt";
import {
  getProviderVersionAdvisoryPresentation,
  getProviderVersionLabel,
} from "./providerStatus";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";

const INSTANCE_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const DEFAULT_DRIVER_KIND = ProviderDriverKind.make("codex");
const ACP_REGISTRY_DRIVER_KIND = ProviderDriverKind.make("acpRegistry");
const DSH_FEATURED_PRESET_VALUE = "preset:dsh";
const DSH_FISH_LOGO_PATH =
  "M22.9168 1.43018C22.6713 1.31018 22.5658 1.53918 22.4223 1.65519C22.3733 1.69269 22.3318 1.74169 22.2903 1.78669C21.9317 2.1697 21.5127 2.42121 20.9657 2.39121C20.1657 2.34621 19.4827 2.59771 18.8787 3.20973C18.7502 2.45521 18.3236 2.0047 17.6746 1.71569C17.3351 1.56568 16.9916 1.41518 16.7536 1.08867C16.5876 0.856163 16.5421 0.597155 16.4591 0.341647C16.4061 0.187643 16.3536 0.0301382 16.1761 0.00363739C15.9836 -0.0263635 15.9081 0.135141 15.8326 0.270145C15.5306 0.822162 15.4136 1.43018 15.4251 2.0462C15.4516 3.43174 16.0366 4.53527 17.1991 5.3203C17.3311 5.4103 17.3651 5.5003 17.3236 5.63181C17.2441 5.90231 17.1501 6.16482 17.0671 6.43533C17.0141 6.60784 16.9351 6.64584 16.7501 6.57033C16.1121 6.30383 15.5611 5.90931 15.074 5.4328C14.2475 4.63328 13.5 3.75075 12.568 3.05973C12.349 2.89822 12.13 2.74822 11.9034 2.60522C10.9524 1.68169 12.028 0.923165 12.277 0.833162C12.5375 0.739159 12.3675 0.41615 11.5259 0.42015C10.6844 0.42365 9.91439 0.705658 8.93286 1.08117C8.78935 1.13767 8.63835 1.17867 8.48384 1.21267C7.59332 1.04367 6.66829 1.00617 5.70226 1.11517C3.88321 1.31768 2.43016 2.1777 1.36213 3.64575C0.0790928 5.4103 -0.222916 7.41536 0.146595 9.50642C0.535106 11.7105 1.66014 13.535 3.38869 14.9616C5.18125 16.4406 7.24581 17.1657 9.60138 17.0266C11.0319 16.9441 12.6245 16.7526 14.421 15.2321C14.874 15.4576 15.3496 15.5476 16.1381 15.6151C16.7456 15.6716 17.3306 15.5851 17.7836 15.4911C18.4931 15.3411 18.4441 14.6841 18.1876 14.5636C16.1081 13.595 16.5646 13.9891 16.1496 13.67C17.2061 12.42 18.8202 10.1979 19.3182 7.17235C19.3672 6.83834 19.4297 6.36783 19.4222 6.09732C19.4182 5.93231 19.4562 5.86831 19.6447 5.84931C20.1657 5.78931 20.6712 5.64681 21.1357 5.3913C22.4833 4.65528 23.0268 3.44624 23.1548 1.9972C23.1738 1.77569 23.1508 1.54668 22.9168 1.43018ZM11.1749 14.4736C9.15936 12.889 8.18184 12.3675 7.77832 12.39C7.40081 12.4125 7.46881 12.8445 7.55182 13.126C7.63882 13.404 7.75182 13.5955 7.91033 13.8396C8.01983 14.0011 8.09533 14.2411 7.80083 14.4216C7.15181 14.8231 6.02327 14.2866 5.97027 14.2601C4.65673 13.4865 3.5587 12.4655 2.78467 11.069C2.03715 9.72493 1.60314 8.28289 1.53164 6.74384C1.51264 6.37233 1.62214 6.24082 1.99215 6.17332C2.47916 6.08332 2.98118 6.06432 3.46769 6.13582C5.52476 6.43633 7.27581 7.35586 8.74385 8.8129C9.58188 9.64243 10.2159 10.634 10.8689 11.6025C11.5634 12.631 12.3105 13.611 13.262 14.4146C13.598 14.6961 13.866 14.9101 14.1225 15.0681C13.349 15.1546 12.058 15.1731 11.1749 14.4746L11.1749 14.4736ZM12.141 8.25988C12.141 8.09488 12.273 7.96338 12.439 7.96338C12.4765 7.96338 12.5105 7.97088 12.541 7.98188C12.5825 7.99688 12.6205 8.01938 12.6505 8.05338C12.7035 8.10588 12.7335 8.18088 12.7335 8.25988C12.7335 8.42489 12.6015 8.55639 12.4355 8.55639C12.2695 8.55639 12.141 8.42489 12.141 8.25988ZM15.1415 9.79893C14.949 9.87793 14.7565 9.94544 14.5715 9.95294C14.2845 9.96794 13.9715 9.85143 13.8015 9.70893C13.5375 9.48742 13.3485 9.36342 13.2695 8.97691C13.2355 8.8119 13.2545 8.55639 13.2845 8.40989C13.3525 8.09438 13.277 7.89187 13.0545 7.70787C12.8735 7.55786 12.643 7.51636 12.39 7.51636C12.2955 7.51636 12.209 7.47486 12.1445 7.44136C12.039 7.38886 11.9519 7.25735 12.035 7.09585C12.0615 7.04335 12.19 6.91584 12.22 6.89334C12.5635 6.69784 12.9595 6.76184 13.326 6.90834C13.6655 7.04735 13.9225 7.30236 14.292 7.66287C14.6695 8.09838 14.7375 8.21838 14.9525 8.54539C15.1225 8.8009 15.277 9.06341 15.3831 9.36392C15.4471 9.55142 15.3641 9.70493 15.1415 9.79893Z";

function DshBrandIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 23.16 17.04"
      fill="#4176E6"
      className={cn("size-4 shrink-0", className)}
    >
      <path d={DSH_FISH_LOGO_PATH} />
    </svg>
  );
}

const DEFAULT_DRIVER_OPTION = providerClients.definitions[0]!;
const DRIVER_OPTIONS = providerClients.definitions.filter(
  (option) => option.driverKind !== ACP_REGISTRY_DRIVER_KIND,
);
const FEATURED_DRIVER_OPTIONS = DRIVER_OPTIONS.filter((option) => option.featured !== false);
const MORE_DRIVER_OPTIONS = DRIVER_OPTIONS.filter((option) => option.featured === false);
const EMPTY_CONFIG_DRAFT: Record<string, unknown> = {};
function validateInstanceId(
  id: string,
  existing: ReadonlySet<string>,
  resolve: MessageResolver,
): string | null {
  if (id.length === 0) return resolve(msg("Instance ID is required."));
  if (id.length > 64) return resolve(msg("Instance ID must be 64 characters or fewer."));
  if (!INSTANCE_ID_PATTERN.test(id)) {
    return resolve(
      msg("Instance ID must start with a letter and use only letters, digits, '-', or '_'."),
    );
  }
  if (existing.has(id)) return resolve(msg("An instance named ''{id}'' already exists.", { id }));
  return null;
}

interface FeaturedLocalPresetOption {
  readonly insertAtIndex: number;
  readonly value: string;
  readonly label: string;
  readonly commandBadge: string;
  readonly icon: ReactNode;
}

function ProviderOptionGrid({
  options,
  value,
  disabled,
  onValueChange,
  liveProvidersByDriver,
  onCopyUpdateCommand,
  featuredPresetOption,
  ...labelProps
}: {
  readonly options: ReadonlyArray<ProviderClientDefinition>;
  readonly value: string;
  readonly disabled: boolean;
  readonly onValueChange: (value: string) => void;
  readonly liveProvidersByDriver?: ReadonlyMap<string, import("@prismux/core-contracts").ServerProvider>;
  readonly onCopyUpdateCommand?: (command: string, label: string) => void;
  readonly featuredPresetOption?: FeaturedLocalPresetOption | null;
  readonly "aria-label"?: string;
  readonly "aria-labelledby"?: string;
}) {
  const gt = useGT();
  const m = useMessages();
  const presetInsertIndex = featuredPresetOption
    ? Math.max(0, Math.min(featuredPresetOption.insertAtIndex, options.length))
    : -1;
  const renderOptionCard = (option: ProviderClientDefinition) => {
    const liveProvider = liveProvidersByDriver?.get(option.driverKind);
    const isNotInstalled = liveProvider !== undefined && !liveProvider.installed;
    const safeHomepageUrl = resolveSafeAgentHomepageUrl({
      driver: option.driverKind,
      displayName: option.label,
      documentationUrl: liveProvider?.setup?.documentationUrl ?? null,
    });
    const cliMeta = resolveAgentCliMeta({
      driver: option.driverKind,
      displayName: option.label,
    });
    const versionAdvisory = liveProvider
      ? getProviderVersionAdvisoryPresentation(
          liveProvider.versionAdvisory,
          liveProvider.compatibilityAdvisory,
          true,
          m,
        )
      : null;
    const updateCmd = versionAdvisory?.updateCommand ?? cliMeta?.updateCommandHint ?? null;
    const latestVerLabel = liveProvider?.versionAdvisory?.latestVersion
      ? getProviderVersionLabel(liveProvider.versionAdvisory.latestVersion)
      : null;
    const installedVerLabel = liveProvider?.version
      ? getProviderVersionLabel(liveProvider.version)
      : null;
    const updateTooltip =
      installedVerLabel && latestVerLabel
        ? gt("{installed} → {latest} · Copy official CLI update command: {command}", {
            installed: installedVerLabel,
            latest: latestVerLabel,
            command: updateCmd ?? "",
          })
        : gt("Copy official CLI update command: {command}", { command: updateCmd ?? "" });
    return (
      <RadioPrimitive.Root
        key={option.driverKind}
        value={option.driverKind}
        className="relative flex cursor-pointer flex-col gap-1.5 rounded-lg bg-card px-3 py-3 text-left text-muted-foreground outline-none ring-1 ring-black/5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-checked:bg-primary/8 data-checked:text-foreground data-checked:ring-2 data-checked:ring-inset data-checked:ring-primary data-checked:hover:bg-primary/8 dark:bg-white/3 dark:ring-white/5 dark:hover:bg-white/5 dark:data-checked:bg-primary/15 dark:data-checked:ring-primary dark:data-checked:hover:bg-primary/15"
      >
        <div className="flex w-full items-center gap-3">
          <ProviderInstanceIcon
            driverKind={option.driverKind}
            displayName={option.label}
            iconClassName="size-4"
          />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            {option.label}
          </span>
          {versionAdvisory && updateCmd ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onCopyUpdateCommand?.(updateCmd, option.label);
              }}
              title={updateTooltip}
              className="inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-primary/35 bg-primary/10 px-1.5 text-2xs font-medium text-primary hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowUpCircleIcon className="size-3 shrink-0" />
              <span className="tabular-nums">{latestVerLabel ?? gt("Update")}</span>
            </button>
          ) : null}
          <RadioPrimitive.Indicator
            className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
            aria-hidden
          >
            <CheckIcon className="size-3.5 shrink-0" />
          </RadioPrimitive.Indicator>
          {option.badgeLabel ? (
            <Badge variant="warning" size="sm">
              {option.badgeLabel}
            </Badge>
          ) : null}
        </div>
        {isNotInstalled ? (
          <div className="flex items-center justify-between gap-2 pl-7 text-2xs">
            <span className="text-muted-foreground">{gt("CLI not installed")}</span>
            {safeHomepageUrl ? (
              <a
                href={safeHomepageUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => {
                  event.stopPropagation();
                  openSafeExternalHttpsFromAnchor(event);
                }}
                className="inline-flex items-center gap-0.5 font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span>{gt("Install guide")}</span>
                <ExternalLinkIcon className="size-3 shrink-0" />
              </a>
            ) : null}
          </div>
        ) : null}
      </RadioPrimitive.Root>
    );
  };
  const renderPresetCard = (preset: FeaturedLocalPresetOption) => (
    <RadioPrimitive.Root
      key={preset.value}
      value={preset.value}
      data-preset="dsh-local-acp"
      className="relative flex cursor-pointer flex-col gap-1.5 rounded-lg bg-card px-3 py-3 text-left text-muted-foreground outline-none ring-1 ring-black/5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring data-checked:bg-primary/8 data-checked:text-foreground data-checked:ring-2 data-checked:ring-inset data-checked:ring-primary data-checked:hover:bg-primary/8 dark:bg-white/3 dark:ring-white/5 dark:hover:bg-white/5 dark:data-checked:bg-primary/15 dark:data-checked:ring-primary dark:data-checked:hover:bg-primary/15"
    >
      <div className="flex w-full items-center gap-3">
        {preset.icon}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {preset.label}
        </span>
        <Badge variant="outline" size="sm">
          {preset.commandBadge}
        </Badge>
        <RadioPrimitive.Indicator
          className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
          aria-hidden
        >
          <CheckIcon className="size-3.5 shrink-0" />
        </RadioPrimitive.Indicator>
      </div>
    </RadioPrimitive.Root>
  );

  const cards: Array<ReactNode> = [];
  for (let index = 0; index < options.length; index += 1) {
    if (featuredPresetOption && index === presetInsertIndex) {
      cards.push(renderPresetCard(featuredPresetOption));
    }
    cards.push(renderOptionCard(options[index]!));
  }
  if (featuredPresetOption && presetInsertIndex >= options.length) {
    cards.push(renderPresetCard(featuredPresetOption));
  }

  return (
    <RadioGroup
      {...labelProps}
      disabled={disabled}
      value={value}
      onValueChange={onValueChange}
      className="grid grid-cols-1 sm:grid-cols-2"
    >
      {cards}
    </RadioGroup>
  );
}

interface AddProviderInstanceDialogProps {
  readonly open: boolean;
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreated?: (instanceId: ProviderInstanceId, driver: ProviderDriverKind) => void;
  /** Opens with "Show more" expanded, so the ACP Registry search is in view. */
  readonly showMoreProviders?: boolean;
}

export function AddProviderInstanceDialog({
  open,
  environmentId,
  environmentLabel,
  onOpenChange,
  onCreated,
  showMoreProviders: initialShowMoreProviders = false,
}: AddProviderInstanceDialogProps) {
  const gt = useGT();
  const m = useMessages();
  const settings = useEnvironmentSettings(environmentId);
  const liveProviders = useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? [];
  const liveProvidersByDriver = new Map<string, (typeof liveProviders)[number]>();
  for (const provider of liveProviders) {
    if (!liveProvidersByDriver.has(provider.driver)) {
      liveProvidersByDriver.set(provider.driver, provider);
    }
  }
  const { copyToClipboard: copyCliUpdateCommand } = useCopyToClipboard<{ label: string }>({
    onCopy: ({ label: providerLabel }) => {
      toastManager.add({
        type: "success",
        title: gt("{provider} update command copied", { provider: providerLabel }),
        description: gt("Run it in your terminal to update the official CLI."),
      });
    },
  });
  const secretSources = useSecretSources(environmentId);
  const persistProviderInstance = usePersistEnvironmentProviderInstanceMutation(environmentId);
  const canManageProviders = useEnvironmentScope(environmentId, AuthProvidersManageScope);

  const [wizardStep, setWizardStep] = useState(0);
  const [addingChatGptAccount, setAddingChatGptAccount] = useState(false);
  // Drivers the administrator's policy leaves out are not offered at all.
  const managedPolicy = useManagedPolicy(environmentId);
  const featuredDriverOptions = FEATURED_DRIVER_OPTIONS.filter((option) =>
    isManagedDriverAllowed(managedPolicy, option.driverKind),
  );
  const moreDriverOptions = MORE_DRIVER_OPTIONS.filter((option) =>
    isManagedDriverAllowed(managedPolicy, option.driverKind),
  );
  const acpRegistryAllowed = isManagedDriverAllowed(managedPolicy, ACP_REGISTRY_DRIVER_KIND);
  const [driver, setDriver] = useState<ProviderDriverKind>(
    () =>
      (featuredDriverOptions[0] ?? moreDriverOptions[0])?.driverKind ??
      (acpRegistryAllowed ? ACP_REGISTRY_DRIVER_KIND : DEFAULT_DRIVER_KIND),
  );
  const [identityByDriver, setIdentityByDriver] = useState<Record<string, ProviderIdentityDraft>>(
    {},
  );
  const [selectedAcp, setSelectedAcp] = useState<AcpRegistrySearchAgent | null>(null);
  const [selectedFeaturedPreset, setSelectedFeaturedPreset] = useState<"dsh" | null>(null);
  const [localEnvironment, setLocalEnvironment] = useState<
    ReadonlyArray<ProviderInstanceEnvironmentVariable>
  >([]);
  const [isManualAcpConfiguration, setIsManualAcpConfiguration] = useState(false);
  const [showMoreProviders, setShowMoreProviders] = useState(initialShowMoreProviders);
  const [configByDriver, setConfigByDriver] = useState<Record<string, Record<string, unknown>>>({});
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [createdInstanceId, setCreatedInstanceId] = useState<ProviderInstanceId | null>(null);

  // Reserve visible Codex/Claude default ids because they run before configuration; hidden defaults
  // and other unconfigured slots are available to reclaim.
  const hiddenDefaultIds = new Set<string>(settings.hiddenDefaultProviderInstances ?? []);
  const existingIds = new Set([
    ...(!hiddenDefaultIds.has("codex") ? ["codex"] : []),
    ...(!hiddenDefaultIds.has("claudeAgent") ? ["claudeAgent"] : []),
    ...Object.keys(settings.providerInstances ?? {}),
  ]);

  const driverOption = providerClients.get(driver) ?? DEFAULT_DRIVER_OPTION;
  const isAcpRegistry = driver === ACP_REGISTRY_DRIVER_KIND;
  const showRegistrySearch =
    !createdInstanceId &&
    !addingChatGptAccount &&
    wizardStep === 0 &&
    !(isAcpRegistry && isManualAcpConfiguration);
  // Searches while Show more is closed, so the fold opens on results.
  const registry = useAcpRegistrySearch(environmentId, showRegistrySearch);
  const isPreparingRegistryAgent = registry.preparingId !== null;
  const defaultIdentity: ProviderIdentityDraft = {
    label: driverOption.label,
    accentColor: "",
    instanceIdOverride: null,
  };
  const { label, accentColor, instanceIdOverride } = identityByDriver[driver] ?? defaultIdentity;
  const instanceId =
    instanceIdOverride ??
    deriveAvailableInstanceId(
      (candidateLabel) => {
        if (!candidateLabel.trim() || candidateLabel === driverOption.label) {
          return isAcpRegistry ? `${driver}_custom` : driver;
        }
        return deriveInstanceId(driver, candidateLabel);
      },
      label,
      existingIds,
    );
  const driverSettingsFields = deriveProviderSettingsFields(driverOption, undefined, m);
  const instanceIdError = validateInstanceId(instanceId, existingIds, m);
  const showInstanceIdError = hasAttemptedSubmit && instanceIdError !== null;
  const identityStep = 1;
  const previewLabel = label.trim() || gt("{provider} Workspace", { provider: driverOption.label });

  const configDraft = configByDriver[driver] ?? EMPTY_CONFIG_DRAFT;
  const isLocalAcp = isAcpRegistry && isManualAcpConfiguration && configDraft.source === "local";
  const localCommandPath =
    typeof configDraft.commandPath === "string" ? configDraft.commandPath.trim() : "";
  const manualAgentId = typeof configDraft.agentId === "string" ? configDraft.agentId.trim() : "";
  const acpSelectionError = isLocalAcp
    ? localCommandPath.length > 0
      ? null
      : gt("Executable is required.")
    : selectedAcp !== null || (isManualAcpConfiguration && manualAgentId.length > 0)
      ? null
      : gt("Select an ACP or configure one manually.");
  const wizardStepSummaries = isAcpRegistry
    ? ([
        selectedFeaturedPreset === "dsh"
          ? DSH_LOCAL_ACP_PRESET.label
          : isLocalAcp
            ? gt("Local ACP command")
            : (selectedAcp?.name ?? (manualAgentId || null)),
        previewLabel,
        null,
      ] as const)
    : ([driverOption.label, previewLabel, null] as const);
  const setConfigDraft = (config: Record<string, unknown> | undefined) => {
    setConfigByDriver((existing) => {
      const next = { ...existing };
      if (config === undefined || Object.keys(config).length === 0) {
        delete next[driver];
      } else {
        next[driver] = config;
      }
      return next;
    });
  };
  const handleSelectDshLocalAcpPreset = () => {
    const nextInstanceId = deriveAvailableInstanceId(
      () => DSH_LOCAL_ACP_PRESET.instanceId,
      DSH_LOCAL_ACP_PRESET.label,
      existingIds,
    );
    setSelectedFeaturedPreset("dsh");
    setDriver(ACP_REGISTRY_DRIVER_KIND);
    setSelectedAcp(null);
    setIsManualAcpConfiguration(true);
    setConfigByDriver((existing) => ({
      ...existing,
      [ACP_REGISTRY_DRIVER_KIND]: {
        source: "local",
        commandPath: DSH_LOCAL_ACP_PRESET.command,
        commandArgs: [...DSH_LOCAL_ACP_PRESET.args],
        homepageUrl: DSH_LOCAL_ACP_PRESET.homepageUrl,
      },
    }));
    setIdentityByDriver((existing) =>
      updateProviderIdentityDraft(existing, ACP_REGISTRY_DRIVER_KIND, {
        label: DSH_LOCAL_ACP_PRESET.label,
        accentColor: DSH_LOCAL_ACP_PRESET.accentColor,
        instanceIdOverride: nextInstanceId,
      }),
    );
    setLocalEnvironment([]);
    setHasAttemptedSubmit(false);
  };
  const selectDriver = (value: string) => {
    if (value === DSH_FEATURED_PRESET_VALUE) {
      handleSelectDshLocalAcpPreset();
      return;
    }
    setSelectedFeaturedPreset(null);
    setDriver(ProviderDriverKind.make(value));
    setIsManualAcpConfiguration(false);
    setHasAttemptedSubmit(false);
  };
  const setIdentityDraft = (update: Partial<ProviderIdentityDraft>) => {
    setIdentityByDriver((existing) => ({
      ...existing,
      [driver]: { ...(existing[driver] ?? defaultIdentity), ...update },
    }));
  };

  const applyWizardNavigation = (navigation: WizardNavigation) => {
    if (isSaving || isPreparingRegistryAgent || createdInstanceId) return;
    if (navigation.kind === "blocked") {
      setHasAttemptedSubmit(true);
    }
    if (isAcpRegistry && !isLocalAcp && navigation.kind === "navigate" && navigation.step === 2) {
      void handleSave();
      return;
    }
    setWizardStep(navigation.step);
  };

  const navigateToStep = (requestedStep: number) => {
    applyWizardNavigation(
      isAcpRegistry
        ? isLocalAcp
          ? resolveWizardNavigation(wizardStep, requestedStep, LOCAL_ACP_WIZARD_STEPS.length, {
              instanceIdError,
              prerequisite: { step: 0, error: acpSelectionError },
            })
          : resolveAcpRegistryWizardNavigation(wizardStep, requestedStep, {
              instanceIdError,
              selectionError: acpSelectionError,
            })
        : resolveWizardNavigation(wizardStep, requestedStep, ADD_PROVIDER_WIZARD_STEPS.length, {
            instanceIdError,
          }),
    );
  };

  const handleAcpPrepared = (agent: AcpRegistrySearchAgent) => {
    setSelectedFeaturedPreset(null);
    setDriver(ACP_REGISTRY_DRIVER_KIND);
    const nextLabel = agent.name;
    const registryIconUrl = resolveOfficialAcpRegistryIconUrl(agent.icon);
    const nextInstanceId = deriveAvailableInstanceId(
      (candidateLabel) => deriveInstanceId(ACP_REGISTRY_DRIVER_KIND, candidateLabel),
      nextLabel,
      existingIds,
    );
    setSelectedAcp(agent);
    setIsManualAcpConfiguration(false);
    setIdentityByDriver((existing) =>
      updateProviderIdentityDraft(existing, ACP_REGISTRY_DRIVER_KIND, {
        label: nextLabel,
        instanceIdOverride: nextInstanceId,
      }),
    );
    setConfigByDriver((existing) => ({
      ...existing,
      [ACP_REGISTRY_DRIVER_KIND]: {
        agentId: agent.id,
        distribution: "auto",
        ...(registryIconUrl ? { registryIconUrl } : {}),
      },
    }));
    setHasAttemptedSubmit(false);
    setWizardStep(1);
  };

  const handleManualAcpConfiguration = () => {
    setSelectedFeaturedPreset(null);
    setDriver(ACP_REGISTRY_DRIVER_KIND);
    setSelectedAcp(null);
    setIsManualAcpConfiguration(true);
    setConfigByDriver((existing) => {
      const next = { ...existing };
      delete next[ACP_REGISTRY_DRIVER_KIND];
      return next;
    });
    setIdentityByDriver((existing) =>
      updateProviderIdentityDraft(existing, ACP_REGISTRY_DRIVER_KIND, {
        label: "",
        instanceIdOverride: null,
      }),
    );
    setHasAttemptedSubmit(false);
  };

  const handleLocalAcpConfiguration = () => {
    setSelectedFeaturedPreset(null);
    setDriver(ACP_REGISTRY_DRIVER_KIND);
    setSelectedAcp(null);
    setIsManualAcpConfiguration(true);
    setConfigByDriver((existing) => ({
      ...existing,
      [ACP_REGISTRY_DRIVER_KIND]: { source: "local", commandArgs: [] },
    }));
    setIdentityByDriver((existing) =>
      updateProviderIdentityDraft(existing, ACP_REGISTRY_DRIVER_KIND, {
        label: gt("Local ACP"),
        instanceIdOverride: null,
      }),
    );
    setLocalEnvironment([]);
    setHasAttemptedSubmit(false);
  };

  // A policy that owns this driver's launch settings also rules out ChatGPT's own runtime.
  const driverLocks = managedInstanceLocks(managedPolicy, driver, m);

  const handleSave = async () => {
    if (!readEnvironmentScope(environmentId, AuthProvidersManageScope)) return;
    if (isSaving || createdInstanceId) return;
    setHasAttemptedSubmit(true);
    if (instanceIdError !== null || (isAcpRegistry && acpSelectionError !== null)) return;

    const config =
      driver === "codex"
        ? { ...configByDriver[driver], setupMode: "existing" }
        : (configByDriver[driver] ?? {});
    const hasConfig = Object.keys(config).length > 0;
    const normalizedAccentColor = normalizeProviderAccentColor(accentColor);

    const nextInstance: ProviderInstanceConfig = {
      driver,
      enabled: true,
      ...(label.trim().length > 0 ? { displayName: label.trim() } : {}),
      ...(normalizedAccentColor ? { accentColor: normalizedAccentColor } : {}),
      ...(hasConfig ? { config } : {}),
      ...(isLocalAcp && localEnvironment.length > 0 ? { environment: localEnvironment } : {}),
    };
    const brandedId = ProviderInstanceId.make(instanceId);
    setIsSaving(true);
    const result = await persistProviderInstance({
      operation: "create",
      instanceId: brandedId,
      instance: nextInstance,
    });
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      setIsSaving(false);
      toastManager.add({
        type: "error",
        title: gt("Could not add provider instance"),
        description:
          error instanceof Error
            ? (thrownErrorMessage(error, resolveMessage) ?? error.message)
            : gt("The settings update failed."),
      });
      return;
    }
    onCreated?.(brandedId, driver);
    if (isAcpRegistry && !isLocalAcp) {
      setCreatedInstanceId(brandedId);
      setIsSaving(false);
      setWizardStep(2);
      return;
    }
    toastManager.add({
      type: "success",
      title: gt("Provider instance added"),
      description: gt("{provider} instance ''{instanceId}'' was added.", {
        provider: isLocalAcp && label.trim() ? label.trim() : driverOption.label,
        instanceId,
      }),
    });
    onOpenChange(false);
  };

  if (addingChatGptAccount) {
    return (
      <AddManagedCodexAccountDialog
        environmentId={environmentId}
        onClose={() => onOpenChange(false)}
        onAccountCreated={(instanceId) => onCreated?.(instanceId, ProviderDriverKind.make("codex"))}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <WizardPopup size="wide">
        <WizardHeader
          title={gt("Add provider")}
          description={
            <T>
              Add an account or configure a provider on <Var>{environmentLabel}</Var>.
            </T>
          }
        >
          {isAcpRegistry ? (
            <AddProviderInstanceWizardSteps
              currentStep={wizardStep}
              summaries={wizardStepSummaries}
              instanceIdError={instanceIdError}
              steps={isLocalAcp ? LOCAL_ACP_WIZARD_STEPS : ACP_REGISTRY_WIZARD_STEPS}
              disabled={isSaving || isPreparingRegistryAgent || createdInstanceId !== null}
              identityStep={1}
              prerequisite={{ step: 0, error: acpSelectionError }}
              onNavigation={applyWizardNavigation}
            />
          ) : (
            <AddProviderInstanceWizardSteps
              currentStep={wizardStep}
              summaries={wizardStepSummaries}
              instanceIdError={instanceIdError}
              disabled={isSaving || isPreparingRegistryAgent}
              onNavigation={applyWizardNavigation}
            />
          )}
        </WizardHeader>

        {createdInstanceId ? (
          <ProviderWizardAuthenticationStep
            environmentId={environmentId}
            environmentLabel={environmentLabel}
            instanceId={createdInstanceId}
            onFinish={() => onOpenChange(false)}
          />
        ) : (
          <>
            <WizardPanel className={cn(isAcpRegistry && wizardStep === identityStep && "min-h-72")}>
              <div className={cn("grid gap-2", wizardStep !== 0 && "hidden")}>
                <div id="add-instance-driver-label" className="text-sm font-medium text-foreground">
                  {gt("Provider", { $context: "wizard step" })}
                </div>
                <ProviderOptionGrid
                  options={featuredDriverOptions}
                  value={selectedFeaturedPreset === "dsh" ? DSH_FEATURED_PRESET_VALUE : driver}
                  disabled={isPreparingRegistryAgent}
                  onValueChange={selectDriver}
                  liveProvidersByDriver={liveProvidersByDriver}
                  onCopyUpdateCommand={(cmd, providerLabel) =>
                    copyCliUpdateCommand(cmd, { label: providerLabel })
                  }
                  featuredPresetOption={
                    acpRegistryAllowed
                      ? {
                          insertAtIndex: 2,
                          value: DSH_FEATURED_PRESET_VALUE,
                          label: DSH_LOCAL_ACP_PRESET.label,
                          commandBadge: `${DSH_LOCAL_ACP_PRESET.command} ${DSH_LOCAL_ACP_PRESET.args.join(" ")}`,
                          icon: <DshBrandIcon />,
                        }
                      : null
                  }
                  aria-labelledby="add-instance-driver-label"
                />
                {(() => {
                  const selectedLive = liveProvidersByDriver.get(driver);
                  if (!selectedLive || selectedLive.installed) return null;
                  const activeOption = providerClients.definitions.find(
                    (option) => option.driverKind === driver,
                  );
                  const activeLabel = activeOption?.label ?? String(driver);
                  const selectedMeta = resolveAgentCliMeta({
                    driver,
                    displayName: activeLabel,
                  });
                  const selectedHomepage = resolveSafeAgentHomepageUrl({
                    driver,
                    displayName: activeLabel,
                    documentationUrl: selectedLive.setup?.documentationUrl ?? null,
                  });
                  return (
                    <AgentInstallPrompt
                      compact
                      label={activeLabel}
                      homepageUrl={selectedHomepage}
                      loginHint={selectedMeta?.loginHint ?? null}
                    />
                  );
                })()}
                <MultipleAccountsNote environmentId={environmentId} driver={driver} />
              </div>

              {wizardStep === 0 && (moreDriverOptions.length > 0 || acpRegistryAllowed) ? (
                <Collapsible open={showMoreProviders} onOpenChange={setShowMoreProviders}>
                  <div className="flex pt-2">
                    <CollapsibleTrigger render={<Button variant="ghost-muted" size="xs" />}>
                      {showMoreProviders ? gt("Show less") : gt("Show more")}
                      <ChevronDownIcon
                        aria-hidden
                        className={cn("transition-transform", showMoreProviders && "rotate-180")}
                      />
                    </CollapsibleTrigger>
                  </div>
                  {/* WizardPanel already animates its height, so the fold opens without its own. */}
                  <CollapsiblePanel animate={false}>
                    <div className="space-y-4 pt-4">
                      <ProviderOptionGrid
                        options={moreDriverOptions}
                        value={driver}
                        disabled={isPreparingRegistryAgent}
                        onValueChange={selectDriver}
                        liveProvidersByDriver={liveProvidersByDriver}
                        onCopyUpdateCommand={(cmd, providerLabel) =>
                          copyCliUpdateCommand(cmd, { label: providerLabel })
                        }
                        aria-label={gt("More providers")}
                      />
                      {!acpRegistryAllowed ? null : (
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <div aria-hidden className="flex-1 border-t border-border/70" />
                          <span>
                            <T>Or choose from ACP Registry</T>
                          </span>
                          <div aria-hidden className="flex-1 border-t border-border/70" />
                        </div>
                      )}
                      {!acpRegistryAllowed ? null : isAcpRegistry && isManualAcpConfiguration ? (
                        <div className="grid gap-4">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <h3 className="text-sm font-medium text-foreground">
                                {isLocalAcp ? gt("Local ACP command") : gt("Enter manually")}
                              </h3>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {isLocalAcp
                                  ? gt("Run an installed ACP executable on {environment}.", {
                                      environment: environmentLabel,
                                    })
                                  : gt(
                                      "Enter an official registry ID and any local executable or auth override.",
                                    )}
                              </p>
                            </div>
                            <Button
                              onClick={() => {
                                setIsManualAcpConfiguration(false);
                                setHasAttemptedSubmit(false);
                              }}
                              size="xs"
                              variant="ghost"
                            >
                              <T>Search registry</T>
                            </Button>
                          </div>
                          <SettingsGroup variant="plain">
                            <ProviderSettingsForm
                              definition={driverOption}
                              value={configDraft}
                              idPrefix="add-provider-acpRegistry-manual"
                              variant="settings"
                              onChange={setConfigDraft}
                              environmentId={environmentId}
                            />
                            {isLocalAcp ? (
                              <ProviderEnvironmentSection
                                environment={localEnvironment}
                                onChange={setLocalEnvironment}
                                secretSources={secretSources}
                                environmentId={environmentId}
                              />
                            ) : null}
                          </SettingsGroup>
                          {isAcpRegistry && hasAttemptedSubmit && acpSelectionError ? (
                            <p className="text-2xs text-destructive">{acpSelectionError}</p>
                          ) : null}
                        </div>
                      ) : (
                        <>
                          <AcpRegistrySearchStep
                            environmentId={environmentId}
                            registry={registry}
                            providerInstances={settings.providerInstances}
                            onPrepared={handleAcpPrepared}
                            onManualConfiguration={handleManualAcpConfiguration}
                            onLocalConfiguration={handleLocalAcpConfiguration}
                          />
                          {isAcpRegistry && hasAttemptedSubmit && acpSelectionError ? (
                            <p className="mt-2 text-2xs text-destructive">{acpSelectionError}</p>
                          ) : null}
                        </>
                      )}
                    </div>
                  </CollapsiblePanel>
                </Collapsible>
              ) : null}

              {isAcpRegistry && wizardStep === 1 && selectedAcp ? (
                <div className="mb-4 flex items-start justify-between gap-3 border-b border-border/70 pb-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {selectedAcp.name}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      v{selectedAcp.version} · {selectedAcp.distribution}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2 text-2xs">
                    {validateSafeHttpsUrl(selectedAcp.website) ? (
                      <a
                        aria-label={gt("Open documentation for {name} ({id})", {
                          name: selectedAcp.name,
                          id: selectedAcp.id,
                        })}
                        className="text-muted-foreground hover:text-foreground"
                        href={validateSafeHttpsUrl(selectedAcp.website)!}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        <T>Docs</T>
                      </a>
                    ) : null}
                    {validateSafeHttpsUrl(selectedAcp.repository) ? (
                      <a
                        aria-label={gt("Open source for {name} ({id})", {
                          name: selectedAcp.name,
                          id: selectedAcp.id,
                        })}
                        className="text-muted-foreground hover:text-foreground"
                        href={validateSafeHttpsUrl(selectedAcp.repository)!}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {gt("Source", { $context: "link to source code" })}
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <SettingsGroup
                variant="plain"
                className={cn(wizardStep !== identityStep && "hidden")}
              >
                <SettingsRow
                  title={
                    <label htmlFor="add-provider-label">
                      {gt("Label", { $context: "noun, display name" })}
                    </label>
                  }
                  description={
                    <span id="add-provider-label-description">
                      <T>Shown in the provider list.</T>
                    </span>
                  }
                  control={
                    <Input
                      id="add-provider-label"
                      aria-describedby="add-provider-label-description"
                      size="sm"
                      className="w-full @min-[32rem]/settings-row:w-56"
                      placeholder={gt("e.g. Work")}
                      value={label}
                      onChange={(event) => setIdentityDraft({ label: event.target.value })}
                    />
                  }
                />
                <SettingsRow
                  title={
                    <label htmlFor="add-provider-instance-id">
                      <T>Instance ID</T>
                    </label>
                  }
                  description={
                    <span id="add-provider-instance-id-description">
                      <T>Letters, digits, '-', or '_'.</T>
                    </span>
                  }
                  status={
                    showInstanceIdError ? (
                      <span
                        id="add-provider-instance-id-error"
                        role="alert"
                        className="text-destructive"
                      >
                        {instanceIdError}
                      </span>
                    ) : undefined
                  }
                  control={
                    <Input
                      id="add-provider-instance-id"
                      aria-describedby={
                        showInstanceIdError
                          ? "add-provider-instance-id-description add-provider-instance-id-error"
                          : "add-provider-instance-id-description"
                      }
                      size="sm"
                      className="w-full @min-[32rem]/settings-row:w-56"
                      placeholder={`${driver}_work`}
                      value={instanceId}
                      onChange={(event) => {
                        setIdentityDraft({ instanceIdOverride: event.target.value });
                      }}
                      aria-invalid={showInstanceIdError}
                    />
                  }
                />
                <SettingsRow
                  title={gt("Accent color")}
                  description={gt("Optional marker shown in the picker.")}
                  control={
                    <ProviderAccentColorPicker
                      displayName={label || driverOption.label}
                      value={accentColor || undefined}
                      onCommit={(value) => setIdentityDraft({ accentColor: value })}
                      layout="inline"
                    />
                  }
                />
              </SettingsGroup>

              {!isAcpRegistry && driverSettingsFields.length > 0 ? (
                <SettingsGroup variant="plain" className={cn(wizardStep !== 2 && "hidden")}>
                  <ProviderSettingsForm
                    definition={driverOption}
                    value={configDraft}
                    idPrefix={`add-provider-${driver}`}
                    variant="settings"
                    onChange={setConfigDraft}
                    managed={
                      driverLocks && { keys: driverLocks.configKeys, reason: driverLocks.reason }
                    }
                    environmentId={environmentId}
                  />
                </SettingsGroup>
              ) : !isAcpRegistry && wizardStep === 2 ? (
                <div className="grid gap-2">
                  <p className="text-sm text-muted-foreground">
                    <T>This driver has no required configuration. You can add the instance now.</T>
                  </p>
                </div>
              ) : null}
            </WizardPanel>

            <WizardFooter>
              <Button
                variant={wizardStep === 0 ? "ghost-muted" : "outline"}
                size="sm"
                disabled={isSaving || isPreparingRegistryAgent}
                onClick={() => {
                  if (wizardStep === 0) {
                    onOpenChange(false);
                    return;
                  }
                  setWizardStep((step) => Math.max(0, step - 1));
                }}
              >
                {wizardStep === 0 ? gt("Cancel") : gt("Back")}
              </Button>
              {wizardStep === 0 && driver === "codex" ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => navigateToStep(1)}>
                    <T>Configure manually</T>
                  </Button>
                  {driverLocks?.configKeys.has("setupMode") ? null : (
                    <ChatGptConnectionButton
                      size="sm"
                      onClick={() => setAddingChatGptAccount(true)}
                    />
                  )}
                </>
              ) : wizardStep < (isAcpRegistry ? 1 : 2) ? (
                <Button
                  size="sm"
                  disabled={isPreparingRegistryAgent}
                  onClick={() => navigateToStep(wizardStep + 1)}
                >
                  <T>Next</T>
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={isSaving || !canManageProviders}
                  onClick={() => void handleSave()}
                >
                  {isSaving
                    ? gt("Adding...")
                    : isAcpRegistry && !isLocalAcp
                      ? gt("Continue to sign-in")
                      : gt("Add instance")}
                </Button>
              )}
            </WizardFooter>
          </>
        )}
      </WizardPopup>
    </Dialog>
  );
}
