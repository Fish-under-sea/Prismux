import {
  ANTIGRAVITY_DEFAULT_MODEL,
  MUSE_DEFAULT_MODEL,
  type ServerProvider,
} from "@prismux/core-contracts";
import type { UnifiedSettings } from "@prismux/core-contracts/settings";

import { getAppModelOptionsForInstance } from "../../modelSelection";
import {
  brandProviderInstanceEntries,
  containsUuidNoise,
  deriveProviderInstanceEntries,
  disambiguateProviderInstanceDisplayNames,
  orderItemsByConfiguredProviderOrder,
  orderProviderInstanceEntries,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import {
  formatAgentBrandName,
  resolveAgentBrandId,
  resolveProviderEntryDisplayName,
  toCanonicalChiefProviderId,
} from "../agentBrand";
import {
  isAntigravityControlledAutomationAllowed,
  type SubscriptionWaiverState,
} from "../SubscriptionRiskWaiverSection";
import type {
  DaemonOvernightConfigPatch,
  DaemonOvernightConfigSnapshot,
  DaemonOvernightInboundMode,
  DaemonOvernightMailPreset,
  DaemonOvernightRunStatus,
  DaemonOvernightWindowMode,
} from "../daemonClient";

export const DEFAULT_DAEMON_ORIGIN = "http://127.0.0.1:47777";
export const GMAIL_OAUTH_CALLBACK_PATH = "/v1/overnight/oauth/gmail/callback";
export const GMAIL_OAUTH_SCOPES_TEXT =
  "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send";
export const OVERNIGHT_DEFAULT_MODEL_SENTINEL = "__overnight_provider_default__";

export interface OvernightExternalLinkSpec {
  readonly id: string;
  readonly label: string;
  readonly url: string;
}

export const GMAIL_APP_PASSWORD_LINKS: ReadonlyArray<OvernightExternalLinkSpec> = [
  {
    id: "twosv",
    label: "打开 Google 两步验证",
    url: "https://myaccount.google.com/signinoptions/twosv",
  },
  {
    id: "apppasswords",
    label: "直达生成应用专用密码",
    url: "https://myaccount.google.com/apppasswords",
  },
];

export const GMAIL_OAUTH_QUICK_LINKS: ReadonlyArray<OvernightExternalLinkSpec> = [
  {
    id: "projectcreate",
    label: "1. 创建项目",
    url: "https://console.cloud.google.com/projectcreate",
  },
  {
    id: "gmail-api",
    label: "2. 启用 Gmail API",
    url: "https://console.cloud.google.com/apis/library/gmail.googleapis.com",
  },
  {
    id: "consent",
    label: "3. 配置同意屏幕",
    url: "https://console.cloud.google.com/apis/credentials/consent",
  },
  {
    id: "oauthclient",
    label: "4. 创建 OAuth 客户端",
    url: "https://console.cloud.google.com/apis/credentials/oauthclient",
  },
];

export type GmailOAuthTutorialStepNumber = 1 | 2 | 3 | 4 | 5;

export interface GmailOAuthTutorialStepSpec {
  readonly step: GmailOAuthTutorialStepNumber;
  readonly shortLabel: string;
  readonly title: string;
  readonly description: string;
  readonly pitfall?: string;
  readonly actionLabel?: string;
  readonly actionUrl?: string;
}

export const GMAIL_OAUTH_TUTORIAL_STEPS: ReadonlyArray<GmailOAuthTutorialStepSpec> = [
  {
    step: 1,
    shortLabel: "1. 创建项目",
    title: "Step 1 · 创建或选择 Google Cloud 项目",
    description:
      "打开 Google Cloud Console，新建一个专属项目（例如命名为 Prismux-Overnight），或选择你已有的个人项目。创建完成后请确认页面左上角项目选择器已切换到该项目。",
    actionLabel: "直达创建项目",
    actionUrl: "https://console.cloud.google.com/projectcreate",
  },
  {
    step: 2,
    shortLabel: "2. 启用 API",
    title: "Step 2 · 启用 Gmail API",
    description:
      "在当前项目下打开 Gmail API 控制台页面，点击蓝色「启用 (Enable)」按钮，开通邮件读取与发送接口权限。",
    actionLabel: "直达启用 Gmail API",
    actionUrl: "https://console.cloud.google.com/apis/library/gmail.googleapis.com",
  },
  {
    step: 3,
    shortLabel: "3. 同意屏幕",
    title: "Step 3 · 配置 OAuth 同意屏幕并添加测试用户",
    description:
      "在「OAuth 同意屏幕 (OAuth consent screen)」中选择 External (外部)，填写应用名称与联系邮箱，并在权限范围中添加下方两条 Gmail Scope（读写与发送）。",
    pitfall:
      "最常见踩坑点：请务必在「Test users (测试用户)」列表中手动添加你自己的 Gmail 邮箱地址，否则授权登录时 Google 会直接报错 Access blocked (403)！",
    actionLabel: "直达 OAuth 同意屏幕",
    actionUrl: "https://console.cloud.google.com/apis/credentials/consent",
  },
  {
    step: 4,
    shortLabel: "4. 客户端 ID",
    title: "Step 4 · 创建「Web 应用」OAuth 客户端 ID 并填入回调地址",
    description:
      "在「创建 OAuth 客户端 ID」页面中，将应用类型（Application type）设为「Web application (Web 应用)」，然后在「Authorized redirect URIs (已获授权的重定向 URI)」中粘贴下方本地回调地址并点击创建。",
    actionLabel: "直达创建 OAuth 客户端",
    actionUrl: "https://console.cloud.google.com/apis/credentials/oauthclient",
  },
  {
    step: 5,
    shortLabel: "5. 粘贴授权",
    title: "Step 5 · 粘贴 Client ID / Client Secret 并一键授权",
    description:
      "将 Google 生成的 Client ID 与 Client Secret 粘贴到下方表单，待两项均显示就绪后点击「保存凭据并启动浏览器授权」，在浏览器中完成同意即可自动回填绑定邮箱。",
  },
];

export interface OvernightMailPresetOption {
  readonly id: DaemonOvernightMailPreset;
  readonly label: string;
  readonly note: string;
  readonly imapHost: string;
  readonly imapPort: number;
  readonly imapSecure: boolean;
  readonly smtpHost: string;
  readonly smtpPort: number;
  readonly smtpSecure: boolean;
}

export const OVERNIGHT_MAIL_PRESETS: ReadonlyArray<OvernightMailPresetOption> = [
  {
    id: "qq",
    label: "QQ 邮箱",
    note: "imap.qq.com:993 · smtp.qq.com:465 (SSL)",
    imapHost: "imap.qq.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.qq.com",
    smtpPort: 465,
    smtpSecure: true,
  },
  {
    id: "163",
    label: "163 邮箱",
    note: "imap.163.com:993 · smtp.163.com:465 (SSL)",
    imapHost: "imap.163.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.163.com",
    smtpPort: 465,
    smtpSecure: true,
  },
  {
    id: "gmail",
    label: "谷歌邮箱 (Gmail)",
    note: "imap.gmail.com:993 · smtp.gmail.com:465 (SSL)",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
  },
  {
    id: "outlook",
    label: "Outlook / Exchange",
    note: "outlook.office365.com:993 · smtp.office365.com:587 (STARTTLS)",
    imapHost: "outlook.office365.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    smtpSecure: false,
  },
  {
    id: "custom",
    label: "自定义",
    note: "手动填写任意企业或自建 IMAP / SMTP 服务",
    imapHost: "",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "",
    smtpPort: 465,
    smtpSecure: true,
  },
];

export interface OvernightLiveModelOption {
  readonly slug: string;
  readonly label: string;
  readonly subtitle?: string;
  readonly isCustom?: boolean;
  readonly isDefault?: boolean;
  readonly isLegacyFallback?: boolean;
}

export interface OvernightLiveProviderOption {
  readonly id: string;
  readonly brandProvider: string;
  readonly label: string;
  readonly isChief?: boolean;
  readonly isAntigravity?: boolean;
  readonly available: boolean;
  readonly models: ReadonlyArray<OvernightLiveModelOption>;
}

export interface OvernightAgyComplianceCheck {
  readonly blocked: boolean;
  readonly reason: "direct_agy" | "chief_agy" | null;
  readonly waiverAllowed: boolean;
  readonly badgeLabel: string;
  readonly warningTitle: string;
  readonly warningMessage: string;
}

const OBSOLETE_OVERNIGHT_PROVIDER_IDS = new Set(["omp", "oh-my-pi", "oh_my_pi"]);

export function isObsoleteOvernightProvider(rawId: string | null | undefined): boolean {
  if (!rawId) return false;
  const normalized = rawId.trim().toLowerCase();
  return OBSOLETE_OVERNIGHT_PROVIDER_IDS.has(normalized);
}

export function isAntigravityOvernightProvider(rawId: string | null | undefined): boolean {
  if (!rawId) return false;
  return resolveAgentBrandId(rawId) === "antigravity";
}

export function normalizeOvernightAgentProviderId(rawId: string | null | undefined): string {
  const trimmed = (rawId ?? "").trim();
  if (!trimmed || isObsoleteOvernightProvider(trimmed)) {
    return "chief";
  }
  if (trimmed.toLowerCase() === "chief") {
    return "chief";
  }
  return toCanonicalChiefProviderId(trimmed);
}

function isPlaceholderModelSlug(slug: string): boolean {
  const trimmed = slug.trim();
  return (
    trimmed.length === 0 ||
    trimmed === ANTIGRAVITY_DEFAULT_MODEL ||
    trimmed === MUSE_DEFAULT_MODEL
  );
}

function resolveCanonicalOvernightEntryId(entry: ProviderInstanceEntry): string {
  if (entry.driverKind !== "acpRegistry") {
    return toCanonicalChiefProviderId(entry.driverKind);
  }
  if (entry.acpRegistryAgentId && entry.acpRegistryAgentId.trim().length > 0) {
    return toCanonicalChiefProviderId(entry.acpRegistryAgentId);
  }
  const instanceBrand = resolveAgentBrandId(entry.instanceId);
  if (instanceBrand !== "custom" && instanceBrand !== "acp") {
    return toCanonicalChiefProviderId(entry.instanceId);
  }
  const displayBrand = resolveAgentBrandId(entry.displayName);
  if (displayBrand !== "custom" && displayBrand !== "acp") {
    return toCanonicalChiefProviderId(entry.displayName);
  }
  return toCanonicalChiefProviderId(
    entry.acpRegistryAgentId || entry.instanceId || entry.displayName || entry.driverKind,
  );
}

/**
 * Derives live configured & enabled server providers for Overnight Factory (NO hardcoded provider list,
 * zero obsolete `omp` entries, deduplicated `acpRegistry` agents such as `dsh`), always appended with
 * the `chief` ("跟随主秘书槽位") option.
 */
export function buildOvernightLiveProviderOptions(input: {
  readonly serverProviders: ReadonlyArray<ServerProvider>;
  readonly settings?: UnifiedSettings | null;
}): OvernightLiveProviderOption[] {
  const providerOrder = input.settings?.providerOrder;
  const derivedEntries = deriveProviderInstanceEntries(input.serverProviders);
  const branded = input.settings
    ? brandProviderInstanceEntries(derivedEntries, input.settings)
    : derivedEntries;
  const brandedEntries = disambiguateProviderInstanceDisplayNames(
    orderProviderInstanceEntries(branded, providerOrder),
  );

  interface ProviderBucket {
    id: string;
    brandProvider: string;
    label: string;
    isAntigravity: boolean;
    available: boolean;
    models: OvernightLiveModelOption[];
    seenModelSlugs: Set<string>;
    customNames: Set<string>;
    instanceCount: number;
  }

  const buckets = new Map<string, ProviderBucket>();

  for (const entry of brandedEntries) {
    if (!entry.enabled) {
      continue;
    }

    const canonicalId = resolveCanonicalOvernightEntryId(entry);
    if (
      isObsoleteOvernightProvider(canonicalId) ||
      isObsoleteOvernightProvider(entry.instanceId) ||
      isObsoleteOvernightProvider(entry.driverKind)
    ) {
      continue;
    }

    const defaultLabel =
      canonicalId === "dsh" ? "DeepSeek Harness (dsh)" : formatAgentBrandName(canonicalId);
    const defaultBrandName = formatAgentBrandName(canonicalId);
    const explicitSettingsName =
      input.settings?.providerInstances?.[entry.instanceId]?.displayName?.trim() ?? "";
    const hasExplicitSettingsName =
      explicitSettingsName.length > 0 && !containsUuidNoise(explicitSettingsName);
    const resolvedDisplayName = hasExplicitSettingsName
      ? explicitSettingsName
      : entry.hasCustomDisplayName
        ? resolveProviderEntryDisplayName(entry)
        : defaultLabel;

    let bucket = buckets.get(canonicalId);
    if (!bucket) {
      bucket = {
        id: canonicalId,
        brandProvider: canonicalId,
        label: defaultLabel,
        isAntigravity: isAntigravityOvernightProvider(canonicalId),
        available: false,
        models: [],
        seenModelSlugs: new Set<string>(),
        customNames: new Set<string>(),
        instanceCount: 0,
      };
      buckets.set(canonicalId, bucket);
    }

    bucket.instanceCount += 1;
    if (entry.isAvailable) {
      bucket.available = true;
    }

    if (
      hasExplicitSettingsName ||
      (resolvedDisplayName.length > 0 &&
        resolvedDisplayName.toLowerCase() !== defaultBrandName.toLowerCase() &&
        resolvedDisplayName.toLowerCase() !== defaultLabel.toLowerCase())
    ) {
      bucket.customNames.add(resolvedDisplayName);
    }

    if (
      bucket.customNames.size === 1 &&
      (bucket.instanceCount === 1 || entry.driverKind === "acpRegistry")
    ) {
      bucket.label = [...bucket.customNames][0]!;
    } else {
      bucket.label = defaultLabel;
    }

    const appModelOptions = input.settings
      ? getAppModelOptionsForInstance(input.settings, entry, null)
      : entry.models.map((m) => ({
          slug: m.slug,
          name: m.name,
          subProvider: m.subProvider,
          isCustom: m.isCustom,
          isDefault: m.isDefault,
        }));

    for (const opt of appModelOptions) {
      if (isPlaceholderModelSlug(opt.slug) || bucket.seenModelSlugs.has(opt.slug)) {
        continue;
      }
      bucket.seenModelSlugs.add(opt.slug);
      const displayName = opt.name?.trim() || opt.slug;
      const subtitleParts: string[] = [];
      if (opt.subProvider && opt.subProvider.trim().length > 0) {
        subtitleParts.push(opt.subProvider.trim());
      } else if (!entry.isDefault && entry.displayName.trim().length > 0) {
        subtitleParts.push(entry.displayName.trim());
      }
      if (displayName.toLowerCase() !== opt.slug.toLowerCase()) {
        subtitleParts.push(opt.slug);
      }
      if (opt.isCustom) {
        subtitleParts.push("自定义");
      }
      bucket.models.push({
        slug: opt.slug,
        label: displayName,
        ...(subtitleParts.length > 0 ? { subtitle: subtitleParts.join(" · ") } : {}),
        ...(opt.isCustom ? { isCustom: true } : {}),
        ...(opt.isDefault ? { isDefault: true } : {}),
      });
    }
  }

  const sortedLiveProviders: OvernightLiveProviderOption[] = [...buckets.values()]
    .sort((a, b) => {
      if (a.isAntigravity !== b.isAntigravity) return a.isAntigravity ? 1 : -1;
      if (a.available !== b.available) return a.available ? -1 : 1;
      return a.label.localeCompare(b.label);
    })
    .map(({ id, brandProvider, label, isAntigravity, available, models }) => ({
      id,
      brandProvider,
      label,
      isAntigravity,
      available,
      models,
    }));

  const liveProviders =
    providerOrder && providerOrder.length > 0
      ? orderItemsByConfiguredProviderOrder(
          sortedLiveProviders,
          (provider) => provider.id,
          brandedEntries,
          providerOrder,
        )
      : sortedLiveProviders;

  return [
    ...liveProviders,
    {
      id: "chief",
      brandProvider: "chief",
      label: "跟随主秘书槽位",
      isChief: true,
      isAntigravity: false,
      available: true,
      models: [],
    },
  ];
}

/**
 * Derives live selectable model options for the active Overnight provider, preserving an already-saved
 * legacy model value as a compatibility fallback entry only when absent from live models.
 */
export function buildOvernightModelOptions(input: {
  readonly selectedProvider: OvernightLiveProviderOption | undefined;
  readonly currentModel: string;
}): OvernightLiveModelOption[] {
  const liveModels = input.selectedProvider?.models ?? [];
  const trimmedCurrent = input.currentModel.trim();
  if (!trimmedCurrent) {
    return [...liveModels];
  }
  if (liveModels.some((m) => m.slug === trimmedCurrent)) {
    return [...liveModels];
  }
  return [
    ...liveModels,
    {
      slug: trimmedCurrent,
      label: trimmedCurrent,
      subtitle: "已保存配置（非当前实时列表）",
      isLegacyFallback: true,
    },
  ];
}

/**
 * Evaluates Antigravity compliance for 24h unattended Overnight Factory execution.
 * Personal AGY is non-compliant for unattended overnight automation and is always gated when unsigned
 * or pointed to via Chief Thread Slot.
 */
export function evaluateOvernightAgyCompliance(input: {
  readonly agentProvider: string;
  readonly chiefProvider?: string | null;
  readonly waiver:
    | Pick<SubscriptionWaiverState, "signed" | "allowAntigravityAsControlledAgent">
    | null
    | undefined;
}): OvernightAgyComplianceCheck {
  const waiverAllowed = isAntigravityControlledAutomationAllowed(input.waiver);
  const badgeLabel = waiverAllowed ? "无人值守禁止个人 AGY" : "需签署免责";

  if (isAntigravityOvernightProvider(input.agentProvider)) {
    return {
      blocked: true,
      reason: "direct_agy",
      waiverAllowed,
      badgeLabel,
      warningTitle: waiverAllowed
        ? "24h 无人值守夜间工场禁止使用个人版 Antigravity (AGY)"
        : "Antigravity (AGY) 需签署免责且禁止用于无人值守夜间工场",
      warningMessage:
        "根据 Prismux 订阅风控护栏，夜间全自动工场属于无人值守自动化路径，禁止选用个人订阅 Antigravity 作为执行代理。请改选其他已启用的智能体，或前往「订阅风控免责」查看完整合规策略。",
    };
  }

  if (
    input.agentProvider === "chief" &&
    isAntigravityOvernightProvider(input.chiefProvider)
  ) {
    return {
      blocked: true,
      reason: "chief_agy",
      waiverAllowed,
      badgeLabel,
      warningTitle: waiverAllowed
        ? "主秘书槽位当前指向个人版 Antigravity（夜间无人值守将拦截）"
        : "主秘书槽位当前指向未签署免责的 Antigravity (AGY)",
      warningMessage:
        "「跟随主秘书槽位」在当前主秘书为个人版 Antigravity 时会被夜间无人值守护栏拦截。请先为夜间工场指定其他已启用的合规执行代理，或前往「订阅风控免责」查看并调整配置。",
    };
  }

  return {
    blocked: false,
    reason: null,
    waiverAllowed,
    badgeLabel,
    warningTitle: "",
    warningMessage: "",
  };
}

export interface OvernightFactoryDraft {
  enabled: boolean;
  mode: DaemonOvernightInboundMode;
  gmailClientId: string;
  /** Write-only input buffer; cleared immediately after saving. */
  gmailClientSecretInput: string;
  gmailRedirectUri: string;
  gmailBoundEmail: string;
  gmailConnected: boolean;
  gmailConnectedAt: number | null;
  preset: DaemonOvernightMailPreset;
  email: string;
  imapHost: string;
  imapPort: string;
  imapSecure: boolean;
  imapUsername: string;
  mailbox: string;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  smtpUsername: string;
  fromName: string;
  /** Write-only input buffers; NEVER populated from server responses. */
  imapPasswordInput: string;
  smtpPasswordInput: string;
  useSeparateSmtpPassword: boolean;
  triggerTag: string;
  allowedSendersText: string;
  windowMode: DaemonOvernightWindowMode;
  windowStart: string;
  windowEnd: string;
  pollIntervalMinutes: string;
  targetWorkspaceDir: string;
  agentProvider: string;
  agentModel: string;
  oracleReviewEnabled: boolean;
  localWorktreeOnlyNoPush: boolean;
  hasGmailClientSecret: boolean;
  hasGmailRefreshToken: boolean;
  hasImapPassword: boolean;
  hasSmtpPassword: boolean;
}

export function isSafeHttpsUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function resolveGmailOAuthRedirectUri(options: {
  readonly draftRedirectUri?: string | null;
  readonly daemonBaseUrl?: string | null;
}): string {
  const explicit = options.draftRedirectUri?.trim();
  if (explicit) return explicit;
  const normalizedBase = options.daemonBaseUrl?.trim().replace(/\/+$/, "");
  const origin = normalizedBase || DEFAULT_DAEMON_ORIGIN;
  return `${origin}${GMAIL_OAUTH_CALLBACK_PATH}`;
}

export function hasSavedGmailOAuthConfig(snapshot: DaemonOvernightConfigSnapshot): boolean {
  return (
    snapshot.config.gmail.connected ||
    Boolean(snapshot.config.gmail.clientId.trim()) ||
    snapshot.secrets.hasGmailClientSecret ||
    snapshot.secrets.hasGmailRefreshToken
  );
}

export function evaluateGmailOAuthReadiness(
  draft: Pick<
    OvernightFactoryDraft,
    "gmailClientId" | "gmailClientSecretInput" | "hasGmailClientSecret"
  >,
): {
  readonly clientIdReady: boolean;
  readonly clientSecretReady: boolean;
  readonly canStartOAuth: boolean;
} {
  const clientIdReady = draft.gmailClientId.trim().length > 0;
  const clientSecretReady =
    draft.gmailClientSecretInput.trim().length > 0 || draft.hasGmailClientSecret;
  return {
    clientIdReady,
    clientSecretReady,
    canStartOAuth: clientIdReady && clientSecretReady,
  };
}

export function toggleTutorialStepCompletion(
  completedSteps: ReadonlyArray<GmailOAuthTutorialStepNumber>,
  step: GmailOAuthTutorialStepNumber,
): GmailOAuthTutorialStepNumber[] {
  if (completedSteps.includes(step)) {
    return completedSteps.filter((item) => item !== step);
  }
  return [...completedSteps, step].sort((a, b) => a - b);
}

export function createDefaultOvernightDraft(): OvernightFactoryDraft {
  const qq = OVERNIGHT_MAIL_PRESETS[0]!;
  return {
    enabled: false,
    mode: "imap",
    gmailClientId: "",
    gmailClientSecretInput: "",
    gmailRedirectUri: "",
    gmailBoundEmail: "",
    gmailConnected: false,
    gmailConnectedAt: null,
    preset: "qq",
    email: "",
    imapHost: qq.imapHost,
    imapPort: String(qq.imapPort),
    imapSecure: qq.imapSecure,
    imapUsername: "",
    mailbox: "INBOX",
    smtpHost: qq.smtpHost,
    smtpPort: String(qq.smtpPort),
    smtpSecure: qq.smtpSecure,
    smtpUsername: "",
    fromName: "Prismux Overnight Factory",
    imapPasswordInput: "",
    smtpPasswordInput: "",
    useSeparateSmtpPassword: false,
    triggerTag: "#factory",
    allowedSendersText: "",
    windowMode: "scheduled",
    windowStart: "23:00",
    windowEnd: "07:00",
    pollIntervalMinutes: "5",
    targetWorkspaceDir: "",
    agentProvider: "chief",
    agentModel: "",
    oracleReviewEnabled: true,
    localWorktreeOnlyNoPush: true,
    hasGmailClientSecret: false,
    hasGmailRefreshToken: false,
    hasImapPassword: false,
    hasSmtpPassword: false,
  };
}

export function formatAllowedSendersInput(senders: readonly string[]): string {
  return senders.join("\n");
}

export function parseAllowedSendersInput(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\r\n,;]+/)) {
    const trimmed = part.trim().toLowerCase();
    if (trimmed.length > 0 && trimmed.includes("@") && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

export function hydrateOvernightDraftFromSnapshot(
  snapshot: DaemonOvernightConfigSnapshot,
): OvernightFactoryDraft {
  const { config, secrets } = snapshot;
  // Unconfigured snapshots always land on Generic IMAP/SMTP ("imap"), while already-saved
  // Gmail OAuth2 setups stay on "gmail-oauth2" untouched.
  const effectiveMode: DaemonOvernightInboundMode =
    config.mode === "gmail-oauth2" && !hasSavedGmailOAuthConfig(snapshot) ? "imap" : config.mode;
  return {
    enabled: config.enabled,
    mode: effectiveMode,
    gmailClientId: config.gmail.clientId,
    gmailClientSecretInput: "",
    gmailRedirectUri: config.gmail.redirectUri,
    gmailBoundEmail: config.gmail.boundEmail,
    gmailConnected: config.gmail.connected,
    gmailConnectedAt: config.gmail.connectedAt,
    preset: config.imapSmtp.preset,
    email: config.imapSmtp.email,
    imapHost: config.imapSmtp.imapHost,
    imapPort: String(config.imapSmtp.imapPort),
    imapSecure: config.imapSmtp.imapSecure,
    imapUsername: config.imapSmtp.imapUsername,
    mailbox: config.imapSmtp.mailbox || "INBOX",
    smtpHost: config.imapSmtp.smtpHost,
    smtpPort: String(config.imapSmtp.smtpPort),
    smtpSecure: config.imapSmtp.smtpSecure,
    smtpUsername: config.imapSmtp.smtpUsername,
    fromName: config.imapSmtp.fromName || "Prismux Overnight Factory",
    imapPasswordInput: "",
    smtpPasswordInput: "",
    useSeparateSmtpPassword: false,
    triggerTag: config.strategy.triggerTag || "#factory",
    allowedSendersText: formatAllowedSendersInput(config.strategy.allowedSenders),
    windowMode: config.strategy.windowMode,
    windowStart: config.strategy.windowStart || "23:00",
    windowEnd: config.strategy.windowEnd || "07:00",
    pollIntervalMinutes: String(config.strategy.pollIntervalMinutes || 5),
    targetWorkspaceDir: config.strategy.targetWorkspaceDir,
    agentProvider: normalizeOvernightAgentProviderId(config.strategy.agentProvider),
    agentModel: config.strategy.agentModel || "",
    oracleReviewEnabled: config.strategy.oracleReviewEnabled,
    localWorktreeOnlyNoPush: config.strategy.localWorktreeOnlyNoPush,
    hasGmailClientSecret: secrets.hasGmailClientSecret,
    hasGmailRefreshToken: secrets.hasGmailRefreshToken,
    hasImapPassword: secrets.hasImapPassword,
    hasSmtpPassword: secrets.hasSmtpPassword,
  };
}

export function applyOvernightMailPreset(
  draft: OvernightFactoryDraft,
  presetId: DaemonOvernightMailPreset,
): OvernightFactoryDraft {
  const preset = OVERNIGHT_MAIL_PRESETS.find((item) => item.id === presetId);
  if (!preset) return draft;
  if (presetId === "custom") {
    return {
      ...draft,
      preset: "custom",
    };
  }
  return {
    ...draft,
    preset: presetId,
    imapHost: preset.imapHost,
    imapPort: String(preset.imapPort),
    imapSecure: preset.imapSecure,
    smtpHost: preset.smtpHost,
    smtpPort: String(preset.smtpPort),
    smtpSecure: preset.smtpSecure,
  };
}

function parsePortNumber(raw: string, fallback: number): number {
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 1 || n > 65535) return fallback;
  return n;
}

function parsePollMinutes(raw: string, fallback = 5): number {
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1440, Math.max(1, n));
}

