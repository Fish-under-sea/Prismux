import { managedRuntimeModeDenial } from "@prismux/client-runtime/contract-labels";
import {
  DEFAULT_REASONING_EFFORT_LEVELS,
  DEFAULT_SERVER_SETTINGS,
  type ModelSelection,
  type ReasoningEffortLevel,
  type WorktreeSubmodules,
} from "@prismux/core-contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@prismux/core-contracts/settings";
import { createModelSelection, pickModelSelection } from "@prismux/core-shared/model";
import { resolvePastedPath } from "@prismux/core-shared/path";
import { resolveProjectSettings } from "@prismux/core-shared/projectSettings";
import { GaugeIcon } from "lucide-react";
import { type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { T, useGT, useMessages } from "gt-react";

import { useClientSettings } from "../../hooks/useSettings";
import {
  applyDefaultReasoningEffortToSelection,
  defaultModelSelectionsAreMixed,
  getCustomModelOptionsByInstance,
} from "../../modelSelection";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { useEnvironmentProviders, useEnvironments } from "../../state/environments";
import { firstManagedDenial } from "../../state/managedPolicy";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { resolveEnvModeLabel, WORKTREE_SUBMODULES_LABELS } from "../BranchToolbar.logic";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { runtimeModeConfig, runtimeModeOptions } from "../chat/runtimeModeConfig";
import { PULL_REQUEST_MERGE_METHOD_LABELS } from "../pullRequest/pullRequestDetail.logic";
import { TraitsPicker } from "../chat/TraitsPicker";
import { DraftInput } from "../ui/draft-input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { Switch } from "../ui/switch";
import { AdvancedSettings } from "./AdvancedSettings";
import { resolveDefaultModelSettingsPresentation } from "./ProjectDefaultsSettings.logic";
import type { ProjectSettingsCategory } from "./ProjectSettingsPanel";
import { ScopedSwitch } from "./ScopedSwitch";
import { useSearchableSetting } from "./settingsSearch";
import { useOptionalSettingsScope, useSettingsScope } from "./SettingsScopeContext";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useScopedSettingSource,
  useUpdateScopedSettings,
} from "./useScopedSettings";

const WORKTREE_SUBMODULES_OPTIONS = ["recursive", "top-level", "none"] as const;
function isWorktreeSubmodules(value: string | null): value is WorktreeSubmodules {
  return value !== null && (WORKTREE_SUBMODULES_OPTIONS as readonly string[]).includes(value);
}

const REASONING_EFFORT_LABELS: Readonly<Record<ReasoningEffortLevel, string>> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  max: "Max",
};

function isReasoningEffortLevel(value: string | null): value is ReasoningEffortLevel {
  return (
    value !== null && (DEFAULT_REASONING_EFFORT_LEVELS as readonly string[]).includes(value)
  );
}

export type ProjectDefaultsSettingsCategory = ProjectSettingsCategory | "models";

export function DefaultChatModelsSection() {
  return useOptionalSettingsScope() === null ? null : <ProjectDefaultsSettings category="models" />;
}

