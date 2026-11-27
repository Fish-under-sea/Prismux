import type {
  ModelSelection,
  ProjectId,
  ReasoningEffortLevel,
  ServerProvider,
  ServerSettingsPatch,
} from "@prismux/core-contracts";
import type { UnifiedSettings } from "@prismux/core-contracts/settings";
import { msg } from "gt-react";

import {
  resolveEffectiveDefaultModelSelection,
  stripReasoningEffortFromSelection,
} from "../../modelSelection";
import {
  resolveDefaultProviderModelSelection,
  resolveProjectDefaultProviderModelSelection,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import { m, type MessageResolver } from "../../i18n/messages";
import type { ScopedSettingSource } from "./scopedSettings";

export interface DefaultModelSettingsPresentation {
  readonly selection: ModelSelection | null;
  /** Set when the saved model's provider cannot run; effort stays hidden until it can. */
  readonly providerNote: string | null;
}

export function buildDefaultReasoningEffortUpdatePatch(input: {
  readonly nextEffort: ReasoningEffortLevel;
  readonly isProjectScope: boolean;
  readonly modelSource: ScopedSettingSource;
  readonly mixedModel: boolean;
  readonly mixedFallback: boolean;
  readonly defaultModelSelection: ModelSelection | null;
  readonly fallbackModelSelection: ModelSelection | null;
  readonly providers: ReadonlyArray<ServerProvider>;
}): ServerSettingsPatch {
  const patch: {
    defaultReasoningEffort: ReasoningEffortLevel;
    defaultModelSelection?: ModelSelection;
    fallbackModelSelection?: ModelSelection;
  } = {
    defaultReasoningEffort: input.nextEffort,
  };

  if (
    !input.mixedModel &&
    input.defaultModelSelection !== null &&
    (!input.isProjectScope || input.modelSource === "project")
  ) {
    const strippedDefault = stripReasoningEffortFromSelection(
      input.defaultModelSelection,
      input.providers,
    );
    if (strippedDefault !== input.defaultModelSelection) {
      patch.defaultModelSelection = strippedDefault;
    }
  }

  if (!input.isProjectScope && !input.mixedFallback && input.fallbackModelSelection !== null) {
    const strippedFallback = stripReasoningEffortFromSelection(
      input.fallbackModelSelection,
      input.providers,
    );
    if (strippedFallback !== input.fallbackModelSelection) {
      patch.fallbackModelSelection = strippedFallback;
    }
  }

  return patch;
}

export function resolveDefaultModelSettingsPresentation(
  input: {
    readonly entries: ReadonlyArray<ProviderInstanceEntry>;
    readonly providers: ReadonlyArray<ServerProvider>;
    readonly settings: UnifiedSettings;
    readonly projectId: ProjectId | null;
    readonly inheritDefaultModelFromEnvironment?: boolean;
    readonly projectOverridesDefaultReasoningEffort?: boolean;
  },
  resolve: MessageResolver = m,
): DefaultModelSettingsPresentation {
  const saved = input.settings.defaultModelSelection;
  if (saved === null) {
    const automatic = resolveProjectDefaultProviderModelSelection(
      input.providers,
      input.settings,
      input.projectId,
    );
    return {
      selection: automatic
        ? resolveEffectiveDefaultModelSelection(input.settings, input.providers, automatic)
        : null,
      providerNote: null,
    };
  }

  const savedEntry = input.entries.find((entry) => entry.instanceId === saved.instanceId);
  const resolved = resolveDefaultProviderModelSelection(input.providers, saved);
  // Settings can turn a provider off before the server snapshot catches up, so check both.
  if (
    !savedEntry?.enabled ||
    !savedEntry.isAvailable ||
    resolved?.instanceId !== saved.instanceId
  ) {
    return { selection: saved, providerNote: providerNote(savedEntry, resolve) };
  }
  const baseSelection =
    input.projectOverridesDefaultReasoningEffort === true &&
    input.inheritDefaultModelFromEnvironment === true
      ? stripReasoningEffortFromSelection(resolved, input.providers)
      : resolved;
  return {
    selection: resolveEffectiveDefaultModelSelection(
      input.settings,
      input.providers,
      baseSelection,
    ),
    providerNote: null,
  };
}

function providerNote(entry: ProviderInstanceEntry | undefined, resolve: MessageResolver): string {
  if (!entry) return resolve(msg("This provider is not available on this environment."));
  if (!entry.enabled)
    return resolve(msg("{provider} is turned off.", { provider: entry.displayName }));
  return resolve(msg("{provider} is unavailable.", { provider: entry.displayName }));
}