/**
 * Builds a write-only sanitized config update payload:
 * - Only attaches non-empty secret strings so sealed secrets on disk are never cleared unintentionally.
 * - Never includes blank password fields in serialized JSON.
 */
export function buildOvernightMailSavePayload(
  draft: OvernightFactoryDraft,
): DaemonOvernightConfigPatch {
  const secrets: NonNullable<DaemonOvernightConfigPatch["secrets"]> = {};
  if (draft.gmailClientSecretInput.trim().length > 0) {
    secrets.gmailClientSecret = draft.gmailClientSecretInput.trim();
  }
  if (draft.imapPasswordInput.trim().length > 0) {
    secrets.imapPassword = draft.imapPasswordInput.trim();
  }
  if (draft.useSeparateSmtpPassword && draft.smtpPasswordInput.trim().length > 0) {
    secrets.smtpPassword = draft.smtpPasswordInput.trim();
  }

  return {
    mode: draft.mode,
    gmail: {
      clientId: draft.gmailClientId.trim(),
      redirectUri: draft.gmailRedirectUri.trim(),
      boundEmail: draft.gmailBoundEmail.trim(),
    },
    imapSmtp: {
      preset: draft.preset,
      email: draft.email.trim(),
      imapHost: draft.imapHost.trim(),
      imapPort: parsePortNumber(draft.imapPort, 993),
      imapSecure: draft.imapSecure,
      imapUsername: draft.imapUsername.trim() || draft.email.trim(),
      mailbox: draft.mailbox.trim() || "INBOX",
      smtpHost: draft.smtpHost.trim(),
      smtpPort: parsePortNumber(draft.smtpPort, draft.smtpSecure ? 465 : 587),
      smtpSecure: draft.smtpSecure,
      smtpUsername: draft.smtpUsername.trim() || draft.email.trim(),
      fromName: draft.fromName.trim() || "Prismux Overnight Factory",
    },
    ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
  };
}

