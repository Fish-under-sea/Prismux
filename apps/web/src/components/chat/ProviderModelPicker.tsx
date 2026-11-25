import {
  ANTIGRAVITY_DEFAULT_MODEL,
  type ProviderInstanceId,
  type EnvironmentId,
  type ProviderDriverKind,
  type ResolvedKeybindingsConfig,
} from "@prismux/core-contracts";
import { formatModelSlugName } from "@prismux/core-shared/model";
import { RegistryContext } from "@effect/atom-react";
import { T, useGT } from "gt-react";
import { ChevronDownIcon } from "lucide-react";
import {
  createContext,
  memo,
  type ReactNode,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { Badge } from "../ui/badge";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { ModelPickerContent, resolveModelPickerSelectedModel } from "./ModelPickerContent";
import {
  retainedModelWhileProviderLocked,
  shouldScopeModelPickerToActiveAgent,
} from "./ProviderModelPicker.logic";
import { ChatGptSharingControl } from "./ChatGptSharingControl";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { ModelEsque, getDisplayModelName, getTriggerDisplayModelName } from "./providerIconUtils";
import { shouldShowInstanceBadge, type ProviderInstanceEntry } from "../../providerInstances";
import { ComposerControl, type ComposerControlSize } from "./ComposerControl";
import { takeOpenTarget, useComposerMenuProps } from "./composerEventScope";
import { shortcutLabelForCommand } from "../../keybindings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

/** Holds the page still behind the open picker; its lifetime is the popup element's. */
function lockBackgroundScroll(popup: HTMLElement | null) {
  if (!popup) return;
  const { documentElement, body } = document;
  const previousDocumentOverscrollBehavior = documentElement.style.overscrollBehavior;
  const previousBodyOverflow = body.style.overflow;
  const previousBodyPaddingRight = body.style.paddingRight;
  const scrollbarWidth = window.innerWidth - documentElement.clientWidth;

  documentElement.style.overscrollBehavior = "contain";
  body.style.overflow = "hidden";
  if (scrollbarWidth > 0) {
    body.style.paddingRight = `${scrollbarWidth}px`;
  }

  const shouldAllowOverlayScroll = (target: EventTarget | null) => {
    return (
      target instanceof Element &&
      target.closest(
        "[data-model-picker-content], [data-model-picker-effort], [data-model-picker-option-menu]",
      )
    );
  };
  const preventBackgroundWheel = (event: WheelEvent) => {
    if (shouldAllowOverlayScroll(event.target)) {
      return;
    }
    event.preventDefault();
  };
  const preventBackgroundTouchMove = (event: TouchEvent) => {
    if (shouldAllowOverlayScroll(event.target)) {
      return;
    }
    event.preventDefault();
  };

  document.addEventListener("wheel", preventBackgroundWheel, { capture: true, passive: false });
  document.addEventListener("touchmove", preventBackgroundTouchMove, {
    capture: true,
    passive: false,
  });

  return () => {
    document.removeEventListener("wheel", preventBackgroundWheel, { capture: true });
    document.removeEventListener("touchmove", preventBackgroundTouchMove, { capture: true });
    documentElement.style.overscrollBehavior = previousDocumentOverscrollBehavior;
    body.style.overflow = previousBodyOverflow;
    body.style.paddingRight = previousBodyPaddingRight;
  };
}

/** What a docked effort column needs from its picker: the model it serves. */
export const DockedPickerContext = createContext<{ modelLabel: string }>({ modelLabel: "" });

/**
 * Candidate composer card containers whose start edge the composer-owned model picker aligns to.
 * Prioritizes the AGY inner composer card so the popup's left edge forms a crisp vertical line
 * flush with the input card below it rather than drifting left over the sidebar.
 */
export const COMPOSER_PICKER_ANCHOR_CARD_SELECTORS = [
  '[data-pmx-composer-inner-card="1"]',
  '[data-chat-composer-surface="true"]',
  '[data-pmx-composer-layout="agy"]',
] as const;

export function resolveModelPickerPopupAlign(input: {
  readonly isComposerOwned?: boolean | undefined;
  readonly hasUnifiedFooter?: boolean | undefined;
  readonly popupAlign?: "start" | "end" | undefined;
}): "start" | "end" {
  // Composer model pickers sit in the bottom-left toolbar beside the attach button; always anchor
  // to "start" so the popup opens rightward flush with the composer card instead of crossing the sidebar.
  if (input.isComposerOwned || input.hasUnifiedFooter) {
    return "start";
  }
  return input.popupAlign ?? "start";
}

export function findComposerPickerAnchorCard(
  trigger: Pick<Element, "closest"> | null | undefined,
): HTMLElement | null {
  if (!trigger) return null;
  for (const selector of COMPOSER_PICKER_ANCHOR_CARD_SELECTORS) {
    const card = trigger.closest<HTMLElement>(selector);
    if (card) return card;
  }
  return null;
}

export function computeComposerPickerAlignOffset(input: {
  readonly triggerRect: Pick<DOMRectReadOnly, "left" | "right" | "width">;
  readonly cardRect: Pick<DOMRectReadOnly, "left" | "right" | "width">;
  readonly align: "start" | "center" | "end";
  readonly side?: "top" | "bottom" | "left" | "right" | "inline-start" | "inline-end";
  readonly isRtl?: boolean;
}): number {
  if (input.align !== "start") return 0;
  if (input.side && input.side !== "top" && input.side !== "bottom") return 0;
  if (
    !Number.isFinite(input.triggerRect.left) ||
    !Number.isFinite(input.cardRect.left) ||
    input.triggerRect.width <= 0 ||
    input.cardRect.width <= 0
  ) {
    return 0;
  }
  const rawOffset = input.isRtl
    ? input.triggerRect.right - input.cardRect.right
    : input.cardRect.left - input.triggerRect.left;
  if (!Number.isFinite(rawOffset) || Math.abs(rawOffset) < 0.01) {
    return 0;
  }
  // Never shift inward past the trigger's own start edge if an atypical wrapper sits right of it.
  return rawOffset > 0 ? 0 : rawOffset;
}

export const ProviderModelPicker = memo(function ProviderModelPicker(props: {
  environmentId: EnvironmentId | null;
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
  activeProviderIconClassName?: string;
  instanceIndicatorBackground?: string;
  size?: ComposerControlSize;
  compact?: boolean;
  isComposerOwned?: boolean;
  disabled?: boolean;
  terminalOpen?: boolean;
  open?: boolean;
  popupAlign?: "start" | "end";
  triggerClassName?: string;
  triggerLabel?: string;
  triggerAriaLabel?: string;
  onOpenChange?: (open: boolean) => void;
  onOpenProviderSetup?: (instanceId: ProviderInstanceId) => void;
  getModelDisabledReason?: (instanceId: ProviderInstanceId, model: string) => string | null;
  onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void;
  /** Shown after the model name inside the same trigger, such as the effort level. */
  triggerSuffix?: ReactNode;
  /** Names the suffix for the tooltip and screen readers. */
  triggerDetail?: string | null;
  /** Composer shortcuts this trigger answers besides the picker's own. */
  triggerShortcuts?: string;
  /**
   * Docks an effort column beside the list and a footer under both. The popup then stays open
   * until Escape or an outside press, and picking a model moves focus to its levels.
   */
  effortColumn?: ReactNode;
  footer?: ReactNode;
  /**
   * Orca-style stacked unified footer rendered below the model list (holds model-aware
   * reasoning effort slider + segmented pills + Codex/Claude Fast Mode speed row).
   */
  unifiedFooter?: ReactNode;
  /**
   * Explicitly toggle Orca single-agent scoped focus. Defaults to `true` when `unifiedFooter`
   * is present (Chat Composer) and `false` for multi-provider pickers in settings.
   */
  scopeToActiveAgent?: boolean;
}) {
  const composerFloatingLayerProps = useComposerMenuProps();
  const [uncontrolledIsMenuOpen, setUncontrolledIsMenuOpen] = useState(false);
  const isMenuOpen = props.open ?? uncontrolledIsMenuOpen;
  const registry = useContext(RegistryContext);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const refreshModelCatalog = useEffectEvent(() => {
    const environmentId = props.environmentId;
    if (environmentId === null) return;
    // An older server drops the field and probes every provider.
    const config = registry.get(serverEnvironment.configValueAtom(environmentId));
    if (config?.environment.capabilities.modelCatalogRefresh !== true) return;
    void refreshProviders({ environmentId, input: { modelCatalogOnly: true } });
  });
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- asks the server for newly released models on every open; a parent, a keybinding or the palette can open the picker, so no one handler sees them all
  useEffect(() => {
    if (isMenuOpen) refreshModelCatalog();
  }, [isMenuOpen]);
  const gt = useGT();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  // Touch opens on the popup itself so the on-screen keyboard stays down until the search is tapped.
  const isCoarsePointer = useMediaQuery({ pointer: "coarse" });
  const size = props.size ?? "sm";
  const hasUnifiedFooter = props.unifiedFooter !== undefined;
  const docked = props.effortColumn !== undefined || hasUnifiedFooter;
  const effectivePopupAlign = resolveModelPickerPopupAlign({
    isComposerOwned: props.isComposerOwned,
    hasUnifiedFooter,
    popupAlign: props.popupAlign,
  });
  const alignPopupToComposerCard = Boolean(props.isComposerOwned || hasUnifiedFooter);

  const activeEntry =
    props.instanceEntries.find((entry) => entry.instanceId === props.activeInstanceId) ?? null;
  const isAgentScoped = shouldScopeModelPickerToActiveAgent({
    scopeToActiveAgent: props.scopeToActiveAgent,
    hasUnifiedFooter,
    hasActiveEntry: activeEntry !== null,
  });

  const activeInstanceId = props.activeInstanceId;
  const selectedInstanceOptions = props.modelOptionsByInstance.get(activeInstanceId) ?? [];
  const selectedModel =
    resolveModelPickerSelectedModel({
      driverKind: activeEntry?.driverKind,
      model: props.model,
      options: selectedInstanceOptions,
    }) ??
    retainedModelWhileProviderLocked(activeEntry, props.model) ??
    (activeEntry?.driverKind === "opencode" || activeEntry?.driverKind === "antigravity"
      ? undefined
      : selectedInstanceOptions[0]);
  const triggerTitle = selectedModel
    ? getTriggerDisplayModelName(selectedModel, activeEntry?.driverKind)
    : props.model === ANTIGRAVITY_DEFAULT_MODEL
      ? gt("Choose model")
      : formatModelSlugName(props.model) || props.model || gt("Choose model");
  const withUnavailable = (model: string, isUnavailable: boolean | undefined) =>
    isUnavailable ? gt("{model} (Unavailable)", { model }) : model;
  const triggerLabel = selectedModel
    ? withUnavailable(getDisplayModelName(selectedModel), selectedModel.isUnavailable)
    : triggerTitle;
  const showInstanceBadge =
    activeEntry !== null && shouldShowInstanceBadge(activeEntry, props.instanceEntries);

  const setIsMenuOpen = (open: boolean) => {
    props.onOpenChange?.(open);
    if (props.open === undefined) {
      setUncontrolledIsMenuOpen(open);
    }
  };

  /**
   * Focuses the selected reasoning level, else the first level. With `rows: "any"` it falls back
   * to the column's first enabled option. False when nothing took focus.
   */
  const focusEffort = (rows: "levels" | "any") => {
    const column = popupRef.current?.querySelector("[data-model-picker-effort]");
    const level =
      column?.querySelector<HTMLElement>(
        '[data-effort-level][aria-checked="true"]:not(:disabled)',
      ) ??
      column?.querySelector<HTMLElement>("[data-effort-level]:not(:disabled)") ??
      column?.querySelector<HTMLElement>('[role="slider"]:not([aria-disabled="true"])') ??
      column?.querySelector<HTMLElement>('input[type="range"]:not(:disabled)');
    // No aria-checked here: an On switch is checked but is not where focus belongs.
    const row =
      level ??
      (rows === "any"
        ? column?.querySelector<HTMLElement>("[data-effort-row]:not(:disabled)")
        : null);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "nearest" });
    return row != null;
  };
  const openTarget = (target: "effort" | "permissions") => {
    if (target === "effort") {
      focusEffort("any");
      return;
    }
    popupRef.current
      ?.querySelector<HTMLButtonElement>("[data-composer-permissions-trigger]")
      ?.click();
  };

  const handleInstanceModelChange = (instanceId: ProviderInstanceId, model: string) => {
    if (props.disabled) return;
    props.onInstanceModelChange(instanceId, model);
    if (!docked) {
      setIsMenuOpen(false);
      return;
    }
    // The column renders the new model's levels on commit.
    window.requestAnimationFrame(() => focusEffort("levels"));
  };

  const shortcutLabel = props.keybindings
    ? shortcutLabelForCommand(props.keybindings, "modelPicker.toggle")
    : null;
  const selectedEntries = props.selectedModels?.map((selection) => {
    const entry = props.instanceEntries.find(
      (candidate) => candidate.instanceId === selection.instanceId,
    );
    const model = resolveModelPickerSelectedModel({
      driverKind: entry?.driverKind,
      model: selection.model,
      options: props.modelOptionsByInstance.get(selection.instanceId) ?? [],
    });
    return {
      ...selection,
      entry,
      label: model
        ? withUnavailable(getTriggerDisplayModelName(model, entry?.driverKind), model.isUnavailable)
        : formatModelSlugName(selection.model) || selection.model,
      fullLabel: model
        ? withUnavailable(getDisplayModelName(model), model.isUnavailable)
        : formatModelSlugName(selection.model) || selection.model,
    };
  });
  const multipleLabel = selectedEntries
    ? selectedEntries.length === 0
      ? gt("Choose models")
      : selectedEntries.length > 2
        ? gt("{count, plural, one {{models}, {count} more} other {{models}, {count} more}}", {
            models: selectedEntries
              .slice(0, 2)
              .map((selection) => selection.label)
              .join(", "),
            count: selectedEntries.length - 2,
          })
        : selectedEntries.map((selection) => selection.label).join(", ")
    : undefined;
  const allModelNames = selectedEntries
    ? selectedEntries.map((selection) => selection.fullLabel).join(", ") || gt("Choose models")
    : undefined;
  const triggerTooltipContent = [
    props.triggerLabel ?? allModelNames ?? triggerLabel,
    props.triggerDetail,
    shortcutLabel,
  ]
    .filter(Boolean)
    .join(" · ");

  const triggerText = props.triggerLabel ?? multipleLabel ?? triggerTitle;
  const triggerTextProps = {
    className: cn(
      "min-w-0 flex-1 overflow-hidden truncate",
      // Long names such as "Fusion (Claude Opus 5.5 Medium + SWE-2 High)" would push the composer.
      props.isComposerOwned && "max-w-56",
    ),
    "data-chat-provider-model-picker-label": "true",
  } as const;

  const picker = (
    <ModelPickerContent
      searchInputRef={searchInputRef}
      environmentId={props.environmentId}
      workspaceCwd={props.workspaceCwd ?? null}
      activeInstanceId={activeInstanceId}
      model={props.model}
      {...(props.selectedModels !== undefined ? { selectedModels: props.selectedModels } : {})}
      {...(props.onToggleModel
        ? {
            onToggleModel: (instanceId: ProviderInstanceId, model: string) => {
              if (!props.disabled) props.onToggleModel?.(instanceId, model);
            },
          }
        : {})}
      lockedProvider={props.lockedProvider}
      lockedContinuationGroupKey={props.lockedContinuationGroupKey ?? null}
      instanceEntries={props.instanceEntries}
      {...(props.keybindings ? { keybindings: props.keybindings } : {})}
      modelOptionsByInstance={props.modelOptionsByInstance}
      terminalOpen={props.terminalOpen ?? false}
      onRequestClose={() => setIsMenuOpen(false)}
      {...(props.onOpenProviderSetup ? { onOpenProviderSetup: props.onOpenProviderSetup } : {})}
      getModelDisabledReason={(instanceId, model) =>
        props.disabled
          ? gt("Model picker is disabled")
          : (props.getModelDisabledReason?.(instanceId, model) ?? null)
      }
      onInstanceModelChange={handleInstanceModelChange}
      {...(isAgentScoped ? { agentScoped: true } : {})}
      {...(docked
        ? {
            docked,
            ...(hasUnifiedFooter ? { unifiedLayout: true } : {}),
            onFocusEffort: () => void focusEffort("any"),
            // Inside the fixed height, so switching to or from a ChatGPT plan never resizes it.
            ...(props.selectedModels === undefined
              ? { listFooter: <ChatGptSharingControl provider={activeEntry?.snapshot ?? null} /> }
              : {}),
          }
        : {})}
    />
  );

  return (
    <Popover
      open={isMenuOpen}
      onOpenChange={(open) => {
        if (props.disabled) {
          setIsMenuOpen(false);
          return;
        }
        setIsMenuOpen(open);
      }}
      onOpenChangeComplete={(open) => {
        const target = takeOpenTarget(triggerRef.current);
        if (open && docked && target) openTarget(target);
      }}
    >
      <PopoverTrigger
        render={
          <ComposerControl
            ref={triggerRef}
            aria-label={[
              props.triggerAriaLabel ?? props.triggerLabel ?? allModelNames ?? triggerLabel,
              props.triggerDetail,
            ]
              .filter(Boolean)
              .join(", ")}
            size={size}
            data-chat-provider-model-picker="true"
            data-composer-shortcut={props.triggerShortcuts}
            onClick={(event) => {
              if (!isMenuOpen || !docked) return;
              const target = takeOpenTarget(triggerRef.current);
              if (!target) return;
              // A shortcut aimed at the open picker moves within it instead of closing it.
              (
                event as typeof event & { preventBaseUIHandler?: () => void }
              ).preventBaseUIHandler?.();
              openTarget(target);
            }}
            className={cn(
              "min-w-0 shrink justify-between whitespace-nowrap",
              props.compact
                ? "max-w-42 shrink-0"
                : !props.isComposerOwned && "max-w-48 sm:max-w-56",
              props.triggerClassName,
            )}
            disabled={props.disabled}
          />
        }
      >
        <span
          className={cn("flex min-w-0 flex-1 items-center", size === "xs" ? "gap-1" : "gap-1.5")}
        >
          {selectedEntries && props.triggerLabel === undefined ? (
            <span
              data-chat-provider-model-picker-icon
              className="flex shrink-0 items-center -space-x-1"
              aria-hidden="true"
            >
              {selectedEntries
                .slice(0, 3)
                .map((selection) =>
                  selection.entry ? (
                    <ProviderInstanceIcon
                      key={`${selection.instanceId}:${selection.model}`}
                      driverKind={selection.entry.driverKind}
                      displayName={selection.entry.displayName}
                      instanceId={selection.entry.instanceId}
                      accentColor={selection.entry.accentColor}
                      acpRegistryAgentId={selection.entry.acpRegistryAgentId}
                      acpRegistryIconUrl={selection.entry.acpRegistryIconUrl}
                      className="size-4 rounded-full bg-(--chat-composer-glass-surface,var(--background)) ring-2 ring-(--chat-composer-glass-surface,var(--background))"
                      iconClassName="size-4"
                    />
                  ) : null,
                )}
              {selectedEntries.length > 3 ? (
                <span className="relative z-30 flex size-4 items-center justify-center rounded-full bg-(--chat-composer-glass-surface,var(--background)) text-3xs ring-2 ring-(--chat-composer-glass-surface,var(--background))">
                  +{selectedEntries.length - 3}
                </span>
              ) : null}
            </span>
          ) : activeEntry && props.triggerLabel === undefined ? (
            // Narrow compacted composers hide the provider icon before truncating the name.
            <span data-chat-provider-model-picker-icon className="contents">
              <ProviderInstanceIcon
                driverKind={activeEntry.driverKind}
                displayName={activeEntry.displayName}
                instanceId={activeEntry.instanceId}
                accentColor={activeEntry.accentColor}
                acpRegistryAgentId={activeEntry.acpRegistryAgentId}
                acpRegistryIconUrl={activeEntry.acpRegistryIconUrl}
                showBadge={showInstanceBadge}
                className="size-4"
                iconClassName={cn("size-4", props.activeProviderIconClassName)}
                indicatorBackground={props.instanceIndicatorBackground ?? "var(--contrast-input)"}
                badgeClassName={cn(
                  "right-[-0.125rem] bottom-[-0.125rem] h-3 min-w-3 px-0.5 text-5xs",
                  size === "xs" && "shadow-none",
                )}
              />
            </span>
          ) : null}
          {props.isComposerOwned ? (
            <span {...triggerTextProps}>{triggerText}</span>
          ) : (
            <Tooltip>
              <TooltipTrigger render={<span {...triggerTextProps} />}>{triggerText}</TooltipTrigger>
              <TooltipPopup side="top">{triggerTooltipContent}</TooltipPopup>
            </Tooltip>
          )}
          {props.triggerSuffix}
          {selectedModel?.isUnavailable && !selectedEntries && props.triggerLabel === undefined ? (
            <Badge variant="outline" size="sm">
              <T context="badge on a model that cannot be selected">Unavailable</T>
            </Badge>
          ) : null}
          {props.isComposerOwned ? (
            <ChevronDownIcon
              aria-hidden="true"
              data-composer-control-chevron
              className="size-3 shrink-0 opacity-65"
            />
          ) : null}
        </span>
      </PopoverTrigger>
      <PopoverPopup
        {...(props.isComposerOwned ? composerFloatingLayerProps : {})}
        ref={(popup) => {
          popupRef.current = popup;
          const unlock = lockBackgroundScroll(popup);
          return () => {
            popupRef.current = null;
            unlock?.();
          };
        }}
        initialFocus={isCoarsePointer ? popupRef : searchInputRef}
        align={effectivePopupAlign}
        alignOffset={
          alignPopupToComposerCard
            ? ({ side, align }) => {
                const trigger = triggerRef.current;
                const card = findComposerPickerAnchorCard(trigger);
                if (!trigger || !card) return 0;
                const isRtl =
                  typeof window !== "undefined" &&
                  window.getComputedStyle(card).direction === "rtl";
                return computeComposerPickerAlignOffset({
                  triggerRect: trigger.getBoundingClientRect(),
                  cardRect: card.getBoundingClientRect(),
                  align,
                  side,
                  isRtl,
                });
              }
            : 0
        }
        // Docked, the popup opens above the composer and slides over it when that space is short,
        // so a short window gets its full height (Floating UI sizes to the viewport) instead of a sliver.
        {...(docked
          ? {
              side: "top" as const,
              sideOffset: 6,
              collisionAvoidance: { side: "shift", align: "shift" } as const,
            }
          : {})}
        className="overflow-hidden rounded-xl bg-clip-padding before:hidden"
        padding="none"
        touchBackdrop
      >
        {hasUnifiedFooter ? (
          <DockedPickerContext value={{ modelLabel: triggerTitle }}>
            <div
              data-model-picker-scoped={isAgentScoped ? "true" : undefined}
              className="flex max-h-(--available-height) w-[min(23.5rem,calc(100vw-1rem))] flex-col overflow-hidden"
            >
              {picker}
              <div
                data-model-picker-effort
                className="shrink-0 border-t border-border/70 bg-muted/25 empty:hidden"
              >
                {props.unifiedFooter}
              </div>
            </div>
          </DockedPickerContext>
        ) : props.effortColumn ? (
          <DockedPickerContext value={{ modelLabel: triggerTitle }}>
            <div className="flex max-h-(--available-height) flex-col">
              {/* One fixed height, so a model with more options never resizes the popup. Short
                  windows shrink it and keep the footer. */}
              <div className="flex h-86.5 min-h-0 max-sm:h-auto max-sm:flex-col">
                {picker}
                <div
                  data-model-picker-effort
                  className="flex min-h-0 w-48 flex-col sm:shrink-0 border-l border-border/70 bg-muted/40 max-sm:h-64 max-sm:w-full max-sm:border-t max-sm:border-l-0"
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowLeft" || event.altKey || event.ctrlKey || event.metaKey)
                      return;
                    event.preventDefault();
                    event.stopPropagation();
                    searchInputRef.current?.focus();
                  }}
                >
                  {props.effortColumn}
                </div>
              </div>
              {props.footer}
            </div>
          </DockedPickerContext>
        ) : (
          picker
        )}
        {props.selectedModels === undefined && !docked ? (
          <ChatGptSharingControl provider={activeEntry?.snapshot ?? null} />
        ) : null}
      </PopoverPopup>
    </Popover>
  );
});
