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
import {
  OVERNIGHT_MAIL_PRESETS,
  applyOvernightMailPreset,
  buildOvernightMailSavePayload,
  buildOvernightStrategySavePayload,
  createDefaultOvernightDraft,
  hydrateOvernightDraftFromSnapshot,
  parseAllowedSendersInput,
  shouldDefaultExpandMailChannel,
  shouldDefaultExpandStrategy,
} from "./overnightFactory.logic";
import { PrismuxOvernightFactorySettingsPage } from "./PrismuxOvernightFactorySettingsPage";

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
  it("applies QQ, 163, Outlook, and Custom IMAP/SMTP presets accurately", () => {
    const base = createDefaultOvernightDraft();
    expect(OVERNIGHT_MAIL_PRESETS.map((p) => p.id)).toEqual(["qq", "163", "outlook", "custom"]);

    const qq = applyOvernightMailPreset(base, "qq");
    expect(qq.imapHost).toBe("imap.qq.com");
    expect(qq.imapPort).toBe("993");
    expect(qq.imapSecure).toBe(true);
    expect(qq.smtpHost).toBe("smtp.qq.com");
    expect(qq.smtpPort).toBe("465");
    expect(qq.smtpSecure).toBe(true);

    const netease = applyOvernightMailPreset(qq, "163");
    expect(netease.imapHost).toBe("imap.163.com");
    expect(netease.smtpHost).toBe("smtp.163.com");
    expect(netease.smtpPort).toBe("465");

    const outlook = applyOvernightMailPreset(netease, "outlook");
    expect(outlook.imapHost).toBe("outlook.office365.com");
    expect(outlook.imapPort).toBe("993");
    expect(outlook.smtpHost).toBe("smtp.office365.com");
    expect(outlook.smtpPort).toBe("587");
    expect(outlook.smtpSecure).toBe(false);

    // Custom keeps current values editable without wiping user entries
    const custom = applyOvernightMailPreset(outlook, "custom");
    expect(custom.preset).toBe("custom");
    expect(custom.imapHost).toBe("outlook.office365.com");
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

  it("defaults unconfigured channels to collapsed and expands cleanly when configured", () => {
    const emptySnap = makeSnapshot();
    expect(shouldDefaultExpandMailChannel(emptySnap)).toBe(false);
    expect(shouldDefaultExpandStrategy(emptySnap)).toBe(false);

    const collapsedHtml = renderToStaticMarkup(
      <PrismuxOvernightFactorySettingsPage
        daemonReadyOverride
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
  });

  it("renders configured IMAP/SMTP presets, Gmail OAuth2 mode, strategy controls & run history with deep link", () => {
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
          agentProvider: "codex",
          agentModel: "",
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
        daemonReadyOverride
        initialSnapshotOverride={configuredImapSnap}
        initialRunsOverride={sampleRuns}
        workspaceOptionsOverride={[{ title: "Prismux", cwd: "D:\\Fish-code\\AGY\\Prismux" }]}
      />,
    );
    expect(imapHtml).toContain('data-testid="overnight-imap-form"');
    expect(imapHtml).toContain("QQ 邮箱");
    expect(imapHtml).toContain("163 邮箱");
    expect(imapHtml).toContain("Outlook / Exchange");
    expect(imapHtml).toContain("已密封保存");
    expect(imapHtml).toContain("保存邮箱配置");
    expect(imapHtml).toContain("测试收发连通性");
    expect(imapHtml).toContain("发送测试早报");
    expect(imapHtml).toContain("Oracle 只读挑刺审校");
    expect(imapHtml).toContain("安全保护：仅提交本地隔离 Worktree 分支");
    expect(imapHtml).toContain("factory/1124-dark-contrast");
    expect(imapHtml).toContain("审查分支");
    expect(imapHtml).toContain("白名单拦截");

    // Gmail OAuth2 mode renders OAuth login button & bound status cleanly
    const gmailSnap = makeSnapshot(
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
    const gmailHtml = renderToStaticMarkup(
      <PrismuxOvernightFactorySettingsPage
        daemonReadyOverride
        initialSnapshotOverride={gmailSnap}
        initialRunsOverride={[]}
        workspaceOptionsOverride={[]}
      />,
    );
    expect(gmailHtml).toContain('data-testid="overnight-gmail-form"');
    expect(gmailHtml).toContain("一键浏览器登录绑定 Gmail");
    expect(gmailHtml).toContain("boss@gmail.com");
    expect(gmailHtml).toContain("解除绑定");
    expect(gmailHtml).toContain("Refresh Token 已密封保存");
  });
});
