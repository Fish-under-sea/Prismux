import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@prismux/core-contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@prismux/core-contracts/settings";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => Promise.resolve(),
  useLocation: (opts?: { select?: (loc: { pathname: string; hash: string; state: Record<string, unknown> }) => unknown }) => {
    const loc = {
      pathname: "/settings/overnight-factory",
      hash: "",
      state: {},
    };
    return opts?.select ? opts.select(loc) : loc;
  },
}));

import type {
  DaemonOvernightConfigSnapshot,
  DaemonOvernightRunRecordDto,
} from "../daemonClient";
import type { SubscriptionWaiverState } from "../SubscriptionRiskWaiverSection";
import {
  GMAIL_APP_PASSWORD_LINKS,
  GMAIL_OAUTH_QUICK_LINKS,
  GMAIL_OAUTH_SCOPES_TEXT,
  GMAIL_OAUTH_TUTORIAL_STEPS,
  OVERNIGHT_MAIL_PRESETS,
  applyOvernightMailPreset,
  buildOvernightLiveProviderOptions,
  buildOvernightMailSavePayload,
  buildOvernightModelOptions,
  buildOvernightStrategySavePayload,
  createDefaultOvernightDraft,
  evaluateGmailOAuthReadiness,
  evaluateOvernightAgyCompliance,
  hasSavedGmailOAuthConfig,
  hydrateOvernightDraftFromSnapshot,
  isObsoleteOvernightProvider,
  isSafeHttpsUrl,
  normalizeOvernightAgentProviderId,
  parseAllowedSendersInput,
  resolveGmailOAuthRedirectUri,
  shouldDefaultExpandMailChannel,
  shouldDefaultExpandStrategy,
  toggleTutorialStepCompletion,
} from "./overnightFactory.logic";
import { PrismuxOvernightFactorySettingsPage } from "./PrismuxOvernightFactorySettingsPage";

const UNSIGNED_WAIVER: SubscriptionWaiverState = {
  signed: false,
  waiverVersion: null,
  signedAt: null,
  allowAntigravityAsControlledAgent: false,
  allowExternalSubscriptionAgentsInSwarm: false,
  defaultLocked: true,
};

function makeMockProvider(input: {
  instanceId: string;
  driver: string;
  displayName?: string;
  enabled?: boolean;
  models: ServerProvider["models"];
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: ProviderDriverKind.make(input.driver),
    ...(input.displayName ? { displayName: input.displayName } : {}),
    enabled: input.enabled ?? true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-11-25T00:00:00.000Z",
    models: input.models,
    slashCommands: [],
    skills: [],
  } as unknown as ServerProvider;
}

