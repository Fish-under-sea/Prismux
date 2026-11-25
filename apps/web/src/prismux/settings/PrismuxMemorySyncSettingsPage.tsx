import { useAtomValue } from "@effect/atom-react";
import {
  PrismuxReasoningEffortSlider,
  formatEffortLabel,
  getEffortPresetForFamily,
  normalizeReasoningEffortOptions,
  resolveReasoningModelTheme,
  type NormalizedReasoningEffortOption,
  type ReasoningEffortOption,
} from "@prismux/appearance";
import {
  isReasoningControl,
  selectableProviderOptionChoices,
} from "@prismux/client-runtime/model-traits";
import {
  ANTIGRAVITY_DEFAULT_MODEL,
  MUSE_DEFAULT_MODEL,
  type ServerProvider,
  type ServerProviderModel,
} from "@prismux/core-contracts";
import type { UnifiedSettings } from "@prismux/core-contracts/settings";
import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  AlertTriangleIcon,
  BotIcon,
  CheckCircle2Icon,
  DatabaseIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SaveIcon,
} from "lucide-react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  SETTINGS_CONTROL_LG,
  SETTINGS_CONTROL_MD,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../../components/settings/settingsLayout";
import {
  SettingsSegmentedTabs,
  type SettingsSegmentedTabItem,
} from "../../components/settings/SettingsSegmentedTabs";
import { usePrimarySettings } from "../../hooks/useSettings";
import { getAppModelOptionsForInstance } from "../../modelSelection";
import {
  brandProviderInstanceEntries,
  deriveProviderInstanceEntries,
  disambiguateProviderInstanceDisplayNames,
} from "../../providerInstances";
import { primaryServerProvidersAtom } from "../../state/server";
import {
  AgentBrandLogo,
  formatAgentBrandName,
  resolveProviderEntryDisplayName,
  toCanonicalChiefProviderId,
} from "../agentBrand";
import { DEFAULT_CHIEF_DISPLAY_NAME, normalizeChiefDisplayName } from "../chiefMention";
import { prismuxDaemonClient, type PrismuxDaemonClient } from "../daemonClient";
import { emitChiefSlotUpdated } from "../PrismuxChiefStatusPill";
import { useOptionalPrismuxRuntime } from "../PrismuxRuntimeProvider";
import {
  ChiefIdentityAndAgentsMdSection,
  type ActiveChiefSlotSnapshot,
} from "./ChiefIdentityAndAgentsMdSection";
import { ObsidianAgentImportCard } from "./ObsidianAgentImportCard";
import { PrismuxMemoryEngineSection } from "./PrismuxMemoryEngineSection";
import { PrismuxSyncEngineSection } from "./PrismuxSyncEngineSection";

type DialModeValue = "agent" | "oracle" | "review";

export type PrismuxMemorySettingsTabId = "chief" | "memory" | "obsidian" | "sync";

export type PrismuxMemorySyncSectionKey =
  | "chiefSlot"
  | "identityAgentsMd"
  | "memory"
  | "obsidian"
  | "sync";

export const CHIEF_DEFAULT_MODEL_SENTINEL = "__chief_provider_default__";
export const CHIEF_DEFAULT_EFFORT_SENTINEL = "__chief_effort_default__";
export const BUILTIN_CHIEF_FALLBACK_PROVIDERS = [
  "codex",
  "claude-code",
  "antigravity",
  "dsh",
] as const;

export interface ChiefModelDropdownOption {
  readonly slug: string;
  readonly label: string;
  readonly subtitle?: string;
  readonly isCustom?: boolean;
  readonly isDefault?: boolean;
  readonly isCompatibilityFallback?: boolean;
  readonly rawModel?: ServerProviderModel;
}

export interface ChiefProviderDropdownOption {
  readonly value: string;
  readonly label: string;
  readonly configured: boolean;
  readonly available: boolean;
  readonly models: readonly ChiefModelDropdownOption[];
}

export interface ResolvedChiefEffortSpec {
  readonly familyId: string;
  readonly familyDisplayName: string;
  readonly stops: readonly NormalizedReasoningEffortOption[];
  readonly source: "model-capabilities" | "model-family-preset";
}

interface ChiefStateView {
  readonly threadId: string;
  readonly provider: string;
  readonly secretaryName: string;
  readonly agentsMdPath: string;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly dialMode: DialModeValue;
  readonly availableProviders: readonly string[];
  readonly t3Connected: boolean;
  readonly updatedAt: number | null;
}

interface ChiefCommittedSummary {
  readonly secretaryName: string;
  readonly agentsMdPath: string;
  readonly provider: string;
  readonly providerLabel: string;
  readonly model: string;
  readonly reasoningEffort: string;
  readonly dialMode: DialModeValue;
  readonly t3Connected: boolean;
}

type MemorySyncDaemonSubset = Pick<
  PrismuxDaemonClient,
  "requestJson" | "switchChief" | "triggerSyncNow" | "testSyncConnection"
>;

export interface PrismuxMemorySyncSettingsPageProps {
  /** Optional overrides for isolated unit testing without full runtime/server providers. */
  readonly serverProvidersOverride?: ReadonlyArray<ServerProvider>;
  readonly settingsOverride?: UnifiedSettings | null;
  readonly daemonOverride?: MemorySyncDaemonSubset;
  readonly daemonReadyOverride?: boolean;
  /** Optional default tab override for deterministic unit testing. */
  readonly initialTabOverride?: PrismuxMemorySettingsTabId;
  /** Optional render probe used by unit tests to verify sibling sections skip re-rendering on Provider/Model switches. */
  readonly onSectionRender?: (section: PrismuxMemorySyncSectionKey) => void;
}

const DIAL_MODES: ReadonlyArray<{
  readonly value: DialModeValue;
  readonly label: string;
  readonly desc: string;
}> = [
  { value: "agent", label: "Agent · 自主执行", desc: "读写工作区、执行命令与自主闭环" },
  { value: "oracle", label: "Oracle · 深度架构", desc: "高推理深度规划、方案研判与代码审计" },
  { value: "review", label: "Review · 只读挑刺", desc: "只读检查 Diff、拦截风险与验收把关" },
];

