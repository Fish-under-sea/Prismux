import type { ModelSelection, ProviderInstanceId, RuntimeMode } from "@prismux/core-contracts";
import { createModelSelection } from "@prismux/core-shared/model";
import { T, useGT, useMessages } from "gt-react";
import { ChevronDownIcon, LockIcon } from "lucide-react";
import { type ComponentProps, memo, useId, useRef } from "react";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { cn } from "~/lib/utils";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerControl, ComposerControlIcon } from "./ComposerControl";
import { focusRequestedPermission, useComposerMenuProps } from "./composerEventScope";
import { ComposerPrimaryActions } from "./ComposerPrimaryActions";
import { resolveModelPickerSelectedModel } from "./ModelPickerContent";
import { ProviderModelPicker } from "./ProviderModelPicker";
import {
  isFullAccessRuntimeMode,
  resolveRuntimeModeOption,
  runtimeModeConfig,
} from "./runtimeModeConfig";
import { useComposerMenuState } from "./useComposerMenuState";

export type RuntimeModeOption = {
  mode: RuntimeMode;
  disabledReason?: string;
} & (typeof runtimeModeConfig)[RuntimeMode];
export const ComposerFooterModeControls = memo(function ComposerFooterModeControls(props: {
  runtimeMode: RuntimeMode;
  runtimeModeOptions: ReadonlyArray<RuntimeModeOption>;
  size?: "sm" | "xs";
  hidden?: boolean;
  /** How the permissions trigger shows: Orca's default is icon + chevron (`icon`). */
  accessDisplay?: "label" | "icon" | "hidden";
  /** Draw the icon in the label color, not muted (the mode differs from the user's default). */
  emphasized?: boolean;
  /** Locks permissions to read-only inside BTW side-question tabs (hides `full-access` toggle). */
  readOnlyBtwLock?: boolean;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const size = props.size ?? "sm";
  const accessDisplay = props.accessDisplay ?? "icon";
  const composerFloatingLayerProps = useComposerMenuProps();
  const [open, setOpen] = useComposerMenuState(props.hidden);
  const permissionsChipRef = useRef<HTMLButtonElement>(null);

  if (props.readOnlyBtwLock) {
    if (accessDisplay === "hidden") return null;
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              role="status"
              data-btw-readonly-lock="true"
              data-permission-mode="approval-required"
              aria-label="旁路只读模式已锁定"
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-full border border-sky-500/25 bg-sky-500/10 text-sky-700 select-none dark:border-sky-400/25 dark:bg-sky-400/12 dark:text-sky-300",
                size === "xs" ? "h-5.5 px-1.5 text-[10px]" : "h-6 px-2 text-[11px]",
                "font-medium leading-none",
              )}
            >
              <LockIcon aria-hidden="true" className="size-3 shrink-0" />
              <span>只读</span>
            </span>
          }
        />
        <TooltipPopup side="top">
          旁路提问（BTW）已锁定为只读安全模式（approval-required），仅允许查代码与只读命令，禁止修改工作区文件。
        </TooltipPopup>
      </Tooltip>
    );
  }
  const runtimeModeOption =
    props.runtimeModeOptions.find((option) => option.mode === props.runtimeMode) ??
    resolveRuntimeModeOption("approval-required", messages);
  const RuntimeModeIcon = runtimeModeOption.icon;
  const fullAccess = isFullAccessRuntimeMode(props.runtimeMode);
  const permissionsTooltip = gt("Permissions: {mode}. {description}", {
    mode: runtimeModeOption.label,
    description: runtimeModeOption.description,
  });
  const permissionsChip = (
    <Menu
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) =>
        focusRequestedPermission(isOpen, permissionsChipRef.current)
      }
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <ComposerControl
                  ref={permissionsChipRef}
                  data-composer-shortcut="composer.mode"
                  data-composer-permission-shield="true"
                  data-permission-mode={props.runtimeMode}
                  size={size}
                  className={cn(
                    "gap-1 px-1.5 data-popup-open:bg-accent",
                    fullAccess
                      ? "text-amber-600 hover:bg-amber-500/12 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  aria-label={gt("Permissions: {mode}", { mode: runtimeModeOption.label })}
                />
              }
            />
          }
        >
          <ComposerControlIcon
            icon={RuntimeModeIcon}
            size={size}
            className={cn(
              fullAccess
                ? "text-amber-600 dark:text-amber-400"
                : props.emphasized
                  ? "text-current"
                  : undefined,
            )}
          />
          <span
            data-composer-control-label
            className={cn(
              accessDisplay === "icon" ? "sr-only" : "text-xs font-medium",
              fullAccess && "text-amber-600 dark:text-amber-400",
            )}
          >
            {runtimeModeOption.label}
          </span>
          <ChevronDownIcon
            aria-hidden="true"
            data-composer-control-chevron
            className="size-3 opacity-70"
          />
        </TooltipTrigger>
        <TooltipPopup side="top">{permissionsTooltip}</TooltipPopup>
      </Tooltip>
      <MenuPopup
        side="top"
        align="start"
        className="w-[min(19.5rem,calc(100vw-1.5rem))] p-1"
        {...composerFloatingLayerProps}
      >
        <ComposerPermissionsSection
          runtimeMode={props.runtimeMode}
          runtimeModeOptions={props.runtimeModeOptions}
          onRuntimeModeChange={props.onRuntimeModeChange}
        />
      </MenuPopup>
    </Menu>
  );

  return accessDisplay === "hidden" ? null : permissionsChip;
});

