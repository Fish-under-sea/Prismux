import { T, useGT, useLocale, useMessages } from "gt-react";
import { useLegendListRef } from "~/hooks/useLegendListRef";
import {
  ANTIGRAVITY_DEFAULT_MODEL,
  type ProviderInstanceId,
  type EnvironmentId,
  type ProviderDriverKind,
  type ResolvedKeybindingsConfig,
  MODEL_PICKER_JUMP_KEYBINDING_COMMANDS,
} from "@t3tools/contracts";
import { resolveSelectableModel } from "@t3tools/shared/model";
import { useAtomValue } from "@effect/atom-react";
import {
  formatProviderUpdateRequiredNotice,
  providerUpdateChannelLags,
} from "@t3tools/client-runtime/providerUpdateRequiredModels";
import { groupModelsBySubProvider } from "@t3tools/client-runtime/providerSubProviders";
import { useNavigate } from "@tanstack/react-router";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import {
  memo,
  useState,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import {
  AgentBrandLogo,
  resolveProviderEntryDisplayName,
} from "../../prismux/agentBrand";
import {
  formatModelSourceSubtitle,
  partitionAgentScopedModels,
} from "./ProviderModelPicker.logic";
import { ModelListRow } from "./ModelListRow";
import { ModelPickerSidebar } from "./ModelPickerSidebar";
import { useProviderWorkspaceSnapshotRefresh } from "./useProviderWorkspaceSnapshotRefresh";
import { getProviderStatusMessage, hasProviderSetup } from "./ProviderStatusBanner";
import {
  modelPickerLegacySectionKey,
  modelPickerModelKey,
  modelPickerSubProviderSectionKey,
  parseModelPickerLegacySectionKey,
  parseModelPickerModelKey,
} from "./modelPickerKeys";
import { rankModelPickerSearch } from "@t3tools/client-runtime/model-search";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxSearchInput,
  ComboboxItem,
  ComboboxListVirtualized,
} from "../ui/combobox";
import { ModelEsque } from "./providerIconUtils";
import { isCommandPaletteOpen } from "../../commandPaletteBus";
import { registerModelPickerContent } from "../../modelPickerVisibility";
import { primaryServerKeybindingsAtom } from "../../state/server";
import {
  modelPickerJumpCommandForIndex,
  modelPickerJumpIndexFromCommand,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from "../../keybindings";
import {
  useEnvironmentModelPreferences,
  useToggleEnvironmentModelFavorite,
} from "~/hooks/useSettings";
import { announce } from "~/lib/announce";
import { cn } from "~/lib/utils";
import { getVirtualizedScrollFadeClassName } from "../ui/scroll-area";
import { TooltipProvider } from "../ui/tooltip";
import { InlineButton } from "../ui/button";
import { Badge } from "../ui/badge";
import {
  isProviderInstancePickerReady,
  isProviderInstancePickerVisible,
  shouldShowInstanceBadge,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { providerModelKey, sortProviderModelItems } from "../../modelOrdering";
import { hasRuntimeModelCatalog } from "../../providerModels";

type ModelPickerItem = {
  slug: string;
  name: string;
  shortName?: string;
  subProvider?: string;
  badge?: "new";
  instanceId: ProviderInstanceId;
  driverKind: ProviderDriverKind;
  instanceDisplayName: string;
  instanceAccentColor?: string | undefined;
  acpRegistryAgentId?: string | undefined;
  acpRegistryIconUrl?: string | undefined;
  continuationGroupKey?: string | undefined;
  isLegacy?: boolean | undefined;
  isUnavailable?: boolean | undefined;
};

export function resolveModelPickerSelectedModel(input: {
  driverKind: ProviderDriverKind | undefined;
  model: string;
  options: ReadonlyArray<ModelEsque>;
}) {
  if (input.driverKind === "antigravity" && input.model === ANTIGRAVITY_DEFAULT_MODEL) {
    const availableModels = input.options.filter(
      (option) => option.slug !== ANTIGRAVITY_DEFAULT_MODEL && !option.isUnavailable,
    );
    return (
      availableModels.find((option) => option.aliases?.includes(ANTIGRAVITY_DEFAULT_MODEL)) ??
      availableModels.find((option) => option.isDefault)
    );
  }
  return input.options.find((option) => option.slug === input.model);
}

function shouldIncludeModelPickerOption(input: {
  readonly entry: ProviderInstanceEntry;
  readonly option: ModelEsque;
  readonly activeInstanceId: ProviderInstanceId;
  readonly activeModel: string;
}): boolean {
  if (input.entry.driverKind === "antigravity" && input.option.slug === ANTIGRAVITY_DEFAULT_MODEL) {
    return false;
  }
  if (isProviderInstancePickerReady(input.entry)) return true;
  return (
    input.entry.enabled &&
    hasRuntimeModelCatalog(input.entry.driverKind) &&
    input.entry.instanceId === input.activeInstanceId &&
    input.option.slug === input.activeModel &&
    input.option.isUnavailable === true
  );
}

function shouldOfferModelPickerSetup(
  entry: ProviderInstanceEntry,
  options: ReadonlyArray<ModelEsque>,
): boolean {
  return (
    entry.enabled &&
    entry.status !== "disabled" &&
    hasProviderSetup(entry.snapshot) &&
    (!isProviderInstancePickerReady(entry) ||
      !entry.installed ||
      entry.snapshot.auth.status === "unauthenticated" ||
      !options.some((option) => !option.isUnavailable))
  );
}

function adjacentModelPickerProvider(input: {
  entries: ReadonlyArray<ProviderInstanceEntry>;
  selectedInstanceId: ProviderInstanceId | "favorites";
  direction: 1 | -1;
  disabledInstanceIds: ReadonlySet<ProviderInstanceId> | undefined;
  selectableUnavailableInstanceIds: ReadonlySet<ProviderInstanceId> | undefined;
}) {
  const providers: Array<ProviderInstanceId | "favorites"> = [
    "favorites",
    ...input.entries
      .filter(
        (entry) =>
          !input.disabledInstanceIds?.has(entry.instanceId) &&
          (isProviderInstancePickerReady(entry) ||
            input.selectableUnavailableInstanceIds?.has(entry.instanceId)),
      )
      .map((entry) => entry.instanceId),
  ];
  const index = providers.indexOf(input.selectedInstanceId);
  return providers[
    index < 0
      ? input.direction === 1
        ? 0
        : providers.length - 1
      : (index + input.direction + providers.length) % providers.length
  ]!;
}

const EMPTY_MODEL_JUMP_LABELS = new Map<string, string>();
const MODEL_LIST_ESTIMATED_ITEM_SIZE = 32;
// Rendered heights in `--spacing` units. Chrome is the search box and list padding, plus a 1px border.
const ROW_UNITS = 8;
const ROW_SEPARATOR_UNITS = 0.5;
const LIST_CHROME_UNITS = 15.5;

function ModelListSeparator() {
  return <div className="h-0.5" />;
}

function modelJumpLabelsByKey(
  modelKeys: ReadonlyArray<string>,
  keybindings: ResolvedKeybindingsConfig,
  terminalOpen: boolean,
): ReadonlyMap<string, string> {
  const shortcutLabelOptions = {
    platform: navigator.platform,
    context: { terminalFocus: false, terminalOpen, modelPickerOpen: true },
  };
  const mapping = new Map<string, string>();
  for (const [index, modelKey] of modelKeys.entries()) {
    const command = modelPickerJumpCommandForIndex(index);
    const label = command && shortcutLabelForCommand(keybindings, command, shortcutLabelOptions);
    if (label) {
      mapping.set(modelKey, label);
    }
  }
  return mapping.size > 0 ? mapping : EMPTY_MODEL_JUMP_LABELS;
}

function ModelPickerProviderNotices({
  setupEntries,
  updateRequiredNotices,
  emptyLabel,
  onRequestClose,
  onOpenProviderSetup,
}: {
  setupEntries: ReadonlyArray<ProviderInstanceEntry>;
  emptyLabel: string;
  updateRequiredNotices: ReadonlyArray<{
    instanceId: ProviderInstanceId;
    notice: string;
    canUpdateInSettings: boolean;
  }>;
  onRequestClose: (() => void) | undefined;
  onOpenProviderSetup: ((instanceId: ProviderInstanceId) => void) | undefined;
}) {
  const gt = useGT();
  const messages = useMessages();
  const navigate = useNavigate();
  return (
    <>
      {setupEntries.length > 0 ? (
        <div className="max-h-44 shrink-0 overflow-y-auto border-t border-border/70 p-2">
          {setupEntries.map((entry) => (
            <div key={entry.instanceId} className="px-1 py-1.5 text-xs leading-snug">
              <p className="line-clamp-3 text-muted-foreground">
                {getProviderStatusMessage(entry.snapshot, messages)}
              </p>
              <InlineButton
                className="mt-1"
                onClick={() => {
                  onRequestClose?.();
                  onOpenProviderSetup?.(entry.instanceId);
                }}
              >
                {setupEntries.length > 1
                  ? gt("Set up {provider}", { provider: entry.displayName })
                  : gt("Open provider setup")}
              </InlineButton>
            </div>
          ))}
        </div>
      ) : (
        <ComboboxEmpty className="empty:h-0">{emptyLabel}</ComboboxEmpty>
      )}
      {updateRequiredNotices.map(({ instanceId, notice, canUpdateInSettings }) => (
        <p
          key={instanceId}
          className="shrink-0 border-t border-border/70 px-3 py-2 text-xs leading-snug text-muted-foreground"
        >
          {notice}
          {canUpdateInSettings ? (
            <>
              {" "}
              <InlineButton
                onClick={() => {
                  onRequestClose?.();
                  void navigate({ to: "/settings/providers" });
                }}
              >
                <T>Provider settings</T>
              </InlineButton>
            </>
          ) : null}
        </p>
      ))}
    </>
  );
}

function ModelPickerList({
  listRef,
  itemKeys,
  extraData,
  estimatedItemSize = MODEL_LIST_ESTIMATED_ITEM_SIZE,
  agentScoped = false,
  renderItem,
}: {
  listRef: RefObject<LegendListRef | null>;
  itemKeys: ReadonlyArray<string>;
  extraData: unknown;
  estimatedItemSize?: number;
  agentScoped?: boolean;
  renderItem: (props: { item: string; index: number }) => ReactNode;
}) {
  const [showTopScrollFade, setShowTopScrollFade] = useState(false);
  const [showBottomScrollFade, setShowBottomScrollFade] = useState(false);
  const updateScrollFades = () => {
    const metrics = listRef.current?.getState();
    if (!metrics) return;
    setShowTopScrollFade(!metrics.isAtStart);
    setShowBottomScrollFade(!metrics.isAtEnd);
  };
  const scrollRef = useLegendListRef(listRef, updateScrollFades);

  return (
    <div
      className={cn(
        "relative min-h-0 overflow-hidden pr-px",
        itemKeys.length > 0 ? "flex-1" : "h-0",
      )}
    >
      <ComboboxListVirtualized>
        <LegendList<string>
          ref={scrollRef}
          data={itemKeys}
          extraData={extraData}
          keyExtractor={(modelKey) => modelKey}
          renderItem={renderItem}
          estimatedItemSize={estimatedItemSize}
          drawDistance={480}
          recycleItems
          contentContainerClassName={agentScoped ? "px-1.5" : "pl-2 pr-px"}
          ItemSeparatorComponent={ModelListSeparator}
          onLayout={updateScrollFades}
          onScroll={updateScrollFades}
          onReady={updateScrollFades}
          className={cn(
            "scrollbar-gutter-stable h-full overflow-x-hidden overscroll-y-contain py-1.5 [&::-webkit-scrollbar-track]:my-2",
            getVirtualizedScrollFadeClassName({
              top: showTopScrollFade,
              bottom: showBottomScrollFade,
            }),
          )}
        />
      </ComboboxListVirtualized>
    </div>
  );
}

// Capture gives picker shortcuts priority over the composer.
function WindowKeyDownListener({ onKeyDown }: { onKeyDown: (event: KeyboardEvent) => void }) {
  const handleKeyDown = useEffectEvent(onKeyDown);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes a capture-phase window keydown listener for the picker's lifetime
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleKeyDown(event);
    window.addEventListener("keydown", listener, true);
    return () => {
      window.removeEventListener("keydown", listener, true);
    };
  }, []);
  return null;
}