export function ProjectDefaultsSettings({
  category,
  extraRows,
}: {
  readonly category: ProjectDefaultsSettingsCategory;
  readonly extraRows?: ReactNode;
}) {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const m = useMessages();
  const { scope, target, targets, connectedEnvironments } = useSettingsScope();
  const settings = useScopedSettings();
  const clientSettings = useClientSettings();
  const updateSettings = useUpdateScopedSettings();
  const navigate = useNavigate();
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  const representative = target
    ? environments.find((environment) => environment.environmentId === target.environmentId)
    : undefined;
  const providers =
    (representative?.serverConfig
      ? providersByEnvironment.get(representative.environmentId)
      : undefined) ?? EMPTY_SERVER_PROVIDERS;
  const entries = providerInstanceEntriesFor(providers, settings, target?.projectId ?? null);
  const presentation = resolveDefaultModelSettingsPresentation(
    {
      entries,
      providers,
      settings,
      projectId: target?.projectId ?? null,
    },
    m,
  );
  const selection = presentation.selection;
  const modelOptions = getCustomModelOptionsByInstance(
    settings,
    providers,
    selection?.instanceId,
    selection?.model,
  );
  const activeEntry = entries.find((entry) => entry.instanceId === selection?.instanceId);
  const mixedModel = defaultModelSelectionsAreMixed(
    clientSettings,
    targets.map((candidate) => ({
      projectId: candidate.projectId,
      settings: candidate.settings,
      providers: providersByEnvironment.get(candidate.environmentId) ?? EMPTY_SERVER_PROVIDERS,
    })),
  );
  const automaticModel =
    targets.length > 0 &&
    targets.every((candidate) => candidate.settings.defaultModelSelection === null);
  const mixedFallback = useScopedSettingsMixed(["fallbackModelSelection"]);
  const rawFallbackSelection = settings.fallbackModelSelection ?? selection;
  const fallbackSelection = rawFallbackSelection
    ? applyDefaultReasoningEffortToSelection(
        rawFallbackSelection,
        providers,
        settings.defaultReasoningEffort,
      )
    : null;
  const fallbackEntry = entries.find((entry) => entry.instanceId === fallbackSelection?.instanceId);
  const fallbackModelOptions = getCustomModelOptionsByInstance(
    settings,
    providers,
    fallbackSelection?.instanceId,
    fallbackSelection?.model,
  );
  const mixedDefaultReasoningEffort = useScopedSettingsMixed(["defaultReasoningEffort"]);
  const mixedPermissions = useScopedSettingsMixed(["defaultRuntimeMode"]);
  const PermissionIcon = runtimeModeConfig[settings.defaultRuntimeMode].icon;
  const mixedWorkspace = useScopedSettingsMixed(["defaultThreadEnvMode"]);
  const mixedAutoPull = useScopedSettingsMixed(["defaultAutoPull"]);
  const mixedAgentCredits = useScopedSettingsMixed(["removeAgentCreditsOnMerge"]);
  const mixedMergeMethod = useScopedSettingsMixed(["pullRequestMergeMethod"]);
  const modelSource = useScopedSettingSource(["defaultModelSelection"]);
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const unavailable = connectedEnvironments.length === 0;
  const effective = target
    ? resolveProjectSettings(target.settings, null, null, null).settings
    : null;

  const modelDisabledReason = useScopedModelDisabledReason(settings, entries);
  const effortDisabledReason = selection
    ? modelDisabledReason(selection.instanceId, selection.model)
    : null;

  const setModel = (value: ModelSelection | null) => {
    const reason = value ? modelDisabledReason(value.instanceId, value.model) : null;
    if (reason) {
      toastManager.add({
        type: "error",
        title: gt("Default model not saved"),
        description: reason,
      });
      return;
    }
    updateSettings({ defaultModelSelection: value });
  };

  const modelRow = (
    <SettingsRow
      serverScoped
      settingKeys={["defaultModelSelection"]}
      mixed={mixedModel}
      id="default-model"
      title={gt("Model")}
      description={
        isProjectScope
          ? gt("Model for new threads in this project.")
          : !unavailable && modelSource !== "project" && automaticModel
            ? gt("Default model for new threads, selected automatically. Projects can override it.")
            : gt("Default model for new threads. Projects can override it.")
      }
      status={
        mixedModel
          ? automaticModel
            ? gt(
                "Automatic defaults differ. Select one environment or choose a shared model to edit effort.",
              )
            : gt("Defaults differ. Select one environment or choose a shared model to edit effort.")
          : (presentation.providerNote ?? effortDisabledReason)
      }
      resetAction={
        settings.defaultModelSelection !== null ? (
          <SettingResetButton
            ariaLabel={gt("Reset default model to default")}
            onClick={() => setModel(null)}
          />
        ) : null
      }
      control={
        selection ? (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            <ProviderModelPicker
              environmentId={representative?.environmentId ?? null}
              activeInstanceId={selection.instanceId}
              model={selection.model}
              lockedProvider={null}
              instanceEntries={entries}
              modelOptionsByInstance={modelOptions}
              displayFullModelName
              triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
              {...(mixedModel
                ? {
                    triggerLabel: automaticModel
                      ? gt("Automatic (mixed)")
                      : gt("Mixed", { $context: "values differ across targets" }),
                  }
                : {})}
              getModelDisabledReason={modelDisabledReason}
              onOpenProviderSetup={(instanceId) => {
                if (representative)
                  void navigate({
                    to: "/settings/providers",
                    search: { environmentId: representative.environmentId, instanceId },
                  });
              }}
              onInstanceModelChange={(instanceId, model) =>
                setModel(pickModelSelection(mixedModel ? null : selection, instanceId, model))
              }
            />
            {!mixedModel && !presentation.providerNote && !effortDisabledReason && activeEntry ? (
              <TraitsPicker
                provider={activeEntry.driverKind}
                models={activeEntry.models}
                model={selection.model}
                modelOptions={selection.options ?? []}
                allowPromptInjectedEffort={false}
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                onModelOptionsChange={(options) =>
                  setModel(createModelSelection(selection.instanceId, selection.model, options))
                }
              />
            ) : null}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            {mixedModel
              ? gt("Mixed", { $context: "values differ across targets" })
              : gt("No providers available")}
          </span>
        )
      }
    />
  );
  const workspaceRow = (
    <SettingsRow
      serverScoped
      settingKeys={["defaultThreadEnvMode"]}
      mixed={mixedWorkspace}
      id={searchableSetting("new-threads").id}
      title={gt("Workspace")}
      description={
        isProjectScope
          ? gt("Where new threads in this project start.")
          : gt("Where new threads start. Projects and their prismux.json can override it.")
      }
      resetAction={
        !isProjectScope && settings.defaultThreadEnvMode !== null ? (
          <SettingResetButton
            ariaLabel={gt("Reset default workspace to default")}
            onClick={() => updateSettings({ defaultThreadEnvMode: null })}
          />
        ) : null
      }
      control={
        <Select
          value={mixedWorkspace ? null : (effective?.defaultThreadEnvMode ?? null)}
          onValueChange={(value) => {
            if (value === "local" || value === "worktree")
              updateSettings({ defaultThreadEnvMode: value });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-48" aria-label={gt("Default workspace")}>
            <SelectValue>
              {(value: string | null) =>
                value === "local" || value === "worktree"
                  ? resolveEnvModeLabel(value, m)
                  : unavailable
                    ? gt("Unavailable", { $context: "setting value cannot be read" })
                    : gt("Mixed", { $context: "values differ across targets" })
              }
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem value="local">{resolveEnvModeLabel("local", m)}</SelectItem>
            <SelectItem value="worktree">{resolveEnvModeLabel("worktree", m)}</SelectItem>
          </SelectPopup>
        </Select>
      }
    />
  );

  const fallbackRow = !isProjectScope ? (
    <SettingsRow
      serverScoped
      settingKeys={["fallbackModelSelection"]}
      mixed={mixedFallback}
      {...searchableSetting("fallback-model")}
      description={gt("Used for new threads when the default model's provider is out of usage.")}
      resetAction={
        mixedFallback || settings.fallbackModelSelection !== null ? (
          <SettingResetButton
            ariaLabel={gt("Reset fallback model to default")}
            onClick={() => updateSettings({ fallbackModelSelection: null })}
          />
        ) : null
      }
      control={
        fallbackSelection ? (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            <ProviderModelPicker
              environmentId={representative?.environmentId ?? null}
              activeInstanceId={fallbackSelection.instanceId}
              model={fallbackSelection.model}
              lockedProvider={null}
              instanceEntries={entries}
              modelOptionsByInstance={fallbackModelOptions}
              displayFullModelName
              triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
              triggerAriaLabel={gt("Fallback model")}
              {...(mixedFallback
                ? { triggerLabel: gt("Mixed", { $context: "values differ across targets" }) }
                : settings.fallbackModelSelection === null
                  ? { triggerLabel: gt("None", { $context: "no fallback model" }) }
                  : {})}
              getModelDisabledReason={modelDisabledReason}
              onInstanceModelChange={(instanceId, model) => {
                const reason = modelDisabledReason(instanceId, model);
                if (reason) {
                  toastManager.add({
                    type: "error",
                    title: gt("Fallback model not saved"),
                    description: reason,
                  });
                  return;
                }
                updateSettings({
                  fallbackModelSelection: pickModelSelection(
                    mixedFallback ? null : settings.fallbackModelSelection,
                    instanceId,
                    model,
                  ),
                });
              }}
            />
            {settings.fallbackModelSelection !== null && fallbackEntry && !mixedFallback ? (
              <TraitsPicker
                provider={fallbackEntry.driverKind}
                models={fallbackEntry.models}
                model={fallbackSelection.model}
                modelOptions={fallbackSelection.options ?? []}
                allowPromptInjectedEffort={false}
                triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                onModelOptionsChange={(options) =>
                  updateSettings({
                    fallbackModelSelection: createModelSelection(
                      fallbackSelection.instanceId,
                      fallbackSelection.model,
                      options,
                    ),
                  })
                }
              />
            ) : null}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            <T>No providers available</T>
          </span>
        )
      }
    />
  ) : null;

  const defaultReasoningEffortRow = (
    <SettingsRow
      serverScoped
      settingKeys={["defaultReasoningEffort"]}
      mixed={mixedDefaultReasoningEffort}
      {...searchableSetting("default-reasoning-effort")}
      description={
        isProjectScope
          ? gt(
              "Default reasoning effort for models without an explicit override in this project. Automatically maps to each model's closest supported level.",
            )
          : gt(
              "Default reasoning effort for models without an explicit override. Automatically maps to each model's closest supported level.",
            )
      }
      resetAction={
        settings.defaultReasoningEffort !== DEFAULT_SERVER_SETTINGS.defaultReasoningEffort ? (
          <SettingResetButton
            ariaLabel={gt("Reset default reasoning effort to default")}
            onClick={() =>
              updateSettings({
                defaultReasoningEffort: DEFAULT_SERVER_SETTINGS.defaultReasoningEffort,
              })
            }
          />
        ) : null
      }
      control={
        <Select
          value={mixedDefaultReasoningEffort ? null : settings.defaultReasoningEffort}
          onValueChange={(value) => {
            if (isReasoningEffortLevel(value)) {
              updateSettings({ defaultReasoningEffort: value });
            }
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-48"
            aria-label={gt("Default reasoning effort")}
          >
            {!mixedDefaultReasoningEffort ? (
              <GaugeIcon className="size-3.5 shrink-0 text-muted-foreground" />
            ) : null}
            <SelectValue>
              {(value: string | null) =>
                isReasoningEffortLevel(value)
                  ? REASONING_EFFORT_LABELS[value]
                  : unavailable
                    ? gt("Unavailable", { $context: "setting value cannot be read" })
                    : gt("Mixed", { $context: "values differ across targets" })
              }
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {DEFAULT_REASONING_EFFORT_LEVELS.map((level) => (
              <SelectItem hideIndicator key={level} value={level}>
                {REASONING_EFFORT_LABELS[level]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );

  return (
    <SettingsSection
      id={
        category === "source-control"
          ? "source-control-defaults"
          : category === "models"
            ? "default-chat-models"
            : "project-defaults"
      }
      title={
        category === "source-control"
          ? gt("Repositories")
          : category === "models"
            ? gt("Default chat models")
            : category === "general"
              ? gt("New thread defaults")
              : gt("New threads")
      }
    >
      {category === "models" ? (
        <>
          {modelRow}
          {fallbackRow}
          {defaultReasoningEffortRow}
        </>
      ) : category === "project" ? (
        <>
          {modelRow}
          {fallbackRow}
          {defaultReasoningEffortRow}
          {workspaceRow}
        </>
      ) : category === "general" ? (
        <>
          <SettingsRow
            serverScoped
            settingKeys={["defaultRuntimeMode"]}
            mixed={mixedPermissions}
            {...searchableSetting("default-permissions")}
            description={
              isProjectScope
                ? gt("Permissions for new threads in this project.")
                : gt("Default permissions for new threads. Projects can override them.")
            }
            resetAction={
              settings.defaultRuntimeMode !== DEFAULT_SERVER_SETTINGS.defaultRuntimeMode ? (
                <SettingResetButton
                  ariaLabel={gt("Reset default permissions to default")}
                  onClick={() =>
                    updateSettings({
                      defaultRuntimeMode: DEFAULT_SERVER_SETTINGS.defaultRuntimeMode,
                    })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={mixedPermissions ? null : settings.defaultRuntimeMode}
                onValueChange={(value) => {
                  if (value) updateSettings({ defaultRuntimeMode: value });
                }}
              >
                <SelectTrigger size="sm" className="w-full sm:w-48" aria-label={gt("Default permissions")}>
                  {!mixedPermissions && (
                    <PermissionIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <SelectValue>
                    {mixedPermissions
                      ? gt("Mixed", { $context: "values differ across targets" })
                      : m(runtimeModeConfig[settings.defaultRuntimeMode].label)}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {runtimeModeOptions.map((mode) => {
                    const option = runtimeModeConfig[mode];
                    const Icon = option.icon;
                    const managedReason = firstManagedDenial(
                      connectedEnvironments.map(
                        (environment) => environment.serverConfig?.managedPolicy,
                      ),
                      (policy) => managedRuntimeModeDenial(policy, mode, m),
                    );
                    return (
                      <SelectItem
                        key={mode}
                        value={mode}
                        disabled={managedReason !== undefined}
                        className="min-w-64"
                      >
                        <div className="grid gap-0.5">
                          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                            {m(option.label)}
                          </span>
                          <span className="text-[11.5px] font-normal leading-[1.45] text-muted-foreground">
                            {managedReason ?? m(option.description)}
                          </span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectPopup>
              </Select>
            }
          />
          {workspaceRow}
          {extraRows}
        </>
      ) : (
        <>
          <SettingsRow
            serverScoped
            settingKeys={["defaultAutoPull"]}
            mixed={mixedAutoPull}
            id="automatic-pull"
            title={gt("Automatically pull")}
            description={
              isProjectScope
                ? gt(
                    "Keeps this project's default branch current when the checkout has no local changes or commits.",
                  )
                : gt(
                    "Keeps the default branch current when the checkout has no local changes or commits. Projects can override it.",
                  )
            }
            resetAction={
              settings.defaultAutoPull ? (
                <SettingResetButton
                  ariaLabel={gt("Reset default automatic pull to default")}
                  tooltip={gt("Reset automatic pull to off")}
                  onClick={() => updateSettings({ defaultAutoPull: false })}
                />
              ) : null
            }
            control={
              <Switch
                aria-label={gt("Default automatic pull")}
                mixed={mixedAutoPull}
                checked={mixedAutoPull ? false : settings.defaultAutoPull}
                onCheckedChange={(enabled) => updateSettings({ defaultAutoPull: enabled })}
              />
            }
          />
          <SettingsRow
            serverScoped
            settingKeys={["removeAgentCreditsOnMerge"]}
            mixed={mixedAgentCredits}
            {...searchableSetting("remove-agent-credits-on-merge")}
            description={gt(
              "Remove recognized agent credit lines from merge and squash messages on hosts that support it, keeping human co-authors. Includes auto-merge. Excludes merge queues, stack merges, and existing commits.",
            )}
            resetAction={
              settings.removeAgentCreditsOnMerge ? (
                <SettingResetButton
                  ariaLabel={gt("Reset agent credit removal to default")}
                  tooltip={gt("Keep agent credits")}
                  onClick={() => updateSettings({ removeAgentCreditsOnMerge: false })}
                />
              ) : null
            }
            control={
              <Switch
                aria-label={gt("Remove agent credits when merging")}
                mixed={mixedAgentCredits}
                checked={mixedAgentCredits ? false : settings.removeAgentCreditsOnMerge}
                onCheckedChange={(enabled) =>
                  updateSettings({ removeAgentCreditsOnMerge: enabled })
                }
              />
            }
          />
          <SettingsRow
            serverScoped
            settingKeys={["pullRequestMergeMethod"]}
            mixed={mixedMergeMethod}
            {...searchableSetting("pull-request-merge-method")}
            description={
              isProjectScope
                ? gt("Pull requests in this project start with this method.")
                : gt(
                    "Pull requests start with this method. Last selected reuses whatever you chose most recently on this device.",
                  )
            }
            resetAction={
              settings.pullRequestMergeMethod !== null ? (
                <SettingResetButton
                  ariaLabel={gt("Reset default merge method to default")}
                  tooltip={gt("Reset to last selected")}
                  onClick={() => updateSettings({ pullRequestMergeMethod: null })}
                />
              ) : null
            }
            control={
              <Select
                value={mixedMergeMethod ? null : (settings.pullRequestMergeMethod ?? "last")}
                onValueChange={(value) => {
                  if (value === "last") updateSettings({ pullRequestMergeMethod: null });
                  else if (value === "merge" || value === "squash" || value === "rebase")
                    updateSettings({ pullRequestMergeMethod: value });
                }}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-48"
                  aria-label={gt("Default pull request merge method")}
                >
                  <SelectValue>
                    {(value: string | null) =>
                      value === "merge" || value === "squash" || value === "rebase"
                        ? m(PULL_REQUEST_MERGE_METHOD_LABELS[value])
                        : value === "last"
                          ? gt("Last selected")
                          : gt("Mixed", { $context: "values differ across targets" })
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="last">
                    <T>Last selected</T>
                  </SelectItem>
                  <SelectItem value="merge">{m(PULL_REQUEST_MERGE_METHOD_LABELS.merge)}</SelectItem>
                  <SelectItem value="squash">
                    {m(PULL_REQUEST_MERGE_METHOD_LABELS.squash)}
                  </SelectItem>
                  <SelectItem value="rebase">
                    {m(PULL_REQUEST_MERGE_METHOD_LABELS.rebase)}
                  </SelectItem>
                </SelectPopup>
              </Select>
            }
          />
        </>
      )}
    </SettingsSection>
  );
}

export function WorktreeSubmodulesRow() {
  const searchableSetting = useSearchableSetting();
  const { scope, target, connectedEnvironments } = useSettingsScope();
  const gt = useGT();
  const m = useMessages();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixedSubmodules = useScopedSettingsMixed(["worktreeSubmodules"]);
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const unavailable = connectedEnvironments.length === 0;
  const effective = target
    ? resolveProjectSettings(target.settings, null, null, null).settings
    : null;

  return (
    <SettingsRow
      serverScoped
      settingKeys={["worktreeSubmodules"]}
      mixed={mixedSubmodules}
      {...searchableSetting("worktree-submodules")}
      description={
        isProjectScope
          ? gt("How new worktrees in this project populate git submodules.")
          : gt(
              "How new worktrees populate git submodules. Projects and their prismux.json can override it.",
            )
      }
      resetAction={
        !isProjectScope && settings.worktreeSubmodules !== null ? (
          <SettingResetButton
            ariaLabel={gt("Reset worktree submodules to default")}
            onClick={() => updateSettings({ worktreeSubmodules: null })}
          />
        ) : null
      }
      control={
        <Select
          value={mixedSubmodules ? null : (effective?.worktreeSubmodules ?? null)}
          onValueChange={(value) => {
            if (isWorktreeSubmodules(value)) updateSettings({ worktreeSubmodules: value });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-48" aria-label={gt("Worktree submodules")}>
            <SelectValue>
              {(value: string | null) =>
                isWorktreeSubmodules(value)
                  ? m(WORKTREE_SUBMODULES_LABELS[value])
                  : unavailable
                    ? gt("Unavailable", { $context: "setting value cannot be read" })
                    : gt("Mixed", { $context: "values differ across targets" })
              }
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {WORKTREE_SUBMODULES_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {m(WORKTREE_SUBMODULES_LABELS[option])}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

/**
 * Environment-wide defaults for adding or cloning new projects.
 * Relocated from `/settings/chat` to the top of `/settings/projects`.
 */
export function NewProjectsSettingsSection() {
  const setting = useSearchableSetting();
  const gt = useGT();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixedAddProjectBaseDirectory = useScopedSettingsMixed(["addProjectBaseDirectory"]);

  return (
    <SettingsSection id="new-projects" title={gt("New projects")}>
      <SettingsRow
        serverScoped
        settingKeys={["addProjectBaseDirectory"]}
        {...setting("add-project-starts-in")}
        description={gt('Leave empty to use "~/" when the Add Project browser opens.')}
        resetAction={
          settings.addProjectBaseDirectory !==
          DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory ? (
            <SettingResetButton
              ariaLabel={gt("Reset add project base directory to default")}
              onClick={() =>
                updateSettings({
                  addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
                })
              }
            />
          ) : null
        }
        control={
          <DraftInput
            size="sm"
            className="w-full sm:w-60"
            value={mixedAddProjectBaseDirectory ? "" : settings.addProjectBaseDirectory}
            onCommit={(next) => updateSettings({ addProjectBaseDirectory: next })}
            normalizeDraft={resolvePastedPath}
            placeholder={mixedAddProjectBaseDirectory ? gt("Mixed") : "~/"}
            spellCheck={false}
            aria-label={gt("Add project base directory")}
          />
        }
      />
      <AdvancedSettings targetIds={[setting("ghq-clone-layout").id]}>
        <SettingsRow
          serverScoped
          settingKeys={["ghqCloneLayout"]}
          {...setting("ghq-clone-layout")}
          description={gt("Clones go to github.com/owner/repo under the folder above, like ghq.")}
          resetAction={
            settings.ghqCloneLayout !== DEFAULT_UNIFIED_SETTINGS.ghqCloneLayout ? (
              <SettingResetButton
                ariaLabel={gt("Reset clone into host folders to default")}
                onClick={() =>
                  updateSettings({ ghqCloneLayout: DEFAULT_UNIFIED_SETTINGS.ghqCloneLayout })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["ghqCloneLayout"]}
              checked={settings.ghqCloneLayout}
              onCheckedChange={(checked) => updateSettings({ ghqCloneLayout: Boolean(checked) })}
              aria-label={gt("Clone into host folders")}
            />
          }
        />
      </AdvancedSettings>
    </SettingsSection>
  );
}
