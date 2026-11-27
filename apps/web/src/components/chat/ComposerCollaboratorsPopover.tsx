/* oxlint-disable prismux/no-untranslated-copy -- Prismux composer collaborators invite popover uses concise Chinese UX labels aligned with subscription compliance governance */
import type { ProviderInstanceId } from "@prismux/core-contracts";
import { useNavigate } from "@tanstack/react-router";
import {
  CheckIcon,
  LockIcon,
  MinusIcon,
  PlusIcon,
  ShieldAlertIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import { type CSSProperties, useEffect, useState } from "react";

import {
  type ComposerThreadTarget,
  useComposerDraftCollaborators,
  useComposerDraftStore,
} from "../../composerDraftStore";
import { cn } from "../../lib/utils";
import type { AppModelOption } from "../../modelSelection";
import { prismuxDaemonClient } from "../../prismux/daemonClient";
import {
  SUBSCRIPTION_WAIVER_ANCHOR_ID,
  SUBSCRIPTION_WAIVER_ROUTE,
  useSubscriptionWaiverState,
} from "../../prismux/SubscriptionRiskWaiverSection";
import {
  isProviderInstancePickerVisible,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  addCollaboratorModelRow,
  evaluateCollaboratorGovernance,
  getCachedProviderProbes,
  getProviderCollaboratorCount,
  getRemainingCollaboratorCapacity,
  getRemainingProviderCollaboratorCapacity,
  getTotalCollaboratorCount,
  MAX_COLLABORATOR_COUNT_PER_AGENT,
  MAX_TOTAL_COLLABORATOR_COUNT,
  MIN_COLLABORATOR_COUNT,
  normalizeCollaboratorSelections,
  removeCollaboratorProvider,
  removeCollaboratorSelection,
  resolveDefaultModelForEntry,
  setCachedProviderProbes,
  setCollaboratorModel,
  stepCollaboratorCount,
  toggleCollaboratorSelection,
  type CollaboratorProviderProbeLike,
  type CollaboratorWaiverPolicy,
  type ComposerCollaboratorSelection,
} from "./composerCollaborators.logic";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";

const DEFAULT_MODEL_SENTINEL = "__pmx_default_model__";

const ACTIVE_ACCENT_PILL_STYLE: CSSProperties = {
  color: "var(--pmx-accent-text, var(--pmx-accent, var(--primary)))",
  backgroundColor:
    "var(--pmx-accent-soft, color-mix(in srgb, var(--pmx-accent, var(--primary)) 13%, transparent))",
  borderColor:
    "var(--pmx-accent-border, color-mix(in srgb, var(--pmx-accent, var(--primary)) 36%, transparent))",
};

const ACTIVE_ROW_STYLE: CSSProperties = {
  backgroundColor:
    "var(--pmx-accent-soft, color-mix(in srgb, var(--pmx-accent, var(--primary)) 10%, transparent))",
  borderColor:
    "var(--pmx-accent-border, color-mix(in srgb, var(--pmx-accent, var(--primary)) 34%, transparent))",
};

const ACTIVE_CHECK_STYLE: CSSProperties = {
  backgroundColor: "var(--pmx-accent, var(--primary))",
  borderColor: "var(--pmx-accent, var(--primary))",
  color: "var(--pmx-accent-ink, var(--primary-foreground, #ffffff))",
};

const ACTIVE_MODEL_OPTION_STYLE: CSSProperties = {
  color: "var(--pmx-accent-text, var(--pmx-accent, var(--primary)))",
  backgroundColor:
    "var(--pmx-accent-soft, color-mix(in srgb, var(--pmx-accent, var(--primary)) 14%, transparent))",
};

const ADD_MODEL_ROW_BUTTON_STYLE: CSSProperties = {
  color: "var(--pmx-accent-text, var(--pmx-accent, var(--primary)))",
  borderColor:
    "var(--pmx-accent-border, color-mix(in srgb, var(--pmx-accent, var(--primary)) 34%, transparent))",
};

const IDLE_TRIGGER_CLASS =
  "inline-flex h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-transparent px-2 text-xs font-medium text-foreground/78 transition-colors outline-none hover:bg-foreground/[0.06] hover:text-foreground data-popup-open:bg-foreground/[0.08] data-popup-open:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-foreground/25 dark:text-foreground/76 dark:hover:bg-white/10 dark:data-popup-open:bg-white/12 dark:hover:text-foreground";

const ACTIVE_TRIGGER_CLASS =
  "inline-flex h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition-colors outline-none hover:brightness-105 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-foreground/30";

interface CollaboratorModelChoice {
  readonly slug: string;
  readonly label: string;
}

interface CollaboratorModelSelectProps {
  readonly instanceId: ProviderInstanceId;
  readonly displayName: string;
  readonly rowId: string;
  readonly rowIndex: number;
  readonly value: string;
  readonly choices: ReadonlyArray<CollaboratorModelChoice>;
  readonly onChange: (nextModel: string) => void;
}

function CollaboratorModelSelect({
  instanceId,
  displayName,
  rowId,
  rowIndex,
  value,
  choices,
  onChange,
}: CollaboratorModelSelectProps) {
  const triggerTestId =
    rowIndex === 0
      ? `composer-collab-model-${instanceId}`
      : `composer-collab-model-${instanceId}-${rowIndex}`;
  const popupTestId =
    rowIndex === 0
      ? `composer-collab-model-popup-${instanceId}`
      : `composer-collab-model-popup-${instanceId}-${rowIndex}`;
  const optionPrefix = rowIndex === 0 ? instanceId : `${instanceId}-${rowIndex}`;

  const normalizedChoices: ReadonlyArray<CollaboratorModelChoice> =
    choices.length > 0 ? choices : [{ slug: DEFAULT_MODEL_SENTINEL, label: "默认模型" }];
  const resolvedValue =
    choices.length > 0 ? value || normalizedChoices[0]!.slug : DEFAULT_MODEL_SENTINEL;
  const selectedLabel =
    normalizedChoices.find((choice) => choice.slug === resolvedValue)?.label ??
    (resolvedValue === DEFAULT_MODEL_SENTINEL ? "默认模型" : resolvedValue);

  return (
    <Select
      modal={false}
      value={resolvedValue}
      onValueChange={(nextValue) => {
        if (typeof nextValue !== "string") return;
        onChange(nextValue === DEFAULT_MODEL_SENTINEL ? "" : nextValue);
      }}
    >
      <SelectTrigger
        size="xs"
        data-testid={triggerTestId}
        data-pmx-collab-model-trigger={rowId}
        data-pmx-collab-model-value={resolvedValue === DEFAULT_MODEL_SENTINEL ? "" : resolvedValue}
        aria-label={
          rowIndex === 0 ? `${displayName} 模型` : `${displayName} 模型类别 ${rowIndex + 1}`
        }
        className="min-w-0 flex-1"
      >
        <span className="min-w-0 flex-1 truncate text-left text-2xs font-medium">
          {selectedLabel}
        </span>
      </SelectTrigger>

      <SelectPopup
        side="bottom"
        align="start"
        sideOffset={4}
        alignItemWithTrigger={false}
        matchTriggerWidth={true}
        data-testid={popupTestId}
        data-pmx-collab-model-popup={rowId}
        className="max-h-56 max-w-[304px]"
      >
        {normalizedChoices.map((choice) => {
          const isCurrent = choice.slug === resolvedValue;
          return (
            <SelectItem
              key={choice.slug}
              value={choice.slug}
              data-testid={`composer-collab-model-option-${optionPrefix}-${choice.slug}`}
              data-pmx-collab-model-option={choice.slug}
              data-pmx-collab-model-selected={isCurrent ? "true" : "false"}
              style={isCurrent ? ACTIVE_MODEL_OPTION_STYLE : undefined}
            >
              <span
                className={cn(
                  "flex min-w-0 items-center justify-between gap-2 text-2xs",
                  isCurrent ? "font-semibold" : "font-medium",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{choice.label}</span>
                <CheckIcon
                  aria-hidden="true"
                  className={cn(
                    "size-3 shrink-0 transition-opacity",
                    isCurrent ? "opacity-100" : "opacity-0",
                  )}
                  style={
                    isCurrent
                      ? { color: "var(--pmx-accent-text, var(--pmx-accent, var(--primary)))" }
                      : undefined
                  }
                  strokeWidth={2.5}
                />
              </span>
            </SelectItem>
          );
        })}
      </SelectPopup>
    </Select>
  );
}

export interface ComposerCollaboratorsPopoverViewProps {
  readonly providerInstanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>;
  readonly selections: ReadonlyArray<ComposerCollaboratorSelection>;
  readonly probes?: ReadonlyArray<CollaboratorProviderProbeLike> | null | undefined;
  readonly waiver: CollaboratorWaiverPolicy;
  readonly disabled?: boolean | undefined;
  readonly open?: boolean | undefined;
  readonly onOpenChange?: ((open: boolean) => void) | undefined;
  readonly onChangeSelections: (next: ReadonlyArray<ComposerCollaboratorSelection>) => void;
  readonly onOpenWaiverSettings: (route: typeof SUBSCRIPTION_WAIVER_ROUTE) => void;
  readonly className?: string | undefined;
}

export function ComposerCollaboratorsPopoverView({
  providerInstanceEntries,
  modelOptionsByInstance,
  selections,
  probes,
  waiver,
  disabled = false,
  open: controlledOpen,
  onOpenChange,
  onChangeSelections,
  onOpenWaiverSettings,
  className,
}: ComposerCollaboratorsPopoverViewProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isOpen = controlledOpen ?? uncontrolledOpen;
  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) {
      setUncontrolledOpen(nextOpen);
    }
    onOpenChange?.(nextOpen);
  };

  const visibleEntries = providerInstanceEntries.filter((entry) =>
    isProviderInstancePickerVisible(entry),
  );
  const entriesById = new Map(visibleEntries.map((entry) => [entry.instanceId, entry]));

  // Normalize so every active row has a stable unique id, and only surface unlocked selections
  // in active counts and icon stacks so revoked waivers stay fail-closed.
  const activeSelections = normalizeCollaboratorSelections(selections).filter((selection) => {
    const entry = entriesById.get(selection.providerInstanceId);
    if (!entry) return false;
    return !evaluateCollaboratorGovernance({ entry, probes, waiver }).locked;
  });

  const selectionsByInstanceId = new Map<ProviderInstanceId, ComposerCollaboratorSelection[]>();
  const selectedInstanceOrder: ProviderInstanceId[] = [];
  for (const selection of activeSelections) {
    const bucket = selectionsByInstanceId.get(selection.providerInstanceId);
    if (bucket) {
      bucket.push(selection);
    } else {
      selectionsByInstanceId.set(selection.providerInstanceId, [selection]);
      selectedInstanceOrder.push(selection.providerInstanceId);
    }
  }

  const totalCount = getTotalCollaboratorCount(activeSelections);
  const remainingCapacity = getRemainingCollaboratorCapacity(activeSelections);
  const isActive = totalCount > 0;
  const stackedEntries = selectedInstanceOrder.slice(0, 3).flatMap((instanceId) => {
    const entry = entriesById.get(instanceId);
    return entry ? [entry] : [];
  });

  const handleToggleAgent = (entry: ProviderInstanceEntry, locked: boolean) => {
    if (locked) return;
    const options = modelOptionsByInstance.get(entry.instanceId);
    const defaultModel = resolveDefaultModelForEntry(entry, options);
    onChangeSelections(
      toggleCollaboratorSelection(activeSelections, {
        providerInstanceId: entry.instanceId,
        defaultModel,
      }),
    );
  };

  const handleAddModelRow = (entry: ProviderInstanceEntry) => {
    const options = modelOptionsByInstance.get(entry.instanceId);
    const fallbackModel = resolveDefaultModelForEntry(entry, options);
    onChangeSelections(
      addCollaboratorModelRow(activeSelections, {
        providerInstanceId: entry.instanceId,
        fallbackModel,
      }),
    );
  };

  const handleClear = () => {
    onChangeSelections([]);
  };

  const handleNavigateWaiver = () => {
    setOpen(false);
    onOpenWaiverSettings(SUBSCRIPTION_WAIVER_ROUTE);
  };

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            disabled={disabled}
            data-testid="composer-collaborators-trigger"
            data-pmx-collab-trigger={isActive ? "active" : "idle"}
            data-pmx-collab-count={String(totalCount)}
            aria-label={isActive ? `邀请协作（已选 ${totalCount}）` : "邀请协作"}
            style={isActive ? ACTIVE_ACCENT_PILL_STYLE : undefined}
            className={cn(
              isActive ? ACTIVE_TRIGGER_CLASS : IDLE_TRIGGER_CLASS,
              disabled && "pointer-events-none opacity-50",
              className,
            )}
          />
        }
      >
        {isActive ? (
          <>
            <span className="inline-flex shrink-0 items-center -space-x-1.5" aria-hidden="true">
              {stackedEntries.map((entry) => (
                <span
                  key={entry.instanceId}
                  data-pmx-collab-stack-icon={entry.instanceId}
                  className="inline-flex size-4 items-center justify-center rounded-full bg-background/95 ring-1 ring-border/70"
                >
                  <ProviderInstanceIcon
                    driverKind={entry.driverKind}
                    displayName={entry.displayName}
                    instanceId={entry.instanceId}
                    accentColor={entry.accentColor}
                    acpRegistryAgentId={entry.acpRegistryAgentId}
                    acpRegistryIconUrl={entry.acpRegistryIconUrl}
                    acpCommandPath={entry.acpCommandPath}
                    size="compact"
                    className="size-3"
                    iconClassName="size-3"
                  />
                </span>
              ))}
            </span>
            <span className="whitespace-nowrap tabular-nums">协作 · {totalCount}</span>
          </>
        ) : (
          <>
            <UsersIcon className="size-3.5 shrink-0 opacity-75" aria-hidden="true" />
            <span className="whitespace-nowrap">邀请协作</span>
          </>
        )}
      </PopoverTrigger>

      <PopoverPopup
        side="top"
        align="end"
        sideOffset={6}
        padding="none"
        data-testid="composer-collaborators-popover"
        className="w-[336px] max-w-[calc(100vw-2rem)]"
      >
        <div className="flex flex-col">
          {/* Compact header */}
          <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <UsersIcon className="size-3.5 shrink-0 text-foreground/75" aria-hidden="true" />
              <span className="truncate text-xs font-semibold text-foreground">邀请协作</span>
              <span
                data-testid="composer-collaborators-capacity"
                className="rounded-md bg-foreground/[0.06] px-1.5 py-0.5 text-3xs font-medium tabular-nums text-foreground/75 dark:bg-white/10"
              >
                {totalCount}/{MAX_TOTAL_COLLABORATOR_COUNT}
              </span>
            </div>
            {activeSelections.length > 0 ? (
              <button
                type="button"
                data-testid="composer-collaborators-clear"
                onClick={handleClear}
                className="inline-flex h-5 cursor-pointer items-center rounded px-1.5 text-2xs font-medium text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-foreground/30 dark:hover:bg-white/10"
              >
                清空
              </button>
            ) : (
              <span className="text-2xs text-muted-foreground">按需委派</span>
            )}
          </div>

          {/* Compact scrollable agent list */}
          <div className="max-h-[320px] space-y-1.5 overflow-y-auto p-1.5">
            {visibleEntries.length === 0 ? (
              <div className="px-2.5 py-4 text-center text-xs text-muted-foreground">
                暂无可用 Agent，请先在提供商设置中启用。
              </div>
            ) : (
              visibleEntries.map((entry) => {
                const governance = evaluateCollaboratorGovernance({
                  entry,
                  probes,
                  waiver,
                });
                const providerRows = selectionsByInstanceId.get(entry.instanceId) ?? [];
                const isSelected = providerRows.length > 0;
                const atGlobalCap = !isSelected && remainingCapacity <= 0;
                const providerUsed = getProviderCollaboratorCount(
                  activeSelections,
                  entry.instanceId,
                );
                const providerRemaining = getRemainingProviderCollaboratorCapacity(
                  activeSelections,
                  entry.instanceId,
                );
                const rawModelOptions = modelOptionsByInstance.get(entry.instanceId) ?? [];
                const baseModelChoices: Array<CollaboratorModelChoice> =
                  rawModelOptions.length > 0
                    ? rawModelOptions.map((option) => ({
                        slug: option.slug,
                        label: option.name || option.slug,
                      }))
                    : entry.models.map((model) => ({
                        slug: model.slug,
                        label: model.name || model.slug,
                      }));
                const addModelDisabled = providerRemaining <= 0;
                const addModelDisabledReason =
                  providerUsed >= MAX_COLLABORATOR_COUNT_PER_AGENT
                    ? `已达单个 Agent 协作上限（${MAX_COLLABORATOR_COUNT_PER_AGENT}）`
                    : remainingCapacity <= 0
                      ? `已达协作总数上限（${MAX_TOTAL_COLLABORATOR_COUNT}）`
                      : null;

                return (
                  <div
                    key={entry.instanceId}
                    data-pmx-collab-row={entry.instanceId}
                    data-pmx-collab-selected={isSelected ? "true" : "false"}
                    data-pmx-collab-locked={governance.locked ? "true" : "false"}
                    data-pmx-collab-row-count={String(providerRows.length)}
                    style={isSelected ? ACTIVE_ROW_STYLE : undefined}
                    className={cn(
                      "rounded-lg border px-2 py-1.5 transition-colors",
                      isSelected
                        ? "border-transparent"
                        : governance.locked
                          ? "border-border/55 bg-foreground/[0.02] dark:bg-white/[0.02]"
                          : "border-transparent hover:bg-foreground/[0.045] dark:hover:bg-white/[0.06]",
                    )}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <button
                        type="button"
                        data-testid={`composer-collab-toggle-${entry.instanceId}`}
                        disabled={governance.locked || atGlobalCap}
                        aria-pressed={isSelected}
                        aria-label={
                          governance.locked
                            ? (governance.lockTooltip ?? `${entry.displayName} 已锁定`)
                            : atGlobalCap
                              ? `已达协作总数上限（${MAX_TOTAL_COLLABORATOR_COUNT}）`
                              : `${isSelected ? "取消邀请" : "邀请"} ${entry.displayName}`
                        }
                        onClick={() => handleToggleAgent(entry, governance.locked)}
                        className={cn(
                          "flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none",
                          governance.locked || atGlobalCap
                            ? "cursor-not-allowed opacity-75"
                            : "cursor-pointer",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          style={isSelected ? ACTIVE_CHECK_STYLE : undefined}
                          className={cn(
                            "inline-flex size-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors",
                            isSelected
                              ? "border-transparent"
                              : governance.locked
                                ? "border-destructive/55 bg-destructive/10 text-destructive"
                                : "border-foreground/28 bg-background/70",
                          )}
                        >
                          {isSelected ? (
                            <CheckIcon className="size-2.5" strokeWidth={2.75} />
                          ) : governance.locked ? (
                            <LockIcon className="size-2.5" />
                          ) : null}
                        </span>

                        <ProviderInstanceIcon
                          driverKind={entry.driverKind}
                          displayName={entry.displayName}
                          instanceId={entry.instanceId}
                          accentColor={entry.accentColor}
                          acpRegistryAgentId={entry.acpRegistryAgentId}
                          acpRegistryIconUrl={entry.acpRegistryIconUrl}
                          acpCommandPath={entry.acpCommandPath}
                          size="compact"
                          className="size-4 shrink-0"
                          iconClassName="size-3.5"
                        />

                        <span className="truncate text-xs font-medium text-foreground">
                          {entry.displayName}
                        </span>

                        <span
                          data-pmx-collab-auth-badge={governance.authMode}
                          className={cn(
                            "shrink-0 rounded px-1 py-0.5 text-3xs font-medium leading-none",
                            governance.locked
                              ? "border border-destructive/40 bg-destructive/10 text-destructive"
                              : "bg-foreground/[0.06] text-foreground/72 dark:bg-white/10 dark:text-foreground/76",
                          )}
                        >
                          {governance.authBadgeLabel}
                        </span>
                      </button>

                      {governance.locked ? (
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <button
                                type="button"
                                data-testid={`composer-collab-waiver-${entry.instanceId}`}
                                aria-label={
                                  governance.lockTooltip ?? "前往签署个人订阅风险免责协议"
                                }
                                onClick={handleNavigateWaiver}
                                className="inline-flex h-5 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-destructive/45 bg-destructive/10 px-1.5 text-2xs font-semibold text-destructive outline-none transition-colors hover:bg-destructive/18 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-destructive/40"
                              />
                            }
                          >
                            <ShieldAlertIcon className="size-3 shrink-0" aria-hidden="true" />
                            <span>去签署</span>
                          </TooltipTrigger>
                          <TooltipPopup side="top">
                            {governance.lockTooltip ?? "前往签署个人订阅风险免责协议"}
                          </TooltipPopup>
                        </Tooltip>
                      ) : isSelected ? (
                        <button
                          type="button"
                          data-testid={`composer-collab-remove-${entry.instanceId}`}
                          aria-label={`移除 ${entry.displayName}`}
                          onClick={() =>
                            onChangeSelections(
                              removeCollaboratorProvider(activeSelections, entry.instanceId),
                            )
                          }
                          className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground dark:hover:bg-white/12"
                        >
                          <XIcon className="size-3" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>

                    {isSelected ? (
                      <div className="mt-1.5 space-y-1.5 pl-5">
                        {providerRows.map((row, rowIndex) => {
                          const rowId = row.id ?? `${entry.instanceId}#${rowIndex + 1}`;
                          const rowChoices =
                            row.model && !baseModelChoices.some((item) => item.slug === row.model)
                              ? [{ slug: row.model, label: row.model }, ...baseModelChoices]
                              : baseModelChoices;
                          const effectiveModel = row.model || rowChoices[0]?.slug || "";
                          const decTestId =
                            rowIndex === 0
                              ? `composer-collab-dec-${entry.instanceId}`
                              : `composer-collab-dec-${entry.instanceId}-${rowIndex}`;
                          const countTestId =
                            rowIndex === 0
                              ? `composer-collab-count-${entry.instanceId}`
                              : `composer-collab-count-${entry.instanceId}-${rowIndex}`;
                          const incTestId =
                            rowIndex === 0
                              ? `composer-collab-inc-${entry.instanceId}`
                              : `composer-collab-inc-${entry.instanceId}-${rowIndex}`;

                          return (
                            <div
                              key={rowId}
                              data-testid={`composer-collab-model-row-${entry.instanceId}-${rowIndex}`}
                              data-pmx-collab-model-row={rowId}
                              className="flex items-center gap-1.5"
                            >
                              <CollaboratorModelSelect
                                instanceId={entry.instanceId}
                                displayName={entry.displayName}
                                rowId={rowId}
                                rowIndex={rowIndex}
                                value={effectiveModel}
                                choices={rowChoices}
                                onChange={(nextModel) =>
                                  onChangeSelections(
                                    setCollaboratorModel(activeSelections, rowId, nextModel),
                                  )
                                }
                              />

                              <div
                                className="inline-flex h-7 shrink-0 items-center rounded-md border border-border/75 bg-background/85 px-0.5 sm:h-6 dark:bg-background/65"
                                role="group"
                                aria-label={
                                  rowIndex === 0
                                    ? `${entry.displayName} 协作数量`
                                    : `${entry.displayName} 模型类别 ${rowIndex + 1} 协作数量`
                                }
                              >
                                <button
                                  type="button"
                                  data-testid={decTestId}
                                  aria-label={`减少 ${entry.displayName} 数量`}
                                  disabled={row.maxCount <= MIN_COLLABORATOR_COUNT}
                                  onClick={() =>
                                    onChangeSelections(
                                      stepCollaboratorCount(activeSelections, rowId, -1),
                                    )
                                  }
                                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded text-foreground/80 transition-colors hover:bg-foreground/[0.08] disabled:cursor-not-allowed disabled:opacity-35 dark:hover:bg-white/10"
                                >
                                  <MinusIcon className="size-2.5" aria-hidden="true" />
                                </button>
                                <span
                                  data-testid={countTestId}
                                  className="min-w-[18px] text-center text-2xs font-semibold tabular-nums text-foreground"
                                >
                                  {row.maxCount}
                                </span>
                                <button
                                  type="button"
                                  data-testid={incTestId}
                                  aria-label={`增加 ${entry.displayName} 数量`}
                                  disabled={providerRemaining <= 0}
                                  onClick={() =>
                                    onChangeSelections(
                                      stepCollaboratorCount(activeSelections, rowId, 1),
                                    )
                                  }
                                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded text-foreground/80 transition-colors hover:bg-foreground/[0.08] disabled:cursor-not-allowed disabled:opacity-35 dark:hover:bg-white/10"
                                >
                                  <PlusIcon className="size-2.5" aria-hidden="true" />
                                </button>
                              </div>

                              {providerRows.length >= 2 ? (
                                <button
                                  type="button"
                                  data-testid={`composer-collab-remove-row-${entry.instanceId}-${rowIndex}`}
                                  aria-label={`移除 ${entry.displayName} 模型类别 ${rowIndex + 1}`}
                                  onClick={() =>
                                    onChangeSelections(
                                      removeCollaboratorSelection(activeSelections, rowId),
                                    )
                                  }
                                  className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground dark:hover:bg-white/12"
                                >
                                  <XIcon className="size-3" aria-hidden="true" />
                                </button>
                              ) : null}
                            </div>
                          );
                        })}

                        <button
                          type="button"
                          data-testid={`composer-collab-add-model-${entry.instanceId}`}
                          disabled={addModelDisabled}
                          aria-label={
                            addModelDisabledReason ?? `为 ${entry.displayName} 添加模型类别`
                          }
                          style={addModelDisabled ? undefined : ADD_MODEL_ROW_BUTTON_STYLE}
                          onClick={() => handleAddModelRow(entry)}
                          className={cn(
                            "inline-flex h-6 w-full items-center justify-center gap-1 rounded-md border border-dashed px-2 text-2xs font-medium outline-none transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-foreground/30",
                            addModelDisabled
                              ? "cursor-not-allowed border-border/55 bg-foreground/[0.02] text-muted-foreground/65 dark:bg-white/[0.02]"
                              : "cursor-pointer bg-background/55 hover:bg-background/85 dark:bg-background/40 dark:hover:bg-background/65",
                          )}
                        >
                          <PlusIcon className="size-3 shrink-0" aria-hidden="true" />
                          <span>
                            {providerUsed >= MAX_COLLABORATOR_COUNT_PER_AGENT
                              ? `已达单代理上限（${providerUsed}/${MAX_COLLABORATOR_COUNT_PER_AGENT}）`
                              : remainingCapacity <= 0
                                ? `已达总协作上限（${totalCount}/${MAX_TOTAL_COLLABORATOR_COUNT}）`
                                : "添加模型类别"}
                          </span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>

          {/* Compact footer */}
          <div className="border-t border-border/60 px-3 py-1.5 text-2xs leading-snug text-muted-foreground">
            {isActive
              ? activeSelections.length > selectedInstanceOrder.length
                ? `已选 ${selectedInstanceOrder.length} 个代理 · ${activeSelections.length} 组模型（最多委派 ${totalCount} 次）`
                : `已选 ${selectedInstanceOrder.length} 个代理（最多委派 ${totalCount} 次）· 仅本会话生效`
              : "未选时零 Token 注入；选中后主代理仅在有益时按需委派。"}
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

export interface ComposerCollaboratorsPopoverProps {
  readonly draftTarget: ComposerThreadTarget;
  readonly providerInstanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<AppModelOption>>;
  readonly disabled?: boolean | undefined;
  readonly className?: string | undefined;
}

export function ComposerCollaboratorsPopover({
  draftTarget,
  providerInstanceEntries,
  modelOptionsByInstance,
  disabled = false,
  className,
}: ComposerCollaboratorsPopoverProps) {
  const navigate = useNavigate();
  const selections = useComposerDraftCollaborators(draftTarget);
  const setCollaborators = useComposerDraftStore((store) => store.setCollaborators);
  const waiver = useSubscriptionWaiverState();
  const [open, setOpen] = useState(false);
  const [probes, setProbes] = useState<ReadonlyArray<CollaboratorProviderProbeLike>>(() =>
    getCachedProviderProbes(),
  );

  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- refreshes live provider auth-mode probes from local daemon when opening the collaborators picker
  useEffect(() => {
    if (!open) return;
    let active = true;
    void prismuxDaemonClient
      .getProviderProbes()
      .then((response) => {
        if (!active || !Array.isArray(response?.providers)) return;
        setCachedProviderProbes(response.providers);
        setProbes(response.providers);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [open]);

  return (
    <ComposerCollaboratorsPopoverView
      providerInstanceEntries={providerInstanceEntries}
      modelOptionsByInstance={modelOptionsByInstance}
      selections={selections}
      probes={probes}
      waiver={waiver}
      disabled={disabled}
      open={open}
      onOpenChange={setOpen}
      onChangeSelections={(next) => setCollaborators(draftTarget, next)}
      onOpenWaiverSettings={() => {
        void navigate({
          to: "/settings/providers",
          hash: SUBSCRIPTION_WAIVER_ANCHOR_ID,
        });
      }}
      className={className}
    />
  );
}
