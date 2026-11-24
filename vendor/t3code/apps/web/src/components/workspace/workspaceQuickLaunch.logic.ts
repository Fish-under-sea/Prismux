import {
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  type EnvironmentId,
  type ModelSelection,
  type ProviderInstanceId,
  type ThreadId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import * as Schema from "effect/Schema";

import {
  formatAgentBrandName,
  resolveAgentBrandId,
  resolveProviderEntryDisplayName,
  type AgentBrandId,
} from "../../prismux/agentBrand";
import {
  disambiguateProviderInstanceDisplayNames,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import type { WorkspaceTab } from "./workspaceTabsStore";

const isProviderDriverKind = Schema.is(ProviderDriverKind);

export type QuickLaunchToolId = "terminal" | "diff" | "browser" | "simulator" | "settings";

export interface QuickLaunchToolDescriptor {
  readonly id: QuickLaunchToolId;
  readonly label: string;
  readonly tooltip: string;
  readonly keywords: ReadonlyArray<string>;
}

export const QUICK_LAUNCH_TOOLS: ReadonlyArray<QuickLaunchToolDescriptor> = [
  {
    id: "terminal",
    label: "PowerShell",
    tooltip: "PowerShell / 默认终端",
    keywords: ["terminal", "powershell", "pwsh", "shell", "cmd", "终端", "命令行"],
  },
  {
    id: "diff",
    label: "差异",
    tooltip: "差异 (Diff)",
    keywords: ["diff", "git", "changes", "差异", "变更", "对比"],
  },
  {
    id: "browser",
    label: "内置浏览器",
    tooltip: "内置浏览器",
    keywords: ["browser", "preview", "web", "url", "浏览器", "预览", "网页"],
  },
  {
    id: "simulator",
    label: "手机模拟器",
    tooltip: "手机模拟器",
    keywords: ["simulator", "mobile", "phone", "ios", "android", "手机", "模拟器", "移动"],
  },
  {
    id: "settings",
    label: "设置",
    tooltip: "设置",
    keywords: ["settings", "preferences", "config", "设置", "配置"],
  },
];

export interface QuickLaunchHistoryThread {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly projectName?: string | null | undefined;
  readonly providerId?: string | null | undefined;
  readonly instanceId?: ProviderInstanceId | null | undefined;
  readonly updatedAt?: string | number | null | undefined;
}

export interface QuickLaunchAgentOption {
  readonly id: string;
  readonly instanceId: ProviderInstanceId | null;
  readonly driverKind: ProviderDriverKind | string;
  readonly brandId: AgentBrandId;
  readonly displayName: string;
  readonly defaultModel: string | null;
  readonly subtitle: string | null;
  readonly available: boolean;
  readonly recentThreads: ReadonlyArray<QuickLaunchHistoryThread>;
}

export interface QuickLaunchOpenTabMatch {
  readonly tab: WorkspaceTab;
  readonly paneId: string;
}

export interface QuickLaunchUrlTarget {
  readonly raw: string;
  readonly normalizedUrl: string;
  readonly displayHost: string;
}

export interface QuickLaunchSearchResult {
  readonly query: string;
  readonly isSearching: boolean;
  readonly urlTarget: QuickLaunchUrlTarget | null;
  readonly openTabs: ReadonlyArray<QuickLaunchOpenTabMatch>;
  readonly historyThreads: ReadonlyArray<QuickLaunchHistoryThread>;
  readonly agents: ReadonlyArray<QuickLaunchAgentOption>;
  readonly tools: ReadonlyArray<QuickLaunchToolDescriptor>;
}

const DISALLOWED_SCHEMES = /^(javascript|data|vbscript|file|blob):/i;
const EXPLICIT_HTTP_URL = /^https?:\/\/[^\s]+$/i;
const LOCALHOST_WITH_PORT = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d{2,5})(\/[^\s]*)?$/i;
const DOMAIN_LIKE = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,18}(:\d{2,5})?(\/[^\s]*)?$/i;

/**
 * Classifies omnibox input as a navigable http(s) URL (aligned with Orca's tab-create-entry URL classifier).
 * Rejects dangerous schemes (`javascript:`, `data:`, `file:`, etc.) and plain words.
 */
