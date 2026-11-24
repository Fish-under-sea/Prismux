import { rankComposerModelMentions } from "@t3tools/client-runtime/composer-model-mentions";
import type { ProviderInstanceId } from "@t3tools/contracts";

import { isProviderInstancePickerReady, type ProviderInstanceEntry } from "../../providerInstances";
import type { ComposerCommandItem } from "./ComposerCommandMenu";
import { getDisplayModelName, type ModelEsque } from "./providerIconUtils";

type ComposerModelItem = Extract<ComposerCommandItem, { type: "model" }>;

const COMPOSER_READY_AGENT_LIMIT = 6;
const COMPOSER_CATEGORY_MODEL_LIMIT = 8;

const AGENT_MENTION_KEYWORDS = new Set([
  "agent",
  "agents",
  "代理",
  "助手",
  "工作",
  "工作agent",
  "工作代理",
  "智能体",
  "代",
  "助",
  "工",
  "智",
]);

const MODEL_MENTION_KEYWORDS = new Set(["模型", "模", "model", "models"]);

function toComposerModelItem(
  entry: ProviderInstanceEntry,
  option: ModelEsque,
  options?: { readonly label?: string; readonly description?: string },
): ComposerModelItem {
  return {
    id: `model:${entry.instanceId}:${option.slug}`,
    type: "model",
    instanceId: entry.instanceId,
    model: option.slug,
    driverKind: entry.driverKind,
    providerDisplayName: entry.displayName,
    acpRegistryAgentId: entry.acpRegistryAgentId,
    acpRegistryIconUrl: entry.acpRegistryIconUrl,
    label: options?.label ?? getDisplayModelName(option),
    description: options?.description ?? option.subProvider ?? entry.displayName,
  };
}

function buildReadyAgentItems(
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>,
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>,
  limit: number,
): ComposerModelItem[] {
  const readyAgents: ComposerModelItem[] = [];
  for (const entry of instanceEntries) {
    if (!isProviderInstancePickerReady(entry)) continue;
    const availableOptions = (modelOptionsByInstance.get(entry.instanceId) ?? []).filter(
      (option) => !option.isLegacy && !option.isUnavailable,
    );
    const primaryOption =
      availableOptions.find((option) => option.isDefault) ?? availableOptions[0];
    if (!primaryOption) continue;

    readyAgents.push(
      toComposerModelItem(entry, primaryOption, {
        label: entry.displayName,
        description: `工作 Agent · ${getDisplayModelName(primaryOption)}`,
      }),
    );
    if (readyAgents.length >= limit) break;
  }
  return readyAgents;
}

export function matchComposerModelItems(input: {
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>;
  readonly query: string;
  /** When true, bare `@` surfaces up to 6 ready working Agent provider entries. */
  readonly includeReadyAgentsOnEmptyQuery?: boolean;
}): ComposerModelItem[] {
  const trimmedQuery = input.query.trim();
  const normalizedQuery = trimmedQuery.toLowerCase();

  if (normalizedQuery.length === 0) {
    if (input.includeReadyAgentsOnEmptyQuery !== true) {
      return [];
    }
    return buildReadyAgentItems(
      input.instanceEntries,
      input.modelOptionsByInstance,
      COMPOSER_READY_AGENT_LIMIT,
    );
  }

  const candidates: Array<{ entry: ProviderInstanceEntry; option: ModelEsque }> = [];
  for (const entry of input.instanceEntries) {
    if (!isProviderInstancePickerReady(entry)) continue;
    for (const option of input.modelOptionsByInstance.get(entry.instanceId) ?? []) {
      // The picker hides legacy models by default; skip them so they don't fill the result cap.
      if (option.isLegacy || option.isUnavailable) continue;
      candidates.push({ entry, option });
    }
  }

  const rankedMatches = rankComposerModelMentions(candidates, input.query, ({ entry, option }) => ({
    name: option.name,
    ...(option.shortName ? { shortName: option.shortName } : {}),
    ...(option.subProvider ? { subProvider: option.subProvider } : {}),
    driverKind: entry.driverKind,
    providerDisplayName: entry.displayName,
  })).map(({ entry, option }) => toComposerModelItem(entry, option));

  if (AGENT_MENTION_KEYWORDS.has(normalizedQuery)) {
    const readyAgents = buildReadyAgentItems(
      input.instanceEntries,
      input.modelOptionsByInstance,
      COMPOSER_READY_AGENT_LIMIT,
    );
    const seen = new Set(readyAgents.map((item) => item.id));
    const combined = [...readyAgents];
    for (const match of rankedMatches) {
      if (seen.has(match.id)) continue;
      seen.add(match.id);
      combined.push(match);
      if (combined.length >= COMPOSER_CATEGORY_MODEL_LIMIT) break;
    }
    return combined;
  }

  if (MODEL_MENTION_KEYWORDS.has(normalizedQuery)) {
    const seen = new Set<string>();
    const combined: ComposerModelItem[] = [];
    for (const agent of buildReadyAgentItems(
      input.instanceEntries,
      input.modelOptionsByInstance,
      COMPOSER_READY_AGENT_LIMIT,
    )) {
      seen.add(agent.id);
      combined.push(agent);
    }
    for (const { entry, option } of candidates) {
      const item = toComposerModelItem(entry, option, {
        description: `工作 Agent · ${option.subProvider ?? entry.displayName}`,
      });
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      combined.push(item);
      if (combined.length >= COMPOSER_CATEGORY_MODEL_LIMIT) break;
    }
    return combined;
  }

  return rankedMatches;
}
