import type { ModelSelection } from "@prismux/core-contracts";
import {
  DEFAULT_REASONING_TRANSLATION_OFFICIAL_API_SETTINGS,
  DEFAULT_UNIFIED_SETTINGS,
  OfficialTranslationApiVendor,
  ReasoningTranslationLocalModelMirror,
  ReasoningTranslationProvider,
  type ReasoningTranslationOfficialApiSettings,
  type ServerSettingsPatch,
  type UnifiedSettings,
} from "@prismux/core-contracts/settings";
import { createModelSelection, pickModelSelection } from "@prismux/core-shared/model";
import { Link, useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { msg, useGT, useMessages } from "gt-react";
import {
  CheckCircle2Icon,
  DownloadIcon,
  FlaskConicalIcon,
  KeyRoundIcon,
  Loader2Icon,
  SaveIcon,
  Trash2Icon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";

import {
  getTextGenerationModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import {
  AgyWaiverRequiredBadge,
  SUBSCRIPTION_WAIVER_ANCHOR_ID,
  isAntigravityControlledAutomationAllowed,
  resolveAntigravityComplianceBlock,
  useSubscriptionWaiverState,
} from "../../prismux/SubscriptionRiskWaiverSection";
import {
  cancelLocalNmtDownload,
  deleteLocalNmtModel,
  getLocalNmtStatus,
  rememberLastActiveReasoningTranslationProvider,
  resolveReasoningTranslationErrorHint,
  startLocalNmtDownload,
  testReasoningTranslation,
  type ActiveReasoningTranslationProvider,
  type LocalNmtModelStatus,
  type ReasoningTranslationRequestOptions,
  type ReasoningTranslationTestResult,
} from "../../prismux/reasoningTranslation";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { useEnvironmentProviders } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { useTextGenerationTargets } from "../../textGenerators";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { SecretInput } from "./SecretInput";
import { useOptionalSettingsScope, useSettingsScope } from "./SettingsScopeContext";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsRow,
} from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import { useScopedSettings, useUpdateScopedSettings } from "./useScopedSettings";

export const REASONING_TRANSLATION_PROVIDER_LABELS: Readonly<
  Record<ReasoningTranslationProvider, string>
> = {
  off: msg("Off (default, zero outbound)", { $context: "reasoning translation provider" }),
  local_nmt: msg("Local offline NMT (free)", { $context: "reasoning translation provider" }),
  text_model: msg("Configured text model", { $context: "reasoning translation provider" }),
  official_api: msg("Official translation API", { $context: "reasoning translation provider" }),
};

export const LOCAL_NMT_MIRROR_LABELS: Readonly<
  Record<ReasoningTranslationLocalModelMirror, string>
> = {
  hf_mirror: msg("CN accelerated mirror (hf-mirror / jsDelivr)", {
    $context: "reasoning translation local mirror",
  }),
  huggingface: msg("Official source (Hugging Face / Mozilla)", {
    $context: "reasoning translation local mirror",
  }),
};

export const OFFICIAL_API_VENDOR_LABELS: Readonly<Record<OfficialTranslationApiVendor, string>> = {
  deepl: msg("DeepL", { $context: "official translation api vendor" }),
  azure: msg("Azure Translator", { $context: "official translation api vendor" }),
  volcano: msg("Volcano Translate", { $context: "official translation api vendor" }),
  tencent: msg("Tencent Cloud TMT", { $context: "official translation api vendor" }),
  openai_compatible: msg("OpenAI-compatible (Ollama / DeepSeek)", {
    $context: "official translation api vendor",
  }),
};

const isReasoningTranslationProvider = Schema.is(ReasoningTranslationProvider);
const isReasoningTranslationLocalModelMirror = Schema.is(ReasoningTranslationLocalModelMirror);
const isOfficialTranslationApiVendor = Schema.is(OfficialTranslationApiVendor);

const LOCAL_NMT_DEFAULT_PACK_BYTES = 56_995_684;
const LOCAL_NMT_POLL_INTERVAL_MS = 600;

export interface ReasoningTranslationApiClient {
  readonly getLocalNmtStatus: (
    options?: ReasoningTranslationRequestOptions,
  ) => Promise<LocalNmtModelStatus>;
  readonly startLocalNmtDownload: (
    mirror?: ReasoningTranslationLocalModelMirror,
    options?: ReasoningTranslationRequestOptions,
  ) => Promise<LocalNmtModelStatus>;
  readonly cancelLocalNmtDownload: (
    options?: ReasoningTranslationRequestOptions,
  ) => Promise<LocalNmtModelStatus>;
  readonly deleteLocalNmtModel: (
    options?: ReasoningTranslationRequestOptions,
  ) => Promise<LocalNmtModelStatus>;
  readonly testReasoningTranslation: (
    provider: ActiveReasoningTranslationProvider,
    options?: ReasoningTranslationRequestOptions,
  ) => Promise<ReasoningTranslationTestResult>;
}

const DEFAULT_API_CLIENT: ReasoningTranslationApiClient = {
  getLocalNmtStatus,
  startLocalNmtDownload,
  cancelLocalNmtDownload,
  deleteLocalNmtModel,
  testReasoningTranslation: (provider, options) => testReasoningTranslation(provider, options),
};

export interface OfficialApiFormDraft {
  readonly baseKey: string;
  readonly vendor: OfficialTranslationApiVendor;
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly region: string;
  readonly endpoint: string;
  readonly model: string;
  readonly clearApiKey: boolean;
  readonly clearApiSecret: boolean;
}

export function formatModelPackSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "54.4 MB";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  const kb = bytes / 1024;
  return `${Math.max(1, Math.round(kb))} KB`;
}

export function officialApiBaseKey(config: ReasoningTranslationOfficialApiSettings): string {
  return JSON.stringify([
    config.vendor,
    config.apiKey.length > 0,
    config.apiSecret.length > 0,
    config.region,
    config.endpoint,
    config.model,
  ]);
}

export function createOfficialApiDraftFromSaved(
  saved: ReasoningTranslationOfficialApiSettings,
): OfficialApiFormDraft {
  return {
    baseKey: officialApiBaseKey(saved),
    vendor: saved.vendor,
    apiKey: "",
    apiSecret: "",
    region: saved.region,
    endpoint: saved.endpoint,
    model: saved.model,
    clearApiKey: false,
    clearApiSecret: false,
  };
}

export function isOfficialApiDraftDirty(
  saved: ReasoningTranslationOfficialApiSettings,
  draft: OfficialApiFormDraft,
): boolean {
  return (
    draft.vendor !== saved.vendor ||
    draft.region.trim() !== saved.region.trim() ||
    draft.endpoint.trim() !== saved.endpoint.trim() ||
    draft.model.trim() !== saved.model.trim() ||
    draft.apiKey.trim().length > 0 ||
    draft.apiSecret.trim().length > 0 ||
    draft.clearApiKey ||
    draft.clearApiSecret
  );
}

/**
 * Builds the ServerSettingsPatch for `reasoningTranslationOfficialApi`:
 * - Omitted `apiKey` / `apiSecret` retains existing server-redacted secrets (`"••••••"`).
 * - Non-empty draft values replace the stored secret.
 * - Explicit clear flags send `""` to delete the stored secret.
 */
export function buildOfficialApiSettingsPatch(
  draft: OfficialApiFormDraft,
): NonNullable<ServerSettingsPatch["reasoningTranslationOfficialApi"]> {
  const apiKeyTrimmed = draft.apiKey.trim();
  const apiSecretTrimmed = draft.apiSecret.trim();
  return {
    vendor: draft.vendor,
    region: draft.region.trim(),
    endpoint: draft.endpoint.trim(),
    model: draft.model.trim(),
    ...(apiKeyTrimmed.length > 0
      ? { apiKey: apiKeyTrimmed }
      : draft.clearApiKey
        ? { apiKey: "" }
        : {}),
    ...(apiSecretTrimmed.length > 0
      ? { apiSecret: apiSecretTrimmed }
      : draft.clearApiSecret
        ? { apiSecret: "" }
        : {}),
  };
}

export function officialApiVendorFields(vendor: OfficialTranslationApiVendor): {
  readonly showApiSecret: boolean;
  readonly showRegion: boolean;
  readonly showModel: boolean;
  readonly showEndpoint: boolean;
} {
  switch (vendor) {
    case "deepl":
      return { showApiSecret: false, showRegion: false, showModel: false, showEndpoint: true };
    case "azure":
      return { showApiSecret: false, showRegion: true, showModel: false, showEndpoint: true };
    case "volcano":
    case "tencent":
      return { showApiSecret: true, showRegion: true, showModel: false, showEndpoint: true };
    case "openai_compatible":
      return { showApiSecret: false, showRegion: false, showModel: true, showEndpoint: true };
  }
}

type ReasoningTranslationSettingsSlice = Pick<
  UnifiedSettings,
  | "reasoningTranslationProvider"
  | "reasoningTranslationModelSelection"
  | "reasoningTranslationLocalModelMirror"
  | "reasoningTranslationOfficialApi"
  | "textGenerationModelSelection"
>;

interface DedicatedReasoningModelPickerProps {
  readonly settings: UnifiedSettings;
  readonly onSelect: (next: ModelSelection) => void;
}

function DedicatedReasoningModelPicker({ settings, onSelect }: DedicatedReasoningModelPickerProps) {
  const gt = useGT();
  const navigate = useNavigate();
  const { environment, connectedEnvironments } = useSettingsScope();
  const waiver = useSubscriptionWaiverState();
  const allowAntigravityTextGeneration = isAntigravityControlledAutomationAllowed(waiver);
  const openSubscriptionWaiver = () => {
    void navigate({
      to: "/settings/providers",
      hash: SUBSCRIPTION_WAIVER_ANCHOR_ID,
    });
  };
  const getProviderComplianceBlock = (entry: ProviderInstanceEntry) =>
    resolveAntigravityComplianceBlock({
      entry,
      waiver,
      mode: "controlled",
      onOpenWaiver: openSubscriptionWaiver,
    });
  const providersByEnvironment = useEnvironmentProviders();
  const providers =
    (environment?.serverConfig
      ? providersByEnvironment.get(environment.environmentId)
      : undefined) ?? EMPTY_SERVER_PROVIDERS;
  const targets = useTextGenerationTargets({
    environmentId: environment?.environmentId ?? null,
    settings,
    providers: providers.filter((provider) => provider.supportsTextGeneration !== false),
    projectId: null,
    selections: [
      settings.reasoningTranslationModelSelection,
      settings.textGenerationModelSelection,
    ],
  });
  const textGenerationProviders = targets.providers;
  const instanceEntries = targets.entries;
  const hasProvider = instanceEntries.some((entry) => entry.enabled && entry.isAvailable);
  const selection = resolveAppModelSelectionState(
    {
      ...settings,
      textGenerationModelSelection:
        settings.reasoningTranslationModelSelection ?? settings.textGenerationModelSelection,
    },
    textGenerationProviders,
    { allowAntigravityTextGeneration },
  );
  const modelOptionsByInstance = getTextGenerationModelOptionsByInstance(
    settings,
    textGenerationProviders,
    selection.instanceId,
    selection.model,
    { allowAntigravityTextGeneration: true },
  );
  const instanceEntry = instanceEntries.find((entry) => entry.instanceId === selection.instanceId);
  const activeComplianceBlock = instanceEntry ? getProviderComplianceBlock(instanceEntry) : null;
  const modelDisabledReason = useScopedModelDisabledReason(settings, instanceEntries, true);

  const commitModel = (next: ModelSelection) => {
    const targetEntry = instanceEntries.find((entry) => entry.instanceId === next.instanceId);
    const complianceBlock = targetEntry ? getProviderComplianceBlock(targetEntry) : null;
    if (complianceBlock) {
      complianceBlock.onOpenWaiver();
      return;
    }
    const reason = modelDisabledReason(next.instanceId, next.model);
    if (reason) {
      toastManager.add({
        type: "error",
        title: gt("Translation model not saved"),
        description: reason,
      });
      return;
    }
    onSelect(next);
  };

  if (connectedEnvironments.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">{gt("Connect an environment first.")}</span>
    );
  }

  if (!hasProvider || !instanceEntry) {
    return (
      <span className="text-xs text-muted-foreground">
        {gt("No text generation providers available.")}
      </span>
    );
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <ProviderModelPicker
        environmentId={environment?.environmentId ?? null}
        activeInstanceId={selection.instanceId}
        model={selection.model}
        lockedProvider={null}
        instanceEntries={instanceEntries}
        modelOptionsByInstance={modelOptionsByInstance}
        triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
        getModelDisabledReason={modelDisabledReason}
        getProviderComplianceBlock={getProviderComplianceBlock}
        onInstanceModelChange={(instanceId, model) =>
          commitModel(pickModelSelection(selection, instanceId, model))
        }
      />
      {activeComplianceBlock ? (
        <AgyWaiverRequiredBadge
          label={activeComplianceBlock.badgeText}
          title={activeComplianceBlock.tooltip}
          onClick={activeComplianceBlock.onOpenWaiver}
        />
      ) : null}
      <TraitsPicker
        provider={instanceEntry.driverKind}
        models={instanceEntry.models}
        model={selection.model}
        modelOptions={selection.options ?? []}
        allowPromptInjectedEffort={false}
        triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
        onModelOptionsChange={(options) =>
          commitModel(createModelSelection(selection.instanceId, selection.model, options))
        }
      />
    </div>
  );
}

