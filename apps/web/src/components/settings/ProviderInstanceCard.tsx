import { RefreshIcon } from "~/components/ui/refresh-icon";
import { Spinner } from "~/components/ui/spinner";

import {
  AlertTriangleIcon,
  CheckIcon,
  ChevronRightIcon,
  ArrowUpCircleIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  LayersIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
  LockIcon,
  LockOpenIcon,
} from "lucide-react";
import * as Arr from "effect/Array";
import * as Result from "effect/Result";
import { Fragment, useState, type ReactElement, type ReactNode } from "react";
import { T, useGT, useMessages, Var } from "gt-react";
import {
  isProviderDriverKind,
  resolveProviderInstanceEnabled,
  type ProviderInstanceConfig,
  type ProviderInstanceEnvironmentVariable,
  type ProviderInstanceId,
  type AcpRegistryUrlAuthAction,
  type EnvironmentId,
  type ProjectId,
  type ProviderDriverKind,
  type SecretReference,
  type ServerProvider,
  type ServerProviderModel,
} from "@prismux/core-contracts";

import {
  type CustomModelDefinition,
  readCustomModelEntries,
  toCustomModelSetting,
} from "@prismux/core-shared/model";
import { cn } from "../../lib/utils";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { useStableCallback } from "../../hooks/useStableCallback";
import { normalizeProviderAccentColor } from "../../providerInstances";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { DraftInput } from "../ui/draft-input";
import { SecretSourceInput, type SecretSource } from "./SecretSourceInput";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";
import { ManagedControl, ManagedNotice } from "../ManagedPolicy";
import { managedInstanceLocks, useManagedPolicy } from "../../state/managedPolicy";
import { disallowedProviderMessage, isManagedDriverAllowed } from "@prismux/core-contracts";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type {
  ProviderClientDefinition,
  ProviderEnvironmentField,
} from "@prismux/provider-core/client";
import {
  deriveProviderSettingsFields,
  ProviderSettingsForm,
  reconcileRowsDraft,
  seedRowsDraft,
} from "./ProviderSettingsForm";
import { ProviderModelsSection } from "./ProviderModelsSection";
import { isDshProviderInstance, ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { ProviderAccentColorPicker } from "./ProviderAccentColorPicker";
import { RedactedSensitiveText } from "./RedactedSensitiveText";
import { SettingResetButton, SettingsRow } from "./settingsLayout";
import { AcpSessionManagementSection } from "./AcpSessionManagementSection";
import { readCodexSetupMode } from "./CodexSetupSection.logic";
import {
  type CustomModelSave,
  customModelsKey,
  pendingCustomModelSaves,
  settleCustomModelSave,
} from "./customModelSaves.logic";
import { getProviderRestartNotice } from "../ProviderUpdateLaunchNotification.logic";
import {
  getProviderVersionAdvisoryPresentation,
  PROVIDER_STATUS_STYLES,
  getProviderStatusKey,
  getProviderSummary,
  getProviderVersionLabel,
  providerAuthLabel,
} from "./providerStatus";
import {
  openSafeExternalHttpsFromAnchor,
  resolveAgentCliMeta,
  resolveSafeAgentHomepageUrl,
  supportsDualLaunchMode,
} from "./prismuxProviderMeta";
import { AgentInstallPrompt } from "./AgentInstallPrompt";
import type { ProviderLaunchMode } from "./prismuxProviderMode";
import type { ProviderRemovalKind } from "./ProviderSettingsPanel.logic";
import { formatAgentBrandName } from "../../prismux/agentBrand";
import { ProviderCliVersionBadge } from "../../prismux/providers/ProviderCliVersionBadge";

const ENVIRONMENT_VARIABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const COMPACT_DETAIL_SETTINGS_ROW_CLASSNAME =
  "px-4 py-3 [&>div:first-child]:gap-2.5 [&>div:first-child]:@min-[22rem]/settings-row:grid [&>div:first-child]:@min-[22rem]/settings-row:grid-cols-[minmax(0,1fr)_auto] [&>div:first-child]:@min-[22rem]/settings-row:items-center [&>div:first-child]:@min-[22rem]/settings-row:gap-4";

/**
 * Tightens verbose provider status strings for the single-line sidebar list subtitle so typical
 * statuses remain crisp and legible on one line (full text stays in the detail header & tooltip).
 */
export function formatCompactProviderListStatus(headline: string): string {
  return headline
    .replace(/\bLocal agy CLI\b/g, "agy CLI")
    .replace(/\bGoogle AI Ultra\b/g, "Ultra")
    .replace(/\bGoogle AI Pro\b/g, "Pro")
    .replace(/\bGoogle AI Standard\b/g, "Standard")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isDshExecutablePath(commandPath: string | null): boolean {
  if (!commandPath) return false;
  const last = commandPath.split(/[\\/]/).filter(Boolean).at(-1) ?? commandPath;
  return last.replace(/\.(exe|cmd|bat|ps1)$/i, "").toLowerCase() === "dsh";
}

function countAdvancedOverrides(
  config: unknown,
  genericEnvironmentCount: number,
  driverKind: ProviderDriverKind | null,
): number {
  let count = genericEnvironmentCount;
  if (config !== null && typeof config === "object") {
    for (const [key, val] of Object.entries(config as Record<string, unknown>)) {
      if (
        key === "customModels" ||
        key === "enabled" ||
        key === "setupMode" ||
        key === "registryIconUrl" ||
        key === "homepageUrl"
      ) {
        continue;
      }
      if (
        driverKind === "acpRegistry" &&
        (key === "source" || key === "agentId" || key === "distribution")
      ) {
        continue;
      }
      if (Array.isArray(val)) {
        if (val.length > 0) count += 1;
      } else if (typeof val === "string") {
        if (val.trim().length > 0) count += 1;
      } else if (val !== undefined && val !== null && val !== false) {
        count += 1;
      }
    }
  }
  return count;
}

function ProviderStatusDiagnostic({
  detail,
  children,
}: {
  detail: string | null;
  children: ReactElement;
}) {
  if (!detail) return children;
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipPopup side="top">{detail}</TooltipPopup>
    </Tooltip>
  );
}

const ENVIRONMENT_VARIABLE_NAME_PLACEHOLDER = "VARIABLE_NAME";

let environmentVariableDraftId = 0;
const DRAFT_ROW_ID_PREFIX = "provider-env-";
const nextEnvironmentVariableDraftId = () =>
  `${DRAFT_ROW_ID_PREFIX}${environmentVariableDraftId++}`;

type EnvironmentDraftRow = {
  readonly id: string;
  readonly name: string;
  readonly value: ProviderInstanceEnvironmentVariable["value"];
  readonly sensitive: boolean;
  readonly valueRedacted?: boolean;
};

function makeEnvironmentDraftRow(
  variable: ProviderInstanceEnvironmentVariable,
  index: number,
): EnvironmentDraftRow {
  return {
    id: `${index}:${variable.name}`,
    name: variable.name,
    value: variable.value,
    sensitive: variable.sensitive,
    ...(variable.valueRedacted !== undefined ? { valueRedacted: variable.valueRedacted } : {}),
  };
}

const toEnvironmentDraftRows = (environment: ReadonlyArray<ProviderInstanceEnvironmentVariable>) =>
  environment.map(makeEnvironmentDraftRow);

function environmentValuesEqual(
  left: ProviderInstanceEnvironmentVariable["value"],
  right: ProviderInstanceEnvironmentVariable["value"],
): boolean {
  if (typeof left === "string" || typeof right === "string") return left === right;
  return left.provider === right.provider && left.reference === right.reference;
}

function providerEnvironmentsEqual(
  left: ReadonlyArray<ProviderInstanceEnvironmentVariable>,
  right: ReadonlyArray<ProviderInstanceEnvironmentVariable>,
): boolean {
  return (
    left.length === right.length &&
    left.every((variable, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        variable.name === other.name &&
        environmentValuesEqual(variable.value, other.value) &&
        variable.sensitive === other.sensitive &&
        variable.valueRedacted === other.valueRedacted
      );
    })
  );
}