export function classifyQuickLaunchUrl(raw: string): QuickLaunchUrlTarget | null {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed) || DISALLOWED_SCHEMES.test(trimmed)) {
    return null;
  }

  let candidate: string | null = null;
  if (EXPLICIT_HTTP_URL.test(trimmed)) {
    candidate = trimmed;
  } else if (LOCALHOST_WITH_PORT.test(trimmed)) {
    candidate = `http://${trimmed}`;
  } else if (DOMAIN_LIKE.test(trimmed)) {
    candidate = `https://${trimmed}`;
  }

  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (!parsed.hostname) return null;
    return {
      raw: trimmed,
      normalizedUrl: parsed.toString(),
      displayHost: parsed.host,
    };
  } catch {
    return null;
  }
}

function defaultModelForEntry(entry: ProviderInstanceEntry): string | null {
  return (
    entry.models.find((m) => m.isDefault && !m.isCustom)?.slug ??
    entry.models.find((m) => !m.isCustom)?.slug ??
    entry.models[0]?.slug ??
    null
  );
}

const DEFAULT_FALLBACK_AGENTS: ReadonlyArray<{
  readonly driverKind: string;
  readonly providerId: string;
}> = [
  { driverKind: "claudeAgent", providerId: "claude-code" },
  { driverKind: "codex", providerId: "codex" },
  { driverKind: "antigravity", providerId: "antigravity" },
  { driverKind: "omp", providerId: "omp" },
];

/**
 * Builds the Orca-style Agent launch list from active/enabled T3 provider entries,
 * normalizing names via `formatAgentBrandName` and attaching per-agent recent threads
 * for the Safe Triangle hover submenu.
 */
