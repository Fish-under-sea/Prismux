import type {
  DaemonOvernightConfigPatch,
  DaemonOvernightConfigSnapshot,
  DaemonOvernightInboundMode,
  DaemonOvernightMailPreset,
  DaemonOvernightRunStatus,
  DaemonOvernightWindowMode,
} from "../daemonClient";

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

export const OVERNIGHT_AGENT_PROVIDERS: ReadonlyArray<{
  readonly id: string;
  readonly label: string;
}> = [
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude Code" },
  { id: "agy", label: "Antigravity (agy)" },
  { id: "omp", label: "OMP" },
  { id: "chief", label: "跟随主秘书槽位" },
];

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
    agentProvider: "codex",
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
  return {
    enabled: config.enabled,
    mode: config.mode,
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
    agentProvider: config.strategy.agentProvider || "codex",
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
      agentProvider: draft.agentProvider.trim() || "codex",
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

export function shouldDefaultExpandMailChannel(snapshot: DaemonOvernightConfigSnapshot): boolean {
  if (snapshot.config.mode === "gmail-oauth2") {
    return (
      snapshot.config.gmail.connected ||
      Boolean(snapshot.config.gmail.clientId.trim()) ||
      snapshot.secrets.hasGmailClientSecret
    );
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