function readConfigString(config: unknown, key: string): string | null {
  if (config === null || typeof config !== "object") return null;
  const value = (config as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Preserve explicit empty arrays/objects; clearing a custom list differs from selecting driver defaults. */
function nextConfigBlobWithValue(
  config: unknown,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const base: Record<string, unknown> =
    config !== null && typeof config === "object" ? { ...(config as Record<string, unknown>) } : {};
  base[key] = value;
  return base;
}

export function deriveProviderModelsForDisplay(input: {
  readonly liveModels: ReadonlyArray<ServerProviderModel> | undefined;
  readonly customModels: ReadonlyArray<CustomModelDefinition>;
}): ReadonlyArray<ServerProviderModel> {
  const liveCustomModelsBySlug = new Map(
    Arr.filterMap(input.liveModels ?? [], (model) =>
      model.isCustom ? Result.succeed([model.slug, model] as const) : Result.failVoid,
    ),
  );
  const serverModels = input.liveModels?.filter((model) => !model.isCustom) ?? [];
  const serverSlugs = new Set(serverModels.map((model) => model.slug));
  const customModels = input.customModels.flatMap((entry) =>
    serverSlugs.has(entry.slug)
      ? []
      : [
          {
            slug: entry.slug,
            name: entry.name,
            isCustom: true,
            capabilities:
              entry.capabilities ?? liveCustomModelsBySlug.get(entry.slug)?.capabilities ?? null,
          },
        ],
  );
  return [...serverModels, ...customModels];
}

function ProviderAuthEmail(props: { readonly email: string | undefined }) {
  const gt = useGT();
  const email = props.email?.trim();
  if (!email) return null;

  return (
    <RedactedSensitiveText
      value={email}
      ariaLabel={gt("Toggle account email visibility")}
      revealTooltip={gt("Click to reveal email")}
      hideTooltip={gt("Click to hide email")}
      className="max-w-full truncate"
    />
  );
}

function readProviderEnvironmentVariable(
  environment: ReadonlyArray<ProviderInstanceEnvironmentVariable> | undefined,
  name: string,
): ProviderInstanceEnvironmentVariable | undefined {
  return environment?.find((variable) => variable.name === name);
}

function providerEnvironmentWithoutNames(
  environment: ReadonlyArray<ProviderInstanceEnvironmentVariable> | undefined,
  names: ReadonlySet<string>,
): ReadonlyArray<ProviderInstanceEnvironmentVariable> {
  return (environment ?? []).filter((variable) => !names.has(variable.name));
}

export function nextProviderEnvironmentWithFieldValue(
  environment: ReadonlyArray<ProviderInstanceEnvironmentVariable> | undefined,
  field: ProviderEnvironmentField,
  value: string,
): ReadonlyArray<ProviderInstanceEnvironmentVariable> {
  const trimmed = value.trim();
  const next: ProviderInstanceEnvironmentVariable[] = [];
  let found = false;

  for (const variable of environment ?? []) {
    if (variable.name !== field.name) {
      next.push(variable);
      continue;
    }
    found = true;
    if (trimmed.length > 0) {
      next.push({
        name: variable.name,
        value: trimmed,
        sensitive: field.sensitive ?? true,
      });
    }
  }

  if (!found && trimmed.length > 0) {
    next.push({
      name: field.name,
      value: trimmed,
      sensitive: field.sensitive ?? true,
    });
  }

  return next;
}

export function nextProviderEnvironmentWithFieldSecret(
  environment: ReadonlyArray<ProviderInstanceEnvironmentVariable> | undefined,
  field: ProviderEnvironmentField,
  secret: SecretReference | undefined,
): ReadonlyArray<ProviderInstanceEnvironmentVariable> {
  const others = providerEnvironmentWithoutNames(environment, new Set([field.name]));
  return secret === undefined
    ? others
    : [...others, { name: field.name, value: secret, sensitive: true }];
}

function ProviderEnvironmentFieldRow(props: {
  readonly field: ProviderEnvironmentField;
  readonly variable: ProviderInstanceEnvironmentVariable | undefined;
  readonly idPrefix: string;
  readonly onCommit: (field: ProviderEnvironmentField, value: string) => void;
  readonly onSecretChange: (
    field: ProviderEnvironmentField,
    secret: SecretReference | undefined,
  ) => void;
  readonly onRemove: (field: ProviderEnvironmentField) => void;
  readonly managedReason?: string | undefined;
  readonly secretSources: ReadonlyArray<SecretSource>;
  readonly environmentId?: EnvironmentId | undefined;
}) {
  const gt = useGT();
  const inputId = `${props.idPrefix}-environment-${props.field.name}`;
  const value = props.variable?.valueRedacted ? "" : (props.variable?.value ?? "");

  return (
    <SettingsRow
      className={COMPACT_DETAIL_SETTINGS_ROW_CLASSNAME}
      title={<label htmlFor={inputId}>{props.field.label}</label>}
      description={props.field.description}
      managed={props.managedReason}
      control={
        <div className="flex w-full min-w-0 items-center gap-2 @min-[22rem]/settings-row:w-56">
          {props.field.sensitive === false ? (
            <DraftInput
              id={inputId}
              size="sm"
              className="min-w-0 flex-1"
              autoComplete="off"
              value={typeof value === "string" ? value : ""}
              onCommit={(next) => props.onCommit(props.field, next)}
              placeholder={props.field.placeholder}
              spellCheck={false}
            />
          ) : (
            <SecretSourceInput
              id={inputId}
              size="sm"
              className="min-w-0 flex-1"
              value={value}
              onCommit={(next) => props.onCommit(props.field, next)}
              placeholder={props.field.placeholder}
              configured={props.variable?.valueRedacted === true}
              spellCheck={false}
              aria-label={props.field.label}
              sources={props.secretSources}
              environmentId={props.environmentId}
              onSecretChange={(secret) => props.onSecretChange(props.field, secret)}
            />
          )}
          {props.variable ? (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost-destructive"
              onClick={() => props.onRemove(props.field)}
              aria-label={gt("Clear {field}", { field: props.field.label })}
            >
              <XIcon className="size-3.5" />
            </Button>
          ) : null}
        </div>
      }
    />
  );
}

export function ProviderEnvironmentSection(props: {
  readonly environment: ReadonlyArray<ProviderInstanceEnvironmentVariable>;
  readonly onChange: (environment: ReadonlyArray<ProviderInstanceEnvironmentVariable>) => void;
  /** Variables an administrator's policy pins: listed by name, never editable or removable. */
  readonly managed?: { readonly names: ReadonlySet<string>; readonly reason: string } | undefined;
  readonly secretSources?: ReadonlyArray<SecretSource>;
  readonly environmentId?: EnvironmentId | undefined;
}) {
  const gt = useGT();
  const [storedDraft, setDraft] = useState(() =>
    seedRowsDraft(props.environment, toEnvironmentDraftRows),
  );
  let draft = reconcileRowsDraft(
    storedDraft,
    props.environment,
    providerEnvironmentsEqual,
    toEnvironmentDraftRows,
  );
  if (draft.rows !== storedDraft.rows) {
    // Keep rows the server never acknowledged, even across an external reseed.
    const acknowledged = new Set(storedDraft.seen.map((variable) => variable.name));
    const unpublished = storedDraft.rows.filter(
      (row) =>
        row.id.startsWith(DRAFT_ROW_ID_PREFIX) &&
        !acknowledged.has(row.name) &&
        !draft.rows.some((incoming) => incoming.name === row.name),
    );
    if (unpublished.length > 0) draft = { ...draft, rows: [...draft.rows, ...unpublished] };
  }
  if (draft !== storedDraft) setDraft(draft);
  const rows = draft.rows;
  const setRows = (nextRows: ReadonlyArray<EnvironmentDraftRow>) =>
    setDraft({ ...draft, rows: nextRows });

  const publishRows = (nextRows: ReadonlyArray<EnvironmentDraftRow>) => {
    const published: ProviderInstanceEnvironmentVariable[] = [];
    for (const row of nextRows) {
      const name = row.name.trim();
      if (!ENVIRONMENT_VARIABLE_NAME_PATTERN.test(name)) {
        if (
          name.length > 0 ||
          row.value !== "" ||
          row.sensitive !== true ||
          row.valueRedacted !== undefined
        ) {
          return;
        }
        continue;
      }
      const { id: _id, ...rest } = row;
      published.push({ ...rest, name });
    }
    setDraft({ rows: nextRows, seen: draft.seen, lastPublished: published });
    props.onChange(published);
  };

  const updateVariable = (id: string, patch: Partial<Omit<EnvironmentDraftRow, "id">>) => {
    // A row named like a pinned variable renders as the policy's, with no way to edit or remove it.
    if (patch.name !== undefined && props.managed?.names.has(patch.name)) return;
    const nextRows = rows.map((row) =>
      row.id === id
        ? {
            ...row,
            ...patch,
            ...(patch.value !== undefined ? { valueRedacted: false } : {}),
          }
        : row,
    );
    setRows(nextRows);
    publishRows(nextRows);
  };

  const setVariableSecret = (id: string, secret: SecretReference | undefined) => {
    const nextRows = rows.map((row) => {
      if (row.id !== id) return row;
      const { valueRedacted: _valueRedacted, ...rest } = row;
      return { ...rest, value: secret ?? "" };
    });
    setRows(nextRows);
    publishRows(nextRows);
  };

  const removeVariable = (id: string) => {
    const nextRows = rows.filter((row) => row.id !== id);
    setRows(nextRows);
    publishRows(nextRows);
  };

  const addVariable = () =>
    setRows([
      ...rows,
      {
        id: nextEnvironmentVariableDraftId(),
        name: "",
        value: "",
        sensitive: true,
      },
    ]);

  return (
    <SettingsRow
      className={COMPACT_DETAIL_SETTINGS_ROW_CLASSNAME}
      title={gt("Variables")}
      description={gt("API keys, base URLs, and other per-instance CLI settings.")}
      control={
        <Button type="button" size="sm" variant="outline" onClick={addVariable}>
          <PlusIcon className="size-3" />
          <T>Add variable</T>
        </Button>
      }
    >
      {rows.length > 0 ? (
        <div className="mt-3 min-w-0 space-y-2 pb-2">
          {rows.map((variable, index) => {
            if (props.managed?.names.has(variable.name)) {
              return (
                <div key={variable.id} className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <code className="min-w-0 truncate text-xs sm:w-44 sm:shrink-0">
                    {variable.name}
                  </code>
                  <span className="text-xs text-muted-foreground">{props.managed.reason}</span>
                </div>
              );
            }
            const nameInput = (
              <DraftInput
                size="sm"
                font="mono"
                className="min-w-0 flex-1"
                value={variable.name}
                onCommit={(name) => updateVariable(variable.id, { name: name.trim() })}
                disabled={variable.valueRedacted === true}
                placeholder={ENVIRONMENT_VARIABLE_NAME_PLACEHOLDER}
                spellCheck={false}
                aria-label={gt("Environment variable name {number}", { number: index + 1 })}
              />
            );
            const removeButton = (
              <Button
                type="button"
                size="icon-micro"
                variant="ghost-destructive"
                onClick={() => removeVariable(variable.id)}
                aria-label={gt("Remove environment variable {name}", {
                  name: variable.name || index + 1,
                })}
              >
                <XIcon className="size-3" />
              </Button>
            );
            const sensitiveToggle =
              typeof variable.value === "string" ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        size="icon-micro"
                        variant="ghost-muted"
                        disabled={variable.valueRedacted === true}
                        onClick={() => {
                          const sensitive = !variable.sensitive;
                          updateVariable(variable.id, {
                            sensitive,
                            ...(sensitive && variable.valueRedacted === undefined
                              ? {}
                              : { valueRedacted: sensitive ? variable.valueRedacted : false }),
                          });
                        }}
                        aria-pressed={variable.sensitive}
                        aria-label={gt("Mark environment variable {name} as sensitive", {
                          name: variable.name || index + 1,
                        })}
                      >
                        {variable.sensitive ? (
                          <LockIcon className="size-3" />
                        ) : (
                          <LockOpenIcon className="size-3" />
                        )}
                      </Button>
                    }
                  />
                  <TooltipPopup side="top">
                    {variable.sensitive ? gt("Sensitive, stored separately") : gt("Plain text")}
                  </TooltipPopup>
                </Tooltip>
              ) : null;
            const layout = (source: ReactNode, value: ReactNode) => (
              <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border p-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  {nameInput}
                  {source}
                  {removeButton}
                </div>
                <div className="flex min-w-0 items-start gap-1.5">
                  {value}
                  {sensitiveToggle}
                </div>
              </div>
            );
            return (
              <Fragment key={variable.id}>
                {variable.sensitive ? (
                  <SecretSourceInput
                    size="sm"
                    font="mono"
                    className="min-w-0 flex-1"
                    value={variable.valueRedacted ? "" : variable.value}
                    onCommit={(value) => updateVariable(variable.id, { value })}
                    placeholder={gt("value", {
                      $context: "placeholder for an environment variable value",
                    })}
                    configured={variable.valueRedacted === true}
                    spellCheck={false}
                    aria-label={gt("Environment variable value {number}", { number: index + 1 })}
                    sources={props.secretSources ?? []}
                    environmentId={props.environmentId}
                    onSecretChange={(secret) => setVariableSecret(variable.id, secret)}
                  >
                    {(parts) => layout(parts.source, parts.value)}
                  </SecretSourceInput>
                ) : (
                  layout(
                    null,
                    <DraftInput
                      size="sm"
                      font="mono"
                      className="min-w-0 flex-1"
                      value={
                        variable.valueRedacted || typeof variable.value !== "string"
                          ? ""
                          : variable.value
                      }
                      onCommit={(value) => updateVariable(variable.id, { value })}
                      autoComplete="off"
                      placeholder={gt("value", {
                        $context: "placeholder for an environment variable value",
                      })}
                      spellCheck={false}
                      aria-label={gt("Environment variable value {number}", { number: index + 1 })}
                    />,
                  )
                )}
              </Fragment>
            );
          })}
          <p className="text-xs text-muted-foreground">
            {rows.some((row) => row.valueRedacted === true)
              ? gt(
                  "Sensitive values are stored separately and never returned to the app. Enter a new value to rename a saved one or make it plain text.",
                )
              : gt("Sensitive values are stored separately and never returned to the app.")}
          </p>
        </div>
      ) : null}
    </SettingsRow>
  );
}

