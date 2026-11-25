/* oxlint-disable prismux/no-untranslated-copy -- locale-switched bilingual copy (zh-CN / en) for Prismux API relay quota settings */
import {
  type UnifiedSettings,
  UsageLimitSourceId,
  type UsageLimitSourceKind,
  type UsageLimitSourceSnapshot,
} from "@prismux/core-contracts";

import { getActiveLocale } from "../../i18n/messages";

export type RelayQuotaLocale = "zh" | "en";

export const RELAY_PROTOCOL_ORDER: ReadonlyArray<UsageLimitSourceKind> = [
  "newapi",
  "openaiBilling",
  "cliproxy",
];

const SOURCE_ID_PREFIX: Readonly<Record<UsageLimitSourceKind, string>> = {
  newapi: "newapi",
  openaiBilling: "relay",
  cliproxy: "cliproxy",
};

export function resolveRelayQuotaLocale(locale?: string | null): RelayQuotaLocale {
  const normalized = (locale ?? getActiveLocale() ?? "en").toLowerCase();
  return normalized.startsWith("zh") ? "zh" : "en";
}

export function sourceIdFromUrl(
  url: string,
  sources: UnifiedSettings["usageLimitSources"],
  kind: UsageLimitSourceKind = "newapi",
): UsageLimitSourceId {
  const saved = Object.entries(sources).find(([, source]) => source.url === url);
  if (saved) return UsageLimitSourceId.make(saved[0]);
  let host = url;
  try {
    host = new URL(url).host;
  } catch {}
  const slug = host
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // Settings merge by ID, so adding a different relay must not replace an existing entry.
  const prefix = SOURCE_ID_PREFIX[kind];
  const base = `${prefix}-${slug || "relay"}`;
  let id = base;
  for (let suffix = 2; id in sources; suffix += 1) {
    id = `${base}-${suffix}`;
  }
  return UsageLimitSourceId.make(id);
}

export interface RelayProtocolMeta {
  readonly kind: UsageLimitSourceKind;
  readonly title: string;
  readonly subtitle: string;
  readonly badgeLabel: string;
  readonly urlLabel: string;
  readonly urlPlaceholder: string;
  readonly keyLabel: string;
  readonly labelPlaceholder: string;
  readonly showUserId: boolean;
  readonly userIdLabel: string;
  readonly userIdPlaceholder: string;
}

export function getRelayProtocolMeta(
  kind: UsageLimitSourceKind,
  locale: RelayQuotaLocale,
): RelayProtocolMeta {
  const isZh = locale === "zh";
  switch (kind) {
    case "newapi":
      return {
        kind,
        title: "New API / One API",
        subtitle: "New API · One API · Veloera",
        badgeLabel: "New API / One API",
        urlLabel: isZh ? "中转站地址" : "Relay URL",
        urlPlaceholder: "https://api.example.com",
        keyLabel: isZh ? "API 密钥（sk-...）或系统访问令牌" : "API key (sk-...) or system access token",
        labelPlaceholder: isZh ? "默认使用中转站域名" : "Defaults to the relay host name",
        showUserId: true,
        userIdLabel: isZh ? "用户 ID（New-Api-User，选填）" : "User ID (New-Api-User, optional)",
        userIdPlaceholder: isZh
          ? "使用系统访问令牌时填写，如 1"
          : "Required for system access tokens, e.g. 1",
      };
    case "openaiBilling":
      return {
        kind,
        title: isZh ? "OpenAI 兼容" : "OpenAI Compatible",
        subtitle: isZh ? "通用余额查询接口" : "Standard billing balance API",
        badgeLabel: isZh ? "OpenAI 兼容" : "OpenAI Compatible",
        urlLabel: isZh ? "中转站地址" : "Relay URL",
        urlPlaceholder: "https://api.example.com/v1",
        keyLabel: isZh ? "API 密钥（sk-...）" : "API key (sk-...)",
        labelPlaceholder: isZh ? "默认使用中转站域名" : "Defaults to the relay host name",
        showUserId: false,
        userIdLabel: "",
        userIdPlaceholder: "",
      };
    case "cliproxy":
      return {
        kind,
        title: "CLIProxyAPI",
        subtitle: isZh ? "兼容协议 · 多账号配额" : "Legacy protocol · multi-account",
        badgeLabel: isZh ? "CLIProxyAPI（兼容）" : "CLIProxyAPI (Legacy)",
        urlLabel: isZh ? "服务地址" : "Proxy URL",
        urlPlaceholder: "https://proxy.example.com:8318",
        keyLabel: isZh ? "管理密钥" : "Management key",
        labelPlaceholder: isZh ? "默认使用服务域名" : "Defaults to the proxy host name",
        showUserId: false,
        userIdLabel: "",
        userIdPlaceholder: "",
      };
  }
}