export function buildOvernightStrategySavePayload(
  draft: OvernightFactoryDraft,
): DaemonOvernightConfigPatch {
  return {
    enabled: draft.enabled,
    strategy: {
      triggerTag: draft.triggerTag.trim() || "#factory",
      allowedSenders: parseAllowedSendersInput(draft.allowedSendersText),
      windowMode: draft.windowMode,
      windowStart: draft.windowStart.trim() || "23:00",
      windowEnd: draft.windowEnd.trim() || "07:00",
      pollIntervalMinutes: parsePollMinutes(draft.pollIntervalMinutes, 5),
      targetWorkspaceDir: draft.targetWorkspaceDir.trim(),
      agentProvider: normalizeOvernightAgentProviderId(draft.agentProvider),
      agentModel: draft.agentModel.trim(),
      oracleReviewEnabled: draft.oracleReviewEnabled,
      localWorktreeOnlyNoPush: draft.localWorktreeOnlyNoPush,
    },
  };
}

export function isMailChannelConfigured(draft: OvernightFactoryDraft): boolean {
  if (draft.mode === "gmail-oauth2") {
    return draft.gmailConnected || Boolean(draft.gmailClientId.trim() && draft.hasGmailClientSecret);
  }
  return Boolean(draft.email.trim() && draft.imapHost.trim() && draft.hasImapPassword);
}