function ProjectOverrideInheritance({
  projectEnabled,
  deviceEnabled,
}: {
  readonly projectEnabled: boolean;
  readonly deviceEnabled: boolean;
}) {
  const gt = useGT();
  const layers = [
    {
      key: "project",
      label: gt("Project", { $context: "settings layer" }),
      enabled: projectEnabled,
      effective: true,
    },
    {
      key: "device",
      label: gt("Device", { $context: "settings layer" }),
      enabled: deviceEnabled,
      effective: false,
    },
  ];
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  size="icon-micro"
                  variant="ghost-muted"
                  aria-label={gt("Overridden for this project. Show where this value comes from")}
                />
              }
            />
          }
        >
          <LayersIcon className="size-3 text-primary" />
        </TooltipTrigger>
        <TooltipPopup side="top">
          <T>Overridden for this project</T>
        </TooltipPopup>
      </Tooltip>
      <PopoverPopup align="end" width="md" padding="none">
        <ol role="list" className="px-3 py-2.5 text-sm">
          {layers.map((layer) => (
            <li
              key={layer.key}
              className={cn(
                "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-md px-2 py-1",
                layer.effective && "bg-foreground/[0.06]",
              )}
            >
              <span
                className={cn(
                  "min-w-0 truncate",
                  layer.effective ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {layer.label}
              </span>
              <span
                className={cn(
                  "flex items-center gap-1.5",
                  layer.effective ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {layer.enabled
                  ? gt("On", { $context: "setting state" })
                  : gt("Off", { $context: "setting state" })}
                {layer.effective ? (
                  <CheckIcon aria-hidden className="size-3.5 shrink-0 text-primary" />
                ) : (
                  <span aria-hidden className="size-3.5 shrink-0" />
                )}
              </span>
            </li>
          ))}
        </ol>
      </PopoverPopup>
    </Popover>
  );
}

interface ProjectOverrideControl {
  readonly value: boolean | undefined;
  readonly effectiveEnabled: boolean;
  readonly onChange: (next: boolean) => void;
  readonly onReset: () => void;
}

interface ProviderInstanceCardProps {
  readonly instanceId: ProviderInstanceId;
  readonly instance: ProviderInstanceConfig;
  readonly driverOption: ProviderClientDefinition | undefined;
  readonly liveProvider: ServerProvider | undefined;
  readonly mode: "list" | "editor";
  readonly selected?: boolean | undefined;
  readonly onSelect?: (() => void) | undefined;
  readonly readOnly?: boolean | undefined;
  readonly canWriteSettings?: boolean;
  readonly onUpdate: (nextInstance: ProviderInstanceConfig) => Promise<boolean>;
  readonly onDelete?: (() => void) | undefined;
  readonly onRefresh?: (() => void) | undefined;
  readonly isRefreshing?: boolean | undefined;
  readonly removalKind?: ProviderRemovalKind | undefined;
  readonly showDeleteSlot?: boolean | undefined;
  readonly headerAction?: ReactNode | undefined;
  readonly setup?: ReactNode;
  readonly runtime?: ReactNode;
  readonly hiddenModels: ReadonlyArray<string>;
  readonly favoriteModels: ReadonlyArray<string>;
  readonly modelOrder: ReadonlyArray<string>;
  readonly onHiddenModelsChange: (
    next: ReadonlyArray<string>,
    affectedModels: ReadonlyArray<string>,
  ) => void;
  readonly onFavoriteModelsChange: (next: ReadonlyArray<string>) => void;
  readonly onToggleFavorite: (model: string) => void;
  readonly onModelOrderChange: (next: ReadonlyArray<string>) => void;
  readonly onRunUpdate?: (() => void) | undefined;
  readonly onInstallRecommended?: (() => void) | undefined;
  readonly isUpdating?: boolean | undefined;
  readonly onAcceptUrlAuth?: ((action: AcpRegistryUrlAuthAction) => void) | undefined;
  readonly environmentId?: EnvironmentId | undefined;
  readonly secretSources?: ReadonlyArray<SecretSource>;
  readonly projectOverride?: ProjectOverrideControl | undefined;
  readonly launchMode?: ProviderLaunchMode | undefined;
  readonly isLaunchModeOverridden?: boolean | undefined;
  readonly onLaunchModeChange?: ((mode: ProviderLaunchMode) => void) | undefined;
  readonly onLaunchModeReset?: (() => void) | undefined;
  readonly dragHandle?: ReactNode | undefined;
  readonly acpProjects?:
    | ReadonlyArray<{
        readonly id: ProjectId;
        readonly title: string;
        readonly workspaceRoot: string;
      }>
    | undefined;
}

const EMPTY_ACP_PROJECTS: NonNullable<ProviderInstanceCardProps["acpProjects"]> = [];
const NO_SECRET_SOURCES: ReadonlyArray<SecretSource> = [];
const NO_CUSTOM_MODELS: ReadonlyArray<CustomModelDefinition> = [];

/**
 * Every custom model save writes the whole list, so the next edit starts from the last list sent
 * until the config stream echoes it, which can land before or after the save's reply.
 */
function useCustomModelSaves(
  stored: ReadonlyArray<CustomModelDefinition>,
  save: (next: ReadonlyArray<CustomModelDefinition>) => Promise<boolean>,
) {
  const [saves, setSaves] = useState<ReadonlyArray<CustomModelSave>>([]);
  const storedKey = customModelsKey(stored);
  const [previousStoredKey, setPreviousStoredKey] = useState(storedKey);
  if (previousStoredKey !== storedKey) {
    setPreviousStoredKey(storedKey);
    // Unchanged contents can match a queued restore, so only a stream change can be an echo.
    setSaves((list) => pendingCustomModelSaves(list, storedKey));
  }
  const current = saves.at(-1)?.models ?? stored;
  const update = useStableCallback(async (next: ReadonlyArray<CustomModelDefinition>) => {
    const sent: CustomModelSave = { models: next, key: customModelsKey(next) };
    setSaves((list) => [...list, sent]);
    const saved = await save(next);
    setSaves((list) => settleCustomModelSave(list, sent, saved));
    return saved;
  });
  return [current, update] as const;
}

/** Unknown drivers stay read-only to preserve fork config. projectOverride switches affect only the
 * project, not instance.enabled. */
export function ProviderInstanceCard({
  instanceId,
  instance,
  driverOption,
  liveProvider,
  mode,
  selected = false,
  onSelect,
  readOnly = false,
  canWriteSettings = true,
  onUpdate,
  onDelete,
  onRefresh,
  isRefreshing = false,
  removalKind = "delete-custom",
  headerAction,
  setup,
  runtime,
  hiddenModels,
  favoriteModels,
  modelOrder,
  onHiddenModelsChange,
  onFavoriteModelsChange,
  onToggleFavorite,
  onModelOrderChange,
  onRunUpdate,
  onInstallRecommended,
  isUpdating = false,
  onAcceptUrlAuth,
  environmentId,
  acpProjects = EMPTY_ACP_PROJECTS,
  secretSources = NO_SECRET_SOURCES,
  projectOverride,
  launchMode = "chat",
  isLaunchModeOverridden = false,
  onLaunchModeChange,
  onLaunchModeReset,
  dragHandle,
}: ProviderInstanceCardProps) {
  const gt = useGT();
  const m = useMessages();
  const enabled = projectOverride?.effectiveEnabled ?? resolveProviderInstanceEnabled(instance);
  const effectiveProvider = liveProvider && { ...liveProvider, enabled };
  const compatibility = enabled ? liveProvider?.compatibilityAdvisory : undefined;
  const statusKey = enabled ? getProviderStatusKey(effectiveProvider) : "disabled";
  const statusStyle = PROVIDER_STATUS_STYLES[statusKey];
  const summary = enabled
    ? getProviderSummary(effectiveProvider, m)
    : { headline: gt("Disabled", { $context: "provider status" }), detail: null };
  const authEmail = liveProvider?.auth.email?.trim();
  const isAuthenticated = enabled && liveProvider?.auth.status === "authenticated";
  const authLabel =
    enabled && liveProvider?.auth.status === "authenticated"
      ? (providerAuthLabel(liveProvider.auth, m) ?? null)
      : null;
  const versionLabel = getProviderVersionLabel(liveProvider?.version);
  const versionAdvisory = getProviderVersionAdvisoryPresentation(
    liveProvider?.versionAdvisory,
    liveProvider?.compatibilityAdvisory,
    enabled,
    m,
  );
  const updateCommand = versionAdvisory?.updateCommand ?? null;
  const updateState = liveProvider?.updateState;
  const updateProgress = isUpdating
    ? ((updateState?.status === "queued" || updateState?.status === "running"
        ? updateState.message
        : null) ?? gt("Starting update"))
    : null;
  const updateProblem =
    !isUpdating && (updateState?.status === "failed" || updateState?.status === "unchanged")
      ? updateState.message
      : null;
  const restartNotice =
    enabled && !isUpdating && liveProvider ? getProviderRestartNotice(liveProvider) : null;
  const hasCompatibilityWarning =
    compatibility !== undefined &&
    compatibility.status !== "supported" &&
    compatibility.status !== "unknown";
  const VersionAdvisoryIcon = hasCompatibilityWarning ? AlertTriangleIcon : ArrowUpCircleIcon;
  const onRunVersionAction = readOnly
    ? undefined
    : versionAdvisory?.targetVersion
      ? onInstallRecommended
      : onRunUpdate;
  const urlAuthAction = liveProvider?.auth.action;
  const displayName =
    instance.displayName?.trim() ||
    driverOption?.label ||
    formatAgentBrandName(String(instance.driver));
  const cliMeta = resolveAgentCliMeta({
    driver: instance.driver,
    instanceId,
    config: instance.config,
    displayName,
  });
  const safeHomepageUrl = resolveSafeAgentHomepageUrl({
    driver: instance.driver,
    instanceId,
    config: instance.config,
    displayName,
    documentationUrl: liveProvider?.setup?.documentationUrl ?? null,
  });
  const dualModeSupported = supportsDualLaunchMode({
    driver: instance.driver,
    instanceId,
    config: instance.config,
  });
  const isMissingCli = liveProvider !== undefined && !liveProvider.installed;
  const effectiveUpdateCommand =
    updateCommand ?? (versionAdvisory && cliMeta?.updateCommandHint ? cliMeta.updateCommandHint : null);
  const latestVersionBadge =
    liveProvider?.versionAdvisory?.latestVersion
      ? getProviderVersionLabel(liveProvider.versionAdvisory.latestVersion)
      : null;
  const accentColor = normalizeProviderAccentColor(instance.accentColor);
  const managedPolicy = useManagedPolicy(environmentId);
  const instanceLocks = managedInstanceLocks(managedPolicy, instance.driver, m);
  const managedDriverReason = isManagedDriverAllowed(managedPolicy, instance.driver)
    ? undefined
    : disallowedProviderMessage(
        managedPolicy?.organization,
        driverOption?.label ?? String(instance.driver),
      );
  const { copyToClipboard } = useCopyToClipboard<{ providerName: string }>({
    onCopy: ({ providerName }) => {
      toastManager.add({
        type: "success",
        title: gt("{provider} update command copied", { provider: providerName }),
        description: gt("Run it in a terminal when you are ready to update."),
      });
    },
    onError: (error, { providerName }) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Could not copy {provider} update command", { provider: providerName }),
          description: error.message,
        }),
      );
    },
  });

  const driverKind: ProviderDriverKind | null = isProviderDriverKind(instance.driver)
    ? instance.driver
    : null;
  const storedCustomModels =
    instance.config !== null && typeof instance.config === "object"
      ? (instance.config as Record<string, unknown>).customModels
      : undefined;
  const [customModels, updateCustomModels] = useCustomModelSaves(
    instance.driver === "antigravity"
      ? NO_CUSTOM_MODELS
      : readCustomModelEntries(storedCustomModels),
    (next) => {
      const nextConfig = nextConfigBlobWithValue(
        instance.config,
        "customModels",
        next.map(toCustomModelSetting),
      );
      const { config: _omit, ...rest } = instance;
      return onUpdate({ ...rest, config: nextConfig } as ProviderInstanceConfig);
    },
  );
  const modelsForDisplay = deriveProviderModelsForDisplay({
    liveModels: liveProvider?.models,
    customModels,
  });
  const updateDisplayName = (value: string) => {
    const trimmed = value.trim();
    const { displayName: _omit, ...rest } = instance;
    onUpdate(
      trimmed.length > 0
        ? ({ ...rest, displayName: trimmed } as ProviderInstanceConfig)
        : (rest as ProviderInstanceConfig),
    );
  };

  const updateEnabled = (value: boolean) => {
    if (projectOverride) {
      projectOverride.onChange(value);
      return;
    }
    onUpdate({ ...instance, enabled: value });
  };

  const updateAccentColor = (value: string) => {
    const normalized = normalizeProviderAccentColor(value);
    const { accentColor: _omit, ...rest } = instance;
    onUpdate(
      normalized
        ? ({ ...rest, accentColor: normalized } as ProviderInstanceConfig)
        : (rest as ProviderInstanceConfig),
    );
  };

  const updateConfig = (nextConfig: Record<string, unknown> | undefined) => {
    const { config: _omit, ...rest } = instance;
    onUpdate(
      nextConfig !== undefined
        ? ({ ...rest, config: nextConfig } as ProviderInstanceConfig)
        : (rest as ProviderInstanceConfig),
    );
  };

  const updateEnvironment = (environment: ReadonlyArray<ProviderInstanceEnvironmentVariable>) => {
    const cleaned = environment.filter((variable) => variable.name.trim().length > 0);
    const { environment: _omit, ...rest } = instance;
    onUpdate(
      cleaned.length > 0
        ? ({ ...rest, environment: cleaned } as ProviderInstanceConfig)
        : (rest as ProviderInstanceConfig),
    );
  };
  const environmentFields = driverOption?.environmentFields ?? [];
  const environmentFieldNames = new Set(environmentFields.map((field) => field.name));
  const genericEnvironment = providerEnvironmentWithoutNames(
    instance.environment,
    environmentFieldNames,
  );
  const updateGenericEnvironment = (
    environment: ReadonlyArray<ProviderInstanceEnvironmentVariable>,
  ) => {
    const dedicatedEnvironment = (instance.environment ?? []).filter((variable) =>
      environmentFieldNames.has(variable.name),
    );
    updateEnvironment([...dedicatedEnvironment, ...environment]);
  };
  const updateEnvironmentField = (field: ProviderEnvironmentField, value: string) => {
    updateEnvironment(nextProviderEnvironmentWithFieldValue(instance.environment, field, value));
  };
  const updateEnvironmentFieldSecret = (
    field: ProviderEnvironmentField,
    secret: SecretReference | undefined,
  ) => {
    updateEnvironment(nextProviderEnvironmentWithFieldSecret(instance.environment, field, secret));
  };
  const removeEnvironmentField = (field: ProviderEnvironmentField) => {
    updateEnvironment(providerEnvironmentWithoutNames(instance.environment, new Set([field.name])));
  };

  const [advancedOpen, setAdvancedOpen] = useState(false);

  const acpRegistryAgentId =
    readConfigString(instance.config, "source") === "local"
      ? undefined
      : (readConfigString(instance.config, "agentId") ?? undefined);
  const acpRegistryIconUrl =
    readConfigString(instance.config, "source") === "local"
      ? undefined
      : (readConfigString(instance.config, "registryIconUrl") ?? undefined);
  const localCommandPath =
    readConfigString(instance.config, "source") === "local"
      ? readConfigString(instance.config, "commandPath")
      : null;
  const localCommandArgs =
    readConfigString(instance.config, "source") === "local" &&
    instance.config !== null &&
    typeof instance.config === "object" &&
    Array.isArray((instance.config as Record<string, unknown>).commandArgs)
      ? ((instance.config as Record<string, unknown>).commandArgs as unknown[]).filter(
          (arg): arg is string => typeof arg === "string" && arg.trim().length > 0,
        )
      : [];
  const localCommandSummary = localCommandPath
    ? [localCommandPath, ...localCommandArgs].join(" ")
    : null;
  // DeepSeek Harness always renders its pure blue whale mark without an overlapping initials badge.
  const isDshInstance =
    isDshProviderInstance({
      driverKind: driverKind ?? instance.driver,
      displayName,
      instanceId,
      acpRegistryAgentId: readConfigString(instance.config, "agentId") ?? undefined,
    }) || isDshExecutablePath(localCommandPath);

  const listIconNode = (
    <span
      data-provider-icon-slot="list"
      className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.04] ring-1 ring-border/35 dark:bg-white/[0.045] dark:ring-white/[0.08]"
    >
      <ProviderInstanceIcon
        driverKind={driverKind ?? instance.driver}
        displayName={displayName}
        instanceId={instanceId}
        accentColor={isDshInstance ? undefined : accentColor}
        acpRegistryAgentId={acpRegistryAgentId}
        acpRegistryIconUrl={acpRegistryIconUrl}
        showBadge={!isDshInstance && Boolean(accentColor)}
        className="size-5"
        iconClassName="size-5 text-foreground/85"
        badgeClassName="right-[-0.125rem] bottom-[-0.125rem] h-3 min-w-3 px-0.5 text-5xs"
      />
    </span>
  );

  const editorIconNode = (
    <span
      data-provider-icon-slot="editor"
      className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.045] ring-1 ring-border/45 dark:bg-white/[0.05] dark:ring-white/[0.09]"
    >
      <ProviderInstanceIcon
        driverKind={driverKind ?? instance.driver}
        displayName={displayName}
        instanceId={instanceId}
        accentColor={isDshInstance ? undefined : accentColor}
        acpRegistryAgentId={acpRegistryAgentId}
        acpRegistryIconUrl={acpRegistryIconUrl}
        showBadge={!isDshInstance && Boolean(accentColor)}
        className="size-6"
        iconClassName="size-6 text-foreground/90"
        badgeClassName="right-[-0.125rem] bottom-[-0.125rem] h-3.5 min-w-3.5 px-0.5 text-5xs"
      />
    </span>
  );

  const titleTailNode = headerAction ? (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">{headerAction}</span>
  ) : null;

  const versionCodeNode = (
    <ProviderCliVersionBadge
      provider={cliMeta?.id ?? String(instance.driver)}
      currentVersion={liveProvider?.version ?? null}
      displayName={displayName}
      environmentId={environmentId}
      readOnly={readOnly}
      disableAutoCheck={isMissingCli}
    />
  );

  const statusDotNode =
    statusKey === "warning" || statusKey === "error" ? (
      <span className={cn("size-1.5 shrink-0 rounded-full", statusStyle.dot)} aria-hidden />
    ) : null;
  const needsAttention = statusKey === "warning" || statusKey === "error";
  const statusDiagnostic = hasCompatibilityWarning && needsAttention ? summary.detail : null;
  const inlineStatusDetail = hasCompatibilityWarning
    ? compatibility?.status === "broken"
      ? gt("Incompatible")
      : compatibility?.status === "unsupported"
        ? gt("Unsupported")
        : gt("Limited support")
    : summary.detail;
  const editorStatusNode =
    isAuthenticated && authEmail ? (
      <>
        {needsAttention ? statusDotNode : null}
        <span className="min-w-0 max-w-full">
          <T>
            Authenticated as{" "}
            <Var>
              <ProviderAuthEmail email={authEmail} />
            </Var>
          </T>
        </span>
        {authLabel ? <span>· {authLabel}</span> : null}
        {inlineStatusDetail ? (
          <span className="min-w-0 [overflow-wrap:anywhere]">· {inlineStatusDetail}</span>
        ) : null}
      </>
    ) : (
      <>
        {statusDotNode}
        <span>{summary.headline}</span>
        {inlineStatusDetail ? (
          <span className="min-w-0 [overflow-wrap:anywhere]">· {inlineStatusDetail}</span>
        ) : null}
      </>
    );
  const versionAdvisoryNode = versionAdvisory ? (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  type="button"
                  size={mode === "list" ? "xs" : "xs"}
                  variant="outline"
                  className={cn(
                    "pointer-events-auto relative h-5 shrink-0 gap-1 rounded-full px-1.5 text-2xs font-medium",
                    hasCompatibilityWarning
                      ? "border-warning/50 bg-warning/10 text-warning-foreground"
                      : "border-primary/35 bg-primary/10 text-primary hover:bg-primary/15",
                  )}
                  onClick={(event) => event.stopPropagation()}
                  aria-label={gt("{status}, view details", {
                    status: updateProgress ? gt("Updating") : versionAdvisory.title,
                  })}
                >
                  {updateProgress ? (
                    <Spinner tone="muted" size="sm" />
                  ) : (
                    <VersionAdvisoryIcon
                      className={cn(
                        "size-3 shrink-0",
                        hasCompatibilityWarning && "text-warning",
                      )}
                    />
                  )}
                  <span className="max-w-20 truncate tabular-nums">
                    {updateProgress
                      ? gt("Updating")
                      : latestVersionBadge
                        ? latestVersionBadge
                        : gt("Update")}
                  </span>
                </Button>
              }
            />
          }
        />
        <TooltipPopup side="top">
          {updateProgress
            ? gt("Updating")
            : liveProvider?.version && liveProvider?.versionAdvisory?.latestVersion
              ? gt("{installed} → {latest}", {
                  installed: getProviderVersionLabel(liveProvider.version),
                  latest: getProviderVersionLabel(liveProvider.versionAdvisory.latestVersion),
                })
              : versionAdvisory.title}
        </TooltipPopup>
      </Tooltip>
      <PopoverPopup side="bottom" align="end" width="md" aria-label={versionAdvisory.title}>
        <div className="grid min-w-0 gap-3">
          <div className="grid gap-0.5">
            <p className="text-sm font-semibold leading-tight text-foreground">
              {versionAdvisory.title}
            </p>
            <p
              className={cn(
                "text-xs leading-snug [overflow-wrap:anywhere]",
                versionAdvisory.emphasis === "strong" ? "text-warning" : "text-muted-foreground",
              )}
            >
              {versionAdvisory.detail}
            </p>
          </div>
          {effectiveUpdateCommand ? (
            <div className="space-y-1.5">
              <p className="text-2xs text-muted-foreground">
                <T>Run the official CLI update command in your terminal:</T>
              </p>
              <div className="flex min-w-0 items-center gap-1 rounded-md border border-border/70 bg-muted/40 py-0.5 pr-0.5 pl-2">
                <code className="min-w-0 flex-1 truncate font-mono text-2xs text-foreground">
                  {effectiveUpdateCommand}
                </code>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost-muted"
                        className="shrink-0"
                        onClick={() =>
                          copyToClipboard(effectiveUpdateCommand, { providerName: displayName })
                        }
                        aria-label={gt("Copy update command")}
                      >
                        <CopyIcon className="size-3" />
                      </Button>
                    }
                  />
                  <TooltipPopup side="top">
                    <T>Copy command</T>
                  </TooltipPopup>
                </Tooltip>
              </div>
            </div>
          ) : null}
          {onRunVersionAction && instance.driver === "acpRegistry" ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              className="w-full"
              disabled={isUpdating}
              onClick={onRunVersionAction}
            >
              {isUpdating ? <Spinner /> : <DownloadIcon />}
              {isUpdating
                ? gt("Updating")
                : versionAdvisory.targetVersion
                  ? gt("Install {version}", {
                      version: getProviderVersionLabel(versionAdvisory.targetVersion),
                    })
                  : gt("Update now")}
            </Button>
          ) : null}
          {safeHomepageUrl ? (
            <Button
              size="xs"
              variant="ghost"
              className="w-full justify-between"
              render={
                <a
                  href={safeHomepageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => {
                    openSafeExternalHttpsFromAnchor(event);
                  }}
                />
              }
            >
              <span>
                <T>Official installation &amp; release notes</T>
              </span>
              <ExternalLinkIcon className="size-3" />
            </Button>
          ) : null}
          {updateProgress || updateProblem ? (
            <p
              aria-live="polite"
              className={cn(
                "text-xs leading-snug [overflow-wrap:anywhere]",
                updateProblem ? "text-warning" : "text-muted-foreground",
              )}
            >
              {updateProgress ?? updateProblem}
            </p>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  ) : null;

  const cliMissingForLaunchMode = isMissingCli;
  const effectiveDisplayedLaunchMode = cliMissingForLaunchMode ? "chat" : launchMode;
  const launchModeActiveOptionClass =
    "border border-primary/85 bg-primary font-semibold text-primary-foreground shadow-[0_1px_2px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.24)] [@media(forced-colors:active)]:border-[Highlight] [@media(forced-colors:active)]:bg-[Highlight] [@media(forced-colors:active)]:text-[HighlightText]";
  const launchModeInactiveOptionClass =
    "border border-transparent bg-transparent font-medium text-foreground/60 hover:bg-black/[0.06] hover:text-foreground dark:text-white/55 dark:hover:bg-white/10 dark:hover:text-white [[data-pmx-glass='1']_&]:text-white/58 [[data-pmx-glass='1']_&]:hover:bg-white/12 [[data-pmx-glass='1']_&]:hover:text-white [html:not(.dark)[data-pmx-glass='1']_&]:text-slate-900/60 [html:not(.dark)[data-pmx-glass='1']_&]:hover:bg-black/[0.07] [html:not(.dark)[data-pmx-glass='1']_&]:hover:text-slate-950";
  const cliModeButton = (
    <button
      type="button"
      role="radio"
      data-launch-mode="cli"
      data-active={effectiveDisplayedLaunchMode === "cli" ? "true" : "false"}
      tabIndex={effectiveDisplayedLaunchMode === "cli" && !cliMissingForLaunchMode ? 0 : -1}
      disabled={cliMissingForLaunchMode}
      aria-checked={effectiveDisplayedLaunchMode === "cli"}
      className={cn(
        "inline-flex h-5 cursor-pointer items-center justify-center rounded-sm px-1 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
        cliMissingForLaunchMode
          ? "cursor-not-allowed border border-transparent bg-transparent font-medium text-muted-foreground/40"
          : effectiveDisplayedLaunchMode === "cli"
            ? launchModeActiveOptionClass
            : launchModeInactiveOptionClass,
      )}
      onClick={(event) => {
        event.stopPropagation();
        if (!cliMissingForLaunchMode) {
          onLaunchModeChange?.("cli");
        }
      }}
    >
      CLI
    </button>
  );

  const launchModeControlSlot =
    onLaunchModeChange !== undefined ? (
      dualModeSupported ? (
        <div
          role="radiogroup"
          aria-label={gt("{provider} default launch mode", { provider: displayName })}
          data-provider-mode-toggle={instanceId}
          data-cli-missing={cliMissingForLaunchMode ? "true" : "false"}
          className={cn(
            "inline-grid h-6 shrink-0 grid-cols-2 items-center gap-0.5 rounded-md border border-black/14 bg-black/[0.06] p-0.5 text-2xs shadow-inner dark:border-white/16 dark:bg-black/45 [[data-pmx-glass='1']_&]:border-white/22 [[data-pmx-glass='1']_&]:bg-black/38 [html:not(.dark)[data-pmx-glass='1']_&]:border-black/14 [html:not(.dark)[data-pmx-glass='1']_&]:bg-black/[0.08]",
            mode === "list" ? "w-[4.75rem]" : "w-[5.25rem]",
          )}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "Home") {
              event.preventDefault();
              event.stopPropagation();
              onLaunchModeChange("chat");
              const firstRadio = event.currentTarget.querySelector<HTMLButtonElement>(
                'button[role="radio"]:not(:disabled)',
              );
              firstRadio?.focus();
            } else if (
              (event.key === "ArrowRight" || event.key === "End") &&
              !cliMissingForLaunchMode
            ) {
              event.preventDefault();
              event.stopPropagation();
              onLaunchModeChange("cli");
              const radios = event.currentTarget.querySelectorAll<HTMLButtonElement>(
                'button[role="radio"]:not(:disabled)',
              );
              radios.item(radios.length - 1)?.focus();
            }
          }}
        >
          <button
            type="button"
            role="radio"
            data-launch-mode="chat"
            data-active={effectiveDisplayedLaunchMode === "chat" ? "true" : "false"}
            tabIndex={effectiveDisplayedLaunchMode === "chat" ? 0 : -1}
            aria-checked={effectiveDisplayedLaunchMode === "chat"}
            className={cn(
              "inline-flex h-5 cursor-pointer items-center justify-center rounded-sm px-1 transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring",
              effectiveDisplayedLaunchMode === "chat"
                ? launchModeActiveOptionClass
                : launchModeInactiveOptionClass,
            )}
            onClick={(event) => {
              event.stopPropagation();
              onLaunchModeChange("chat");
            }}
          >
            Chat
          </button>
          {cliMissingForLaunchMode ? (
            <Tooltip>
              <TooltipTrigger render={cliModeButton} />
              <TooltipPopup side="top">
                {gt("Install the {provider} CLI to open it in a terminal.", {
                  provider: displayName,
                })}
              </TooltipPopup>
            </Tooltip>
          ) : (
            cliModeButton
          )}
        </div>
      ) : (
        <span
          aria-hidden="true"
          data-provider-mode-placeholder={instanceId}
          className={cn(
            "inline-flex h-6 shrink-0 items-center justify-center rounded-md border border-transparent text-2xs text-muted-foreground/40 select-none max-sm:hidden",
            mode === "list" ? "w-[4.75rem]" : "w-[5.25rem]",
          )}
        >
          —
        </span>
      )
    ) : null;

  if (mode === "list") {
    const rawListStatus = updateProgress
      ? gt("Updating · {progress}", { progress: updateProgress })
      : `${summary.headline}${needsAttention && inlineStatusDetail ? ` · ${inlineStatusDetail}` : ""}`;
    const compactListStatus = updateProgress
      ? rawListStatus
      : formatCompactProviderListStatus(rawListStatus);
    const listStatusTooltip =
      statusDiagnostic ?? (compactListStatus !== rawListStatus ? rawListStatus : null);

    return (
      <div
        data-slot="settings-row"
        data-provider-list-row={instanceId}
        className={cn(
          "group relative flex min-h-[3.75rem] items-center gap-2 px-3 py-2.5 transition-colors",
          selected ? "bg-foreground/[0.06]" : "hover:bg-muted/25",
        )}
      >
        {dragHandle ? (
          <span
            className="pointer-events-auto relative z-10 -ms-1 flex shrink-0 items-center"
            onClick={(event) => event.stopPropagation()}
          >
            {dragHandle}
          </span>
        ) : null}
        <div
          className={cn(
            "pointer-events-none flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left transition-opacity",
            !enabled && !selected && "opacity-60 group-hover:opacity-100",
          )}
        >
          <button
            type="button"
            className="pointer-events-auto absolute inset-0 cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={onSelect}
            aria-label={gt("Select {provider}", { provider: displayName })}
            aria-pressed={selected}
          />
          {listIconNode}
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="min-w-0 truncate text-sm font-semibold tracking-tight text-foreground">
                {displayName}
              </span>
              {versionLabel ? (
                <code className="shrink-0 font-mono text-2xs text-muted-foreground/65 tabular-nums">
                  {versionLabel}
                </code>
              ) : null}
              {versionAdvisoryNode ? (
                <span className="shrink-0" onPointerDown={(event) => event.stopPropagation()}>
                  {versionAdvisoryNode}
                </span>
              ) : null}
            </span>
            <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-2xs font-normal leading-snug text-muted-foreground/65">
              {statusDotNode && !updateProgress ? (
                <span className="flex shrink-0 items-center">{statusDotNode}</span>
              ) : null}
              <ProviderStatusDiagnostic detail={listStatusTooltip}>
                <span
                  data-provider-list-status="true"
                  tabIndex={listStatusTooltip ? 0 : undefined}
                  aria-live="polite"
                  className="pointer-events-auto min-w-0 truncate whitespace-nowrap"
                >
                  {compactListStatus}
                </span>
              </ProviderStatusDiagnostic>
              {isMissingCli && safeHomepageUrl ? (
                <a
                  href={safeHomepageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    openSafeExternalHttpsFromAnchor(event);
                  }}
                  className="pointer-events-auto relative inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span>{gt("Install guide")}</span>
                  <ExternalLinkIcon className="size-3 shrink-0" />
                </a>
              ) : null}
            </span>
          </span>
        </div>
        <span
          className="pointer-events-none relative flex shrink-0 items-center gap-1.5 *:pointer-events-auto"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {projectOverride?.value !== undefined ? (
            <span className="flex items-center">
              <ProjectOverrideInheritance
                projectEnabled={projectOverride.value}
                deviceEnabled={resolveProviderInstanceEnabled(instance)}
              />
              <SettingResetButton
                ariaLabel={gt("Reset {provider} enablement to default", { provider: displayName })}
                tooltip={gt("Reset to the device setting")}
                disabled={readOnly || !canWriteSettings}
                onClick={projectOverride.onReset}
              />
            </span>
          ) : null}
          {/* The policy refuses switching it on; switching it off stays the user's call. */}
          <ManagedControl reason={enabled ? undefined : managedDriverReason}>
            <Switch
              checked={enabled}
              disabled={readOnly || (projectOverride !== undefined && !canWriteSettings)}
              onCheckedChange={(checked) => updateEnabled(Boolean(checked))}
              aria-label={gt("Enable {provider}", { provider: displayName })}
            />
          </ManagedControl>
        </span>
      </div>
    );
  }

  const headerStatusDot = (
    <span className={cn("size-1.5 shrink-0 rounded-full", statusStyle.dot)} aria-hidden="true" />
  );
  const editorHeaderStatus = (
    <ProviderStatusDiagnostic detail={statusDiagnostic}>
      <div
        tabIndex={statusDiagnostic ? 0 : undefined}
        className="flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground/80"
      >
        {!needsAttention ? headerStatusDot : null}
        <span className="flex min-w-0 items-center gap-1.5 truncate">{editorStatusNode}</span>
      </div>
    </ProviderStatusDiagnostic>
  );

  const hasHeaderAlerts = Boolean(
    restartNotice || isMissingCli || (urlAuthAction && onAcceptUrlAuth),
  );

  const runtimeFields = driverOption ? (
    <ProviderSettingsForm
      definition={driverOption}
      value={instance.config}
      idPrefix={`provider-instance-${instanceId}`}
      variant="settings"
      onChange={updateConfig}
      managed={instanceLocks && { keys: instanceLocks.configKeys, reason: instanceLocks.reason }}
      environmentId={environmentId}
    />
  ) : (
    <SettingsRow
      className={COMPACT_DETAIL_SETTINGS_ROW_CLASSNAME}
      title={gt("Driver")}
      description={
        <span>
          <T>
            This instance uses{" "}
            <code className="text-foreground">
              <Var>{String(instance.driver)}</Var>
            </code>
            , which is not available in this build. Its configuration is preserved.
          </T>
        </span>
      }
    />
  );

  const isManagedCodex =
    instance.driver === "codex" && readCodexSetupMode(instance.config) === "managed";
  const hasRuntimeFields =
    isManagedCodex ||
    !driverOption ||
    deriveProviderSettingsFields(driverOption, instance.config, m).length > 0;
  const hasAcpSessions = environmentId !== undefined && liveProvider?.driver === "acpRegistry";
  const configuredOverrideCount = countAdvancedOverrides(
    instance.config,
    genericEnvironment.length,
    driverKind,
  );
  const displayNameInputId = `provider-instance-${instanceId}-display-name`;

  return (
    <div data-provider-detail-panel={instanceId} className="@container/detail-card space-y-5">
      {/* Unified Compact Header */}
      <header
        data-provider-detail-header={instanceId}
        className="space-y-3 rounded-xl border border-border/55 bg-card/35 px-4 py-3.5 shadow-xs/5"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3.5">
            {editorIconNode}
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="min-w-0 truncate text-base font-semibold tracking-tight text-foreground">
                  {displayName}
                </h2>
                {driverOption?.badgeLabel ? (
                  <Badge variant="warning" size="sm" className="shrink-0">
                    {driverOption.badgeLabel}
                  </Badge>
                ) : null}
                {versionCodeNode}
                {versionAdvisoryNode}
              </div>
              {editorHeaderStatus}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {onRefresh ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost-muted"
                      disabled={isRefreshing}
                      aria-busy={isRefreshing}
                      onClick={onRefresh}
                      aria-label={gt("Refresh provider status")}
                    >
                      <RefreshIcon refreshing={isRefreshing} />
                    </Button>
                  }
                />
                <TooltipPopup side="top">
                  <T>Refresh provider status</T>
                </TooltipPopup>
              </Tooltip>
            ) : null}
            <span
              inert={readOnly}
              aria-disabled={readOnly || undefined}
              className={cn(
                "inline-flex items-center gap-1 empty:hidden",
                readOnly && "opacity-50",
              )}
            >
              {titleTailNode}
              {onDelete ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost-destructive"
                        disabled={readOnly}
                        onClick={onDelete}
                        aria-label={gt("Delete instance {instanceId}", { instanceId })}
                      >
                        <Trash2Icon />
                      </Button>
                    }
                  />
                  <TooltipPopup side="top">{gt("Delete provider configuration")}</TooltipPopup>
                </Tooltip>
              ) : null}
            </span>
          </div>
        </div>

        {hasHeaderAlerts ? (
          <div className="space-y-2 border-t border-border/45 pt-2.5">
            {restartNotice ? (
              <p
                aria-live="polite"
                className="text-xs leading-snug text-muted-foreground [overflow-wrap:anywhere]"
              >
                {restartNotice}
              </p>
            ) : null}
            {isMissingCli ? (
              <AgentInstallPrompt
                compact
                label={displayName}
                homepageUrl={safeHomepageUrl}
                loginHint={cliMeta?.loginHint ?? null}
              />
            ) : null}
            {urlAuthAction && onAcceptUrlAuth ? (
              <div className="grid max-w-xl gap-1.5 text-xs">
                <p>{urlAuthAction.message}</p>
                <code className="break-all text-2xs text-muted-foreground">
                  {urlAuthAction.url}
                </code>
                <Button
                  render={
                    <a
                      href={urlAuthAction.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => onAcceptUrlAuth(urlAuthAction)}
                    />
                  }
                  size="xs"
                  variant="outline"
                  className="w-fit"
                  disabled={readOnly}
                >
                  <ExternalLinkIcon />
                  <T>Continue authentication</T>
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      {/* Card 1 — Basic configuration (Identity & Launch) */}
      <section aria-label={gt("Basic configuration")} className="space-y-2">
        <h3 className="px-1 text-xs font-semibold tracking-tight text-muted-foreground/85">
          {gt("Basic configuration")}
        </h3>
        <div className="divide-y divide-border/45 rounded-xl border border-border/60 bg-card/40 shadow-xs/5">
          <div className="flex flex-col gap-2.5 px-4 py-3 @min-[22rem]/detail-card:flex-row @min-[22rem]/detail-card:items-center @min-[22rem]/detail-card:justify-between @min-[22rem]/detail-card:gap-4">
            <label
              htmlFor={displayNameInputId}
              className="shrink-0 text-sm font-medium text-foreground"
            >
              {gt("Display name")}
            </label>
            <div
              inert={readOnly}
              aria-disabled={readOnly || undefined}
              className={cn(
                "flex w-full min-w-0 items-center justify-end gap-2 @min-[22rem]/detail-card:w-60",
                readOnly && "opacity-50 select-none",
              )}
            >
              <DraftInput
                id={displayNameInputId}
                size="sm"
                className="min-w-0 flex-1"
                value={instance.displayName ?? ""}
                onCommit={updateDisplayName}
                placeholder={driverOption?.label ?? gt("Instance label")}
                spellCheck={false}
              />
              <ProviderAccentColorPicker
                layout="inline"
                displayName={displayName}
                value={accentColor}
                onCommit={updateAccentColor}
              />
            </div>
          </div>

          {dualModeSupported && onLaunchModeChange ? (
            <div className="flex flex-col gap-2.5 px-4 py-3 @min-[22rem]/detail-card:flex-row @min-[22rem]/detail-card:items-center @min-[22rem]/detail-card:justify-between @min-[22rem]/detail-card:gap-4">
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-foreground">
                    {gt("Default launch mode")}
                  </span>
                  {isLaunchModeOverridden && onLaunchModeReset ? (
                    <SettingResetButton
                      ariaLabel={gt("Reset {provider} launch mode to global default", {
                        provider: displayName,
                      })}
                      onClick={onLaunchModeReset}
                    />
                  ) : null}
                </div>
                <p className="text-xs leading-snug text-muted-foreground">
                  {gt("Choose whether new sessions open in Chat or CLI mode.")}
                </p>
              </div>
              <div className="flex shrink-0 items-center justify-end">{launchModeControlSlot}</div>
            </div>
          ) : null}
        </div>
      </section>

      {/* Card 2 — Connection & runtime + Collapsible Advanced */}
      <section aria-label={gt("Connection & runtime")} className="space-y-2">
        <h3 className="px-1 text-xs font-semibold tracking-tight text-muted-foreground/85">
          {gt("Connection & runtime")}
        </h3>
        <div className="divide-y divide-border/45 overflow-hidden rounded-xl border border-border/60 bg-card/40 shadow-xs/5">
          {setup}
          {environmentFields.length > 0 ? (
            <div
              inert={readOnly}
              aria-disabled={readOnly || undefined}
              className={cn(
                "divide-y divide-border/45",
                readOnly && "opacity-50 select-none",
              )}
            >
              {environmentFields.map((field) => (
                <ProviderEnvironmentFieldRow
                  key={field.name}
                  field={field}
                  variable={readProviderEnvironmentVariable(instance.environment, field.name)}
                  idPrefix={`provider-instance-${instanceId}`}
                  onCommit={updateEnvironmentField}
                  onSecretChange={updateEnvironmentFieldSecret}
                  onRemove={removeEnvironmentField}
                  managedReason={
                    instanceLocks?.wholeEnvironment ||
                    instanceLocks?.environmentNames.has(field.name)
                      ? instanceLocks.reason
                      : undefined
                  }
                  secretSources={secretSources}
                  environmentId={environmentId}
                />
              ))}
            </div>
          ) : null}

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger
              data-provider-advanced-toggle={instanceId}
              className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left transition-colors outline-none hover:bg-foreground/[0.025] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="flex min-w-0 items-center gap-2">
                <ChevronRightIcon
                  aria-hidden="true"
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
                    advancedOpen && "rotate-90",
                  )}
                />
                <span className="text-sm font-medium text-foreground">{gt("Advanced")}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {localCommandSummary ? (
                  <code className="max-w-44 truncate rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                    {localCommandSummary}
                  </code>
                ) : null}
                {configuredOverrideCount > 0 ? (
                  <Badge variant="secondary" size="sm">
                    <span className="font-mono tabular-nums">{configuredOverrideCount}</span>
                  </Badge>
                ) : null}
              </span>
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="divide-y divide-border/45 border-t border-border/45 bg-background/25">
                {hasRuntimeFields ? (
                  <div
                    inert={readOnly}
                    aria-disabled={readOnly || undefined}
                    className={cn(
                      "divide-y divide-border/45",
                      readOnly && "opacity-50 select-none",
                    )}
                  >
                    {isManagedCodex ? (runtime ?? runtimeFields) : runtimeFields}
                  </div>
                ) : null}

                <div
                  inert={readOnly || instanceLocks?.wholeEnvironment}
                  aria-disabled={readOnly || instanceLocks?.wholeEnvironment || undefined}
                  className={cn(readOnly && "opacity-50 select-none")}
                >
                  {instanceLocks?.wholeEnvironment ? (
                    <ManagedNotice>{instanceLocks.reason}</ManagedNotice>
                  ) : null}
                  <div className={instanceLocks?.wholeEnvironment ? "opacity-50" : undefined}>
                    <ProviderEnvironmentSection
                      environment={genericEnvironment}
                      onChange={updateGenericEnvironment}
                      secretSources={secretSources}
                      environmentId={environmentId}
                      managed={
                        instanceLocks && {
                          names: instanceLocks.environmentNames,
                          reason: instanceLocks.reason,
                        }
                      }
                    />
                  </div>
                </div>

                {hasAcpSessions ? (
                  <div className="px-4 py-3">
                    <AcpSessionManagementSection
                      environmentId={environmentId}
                      instanceId={instanceId}
                      provider={liveProvider}
                      projects={acpProjects}
                      readOnly={readOnly}
                    />
                  </div>
                ) : null}
              </div>
            </CollapsiblePanel>
          </Collapsible>
        </div>
      </section>

      {/* Card 3 — Models */}
      {driverOption !== undefined ? (
        <section aria-label={gt("Models")} className="space-y-2">
          <h3 className="px-1 text-xs font-semibold tracking-tight text-muted-foreground/85">
            {gt("Models")}
          </h3>
          <div className="rounded-xl border border-border/60 bg-card/40 px-4 py-3.5 shadow-xs/5 sm:px-5 sm:py-4">
            <ProviderModelsSection
              canManageCustomModels={!readOnly}
              canWritePreferences={canWriteSettings}
              instanceId={instanceId}
              driverKind={driverKind}
              models={modelsForDisplay}
              customModels={customModels}
              hiddenModels={hiddenModels}
              favoriteModels={favoriteModels}
              modelOrder={modelOrder}
              onChange={updateCustomModels}
              onHiddenModelsChange={onHiddenModelsChange}
              onFavoriteModelsChange={onFavoriteModelsChange}
              onToggleFavorite={onToggleFavorite}
              onModelOrderChange={onModelOrderChange}
            />
          </div>
        </section>
      ) : null}

      {/* Compact Danger Zone */}
      {onDelete && !readOnly ? (
        <section aria-label={gt("Danger zone")} className="space-y-2">
          <h3 className="px-1 text-xs font-semibold tracking-tight text-muted-foreground/85">
            {gt("Danger zone")}
          </h3>
          <div className="rounded-xl border border-destructive/25 bg-destructive/[0.03] px-4 py-3 shadow-xs/5">
            <div className="flex flex-col gap-2.5 @min-[22rem]/detail-card:flex-row @min-[22rem]/detail-card:items-center @min-[22rem]/detail-card:justify-between @min-[22rem]/detail-card:gap-4">
              <div className="min-w-0 flex-1 space-y-0.5">
                <h4 className="text-sm font-medium text-foreground">
                  {gt("Delete provider configuration")}
                </h4>
                <p className="text-xs leading-snug text-muted-foreground">
                  {removalKind === "remove-builtin"
                    ? gt(
                        "Remove this built-in provider from your configured list and clear its custom settings. Existing conversation history is kept, and you can restore it anytime from Add provider.",
                      )
                    : gt(
                        "Remove this provider's connection, environment variables, and model settings. Existing conversation history is kept, and you can add it again anytime from Add provider.",
                      )}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="shrink-0"
                disabled={readOnly}
                data-provider-delete-detail={instanceId}
                onClick={onDelete}
              >
                <Trash2Icon className="size-3.5" />
                <span>{gt("Delete provider configuration")}</span>
              </Button>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