const MemoizedReasoningEffortSlider = memo(PrismuxReasoningEffortSlider);
const chiefStateCache = new WeakMap<object, ChiefStateView>();

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asDialMode(value: unknown, fallback: DialModeValue = "agent"): DialModeValue {
  return value === "agent" || value === "oracle" || value === "review" ? value : fallback;
}

function isPlaceholderModelSlug(slug: string): boolean {
  const trimmed = slug.trim();
  return (
    trimmed.length === 0 ||
    trimmed === ANTIGRAVITY_DEFAULT_MODEL ||
    trimmed === MUSE_DEFAULT_MODEL
  );
}

function createInitialChiefState(
  runtimeChiefProvider: string,
  runtimeDialMode: DialModeValue,
): ChiefStateView {
  return {
    threadId: "",
    provider: toCanonicalChiefProviderId(runtimeChiefProvider),
    secretaryName: DEFAULT_CHIEF_DISPLAY_NAME,
    agentsMdPath: "~/.prismux/chief/AGENTS.md",
    model: "",
    reasoningEffort: "",
    dialMode: runtimeDialMode,
    availableProviders: [...BUILTIN_CHIEF_FALLBACK_PROVIDERS],
    t3Connected: false,
    updatedAt: null,
  };
}

function sameStringArray(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function sameChiefSummary(a: ChiefCommittedSummary, b: ChiefCommittedSummary): boolean {
  return (
    a.secretaryName === b.secretaryName &&
    a.agentsMdPath === b.agentsMdPath &&
    a.provider === b.provider &&
    a.providerLabel === b.providerLabel &&
    a.model === b.model &&
    a.reasoningEffort === b.reasoningEffort &&
    a.dialMode === b.dialMode &&
    a.t3Connected === b.t3Connected
  );
}

/**
 * Merges live Prismux server providers, custom model catalogs, built-in fallbacks
 * (`codex / claude-code / antigravity / omp`), and Daemon availableProviders into
 * canonical, de-duplicated Provider dropdown options with official brand names.
 */
export function buildChiefProviderOptions(input: {
  readonly serverProviders: ReadonlyArray<ServerProvider>;
  readonly settings?: UnifiedSettings | null;
  readonly daemonAvailableProviders?: readonly string[];
  readonly currentProvider?: string | null;
}): ChiefProviderDropdownOption[] {
  const derivedEntries = deriveProviderInstanceEntries(input.serverProviders);
  const brandedEntries = disambiguateProviderInstanceDisplayNames(
    input.settings ? brandProviderInstanceEntries(derivedEntries, input.settings) : derivedEntries,
  );

  interface ProviderBucket {
    value: string;
    label: string;
    configured: boolean;
    available: boolean;
    models: ChiefModelDropdownOption[];
    seenModelSlugs: Set<string>;
    customNames: Set<string>;
    enabledInstanceCount: number;
  }

  const buckets = new Map<string, ProviderBucket>();

  const ensureBucket = (rawId: string, customDisplayName?: string | null): ProviderBucket => {
    const canonicalId = toCanonicalChiefProviderId(rawId);
    const existing = buckets.get(canonicalId);
    if (existing) {
      return existing;
    }
    const created: ProviderBucket = {
      value: canonicalId,
      label: formatAgentBrandName(canonicalId, customDisplayName),
      configured: false,
      available: false,
      models: [],
      seenModelSlugs: new Set<string>(),
      customNames: new Set<string>(),
      enabledInstanceCount: 0,
    };
    buckets.set(canonicalId, created);
    return created;
  };

  for (const entry of brandedEntries) {
    const canonicalId = toCanonicalChiefProviderId(entry.driverKind);
    const resolvedEntryLabel = resolveProviderEntryDisplayName(entry);
    const defaultBrandLabel = formatAgentBrandName(canonicalId);
    const bucket = ensureBucket(canonicalId);
    if (entry.enabled) {
      bucket.configured = true;
      bucket.enabledInstanceCount += 1;
      if (
        resolvedEntryLabel.length > 0 &&
        resolvedEntryLabel.toLowerCase() !== defaultBrandLabel.toLowerCase()
      ) {
        bucket.customNames.add(resolvedEntryLabel);
      }
    }
    if (entry.enabled && entry.isAvailable) {
      bucket.available = true;
    }
    if (bucket.enabledInstanceCount === 1 && bucket.customNames.size === 1) {
      bucket.label = [...bucket.customNames][0]!;
    } else if (entry.driverKind === "acpRegistry" && bucket.customNames.size === 1) {
      bucket.label = [...bucket.customNames][0]!;
    } else {
      bucket.label = defaultBrandLabel;
    }

    const rawModelsBySlug = new Map<string, ServerProviderModel>();
    for (const rawModel of entry.models) {
      rawModelsBySlug.set(rawModel.slug, rawModel);
    }

    const appOptions = input.settings
      ? getAppModelOptionsForInstance(input.settings, entry, null)
      : entry.models.map((m) => ({
          slug: m.slug,
          name: m.name,
          subProvider: m.subProvider,
          isCustom: m.isCustom,
          isDefault: m.isDefault,
        }));

    for (const opt of appOptions) {
      if (isPlaceholderModelSlug(opt.slug) || bucket.seenModelSlugs.has(opt.slug)) {
        continue;
      }
      bucket.seenModelSlugs.add(opt.slug);
      const rawModel = rawModelsBySlug.get(opt.slug);
      const displayName = opt.name?.trim() || opt.slug;
      const sourceParts: string[] = [];
      if (opt.subProvider && opt.subProvider.trim().length > 0) {
        sourceParts.push(opt.subProvider.trim());
      } else if (!entry.isDefault && entry.displayName.trim().length > 0) {
        sourceParts.push(entry.displayName.trim());
      }
      if (displayName.toLowerCase() !== opt.slug.toLowerCase()) {
        sourceParts.push(opt.slug);
      }
      if (opt.isCustom) {
        sourceParts.push("自定义");
      }
      bucket.models.push({
        slug: opt.slug,
        label: displayName,
        ...(sourceParts.length > 0 ? { subtitle: sourceParts.join(" · ") } : {}),
        ...(opt.isCustom ? { isCustom: true } : {}),
        ...(opt.isDefault ? { isDefault: true } : {}),
        ...(rawModel ? { rawModel } : {}),
      });
    }
  }

  for (const fallbackId of BUILTIN_CHIEF_FALLBACK_PROVIDERS) {
    ensureBucket(fallbackId);
  }

  if (Array.isArray(input.daemonAvailableProviders)) {
    for (const rawId of input.daemonAvailableProviders) {
      if (typeof rawId === "string" && rawId.trim().length > 0) {
        ensureBucket(rawId);
      }
    }
  }

  if (typeof input.currentProvider === "string" && input.currentProvider.trim().length > 0) {
    ensureBucket(input.currentProvider);
  }

  const fallbackOrder = new Map<string, number>(
    BUILTIN_CHIEF_FALLBACK_PROVIDERS.map((id, idx) => [id, idx]),
  );

  return [...buckets.values()]
    .sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      if (a.configured !== b.configured) return a.configured ? -1 : 1;
      const aRank = fallbackOrder.get(a.value) ?? 100;
      const bRank = fallbackOrder.get(b.value) ?? 100;
      if (aRank !== bRank) return aRank - bRank;
      return a.label.localeCompare(b.label);
    })
    .map(({ value, label, configured, available, models }) => ({
      value,
      label,
      configured,
      available,
      models,
    }));
}