/**
 * Orca-aligned 4-tier vertical permission mode radio list:
 * left selection dot + mode icon + bold title + muted description, with amber highlight for Full access.
 * Each row is a real menuitemradio for full keyboard navigation (Up/Down and Left/Right).
 */
export function ComposerPermissionsSection(props: {
  runtimeMode: RuntimeMode;
  runtimeModeOptions: ReadonlyArray<RuntimeModeOption>;
  onRuntimeModeChange: (mode: RuntimeMode) => void;
}) {
  const gt = useGT();
  const descriptionId = useId();
  return (
    <div data-composer-permissions className="flex w-full min-w-68 flex-col gap-0.5 py-0.5">
      <div className="px-2.5 pt-1 pb-1 font-medium text-muted-foreground text-xs">
        <T>Permissions</T>
      </div>
      <MenuPrimitive.RadioGroup
        aria-label={gt("Permissions")}
        value={props.runtimeMode}
        onValueChange={(value: RuntimeMode) => {
          if (value !== props.runtimeMode) props.onRuntimeModeChange(value);
        }}
        className="flex flex-col gap-0.5"
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          const items = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]'),
          );
          const index = items.findIndex((item) => item === document.activeElement);
          const next = items[index + (event.key === "ArrowRight" ? 1 : -1)];
          if (index < 0 || !next) return;
          event.preventDefault();
          event.stopPropagation();
          next.focus();
        }}
      >
        {props.runtimeModeOptions.map((option) => {
          const OptionIcon = option.icon;
          const selected = option.mode === props.runtimeMode;
          const fullAccess = isFullAccessRuntimeMode(option.mode);
          const descriptionText = option.disabledReason ?? option.description;
          return (
            <MenuPrimitive.RadioItem
              key={option.mode}
              value={option.mode}
              disabled={option.disabledReason !== undefined}
              label={option.label}
              aria-label={option.label}
              aria-describedby={`${descriptionId}-${option.mode}`}
              closeOnClick
              data-permission-option={option.mode}
              className={cn(
                "group/perm flex w-full cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-left outline-none transition-colors",
                "hover:bg-accent/80 data-highlighted:bg-accent/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                "data-disabled:cursor-not-allowed data-disabled:opacity-45",
                selected && "bg-accent/55",
              )}
            >
              {/* Left selection indicator dot matching Orca Figure 2 */}
              <span
                aria-hidden="true"
                className="mt-1.5 flex size-3 shrink-0 items-center justify-center"
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full transition-opacity",
                    selected
                      ? fullAccess
                        ? "bg-amber-600 opacity-100 dark:bg-amber-400"
                        : "bg-foreground opacity-100"
                      : "opacity-0",
                  )}
                />
              </span>
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    "flex items-center gap-1.5 text-sm leading-5 font-semibold",
                    fullAccess
                      ? "text-amber-700 dark:text-amber-400"
                      : "text-foreground",
                  )}
                >
                  <OptionIcon aria-hidden="true" className="size-3.5 shrink-0" />
                  <span className="truncate">{option.label}</span>
                </div>
                <div
                  id={`${descriptionId}-${option.mode}`}
                  className="mt-0.5 text-xs leading-4 font-normal text-muted-foreground"
                >
                  {descriptionText}
                </div>
              </div>
            </MenuPrimitive.RadioItem>
          );
        })}
      </MenuPrimitive.RadioGroup>
    </div>
  );
}