export function shouldDefaultExpandMailChannel(
  snapshot: DaemonOvernightConfigSnapshot,
  standalone = false,
): boolean {
  if (standalone) {
    return true;
  }
  if (snapshot.config.mode === "gmail-oauth2") {
    return hasSavedGmailOAuthConfig(snapshot);
  }
  return Boolean(snapshot.config.imapSmtp.email.trim()) || snapshot.secrets.hasImapPassword;
}

export function shouldDefaultExpandStrategy(snapshot: DaemonOvernightConfigSnapshot): boolean {
  return (
    snapshot.config.enabled ||
    snapshot.config.strategy.allowedSenders.length > 0 ||
    Boolean(snapshot.config.strategy.targetWorkspaceDir.trim())
  );
}

export function formatOvernightRunStatusBadge(status: DaemonOvernightRunStatus): {
  readonly label: string;
  readonly variant: "success" | "error" | "warning" | "secondary";
} {
  switch (status) {
    case "completed":
      return { label: "已完成", variant: "success" };
    case "failed":
      return { label: "执行失败", variant: "error" };
    case "blocked_whitelist":
      return { label: "白名单拦截", variant: "warning" };
    case "skipped":
      return { label: "已跳过", variant: "secondary" };
  }
}

export function formatOvernightTimestamp(timestampMs: number | null | undefined): string {
  if (typeof timestampMs !== "number" || !Number.isFinite(timestampMs) || timestampMs <= 0) {
    return "尚未执行";
  }
  try {
    return new Date(timestampMs).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
}