/**
 * Builds selectable model options for the active Chief provider.
 * Preserves a legacy/custom compatibility fallback entry if the currently saved model
 * is absent from the auto-fetched provider catalog so saved configs are never lost.
 */
export function buildChiefModelDropdownItems(input: {
  readonly providerOption: ChiefProviderDropdownOption | undefined;
  readonly selectedModel: string;
}): ChiefModelDropdownOption[] {
  const models = input.providerOption?.models ?? [];
  const trimmedSelected = input.selectedModel.trim();
  if (
    trimmedSelected.length > 0 &&
    !models.some((item) => item.slug === trimmedSelected)
  ) {
    return [
      {
        slug: trimmedSelected,
        label: `当前配置：${trimmedSelected}`,
        subtitle: "已保存模型（当前目录未返回，保留防丢值）",
        isCompatibilityFallback: true,
      },
      ...models,
    ];
  }
  return [...models];
}

/**
 * Resolves supported reasoning effort stops for the selected Chief Provider + Model,
 * preferring live Prismux model capabilities and falling back to `@prismux/appearance`'s
 * model-aware family presets (Codex minimal..max, Claude low..ultracode, Gemini off..max, etc.).
 * Effort stop labels always use clear English tier names (Minimal / Low / Medium / High / XHigh / Max / Ultracode).
 */
export function resolveChiefEffortSpec(input: {
  readonly provider: string;
  readonly modelSlug: string;
  readonly modelOption?: ChiefModelDropdownOption | undefined;
}): ResolvedChiefEffortSpec {
  const theme = resolveReasoningModelTheme(
    input.modelSlug.trim() || null,
    input.modelOption?.label ?? null,
    input.provider,
  );
  const descriptors = input.modelOption?.rawModel?.capabilities?.optionDescriptors ?? [];
  const reasoningDescriptor = descriptors.find(
    (descriptor): descriptor is Extract<typeof descriptor, { type: "select" }> =>
      descriptor.type === "select" && isReasoningControl(descriptor),
  );
  if (reasoningDescriptor) {
    const choices = selectableProviderOptionChoices(reasoningDescriptor);
    if (choices.length > 0) {
      const sliderChoices: ReasoningEffortOption[] = choices.map((choice) => {
        const englishLabel = formatEffortLabel(choice.id);
        return {
          value: choice.id,
          label: englishLabel,
          shortLabel: englishLabel,
          ...(choice.description ? { description: choice.description } : {}),
        };
      });
      return {
        familyId: theme.id,
        familyDisplayName: theme.displayName,
        stops: normalizeReasoningEffortOptions(sliderChoices, theme.id, "en"),
        source: "model-capabilities",
      };
    }
  }
  return {
    familyId: theme.id,
    familyDisplayName: theme.displayName,
    stops: getEffortPresetForFamily(theme.id, "en"),
    source: "model-family-preset",
  };
}

/**
 * Reconciles model and reasoning effort when switching Chief Provider:
 * - Resets model to `""` (follow provider default) if the previously selected model
 *   does not belong to the newly chosen provider's model catalog.
 * - Resets reasoning effort to `""` (follow provider default) if the previous effort
 *   is not supported by the new provider + model combination.
 */
export function reconcileChiefSelectionOnProviderChange(input: {
  readonly nextProviderRaw: string;
  readonly providerOptions: readonly ChiefProviderDropdownOption[];
  readonly currentModel: string;
  readonly currentEffort: string;
}): {
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort: string;
} {
  const nextProvider = toCanonicalChiefProviderId(input.nextProviderRaw);
  const nextProviderOpt = input.providerOptions.find((opt) => opt.value === nextProvider);
  const trimmedModel = input.currentModel.trim();
  const nextModelStillValid =
    trimmedModel.length > 0 &&
    Boolean(nextProviderOpt?.models.some((item) => item.slug === trimmedModel));
  const nextModel = nextModelStillValid ? trimmedModel : "";

  const nextModelOpt = nextProviderOpt?.models.find((item) => item.slug === nextModel);
  const nextEffortSpec = resolveChiefEffortSpec({
    provider: nextProvider,
    modelSlug: nextModel,
    modelOption: nextModelOpt,
  });
  const trimmedEffort = input.currentEffort.trim();
  const nextEffortStillValid =
    trimmedEffort.length > 0 &&
    nextEffortSpec.stops.some((stop) => stop.value === trimmedEffort);

  return {
    provider: nextProvider,
    model: nextModel,
    reasoningEffort: nextEffortStillValid ? trimmedEffort : "",
  };
}

interface ChiefSlotControlsSectionProps {
  readonly daemon: Pick<PrismuxDaemonClient, "requestJson" | "switchChief">;
  readonly refreshTick: number;
  readonly runtimeChiefProvider: string;
  readonly runtimeDialMode: DialModeValue;
  readonly serverProvidersOverride?: ReadonlyArray<ServerProvider> | undefined;
  readonly settingsOverride?: UnifiedSettings | null | undefined;
  readonly activeSlotRef: RefObject<ActiveChiefSlotSnapshot>;
  readonly secretaryNameRef: RefObject<string>;
  readonly agentsMdPathRef: RefObject<string>;
  readonly onChiefSummaryChange: (summary: ChiefCommittedSummary) => void;
  readonly onRender?: (() => void) | undefined;
  readonly onError: (message: string | null) => void;
  readonly onStatus: (message: string | null) => void;
}

