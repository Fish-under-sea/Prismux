import type { EnvironmentThreadShell } from "@prismux/client-runtime/state/shell";
import type { UnifiedSettings } from "@prismux/core-contracts";
import { useMessages } from "gt-react";
import type { Dispatch } from "react";
import type { ComposerThreadTarget, DraftSessionState } from "../../composerDraftStore";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useApplyThreadModelPick } from "./useApplyThreadModelPick";
import {
  type EnvironmentId,
  type ModelSelection,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
  type ThreadId,
  RuntimeMode,
} from "@prismux/core-contracts";
import { isReasoningSelect } from "@prismux/client-runtime/model-traits";
import type { deriveThreadStructureRuntime } from "@prismux/client-runtime/state/thread-execution";
import { scopeThreadRef } from "@prismux/client-runtime/environment";
import { type SetStateAction } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toastManager } from "../ui/toast";
import {
  resolveAppModelSelectionForInstance,
  stripReasoningEffortOptions,
} from "../../modelSelection";
import {
  draftModelSelectionApplies,
  resolveNewDraftStartFromOrigin,
  threadHasStarted,
} from "../../lib/chatThreadActions";
import {
  composerTargetKey,
  type DraftThreadEnvMode,
  isSameModel,
  useComposerDraftStore,
} from "../../composerDraftStore";
import { cancelHeldComposerSend } from "./preparingComposerImages";
import {
  getStartedThreadModelChangeBlockReason,
  deriveLockedProvider,
  makeModelDisabledReason,
} from "../ChatView.logic";
import { isBtwSideThread } from "./btwMode";
interface ComposerSelectionInput {
  readonly environmentId: EnvironmentId;
  readonly composerDraftTarget: ComposerThreadTarget;
  readonly draftThread: DraftSessionState | null;
  readonly activeThread: EnvironmentThreadShell | undefined;
  readonly activeRuntime: ReturnType<typeof deriveThreadStructureRuntime>;
  readonly activeProjectSettings: {
    readonly settings: { readonly newWorktreesStartFromOrigin: boolean };
  };
  readonly settings: UnifiedSettings;
  readonly providerStatuses: ReadonlyArray<ServerProvider>;
  readonly lockedProvider: ReturnType<typeof deriveLockedProvider>;
  readonly supportsProviderSwitchingViaHandoff: boolean;
  readonly multipleModelSelections: ReadonlyArray<ModelSelection> | null;
  readonly runtimeMode: RuntimeMode;
  readonly isLocalDraftThread: boolean;
  readonly canOverrideServerThreadEnvMode: boolean;
  readonly setPendingServerThreadEnvModeEntry: Dispatch<
    SetStateAction<{ readonly threadId: ThreadId; readonly mode: DraftThreadEnvMode } | null>
  >;
  readonly setPendingServerThreadStartFromOriginByThreadId: Dispatch<
    SetStateAction<Record<string, boolean>>
  >;
  readonly scheduleComposerFocus: () => void;
}

function filterValidModelOptions(
  options: ReadonlyArray<ProviderOptionSelection> | undefined,
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
): ReadonlyArray<ProviderOptionSelection> | undefined {
  if (!options || options.length === 0) return undefined;
  const byId = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor] as const));
  const valid = options.filter((selection) => {
    const descriptor = byId.get(selection.id);
    if (!descriptor) return false;
    if (descriptor.type === "boolean") return typeof selection.value === "boolean";
    return (
      typeof selection.value === "string" &&
      descriptor.options.some((choice) => choice.id === selection.value)
    );
  });
  return valid.length > 0 ? valid : undefined;
}

/**
 * Resolves options when switching to `targetModel` so stale levels from another model never linger,
 * while unobserved reasoning descriptors can inherit a compatible explicit reasoning selection.
 */
export function resolveModelSwitchOptions(input: {
  readonly targetModel: ServerProviderModel | undefined;
  readonly rememberedOptions: ReadonlyArray<ProviderOptionSelection> | undefined;
  readonly threadOptions: ReadonlyArray<ProviderOptionSelection> | undefined;
  readonly previousOptions: ReadonlyArray<ProviderOptionSelection> | undefined;
  readonly sameInstance: boolean;
  /** Strip stale remembered reasoning effort when switching models in a blank local draft. */
  readonly stripRememberedReasoningEffort?: boolean;
}): ReadonlyArray<ProviderOptionSelection> | undefined {
  const descriptors = input.targetModel?.capabilities?.optionDescriptors;
  const sanitize = (options: ReadonlyArray<ProviderOptionSelection> | undefined) =>
    descriptors !== undefined ? filterValidModelOptions(options, descriptors) : options;

  const candidateRemembered =
    input.stripRememberedReasoningEffort === true
      ? stripReasoningEffortOptions(input.rememberedOptions, input.targetModel?.capabilities)
      : input.rememberedOptions;
  const remembered = sanitize(candidateRemembered);
  if (remembered !== undefined && remembered.length > 0) return remembered;

  const fromThread = sanitize(input.threadOptions);
  if (fromThread !== undefined && fromThread.length > 0) return fromThread;

  if (!input.sameInstance || !descriptors || !input.previousOptions?.length) {
    return undefined;
  }
  const carried = input.previousOptions.filter((selection) => {
    if (typeof selection.value !== "string") return false;
    const descriptor = descriptors.find((candidate) => candidate.id === selection.id);
    return (
      descriptor !== undefined &&
      isReasoningSelect(descriptor) &&
      descriptor.currentValue === undefined &&
      descriptor.options.some((choice) => choice.id === selection.value)
    );
  });
  return carried.length > 0 ? carried : undefined;
}