export const ComposerFooterPrimaryActions = memo(function ComposerFooterPrimaryActions(props: {
  children?: React.ReactNode;
  compact: boolean;
  canOperateThread: boolean;
  isPreparingWorktree: boolean;
  pendingAction: {
    questionIndex: number;
    isLastQuestion: boolean;
    canAdvance: boolean;
    isResponding: boolean;
    isComplete: boolean;
  } | null;
  isRunning: boolean;
  canInterrupt: boolean;
  runId: string | null;
  followUpBehavior: "queue" | "steer";
  canSteer: boolean;
  alternateShortcutLabel: string | null;
  voiceInputActive?: boolean;
  isSendBusy: boolean;
  isSendHeld?: boolean;
  sendDisabledReason: string | null;
  isEnvironmentUnavailable: boolean;
  hasSendableContent: boolean;
  canResume: boolean;
  preserveComposerFocusOnPointerDown?: boolean;
  isEditingQueuedMessage: boolean;
  onSubmitMessage: React.MouseEventHandler<HTMLButtonElement>;
  onResume: () => void;
  onPreviousPendingQuestion: () => void;
  onInterrupt: () => void;
  compactBeforeSendTokens: number | null;
  hideCompactToggle: boolean;
  keepFullHistory: boolean;
  onToggleKeepFullHistory: () => void;
}) {
  return (
    <>
      <ComposerPrimaryActions
        compact={props.compact}
        canOperateThread={props.canOperateThread}
        pendingAction={props.pendingAction}
        isRunning={props.isRunning}
        canInterrupt={props.canInterrupt}
        runId={props.runId}
        followUpBehavior={props.followUpBehavior}
        canSteer={props.canSteer}
        alternateShortcutLabel={props.alternateShortcutLabel}
        voiceInputActive={props.voiceInputActive ?? false}
        isSendBusy={props.isSendBusy}
        isSendHeld={props.isSendHeld ?? false}
        sendDisabledReason={props.sendDisabledReason}
        isEnvironmentUnavailable={props.isEnvironmentUnavailable}
        isPreparingWorktree={props.isPreparingWorktree}
        hasSendableContent={props.hasSendableContent}
        canResume={props.canResume}
        preserveComposerFocusOnPointerDown={props.preserveComposerFocusOnPointerDown ?? false}
        isEditingQueuedMessage={props.isEditingQueuedMessage}
        onSubmitMessage={props.onSubmitMessage}
        onResume={props.onResume}
        onPreviousPendingQuestion={props.onPreviousPendingQuestion}
        onInterrupt={props.onInterrupt}
        compactBeforeSendTokens={props.compactBeforeSendTokens}
        hideCompactToggle={props.hideCompactToggle}
        keepFullHistory={props.keepFullHistory}
        onToggleKeepFullHistory={props.onToggleKeepFullHistory}
      >
        {props.children}
      </ComposerPrimaryActions>
    </>
  );
});

/**
 * The composer's model picker. It owns the single- and multi-model selection
 * handlers so they are cached against the selection state, not rebuilt on
 * every ChatComposer render.
 */
export function ComposerModelPicker({
  multipleModelsEnabled,
  multipleModelSelections,
  onMultipleModelSelectionsChange,
  selectedModelSelection,
  onProviderModelSelect,
  ...pickerProps
}: Omit<
  ComponentProps<typeof ProviderModelPicker>,
  "selectedModels" | "onToggleModel" | "onInstanceModelChange"
> & {
  readonly multipleModelsEnabled: boolean;
  readonly multipleModelSelections: ReadonlyArray<ModelSelection> | null;
  readonly onMultipleModelSelectionsChange: (
    selections: ReadonlyArray<ModelSelection> | null,
  ) => void;
  readonly selectedModelSelection: ModelSelection;
  readonly onProviderModelSelect: (
    instanceId: ProviderInstanceId,
    model: string,
    options?: { focusComposer?: boolean },
  ) => void;
}) {
  const { instanceEntries, modelOptionsByInstance } = pickerProps;
  const toggleModel = (instanceId: ProviderInstanceId, model: string) => {
    const current = multipleModelSelections ?? [selectedModelSelection];
    const matchesModel = (selection: ModelSelection) => {
      if (selection.instanceId !== instanceId) return false;
      const entry = instanceEntries.find((entry) => entry.instanceId === selection.instanceId);
      const resolvedModel = resolveModelPickerSelectedModel({
        driverKind: entry?.driverKind,
        model: selection.model,
        options: modelOptionsByInstance?.get(selection.instanceId) ?? [],
      });
      return (resolvedModel?.slug ?? selection.model) === model;
    };
    const exists = current.some(matchesModel);
    const next = exists
      ? current.filter((selection) => !matchesModel(selection))
      : [...current, createModelSelection(instanceId, model)];
    if (next.length > 1) {
      onMultipleModelSelectionsChange(next);
    } else {
      onMultipleModelSelectionsChange(null);
      const remaining = next[0] ?? selectedModelSelection;
      onProviderModelSelect(remaining.instanceId, remaining.model, {
        focusComposer: false,
      });
    }
  };
  return (
    <ProviderModelPicker
      {...pickerProps}
      {...(multipleModelsEnabled
        ? {
            ...(multipleModelSelections !== null
              ? { selectedModels: multipleModelSelections }
              : {}),
            onToggleModel: toggleModel,
          }
        : {})}
      onInstanceModelChange={(instanceId, model) => {
        onMultipleModelSelectionsChange(null);
        onProviderModelSelect(instanceId, model);
      }}
    />
  );
}