export function buildQuickLaunchAgentOptions(input: {
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly historyThreads: ReadonlyArray<QuickLaunchHistoryThread>;
}): ReadonlyArray<QuickLaunchAgentOption> {
  const enabledEntries = input.instanceEntries.filter((entry) => entry.enabled);
  const byBrandThreads = new Map<string, QuickLaunchHistoryThread[]>();

  for (const thread of input.historyThreads) {
    const instanceKey = thread.instanceId ? `instance:${thread.instanceId}` : null;
    if (instanceKey) {
      const list = byBrandThreads.get(instanceKey) ?? [];
      list.push(thread);
      byBrandThreads.set(instanceKey, list);
    }
    const brandId = resolveAgentBrandId(thread.providerId ?? thread.instanceId);
    const brandKey = `brand:${brandId}`;
    const list = byBrandThreads.get(brandKey) ?? [];
    list.push(thread);
    byBrandThreads.set(brandKey, list);
  }

  if (enabledEntries.length === 0) {
    return DEFAULT_FALLBACK_AGENTS.map((fallback) => {
      const brandId = resolveAgentBrandId(fallback.providerId);
      return {
        id: `fallback:${fallback.providerId}`,
        instanceId: null,
        driverKind: fallback.driverKind,
        brandId,
        displayName: formatAgentBrandName(fallback.providerId),
        defaultModel: null,
        subtitle: null,
        available: true,
        recentThreads: (byBrandThreads.get(`brand:${brandId}`) ?? []).slice(0, 6),
      };
    });
  }

  const normalizedEnabledEntries = disambiguateProviderInstanceDisplayNames(
    enabledEntries.map((entry) => ({
      ...entry,
      displayName: resolveProviderEntryDisplayName(entry),
    })),
  );

  return normalizedEnabledEntries.map((entry) => {
    const brandId = resolveAgentBrandId(
      entry.driverKind === "acpRegistry" ? entry.displayName || entry.instanceId : entry.driverKind,
    );
    const canonicalName = entry.displayName;
    const defaultModel = defaultModelForEntry(entry);
    const exactThreads = byBrandThreads.get(`instance:${entry.instanceId}`) ?? [];
    const brandThreads = byBrandThreads.get(`brand:${brandId}`) ?? [];
    const seen = new Set<string>();
    const recentThreads: QuickLaunchHistoryThread[] = [];
    for (const thread of [...exactThreads, ...brandThreads]) {
      const key = `${thread.environmentId}:${thread.threadId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      recentThreads.push(thread);
      if (recentThreads.length >= 6) break;
    }

    return {
      id: entry.instanceId,
      instanceId: entry.instanceId,
      driverKind: entry.driverKind,
      brandId,
      displayName: canonicalName,
      defaultModel,
      subtitle: defaultModel,
      available: entry.isAvailable && entry.status !== "disabled",
      recentThreads,
    };
  });
}

export interface ResolvedQuickLaunchAgentTarget {
  readonly providerId: string;
  readonly instanceId: ProviderInstanceId | null;
  readonly model: string;
  readonly modelSelection: ModelSelection | null;
}

/**
 * Resolves a quick-launched agent option into concrete provider/instance/model coordinates,
 * guaranteed to yield a valid ModelSelection for built-in agents (Codex / Claude Code / Antigravity)
 * even before server provider configs finish hydrating.
 */
export function resolveQuickLaunchAgentTarget(
  agent: Pick<QuickLaunchAgentOption, "brandId" | "driverKind" | "instanceId" | "defaultModel">,
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>,
): ResolvedQuickLaunchAgentTarget {
  const providerId = agent.brandId === "custom" ? String(agent.driverKind) : agent.brandId;
  const matchedEntry =
    (agent.instanceId
      ? instanceEntries.find((entry) => entry.instanceId === agent.instanceId)
      : undefined) ??
    instanceEntries.find(
      (entry) =>
        entry.enabled &&
        resolveAgentBrandId(
          entry.driverKind === "acpRegistry" ? entry.displayName || entry.instanceId : entry.driverKind,
        ) === agent.brandId,
    ) ??
    instanceEntries.find((entry) => entry.driverKind === agent.driverKind) ??
    null;

  const resolvedInstanceId: ProviderInstanceId | null =
    matchedEntry?.instanceId ??
    agent.instanceId ??
    (isProviderDriverKind(agent.driverKind) ? defaultInstanceIdForDriver(agent.driverKind) : null);

  const driverKindForDefault =
    matchedEntry?.driverKind ?? (isProviderDriverKind(agent.driverKind) ? agent.driverKind : null);

  const resolvedModel =
    agent.defaultModel ??
    (matchedEntry ? defaultModelForEntry(matchedEntry) : null) ??
    (driverKindForDefault ? DEFAULT_MODEL_BY_PROVIDER[driverKindForDefault] : undefined) ??
    DEFAULT_MODEL;

  const modelSelection = resolvedInstanceId
    ? createModelSelection(resolvedInstanceId, resolvedModel)
    : null;

  return {
    providerId,
    instanceId: resolvedInstanceId,
    model: resolvedModel,
    modelSelection,
  };
}

function matchesAllTokens(haystack: string, tokens: ReadonlyArray<string>): boolean {
  const lower = haystack.toLowerCase();
  return tokens.every((token) => lower.includes(token));
}

export function filterQuickLaunchResults(
  rawQuery: string,
  input: {
    readonly openTabs: ReadonlyArray<QuickLaunchOpenTabMatch>;
    readonly historyThreads: ReadonlyArray<QuickLaunchHistoryThread>;
    readonly agents: ReadonlyArray<QuickLaunchAgentOption>;
  },
): QuickLaunchSearchResult {
  const trimmed = rawQuery.trim();
  if (!trimmed) {
    return {
      query: "",
      isSearching: false,
      urlTarget: null,
      openTabs: [],
      historyThreads: [],
      agents: input.agents,
      tools: QUICK_LAUNCH_TOOLS,
    };
  }

  const tokens = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  const urlTarget = classifyQuickLaunchUrl(trimmed);

  const openTabs = input.openTabs.filter(({ tab }) => {
    const brand = tab.providerId ? formatAgentBrandName(tab.providerId) : "";
    const text = [tab.title, tab.kind, tab.providerId ?? "", brand, tab.url ?? "", tab.shell ?? ""].join(" ");
    return matchesAllTokens(text, tokens);
  });

  const historyThreads = input.historyThreads
    .filter((thread) => {
      const brand = thread.providerId ? formatAgentBrandName(thread.providerId) : "";
      const text = [
        thread.title,
        thread.projectName ?? "",
        thread.providerId ?? "",
        brand,
      ].join(" ");
      return matchesAllTokens(text, tokens);
    })
    .slice(0, 8);

  const agents = input.agents.filter((agent) => {
    const text = [
      agent.displayName,
      agent.driverKind,
      agent.instanceId ?? "",
      agent.brandId,
      agent.defaultModel ?? "",
    ].join(" ");
    return matchesAllTokens(text, tokens);
  });

  const tools = QUICK_LAUNCH_TOOLS.filter((tool) => {
    const text = [tool.label, tool.tooltip, ...tool.keywords].join(" ");
    return matchesAllTokens(text, tokens);
  });

  return {
    query: trimmed,
    isSearching: true,
    urlTarget,
    openTabs,
    historyThreads,
    agents,
    tools,
  };
}