export interface UsageProviderSettingsCopy {
  readonly sectionTitle: string;
  readonly addRelay: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly configuredCount: (count: number) => string;
  readonly disabledBadge: string;
  readonly edit: string;
  readonly remove: string;
  readonly cancel: string;
  readonly confirmRemoveTitle: (label: string) => string;
  readonly confirmRemoveDescription: (environmentLabel: string) => string;
  readonly confirmRemoveAction: string;
  readonly toggleAria: (label: string) => string;
}

export function getUsageProviderSettingsCopy(
  locale: RelayQuotaLocale,
): UsageProviderSettingsCopy {
  if (locale === "zh") {
    return {
      sectionTitle: "API 中转站配额",
      addRelay: "添加中转站",
      emptyTitle: "尚未配置 API 中转站",
      emptyDescription:
        "接入 New API、One API 或通用 OpenAI 兼容中转站，实时追踪余额与配额消耗（同时兼容 CLIProxyAPI）。",
      configuredCount: (count) => `已配置 ${count} 个中转站`,
      disabledBadge: "已停用",
      edit: "编辑",
      remove: "移除",
      cancel: "取消",
      confirmRemoveTitle: (label) => `移除「${label}」？`,
      confirmRemoveDescription: (environmentLabel) =>
        `将从 ${environmentLabel} 中删除该中转站保存的密钥，并从用量配额面板移除其展示；不会影响远端中转站账号本身。`,
      confirmRemoveAction: "移除中转站",
      toggleAria: (label) => `启用或停用 ${label}`,
    };
  }
  return {
    sectionTitle: "API Relay Quotas",
    addRelay: "Add relay",
    emptyTitle: "No API relays configured",
    emptyDescription:
      "Connect New API, One API, or any OpenAI-compatible relay to track live balances and quota usage (CLIProxyAPI also supported).",
    configuredCount: (count) => `${count} ${count === 1 ? "relay" : "relays"} configured`,
    disabledBadge: "Disabled",
    edit: "Edit",
    remove: "Remove",
    cancel: "Cancel",
    confirmRemoveTitle: (label) => `Remove ${label}?`,
    confirmRemoveDescription: (environmentLabel) =>
      `The stored key is deleted from ${environmentLabel} and its quota entries leave the Usage view. The remote relay account itself is untouched.`,
    confirmRemoveAction: "Remove relay",
    toggleAria: (label) => `Toggle ${label}`,
  };
}

export interface RelayDialogCopy {
  readonly addTitle: string;
  readonly editTitle: string;
  readonly description: (environmentLabel: string) => string;
  readonly protocolLabel: string;
  readonly nameLabel: string;
  readonly cancel: string;
  readonly addAction: string;
  readonly saveAction: string;
}

export function getRelayDialogCopy(locale: RelayQuotaLocale): RelayDialogCopy {
  if (locale === "zh") {
    return {
      addTitle: "添加 API 中转站",
      editTitle: "编辑 API 中转站",
      description: (environmentLabel) =>
        `连接 New API、One API 或通用 OpenAI 兼容中转站以追踪余额与配额，密钥仅加密保存在 ${environmentLabel} 本机环境中。`,
      protocolLabel: "中转站协议",
      nameLabel: "显示名称（选填）",
      cancel: "取消",
      addAction: "添加中转站",
      saveAction: "保存修改",
    };
  }
  return {
    addTitle: "Add API Relay",
    editTitle: "Edit API Relay",
    description: (environmentLabel) =>
      `Connect New API, One API, or any OpenAI-compatible relay to track balances and quotas. Keys are stored encrypted on ${environmentLabel}.`,
    protocolLabel: "Relay protocol",
    nameLabel: "Label (optional)",
    cancel: "Cancel",
    addAction: "Add relay",
    saveAction: "Save changes",
  };
}

export interface RelaySnapshotSummary {
  readonly tone: "success" | "error" | "neutral";
  readonly text: string;
}

export function summarizeUsageLimitSourceSnapshot(
  snapshot: UsageLimitSourceSnapshot | undefined,
  locale: RelayQuotaLocale,
): RelaySnapshotSummary | null {
  if (!snapshot) return null;
  if (snapshot.error) {
    return { tone: "error", text: snapshot.error };
  }
  if (snapshot.accounts.length === 0) {
    return {
      tone: "neutral",
      text: locale === "zh" ? "暂无配额数据" : "No quota reported",
    };
  }
  for (const account of snapshot.accounts) {
    const balanceWindow = account.usageLimits.windows.find(
      (window) => window.id === "relay-balance",
    );
    if (balanceWindow) {
      return { tone: "success", text: balanceWindow.label };
    }
  }
  const readableCount = snapshot.accounts.filter(
    (account) => !account.usageLimits.unavailable && account.usageLimits.windows.length > 0,
  ).length;
  if (readableCount > 0) {
    return {
      tone: "success",
      text:
        locale === "zh"
          ? `已同步 ${readableCount} 个账号`
          : `${readableCount} ${readableCount === 1 ? "account" : "accounts"} synced`,
    };
  }
  return {
    tone: "neutral",
    text: locale === "zh" ? "等待同步配额" : "Pending quota sync",
  };
}
