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
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  evaluateCollaboratorGovernance,
  getCachedProviderProbes,
  getRemainingCollaboratorCapacity,
  getTotalCollaboratorCount,
  MAX_COLLABORATOR_COUNT_PER_AGENT,
  MAX_TOTAL_COLLABORATOR_COUNT,
  MIN_COLLABORATOR_COUNT,
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
  color: "var(--primary-foreground, #ffffff)",
};

const IDLE_TRIGGER_CLASS =
  "inline-flex h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-transparent px-2 text-xs font-medium text-foreground/78 transition-colors outline-none hover:bg-foreground/[0.06] hover:text-foreground data-popup-open:bg-foreground/[0.08] data-popup-open:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-foreground/25 dark:text-foreground/76 dark:hover:bg-white/10 dark:data-popup-open:bg-white/12 dark:hover:text-foreground";

const ACTIVE_TRIGGER_CLASS =
  "inline-flex h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2 text-xs font-medium transition-colors outline-none hover:brightness-105 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-foreground/30";

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

  // Only surface unlocked selections in active counts and icon stacks so revoked waivers stay fail-closed.
  const activeSelections = selections.filter((selection) => {
    const entry = entriesById.get(selection.providerInstanceId);
    if (!entry) return false;
    return !evaluateCollaboratorGovernance({ entry, probes, waiver }).locked;
  });
  const selectionByInstanceId = new Map(
    activeSelections.map((selection) => [selection.providerInstanceId, selection]),
  );

  const totalCount = getTotalCollaboratorCount(activeSelections);
  const remainingCapacity = getRemainingCollaboratorCapacity(activeSelections);
  const isActive = totalCount > 0;
  const stackedEntries = activeSelections.slice(0, 3).flatMap((selection) => {
    const entry = entriesById.get(selection.providerInstanceId);
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
        className="w-[324px] max-w-[calc(100vw-2rem)]"
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
          <div className="max-h-[272px] space-y-1 overflow-y-auto p-1.5">
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
                const selection = selectionByInstanceId.get(entry.instanceId);
                const isSelected = selection !== undefined;
                const atGlobalCap = !isSelected && remainingCapacity <= 0;
                const rawModelOptions = modelOptionsByInstance.get(entry.instanceId) ?? [];
                const modelChoices: Array<{ slug: string; label: string }> =
                  rawModelOptions.length > 0
                    ? rawModelOptions.map((option) => ({
                        slug: option.slug,
                        label: option.name || option.slug,
                      }))
                    : entry.models.map((model) => ({
                        slug: model.slug,
                        label: model.name || model.slug,
                      }));
                if (
                  selection &&
                  selection.model &&
                  !modelChoices.some((choice) => choice.slug === selection.model)
                ) {
                  modelChoices.unshift({ slug: selection.model, label: selection.model });
                }
                const effectiveModel = selection?.model || modelChoices[0]?.slug || "";

                return (
                  <div
                    key={entry.instanceId}
                    data-pmx-collab-row={entry.instanceId}
                    data-pmx-collab-selected={isSelected ? "true" : "false"}
                    data-pmx-collab-locked={governance.locked ? "true" : "false"}
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
                              removeCollaboratorSelection(activeSelections, entry.instanceId),
                            )
                          }
                          className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-foreground/[0.08] hover:text-foreground dark:hover:bg-white/12"
                        >
                          <XIcon className="size-3" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>

                    {isSelected && selection ? (
                      <div className="mt-1.5 flex items-center gap-1.5 pl-5">
                        <select
                          data-testid={`composer-collab-model-${entry.instanceId}`}
                          aria-label={`${entry.displayName} 模型`}
                          value={effectiveModel}
                          onChange={(event) =>
                            onChangeSelections(
                              setCollaboratorModel(
                                activeSelections,
                                entry.instanceId,
                                event.target.value,
                              ),
                            )
                          }
                          className="h-6 min-w-0 flex-1 truncate rounded-md border border-border/75 bg-background/85 px-1.5 text-2xs font-medium text-foreground outline-none transition-colors hover:border-border focus:border-foreground/45 dark:bg-background/70"
                        >
                          {modelChoices.length === 0 ? (
                            <option value="">默认模型</option>
                          ) : (
                            modelChoices.map((choice) => (
                              <option key={choice.slug} value={choice.slug}>
                                {choice.label}
                              </option>
                            ))
                          )}
                        </select>

                        <div
                          className="inline-flex h-6 shrink-0 items-center rounded-md border border-border/75 bg-background/85 px-0.5 dark:bg-background/70"
                          role="group"
                          aria-label={`${entry.displayName} 协作数量`}
                        >
                          <button
                            type="button"
                            data-testid={`composer-collab-dec-${entry.instanceId}`}
                            aria-label={`减少 ${entry.displayName} 数量`}
                            disabled={selection.maxCount <= MIN_COLLABORATOR_COUNT}
                            onClick={() =>
                              onChangeSelections(
                                stepCollaboratorCount(activeSelections, entry.instanceId, -1),
                              )
                            }
                            className="inline-flex size-5 cursor-pointer items-center justify-center rounded text-foreground/80 transition-colors hover:bg-foreground/[0.08] disabled:cursor-not-allowed disabled:opacity-35 dark:hover:bg-white/10"
                          >
                            <MinusIcon className="size-2.5" aria-hidden="true" />
                          </button>
                          <span
                            data-testid={`composer-collab-count-${entry.instanceId}`}
                            className="min-w-[18px] text-center text-2xs font-semibold tabular-nums text-foreground"
                          >
                            {selection.maxCount}
                          </span>
                          <button
                            type="button"
                            data-testid={`composer-collab-inc-${entry.instanceId}`}
                            aria-label={`增加 ${entry.displayName} 数量`}
                            disabled={
                              selection.maxCount >= MAX_COLLABORATOR_COUNT_PER_AGENT ||
                              remainingCapacity <= 0
                            }
                            onClick={() =>
                              onChangeSelections(
                                stepCollaboratorCount(activeSelections, entry.instanceId, 1),
                              )
                            }
                            className="inline-flex size-5 cursor-pointer items-center justify-center rounded text-foreground/80 transition-colors hover:bg-foreground/[0.08] disabled:cursor-not-allowed disabled:opacity-35 dark:hover:bg-white/10"
                          >
                            <PlusIcon className="size-2.5" aria-hidden="true" />
                          </button>
                        </div>
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
              ? `已选 ${activeSelections.length} 个代理（最多委派 ${totalCount} 次）· 仅本会话生效`
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
