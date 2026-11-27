import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => () => Promise.resolve(),
  useLocation: (opts?: {
    select?: (loc: { pathname: string; hash: string; state: Record<string, unknown> }) => unknown;
  }) => {
    const loc = {
      pathname: "/overnight-factory",
      hash: "",
      state: {},
    };
    return opts?.select ? opts.select(loc) : loc;
  },
}));

import type {
  DaemonOvernightConfigSnapshot,
  DaemonOvernightMailTestResponse,
} from "../daemonClient";
import type { SubscriptionWaiverState } from "../SubscriptionRiskWaiverSection";
import {
  AGENT_MAIL_DOC_URL,
  AGENT_MAIL_INSTALL_CMD,
  AGENT_MAIL_OFFICIAL_PROMPT,
  AGENT_MAIL_PORTAL_URL,
  MAILBOX_PRESETS,
  NETEASE_DOMAIN_PRESETS,
  OVERNIGHT_MAIL_PRESETS,
  applyNeteaseDomain,
  applyOvernightEmailInput,
  applyOvernightMailPreset,
  buildAgentMailActionTestPayload,
  buildOvernightConnectionChecklist,
  buildOvernightMailSavePayload,
  createDefaultOvernightDraft,
  detectNeteaseDomain,
  extractAgentMailStatusFromSnapshot,
  extractEmailProviderFromSnapshot,
  formatOvernightExecutionStageLabel,
  formatOvernightRunStatusBadge,
  hydrateOvernightDraftFromSnapshot,
  isAgentMailVerified,
  isMailChannelConfigured,
  parseAgentMailTestResponse,
  resolveDefaultTestRecipient,
  resolveMailSectionViewMode,
  shouldAutoCollapseAgentMailSetup,
  shouldDefaultExpandMailChannel,
  toggleMailSectionState,
} from "./overnightFactory.logic";
import {
  PrismuxOvernightFactorySettingsPage,
  type PrismuxOvernightFactorySettingsPageProps,
} from "./PrismuxOvernightFactorySettingsPage";

const UNSIGNED_WAIVER: SubscriptionWaiverState = {
  signed: false,
  waiverVersion: null,
  signedAt: null,
  allowAntigravityAsControlledAgent: false,
  allowExternalSubscriptionAgentsInSwarm: false,
  defaultLocked: true,
};