export const ModelPickerContent = memo(function ModelPickerContent(props: {
  environmentId: EnvironmentId | null;
  /** Keeps the open provider tab's catalog fresh for this directory. */
  workspaceCwd?: string | null;
  activeInstanceId: ProviderInstanceId;
  model: string;
  selectedModels?: ReadonlyArray<{ instanceId: ProviderInstanceId; model: string }>;
  onToggleModel?: (instanceId: ProviderInstanceId, model: string) => void;
  lockedProvider: ProviderDriverKind | null;
  lockedContinuationGroupKey?: string | null;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  keybindings?: ResolvedKeybindingsConfig;
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  terminalOpen: boolean;
  onRequestClose?: () => void;
  onOpenProviderSetup?: (instanceId: ProviderInstanceId) => void;
  getModelDisabledReason?: (instanceId: ProviderInstanceId, model: string) => string | null;
  onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void;
  /** The owning popup moves focus here when it opens (its `initialFocus`). */
  searchInputRef: RefObject<HTMLInputElement | null>;
  /** Sits beside an effort column: fills the shared row, and stacks above it on narrow screens. */
  docked?: boolean;
  /** Stacked Orca-style single-column popover with reasoning slider & speed row below. */
  unifiedLayout?: boolean;
  /**
   * Orca-style single-agent scoped focus: opens strictly on the active Agent's models
   * without mixing other vendors, hides the left provider rail, and offers a minimal
   * secondary switcher when multiple agents are unlocked.
   */
  agentScoped?: boolean;
  /** Right at the end of the search text moves into the popup's effort column. */
  onFocusEffort?: () => void;
  /** Closes the list column, inside the popup's fixed height. */
  listFooter?: ReactNode;
}) {
  const gt = useGT();
  const messages = useMessages();
  const locale = useLocale();
  const {
    searchInputRef,
    keybindings: providedKeybindings,
    modelOptionsByInstance,
    instanceEntries,
    getModelDisabledReason,
    onInstanceModelChange,
    onToggleModel,
    onRequestClose,
    onOpenProviderSetup,
  } = props;
  const [searchQuery, setSearchQuery] = useState("");
  const modelListRef = useRef<LegendListRef | null>(null);
  const pickerContentRef = useRef<HTMLDivElement>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes this picker's mount to global keydown handlers
  useLayoutEffect(() => registerModelPickerContent(), []);
  const highlightedModelKeyRef = useRef<string | null>(null);
  const { favorites } = useEnvironmentModelPreferences(props.environmentId);
  const activeEntry = props.instanceEntries.find(
    (entry) => entry.instanceId === props.activeInstanceId,
  );
  const activeModel = resolveModelPickerSelectedModel({
    driverKind: activeEntry?.driverKind,
    model: props.model,
    options: modelOptionsByInstance.get(props.activeInstanceId) ?? [],
  });
  const activeModelSlug =
    activeModel?.slug ?? (props.model === ANTIGRAVITY_DEFAULT_MODEL ? "" : props.model);
  const activeModelKey = activeModelSlug
    ? modelPickerModelKey(props.activeInstanceId, activeModelSlug)
    : null;
  const selectedModelKeys = props.selectedModels?.map((selection) => {
    const entry = instanceEntries.find((entry) => entry.instanceId === selection.instanceId);
    const model = resolveModelPickerSelectedModel({
      driverKind: entry?.driverKind,
      model: selection.model,
      options: modelOptionsByInstance.get(selection.instanceId) ?? [],
    });
    return modelPickerModelKey(selection.instanceId, model?.slug ?? selection.model);
  });
  const selectedModelKeySet = new Set(
    selectedModelKeys ?? (activeModelKey ? [activeModelKey] : []),
  );
  const activeInstanceHasSelectableUnavailableModel =
    activeEntry !== undefined &&
    (modelOptionsByInstance.get(props.activeInstanceId) ?? []).some((option) =>
      shouldIncludeModelPickerOption({
        entry: activeEntry,
        option,
        activeInstanceId: props.activeInstanceId,
        activeModel: activeModelSlug,
      }),
    ) &&
    !isProviderInstancePickerReady(activeEntry);
  const activeInstanceNeedsSetup =
    onOpenProviderSetup !== undefined &&
    activeEntry !== undefined &&
    shouldOfferModelPickerSetup(
      activeEntry,
      modelOptionsByInstance.get(props.activeInstanceId) ?? [],
    );
  const agentScoped = props.agentScoped === true;
  const [agentSwitcherOpen, setAgentSwitcherOpen] = useState(false);
  const [selectedInstanceId, setSelectedInstanceId] = useState<ProviderInstanceId | "favorites">(
    () => {
      if (
        agentScoped ||
        props.lockedProvider !== null ||
        activeInstanceHasSelectableUnavailableModel ||
        activeInstanceNeedsSetup
      ) {
        return props.activeInstanceId;
      }
      const hasPickableFavorite = favorites.some((favorite) => {
        const entry = instanceEntries.find((entry) => entry.instanceId === favorite.provider);
        return (
          entry !== undefined &&
          (modelOptionsByInstance.get(favorite.provider) ?? []).some(
            (option) =>
              option.slug === favorite.model &&
              shouldIncludeModelPickerOption({
                entry,
                option,
                activeInstanceId: props.activeInstanceId,
                activeModel: activeModelSlug,
              }),
          )
        );
      });
      return hasPickableFavorite ? "favorites" : props.activeInstanceId;
    },
  );
  // In agent-scoped mode, never drift into mixed cross-vendor favorites.
  const effectiveSelectedInstanceId: ProviderInstanceId | "favorites" =
    agentScoped && selectedInstanceId === "favorites"
      ? props.activeInstanceId
      : selectedInstanceId;
  const { scanning: workspaceModelsScanning } = useProviderWorkspaceSnapshotRefresh({
    environmentId: props.environmentId,
    gitCwd: props.workspaceCwd ?? null,
    instanceId: effectiveSelectedInstanceId === "favorites" ? undefined : effectiveSelectedInstanceId,
  });
  const favoritesSet = new Set(favorites.map((fav) => providerModelKey(fav.provider, fav.model)));
  const [expandedLegacyInstances, setExpandedLegacyInstances] = useState(
    () =>
      new Set<ProviderInstanceId>(
        activeModel?.isLegacy &&
          !favoritesSet.has(providerModelKey(props.activeInstanceId, activeModelSlug))
          ? [props.activeInstanceId]
          : [],
      ),
  );
  // The thread's backend opens expanded, so its models show without a click.
  const [expandedSubProviderKeys, setExpandedSubProviderKeys] = useState(
    () =>
      new Set<string>(
        activeModel?.subProvider
          ? [modelPickerSubProviderSectionKey(props.activeInstanceId, activeModel.subProvider)]
          : [],
      ),
  );
  const serverKeybindings = useAtomValue(primaryServerKeybindingsAtom);
  const keybindings = providedKeybindings ?? serverKeybindings;
  const [searchHeight, setSearchHeight] = useState(0);
  const toggleFavorite = useToggleEnvironmentModelFavorite(props.environmentId);

  const focusSearchInput = () => {
    searchInputRef.current?.focus({ preventScroll: true });
  };

  const handleSelectInstance = (instanceId: ProviderInstanceId | "favorites") => {
    setSelectedInstanceId(instanceId);
    // Focusing the search on touch raises the on-screen keyboard on every provider tap.
    if (window.matchMedia("(pointer: coarse)").matches) return;
    window.requestAnimationFrame(() => {
      focusSearchInput();
    });
  };

  const toggleLegacySection = (instanceId: ProviderInstanceId) => {
    setExpandedLegacyInstances((expanded) => {
      const next = new Set(expanded);
      if (next.has(instanceId)) {
        next.delete(instanceId);
      } else {
        next.add(instanceId);
      }
      return next;
    });
  };

  const toggleSubProviderSection = (key: string) => {
    setExpandedSubProviderKeys((expanded) => {
      const next = new Set(expanded);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };

  const handleModelSelect = (
    modelSlug: string,
    instanceId: ProviderInstanceId,
    additive = false,
  ): string | null => {
    if (getModelDisabledReason?.(instanceId, modelSlug)) {
      return null;
    }
    const options = modelOptionsByInstance.get(instanceId);
    if (!options) {
      return null;
    }
    const entry = instanceEntries.find((candidate) => candidate.instanceId === instanceId);
    if (!entry) {
      return null;
    }
    const resolvedModel = resolveSelectableModel(entry.driverKind, modelSlug, options);
    if (!resolvedModel) return null;
    if (additive && onToggleModel) {
      onToggleModel(instanceId, resolvedModel);
    } else {
      onInstanceModelChange(instanceId, resolvedModel);
    }
    return resolvedModel;
  };

  const modelJumpShortcutContext = {
    terminalFocus: false,
    terminalOpen: props.terminalOpen,
    modelPickerOpen: true,
  } as const;
  const lockedProvider = props.lockedProvider;
  const lockedContinuationGroupKey = props.lockedContinuationGroupKey;
  const canOpenProviderSetup = onOpenProviderSetup !== undefined;

  const entryByInstanceId = new Map(instanceEntries.map((entry) => [entry.instanceId, entry]));
  const matchesLockedProvider = (
    entry: Pick<ProviderInstanceEntry, "driverKind" | "continuationGroupKey">,
  ): boolean => {
    if (lockedProvider === null) return true;
    if (entry.driverKind !== lockedProvider) return false;
    if (!lockedContinuationGroupKey) return true;
    return entry.continuationGroupKey === lockedContinuationGroupKey;
  };

  const selectableUnavailableInstanceIds = (() => {
    const instanceIds = new Set<ProviderInstanceId>();
    if (activeInstanceHasSelectableUnavailableModel) {
      instanceIds.add(props.activeInstanceId);
    }
    if (canOpenProviderSetup) {
      for (const entry of instanceEntries) {
        if (
          shouldOfferModelPickerSetup(entry, modelOptionsByInstance.get(entry.instanceId) ?? [])
        ) {
          instanceIds.add(entry.instanceId);
        }
      }
    }
    return instanceIds.size > 0 ? instanceIds : undefined;
  })();

  const flatModels = (() => {
    const out: ModelPickerItem[] = [];
    const seenKeys = new Set<string>();
    for (const [instanceId, models] of modelOptionsByInstance) {
      const entry = entryByInstanceId.get(instanceId);
      if (!entry) {
        continue;
      }
      for (const model of models) {
        const key = modelPickerModelKey(instanceId, model.slug);
        if (
          seenKeys.has(key) ||
          !shouldIncludeModelPickerOption({
            entry,
            option: model,
            activeInstanceId: props.activeInstanceId,
            activeModel: activeModelSlug,
          })
        ) {
          continue;
        }
        seenKeys.add(key);
        out.push({
          slug: model.slug,
          name: model.name,
          ...(model.shortName ? { shortName: model.shortName } : {}),
          ...(model.subProvider ? { subProvider: model.subProvider } : {}),
          ...(model.badge ? { badge: model.badge } : {}),
          ...(model.isLegacy ? { isLegacy: true } : {}),
          ...(model.isUnavailable ? { isUnavailable: true } : {}),
          instanceId,
          driverKind: entry.driverKind,
          instanceDisplayName: entry.displayName,
          ...(entry.accentColor ? { instanceAccentColor: entry.accentColor } : {}),
          ...(entry.acpRegistryAgentId ? { acpRegistryAgentId: entry.acpRegistryAgentId } : {}),
          ...(entry.acpRegistryIconUrl ? { acpRegistryIconUrl: entry.acpRegistryIconUrl } : {}),
          ...(entry.continuationGroupKey
            ? { continuationGroupKey: entry.continuationGroupKey }
            : {}),
        });
      }
    }
    return out;
  })();

  const subProvidersByInstance = new Map(
    instanceEntries.flatMap((entry) =>
      entry.snapshot.subProviders?.length
        ? [[entry.instanceId, entry.snapshot.subProviders] as const]
        : [],
    ),
  );
  const isLocked = lockedProvider !== null;
  const isSearching = searchQuery.trim().length > 0;
  // Fit the tallest tab so switching tabs never resizes the popup and moves the rail under the cursor.
  const tallestTabUnits = (() => {
    const unitsByTab = new Map<ProviderInstanceId | "favorites", number>();
    const addRow = (tab: ProviderInstanceId | "favorites") => {
      const previous = unitsByTab.get(tab);
      unitsByTab.set(
        tab,
        previous === undefined ? ROW_UNITS : previous + ROW_SEPARATOR_UNITS + ROW_UNITS,
      );
    };
    const tabsWithLegacyRow = new Set<ProviderInstanceId>();
    for (const model of flatModels) {
      if (!matchesLockedProvider(model)) continue;
      const isFavorite = favoritesSet.has(providerModelKey(model.instanceId, model.slug));
      if (isFavorite) addRow("favorites");
      if (model.isLegacy && !isFavorite) {
        tabsWithLegacyRow.add(model.instanceId);
      } else {
        addRow(model.instanceId);
      }
    }
    for (const instanceId of tabsWithLegacyRow) addRow(instanceId);
    for (const [instanceId, subProviders] of subProvidersByInstance) {
      for (const _subProvider of subProviders) addRow(instanceId);
    }
    return Math.max(0, ...unitsByTab.values());
  })();
  const lockedDisabledInstanceIds = (() => {
    if (!isLocked) {
      return undefined;
    }
    const disabled = new Set<ProviderInstanceId>();
    for (const entry of instanceEntries) {
      if (!matchesLockedProvider(entry)) {
        disabled.add(entry.instanceId);
      }
    }
    return disabled;
  })();
  const sidebarInstanceEntries = (() => {
    const enabledEntries = instanceEntries.filter(isProviderInstancePickerVisible);
    if (!isLocked) {
      return enabledEntries;
    }
    const available: ProviderInstanceEntry[] = [];
    const disabled: ProviderInstanceEntry[] = [];
    for (const entry of enabledEntries) {
      if (matchesLockedProvider(entry)) {
        available.push(entry);
      } else {
        disabled.push(entry);
      }
    }
    return [...available, ...disabled];
  })();
  const showSidebar = !agentScoped && !isSearching && sidebarInstanceEntries.length > 0;
  const instanceOrder = instanceEntries.map((entry) => entry.instanceId);
  const switchableScopedEntries = agentScoped
    ? sidebarInstanceEntries.filter(
        (entry) =>
          !lockedDisabledInstanceIds?.has(entry.instanceId) &&
          (isProviderInstancePickerReady(entry) ||
            selectableUnavailableInstanceIds?.has(entry.instanceId)),
      )
    : [];

  const filteredModels = (() => {
    let result = flatModels;

    if (searchQuery.trim()) {
      const candidates = agentScoped
        ? result.filter((m) => m.instanceId === effectiveSelectedInstanceId)
        : lockedProvider !== null
          ? result.filter((m) => matchesLockedProvider(m))
          : result;
      return rankModelPickerSearch(candidates, searchQuery, (model) => ({
        name: model.name,
        ...(model.shortName ? { shortName: model.shortName } : {}),
        ...(model.subProvider ? { subProvider: model.subProvider } : {}),
        driverKind: model.driverKind,
        providerDisplayName: model.instanceDisplayName,
        isFavorite: favoritesSet.has(providerModelKey(model.instanceId, model.slug)),
      }));
    }

    if (agentScoped) {
      result = result.filter((m) => m.instanceId === effectiveSelectedInstanceId);
    } else if (lockedProvider !== null) {
      result = result.filter((m) => matchesLockedProvider(m));
      if (effectiveSelectedInstanceId === "favorites") {
        result = result.filter((m) => favoritesSet.has(providerModelKey(m.instanceId, m.slug)));
      } else {
        result = result.filter((m) => m.instanceId === effectiveSelectedInstanceId);
      }
    } else if (effectiveSelectedInstanceId === "favorites") {
      result = result.filter((m) => favoritesSet.has(providerModelKey(m.instanceId, m.slug)));
    } else {
      result = result.filter((m) => m.instanceId === effectiveSelectedInstanceId);
    }

    return sortProviderModelItems(result, {
      favoriteModelKeys: favoritesSet,
      groupFavorites: effectiveSelectedInstanceId !== "favorites",
      instanceOrder: effectiveSelectedInstanceId === "favorites" ? instanceOrder : [],
    });
  })();

  const legacySection = (() => {
    if (isSearching || effectiveSelectedInstanceId === "favorites") {
      return null;
    }
    if (agentScoped) {
      const partitioned = partitionAgentScopedModels({
        models: filteredModels,
        activeModelKey,
        favoriteModelKeys: favoritesSet,
        keyOf: (model) => modelPickerModelKey(model.instanceId, model.slug),
      });
      if (partitioned.overflowModels.length === 0) {
        return null;
      }
      return {
        key: modelPickerLegacySectionKey(effectiveSelectedInstanceId),
        currentModels: partitioned.primaryModels,
        legacyModels: partitioned.overflowModels,
        isExpanded: expandedLegacyInstances.has(effectiveSelectedInstanceId),
      };
    }
    const currentModels: ModelPickerItem[] = [];
    const legacyModels: ModelPickerItem[] = [];
    for (const model of filteredModels) {
      const isLegacy =
        model.isLegacy && !favoritesSet.has(providerModelKey(model.instanceId, model.slug));
      (isLegacy ? legacyModels : currentModels).push(model);
    }
    if (legacyModels.length === 0) {
      return null;
    }
    return {
      key: modelPickerLegacySectionKey(effectiveSelectedInstanceId),
      currentModels,
      legacyModels,
      isExpanded: expandedLegacyInstances.has(effectiveSelectedInstanceId),
    };
  })();

  // A provider whose models run on several backends, such as fx, lists each
  // backend as a collapsible heading. Search and Favorites stay flat.
  const subProviderSections = (() => {
    const subProviders =
      isSearching || effectiveSelectedInstanceId === "favorites"
        ? undefined
        : subProvidersByInstance.get(effectiveSelectedInstanceId);
    if (!subProviders || effectiveSelectedInstanceId === "favorites") return null;
    const { ungrouped, groups } = groupModelsBySubProvider(
      filteredModels,
      subProviders,
      (model) => model.subProvider,
    );
    return {
      ungrouped,
      sections: groups.map(({ subProvider, models }) => {
        const key = modelPickerSubProviderSectionKey(effectiveSelectedInstanceId, subProvider.name);
        return {
          key,
          name: subProvider.name,
          unavailableReason: subProvider.unavailableReason,
          models,
          isExpanded: expandedSubProviderKeys.has(key),
        };
      }),
    };
  })();
  const subProviderSectionByKey = new Map(
    subProviderSections?.sections.map((section) => [section.key, section] as const),
  );

  const visibleModels = (() => {
    if (subProviderSections) {
      return [
        ...subProviderSections.ungrouped,
        ...subProviderSections.sections.flatMap((section) =>
          section.isExpanded ? section.models : [],
        ),
      ];
    }
    if (!legacySection) {
      return filteredModels;
    }
    return [
      ...legacySection.currentModels,
      ...(legacySection.isExpanded ? legacySection.legacyModels : []),
    ];
  })();

  const selectedEntry =
    effectiveSelectedInstanceId === "favorites"
      ? undefined
      : entryByInstanceId.get(effectiveSelectedInstanceId);
  const providerSetupEntries =
    !isSearching && canOpenProviderSetup
      ? instanceEntries.filter(
          (entry) =>
            matchesLockedProvider(entry) &&
            shouldOfferModelPickerSetup(
              entry,
              modelOptionsByInstance.get(entry.instanceId) ?? [],
            ) &&
            (selectedEntry
              ? entry.instanceId === selectedEntry.instanceId
              : filteredModels.length === 0),
        )
      : [];

  const updateRequiredNotices = instanceEntries.flatMap((entry) => {
    const shown = isSearching
      ? matchesLockedProvider(entry)
      : entry.instanceId === selectedEntry?.instanceId;
    const notice = shown
      ? formatProviderUpdateRequiredNotice(entry.snapshot, searchQuery, messages, locale)
      : null;
    return notice
      ? [
          {
            instanceId: entry.instanceId,
            notice,
            canUpdateInSettings: !providerUpdateChannelLags(entry.snapshot, searchQuery),
          },
        ]
      : [];
  });

  const modelJumpModelKeys = visibleModels
    .filter((model) => !getModelDisabledReason?.(model.instanceId, model.slug))
    .slice(0, MODEL_PICKER_JUMP_KEYBINDING_COMMANDS.length)
    .map((model) => modelPickerModelKey(model.instanceId, model.slug));
  const allItemKeys = ((): string[] => [
    ...new Set([
      ...flatModels.map((model) => modelPickerModelKey(model.instanceId, model.slug)),
      ...flatModels
        .filter((model) => model.isLegacy)
        .map((model) => modelPickerLegacySectionKey(model.instanceId)),
      ...(legacySection ? [legacySection.key] : []),
      ...[...subProvidersByInstance].flatMap(([instanceId, subProviders]) =>
        subProviders.map((subProvider) =>
          modelPickerSubProviderSectionKey(instanceId, subProvider.name),
        ),
      ),
    ]),
  ])();
  const filteredItemKeys = ((): string[] => {
    const keyOf = (model: ModelPickerItem) => modelPickerModelKey(model.instanceId, model.slug);
    if (subProviderSections) {
      return [
        ...subProviderSections.ungrouped.map(keyOf),
        ...subProviderSections.sections.flatMap((section) => [
          section.key,
          ...(section.isExpanded ? section.models.map(keyOf) : []),
        ]),
      ];
    }
    const modelKeys = visibleModels.map(keyOf);
    // The toggle trails the list, so expanding it reveals older models above it.
    return legacySection ? [...modelKeys, legacySection.key] : modelKeys;
  })();
  const filteredModelByKey = ((): ReadonlyMap<string, ModelPickerItem> =>
    new Map(
      visibleModels.map(
        (model) => [modelPickerModelKey(model.instanceId, model.slug), model] as const,
      ),
    ))();

  const modelJumpLabelByKey = modelJumpLabelsByKey(
    modelJumpModelKeys,
    keybindings,
    props.terminalOpen,
  );
  const badgedInstanceIds = new Set(
    instanceEntries
      .filter((entry) => shouldShowInstanceBadge(entry, instanceEntries))
      .map((entry) => entry.instanceId),
  );
  const modelListExtraData = {
    badgedInstanceIds,
    favoritesSet,
    modelJumpLabelByKey,
    activeModelKey,
    selectedModelKeySet,
  };

  const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.isComposing ||
      event.keyCode === 229 ||
      isCommandPaletteOpen()
    ) {
      return;
    }

    const command = resolveShortcutCommand(event, keybindings, {
      platform: navigator.platform,
      context: modelJumpShortcutContext,
    });
    if (command === "modelPicker.previousProvider" || command === "modelPicker.nextProvider") {
      event.preventDefault();
      event.stopPropagation();
      const next = adjacentModelPickerProvider({
        entries: sidebarInstanceEntries,
        selectedInstanceId,
        direction: command === "modelPicker.nextProvider" ? 1 : -1,
        disabledInstanceIds: lockedDisabledInstanceIds,
        selectableUnavailableInstanceIds,
      });
      setSearchQuery("");
      handleSelectInstance(next);
      announce(
        next === "favorites" ? gt("Favorites") : (entryByInstanceId.get(next)?.displayName ?? next),
        "model-picker",
      );
      return;
    }
    const jumpIndex = modelPickerJumpIndexFromCommand(command ?? "");
    if (jumpIndex === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    const targetModelKey = modelJumpModelKeys[jumpIndex];
    if (!targetModelKey) {
      return;
    }
    const model = parseModelPickerModelKey(targetModelKey);
    if (!model) {
      return;
    }
    const selectedSlug = handleModelSelect(model.slug, model.instanceId);
    if (selectedSlug === null) return;
    const name = flatModels.find(
      (item) => item.slug === selectedSlug && item.instanceId === model.instanceId,
    )?.name;
    announce(gt("Model: {name}", { name: name ?? selectedSlug }), "model-picker");
  };

  return (
    <TooltipProvider delay={0}>
      <WindowKeyDownListener onKeyDown={onWindowKeyDown} />
      <div
        ref={pickerContentRef}
        className={cn(
          "relative flex flex-row overflow-hidden",
          props.unifiedLayout
            ? "h-[min(19.5rem,44vh)] w-full max-w-none"
            : props.docked
              ? "w-screen max-w-90 max-sm:h-56 max-sm:w-full max-sm:max-w-none"
              : agentScoped
                ? "max-h-86.5 w-[min(23.5rem,calc(100vw-1rem))]"
                : "max-h-86.5 w-screen max-w-90",
        )}
        // Docked or unified, the popup sets the height; a minimum here would overflow short windows.
        style={
          props.docked || props.unifiedLayout || agentScoped
            ? undefined
            : isSearching
              ? { height: searchHeight }
              : {
                  minHeight: `min(calc(var(--spacing) * ${tallestTabUnits + LIST_CHROME_UNITS} + 1px), calc(var(--spacing) * 86.5))`,
                }
        }
        data-model-picker-content="true"
        data-model-picker-agent-scoped={agentScoped ? "true" : undefined}
        data-model-picker-scoped-instance={
          agentScoped && effectiveSelectedInstanceId !== "favorites"
            ? effectiveSelectedInstanceId
            : undefined
        }
      >
        {showSidebar && (
          <ModelPickerSidebar
            selectedInstanceId={selectedInstanceId}
            onSelectInstance={handleSelectInstance}
            onFocusSearch={focusSearchInput}
            instanceEntries={sidebarInstanceEntries}
            showFavorites
            {...(selectableUnavailableInstanceIds ? { selectableUnavailableInstanceIds } : {})}
            {...(lockedDisabledInstanceIds
              ? {
                  disabledInstanceIds: lockedDisabledInstanceIds,
                  getDisabledInstanceTooltip: (entry: ProviderInstanceEntry) =>
                    gt(
                      "{provider} is unavailable in this thread. Start a new thread to switch providers.",
                      { provider: entry.displayName },
                    ),
                }
              : {})}
          />
        )}

        <Combobox<string, boolean>
          inline
          items={allItemKeys}
          filteredItems={filteredItemKeys}
          filter={null}
          autoHighlight
          open
          virtualized
          multiple={onToggleModel !== undefined}
          value={onToggleModel ? [...selectedModelKeySet] : activeModelKey}
          onItemHighlighted={(modelKey, eventDetails) => {
            highlightedModelKeyRef.current = typeof modelKey === "string" ? modelKey : null;
            if (eventDetails.reason === "keyboard" && eventDetails.index >= 0) {
              void modelListRef.current?.scrollIndexIntoView?.({
                index: eventDetails.index,
                animated: false,
              });
            }
          }}
          onValueChange={(value, details) => {
            const modelKey = Array.isArray(value)
              ? (value.find((key) => !selectedModelKeySet.has(key)) ??
                [...selectedModelKeySet].find((key) => !value.includes(key)))
              : value;
            if (typeof modelKey !== "string") {
              return;
            }
            const legacyInstanceId = parseModelPickerLegacySectionKey(modelKey);
            if (legacyInstanceId) {
              toggleLegacySection(legacyInstanceId);
              return;
            }
            if (subProviderSectionByKey.has(modelKey)) {
              toggleSubProviderSection(modelKey);
              return;
            }
            const model = parseModelPickerModelKey(modelKey);
            if (model) {
              handleModelSelect(
                model.slug,
                model.instanceId,
                "shiftKey" in details.event && details.event.shiftKey === true,
              );
            }
          }}
        >
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col overflow-hidden",
              agentScoped ? "bg-transparent" : "bg-muted/40",
              showSidebar && "border-l border-border/70",
            )}
          >
            <ComboboxSearchInput
              ref={searchInputRef}
              placeholder={gt("Search models...")}
              value={searchQuery}
              onChange={(e) => {
                if (!isSearching) setSearchHeight(pickerContentRef.current?.offsetHeight ?? 0);
                setSearchQuery(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing || e.keyCode === 229) {
                  (e as typeof e & { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.();
                  e.stopPropagation();
                  return;
                }
                if (
                  showSidebar &&
                  !e.altKey &&
                  !e.ctrlKey &&
                  !e.metaKey &&
                  ((e.key === "ArrowLeft" && !e.shiftKey && searchQuery.length === 0) ||
                    (e.key === "Tab" && e.shiftKey))
                ) {
                  const sidebar = e.currentTarget
                    .closest("[data-model-picker-content]")
                    ?.querySelector("[data-model-picker-sidebar]");
                  const button =
                    sidebar?.querySelector<HTMLButtonElement>(
                      'button[aria-pressed="true"]:not(:disabled)',
                    ) ?? sidebar?.querySelector<HTMLButtonElement>("button:not(:disabled)");
                  if (button) {
                    e.preventDefault();
                    e.stopPropagation();
                    button.focus();
                    return;
                  }
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  onRequestClose?.();
                  return;
                }
                if (
                  props.onFocusEffort &&
                  e.key === "ArrowRight" &&
                  !e.altKey &&
                  !e.ctrlKey &&
                  !e.metaKey &&
                  !e.shiftKey &&
                  e.currentTarget.selectionStart === searchQuery.length
                ) {
                  e.preventDefault();
                  e.stopPropagation();
                  // The column shows the selected model's effort, so a highlighted model is picked
                  // first; the owning popup then moves focus to that model's levels.
                  const highlighted = highlightedModelKeyRef.current
                    ? parseModelPickerModelKey(highlightedModelKeyRef.current)
                    : null;
                  const pickedNew =
                    highlighted !== null &&
                    highlightedModelKeyRef.current !== activeModelKey &&
                    handleModelSelect(highlighted.slug, highlighted.instanceId) !== null;
                  if (!pickedNew) props.onFocusEffort();
                  return;
                }
                if (e.key === "Enter" && highlightedModelKeyRef.current) {
                  (e as typeof e & { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.();
                  e.preventDefault();
                  e.stopPropagation();
                  const legacyInstanceId = parseModelPickerLegacySectionKey(
                    highlightedModelKeyRef.current,
                  );
                  if (legacyInstanceId) {
                    toggleLegacySection(legacyInstanceId);
                    return;
                  }
                  if (subProviderSectionByKey.has(highlightedModelKeyRef.current)) {
                    toggleSubProviderSection(highlightedModelKeyRef.current);
                    return;
                  }
                  const model = parseModelPickerModelKey(highlightedModelKeyRef.current);
                  if (model) {
                    handleModelSelect(model.slug, model.instanceId, e.shiftKey);
                  }
                  return;
                }
                e.stopPropagation();
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            />

            {/* Minimal secondary Agent switcher (only shown when agentScoped and unlocked multi-agent) */}
            {agentScoped && selectedEntry ? (
              <div
                data-model-picker-agent-scope-bar="true"
                className="flex shrink-0 flex-col border-b border-border/55 bg-muted/20 px-2.5 py-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex min-w-0 items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
                    <AgentBrandLogo
                      provider={
                        selectedEntry.driverKind === "acpRegistry"
                          ? selectedEntry.displayName || selectedEntry.instanceId
                          : selectedEntry.driverKind
                      }
                      size={13}
                    />
                    <span className="truncate">
                      {resolveProviderEntryDisplayName(selectedEntry)}
                    </span>
                  </span>
                  {!isLocked && switchableScopedEntries.length > 1 ? (
                    <button
                      type="button"
                      data-model-picker-switch-agent-toggle="true"
                      aria-expanded={agentSwitcherOpen}
                      onClick={() => setAgentSwitcherOpen((open) => !open)}
                      className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.08] hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <span>切换代理</span>
                      <ChevronDownIcon
                        aria-hidden="true"
                        className={cn(
                          "size-3 transition-transform",
                          agentSwitcherOpen && "rotate-180",
                        )}
                      />
                    </button>
                  ) : null}
                </div>
                {agentSwitcherOpen && !isLocked && switchableScopedEntries.length > 1 ? (
                  <div
                    data-model-picker-agent-switcher-list="true"
                    className="mt-1.5 flex flex-wrap gap-1"
                  >
                    {switchableScopedEntries.map((entry) => {
                      const active = entry.instanceId === effectiveSelectedInstanceId;
                      const brandLabel = resolveProviderEntryDisplayName(entry);
                      return (
                        <button
                          key={entry.instanceId}
                          type="button"
                          data-model-picker-agent-chip={entry.instanceId}
                          aria-pressed={active}
                          onClick={() => {
                            handleSelectInstance(entry.instanceId);
                            setAgentSwitcherOpen(false);
                          }}
                          className={cn(
                            "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring",
                            active
                              ? "border-primary/45 bg-primary/12 text-foreground"
                              : "border-border/65 bg-background/55 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
                          )}
                        >
                          <AgentBrandLogo
                            provider={
                              entry.driverKind === "acpRegistry"
                                ? entry.displayName || entry.instanceId
                                : entry.driverKind
                            }
                            size={12}
                          />
                          <span className="truncate">{brandLabel}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}

            <ModelPickerList
              listRef={modelListRef}
              itemKeys={filteredItemKeys}
              extraData={modelListExtraData}
              estimatedItemSize={agentScoped ? 52 : MODEL_LIST_ESTIMATED_ITEM_SIZE}
              agentScoped={agentScoped}
              renderItem={({ item: modelKey, index }) => {
                if (legacySection?.key === modelKey) {
                  return (
                    <ComboboxItem
                      hideIndicator
                      index={index}
                      value={modelKey}
                      aria-expanded={legacySection.isExpanded}
                      data-model-picker-more-models="true"
                      className={cn(
                        "group w-full cursor-pointer",
                        agentScoped && "rounded-lg px-2.5 py-2",
                      )}
                    >
                      <span className="text-xs font-medium leading-snug text-muted-foreground group-hover:text-foreground group-data-highlighted:text-foreground">
                        {legacySection.isExpanded
                          ? gt("Show fewer models")
                          : gt("More models ({count})", {
                              count: legacySection.legacyModels.length,
                            })}
                      </span>
                      <ChevronRightIcon
                        aria-hidden="true"
                        className={cn(
                          "ms-auto size-3.5 shrink-0 text-muted-foreground transition-transform",
                          legacySection.isExpanded && "rotate-90",
                        )}
                      />
                    </ComboboxItem>
                  );
                }
                const subProviderSection = subProviderSectionByKey.get(modelKey);
                if (subProviderSection) {
                  const unavailable = subProviderSection.unavailableReason !== undefined;
                  return (
                    <ComboboxItem
                      hideIndicator
                      index={index}
                      value={modelKey}
                      disabled={unavailable}
                      aria-expanded={unavailable ? undefined : subProviderSection.isExpanded}
                      className="group w-full cursor-pointer"
                    >
                      <div className="min-w-0 flex-1 text-left">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="min-w-0 truncate text-sm font-normal leading-snug">
                            {subProviderSection.name}
                          </div>
                          {unavailable ? (
                            <Badge variant="outline" size="sm">
                              {gt("Unavailable", { $context: "backend cannot be used right now" })}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="mt-1 text-xs font-normal leading-snug text-muted-foreground">
                          {subProviderSection.unavailableReason ??
                            gt("{count, plural, one {{count} model} other {{count} models}}", {
                              count: subProviderSection.models.length,
                            })}
                        </div>
                      </div>
                      {unavailable ? null : (
                        <ChevronRightIcon
                          className={cn(
                            "size-4 shrink-0 transition-transform",
                            subProviderSection.isExpanded && "rotate-90",
                          )}
                        />
                      )}
                    </ComboboxItem>
                  );
                }
                const model = filteredModelByKey.get(modelKey);
                if (!model) {
                  return null;
                }
                const disabledReason =
                  getModelDisabledReason?.(model.instanceId, model.slug) ?? null;
                const modelEntry = entryByInstanceId.get(model.instanceId);
                const sourceSubtitle = agentScoped
                  ? formatModelSourceSubtitle({
                      driverKind: model.driverKind,
                      instanceDisplayName: model.instanceDisplayName,
                      subProvider: model.subProvider,
                      isDefaultInstance: modelEntry?.isDefault,
                    })
                  : undefined;
                return (
                  <ModelListRow
                    key={modelKey}
                    index={index}
                    slug={model.slug}
                    name={model.name}
                    subProvider={model.subProvider}
                    instanceId={model.instanceId}
                    driverKind={model.driverKind}
                    providerDisplayName={model.instanceDisplayName}
                    providerAccentColor={model.instanceAccentColor}
                    acpRegistryAgentId={model.acpRegistryAgentId}
                    acpRegistryIconUrl={model.acpRegistryIconUrl}
                    isFavorite={favoritesSet.has(providerModelKey(model.instanceId, model.slug))}
                    isSelected={
                      selectedModelKeys !== undefined
                        ? selectedModelKeySet.has(modelKey)
                        : modelKey === activeModelKey
                    }
                    favoriteStarOnHover={effectiveSelectedInstanceId === "favorites" && !isSearching}
                    showInstanceBadge={badgedInstanceIds.has(model.instanceId)}
                    showNewBadge={model.badge === "new"}
                    unavailable={model.isUnavailable === true}
                    jumpLabel={modelJumpLabelByKey.get(modelKey) ?? null}
                    disabledReason={disabledReason}
                    agentScoped={agentScoped}
                    sourceSubtitle={sourceSubtitle}
                    onToggleFavorite={toggleFavorite}
                  />
                );
              }}
            />
            <ModelPickerProviderNotices
              setupEntries={providerSetupEntries}
              updateRequiredNotices={updateRequiredNotices}
              emptyLabel={
                effectiveSelectedInstanceId === "favorites" && !isSearching
                  ? gt("No favorites yet")
                  : workspaceModelsScanning
                    ? gt("Searching project models...")
                    : gt("No models found")
              }
              onRequestClose={onRequestClose}
              onOpenProviderSetup={onOpenProviderSetup}
            />
            {props.listFooter}
          </div>
        </Combobox>
      </div>
    </TooltipProvider>
  );
});