function TranslationTestResultBox({ result }: { readonly result: ReasoningTranslationTestResult }) {
  const gt = useGT();
  const messages = useMessages();
  if (result.ok) {
    return (
      <div
        data-slot="reasoning-translation-test-result"
        data-test-ok="true"
        className="space-y-1.5 rounded-lg border border-success/30 bg-success/8 px-3 py-2.5 text-xs text-foreground"
      >
        <div className="flex flex-wrap items-center gap-2">
          <CheckCircle2Icon
            className="size-3.5 shrink-0 text-success-foreground"
            aria-hidden="true"
          />
          <span className="font-medium text-success-foreground">
            {gt("Sample translation succeeded ({ms} ms)", { ms: result.latencyMs })}
          </span>
          {result.modelKey ? (
            <Badge variant="outline" size="sm">
              {result.modelKey}
            </Badge>
          ) : null}
        </div>
        {result.translatedText ? (
          <p className="text-xs leading-relaxed text-foreground/90">{result.translatedText}</p>
        ) : null}
      </div>
    );
  }

  const hint = resolveReasoningTranslationErrorHint(result.errorCode);
  return (
    <div
      data-slot="reasoning-translation-test-result"
      data-test-ok="false"
      className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2.5 text-xs text-destructive-foreground"
    >
      <div className="flex flex-wrap items-center gap-2 font-medium">
        <XCircleIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{gt("Translation test failed ({ms} ms)", { ms: result.latencyMs })}</span>
      </div>
      <p className="leading-relaxed">{messages(hint.message)}</p>
      {result.error ? <p className="break-words text-2xs opacity-85">{result.error}</p> : null}
    </div>
  );
}