/**
 * The composer's choices for the next turn: provider and model, runtime mode,
 * and where a new thread runs (local or a new worktree, from the remote's tip or not).
 */
export function useComposerSelection(input: ComposerSelectionInput) {
  const {
    environmentId,
    composerDraftTarget,
    draftThread,
    activeThread,
    activeRuntime,
    activeProjectSettings,
    settings,
    providerStatuses,
    lockedProvider,
    supportsProviderSwitchingViaHandoff,
    multipleModelSelections,
    runtimeMode,
    isLocalDraftThread,
    canOverrideServerThreadEnvMode,
    setPendingServerThreadEnvModeEntry,
    setPendingServerThreadStartFromOriginByThreadId,
    scheduleComposerFocus,
  } = input;
  const messages = useMessages();
  const navigate = useNavigate();
  const setStickyComposerModelSelection = useComposerDraftStore(
    (store) => store.setStickyModelSelection,
  );
  const setComposerDraftModelSelection = useComposerDraftStore((store) => store.setModelSelection);
  const setComposerDraftRuntimeMode = useComposerDraftStore((store) => store.setRuntimeMode);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const applyThreadModelPick = useApplyThreadModelPick();

  const handleRuntimeModeChange = (mode: RuntimeMode) => {
    if (isBtwSideThread(activeThread)) return;
    if (mode === runtimeMode) return;
    cancelHeldComposerSend(composerTargetKey(composerDraftTarget));
    setComposerDraftRuntimeMode(composerDraftTarget, mode);
    if (isLocalDraftThread) {
      setDraftThreadContext(composerDraftTarget, { runtimeMode: mode });
    }
    scheduleComposerFocus();
  };
  const handleRuntimeModeChangeStable = useStableCallback(handleRuntimeModeChange);

  const openProviderSetup = (instanceId: ProviderInstanceId) => {
    void navigate({
      to: "/settings/providers",
      search: { environmentId, instanceId },
    });
  };
  const openProviderSetupStable = useStableCallback(openProviderSetup);

  // Keyed on the fields it reads: the thread and runtime objects change with
  // every streamed event, and a new function re-renders the whole model picker.
  const hasStartedSession = activeRuntime !== null;
  const runtimeProviderInstanceId = activeRuntime?.providerInstanceId ?? null;
  const currentModelSelection = activeThread?.modelSelection ?? null;
  const getModelDisabledReason = makeModelDisabledReason(
    currentModelSelection
      ? {
          hasStartedSession,
          supportsProviderSwitchingViaHandoff,
          currentModelSelection,
          currentProviderInstanceId: runtimeProviderInstanceId,
        }
      : null,
    messages,
  );

  const onProviderModelSelect = (
    instanceId: ProviderInstanceId,
    model: string,
    options?: { focusComposer?: boolean },
  ) => {
    if (!activeThread) return;
    cancelHeldComposerSend(composerTargetKey(composerDraftTarget));
    const entry = providerStatuses.find((snapshot) => snapshot.instanceId === instanceId);
    const resolvedDriverKind = entry?.driver ?? null;
    if (
      !supportsProviderSwitchingViaHandoff &&
      lockedProvider !== null &&
      resolvedDriverKind !== null &&
      resolvedDriverKind !== lockedProvider
    ) {
      if (options?.focusComposer !== false) scheduleComposerFocus();
      return;
    }
    if (
      !supportsProviderSwitchingViaHandoff &&
      lockedProvider !== null &&
      activeRuntime?.providerInstanceId
    ) {
      const currentEntry = providerStatuses.find(
        (snapshot) => snapshot.instanceId === activeRuntime.providerInstanceId,
      );
      if (
        currentEntry?.continuation?.groupKey &&
        entry?.continuation?.groupKey &&
        currentEntry.continuation.groupKey !== entry.continuation.groupKey
      ) {
        if (options?.focusComposer !== false) scheduleComposerFocus();
        return;
      }
    }
    // The picker lists an unavailable model only as the active selection, so re-picking keeps it.
    const resolvedModel = resolveAppModelSelectionForInstance(
      instanceId,
      settings,
      providerStatuses,
      model,
      { preserveUnavailableSelection: true },
    );
    const threadRef = scopeThreadRef(activeThread.environmentId, activeThread.id);
    const storedDraft = useComposerDraftStore.getState().getComposerDraft(threadRef);
    const draft = draftModelSelectionApplies(storedDraft, threadHasStarted(activeThread))
      ? storedDraft
      : null;
    const shownInstanceId =
      draft?.activeProvider ??
      activeRuntime?.providerInstanceId ??
      activeThread.modelSelection.instanceId;
    const shownSelection =
      draft?.modelSelectionByProvider[shownInstanceId] ?? activeThread.modelSelection;
    if (
      !resolvedModel ||
      (instanceId === shownInstanceId &&
        shownSelection.instanceId === instanceId &&
        shownSelection.model === resolvedModel)
    ) {
      // Re-picking the shown model keeps its options and saves it again if that save failed.
      if (resolvedModel && !isLocalDraftThread) applyThreadModelPick(threadRef);
      if (options?.focusComposer !== false) scheduleComposerFocus();
      return;
    }
    const rememberedOptions =
      useComposerDraftStore.getState().stickyOptionsByModelByProvider[instanceId]?.[resolvedModel];
    const threadSelection = activeThread.modelSelection;
    const targetModel = entry?.models.find(
      (candidate) => candidate.slug === resolvedModel || candidate.aliases?.includes(resolvedModel),
    );
    const threadOptionsForModel =
      threadSelection.instanceId === instanceId &&
      entry !== undefined &&
      isSameModel(
        { providers: providerStatuses, selectedProvider: entry.driver, settings },
        threadSelection,
        { instanceId, model: resolvedModel },
      )
        ? threadSelection.options
        : undefined;
    // This pick replaces the stored options, so the thread's own model carries them over,
    // while stale levels from an older catalog are dropped cleanly.
    const pickOptions = resolveModelSwitchOptions({
      targetModel,
      rememberedOptions,
      threadOptions: threadOptionsForModel,
      previousOptions: shownSelection.options,
      sameInstance: shownSelection.instanceId === instanceId,
      stripRememberedReasoningEffort: isLocalDraftThread,
    });
    const nextModelSelection: ModelSelection =
      pickOptions !== undefined && pickOptions.length > 0
        ? { instanceId, model: resolvedModel, options: [...pickOptions] }
        : { instanceId, model: resolvedModel };
    const modelChangeBlockReason = getStartedThreadModelChangeBlockReason({
      hasStartedSession: activeRuntime !== null,
      supportsProviderSwitchingViaHandoff,
      currentModelSelection: activeThread.modelSelection,
      currentProviderInstanceId: activeRuntime?.providerInstanceId ?? null,
      nextModelSelection,
    });
    if (modelChangeBlockReason) {
      toastManager.add({
        type: "warning",
        title: modelChangeBlockReason.title,
        description: modelChangeBlockReason.description,
      });
      if (options?.focusComposer !== false) scheduleComposerFocus();
      return;
    }
    setComposerDraftModelSelection(threadRef, nextModelSelection, {
      explicit: true,
      replaceOptions: true,
    });
    // Switching models inside a BTW side-question tab must NEVER mutate the parent thread
    // or global sticky model selection.
    if (!isBtwSideThread(activeThread)) {
      setStickyComposerModelSelection(nextModelSelection);
    }
    if (!isLocalDraftThread) applyThreadModelPick(threadRef);
    if (options?.focusComposer !== false) scheduleComposerFocus();
  };
  const onProviderModelSelectStable = useStableCallback(onProviderModelSelect);
  const onEnvModeChange = (mode: DraftThreadEnvMode) => {
    if (multipleModelSelections !== null) return;
    cancelHeldComposerSend(composerTargetKey(composerDraftTarget));
    if (canOverrideServerThreadEnvMode) {
      if (activeThread) setPendingServerThreadEnvModeEntry({ threadId: activeThread.id, mode });
      scheduleComposerFocus();
      return;
    }
    if (isLocalDraftThread) {
      setDraftThreadContext(composerDraftTarget, {
        envMode: mode,
        startFromOrigin: resolveNewDraftStartFromOrigin({
          envMode: mode,
          newWorktreesStartFromOrigin: activeProjectSettings.settings.newWorktreesStartFromOrigin,
        }),
        ...(mode === "worktree" && draftThread?.worktreePath ? { worktreePath: null } : {}),
      });
    }
    scheduleComposerFocus();
  };
  const onEnvModeChangeStable = useStableCallback(onEnvModeChange);

  // Reads only the id: the shell changes on every streamed event, and a new handler
  // re-renders the branch toolbar and thread details panel with it.
  const activeThreadId = activeThread?.id;
  const onStartFromOriginChange = (nextStartFromOrigin: boolean) => {
    cancelHeldComposerSend(composerTargetKey(composerDraftTarget));
    if (canOverrideServerThreadEnvMode && activeThreadId !== undefined) {
      setPendingServerThreadStartFromOriginByThreadId((current) =>
        current[activeThreadId] === nextStartFromOrigin
          ? current
          : { ...current, [activeThreadId]: nextStartFromOrigin },
      );
      return;
    }
    if (isLocalDraftThread) {
      setDraftThreadContext(composerDraftTarget, {
        startFromOrigin: nextStartFromOrigin,
      });
    }
  };
  return {
    getModelDisabledReason,
    handleRuntimeModeChangeStable,
    onEnvModeChangeStable,
    onProviderModelSelectStable,
    onStartFromOriginChange,
    openProviderSetupStable,
  };
}