function makeBaseSnapshot(
  overrides?: Record<string, unknown>,
  extraRoot?: Record<string, unknown>,
): DaemonOvernightConfigSnapshot {
  const base: Record<string, unknown> = {
    ok: true,
    config: {
      schemaVersion: 1,
      updatedAt: 1_763_000_000_000,
      enabled: false,
      mode: "imap",
      emailProvider: "imap_smtp",
      agentMailAddress: "",
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
    ...extraRoot,
  };
  return base as unknown as DaemonOvernightConfigSnapshot;
}

describe("overnightFactory.logic — 6-card presets, NetEase 163/126 & Tencent Agent Mail", () => {
  it("exposes the exact 6-card mailbox preset order for the 3x2 balanced grid", () => {
    expect(OVERNIGHT_MAIL_PRESETS).toBe(MAILBOX_PRESETS);
    expect(OVERNIGHT_MAIL_PRESETS.map((preset) => preset.id)).toEqual([
      "gmail",
      "qq",
      "agent_mail",
      "outlook",
      "netease",
      "custom",
    ]);
    expect(OVERNIGHT_MAIL_PRESETS.map((preset) => preset.label)).toEqual([
      "谷歌邮箱 (Gmail)",
      "QQ 邮箱",
      "Agent 邮箱",
      "Outlook / Exchange",
      "网易邮箱（163 / 126）",
      "自定义",
    ]);

    const gmail = OVERNIGHT_MAIL_PRESETS[0]!;
    expect(gmail.imapHost).toBe("imap.gmail.com");
    expect(gmail.smtpHost).toBe("smtp.gmail.com");

    const qq = OVERNIGHT_MAIL_PRESETS[1]!;
    expect(qq.imapHost).toBe("imap.qq.com");
    expect(qq.smtpHost).toBe("smtp.qq.com");

    const agentMail = OVERNIGHT_MAIL_PRESETS[2]!;
    expect(agentMail.note).toContain("agent.qq.com");
    expect(agentMail.note).toContain("agently-cli");

    const outlook = OVERNIGHT_MAIL_PRESETS[3]!;
    expect(outlook.imapHost).toBe("outlook.office365.com");
    expect(outlook.smtpHost).toBe("smtp.office365.com");
    expect(outlook.smtpPort).toBe(587);
    expect(outlook.smtpSecure).toBe(false);

    const netease = OVERNIGHT_MAIL_PRESETS[4]!;
    expect(netease.imapHost).toBe("imap.163.com");
    expect(netease.smtpHost).toBe("smtp.163.com");
  });

  it("switches NetEase 163.com / 126.com hosts via segmented toggle and auto-switches on @126.com / @163.com email typing", () => {
    expect(detectNeteaseDomain("user@126.com")).toBe("126.com");
    expect(detectNeteaseDomain("USER@163.COM")).toBe("163.com");
    expect(detectNeteaseDomain("user@qq.com")).toBeNull();

    const base = createDefaultOvernightDraft();
    expect(base.preset).toBe("qq");
    expect(base.imapHost).toBe("imap.qq.com");

    // Selecting netease defaults to 163.com SSL hosts
    const netease163 = applyOvernightMailPreset(base, "netease");
    expect(netease163.preset).toBe("netease");
    expect(netease163.neteaseDomain).toBe("163.com");
    expect(netease163.imapHost).toBe(NETEASE_DOMAIN_PRESETS["163.com"].imapHost);
    expect(netease163.imapPort).toBe("993");
    expect(netease163.imapSecure).toBe(true);
    expect(netease163.smtpHost).toBe("smtp.163.com");
    expect(netease163.smtpPort).toBe("465");
    expect(netease163.smtpSecure).toBe(true);

    // Inline segmented toggle to 126.com updates hosts cleanly
    const netease126 = applyNeteaseDomain(netease163, "126.com");
    expect(netease126.preset).toBe("netease");
    expect(netease126.neteaseDomain).toBe("126.com");
    expect(netease126.imapHost).toBe("imap.126.com");
    expect(netease126.smtpHost).toBe("smtp.126.com");
    expect(netease126.imapPort).toBe("993");
    expect(netease126.smtpPort).toBe("465");

    // Typing an @126.com address auto-switches hosts to imap.126.com / smtp.126.com
    const auto126 = applyOvernightEmailInput(netease163, "alice@126.com");
    expect(auto126.preset).toBe("netease");
    expect(auto126.neteaseDomain).toBe("126.com");
    expect(auto126.imapHost).toBe("imap.126.com");
    expect(auto126.smtpHost).toBe("smtp.126.com");
    expect(auto126.imapUsername).toBe("alice@126.com");
    expect(auto126.smtpUsername).toBe("alice@126.com");

    // Typing an @163.com address auto-switches hosts back to imap.163.com / smtp.163.com
    const auto163 = applyOvernightEmailInput(auto126, "bob@163.com");
    expect(auto163.preset).toBe("netease");
    expect(auto163.neteaseDomain).toBe("163.com");
    expect(auto163.imapHost).toBe("imap.163.com");
    expect(auto163.smtpHost).toBe("smtp.163.com");

    // Legacy "163" preset alias remains backwards-compatible
    const legacy163 = applyOvernightMailPreset(base, "163");
    expect(legacy163.preset).toBe("netease");
    expect(legacy163.neteaseDomain).toBe("163.com");
    expect(legacy163.imapHost).toBe("imap.163.com");

    // Custom preset does NOT clobber user's custom host when typing an @126.com email
    const customDraft = {
      ...applyOvernightMailPreset(base, "custom"),
      imapHost: "mail.corp.internal",
      smtpHost: "smtp.corp.internal",
    };
    const customTyped = applyOvernightEmailInput(customDraft, "ops@126.com");
    expect(customTyped.preset).toBe("custom");
    expect(customTyped.imapHost).toBe("mail.corp.internal");
    expect(customTyped.smtpHost).toBe("smtp.corp.internal");
  });

  it("handles Agent Mail preset selection, snapshot hydration, action payloads, and response parsing", () => {
    expect(AGENT_MAIL_PORTAL_URL).toBe("https://agent.qq.com/page");
    expect(AGENT_MAIL_DOC_URL).toBe("https://agent.qq.com/doc/cli-setup.md");
    expect(AGENT_MAIL_INSTALL_CMD).toBe("npm install -g @tencent-qqmail/agently-cli");
    expect(AGENT_MAIL_OFFICIAL_PROMPT).toBe(
      "请阅读 https://agent.qq.com/doc/cli-setup.md 文档，按照步骤为我安装并配置 Agent Mail CLI。",
    );

    const base = createDefaultOvernightDraft();
    const agentDraft = applyOvernightMailPreset(base, "agent_mail");
    expect(agentDraft.preset).toBe("agent_mail");
    expect(agentDraft.emailProvider).toBe("agent_mail");
    expect(agentDraft.mode).toBe("imap");
    expect(isMailChannelConfigured(agentDraft)).toBe(false);

    const savePayload = buildOvernightMailSavePayload({
      ...agentDraft,
      agentMailAuthorizedEmail: "fishundersea@agent.qq.com",
    });
    expect(savePayload.emailProvider).toBe("agent_mail");
    expect(savePayload.agentMailAddress).toBe("fishundersea@agent.qq.com");
    expect(savePayload.imapSmtp?.preset).toBe("agent_mail");

    // Switching back to Gmail smoothly restores imap_smtp mode & Gmail hosts
    const backToGmail = applyOvernightMailPreset(agentDraft, "gmail");
    expect(backToGmail.preset).toBe("gmail");
    expect(backToGmail.emailProvider).toBe("imap_smtp");
    expect(backToGmail.imapHost).toBe("imap.gmail.com");

    // Snapshot hydration with live agentMail runtime object
    const agentSnap = makeBaseSnapshot(
      {
        emailProvider: "agent_mail",
        agentMailAddress: "fishundersea@agent.qq.com",
        imapSmtp: {
          preset: "agent_mail",
          email: "",
          imapHost: "",
          imapPort: 993,
          imapSecure: true,
          imapUsername: "",
          mailbox: "INBOX",
          smtpHost: "",
          smtpPort: 465,
          smtpSecure: true,
          smtpUsername: "",
          fromName: "Prismux Overnight Factory",
        },
      },
      {
        agentMail: {
          cliInstalled: true,
          cliPath: "C:\\Users\\Fish\\AppData\\Roaming\\npm\\agently-cli.cmd",
          authorizedEmail: "fishundersea@agent.qq.com",
          authInProgress: false,
          pendingAuthUrl: null,
          lastError: null,
        },
      },
    );

    expect(extractEmailProviderFromSnapshot(agentSnap)).toBe("agent_mail");
    expect(extractAgentMailStatusFromSnapshot(agentSnap)).toEqual({
      cliInstalled: true,
      cliPath: "C:\\Users\\Fish\\AppData\\Roaming\\npm\\agently-cli.cmd",
      authorizedEmail: "fishundersea@agent.qq.com",
      authInProgress: false,
      pendingAuthUrl: null,
      lastError: null,
    });
    expect(shouldDefaultExpandMailChannel(agentSnap, false)).toBe(true);

    const hydrated = hydrateOvernightDraftFromSnapshot(agentSnap);
    expect(hydrated.preset).toBe("agent_mail");
    expect(hydrated.emailProvider).toBe("agent_mail");
    expect(hydrated.agentMailCliInstalled).toBe(true);
    expect(hydrated.agentMailAuthorizedEmail).toBe("fishundersea@agent.qq.com");
    expect(isMailChannelConfigured(hydrated)).toBe(true);

    // Action payload & opaque authUrl preservation
    expect(buildAgentMailActionTestPayload("login")).toEqual({
      emailProvider: "agent_mail",
      agentMailAction: "login",
    });

    const opaqueUrl =
      "https://agent.qq.com/oauth/authorize?client_id=agently&state=RAW%2BSTATE%3D%3D&redirect_uri=https%3A%2F%2Fagent.qq.com%2Fcb";
    const mockResp = {
      ok: true,
      mode: "imap",
      checkedAt: 1_763_000_000_000,
      durationMs: 120,
      inbound: { ok: true, latencyMs: 120, message: "ok" },
      outbound: { ok: true, latencyMs: 120, message: "ok" },
      message: "请点击或复制以下链接在浏览器中完成授权：",
      installed: true,
      authUrl: opaqueUrl,
      authInProgress: true,
      authorizedEmail: null,
    } as unknown as DaemonOvernightMailTestResponse;

    const parsed = parseAgentMailTestResponse(mockResp);
    expect(parsed.ok).toBe(true);
    expect(parsed.installed).toBe(true);
    expect(parsed.authInProgress).toBe(true);
    // Verbatim opaque URL must not be encoded, decoded, or re-serialized
    expect(parsed.authUrl).toBe(opaqueUrl);
  });

  it("renders exact 6-card order, Liquid Glass selected card polish, NetEase 163/126 toggle, and Agent Mail setup card", () => {
    const neteaseSnap = makeBaseSnapshot({
      emailProvider: "imap_smtp",
      imapSmtp: {
        preset: "netease",
        email: "dev@126.com",
        imapHost: "imap.126.com",
        imapPort: 993,
        imapSecure: true,
        imapUsername: "dev@126.com",
        mailbox: "INBOX",
        smtpHost: "smtp.126.com",
        smtpPort: 465,
        smtpSecure: true,
        smtpUsername: "dev@126.com",
        fromName: "Prismux Overnight Factory",
      },
    });
    const neteaseHtml = renderToStaticMarkup(
      createElement<PrismuxOvernightFactorySettingsPageProps>(PrismuxOvernightFactorySettingsPage, {
        standalone: true,
        daemonReadyOverride: true,
        serverProvidersOverride: [],
        settingsOverride: null,
        waiverOverride: UNSIGNED_WAIVER,
        initialSnapshotOverride: neteaseSnap,
        initialRunsOverride: [],
        workspaceOptionsOverride: [],
      }),
    );

    // Verify exact DOM order of all 6 mailbox preset cards
    const presetIds = ["gmail", "qq", "agent_mail", "outlook", "netease", "custom"] as const;
    const positions = presetIds.map((id) =>
      neteaseHtml.indexOf(`data-testid="overnight-preset-${id}"`),
    );
    for (const pos of positions) {
      expect(pos).toBeGreaterThan(-1);
    }
    for (let i = 1; i < positions.length; i += 1) {
      expect(positions[i]!).toBeGreaterThan(positions[i - 1]!);
    }

    // Selected preset uses tasteful translucent Liquid Glass accent card (no harsh solid bg-primary fill)
    expect(neteaseHtml).toContain("border-primary/70 bg-primary/15");
    expect(neteaseHtml).toContain("ring-1 ring-primary/30");
    // NetEase inline 163.com / 126.com segmented switch & active 126 hosts rendered
    expect(neteaseHtml).toContain('data-testid="overnight-netease-domain-switch"');
    expect(neteaseHtml).toContain("163.com");
    expect(neteaseHtml).toContain("126.com");
    expect(neteaseHtml).toContain("imap.126.com");
    expect(neteaseHtml).toContain('data-testid="overnight-imap-password-input"');

    // Agent Mail card hides raw IMAP/SMTP password inputs and shows guided 3-step setup + opaque OAuth URL
    const pendingOpaqueUrl = "https://agent.qq.com/oauth/authorize?code=RAW%2BVAL&state=123";
    const agentMailSnap = makeBaseSnapshot(
      {
        emailProvider: "agent_mail",
        agentMailAddress: "fishundersea@agent.qq.com",
        imapSmtp: {
          preset: "agent_mail",
          email: "",
          imapHost: "",
          imapPort: 993,
          imapSecure: true,
          imapUsername: "",
          mailbox: "INBOX",
          smtpHost: "",
          smtpPort: 465,
          smtpSecure: true,
          smtpUsername: "",
          fromName: "Prismux Overnight Factory",
        },
      },
      {
        agentMail: {
          cliInstalled: true,
          authorizedEmail: "fishundersea@agent.qq.com",
          authInProgress: true,
          pendingAuthUrl: pendingOpaqueUrl,
          lastError: null,
        },
      },
    );
    const agentMailHtml = renderToStaticMarkup(
      createElement<PrismuxOvernightFactorySettingsPageProps>(PrismuxOvernightFactorySettingsPage, {
        standalone: true,
        daemonReadyOverride: true,
        serverProvidersOverride: [],
        settingsOverride: null,
        waiverOverride: UNSIGNED_WAIVER,
        initialSnapshotOverride: agentMailSnap,
        initialRunsOverride: [],
        workspaceOptionsOverride: [],
      }),
    );

    expect(agentMailHtml).toContain('data-testid="overnight-agent-mail-card"');
    expect(agentMailHtml).not.toContain('data-testid="overnight-imap-password-input"');
    expect(agentMailHtml).toContain("fishundersea@agent.qq.com");
    expect(agentMailHtml).toContain("打开 agent.qq.com");
    expect(agentMailHtml).toContain("一键安装 / 更新 CLI");
    expect(agentMailHtml).toContain("发起 OAuth 浏览器授权");
    expect(agentMailHtml).toContain("检测授权身份（agently-cli +me）");
    expect(agentMailHtml).toContain('data-testid="overnight-agent-mail-oauth-url"');
    expect(agentMailHtml).toContain(
      "https://agent.qq.com/oauth/authorize?code=RAW%2BVAL&amp;state=123",
    );
    expect(agentMailHtml).toContain('data-testid="overnight-agent-mail-prompt-toggle"');
  });

  it("auto-promotes live detected agently-cli login to configured state, computes 4-step checklist, resolves default test recipient, and maps live run stages", () => {
    // Fresh daemon snapshot has default `emailProvider: "imap_smtp"` with empty IMAP credentials,
    // while `agentMail` probe reports an externally installed & logged-in `agently-cli`!
    const externallyConfiguredSnap = makeBaseSnapshot(
      {
        emailProvider: "imap_smtp",
        mode: "imap",
      },
      {
        agentMail: {
          cliInstalled: true,
          installed: true,
          version: "1.0.18",
          cliPath: "C:\\Users\\Fish\\AppData\\Roaming\\npm\\agently-cli.cmd",
          binaryPath: "C:\\Users\\Fish\\AppData\\Roaming\\npm\\agently-cli.cmd",
          loggedIn: true,
          authorizedEmail: "fishundersea@agent.qq.com",
          address: "fishundersea@agent.qq.com",
          configured: true,
          scopes: ["mail:read", "mail:send"],
          dailySendQuota: 50,
          authInProgress: false,
          pendingAuthUrl: null,
          lastError: null,
        },
      },
    );

    // Must immediately promote to agent_mail and report configured + expanded!
    const draft = hydrateOvernightDraftFromSnapshot(externallyConfiguredSnap);
    expect(draft.emailProvider).toBe("agent_mail");
    expect(draft.preset).toBe("agent_mail");
    expect(draft.agentMailCliInstalled).toBe(true);
    expect(draft.agentMailVersion).toBe("1.0.18");
    expect(draft.agentMailConfigured).toBe(true);
    expect(draft.agentMailAuthorizedEmail).toBe("fishundersea@agent.qq.com");
    expect(draft.agentMailDailySendQuota).toBe(50);
    expect(isMailChannelConfigured(draft)).toBe(true);
    expect(shouldDefaultExpandMailChannel(externallyConfiguredSnap, false)).toBe(true);
    expect(resolveDefaultTestRecipient(draft)).toBe("fishundersea@agent.qq.com");

    // 4-step checklist reflects passed state when Agent Mail is detected & outbound fails when testResult reports failure
    const readyChecklist = buildOvernightConnectionChecklist(draft, null);
    expect(readyChecklist.map((s) => s.status)).toEqual(["passed", "passed", "passed", "passed"]);
    expect(readyChecklist[0]?.detail).toContain("fishundersea@agent.qq.com");
    expect(readyChecklist[0]?.detail).toContain("v1.0.18");

    const failedOutboundChecklist = buildOvernightConnectionChecklist(draft, {
      ok: false,
      mode: "imap",
      emailProvider: "agent_mail",
      checkedAt: 1_763_000_000_000,
      durationMs: 120,
      inbound: { ok: true, latencyMs: 80, message: "收信正常" },
      outbound: { ok: false, latencyMs: 40, message: "发信权限缺失", hint: "重新授权" },
      message: "发信校验失败",
    });
    expect(failedOutboundChecklist.map((s) => s.status)).toEqual([
      "passed",
      "passed",
      "error",
      "error",
    ]);

    // Save payload carries `useSeparateSmtpPassword: false` explicitly so daemon clears stale SMTP secrets
    const qqDraft = {
      ...createDefaultOvernightDraft(),
      email: "owner@qq.com",
      useSeparateSmtpPassword: false,
      imapPasswordInput: "fresh-auth",
      smtpPasswordInput: "ignored-when-unchecked",
    };
    const savePayload = buildOvernightMailSavePayload(qqDraft);
    expect(savePayload.imapSmtp?.useSeparateSmtpPassword).toBe(false);
    expect(savePayload.secrets).toEqual({ imapPassword: "fresh-auth" });

    // Live execution stage & run status badges
    expect(formatOvernightExecutionStageLabel("preparing_worktree")).toBe("准备工作树");
    expect(formatOvernightExecutionStageLabel("running_agent")).toBe("代理编码中");
    expect(formatOvernightExecutionStageLabel("verifying")).toBe("验收测试");
    expect(formatOvernightRunStatusBadge("running")).toEqual({
      label: "执行中",
      variant: "warning",
    });
    expect(formatOvernightRunStatusBadge("cancelled")).toEqual({
      label: "已取消",
      variant: "secondary",
    });
  });

  it("auto-collapses verified Agent Mail setup into test-only view and preserves every state transition cleanly", () => {
    const base = createDefaultOvernightDraft();

    // 1. Uninstalled / unverified Agent Mail MUST NOT auto-collapse
    const uninstalledAgentMail = applyOvernightMailPreset(base, "agent_mail");
    expect(isAgentMailVerified(uninstalledAgentMail)).toBe(false);
    expect(
      shouldAutoCollapseAgentMailSetup({
        draft: uninstalledAgentMail,
        userExpandedSetup: false,
      }),
    ).toBe(false);
    expect(
      resolveMailSectionViewMode({
        draft: uninstalledAgentMail,
        mailExpanded: true,
        userExpandedSetup: false,
      }),
    ).toBe("expanded_setup");

    // 2. Installed CLI but NOT logged in yet MUST NOT auto-collapse
    const installedUnlogged = {
      ...uninstalledAgentMail,
      agentMailCliInstalled: true,
      agentMailVersion: "1.0.18",
      agentMailLoggedIn: false,
      agentMailConfigured: false,
      agentMailAuthorizedEmail: null,
      agentMailAddress: "",
    };
    expect(isAgentMailVerified(installedUnlogged)).toBe(false);
    expect(
      shouldAutoCollapseAgentMailSetup({
        draft: installedUnlogged,
        userExpandedSetup: false,
      }),
    ).toBe(false);

    // 3. OAuth login in progress with pending URL MUST stay expanded so user can finish browser login
    const oauthInProgress = {
      ...installedUnlogged,
      agentMailLoggedIn: true,
      agentMailConfigured: true,
      agentMailAuthorizedEmail: "fishundersea@agent.qq.com",
      agentMailAddress: "fishundersea@agent.qq.com",
      agentMailAuthInProgress: true,
      agentMailPendingAuthUrl: "https://agent.qq.com/oauth/authorize?code=123",
    };
    expect(isAgentMailVerified(oauthInProgress)).toBe(false);
    expect(
      shouldAutoCollapseAgentMailSetup({
        draft: oauthInProgress,
        userExpandedSetup: false,
      }),
    ).toBe(false);

    // 4. Verified & logged-in Agent Mail AUTOMATICALLY collapses onboarding when userExpandedSetup is false
    const verifiedAgentMail = {
      ...oauthInProgress,
      agentMailAuthInProgress: false,
      agentMailPendingAuthUrl: null,
    };
    expect(isAgentMailVerified(verifiedAgentMail)).toBe(true);
    expect(
      shouldAutoCollapseAgentMailSetup({
        draft: verifiedAgentMail,
        userExpandedSetup: false,
      }),
    ).toBe(true);
    expect(
      resolveMailSectionViewMode({
        draft: verifiedAgentMail,
        mailExpanded: true,
        userExpandedSetup: false,
      }),
    ).toBe("agent_mail_verified_compact");
    // Even if mailExpanded is false in embedded settings, verified Agent Mail shows the compact test bar
    expect(
      resolveMailSectionViewMode({
        draft: verifiedAgentMail,
        mailExpanded: false,
        userExpandedSetup: false,
      }),
    ).toBe("agent_mail_verified_compact");

    // 5. Clicking "展开配置 / 切换邮箱" expands full setup and keeps it expanded while editing
    const afterExpand = toggleMailSectionState({
      draft: verifiedAgentMail,
      mailExpanded: true,
      userExpandedSetup: false,
    });
    expect(afterExpand).toEqual({ mailExpanded: true, userExpandedSetup: true });
    expect(
      shouldAutoCollapseAgentMailSetup({
        draft: verifiedAgentMail,
        userExpandedSetup: afterExpand.userExpandedSetup,
      }),
    ).toBe(false);
    expect(
      resolveMailSectionViewMode({
        draft: verifiedAgentMail,
        mailExpanded: afterExpand.mailExpanded,
        userExpandedSetup: afterExpand.userExpandedSetup,
      }),
    ).toBe("expanded_setup");

    // 6. Switching to another provider while expanded stays expanded and never auto-collapses
    const switchedToQq = applyOvernightMailPreset(verifiedAgentMail, "qq");
    expect(isAgentMailVerified(switchedToQq)).toBe(false);
    expect(
      resolveMailSectionViewMode({
        draft: switchedToQq,
        mailExpanded: afterExpand.mailExpanded,
        userExpandedSetup: afterExpand.userExpandedSetup,
      }),
    ).toBe("expanded_setup");

    // 7. Clicking "收起配置" on verified Agent Mail returns cleanly to compact verified test bar
    const afterCollapse = toggleMailSectionState({
      draft: verifiedAgentMail,
      mailExpanded: afterExpand.mailExpanded,
      userExpandedSetup: afterExpand.userExpandedSetup,
    });
    expect(afterCollapse).toEqual({ mailExpanded: true, userExpandedSetup: false });
    expect(
      resolveMailSectionViewMode({
        draft: verifiedAgentMail,
        mailExpanded: afterCollapse.mailExpanded,
        userExpandedSetup: afterCollapse.userExpandedSetup,
      }),
    ).toBe("agent_mail_verified_compact");
  });
});