const SAMPLE_LIVE_PROVIDERS: ServerProvider[] = [
  makeMockProvider({
    instanceId: "codex",
    driver: "codex",
    displayName: "Codex",
    enabled: true,
    models: [
      { slug: "gpt-5.4-codex", name: "GPT-5.4 Codex", isCustom: false, isDefault: true, capabilities: null },
      { slug: "gpt-5.3-codex", name: "GPT-5.3 Codex", isCustom: false, capabilities: null },
    ],
  }),
  makeMockProvider({
    instanceId: "claudeAgent",
    driver: "claudeAgent",
    displayName: "Claude Code",
    enabled: false, // Disabled provider MUST be skipped!
    models: [{ slug: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", isCustom: false, capabilities: null }],
  }),
  makeMockProvider({
    instanceId: "acp-dsh",
    driver: "acpRegistry",
    displayName: "DeepSeek Harness",
    enabled: true,
    models: [
      { slug: "deepseek-reasoner", name: "DeepSeek Reasoner", isCustom: false, isDefault: true, capabilities: null },
      { slug: "deepseek-chat", name: "DeepSeek Chat", isCustom: false, capabilities: null },
    ],
  }),
  // Duplicate acpRegistry entry for dsh MUST deduplicate into one DeepSeek Harness (dsh) pill!
  makeMockProvider({
    instanceId: "acp-deepseek-harness",
    driver: "acpRegistry",
    displayName: "DeepSeek Harness (dsh)",
    enabled: true,
    models: [{ slug: "deepseek-chat", name: "DeepSeek Chat", isCustom: false, capabilities: null }],
  }),
  makeMockProvider({
    instanceId: "antigravity",
    driver: "antigravity",
    displayName: "Antigravity",
    enabled: true,
    models: [{ slug: "gemini-3-pro", name: "Gemini 3 Pro", isCustom: false, capabilities: null }],
  }),
];

function makeSnapshot(
  overrides?: Partial<DaemonOvernightConfigSnapshot["config"]>,
  secrets?: Partial<DaemonOvernightConfigSnapshot["secrets"]>,
): DaemonOvernightConfigSnapshot {
  return {
    ok: true,
    config: {
      schemaVersion: 1,
      updatedAt: 1_763_000_000_000,
      enabled: false,
      mode: "imap",
      gmail: {
        clientId: "",
        redirectUri: "",
        boundEmail: "",
        connected: false,
        connectedAt: null,
      },
      imapSmtp: {
        preset: "qq",
        email: "",
        imapHost: "imap.qq.com",
        imapPort: 993,
        imapSecure: true,
        imapUsername: "",
        mailbox: "INBOX",
        smtpHost: "smtp.qq.com",
        smtpPort: 465,
        smtpSecure: true,
        smtpUsername: "",
        fromName: "Prismux Overnight Factory",
      },
      strategy: {
        triggerTag: "#factory",
        allowedSenders: [],
        windowMode: "scheduled",
        windowStart: "23:00",
        windowEnd: "07:00",
        pollIntervalMinutes: 5,
        targetWorkspaceDir: "",
        agentProvider: "codex",
        agentModel: "",
        oracleReviewEnabled: true,
        localWorktreeOnlyNoPush: true,
      },
      ...overrides,
    },
    secrets: {
      hasGmailClientSecret: false,
      hasGmailRefreshToken: false,
      hasImapPassword: false,
      hasSmtpPassword: false,
      ...secrets,
    },
    credentialsFile: "~/.prismux/credentials/overnight-factory.enc",
    runtime: {
      pollerActive: false,
      inAllowedWindow: false,
      oauthPending: false,
      lastPollAt: null,
      lastPollError: null,
      lastTestResult: null,
      runsCount: 0,
    },
  };
}

describe("PrismuxOvernightFactorySettingsPage & overnightFactory.logic", () => {
  it("applies Gmail, QQ, Agent Mail, Outlook, NetEase (163 / 126), and Custom presets accurately", () => {
    const base = createDefaultOvernightDraft();
    expect(base.mode).toBe("imap");
    expect(OVERNIGHT_MAIL_PRESETS.map((p) => p.id)).toEqual([
      "gmail",
      "qq",
      "agent_mail",
      "outlook",
      "netease",
      "custom",
    ]);
    expect(OVERNIGHT_MAIL_PRESETS.map((p) => p.label)).toEqual([
      "谷歌邮箱 (Gmail)",
      "QQ 邮箱",
      "Agent 邮箱",
      "Outlook / Exchange",
      "网易邮箱（163 / 126）",
      "自定义",
    ]);

    const gmail = applyOvernightMailPreset(base, "gmail");
    expect(gmail.preset).toBe("gmail");
    expect(gmail.emailProvider).toBe("imap_smtp");
    expect(gmail.imapHost).toBe("imap.gmail.com");
    expect(gmail.imapPort).toBe("993");
    expect(gmail.imapSecure).toBe(true);
    expect(gmail.smtpHost).toBe("smtp.gmail.com");
    expect(gmail.smtpPort).toBe("465");
    expect(gmail.smtpSecure).toBe(true);

    const qq = applyOvernightMailPreset(gmail, "qq");
    expect(qq.preset).toBe("qq");
    expect(qq.imapHost).toBe("imap.qq.com");
    expect(qq.imapPort).toBe("993");
    expect(qq.imapSecure).toBe(true);
    expect(qq.smtpHost).toBe("smtp.qq.com");
    expect(qq.smtpPort).toBe("465");
    expect(qq.smtpSecure).toBe(true);

    const agentMail = applyOvernightMailPreset(qq, "agent_mail");
    expect(agentMail.preset).toBe("agent_mail");
    expect(agentMail.emailProvider).toBe("agent_mail");
    expect(agentMail.mode).toBe("imap");

    const outlook = applyOvernightMailPreset(agentMail, "outlook");
    expect(outlook.preset).toBe("outlook");
    expect(outlook.emailProvider).toBe("imap_smtp");
    expect(outlook.imapHost).toBe("outlook.office365.com");
    expect(outlook.imapPort).toBe("993");
    expect(outlook.smtpHost).toBe("smtp.office365.com");
    expect(outlook.smtpPort).toBe("587");
    expect(outlook.smtpSecure).toBe(false);

    const netease = applyOvernightMailPreset(outlook, "netease");
    expect(netease.preset).toBe("netease");
    expect(netease.neteaseDomain).toBe("163.com");
    expect(netease.imapHost).toBe("imap.163.com");
    expect(netease.smtpHost).toBe("smtp.163.com");
    expect(netease.smtpPort).toBe("465");

    const netease126 = applyOvernightMailPreset(netease, "126");
    expect(netease126.preset).toBe("netease");
    expect(netease126.neteaseDomain).toBe("126.com");
    expect(netease126.imapHost).toBe("imap.126.com");
    expect(netease126.smtpHost).toBe("smtp.126.com");

    // Legacy "163" alias maps cleanly onto NetEase 163.com hosts
    const legacy163 = applyOvernightMailPreset(netease126, "163");
    expect(legacy163.preset).toBe("netease");
    expect(legacy163.neteaseDomain).toBe("163.com");
    expect(legacy163.imapHost).toBe("imap.163.com");

    // Custom keeps current values editable without wiping user entries
    const custom = applyOvernightMailPreset(outlook, "custom");
    expect(custom.preset).toBe("custom");
    expect(custom.imapHost).toBe("outlook.office365.com");
  });

  it("derives ONLY enabled live configured providers (zero hardcoded list, zero OMP, deduplicated dsh) and live models", () => {
    expect(isObsoleteOvernightProvider("omp")).toBe(true);
    expect(normalizeOvernightAgentProviderId("omp")).toBe("chief");
    expect(normalizeOvernightAgentProviderId("claude")).toBe("claude-code");
    expect(normalizeOvernightAgentProviderId("agy")).toBe("antigravity");

    const options = buildOvernightLiveProviderOptions({
      serverProviders: SAMPLE_LIVE_PROVIDERS,
    });

    // Disabled claudeAgent MUST NOT appear; duplicate dsh entries MUST merge into ONE; chief always appended
    expect(options.map((p) => p.id)).toEqual(["codex", "dsh", "antigravity", "chief"]);
    expect(options.some((p) => p.id === "omp")).toBe(false);
    expect(options.some((p) => p.id === "claude-code")).toBe(false);

    const dsh = options.find((p) => p.id === "dsh");
    expect(dsh?.brandProvider).toBe("dsh");
    expect(dsh?.label).toBe("DeepSeek Harness (dsh)");
    expect(dsh?.models.map((m) => m.slug)).toEqual(["deepseek-reasoner", "deepseek-chat"]);

    // Live model selector preserves legacy saved value only when absent from live catalog
    const dshModels = buildOvernightModelOptions({
      selectedProvider: dsh,
      currentModel: "deepseek-chat",
    });
    expect(dshModels.map((m) => m.slug)).toEqual(["deepseek-reasoner", "deepseek-chat"]);

    const legacyModels = buildOvernightModelOptions({
      selectedProvider: dsh,
      currentModel: "legacy-saved-model",
    });
    expect(legacyModels.map((m) => m.slug)).toEqual([
      "deepseek-reasoner",
      "deepseek-chat",
      "legacy-saved-model",
    ]);
    expect(legacyModels[2]?.isLegacyFallback).toBe(true);

    // Empty live providers list keeps only `chief` (never dumps static Codex/Claude/OMP!)
    const emptyOptions = buildOvernightLiveProviderOptions({ serverProviders: [] });
    expect(emptyOptions.map((p) => p.id)).toEqual(["chief"]);

    // AGY compliance guard blocks direct AGY and chief->AGY
    const directAgyCheck = evaluateOvernightAgyCompliance({
      agentProvider: "antigravity",
      waiver: UNSIGNED_WAIVER,
    });
    expect(directAgyCheck.blocked).toBe(true);
    expect(directAgyCheck.badgeLabel).toBe("需签署免责");

    const chiefAgyCheck = evaluateOvernightAgyCompliance({
      agentProvider: "chief",
      chiefProvider: "antigravity",
      waiver: UNSIGNED_WAIVER,
    });
    expect(chiefAgyCheck.blocked).toBe(true);
    expect(chiefAgyCheck.reason).toBe("chief_agy");

    const codexCheck = evaluateOvernightAgyCompliance({
      agentProvider: "codex",
      chiefProvider: "codex",
      waiver: UNSIGNED_WAIVER,
    });
    expect(codexCheck.blocked).toBe(false);
  });

  it("orders live Overnight providers by settings.providerOrder and honors custom display names over DeepSeek Harness (dsh)", () => {
    const codexId = ProviderInstanceId.make("codex");
    const dshId = ProviderInstanceId.make("acp-dsh");
    const agyId = ProviderInstanceId.make("antigravity");

    const options = buildOvernightLiveProviderOptions({
      serverProviders: SAMPLE_LIVE_PROVIDERS,
      settings: {
        ...DEFAULT_UNIFIED_SETTINGS,
        providerOrder: [agyId, dshId, codexId],
        providerInstances: {
          [dshId]: {
            driver: ProviderDriverKind.make("acpRegistry"),
            enabled: true,
            displayName: "夜间深度求索",
            config: { agentId: "dsh" },
          },
          [codexId]: {
            driver: ProviderDriverKind.make("codex"),
            enabled: true,
            displayName: "主力 Codex",
          },
          [agyId]: {
            driver: ProviderDriverKind.make("antigravity"),
            enabled: true,
            displayName: "个人 AGY",
          },
        },
      },
    });

    expect(options.map((p) => p.id)).toEqual(["antigravity", "dsh", "codex", "chief"]);
    expect(options.find((p) => p.id === "dsh")?.label).toBe("夜间深度求索");
    expect(options.find((p) => p.id === "codex")?.label).toBe("主力 Codex");
    expect(options.find((p) => p.id === "antigravity")?.label).toBe("个人 AGY");
  });

  it("validates external https links, resolves live redirect URIs, and tracks OAuth tutorial progress & readiness", () => {
    for (const link of [...GMAIL_APP_PASSWORD_LINKS, ...GMAIL_OAUTH_QUICK_LINKS]) {
      expect(isSafeHttpsUrl(link.url)).toBe(true);
    }
    expect(isSafeHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpsUrl("http://example.com")).toBe(false);

    expect(GMAIL_OAUTH_TUTORIAL_STEPS).toHaveLength(5);
    expect(GMAIL_OAUTH_SCOPES_TEXT).toBe(
      "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send",
    );

    expect(resolveGmailOAuthRedirectUri({})).toBe(
      "http://127.0.0.1:47777/v1/overnight/oauth/gmail/callback",
    );
    expect(
      resolveGmailOAuthRedirectUri({ daemonBaseUrl: "http://127.0.0.1:43999/" }),
    ).toBe("http://127.0.0.1:43999/v1/overnight/oauth/gmail/callback");
    expect(
      resolveGmailOAuthRedirectUri({
        draftRedirectUri: "http://127.0.0.1:51234/v1/overnight/oauth/gmail/callback",
        daemonBaseUrl: "http://127.0.0.1:43999",
      }),
    ).toBe("http://127.0.0.1:51234/v1/overnight/oauth/gmail/callback");

    const stepAdded = toggleTutorialStepCompletion([], 3);
    expect(stepAdded).toEqual([3]);
    expect(toggleTutorialStepCompletion(stepAdded, 1)).toEqual([1, 3]);
    expect(toggleTutorialStepCompletion([1, 3], 3)).toEqual([1]);

    expect(
      evaluateGmailOAuthReadiness({
        gmailClientId: "",
        gmailClientSecretInput: "",
        hasGmailClientSecret: false,
      }),
    ).toEqual({
      clientIdReady: false,
      clientSecretReady: false,
      canStartOAuth: false,
    });
    expect(
      evaluateGmailOAuthReadiness({
        gmailClientId: "abc.apps.googleusercontent.com",
        gmailClientSecretInput: "",
        hasGmailClientSecret: true,
      }),
    ).toEqual({
      clientIdReady: true,
      clientSecretReady: true,
      canStartOAuth: true,
    });
  });

  it("defaults unconfigured snapshots to imap while keeping saved gmail-oauth2 mode untouched", () => {
    const legacyUnconfiguredGmail = makeSnapshot({ mode: "gmail-oauth2" });
    expect(hasSavedGmailOAuthConfig(legacyUnconfiguredGmail)).toBe(false);
    expect(hydrateOvernightDraftFromSnapshot(legacyUnconfiguredGmail).mode).toBe("imap");

    const savedGmailWithClientId = makeSnapshot({
      mode: "gmail-oauth2",
      gmail: {
        clientId: "saved-client.apps.googleusercontent.com",
        redirectUri: "",
        boundEmail: "",
        connected: false,
        connectedAt: null,
      },
    });
    expect(hasSavedGmailOAuthConfig(savedGmailWithClientId)).toBe(true);
    expect(hydrateOvernightDraftFromSnapshot(savedGmailWithClientId).mode).toBe("gmail-oauth2");
  });

  it("sanitizes write-only secrets on save and never hydrates password fields from server responses", () => {
    const sealedSnapshot = makeSnapshot(
      {
        mode: "imap",
        imapSmtp: {
          preset: "qq",
          email: "owner@qq.com",
          imapHost: "imap.qq.com",
          imapPort: 993,
          imapSecure: true,
          imapUsername: "owner@qq.com",
          mailbox: "INBOX",
          smtpHost: "smtp.qq.com",
          smtpPort: 465,
          smtpSecure: true,
          smtpUsername: "owner@qq.com",
          fromName: "Prismux Overnight Factory",
        },
      },
      { hasImapPassword: true, hasSmtpPassword: true, hasGmailClientSecret: true },
    );

    const draft = hydrateOvernightDraftFromSnapshot(sealedSnapshot);
    expect(draft.imapPasswordInput).toBe("");
    expect(draft.smtpPasswordInput).toBe("");
    expect(draft.gmailClientSecretInput).toBe("");
    expect(draft.hasImapPassword).toBe(true);
    expect(draft.hasGmailClientSecret).toBe(true);

    // Saving with empty password inputs omits `secrets` entirely so sealed secrets stay intact
    const payloadWithoutSecret = buildOvernightMailSavePayload(draft);
    expect(payloadWithoutSecret.secrets).toBeUndefined();
    expect(payloadWithoutSecret.imapSmtp?.email).toBe("owner@qq.com");

    // Typing a new auth code sends only that non-empty secret key
    const payloadWithSecret = buildOvernightMailSavePayload({
      ...draft,
      imapPasswordInput: "  new-qq-auth-code  ",
    });
    expect(payloadWithSecret.secrets).toEqual({ imapPassword: "new-qq-auth-code" });

    // Whitelist & strategy payload normalization
    const strategyPayload = buildOvernightStrategySavePayload({
      ...draft,
      enabled: true,
      triggerTag: " #factory ",
      allowedSendersText: "Boss@QQ.com\nboss@qq.com\ninvalid-line\n*@team.dev",
      pollIntervalMinutes: "15",
      targetWorkspaceDir: " D:\\Projects\\Prismux ",
      oracleReviewEnabled: true,
      localWorktreeOnlyNoPush: true,
    });
    expect(strategyPayload.enabled).toBe(true);
    expect(strategyPayload.strategy?.triggerTag).toBe("#factory");
    expect(strategyPayload.strategy?.allowedSenders).toEqual(["boss@qq.com", "*@team.dev"]);
    expect(strategyPayload.strategy?.pollIntervalMinutes).toBe(15);
    expect(strategyPayload.strategy?.targetWorkspaceDir).toBe("D:\\Projects\\Prismux");
    expect(strategyPayload.strategy?.oracleReviewEnabled).toBe(true);
    expect(strategyPayload.strategy?.localWorktreeOnlyNoPush).toBe(true);
    expect(parseAllowedSendersInput("a@b.com; c@d.com, a@b.com")).toEqual(["a@b.com", "c@d.com"]);
  });

  it("defaults embedded unconfigured channels to collapsed while standalone workbench renders full-bleed with Generic IMAP/SMTP expanded", () => {
    const emptySnap = makeSnapshot();
    expect(shouldDefaultExpandMailChannel(emptySnap, false)).toBe(false);
    expect(shouldDefaultExpandMailChannel(emptySnap, true)).toBe(true);
    expect(shouldDefaultExpandStrategy(emptySnap)).toBe(false);

    // Embedded settings view keeps collapsed default when unconfigured
    const collapsedHtml = renderToStaticMarkup(
      <PrismuxOvernightFactorySettingsPage
        daemonReadyOverride
        serverProvidersOverride={SAMPLE_LIVE_PROVIDERS}
        settingsOverride={null}
        waiverOverride={UNSIGNED_WAIVER}
        initialSnapshotOverride={emptySnap}
        initialRunsOverride={[]}
        workspaceOptionsOverride={[]}
      />,
    );
    expect(collapsedHtml).toContain("夜间全自动工场（Overnight Factory）与邮箱绑定");
    expect(collapsedHtml).toContain("通道未配置（已折叠）");
    expect(collapsedHtml).toContain("默认关闭 · 待命");
    expect(collapsedHtml).toContain("凭据 0600 加密密封");
    expect(collapsedHtml).toContain("立即拉取邮件");
    expect(collapsedHtml).not.toContain('data-testid="overnight-imap-form"');
    expect(collapsedHtml).not.toContain('data-testid="overnight-whitelist-textarea"');

    // Standalone `/overnight-factory` full-bleed workbench removes narrow max-w-5xl, shows KPI strip,
    // 2-column xl:grid-cols-12 layout, and expands Generic IMAP/SMTP immediately with IMAP toggle FIRST
    const standaloneHtml = renderToStaticMarkup(
      <PrismuxOvernightFactorySettingsPage
        standalone
        daemonReadyOverride
        daemonBaseUrlOverride="http://127.0.0.1:47777"
        serverProvidersOverride={SAMPLE_LIVE_PROVIDERS}
        settingsOverride={null}
        waiverOverride={UNSIGNED_WAIVER}
        initialSnapshotOverride={emptySnap}
        initialRunsOverride={[]}
        workspaceOptionsOverride={[]}
      />,
    );
    expect(standaloneHtml).not.toContain("max-w-5xl");
    expect(standaloneHtml).toContain('data-testid="overnight-kpi-strip"');
    expect(standaloneHtml).toContain('data-testid="overnight-workbench-grid"');
    expect(standaloneHtml).toContain("xl:grid-cols-12");
    expect(standaloneHtml).toContain("xl:col-span-7");
    expect(standaloneHtml).toContain("xl:col-span-5");
    expect(standaloneHtml).toContain('data-testid="overnight-header-poll-now-btn"');
    expect(standaloneHtml).toContain('data-testid="overnight-imap-form"');
    expect(standaloneHtml).toContain("谷歌邮箱 (Gmail)");

    const imapTogglePos = standaloneHtml.indexOf('data-testid="overnight-mode-imap"');
    const gmailTogglePos = standaloneHtml.indexOf('data-testid="overnight-mode-gmail"');
    expect(imapTogglePos).toBeGreaterThan(-1);
    expect(gmailTogglePos).toBeGreaterThan(imapTogglePos);
  });

  it("renders Gmail IMAP App Password guidance banner when Gmail preset is selected", () => {
    const gmailImapSnap = makeSnapshot({
      mode: "imap",
      imapSmtp: {
        preset: "gmail",
        email: "dev@gmail.com",
        imapHost: "imap.gmail.com",
        imapPort: 993,
        imapSecure: true,
        imapUsername: "dev@gmail.com",
        mailbox: "INBOX",
        smtpHost: "smtp.gmail.com",
        smtpPort: 465,
        smtpSecure: true,
        smtpUsername: "dev@gmail.com",
        fromName: "Prismux Overnight Factory",
      },
    });
    const html = renderToStaticMarkup(
      <PrismuxOvernightFactorySettingsPage
        standalone
        daemonReadyOverride
        serverProvidersOverride={SAMPLE_LIVE_PROVIDERS}
        settingsOverride={null}
        waiverOverride={UNSIGNED_WAIVER}
        initialSnapshotOverride={gmailImapSnap}
        initialRunsOverride={[]}
        workspaceOptionsOverride={[]}
      />,
    );
    expect(html).toContain('data-testid="overnight-gmail-imap-hint"');
    expect(html).toContain("应用专用密码 (App Password)");
    expect(html).toContain("打开 Google 两步验证");
    expect(html).toContain("直达生成应用专用密码");
  });

  it("renders live-only providers (deduplicated dsh whale, zero OMP, grayed-out AGY with red 需签署免责), live models, Gmail OAuth2 tutorial & run history", () => {
    const configuredImapSnap = makeSnapshot(
      {
        enabled: true,
        mode: "imap",
        imapSmtp: {
          preset: "qq",
          email: "owner@qq.com",
          imapHost: "imap.qq.com",
          imapPort: 993,
          imapSecure: true,
          imapUsername: "owner@qq.com",
          mailbox: "INBOX",
          smtpHost: "smtp.qq.com",
          smtpPort: 465,
          smtpSecure: true,
          smtpUsername: "owner@qq.com",
          fromName: "Prismux Overnight Factory",
        },
        strategy: {
          triggerTag: "#factory",
          allowedSenders: ["owner@qq.com"],
          windowMode: "scheduled",
          windowStart: "23:00",
          windowEnd: "07:00",
          pollIntervalMinutes: 5,
          targetWorkspaceDir: "D:\\Fish-code\\AGY\\Prismux",
          agentProvider: "dsh",
          agentModel: "deepseek-reasoner",
          oracleReviewEnabled: true,
          localWorktreeOnlyNoPush: true,
        },
      },
      { hasImapPassword: true, hasSmtpPassword: true },
    );

    const sampleRuns: DaemonOvernightRunRecordDto[] = [
      {
        id: "run-1",
        jobId: "fac-001",
        messageId: "<m1@qq.com>",
        threadId: "thread-abc",
        subject: "#factory 优化暗色主题对比度",
        sender: "owner@qq.com",
        status: "completed",
        branchName: "factory/1124-dark-contrast",
        changedFilesCount: 3,
        testPassed: true,
        oracleSummary: "[Review OK] Diff 审计通过，单测全绿。",
        reviewComments: ["[Review OK] Diff 审计通过，单测全绿。"],
        deepLink: "prismux://review/thread-abc",
        reportSent: true,
        createdAt: 1_763_000_000_000,
        completedAt: 1_763_000_060_000,
        errorMessage: null,
      },
      {
        id: "run-2",
        jobId: "blocked-002",
        messageId: "<m2@evil.example>",
        threadId: "",
        subject: "#factory unknown request",
        sender: "stranger@evil.example",
        status: "blocked_whitelist",
        branchName: null,
        changedFilesCount: 0,
        testPassed: null,
        oracleSummary: "发件人不在白名单中，已物理拦截代码执行。",
        reviewComments: [],
        deepLink: null,
        reportSent: false,
        createdAt: 1_763_000_100_000,
        completedAt: 1_763_000_100_005,
        errorMessage: "发件人未命中白名单",
      },
    ];

    const imapHtml = renderToStaticMarkup(
      <PrismuxOvernightFactorySettingsPage
        standalone
        daemonReadyOverride
        serverProvidersOverride={SAMPLE_LIVE_PROVIDERS}
        settingsOverride={null}
        waiverOverride={UNSIGNED_WAIVER}
        initialSnapshotOverride={configuredImapSnap}
        initialRunsOverride={sampleRuns}
        workspaceOptionsOverride={[{ title: "Prismux", cwd: "D:\\Fish-code\\AGY\\Prismux" }]}
      />,
    );
    expect(imapHtml).toContain('data-testid="overnight-imap-form"');
    expect(imapHtml).toContain("谷歌邮箱 (Gmail)");
    expect(imapHtml).toContain("QQ 邮箱");
    expect(imapHtml).toContain("Agent 邮箱");
    expect(imapHtml).toContain("Outlook / Exchange");
    expect(imapHtml).toContain("网易邮箱（163 / 126）");
    expect(imapHtml).toContain("自定义");
    const presetOrder = ["gmail", "qq", "agent_mail", "outlook", "netease", "custom"] as const;
    const presetPositions = presetOrder.map((id) =>
      imapHtml.indexOf(`data-testid="overnight-preset-${id}"`),
    );
    expect(presetPositions.every((pos) => pos > -1)).toBe(true);
    for (let i = 1; i < presetPositions.length; i += 1) {
      expect(presetPositions[i]!).toBeGreaterThan(presetPositions[i - 1]!);
    }

    // Live providers: deduplicated DeepSeek Harness (dsh) with blue whale #4176E6 SVG, zero OMP, zero disabled Claude Code
    const dshPillMatches = imapHtml.match(/data-testid="overnight-provider-dsh"/g) ?? [];
    expect(dshPillMatches).toHaveLength(1);
    expect(imapHtml).toContain("DeepSeek Harness (dsh)");
    expect(imapHtml).toContain("#4176E6");
    expect(imapHtml).not.toContain('data-testid="overnight-provider-omp"');
    expect(imapHtml).not.toContain("OMP");
    expect(imapHtml).not.toContain('data-testid="overnight-provider-claude-code"');

    // Grayed-out Antigravity pill with red-bordered red-text 需签署免责 badge
    expect(imapHtml).toContain('data-testid="overnight-provider-antigravity"');
    expect(imapHtml).toContain('data-agy-blocked="true"');
    expect(imapHtml).toContain('aria-disabled="true"');
    expect(imapHtml).toContain("opacity-60");
    expect(imapHtml).toContain('data-testid="overnight-provider-antigravity-waiver-badge"');
    expect(imapHtml).toContain("border-destructive");
    expect(imapHtml).toContain("text-destructive");
    expect(imapHtml).toContain("需签署免责");

    // Live model selector synced with DeepSeek Harness (dsh)
    expect(imapHtml).toContain('data-testid="overnight-agent-model-select"');
    expect(imapHtml).toContain("DeepSeek Reasoner");
    expect(imapHtml).toContain("已同步 DeepSeek Harness (dsh) 的 2 个实时配置模型");

    expect(imapHtml).toContain("已密封保存");
    expect(imapHtml).toContain("保存邮箱配置");
    expect(imapHtml).toContain("测试收发连通性");
    expect(imapHtml).toContain("发送测试早报");
    expect(imapHtml).toContain("Oracle 只读挑刺审校");
    expect(imapHtml).toContain("安全保护：仅提交本地隔离 Worktree 分支");
    expect(imapHtml).toContain("factory/1124-dark-contrast");
    expect(imapHtml).toContain("审查分支");
    expect(imapHtml).toContain("白名单拦截");

    // Saved legacy AGY config renders explicit red-bordered compliance warning strip & disables save
    const legacyAgySnap = makeSnapshot({
      enabled: true,
      strategy: {
        ...configuredImapSnap.config.strategy,
        agentProvider: "agy",
      },
    });
    const legacyAgyHtml = renderToStaticMarkup(
      <PrismuxOvernightFactorySettingsPage
        standalone
        daemonReadyOverride
        serverProvidersOverride={SAMPLE_LIVE_PROVIDERS}
        settingsOverride={null}
        waiverOverride={UNSIGNED_WAIVER}
        initialSnapshotOverride={legacyAgySnap}
        initialRunsOverride={[]}
        workspaceOptionsOverride={[]}
      />,
    );
    expect(legacyAgyHtml).toContain('data-testid="overnight-agy-compliance-warning"');
    expect(legacyAgyHtml).toContain('data-testid="overnight-agy-waiver-jump-btn"');
    expect(legacyAgyHtml).toContain("需签署免责 · 前往设置");

    // Empty live providers list shows only `chief` + helpful hint linking to `/settings/providers`
    const noProvidersSnap = makeSnapshot({
      enabled: true,
      strategy: {
        ...configuredImapSnap.config.strategy,
        agentProvider: "chief",
      },
    });
    const noProvidersHtml = renderToStaticMarkup(
      <PrismuxOvernightFactorySettingsPage
        standalone
        daemonReadyOverride
        serverProvidersOverride={[]}
        settingsOverride={null}
        waiverOverride={UNSIGNED_WAIVER}
        chiefProviderOverride="codex"
        initialSnapshotOverride={noProvidersSnap}
        initialRunsOverride={[]}
        workspaceOptionsOverride={[]}
      />,
    );
    expect(noProvidersHtml).toContain('data-testid="overnight-provider-chief"');
    expect(noProvidersHtml).toContain('data-testid="overnight-no-live-providers-hint"');
    expect(noProvidersHtml).toContain("前往配置智能体");
    expect(noProvidersHtml).not.toContain('data-testid="overnight-provider-codex"');

    // Unconnected Gmail OAuth2 mode opens interactive 5-step tutorial by default, shows direct quick-jump links,
    // quick-switch button to Generic Gmail IMAP, and live Daemon callback URL (never literal `<daemonPort>`).
    const unconnectedGmailSnap = makeSnapshot({
      mode: "gmail-oauth2",
      gmail: {
        clientId: "pending-client.apps.googleusercontent.com",
        redirectUri: "",
        boundEmail: "",
        connected: false,
        connectedAt: null,
      },
    });
    const unconnectedGmailHtml = renderToStaticMarkup(
      <PrismuxOvernightFactorySettingsPage
        standalone
        daemonReadyOverride
        daemonBaseUrlOverride="http://127.0.0.1:43999"
        serverProvidersOverride={SAMPLE_LIVE_PROVIDERS}
        settingsOverride={null}
        waiverOverride={UNSIGNED_WAIVER}
        initialSnapshotOverride={unconnectedGmailSnap}
        initialRunsOverride={[]}
        workspaceOptionsOverride={[]}
      />,
    );
    expect(unconnectedGmailHtml).toContain('data-testid="overnight-gmail-form"');
    expect(unconnectedGmailHtml).toContain("改用通用邮箱 · 谷歌邮箱 (应用专用密码，1 分钟完成)");
    expect(unconnectedGmailHtml).toContain('data-testid="overnight-gmail-oauth-quick-links"');
    expect(unconnectedGmailHtml).toContain("1. 创建项目");
    expect(unconnectedGmailHtml).toContain("2. 启用 Gmail API");
    expect(unconnectedGmailHtml).toContain("3. 配置同意屏幕");
    expect(unconnectedGmailHtml).toContain("4. 创建 OAuth 客户端");
    expect(unconnectedGmailHtml).toContain('data-testid="overnight-oauth-tutorial-body"');
    expect(unconnectedGmailHtml).toContain("已完成 0 / 5 步");
    expect(unconnectedGmailHtml).toContain(
      "http://127.0.0.1:43999/v1/overnight/oauth/gmail/callback",
    );
    expect(unconnectedGmailHtml).not.toContain("&lt;daemonPort&gt;");
    expect(unconnectedGmailHtml).not.toContain("<daemonPort>");
    expect(unconnectedGmailHtml).toContain("复制回调地址");

    // Connected Gmail OAuth2 mode collapses tutorial by default & renders bound status cleanly
    const connectedGmailSnap = makeSnapshot(
      {
        mode: "gmail-oauth2",
        gmail: {
          clientId: "mock.apps.googleusercontent.com",
          redirectUri: "http://127.0.0.1:43999/v1/overnight/oauth/gmail/callback",
          boundEmail: "boss@gmail.com",
          connected: true,
          connectedAt: 1_763_000_000_000,
        },
      },
      { hasGmailClientSecret: true, hasGmailRefreshToken: true },
    );
    const connectedGmailHtml = renderToStaticMarkup(
      <PrismuxOvernightFactorySettingsPage
        standalone
        daemonReadyOverride
        serverProvidersOverride={SAMPLE_LIVE_PROVIDERS}
        settingsOverride={null}
        waiverOverride={UNSIGNED_WAIVER}
        initialSnapshotOverride={connectedGmailSnap}
        initialRunsOverride={[]}
        workspaceOptionsOverride={[]}
      />,
    );
    expect(connectedGmailHtml).toContain('data-testid="overnight-gmail-form"');
    expect(connectedGmailHtml).not.toContain('data-testid="overnight-oauth-tutorial-body"');
    expect(connectedGmailHtml).toContain("展开互动教程");
    expect(connectedGmailHtml).toContain("一键浏览器登录绑定 Gmail");
    expect(connectedGmailHtml).toContain("boss@gmail.com");
    expect(connectedGmailHtml).toContain("解除绑定");
    expect(connectedGmailHtml).toContain("Refresh Token 已密封保存");
  });
});