/**
 * Strictly memo-isolated Chief Provider / Model / Reasoning Effort / Dial controls card.
 * All draft dropdown state stays local to this component so switching Provider or Model
 * NEVER re-renders SettingsPageContainer, AGENTS.md editor, Memory search, Obsidian card,
 * or E2EE Sync forms.
 */
const ChiefSlotControlsSection = memo(function ChiefSlotControlsSection({
  daemon,
  refreshTick,
  runtimeChiefProvider,
  runtimeDialMode,
  serverProvidersOverride,
  settingsOverride,
  activeSlotRef,
  secretaryNameRef,
  agentsMdPathRef,
  onChiefSummaryChange,
  onRender,
  onError,
  onStatus,
}: ChiefSlotControlsSectionProps) {
  onRender?.();

  const liveServerProviders = useAtomValue(primaryServerProvidersAtom);
  const liveSettings = usePrimarySettings();
  const serverProviders = serverProvidersOverride ?? liveServerProviders;
  const unifiedSettings = settingsOverride !== undefined ? settingsOverride : liveSettings;

  const [chief, setChief] = useState<ChiefStateView>(
    () =>
      chiefStateCache.get(daemon as object) ??
      createInitialChiefState(runtimeChiefProvider, runtimeDialMode),
  );
  const [selectedProvider, setSelectedProvider] = useState(() => chief.provider);
  const [selectedModel, setSelectedModel] = useState(() => chief.model);
  const [selectedEffort, setSelectedEffort] = useState(() => chief.reasoningEffort);
  const [selectedDial, setSelectedDial] = useState<DialModeValue>(() => chief.dialMode);
  const [savingChief, setSavingChief] = useState(false);

  const selectedModelRef = useRef(selectedModel);
  selectedModelRef.current = selectedModel;
  const selectedEffortRef = useRef(selectedEffort);
  selectedEffortRef.current = selectedEffort;
  const selectedDialRef = useRef(selectedDial);
  selectedDialRef.current = selectedDial;

  // Base catalog excludes selectedProvider so switching between known providers hits cache in O(1)
  // without recomputing deriveProviderInstanceEntries / brandProviderInstanceEntries / model lists.
  const baseProviderOptions = useMemo(
    () =>
      buildChiefProviderOptions({
        serverProviders,
        settings: unifiedSettings,
        daemonAvailableProviders: chief.availableProviders,
      }),
    [chief.availableProviders, serverProviders, unifiedSettings],
  );

  const providerOptions = useMemo(() => {
    const canonicalSelected = toCanonicalChiefProviderId(selectedProvider);
    if (baseProviderOptions.some((opt) => opt.value === canonicalSelected)) {
      return baseProviderOptions;
    }
    return buildChiefProviderOptions({
      serverProviders,
      settings: unifiedSettings,
      daemonAvailableProviders: chief.availableProviders,
      currentProvider: selectedProvider,
    });
  }, [baseProviderOptions, chief.availableProviders, selectedProvider, serverProviders, unifiedSettings]);

  const activeProviderOption = useMemo(
    () => providerOptions.find((opt) => opt.value === selectedProvider) ?? providerOptions[0],
    [providerOptions, selectedProvider],
  );

  const activeProviderLabel =
    activeProviderOption?.label ?? formatAgentBrandName(selectedProvider);

  // Keep shared draft snapshot ref synced without triggering parent re-renders.
  activeSlotRef.current = {
    provider: selectedProvider,
    providerLabel: activeProviderLabel,
    model: selectedModel,
    reasoningEffort: selectedEffort,
    dialMode: selectedDial,
  };

  const modelDropdownItems = useMemo(
    () =>
      buildChiefModelDropdownItems({
        providerOption: activeProviderOption,
        selectedModel,
      }),
    [activeProviderOption, selectedModel],
  );

  const activeModelOption = useMemo(
    () => modelDropdownItems.find((item) => item.slug === selectedModel.trim()),
    [modelDropdownItems, selectedModel],
  );

  const effortSpec = useMemo(
    () =>
      resolveChiefEffortSpec({
        provider: selectedProvider,
        modelSlug: selectedModel,
        modelOption: activeModelOption,
      }),
    [activeModelOption, selectedModel, selectedProvider],
  );

  // Cache rendered <SelectItem> trees so opening dropdowns or switching unrelated fields
  // avoids recreating every option node & SVG logo on each render.
  const providerSelectItems = useMemo(
    () =>
      providerOptions.map((opt) => (
        <SelectItem key={opt.value} value={opt.value}>
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-2">
              <AgentBrandLogo
                provider={opt.value}
                size={14}
                iconClassName="size-3.5 opacity-100 text-current"
              />
              <span className="truncate font-medium">{opt.label}</span>
            </span>
            {opt.configured ? (
              <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                已配置
              </span>
            ) : null}
          </div>
        </SelectItem>
      )),
    [providerOptions],
  );

  const modelSelectItems = useMemo(
    () =>
      modelDropdownItems.map((item) => (
        <SelectItem key={item.slug} value={item.slug}>
          <div className="flex flex-col">
            <span className="truncate font-medium">{item.label}</span>
            {item.subtitle ? (
              <span className="truncate font-mono text-[10.5px] text-muted-foreground">
                {item.subtitle}
              </span>
            ) : null}
          </div>
        </SelectItem>
      )),
    [modelDropdownItems],
  );

  const loadChiefState = useCallback(async () => {
    try {
      const chiefRes = await daemon.requestJson<unknown>("/v1/chief");
      const root = asRecord(chiefRes);
      const slot = asRecord(root?.slot);
      const rawProvider =
        asString(slot?.activeProvider) ||
        asString(slot?.provider) ||
        runtimeChiefProvider ||
        "codex";
      const provider = toCanonicalChiefProviderId(rawProvider);
      const secretaryName = normalizeChiefDisplayName(
        asString(root?.secretaryName) || asString(slot?.secretaryName),
      );
      const agentsMdPath =
        asString(root?.agentsMdPath) ||
        asString(slot?.agentsMdPath) ||
        "~/.prismux/chief/AGENTS.md";
      const model = asString(slot?.model);
      const reasoningEffort =
        asString(slot?.reasoningEffort) || asString(slot?.defaultEffort);
      const mode = asDialMode(root?.dialMode, runtimeDialMode);
      const providers = Array.isArray(root?.availableProviders)
        ? root.availableProviders.filter((p): p is string => typeof p === "string")
        : [...BUILTIN_CHIEF_FALLBACK_PROVIDERS];
      const nextAvailableProviders =
        providers.length > 0 ? providers : [...BUILTIN_CHIEF_FALLBACK_PROVIDERS];
      const nextChief: ChiefStateView = {
        threadId: asString(slot?.threadId),
        provider,
        secretaryName,
        agentsMdPath,
        model,
        reasoningEffort,
        dialMode: mode,
        availableProviders: nextAvailableProviders,
        t3Connected: asBoolean(root?.t3Connected, false),
        updatedAt: typeof slot?.updatedAt === "number" ? slot.updatedAt : null,
      };
      chiefStateCache.set(daemon as object, nextChief);

      startTransition(() => {
        setChief((prev) => ({
          ...nextChief,
          availableProviders: sameStringArray(prev.availableProviders, nextAvailableProviders)
            ? prev.availableProviders
            : nextAvailableProviders,
        }));
        setSelectedProvider(provider);
        setSelectedModel(model);
        setSelectedEffort(reasoningEffort);
        setSelectedDial(mode);
        onChiefSummaryChange({
          secretaryName,
          agentsMdPath,
          provider,
          providerLabel: formatAgentBrandName(provider),
          model,
          reasoningEffort,
          dialMode: mode,
          t3Connected: nextChief.t3Connected,
        });
      });

      emitChiefSlotUpdated({
        provider,
        model: model || null,
        reasoningEffort: reasoningEffort || null,
        dialMode: mode,
        secretaryName,
        agentsMdPath,
      });
    } catch (err) {
      onError(`主秘书状态：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [daemon, onChiefSummaryChange, onError, runtimeChiefProvider, runtimeDialMode]);

  useEffect(() => {
    void loadChiefState();
  }, [loadChiefState, refreshTick]);

  const handleProviderChange = useCallback(
    (nextRaw: string | null) => {
      if (!nextRaw) return;
      const reconciled = reconcileChiefSelectionOnProviderChange({
        nextProviderRaw: nextRaw,
        providerOptions,
        currentModel: selectedModelRef.current,
        currentEffort: selectedEffortRef.current,
      });
      const nextOpt = providerOptions.find((opt) => opt.value === reconciled.provider);
      activeSlotRef.current = {
        provider: reconciled.provider,
        providerLabel: nextOpt?.label ?? formatAgentBrandName(reconciled.provider),
        model: reconciled.model,
        reasoningEffort: reconciled.reasoningEffort,
        dialMode: selectedDialRef.current,
      };
      setSelectedProvider(reconciled.provider);
      setSelectedModel(reconciled.model);
      setSelectedEffort(reconciled.reasoningEffort);
    },
    [activeSlotRef, providerOptions],
  );

  const handleModelChange = useCallback(
    (nextRaw: string | null) => {
      if (!nextRaw) return;
      const nextModel = nextRaw === CHIEF_DEFAULT_MODEL_SENTINEL ? "" : nextRaw;
      const nextModelOpt = activeProviderOption?.models.find((item) => item.slug === nextModel);
      const nextEffortSpec = resolveChiefEffortSpec({
        provider: selectedProvider,
        modelSlug: nextModel,
        modelOption: nextModelOpt,
      });
      const currentEffort = selectedEffortRef.current.trim();
      const nextEffort =
        currentEffort.length > 0 && !nextEffortSpec.stops.some((stop) => stop.value === currentEffort)
          ? ""
          : selectedEffortRef.current;

      activeSlotRef.current = {
        ...activeSlotRef.current,
        model: nextModel,
        reasoningEffort: nextEffort,
      };
      setSelectedModel(nextModel);
      if (nextEffort !== selectedEffortRef.current) {
        setSelectedEffort(nextEffort);
      }
    },
    [activeProviderOption, activeSlotRef, selectedProvider],
  );

  const handleSliderEffortChange = useCallback(
    (nextValue: string) => {
      activeSlotRef.current = {
        ...activeSlotRef.current,
        reasoningEffort: nextValue,
      };
      setSelectedEffort(nextValue);
    },
    [activeSlotRef],
  );

  const handleResetEffort = useCallback(() => {
    activeSlotRef.current = {
      ...activeSlotRef.current,
      reasoningEffort: "",
    };
    setSelectedEffort("");
  }, [activeSlotRef]);

  const handleSaveChief = useCallback(async () => {
    setSavingChief(true);
    onError(null);
    onStatus(null);
    try {
      const normalizedProvider = toCanonicalChiefProviderId(selectedProvider);
      const trimmedModel = selectedModel.trim();
      const trimmedEffort = selectedEffort.trim();
      const currentSecretaryName = secretaryNameRef.current;
      const currentAgentsMdPath = agentsMdPathRef.current;
      await daemon.switchChief({
        provider: normalizedProvider,
        ...(trimmedModel.length > 0 ? { model: trimmedModel } : {}),
        dialMode: selectedDial,
        reasoningEffort: trimmedEffort,
        defaultEffort: trimmedEffort,
      });
      emitChiefSlotUpdated({
        provider: normalizedProvider,
        model: trimmedModel || null,
        reasoningEffort: trimmedEffort || null,
        dialMode: selectedDial,
        secretaryName: currentSecretaryName,
        agentsMdPath: currentAgentsMdPath,
      });
      const brandLabel = formatAgentBrandName(normalizedProvider);
      const modelSummary = trimmedModel.length > 0 ? ` · 模型：${trimmedModel}` : "";
      const effortSummary =
        trimmedEffort.length > 0
          ? ` · 思考强度：${formatEffortLabel(trimmedEffort)}`
          : " · 思考强度：跟随默认";
      onStatus(
        `主秘书「${currentSecretaryName}」底层引擎已切换为 ${brandLabel}${modelSummary}${effortSummary}（档位：${selectedDial}；独立 AGENTS.md 与称呼已完整保留）。`,
      );
      startTransition(() => {
        onChiefSummaryChange({
          secretaryName: currentSecretaryName,
          agentsMdPath: currentAgentsMdPath,
          provider: normalizedProvider,
          providerLabel: brandLabel,
          model: trimmedModel,
          reasoningEffort: trimmedEffort,
          dialMode: selectedDial,
          t3Connected: chief.t3Connected,
        });
      });
      await loadChiefState();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingChief(false);
    }
  }, [
    agentsMdPathRef,
    chief.t3Connected,
    daemon,
    loadChiefState,
    onChiefSummaryChange,
    onError,
    onStatus,
    secretaryNameRef,
    selectedDial,
    selectedEffort,
    selectedModel,
    selectedProvider,
  ]);

  const trimmedSelectedModel = selectedModel.trim();
  const trimmedSelectedEffort = selectedEffort.trim();

  return (
    <>
      <SettingsRow
        title="主秘书引擎"
        description="选择负责主秘书对话的代理引擎，热切换保留当前上下文。"
        control={
          <div className={`${SETTINGS_CONTROL_MD} max-w-full`}>
            <Select modal={false} value={selectedProvider} onValueChange={handleProviderChange}>
              <SelectTrigger size="sm" data-pmx-chief-provider-select="">
                <SelectValue>
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <AgentBrandLogo
                      provider={selectedProvider}
                      size={14}
                      iconClassName="size-3.5 opacity-100 text-current"
                    />
                    <span className="truncate font-medium">{activeProviderLabel}</span>
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false}>{providerSelectItems}</SelectPopup>
            </Select>
          </div>
        }
      />

      <SettingsRow
        title="默认模型"
        description={
          activeProviderOption && activeProviderOption.models.length > 0
            ? `已同步 ${activeProviderOption.label} 的 ${activeProviderOption.models.length} 个可用模型，留空则跟随引擎默认。`
            : "留空则跟随所选引擎的默认模型。"
        }
        control={
          <div className={`${SETTINGS_CONTROL_LG} max-w-full`}>
            <Select
              modal={false}
              value={trimmedSelectedModel.length > 0 ? trimmedSelectedModel : CHIEF_DEFAULT_MODEL_SENTINEL}
              onValueChange={handleModelChange}
            >
              <SelectTrigger size="sm" data-pmx-chief-model-select="">
                <SelectValue>
                  <span className="truncate">
                    {trimmedSelectedModel.length === 0
                      ? "跟随该提供方默认模型（留空）"
                      : (activeModelOption?.label ?? `当前配置：${trimmedSelectedModel}`)}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectPopup alignItemWithTrigger={false} className="max-h-72">
                <SelectItem value={CHIEF_DEFAULT_MODEL_SENTINEL}>
                  <div className="flex flex-col">
                    <span className="font-medium">跟随该提供方默认模型（留空）</span>
                    <span className="text-[11px] text-muted-foreground">
                      使用 {activeProviderLabel} 当前默认模型
                    </span>
                  </div>
                </SelectItem>
                {modelSelectItems}
              </SelectPopup>
            </Select>
          </div>
        }
      />

      <SettingsRow
        title="思考强度"
        description="拖动或点选档位调整主秘书的默认推理深度。"
        control={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge variant={trimmedSelectedEffort.length > 0 ? "info" : "outline"} size="sm">
              {trimmedSelectedEffort.length === 0
                ? "跟随提供方默认"
                : formatEffortLabel(trimmedSelectedEffort)}
            </Badge>
            {trimmedSelectedEffort.length > 0 ? (
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={handleResetEffort}
                title="恢复跟随提供方默认思考强度"
              >
                <RotateCcwIcon className="size-3" />
                跟随默认
              </Button>
            ) : null}
          </div>
        }
      >
        <div className="mt-2.5 space-y-1.5 pb-2" data-pmx-chief-effort-slider="">
          <MemoizedReasoningEffortSlider
            modelId={trimmedSelectedModel || null}
            modelName={activeModelOption?.label ?? null}
            provider={selectedProvider}
            options={effortSpec.stops}
            value={trimmedSelectedEffort || undefined}
            locale="zh"
            label={
              trimmedSelectedEffort.length > 0
                ? `${effortSpec.familyDisplayName} · 已指定 ${formatEffortLabel(trimmedSelectedEffort)}`
                : `${effortSpec.familyDisplayName} · 跟随默认（点击档位可覆盖）`
            }
            showStops
            showRunner
            compact
            onChange={handleSliderEffortChange}
          />
        </div>
      </SettingsRow>

      <SettingsRow
        title="工作模式"
        description="切换主秘书的执行权限与分析深度。"
      >
        <div className="mt-2.5 space-y-3 pb-2">
          <div className="grid gap-2 sm:grid-cols-3">
            {DIAL_MODES.map((item) => {
              const active = selectedDial === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => {
                    activeSlotRef.current = {
                      ...activeSlotRef.current,
                      dialMode: item.value,
                    };
                    setSelectedDial(item.value);
                  }}
                  className={
                    active
                      ? "rounded-lg border border-primary bg-primary/10 px-3 py-2.5 text-left transition-colors"
                      : "rounded-lg border border-border/60 bg-foreground/[0.025] px-3 py-2.5 text-left transition-colors hover:bg-accent/60 dark:bg-white/[0.03]"
                  }
                >
                  <div className="text-xs font-semibold text-foreground">{item.label}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{item.desc}</div>
                </button>
              );
            })}
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={savingChief}
              onClick={() => {
                void handleSaveChief();
              }}
            >
              <SaveIcon className="size-3.5" />
              {savingChief ? "应用中…" : "应用主秘书配置"}
            </Button>
          </div>
        </div>
      </SettingsRow>
    </>
  );
});

interface PrismuxMemorySyncSettingsPageShellProps {
  readonly mode?: "all" | "memory";
  readonly daemon: MemorySyncDaemonSubset;
  readonly daemonReady: boolean;
  readonly runtimeChiefProvider: string;
  readonly runtimeDialMode: DialModeValue;
  readonly serverProvidersOverride?: ReadonlyArray<ServerProvider> | undefined;
  readonly settingsOverride?: UnifiedSettings | null | undefined;
  readonly initialTabOverride?: PrismuxMemorySettingsTabId | undefined;
  readonly onSectionRender?: ((section: PrismuxMemorySyncSectionKey) => void) | undefined;
}

const PrismuxMemorySyncSettingsPageShell = memo(function PrismuxMemorySyncSettingsPageShell({
  mode = "all",
  daemon,
  daemonReady,
  runtimeChiefProvider,
  runtimeDialMode,
  serverProvidersOverride,
  settingsOverride,
  initialTabOverride,
  onSectionRender,
}: PrismuxMemorySyncSettingsPageShellProps) {
  const showSyncSection = mode === "all";
  const cachedChief = chiefStateCache.get(daemon as object);
  const initialProvider = toCanonicalChiefProviderId(cachedChief?.provider ?? runtimeChiefProvider);

  const [refreshTick, setRefreshTick] = useState(0);
  const [memoryRefreshTick, setMemoryRefreshTick] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [chiefSummary, setChiefSummary] = useState<ChiefCommittedSummary>(() => ({
    secretaryName: cachedChief?.secretaryName ?? DEFAULT_CHIEF_DISPLAY_NAME,
    agentsMdPath: cachedChief?.agentsMdPath ?? "~/.prismux/chief/AGENTS.md",
    provider: initialProvider,
    providerLabel: formatAgentBrandName(initialProvider),
    model: cachedChief?.model ?? "",
    reasoningEffort: cachedChief?.reasoningEffort ?? "",
    dialMode: cachedChief?.dialMode ?? runtimeDialMode,
    t3Connected: cachedChief?.t3Connected ?? false,
  }));

  const activeSlotRef = useRef<ActiveChiefSlotSnapshot>({
    provider: chiefSummary.provider,
    providerLabel: chiefSummary.providerLabel,
    model: chiefSummary.model,
    reasoningEffort: chiefSummary.reasoningEffort,
    dialMode: chiefSummary.dialMode,
  });
  const secretaryNameRef = useRef(chiefSummary.secretaryName);
  secretaryNameRef.current = chiefSummary.secretaryName;
  const agentsMdPathRef = useRef(chiefSummary.agentsMdPath);
  agentsMdPathRef.current = chiefSummary.agentsMdPath;
  const onSectionRenderRef = useRef(onSectionRender);
  onSectionRenderRef.current = onSectionRender;

  const handleChiefSlotRender = useCallback(() => {
    onSectionRenderRef.current?.("chiefSlot");
  }, []);
  const handleIdentityRender = useCallback(() => {
    onSectionRenderRef.current?.("identityAgentsMd");
  }, []);
  const handleMemoryRender = useCallback(() => {
    onSectionRenderRef.current?.("memory");
  }, []);
  const handleObsidianRender = useCallback(() => {
    onSectionRenderRef.current?.("obsidian");
  }, []);
  const handleSyncRender = useCallback(() => {
    onSectionRenderRef.current?.("sync");
  }, []);

  const handleChiefSummaryChange = useCallback((next: ChiefCommittedSummary) => {
    setChiefSummary((prev) => (sameChiefSummary(prev, next) ? prev : next));
  }, []);

  const handleIdentityUpdated = useCallback(
    ({
      secretaryName,
      agentsMdPath,
    }: {
      readonly secretaryName: string;
      readonly agentsMdPath: string;
    }) => {
      setChiefSummary((prev) =>
        prev.secretaryName === secretaryName && prev.agentsMdPath === agentsMdPath
          ? prev
          : { ...prev, secretaryName, agentsMdPath },
      );
    },
    [],
  );

  const handleError = useCallback((msg: string | null) => {
    setErrorMsg(msg);
  }, []);

  const handleStatus = useCallback((msg: string | null) => {
    setStatusMsg(msg);
  }, []);

  const handleMemoryDataChanged = useCallback(() => {
    startTransition(() => {
      setMemoryRefreshTick((prev) => prev + 1);
    });
  }, []);

  const handleRefreshAll = useCallback(() => {
    setErrorMsg(null);
    startTransition(() => {
      setRefreshTick((prev) => prev + 1);
    });
  }, []);

  const tabs: SettingsSegmentedTabItem[] = [
    {
      id: "chief",
      label: "主秘书与人设",
      hashAnchors: [
        "prismux-memory",
        "prismux-memory-sync",
        "prismux-chief-slot",
        "chief-identity",
        "chief-agents-md",
      ],
      content: (
        <SettingsSection id="prismux-chief-slot" title="主秘书引擎与人设">
          <ChiefSlotControlsSection
            daemon={daemon}
            refreshTick={refreshTick}
            runtimeChiefProvider={runtimeChiefProvider}
            runtimeDialMode={runtimeDialMode}
            serverProvidersOverride={serverProvidersOverride}
            settingsOverride={settingsOverride}
            activeSlotRef={activeSlotRef}
            secretaryNameRef={secretaryNameRef}
            agentsMdPathRef={agentsMdPathRef}
            onChiefSummaryChange={handleChiefSummaryChange}
            onRender={handleChiefSlotRender}
            onError={handleError}
            onStatus={handleStatus}
          />

          <ChiefIdentityAndAgentsMdSection
            daemon={daemon}
            secretaryName={chiefSummary.secretaryName}
            agentsMdPath={chiefSummary.agentsMdPath}
            activeProvider={chiefSummary.provider}
            activeProviderLabel={chiefSummary.providerLabel}
            activeModel={chiefSummary.model}
            activeEffort={chiefSummary.reasoningEffort}
            activeDialMode={chiefSummary.dialMode}
            activeSlotRef={activeSlotRef}
            onRender={handleIdentityRender}
            onIdentityUpdated={handleIdentityUpdated}
            onError={handleError}
            onStatus={handleStatus}
          />
        </SettingsSection>
      ),
    },
    {
      id: "memory",
      label: "混合记忆库",
      hashAnchors: ["prismux-memory-engine", "memory-search"],
      content: (
        <PrismuxMemoryEngineSection
          daemon={daemon}
          refreshTick={refreshTick + memoryRefreshTick}
          secretaryName={chiefSummary.secretaryName}
          activeProvider={chiefSummary.provider}
          activeProviderLabel={chiefSummary.providerLabel}
          activeModel={chiefSummary.model}
          activeSlotRef={activeSlotRef}
          includeObsidian={false}
          onRender={handleMemoryRender}
          onObsidianRender={handleObsidianRender}
          onError={handleError}
          onStatus={handleStatus}
        />
      ),
    },
    {
      id: "obsidian",
      label: "Obsidian 迁移",
      hashAnchors: ["prismux-obsidian-import", "obsidian-import"],
      content: (
        <SettingsSection id="prismux-obsidian-import" title="Obsidian 笔记迁移">
          <ObsidianAgentImportCard
            daemon={daemon}
            secretaryName={chiefSummary.secretaryName}
            activeProvider={chiefSummary.provider}
            activeProviderLabel={chiefSummary.providerLabel}
            activeModel={chiefSummary.model}
            activeSlotRef={activeSlotRef}
            onRender={handleObsidianRender}
            onCommitted={handleMemoryDataChanged}
            onError={handleError}
            onStatus={handleStatus}
          />
        </SettingsSection>
      ),
    },
    ...(showSyncSection
      ? [
          {
            id: "sync",
            label: "加密同步",
            hashAnchors: ["prismux-e2ee-sync", "prismux-sync"],
            content: (
              <PrismuxSyncEngineSection
                daemon={daemon}
                daemonReady={daemonReady}
                refreshTick={refreshTick}
                onRender={handleSyncRender}
                onSynced={handleMemoryDataChanged}
                onError={handleError}
                onStatus={handleStatus}
              />
            ),
          } satisfies SettingsSegmentedTabItem,
        ]
      : []),
  ];

  return (
    <SettingsPageContainer width="readable">
      <div
        id={showSyncSection ? "prismux-memory-sync" : "prismux-memory"}
        data-pmx-memory-settings-page={showSyncSection ? undefined : ""}
        className="flex flex-wrap items-center justify-between gap-3 px-1"
      >
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <DatabaseIcon className="size-4 text-primary" />
            <h1 className="text-base font-semibold tracking-tight text-foreground">
              秘书与记忆
            </h1>
            <Badge variant={daemonReady ? "success" : "warning"} size="sm">
              {daemonReady ? "服务在线" : "服务未连接"}
            </Badge>
            <Badge variant={chiefSummary.t3Connected ? "info" : "outline"} size="sm" className="gap-1">
              <BotIcon className="size-3" />
              {chiefSummary.t3Connected ? "已桥接" : "本地模式"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            管理主秘书默认引擎与人设、检索本地长期记忆或导入 Obsidian 笔记。
          </p>
        </div>
      </div>

      {errorMsg ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive"
        >
          <AlertTriangleIcon className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 break-all">{errorMsg}</span>
        </div>
      ) : null}

      {statusMsg ? (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-lg border border-success/35 bg-success/10 px-3.5 py-2.5 text-xs text-success-foreground"
        >
          <CheckCircle2Icon className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{statusMsg}</span>
        </div>
      ) : null}

      <SettingsSegmentedTabs
        tabs={tabs}
        defaultTabId={initialTabOverride ?? "chief"}
        ariaLabel="秘书与记忆分区"
        trailingAction={
          <Button type="button" size="xs" variant="outline" onClick={handleRefreshAll}>
            <RefreshCwIcon className="size-3.5" />
            刷新状态
          </Button>
        }
      />
    </SettingsPageContainer>
  );
});

/**
 * Dedicated `/settings/memory` control center ("秘书与记忆"), organized into 3 segmented tabs:
 * 1. `chief` (主秘书与人设)
 * 2. `memory` (混合记忆库)
 * 3. `obsidian` (Obsidian 迁移)
 */
export function PrismuxMemorySettingsPage({
  serverProvidersOverride,
  settingsOverride,
  daemonOverride,
  daemonReadyOverride,
  initialTabOverride,
  onSectionRender,
}: PrismuxMemorySyncSettingsPageProps = {}) {
  const runtime = useOptionalPrismuxRuntime();
  const daemon = daemonOverride ?? runtime?.daemon ?? prismuxDaemonClient;
  const daemonReady = daemonReadyOverride ?? runtime?.daemonInfo.ready ?? false;
  const runtimeChiefProvider = runtime?.chiefProvider ?? "codex";
  const runtimeDialMode = runtime?.dialMode ?? "agent";

  return (
    <PrismuxMemorySyncSettingsPageShell
      mode="memory"
      daemon={daemon}
      daemonReady={daemonReady}
      runtimeChiefProvider={runtimeChiefProvider}
      runtimeDialMode={runtimeDialMode}
      serverProvidersOverride={serverProvidersOverride}
      settingsOverride={settingsOverride}
      initialTabOverride={initialTabOverride}
      onSectionRender={onSectionRender}
    />
  );
}

/**
 * Legacy combined view (kept exported for compatibility & render-isolation regression tests).
 * Live routes now split into `/settings/memory` (`PrismuxMemorySettingsPage`) and
 * `/settings/sync` (`PrismuxSyncSettingsPage`), with `/settings/memory-sync` redirecting automatically.
 */
export function PrismuxMemorySyncSettingsPage({
  serverProvidersOverride,
  settingsOverride,
  daemonOverride,
  daemonReadyOverride,
  initialTabOverride,
  onSectionRender,
}: PrismuxMemorySyncSettingsPageProps = {}) {
  const runtime = useOptionalPrismuxRuntime();
  const daemon = daemonOverride ?? runtime?.daemon ?? prismuxDaemonClient;
  const daemonReady = daemonReadyOverride ?? runtime?.daemonInfo.ready ?? false;
  const runtimeChiefProvider = runtime?.chiefProvider ?? "codex";
  const runtimeDialMode = runtime?.dialMode ?? "agent";

  return (
    <PrismuxMemorySyncSettingsPageShell
      mode="all"
      daemon={daemon}
      daemonReady={daemonReady}
      runtimeChiefProvider={runtimeChiefProvider}
      runtimeDialMode={runtimeDialMode}
      serverProvidersOverride={serverProvidersOverride}
      settingsOverride={settingsOverride}
      initialTabOverride={initialTabOverride}
      onSectionRender={onSectionRender}
    />
  );
}