export interface ReasoningTranslationSettingsCardViewProps {
  readonly id?: string | undefined;
  readonly title: ReactNode;
  readonly settings: ReasoningTranslationSettingsSlice;
  readonly onUpdateSettings: (
    patch: Partial<Pick<UnifiedSettings, "reasoningTranslationProvider">> & ServerSettingsPatch,
  ) => void;
  readonly apiClient?: ReasoningTranslationApiClient | undefined;
  readonly initialLocalStatus?: LocalNmtModelStatus | null | undefined;
  readonly initialTestResult?: ReasoningTranslationTestResult | null | undefined;
  readonly dedicatedModelPicker?: ReactNode | undefined;
  readonly textGenerationSettingsLink?: ReactNode | undefined;
  /** Disables automatic mount fetch of local model status (useful for static SSR unit tests). */
  readonly disableInitialStatusFetch?: boolean | undefined;
}

export function ReasoningTranslationSettingsCardView({
  id,
  title,
  settings,
  onUpdateSettings,
  apiClient = DEFAULT_API_CLIENT,
  initialLocalStatus = null,
  initialTestResult = null,
  dedicatedModelPicker,
  textGenerationSettingsLink,
  disableInitialStatusFetch = false,
}: ReasoningTranslationSettingsCardViewProps) {
  const gt = useGT();
  const messages = useMessages();
  const fieldIdPrefix = useId();
  const provider = settings.reasoningTranslationProvider;
  const savedOfficialApi =
    settings.reasoningTranslationOfficialApi ?? DEFAULT_REASONING_TRANSLATION_OFFICIAL_API_SETTINGS;

  const [localStatus, setLocalStatus] = useState<LocalNmtModelStatus | null>(initialLocalStatus);
  const [statusLoading, setStatusLoading] = useState(false);
  const [localActionBusy, setLocalActionBusy] = useState(false);
  const [localActionError, setLocalActionError] = useState<string | null>(null);
  const [testingProvider, setTestingProvider] = useState<ActiveReasoningTranslationProvider | null>(
    null,
  );
  const [testResult, setTestResult] = useState<ReasoningTranslationTestResult | null>(
    initialTestResult,
  );

  const savedBaseKey = officialApiBaseKey(savedOfficialApi);
  const [draftState, setDraftState] = useState<OfficialApiFormDraft | null>(null);
  const activeDraft =
    draftState && draftState.baseKey === savedBaseKey
      ? draftState
      : createOfficialApiDraftFromSaved(savedOfficialApi);
  const officialApiDirty = isOfficialApiDraftDirty(savedOfficialApi, activeDraft);

  const updateDraft = (updater: (current: OfficialApiFormDraft) => OfficialApiFormDraft) => {
    setDraftState((previous) => {
      const base =
        previous && previous.baseKey === savedBaseKey
          ? previous
          : createOfficialApiDraftFromSaved(savedOfficialApi);
      return updater(base);
    });
  };

  // Fetch local offline pack status ONCE when `local_nmt` is selected; ZERO polling when idle.
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- fetches one-shot local NMT filesystem status from the local server when Engine B is active
  useEffect(() => {
    if (provider !== "local_nmt" || disableInitialStatusFetch) return;
    const controller = new AbortController();
    let active = true;
    void apiClient
      .getLocalNmtStatus({ signal: controller.signal })
      .then((next) => {
        if (!active) return;
        setLocalStatus(next);
        setLocalActionError(null);
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) return;
        setLocalActionError(
          error instanceof Error ? error.message : gt("Could not read local model status."),
        );
      })
      .finally(() => {
        if (active) setStatusLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [apiClient, disableInitialStatusFetch, gt, provider]);

  // Poll `/local-model/status` ONLY while an active download is in flight.
  const isDownloading = provider === "local_nmt" && localStatus?.downloading === true;
  // oxlint-disable-next-line prismux/no-unreasoned-state-sync -- polls download progress strictly while `localStatus.downloading === true` and stops immediately once idle
  useEffect(() => {
    if (!isDownloading) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    const poll = async () => {
      try {
        const next = await apiClient.getLocalNmtStatus({ signal: controller.signal });
        if (cancelled) return;
        setLocalStatus(next);
        if (next.downloading && !cancelled) {
          timer = setTimeout(() => {
            void poll();
          }, LOCAL_NMT_POLL_INTERVAL_MS);
        }
      } catch {
        if (!cancelled) {
          timer = setTimeout(() => {
            void poll();
          }, LOCAL_NMT_POLL_INTERVAL_MS * 2);
        }
      }
    };

    timer = setTimeout(() => {
      void poll();
    }, LOCAL_NMT_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [apiClient, isDownloading]);

  const descriptionByProvider = (): string => {
    switch (provider) {
      case "off":
        return gt("Off by default so reasoning stays strictly local with zero outbound requests.");
      case "local_nmt":
        return gt(
          "Runs Mozilla Bergamot locally in WASM with zero outbound requests after model download.",
        );
      case "text_model":
        return gt(
          "Translates reasoning using your selected text generation model (follows subscription risk guard).",
        );
      case "official_api":
        return gt(
          "Translates reasoning through your own official translation API key or local OpenAI-compatible endpoint.",
        );
    }
  };

  const handleProviderChange = (nextValue: string | null) => {
    if (!isReasoningTranslationProvider(nextValue)) return;
    if (nextValue !== "off") {
      rememberLastActiveReasoningTranslationProvider(nextValue);
    }
    setTestResult(null);
    setLocalActionError(null);
    if (nextValue === "local_nmt" && localStatus === null && !disableInitialStatusFetch) {
      setStatusLoading(true);
    }
    onUpdateSettings({ reasoningTranslationProvider: nextValue });
  };

  const handleStartDownload = async () => {
    setLocalActionBusy(true);
    setLocalActionError(null);
    setTestResult(null);
    try {
      const next = await apiClient.startLocalNmtDownload(
        settings.reasoningTranslationLocalModelMirror,
      );
      setLocalStatus(next);
    } catch (error: unknown) {
      setLocalActionError(
        error instanceof Error ? error.message : gt("Failed to start offline model download."),
      );
    } finally {
      setLocalActionBusy(false);
    }
  };

  const handleCancelDownload = async () => {
    setLocalActionBusy(true);
    setLocalActionError(null);
    try {
      const next = await apiClient.cancelLocalNmtDownload();
      setLocalStatus(next);
    } catch (error: unknown) {
      setLocalActionError(
        error instanceof Error ? error.message : gt("Failed to cancel offline model download."),
      );
    } finally {
      setLocalActionBusy(false);
    }
  };

  const handleDeleteModel = async () => {
    setLocalActionBusy(true);
    setLocalActionError(null);
    setTestResult(null);
    try {
      const next = await apiClient.deleteLocalNmtModel();
      setLocalStatus(next);
    } catch (error: unknown) {
      setLocalActionError(
        error instanceof Error ? error.message : gt("Failed to delete local translation model."),
      );
    } finally {
      setLocalActionBusy(false);
    }
  };

  const handleTest = async (targetProvider: ActiveReasoningTranslationProvider) => {
    setTestingProvider(targetProvider);
    setTestResult(null);
    try {
      const result = await apiClient.testReasoningTranslation(targetProvider);
      setTestResult(result);
    } catch (error: unknown) {
      setTestResult({
        ok: false,
        translatedText: null,
        latencyMs: 0,
        provider: targetProvider,
        modelKey: null,
        error: error instanceof Error ? error.message : gt("Translation test request failed."),
        errorCode: "TRANSLATION_FAILED",
      });
    } finally {
      setTestingProvider(null);
    }
  };

  const handleSaveOfficialApi = () => {
    const patch = buildOfficialApiSettingsPatch(activeDraft);
    onUpdateSettings({ reasoningTranslationOfficialApi: patch });
    setDraftState(null);
    toastManager.add({
      type: "success",
      title: gt("Translation API settings saved"),
    });
  };

  const handleClearOfficialSecrets = () => {
    onUpdateSettings({
      reasoningTranslationOfficialApi: {
        apiKey: "",
        apiSecret: "",
      },
    });
    setDraftState(null);
    toastManager.add({
      type: "success",
      title: gt("Translation API keys cleared"),
    });
  };

  const vendorFieldMask = officialApiVendorFields(activeDraft.vendor);
  const apiKeySaved = savedOfficialApi.apiKey.length > 0 && !activeDraft.clearApiKey;
  const apiSecretSaved = savedOfficialApi.apiSecret.length > 0 && !activeDraft.clearApiSecret;
  const hasAnySavedSecret =
    savedOfficialApi.apiKey.length > 0 || savedOfficialApi.apiSecret.length > 0;

  const apiKeyLabel = (): string => {
    switch (activeDraft.vendor) {
      case "deepl":
        return gt("DeepL Auth Key");
      case "azure":
        return gt("Subscription Key");
      case "volcano":
        return gt("AccessKeyId");
      case "tencent":
        return gt("SecretId");
      case "openai_compatible":
        return gt("API Key (optional for localhost)");
    }
  };

  const apiSecretLabel = (): string =>
    activeDraft.vendor === "volcano" ? gt("SecretAccessKey") : gt("SecretKey");

  const endpointPlaceholder = (): string => {
    switch (activeDraft.vendor) {
      case "deepl":
        return "https://api-free.deepl.com/v2/translate";
      case "azure":
        return "https://api.cognitive.microsofttranslator.com";
      case "volcano":
        return "https://translate.volcengineapi.com/";
      case "tencent":
        return "https://tmt.tencentcloudapi.com/";
      case "openai_compatible":
        return "http://127.0.0.1:11434/v1";
    }
  };

  const regionPlaceholder = (): string => {
    switch (activeDraft.vendor) {
      case "azure":
        return "eastasia";
      case "volcano":
        return "cn-north-1";
      case "tencent":
        return "ap-beijing";
      default:
        return "";
    }
  };

  const packSizeLabel = formatModelPackSize(
    localStatus?.sizeBytes || localStatus?.totalBytes || LOCAL_NMT_DEFAULT_PACK_BYTES,
  );
  const progressPercent = Math.max(0, Math.min(100, Math.round(localStatus?.progressPercent ?? 0)));
  const usesDedicatedModel = settings.reasoningTranslationModelSelection !== null;
  const globalModelSummary = `${settings.textGenerationModelSelection.instanceId} / ${settings.textGenerationModelSelection.model}`;

  return (
    <SettingsRow
      id={id}
      title={title}
      description={descriptionByProvider()}
      resetAction={
        provider !== DEFAULT_UNIFIED_SETTINGS.reasoningTranslationProvider ? (
          <SettingResetButton
            ariaLabel={gt("Reset reasoning translation to default")}
            onClick={() => {
              setTestResult(null);
              setLocalActionError(null);
              onUpdateSettings({
                reasoningTranslationProvider: DEFAULT_UNIFIED_SETTINGS.reasoningTranslationProvider,
              });
            }}
          />
        ) : null
      }
      control={
        <Select value={provider} onValueChange={handleProviderChange}>
          <SelectTrigger
            size="sm"
            className="w-full sm:w-56"
            aria-label={gt("Reasoning translation")}
            data-slot="reasoning-translation-engine-select"
          >
            <SelectValue>{messages(REASONING_TRANSLATION_PROVIDER_LABELS[provider])}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {ReasoningTranslationProvider.literals.map((value) => (
              <SelectItem key={value} value={value}>
                {messages(REASONING_TRANSLATION_PROVIDER_LABELS[value])}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    >
      {provider === "local_nmt" ? (
        <div
          data-slot="reasoning-translation-local-nmt-panel"
          className="mt-3 mb-2 space-y-3.5 rounded-lg border border-border/60 bg-muted/25 p-3.5 sm:p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold text-foreground">
                {gt("Local offline translation pack")}
              </div>
              <p className="text-2xs text-muted-foreground">
                {gt(
                  "Mozilla Bergamot EN → ZH-Hans (v2.2, MPL-2.0). Downloaded on demand with SHA-256 verification and runs 100% offline.",
                )}
              </p>
            </div>
            <div data-slot="reasoning-translation-local-status-badge">
              {statusLoading && localStatus === null ? (
                <Badge variant="outline" size="sm">
                  {gt("Checking local files…")}
                </Badge>
              ) : localStatus?.downloading ? (
                <Badge variant="info" size="sm">
                  {gt("Downloading {percent}%", { percent: progressPercent })}
                </Badge>
              ) : localStatus?.installed ? (
                <Badge variant="success" size="sm">
                  {gt("Ready · {size} · Offline zero-outbound", { size: packSizeLabel })}
                </Badge>
              ) : (
                <Badge variant="warning" size="sm">
                  {gt("Not installed")}
                </Badge>
              )}
            </div>
          </div>

          {localStatus?.downloading ? (
            <div className="space-y-1.5" data-slot="reasoning-translation-download-progress">
              <div
                role="progressbar"
                aria-label={gt("Offline translation pack download progress")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPercent}
                className="h-2 w-full overflow-hidden rounded-full bg-muted"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out motion-reduce:transition-none"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-2xs tabular-nums text-muted-foreground">
                <span>
                  {formatModelPackSize(localStatus.downloadedBytes)} /{" "}
                  {formatModelPackSize(localStatus.totalBytes || LOCAL_NMT_DEFAULT_PACK_BYTES)}
                </span>
                <span>{progressPercent}%</span>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Label htmlFor={`${fieldIdPrefix}-mirror`}>{gt("Download mirror")}</Label>
            <Select
              value={settings.reasoningTranslationLocalModelMirror}
              disabled={localStatus?.downloading === true || localActionBusy}
              onValueChange={(value) => {
                if (isReasoningTranslationLocalModelMirror(value)) {
                  onUpdateSettings({ reasoningTranslationLocalModelMirror: value });
                }
              }}
            >
              <SelectTrigger
                id={`${fieldIdPrefix}-mirror`}
                size="sm"
                className="w-full sm:w-64"
                aria-label={gt("Download mirror")}
              >
                <SelectValue>
                  {messages(LOCAL_NMT_MIRROR_LABELS[settings.reasoningTranslationLocalModelMirror])}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {ReasoningTranslationLocalModelMirror.literals.map((mirrorValue) => (
                  <SelectItem key={mirrorValue} value={mirrorValue}>
                    {messages(LOCAL_NMT_MIRROR_LABELS[mirrorValue])}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {localStatus?.downloading ? (
              <Button
                size="sm"
                variant="outline"
                disabled={localActionBusy}
                onClick={() => void handleCancelDownload()}
                data-slot="reasoning-translation-cancel-download"
              >
                <XIcon aria-hidden="true" />
                {gt("Cancel")}
              </Button>
            ) : localStatus?.installed ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={testingProvider !== null || localActionBusy}
                  onClick={() => void handleTest("local_nmt")}
                  data-slot="reasoning-translation-test-local"
                >
                  {testingProvider === "local_nmt" ? (
                    <Loader2Icon
                      className="animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                  ) : (
                    <FlaskConicalIcon aria-hidden="true" />
                  )}
                  {gt("Test local translation")}
                </Button>
                <Button
                  size="sm"
                  variant="destructive-outline"
                  disabled={localActionBusy || testingProvider !== null}
                  onClick={() => void handleDeleteModel()}
                  data-slot="reasoning-translation-delete-local"
                >
                  <Trash2Icon aria-hidden="true" />
                  {gt("Delete local model")}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                disabled={localActionBusy}
                onClick={() => void handleStartDownload()}
                data-slot="reasoning-translation-download-local"
              >
                {localActionBusy ? (
                  <Loader2Icon
                    className="animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : (
                  <DownloadIcon aria-hidden="true" />
                )}
                {gt("Download offline translation pack")}
              </Button>
            )}
          </div>

          {localActionError || localStatus?.error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2 text-xs text-destructive-foreground">
              {localActionError ?? localStatus?.error}
            </div>
          ) : null}

          {testResult && testResult.provider === "local_nmt" ? (
            <TranslationTestResultBox result={testResult} />
          ) : null}
        </div>
      ) : null}

      {provider === "text_model" ? (
        <div
          data-slot="reasoning-translation-text-model-panel"
          className="mt-3 mb-2 space-y-3.5 rounded-lg border border-border/60 bg-muted/25 p-3.5 sm:p-4"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold text-foreground">
                {gt("Translation model selection")}
              </div>
              <p className="text-2xs text-muted-foreground">
                {usesDedicatedModel
                  ? gt("Pinned to a dedicated model exclusively for reasoning translation.")
                  : gt("Currently following global text generation model: {model}", {
                      model: globalModelSummary,
                    })}
              </p>
            </div>
            <Select
              value={usesDedicatedModel ? "dedicated" : "follow_global"}
              onValueChange={(value) => {
                if (value === "follow_global") {
                  onUpdateSettings({ reasoningTranslationModelSelection: null });
                } else if (value === "dedicated") {
                  onUpdateSettings({
                    reasoningTranslationModelSelection: createModelSelection(
                      settings.textGenerationModelSelection.instanceId,
                      settings.textGenerationModelSelection.model,
                      settings.textGenerationModelSelection.options,
                    ),
                  });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-56"
                aria-label={gt("Translation model selection")}
                data-slot="reasoning-translation-model-mode"
              >
                <SelectValue>
                  {usesDedicatedModel
                    ? gt("Use dedicated translation model")
                    : gt("Follow global text generation model")}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem value="follow_global">
                  {gt("Follow global text generation model")}
                </SelectItem>
                <SelectItem value="dedicated">{gt("Use dedicated translation model")}</SelectItem>
              </SelectPopup>
            </Select>
          </div>

          {usesDedicatedModel && dedicatedModelPicker ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-muted-foreground">{gt("Dedicated model")}</span>
              {dedicatedModelPicker}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
            {textGenerationSettingsLink ?? null}
            <Button
              size="sm"
              variant="outline"
              disabled={testingProvider !== null}
              onClick={() => void handleTest("text_model")}
              data-slot="reasoning-translation-test-text-model"
            >
              {testingProvider === "text_model" ? (
                <Loader2Icon
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <FlaskConicalIcon aria-hidden="true" />
              )}
              {gt("Test translation")}
            </Button>
          </div>

          {testResult && testResult.provider === "text_model" ? (
            <TranslationTestResultBox result={testResult} />
          ) : null}
        </div>
      ) : null}

      {provider === "official_api" ? (
        <div
          data-slot="reasoning-translation-official-api-panel"
          className="mt-3 mb-2 space-y-3.5 rounded-lg border border-border/60 bg-muted/25 p-3.5 sm:p-4"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              <Label htmlFor={`${fieldIdPrefix}-vendor`}>{gt("Translation API vendor")}</Label>
              <p className="text-2xs text-muted-foreground">
                {gt(
                  "Uses strictly official vendor endpoints with your own credentials. Secrets are stored locally and never sent elsewhere.",
                )}
              </p>
            </div>
            <Select
              value={activeDraft.vendor}
              onValueChange={(value) => {
                if (isOfficialTranslationApiVendor(value)) {
                  setTestResult(null);
                  updateDraft((current) => ({ ...current, vendor: value }));
                }
              }}
            >
              <SelectTrigger
                id={`${fieldIdPrefix}-vendor`}
                size="sm"
                className="w-full sm:w-64"
                aria-label={gt("Translation API vendor")}
                data-slot="reasoning-translation-vendor-select"
              >
                <SelectValue>
                  {messages(OFFICIAL_API_VENDOR_LABELS[activeDraft.vendor])}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {OfficialTranslationApiVendor.literals.map((vendorValue) => (
                  <SelectItem key={vendorValue} value={vendorValue}>
                    {messages(OFFICIAL_API_VENDOR_LABELS[vendorValue])}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldIdPrefix}-api-key`}>{apiKeyLabel()}</Label>
              <SecretInput
                id={`${fieldIdPrefix}-api-key`}
                configured={apiKeySaved}
                value={activeDraft.apiKey}
                placeholder={
                  activeDraft.vendor === "deepl"
                    ? "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:fx"
                    : activeDraft.vendor === "openai_compatible"
                      ? "sk-..."
                      : gt("Enter key")
                }
                aria-label={apiKeyLabel()}
                onChange={(event) =>
                  updateDraft((current) => ({
                    ...current,
                    apiKey: event.target.value,
                    clearApiKey: false,
                  }))
                }
              />
            </div>

            {vendorFieldMask.showApiSecret ? (
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldIdPrefix}-api-secret`}>{apiSecretLabel()}</Label>
                <SecretInput
                  id={`${fieldIdPrefix}-api-secret`}
                  configured={apiSecretSaved}
                  value={activeDraft.apiSecret}
                  placeholder={gt("Enter secret")}
                  aria-label={apiSecretLabel()}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      apiSecret: event.target.value,
                      clearApiSecret: false,
                    }))
                  }
                />
              </div>
            ) : null}

            {vendorFieldMask.showRegion ? (
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldIdPrefix}-region`}>{gt("Region")}</Label>
                <Input
                  id={`${fieldIdPrefix}-region`}
                  value={activeDraft.region}
                  placeholder={regionPlaceholder()}
                  aria-label={gt("Region")}
                  onChange={(event) =>
                    updateDraft((current) => ({ ...current, region: event.target.value }))
                  }
                />
              </div>
            ) : null}

            {vendorFieldMask.showModel ? (
              <div className="space-y-1.5">
                <Label htmlFor={`${fieldIdPrefix}-model`}>{gt("Model name")}</Label>
                <Input
                  id={`${fieldIdPrefix}-model`}
                  value={activeDraft.model}
                  placeholder="deepseek-chat / qwen2.5:7b"
                  aria-label={gt("Model name")}
                  onChange={(event) =>
                    updateDraft((current) => ({ ...current, model: event.target.value }))
                  }
                />
              </div>
            ) : null}

            {vendorFieldMask.showEndpoint ? (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={`${fieldIdPrefix}-endpoint`}>
                  {activeDraft.vendor === "openai_compatible"
                    ? gt("API endpoint (Base URL)")
                    : gt("Custom endpoint (optional)")}
                </Label>
                <Input
                  id={`${fieldIdPrefix}-endpoint`}
                  value={activeDraft.endpoint}
                  placeholder={endpointPlaceholder()}
                  aria-label={
                    activeDraft.vendor === "openai_compatible"
                      ? gt("API endpoint (Base URL)")
                      : gt("Custom endpoint (optional)")
                  }
                  onChange={(event) =>
                    updateDraft((current) => ({ ...current, endpoint: event.target.value }))
                  }
                />
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <Button
              size="sm"
              disabled={!officialApiDirty}
              onClick={handleSaveOfficialApi}
              data-slot="reasoning-translation-save-official-api"
            >
              <SaveIcon aria-hidden="true" />
              {gt("Save configuration")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={testingProvider !== null}
              onClick={() => void handleTest("official_api")}
              data-slot="reasoning-translation-test-official-api"
            >
              {testingProvider === "official_api" ? (
                <Loader2Icon
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <FlaskConicalIcon aria-hidden="true" />
              )}
              {gt("Test connection")}
            </Button>
            {hasAnySavedSecret ? (
              <Button
                size="sm"
                variant="destructive-outline"
                onClick={handleClearOfficialSecrets}
                data-slot="reasoning-translation-clear-official-keys"
              >
                <KeyRoundIcon aria-hidden="true" />
                {gt("Clear key")}
              </Button>
            ) : null}
            {officialApiDirty ? (
              <span className="text-2xs text-warning-foreground">
                {gt("Save changes before testing.")}
              </span>
            ) : null}
          </div>

          {testResult && testResult.provider === "official_api" ? (
            <TranslationTestResultBox result={testResult} />
          ) : null}
        </div>
      ) : null}
    </SettingsRow>
  );
}

export function ReasoningTranslationSettingsCard() {
  const gt = useGT();
  const setting = useSearchableSetting();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const scope = useOptionalSettingsScope();
  const rowMeta = setting("reasoning-translation");

  return (
    <ReasoningTranslationSettingsCardView
      id={rowMeta.id}
      title={rowMeta.title}
      settings={settings}
      onUpdateSettings={(patch) => updateSettings(patch)}
      dedicatedModelPicker={
        scope !== null ? (
          <DedicatedReasoningModelPicker
            settings={settings}
            onSelect={(next) => updateSettings({ reasoningTranslationModelSelection: next })}
          />
        ) : undefined
      }
      textGenerationSettingsLink={
        <Link
          to="/settings/providers"
          hash="text-generation-model"
          className="inline-flex items-center text-xs font-medium text-primary underline-offset-4 hover:underline"
        >
          {gt("Configure text generation model →")}
        </Link>
      }
    />
  );
}
