import * as NodeAssert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import { EncryptedPluginCredentialStore } from "@prismux/cordis-kernel";
import {
  OVERNIGHT_CREDENTIAL_BUCKET,
  OVERNIGHT_MAIL_PRESETS,
  OVERNIGHT_MAIL_PRESET_ORDER,
  OvernightFactory,
  OvernightRouteService,
  PrismuxDaemon,
  extractAgentMailAddress,
  extractOpaqueOAuthUrl,
  isSenderAllowed,
  isWithinExecutionWindow,
  type AgentMailLoginSpawnHandle,
  type OutboundMailPayload,
} from "../index.js";
import {
  defaultProbeSmtpConnection,
  defaultSendSmtpMail,
  extractAgentMailVersion,
  parseAgentMailListMessages,
  parseAgentMailMeOutput,
  resolveEffectiveSmtpFromAddress,
} from "../server/OvernightRoutes.js";
import { ChiefThreadManager } from "../chief/ChiefThreadManager.js";

const assert: typeof NodeAssert = NodeAssert;
const { describe, it } = NodeTest;
const FIXED_TEST_EPOCH_MS = 1_763_000_000_000;

describe("OvernightRouteService & /v1/overnight/* API (encrypted credentials, OAuth2, whitelist & mail)", () => {
  it("persists non-secret config in JSON and seals all mail secrets write-only into overnight-factory.enc", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pmx-overnight-cred-"));
    try {
      const store = new EncryptedPluginCredentialStore({
        dataDir: dir,
        masterKey: NodeCrypto.randomBytes(32),
      });
      const service = new OvernightRouteService({
        dataDir: dir,
        credentialStore: store,
      });

      const secretPass = "qq-auth-code-super-secret-998877";
      const gmailSecret = "GOCSPX-secret-value-123456";

      const updated = await service.updateConfig(
        {
          enabled: true,
          mode: "imap",
          imapSmtp: {
            preset: "qq",
            email: "boss@qq.com",
            imapHost: OVERNIGHT_MAIL_PRESETS.qq.imapHost,
            imapPort: 993,
            imapSecure: true,
            smtpHost: OVERNIGHT_MAIL_PRESETS.qq.smtpHost,
            smtpPort: 465,
            smtpSecure: true,
          },
          gmail: {
            clientId: "12345.apps.googleusercontent.com",
          },
          secrets: {
            imapPassword: secretPass,
            gmailClientSecret: gmailSecret,
          },
          strategy: {
            triggerTag: "#factory",
            allowedSenders: ["Boss@QQ.com", "alice@example.com"],
            windowMode: "scheduled",
            windowStart: "23:00",
            windowEnd: "07:00",
            pollIntervalMinutes: 10,
            targetWorkspaceDir: dir,
            agentProvider: "codex",
            oracleReviewEnabled: true,
            localWorktreeOnlyNoPush: true,
          },
        },
        "owner_chief",
      );

      // 1. Response never echoes plaintext secrets; only exposes boolean badges
      const serializedResp = JSON.stringify(updated);
      assert.equal(serializedResp.includes(secretPass), false);
      assert.equal(serializedResp.includes(gmailSecret), false);
      assert.equal(updated.secrets.hasImapPassword, true);
      assert.equal(updated.secrets.hasSmtpPassword, true);
      assert.equal(updated.secrets.hasGmailClientSecret, true);
      assert.equal(updated.secrets.hasGmailRefreshToken, false);
      assert.deepEqual(updated.config.strategy.allowedSenders, [
        "boss@qq.com",
        "alice@example.com",
      ]);

      // 2. Plaintext JSON config contains zero secrets
      const rawJson = NodeFS.readFileSync(NodePath.join(dir, "overnight-factory.json"), "utf8");
      assert.equal(rawJson.includes(secretPass), false);
      assert.equal(rawJson.includes(gmailSecret), false);

      // 3. Encrypted credential file exists at credentials/overnight-factory.enc without plaintext
      const encPath = store.getCredentialFilePath(OVERNIGHT_CREDENTIAL_BUCKET);
      assert.equal(NodeFS.existsSync(encPath), true);
      assert.ok(encPath.endsWith(`${OVERNIGHT_CREDENTIAL_BUCKET}.enc`));
      const encRaw = NodeFS.readFileSync(encPath, "utf8");
      assert.equal(encRaw.includes(secretPass), false);
      assert.equal(encRaw.includes(gmailSecret), false);
      // oxlint-disable-next-line prismux/no-global-process-runtime -- daemon node:test checks POSIX 0600 file permissions outside Effect HostProcess
      if (NodeOS.platform() !== "win32") {
        assert.equal(NodeFS.statSync(encPath).mode & 0o777, 0o600);
      }

      // 4. Subsequent PUT with empty secret strings preserves existing sealed secrets
      const preserved = await service.updateConfig(
        {
          secrets: { imapPassword: "", gmailClientSecret: "" },
          strategy: { triggerTag: "#nightly" },
        },
        "owner_chief",
      );
      assert.equal(preserved.secrets.hasImapPassword, true);
      assert.equal(preserved.secrets.hasGmailClientSecret, true);
      assert.equal(preserved.config.strategy.triggerTag, "#nightly");

      // 5. Non-owner scope is strictly rejected (403 FORBIDDEN_SCOPE)
      await assert.rejects(
        () => service.getConfigSnapshot("qq_group:1001"),
        (err: unknown) =>
          err instanceof Error && (err as { statusCode?: number }).statusCode === 403,
      );

      service.stop();
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("supports exact 6-card mailbox preset order, Gmail IMAP/SMTP, and NetEase 163/126 auto-host switching", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pmx-overnight-gmail-imap-"));
    try {
      assert.deepEqual(OVERNIGHT_MAIL_PRESET_ORDER, [
        "gmail",
        "qq",
        "agent_mail",
        "outlook",
        "netease",
        "custom",
      ]);
      assert.deepEqual(Object.keys(OVERNIGHT_MAIL_PRESETS), [
        "gmail",
        "qq",
        "agent_mail",
        "outlook",
        "netease",
        "custom",
      ]);

      assert.equal(OVERNIGHT_MAIL_PRESETS.gmail.id, "gmail");
      assert.equal(OVERNIGHT_MAIL_PRESETS.gmail.label, "谷歌邮箱 (Gmail)");
      assert.equal(OVERNIGHT_MAIL_PRESETS.gmail.imapHost, "imap.gmail.com");
      assert.equal(OVERNIGHT_MAIL_PRESETS.gmail.imapPort, 993);
      assert.equal(OVERNIGHT_MAIL_PRESETS.gmail.imapSecure, true);
      assert.equal(OVERNIGHT_MAIL_PRESETS.gmail.smtpHost, "smtp.gmail.com");
      assert.equal(OVERNIGHT_MAIL_PRESETS.gmail.smtpPort, 465);
      assert.equal(OVERNIGHT_MAIL_PRESETS.gmail.smtpSecure, true);
      assert.equal(OVERNIGHT_MAIL_PRESETS.netease.label, "网易邮箱（163 / 126）");

      const store = new EncryptedPluginCredentialStore({
        dataDir: dir,
        masterKey: NodeCrypto.randomBytes(32),
      });
      const service = new OvernightRouteService({
        dataDir: dir,
        credentialStore: store,
      });

      const initial = await service.getConfigSnapshot("owner_chief");
      assert.equal(initial.config.mode, "imap");
      assert.equal(initial.config.emailProvider, "imap_smtp");

      // Patching preset="gmail" without explicit host/port auto-fills Gmail SSL defaults
      const updated = await service.updateConfig(
        {
          mode: "imap",
          imapSmtp: {
            preset: "gmail",
            email: "dev@gmail.com",
          },
          secrets: {
            imapPassword: "abcd efgh ijkl mnop",
          },
        },
        "owner_chief",
      );

      assert.equal(updated.config.mode, "imap");
      assert.equal(updated.config.imapSmtp.preset, "gmail");
      assert.equal(updated.config.imapSmtp.email, "dev@gmail.com");
      assert.equal(updated.config.imapSmtp.imapHost, "imap.gmail.com");
      assert.equal(updated.config.imapSmtp.imapPort, 993);
      assert.equal(updated.config.imapSmtp.imapSecure, true);
      assert.equal(updated.config.imapSmtp.smtpHost, "smtp.gmail.com");
      assert.equal(updated.config.imapSmtp.smtpPort, 465);
      assert.equal(updated.config.imapSmtp.smtpSecure, true);
      assert.equal(updated.secrets.hasImapPassword, true);
      assert.equal(updated.secrets.hasSmtpPassword, true);

      // NetEase preset with @126.com email automatically resolves imap.126.com / smtp.126.com
      const netease126 = await service.updateConfig(
        {
          mode: "imap",
          imapSmtp: {
            preset: "netease",
            email: "nightowl@126.com",
          },
        },
        "owner_chief",
      );
      assert.equal(netease126.config.imapSmtp.preset, "netease");
      assert.equal(netease126.config.imapSmtp.imapHost, "imap.126.com");
      assert.equal(netease126.config.imapSmtp.smtpHost, "smtp.126.com");
      assert.equal(netease126.config.imapSmtp.imapPort, 993);
      assert.equal(netease126.config.imapSmtp.smtpPort, 465);

      // Legacy preset="163" normalizes cleanly to "netease" with imap.163.com / smtp.163.com
      const legacy163 = await service.updateConfig(
        {
          mode: "imap",
          imapSmtp: {
            preset: "163",
            email: "nightowl@163.com",
          },
        },
        "owner_chief",
      );
      assert.equal(legacy163.config.imapSmtp.preset, "netease");
      assert.equal(legacy163.config.imapSmtp.imapHost, "imap.163.com");
      assert.equal(legacy163.config.imapSmtp.smtpHost, "smtp.163.com");
      service.stop();

      // Reload from persisted JSON preserves normalized "netease" preset and endpoints
      const reloaded = new OvernightRouteService({
        dataDir: dir,
        credentialStore: store,
      });
      const snap = await reloaded.getConfigSnapshot("owner_chief");
      assert.equal(snap.config.imapSmtp.preset, "netease");
      assert.equal(snap.config.imapSmtp.imapHost, "imap.163.com");
      assert.equal(snap.config.imapSmtp.smtpHost, "smtp.163.com");
      reloaded.stop();
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("integrates Tencent Agent Mail CLI (status, install, opaque OAuth login, auto-persist +me, send report & pollNow)", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pmx-overnight-agentmail-"));
    try {
      const store = new EncryptedPluginCredentialStore({
        dataDir: dir,
        masterKey: NodeCrypto.randomBytes(32),
      });

      const opaqueUrl =
        "https://agent.qq.com/oauth/authorize?client_id=agently&state=RAW%2BOPAQUE%3D%3D&nonce=AbC_123";
      assert.equal(
        extractOpaqueOAuthUrl(`\u001b[36m请打开链接：${opaqueUrl}\u001b[0m\n`),
        opaqueUrl,
      );
      assert.equal(
        extractAgentMailAddress('{"email":"fishundersea@agent.qq.com","aliases":[]}'),
        "fishundersea@agent.qq.com",
      );

      let cliInstalled = false;
      let loggedIn = false;
      const loginHooks: {
        exit?: (code: number | null, signal: NodeJS.Signals | null) => void;
      } = {};
      let resolvePostLoginPersist: (() => void) | null = null;
      const postLoginPersisted = new Promise<void>((resolve) => {
        resolvePostLoginPersist = resolve;
      });
      const invokedCliArgs: string[][] = [];

      const service = new OvernightRouteService({
        dataDir: dir,
        credentialStore: store,
        onConfigChanged: () => {
          if (loggedIn) {
            resolvePostLoginPersist?.();
          }
        },
        networkHooks: {
          now: () => FIXED_TEST_EPOCH_MS,
          findAgentMailCli: () => (cliInstalled ? "/usr/local/bin/agently-cli" : null),
          installAgentMailCli: async () => {
            cliInstalled = true;
            return {
              exitCode: 0,
              stdout:
                "added 1 package @tencent-qqmail/agently-cli Bearer secret_token_should_redact",
              stderr: "",
            };
          },
          runAgentMailCli: async (_cliPath, args) => {
            invokedCliArgs.push([...args]);
            if (args[0] === "+me") {
              if (!loggedIn) {
                return { exitCode: 1, stdout: "", stderr: "not logged in" };
              }
              return {
                exitCode: 0,
                stdout: "Current account: fishundersea@agent.qq.com\n",
                stderr: "",
              };
            }
            if (args[0] === "message" && args[1] === "+send") {
              return {
                exitCode: 0,
                stdout: JSON.stringify({ success: true, messageId: "agm-report-9001" }),
                stderr: "",
              };
            }
            if (args[0] === "message" && args[1] === "+list") {
              return {
                exitCode: 0,
                stdout: JSON.stringify({
                  messages: [
                    {
                      id: "agm-msg-1",
                      from: "stranger@untrusted.dev",
                      to: ["fishundersea@agent.qq.com"],
                      subject: "#factory unauthorized",
                      text: "blocked by whitelist",
                    },
                  ],
                }),
                stderr: "",
              };
            }
            return { exitCode: 1, stdout: "", stderr: "unexpected command" };
          },
          spawnAgentMailLogin: (): AgentMailLoginSpawnHandle => {
            let stdoutCb: ((chunk: string) => void) | null = null;
            return {
              onStdout: (cb) => {
                stdoutCb = cb;
                queueMicrotask(() => {
                  stdoutCb?.(`请打开浏览器完成授权：\n${opaqueUrl}\n`);
                });
              },
              onStderr: () => {},
              onExit: (cb) => {
                loginHooks.exit = cb;
              },
              onError: () => {},
              kill: () => {},
            };
          },
        },
      });

      // 1. When CLI is absent, getConfigSnapshot never crashes and reports cliInstalled=false
      const snapBefore = await service.getConfigSnapshot("owner_chief");
      assert.equal(snapBefore.agentMail.cliInstalled, false);
      assert.equal(snapBefore.agentMail.authorizedEmail, null);

      // 2. Persist emailProvider="agent_mail"
      const switched = await service.updateConfig({ emailProvider: "agent_mail" }, "owner_chief");
      assert.equal(switched.config.emailProvider, "agent_mail");
      assert.equal(switched.config.imapSmtp.preset, "agent_mail");

      // 3. agentMailAction="install" installs CLI and redacts tokens in stdout
      const installRes = await service.testMailConnection(
        { emailProvider: "agent_mail", agentMailAction: "install" },
        "owner_chief",
      );
      assert.equal(installRes.ok, true);
      assert.equal(installRes.installed, true);
      assert.equal(installRes.stdout?.includes("secret_token_should_redact"), false);
      assert.equal(installRes.stdout?.includes("[REDACTED]"), true);

      // 4. agentMailAction="login" captures exact unmodified opaque OAuth URL immediately
      const loginRes = await service.testMailConnection(
        { emailProvider: "agent_mail", agentMailAction: "login" },
        "owner_chief",
      );
      assert.equal(loginRes.ok, true);
      assert.equal(loginRes.authInProgress, true);
      assert.equal(loginRes.authUrl, opaqueUrl);

      const duringAuth = await service.getConfigSnapshot("owner_chief");
      assert.equal(duringAuth.agentMail.authInProgress, true);
      assert.equal(duringAuth.agentMail.pendingAuthUrl, opaqueUrl);

      // 5. Simulate user finishing browser authorization -> login process exits 0 -> +me persists agentMailAddress
      loggedIn = true;
      loginHooks.exit?.(0, null);
      await postLoginPersisted;

      const afterAuth = await service.getConfigSnapshot("owner_chief");
      assert.equal(afterAuth.agentMail.cliInstalled, true);
      assert.equal(afterAuth.agentMail.authInProgress, false);
      assert.equal(afterAuth.agentMail.authorizedEmail, "fishundersea@agent.qq.com");
      assert.equal(afterAuth.config.agentMailAddress, "fishundersea@agent.qq.com");

      // 6. Standard testMailConnection verifies @agent.qq.com mailbox
      const verified = await service.testMailConnection(
        { emailProvider: "agent_mail" },
        "owner_chief",
      );
      assert.equal(verified.ok, true);
      assert.equal(verified.authorizedEmail, "fishundersea@agent.qq.com");

      // 7. sendTestMorningReport sends cleanly through agently-cli message +send
      const report = await service.sendTestMorningReport({}, "owner_chief");
      assert.equal(report.ok, true);
      assert.equal(report.recipient, "fishundersea@agent.qq.com");
      assert.equal(report.messageId, "agm-report-9001");
      assert.equal(report.provider, "agent_mail:agently-cli");

      // 8. pollNow lists messages via agently-cli message +list and enforces sender whitelist
      const poll = await service.pollNow({}, "owner_chief");
      assert.equal(poll.ok, true);
      assert.equal(poll.fetchedCount, 1);
      assert.equal(poll.blockedByWhitelistCount, 1);
      assert.ok(invokedCliArgs.some((args) => args[0] === "message" && args[1] === "+list"));

      service.stop();
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("handles Gmail OAuth2 PKCE start -> callback -> token seal -> connectivity test -> disconnect", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pmx-overnight-oauth-"));
    try {
      const store = new EncryptedPluginCredentialStore({
        dataDir: dir,
        masterKey: NodeCrypto.randomBytes(32),
      });

      const fakeFetch: typeof fetch = async (input) => {
        const url = String(input);
        if (url.includes("oauth2.googleapis.com/token")) {
          return new Response(
            JSON.stringify({
              access_token: "ya29.mock-access-token",
              refresh_token: "1//mock-refresh-token-sealed",
              expires_in: 3600,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.includes("gmail.googleapis.com/gmail/v1/users/me/profile")) {
          return new Response(
            JSON.stringify({
              emailAddress: "owner@gmail.com",
              messagesTotal: 42,
              historyId: "9001",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("not found", { status: 404 });
      };

      const service = new OvernightRouteService({
        dataDir: dir,
        credentialStore: store,
        networkHooks: { fetchFn: fakeFetch },
      });

      const started = await service.startGmailOAuth(
        {
          clientId: "mock-client.apps.googleusercontent.com",
          clientSecret: "GOCSPX-mock-client-secret",
        },
        "owner_chief",
        "http://127.0.0.1:43999",
      );
      assert.equal(started.ok, true);
      assert.ok(started.authUrl.includes("accounts.google.com/o/oauth2/v2/auth"));
      assert.ok(started.authUrl.includes("code_challenge_method=S256"));
      assert.equal(started.redirectUri, "http://127.0.0.1:43999/v1/overnight/oauth/gmail/callback");

      // Rejects forged state
      const forged = await service.handleGmailOAuthCallback(
        new URLSearchParams({ state: "forged-state", code: "abc" }),
      );
      assert.equal(forged.ok, false);
      assert.equal(forged.statusCode, 400);

      // Valid callback binds Gmail email and seals refresh token
      const cb = await service.handleGmailOAuthCallback(
        new URLSearchParams({ state: started.state, code: "auth-code-123" }),
      );
      assert.equal(cb.ok, true);
      assert.equal(cb.statusCode, 200);
      assert.equal(cb.boundEmail, "owner@gmail.com");

      const snap = await service.getConfigSnapshot("owner_chief");
      assert.equal(snap.config.mode, "gmail-oauth2");
      assert.equal(snap.config.emailProvider, "gmail_oauth2");
      assert.equal(snap.config.gmail.connected, true);
      assert.equal(snap.config.gmail.boundEmail, "owner@gmail.com");
      assert.equal(snap.secrets.hasGmailRefreshToken, true);
      assert.deepEqual(snap.config.strategy.allowedSenders, ["owner@gmail.com"]);

      // Connectivity test succeeds against mocked Gmail profile endpoint
      const testRes = await service.testMailConnection({}, "owner_chief");
      assert.equal(testRes.ok, true);
      assert.equal(testRes.inbound.ok, true);
      assert.equal(testRes.outbound.ok, true);

      // Disconnect purges refresh token and clears bound email
      const afterDisconnect = await service.disconnectGmail("owner_chief");
      assert.equal(afterDisconnect.config.gmail.connected, false);
      assert.equal(afterDisconnect.config.gmail.boundEmail, "");
      assert.equal(afterDisconnect.secrets.hasGmailRefreshToken, false);

      service.stop();
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tests IMAP/SMTP connectivity, sends HTML morning test report, and enforces sender whitelist during pollNow", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pmx-overnight-poll-"));
    try {
      const store = new EncryptedPluginCredentialStore({
        dataDir: dir,
        masterKey: NodeCrypto.randomBytes(32),
      });
      const sentPayloads: OutboundMailPayload[] = [];

      const service = new OvernightRouteService({
        dataDir: dir,
        credentialStore: store,
        networkHooks: {
          now: () => FIXED_TEST_EPOCH_MS,
          probeImap: async (params) => ({
            ok: params.host === "imap.qq.com" && params.password === "valid-auth-code",
            latencyMs: 18,
            message: "IMAP mock ok",
          }),
          probeSmtp: async (params) => ({
            ok: params.host === "smtp.qq.com" && params.password === "valid-auth-code",
            latencyMs: 24,
            message: "SMTP mock ok",
          }),
          sendSmtp: async (_params, payload) => {
            sentPayloads.push(payload);
            return {
              messageId: "mock-report-001@prismux.local",
              acceptedAt: FIXED_TEST_EPOCH_MS,
              provider: "smtp:smtp.qq.com",
            };
          },
          createInboundAdapter: () => ({
            mode: "imap",
            pollIncremental: async () => ({
              messages: [
                {
                  messageId: "<stranger-1@evil.example>",
                  from: "Stranger <hacker@evil.example>",
                  to: ["owner@qq.com"],
                  subject: "#factory drop database",
                  textBody: "malicious prompt",
                },
                {
                  messageId: "<normal-newsletter@news.example>",
                  from: "owner@qq.com",
                  to: ["owner@qq.com"],
                  subject: "Weekly digest without trigger tag",
                  textBody: "hello",
                },
              ],
            }),
          }),
        },
      });

      await service.updateConfig(
        {
          mode: "imap",
          imapSmtp: {
            preset: "qq",
            email: "owner@qq.com",
            imapHost: "imap.qq.com",
            imapPort: 993,
            imapSecure: true,
            smtpHost: "smtp.qq.com",
            smtpPort: 465,
            smtpSecure: true,
          },
          secrets: { imapPassword: "valid-auth-code" },
          strategy: {
            triggerTag: "#factory",
            allowedSenders: ["owner@qq.com"],
          },
        },
        "owner_chief",
      );

      // 1. Connectivity probe passes
      const probe = await service.testMailConnection({}, "owner_chief");
      assert.equal(probe.ok, true);
      assert.equal(probe.inbound.ok, true);
      assert.equal(probe.outbound.ok, true);

      // 2. Test morning report renders rich HTML with deep link and sends via SMTP
      const reportRes = await service.sendTestMorningReport({}, "owner_chief");
      assert.equal(reportRes.ok, true);
      assert.equal(reportRes.recipient, "owner@qq.com");
      assert.equal(sentPayloads.length, 1);
      assert.ok(sentPayloads[0]!.html.includes("prismux://review/"));
      assert.ok(sentPayloads[0]!.html.includes("夜间全自动工场完工早报"));

      // 3. Manual poll blocks non-whitelisted sender physically and persists blocked run record
      const pollRes = await service.pollNow({}, "owner_chief");
      assert.equal(pollRes.ok, true);
      assert.equal(pollRes.fetchedCount, 2);
      assert.equal(pollRes.matchedCount, 1);
      assert.equal(pollRes.executedCount, 0);
      assert.equal(pollRes.blockedByWhitelistCount, 1);
      assert.equal(pollRes.runs[0]?.status, "blocked_whitelist");
      assert.equal(pollRes.runs[0]?.sender, "hacker@evil.example");

      const history = service.getRuns(10, "owner_chief");
      assert.equal(history.total, 1);
      assert.equal(history.runs[0]?.status, "blocked_whitelist");

      // 4. Whitelist & overnight execution window pure helpers
      assert.equal(isSenderAllowed("owner@qq.com", []), false);
      assert.equal(isSenderAllowed("Owner <OWNER@qq.com>", ["owner@qq.com"]), true);
      assert.equal(isSenderAllowed("teammate@acme.dev", ["*@acme.dev"]), true);
      assert.equal(isSenderAllowed("stranger@other.dev", ["*@acme.dev"]), false);

      const at2330 = new Date(2026, 10, 24, 23, 30, 0).getTime();
      const at0230 = new Date(2026, 10, 24, 2, 30, 0).getTime();
      const at1400 = new Date(2026, 10, 24, 14, 0, 0).getTime();
      assert.equal(
        isWithinExecutionWindow(
          { windowMode: "scheduled", windowStart: "23:00", windowEnd: "07:00" },
          at2330,
        ),
        true,
      );
      assert.equal(
        isWithinExecutionWindow(
          { windowMode: "scheduled", windowStart: "23:00", windowEnd: "07:00" },
          at0230,
        ),
        true,
      );
      assert.equal(
        isWithinExecutionWindow(
          { windowMode: "scheduled", windowStart: "23:00", windowEnd: "07:00" },
          at1400,
        ),
        false,
      );
      assert.equal(
        isWithinExecutionWindow(
          { windowMode: "always", windowStart: "23:00", windowEnd: "07:00" },
          at1400,
        ),
        true,
      );

      service.stop();
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exposes authenticated /v1/overnight/* endpoints on PrismuxDaemon HTTP server", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pmx-overnight-http-"));
    const token = "overnight-http-test-token";
    const daemon = new PrismuxDaemon({
      headless: true,
      dataDir: dir,
      host: "127.0.0.1",
      port: 0,
      authToken: token,
      disableAutoUpdateCheck: true,
    });

    try {
      const ready = await daemon.start();
      const authHeaders = {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
      };

      // Unauthenticated request rejected with 401
      const unauth = await fetch(`${ready.httpUrl}/v1/overnight/config`);
      assert.equal(unauth.status, 401);

      // Authenticated GET returns default config (Generic IMAP/SMTP mode), secret badges, and agentMail probe
      const getRes = await fetch(`${ready.httpUrl}/v1/overnight/config`, {
        headers: authHeaders,
      });
      assert.equal(getRes.status, 200);
      const getJson = (await getRes.json()) as {
        ok: boolean;
        config: {
          enabled: boolean;
          mode: string;
          emailProvider: string;
          imapSmtp: { preset: string };
          strategy: { triggerTag: string };
        };
        agentMail: { cliInstalled: boolean };
        secrets: { hasImapPassword: boolean };
      };
      assert.equal(getJson.ok, true);
      assert.equal(getJson.config.enabled, false);
      assert.equal(getJson.config.mode, "imap");
      assert.equal(getJson.config.emailProvider, "imap_smtp");
      assert.equal(getJson.config.imapSmtp.preset, "qq");
      assert.equal(getJson.config.strategy.triggerTag, "#factory");
      assert.equal(getJson.secrets.hasImapPassword, false);
      assert.equal(typeof getJson.agentMail.cliInstalled, "boolean");

      // Authenticated PUT saves sanitized config + sealed password and normalizes legacy 163 -> netease
      const putRes = await fetch(`${ready.httpUrl}/v1/overnight/config`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({
          mode: "imap",
          imapSmtp: {
            preset: "163",
            email: "dev@163.com",
            imapHost: "imap.163.com",
            smtpHost: "smtp.163.com",
          },
          secrets: { imapPassword: "163-secret-code" },
        }),
      });
      assert.equal(putRes.status, 200);
      const putText = await putRes.text();
      assert.equal(putText.includes("163-secret-code"), false);
      const putJson = JSON.parse(putText) as {
        config: { imapSmtp: { preset: string; email: string } };
        secrets: { hasImapPassword: boolean };
      };
      assert.equal(putJson.config.imapSmtp.preset, "netease");
      assert.equal(putJson.config.imapSmtp.email, "dev@163.com");
      assert.equal(putJson.secrets.hasImapPassword, true);

      // Runs endpoint returns 200 empty array initially
      const runsRes = await fetch(`${ready.httpUrl}/v1/overnight/runs`, {
        headers: authHeaders,
      });
      assert.equal(runsRes.status, 200);
      const runsJson = (await runsRes.json()) as { ok: boolean; runs: unknown[] };
      assert.equal(runsJson.ok, true);
      assert.deepEqual(runsJson.runs, []);

      // Diagnostics engine.overnight_factory links straight to /settings/overnight-factory
      const diagRes = await fetch(`${ready.httpUrl}/v1/diagnostics?force=1`, {
        headers: authHeaders,
      });
      assert.equal(diagRes.status, 200);
      const diagJson = (await diagRes.json()) as {
        items: Array<{ id: string; settingsRoute?: string }>;
      };
      const overnightDiag = diagJson.items.find((i) => i.id === "engine.overnight_factory");
      assert.equal(overnightDiag?.settingsRoute, "/settings/overnight-factory");

      // /v1/overnight/status?refresh=1 returns flat CLI/configured probe summary + mailStatus
      const statusRes = await fetch(`${ready.httpUrl}/v1/overnight/status?refresh=1`, {
        headers: authHeaders,
      });
      assert.equal(statusRes.status, 200);
      const statusJson = (await statusRes.json()) as {
        ok: boolean;
        installed: boolean;
        loggedIn: boolean;
        configured: boolean;
        address: string | null;
        binaryPath: string | null;
        mailStatus: { configured: boolean; label: string };
      };
      assert.equal(statusJson.ok, true);
      assert.equal(typeof statusJson.installed, "boolean");
      assert.equal(typeof statusJson.loggedIn, "boolean");
      assert.equal(statusJson.configured, true); // dev@163.com + sealed password saved above
      assert.equal(statusJson.mailStatus.configured, true);

      // /v1/overnight/test-connection alias is wired alongside /v1/overnight/test-mail
      const testConnRes = await fetch(`${ready.httpUrl}/v1/overnight/test-connection`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          mode: "gmail-oauth2",
          emailProvider: "gmail_oauth2",
          gmail: { clientId: "" },
        }),
      });
      assert.equal(testConnRes.status, 200);
      const testConnJson = (await testConnRes.json()) as { ok: boolean; outbound: { ok: boolean } };
      assert.equal(testConnJson.ok, false);
      assert.equal(testConnJson.outbound.ok, false);

      // Task CRUD endpoints (/v1/overnight/tasks) and AGY 403 enforcement over HTTP
      const agyTaskRes = await fetch(`${ready.httpUrl}/v1/overnight/tasks`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          title: "Forbidden AGY Task",
          prompt: "Do work",
          workspaceDir: dir,
          provider: "antigravity",
        }),
      });
      assert.equal(agyTaskRes.status, 403);
      const agyTaskJson = (await agyTaskRes.json()) as { error?: { code?: string } };
      assert.equal(agyTaskJson.error?.code, "AGY_UNATTENDED_FORBIDDEN");

      const createTaskRes = await fetch(`${ready.httpUrl}/v1/overnight/tasks`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          title: "HTTP Queue Task",
          prompt: "Check tests",
          workspaceDir: dir,
          provider: "codex",
        }),
      });
      assert.equal(createTaskRes.status, 201);
      const createdTask = (await createTaskRes.json()) as {
        ok: boolean;
        task: { id: string; title: string };
      };
      assert.equal(createdTask.ok, true);
      assert.equal(createdTask.task.title, "HTTP Queue Task");

      const listTasksRes = await fetch(`${ready.httpUrl}/v1/overnight/tasks`, {
        headers: authHeaders,
      });
      assert.equal(listTasksRes.status, 200);
      const listTasksJson = (await listTasksRes.json()) as { tasks: Array<{ id: string }> };
      assert.equal(
        listTasksJson.tasks.some((t) => t.id === createdTask.task.id),
        true,
      );

      const delTaskRes = await fetch(
        `${ready.httpUrl}/v1/overnight/tasks/${encodeURIComponent(createdTask.task.id)}`,
        { method: "DELETE", headers: authHeaders },
      );
      assert.equal(delTaskRes.status, 200);
    } finally {
      await daemon.stop();
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("verifies real TCP SMTP AUTH LOGIN / AUTH PLAIN fallback, MAIL FROM+RSET send-check, QQ/163 From alignment, Chinese failure hints, and full MIME delivery", async (t) => {
    // Helper to spin up a configurable local mock SMTP server
    const startMockSmtpServer = async (opts: {
      ehloCapabilities?: string[];
      rejectAuthLoginWith504?: boolean;
      expectedUser: string;
      expectedPass: string;
      rejectMailFromWith553?: boolean;
    }) => {
      const receivedCommands: string[] = [];
      let capturedData = "";
      const server = NodeNet.createServer((socket) => {
        socket.setEncoding("utf8");
        socket.write("220 mock-smtp.local ESMTP Ready\r\n");
        let buf = "";
        let state: "cmd" | "login_user" | "login_pass" | "data" = "cmd";
        let loginUser = "";

        socket.on("data", (chunk: string) => {
          buf += chunk;
          while (buf.includes("\n")) {
            const idx = buf.indexOf("\n");
            const rawLine = buf.slice(0, idx).replace(/\r$/, "");
            buf = buf.slice(idx + 1);

            if (state === "data") {
              if (rawLine === ".") {
                state = "cmd";
                socket.write("250 2.0.0 Message accepted\r\n");
              } else {
                capturedData += `${rawLine}\r\n`;
              }
              continue;
            }

            receivedCommands.push(rawLine);

            if (state === "login_user") {
              loginUser = Buffer.from(rawLine, "base64").toString("utf8");
              state = "login_pass";
              socket.write("334 UGFzc3dvcmQ6\r\n");
              continue;
            }
            if (state === "login_pass") {
              const pass = Buffer.from(rawLine, "base64").toString("utf8");
              state = "cmd";
              if (loginUser === opts.expectedUser && pass === opts.expectedPass) {
                socket.write("235 2.7.0 Authentication successful\r\n");
              } else {
                socket.write("535 Error: authentication failed, system busy\r\n");
              }
              continue;
            }

            const upper = rawLine.toUpperCase();
            if (upper.startsWith("EHLO")) {
              const caps = opts.ehloCapabilities ?? ["AUTH LOGIN PLAIN"];
              for (const cap of caps) {
                socket.write(`250-${cap}\r\n`);
              }
              socket.write("250 OK\r\n");
            } else if (upper === "AUTH LOGIN") {
              if (opts.rejectAuthLoginWith504) {
                socket.write("504 5.7.4 Unrecognized authentication type\r\n");
              } else {
                state = "login_user";
                socket.write("334 VXNlcm5hbWU6\r\n");
              }
            } else if (upper.startsWith("AUTH PLAIN ")) {
              const token = rawLine.slice("AUTH PLAIN ".length).trim();
              const decoded = Buffer.from(token, "base64").toString("utf8").split("\0");
              const u = decoded[1] ?? "";
              const p = decoded[2] ?? "";
              if (u === opts.expectedUser && p === opts.expectedPass) {
                socket.write("235 2.7.0 Authentication successful\r\n");
              } else {
                socket.write("535 5.7.8 Authentication credentials invalid\r\n");
              }
            } else if (upper.startsWith("MAIL FROM:")) {
              if (opts.rejectMailFromWith553) {
                socket.write("553 Mail from must equal authorized user\r\n");
              } else {
                socket.write("250 2.1.0 OK\r\n");
              }
            } else if (upper.startsWith("RCPT TO:") || upper === "RSET") {
              socket.write("250 2.1.5 OK\r\n");
            } else if (upper === "DATA") {
              state = "data";
              socket.write("354 Start mail input\r\n");
            } else if (upper === "QUIT") {
              socket.write("221 Bye\r\n");
              socket.end();
            } else {
              socket.write("500 Unknown command\r\n");
            }
          }
        });
      });
      await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
      t.after(async () => {
        await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
      });
      const port = (server.address() as NodeNet.AddressInfo).port;
      return { port, receivedCommands, getCapturedData: () => capturedData };
    };

    // 1. QQ/163/126/yeah From alignment helper
    assert.equal(
      resolveEffectiveSmtpFromAddress({
        host: "smtp.qq.com",
        username: "real-owner@qq.com",
        fromAddress: "alias@other.com",
      }),
      "real-owner@qq.com",
    );
    assert.equal(
      resolveEffectiveSmtpFromAddress({
        host: "smtp.163.com",
        username: "dev@163.com",
        fromAddress: "mismatch@gmail.com",
      }),
      "dev@163.com",
    );

    // 2. AUTH LOGIN + MAIL FROM + RSET probe succeeds, plus real MIME delivery succeeds
    const loginServer = await startMockSmtpServer({
      ehloCapabilities: ["AUTH LOGIN PLAIN"],
      expectedUser: "owner@qq.com",
      expectedPass: "qq-app-auth-code",
    });
    const probeOk = await defaultProbeSmtpConnection({
      host: "127.0.0.1",
      port: loginServer.port,
      secure: false,
      username: "owner@qq.com",
      password: "qq-app-auth-code",
      fromAddress: "owner@qq.com",
      timeoutMs: 3000,
    });
    assert.equal(probeOk.ok, true);
    assert.ok(probeOk.message.includes("AUTH LOGIN"));
    assert.ok(loginServer.receivedCommands.some((c) => c.startsWith("MAIL FROM:<owner@qq.com>")));
    assert.ok(loginServer.receivedCommands.includes("RSET"));

    const sentReceipt = await defaultSendSmtpMail(
      {
        host: "127.0.0.1",
        port: loginServer.port,
        secure: false,
        username: "owner@qq.com",
        password: "qq-app-auth-code",
        fromAddress: "owner@qq.com",
        fromName: "Prismux Overnight",
        timeoutMs: 3000,
      },
      {
        to: ["owner@qq.com"],
        subject: "[Prismux] 测试早报",
        html: "<h1>早报正文</h1>",
        text: "早报纯文本",
      },
    );
    assert.ok(sentReceipt.messageId.includes("@prismux.dev"));
    assert.ok(loginServer.getCapturedData().includes("From:"));
    assert.ok(loginServer.getCapturedData().includes("To: owner@qq.com"));

    // 3. AUTH PLAIN-only server negotiates AUTH PLAIN seamlessly
    const plainOnlyServer = await startMockSmtpServer({
      ehloCapabilities: ["AUTH PLAIN"],
      expectedUser: "dev@corp.dev",
      expectedPass: "plain-pass",
    });
    const plainProbe = await defaultProbeSmtpConnection({
      host: "127.0.0.1",
      port: plainOnlyServer.port,
      secure: false,
      username: "dev@corp.dev",
      password: "plain-pass",
      fromAddress: "dev@corp.dev",
      timeoutMs: 3000,
    });
    assert.equal(plainProbe.ok, true);
    assert.ok(plainProbe.message.includes("AUTH PLAIN"));

    // 4. Wrong password (535) and MAIL FROM rejection (553) produce actionable Chinese hints
    const badPassProbe = await defaultProbeSmtpConnection({
      host: "127.0.0.1",
      port: loginServer.port,
      secure: false,
      username: "owner@qq.com",
      password: "wrong-password",
      fromAddress: "owner@qq.com",
      timeoutMs: 3000,
    });
    assert.equal(badPassProbe.ok, false);
    assert.ok(badPassProbe.message.includes("认证失败"));
    assert.ok((badPassProbe.hint ?? "").includes("授权码"));

    const rejectFromServer = await startMockSmtpServer({
      ehloCapabilities: ["AUTH LOGIN"],
      expectedUser: "owner@163.com",
      expectedPass: "pass-163",
      rejectMailFromWith553: true,
    });
    const probe553 = await defaultProbeSmtpConnection({
      host: "127.0.0.1",
      port: rejectFromServer.port,
      secure: false,
      username: "owner@163.com",
      password: "pass-163",
      fromAddress: "owner@163.com",
      timeoutMs: 3000,
    });
    assert.equal(probe553.ok, false);
    assert.ok(probe553.message.includes("553"));
    assert.ok((probe553.hint ?? "").includes("发件邮箱地址"));
  });

  it("prevents stale smtpPassword from shadowing updated imapPassword when useSeparateSmtpPassword is false", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pmx-overnight-smtppass-"));
    try {
      const store = new EncryptedPluginCredentialStore({
        dataDir: dir,
        masterKey: NodeCrypto.randomBytes(32),
      });
      let seenImapPass = "";
      let seenSmtpPass = "";
      const service = new OvernightRouteService({
        dataDir: dir,
        credentialStore: store,
        networkHooks: {
          probeImap: async (params) => {
            seenImapPass = params.password;
            return { ok: true, latencyMs: 5, message: "ok" };
          },
          probeSmtp: async (params) => {
            seenSmtpPass = params.password;
            return { ok: true, latencyMs: 5, message: "ok" };
          },
        },
      });

      // Step 1: Save with a separate SMTP password
      await service.updateConfig(
        {
          mode: "imap",
          imapSmtp: {
            preset: "qq",
            email: "owner@qq.com",
            useSeparateSmtpPassword: true,
          },
          secrets: {
            imapPassword: "old-imap-password",
            smtpPassword: "stale-smtp-password",
          },
        },
        "owner_chief",
      );

      // Step 2: Uncheck separate SMTP password and supply fresh IMAP password
      await service.updateConfig(
        {
          mode: "imap",
          imapSmtp: {
            preset: "qq",
            email: "owner@qq.com",
            useSeparateSmtpPassword: false,
          },
          secrets: {
            imapPassword: "fresh-shared-auth-code",
          },
        },
        "owner_chief",
      );

      const probe = await service.testMailConnection({}, "owner_chief");
      assert.equal(probe.ok, true);
      assert.equal(seenImapPass, "fresh-shared-auth-code");
      assert.equal(seenSmtpPass, "fresh-shared-auth-code");
      service.stop();
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parses real agently-cli v1.0.18 JSON+tip output, sends HTML via relative --body-file with 2-step confirmation_token, and checks Gmail gmail.send scope", async () => {
    // 1. Real agently-cli +me output with trailing `tip:` line
    const realMeOutput = [
      JSON.stringify(
        {
          ok: true,
          data: {
            aliases: [{ id: "a1", email: "fishundersea@agent.qq.com", is_default: true }],
            scopes: ["alias:read", "mail:delete", "mail:read", "mail:send"],
            daily_send_quota: 50,
          },
        },
        null,
        2,
      ),
      "",
      "tip: run `agently-cli message +list --dir inbox` to view inbox",
    ].join("\n");
    const parsedMe = parseAgentMailMeOutput(realMeOutput);
    assert.equal(parsedMe.email, "fishundersea@agent.qq.com");
    assert.deepEqual(parsedMe.scopes, ["alias:read", "mail:delete", "mail:read", "mail:send"]);
    assert.equal(parsedMe.dailySendQuota, 50);
    assert.equal(extractAgentMailVersion("agently-cli version v1.0.18\n"), "1.0.18");

    // 2. Real agently-cli message +list output (`data.data[]`, object `from`/`to`, trailing `tip:`)
    const realListOutput = [
      JSON.stringify({
        ok: true,
        data: {
          data: [
            {
              message_id: "agm-101",
              from: { name: "Fish", email: "fish@qq.com" },
              to: [{ name: "Agent", email: "fishundersea@agent.qq.com" }],
              subject: "#factory Fix email check",
              snippet: "Please fix SMTP send check",
            },
          ],
        },
      }),
      "tip: use message +read --id <id> to inspect body",
    ].join("\n");
    const parsedList = parseAgentMailListMessages(realListOutput);
    assert.equal(parsedList.length, 1);
    assert.equal(parsedList[0]?.messageId, "agm-101");
    assert.equal(parsedList[0]?.from, "Fish <fish@qq.com>");
    assert.deepEqual(parsedList[0]?.to, ["Agent <fishundersea@agent.qq.com>"]);

    // 3. Send via relative `--body-file ./body.html` + 2-step confirmation token + missing `mail:send` check
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pmx-agm-bodyfile-"));
    try {
      const store = new EncryptedPluginCredentialStore({
        dataDir: dir,
        masterKey: NodeCrypto.randomBytes(32),
      });
      const sendCalls: Array<{ args: readonly string[]; bodyFileContent?: string }> = [];
      let sendStep = 0;

      const service = new OvernightRouteService({
        dataDir: dir,
        credentialStore: store,
        networkHooks: {
          now: () => FIXED_TEST_EPOCH_MS,
          findAgentMailCli: () => "C:\\Users\\Fish\\AppData\\Roaming\\npm\\agently-cli.cmd",
          runAgentMailCli: async (_cli, args, _timeout, options) => {
            if (args[0] === "--version") {
              return { exitCode: 0, stdout: "agently-cli v1.0.18", stderr: "" };
            }
            if (args[0] === "+me") {
              return { exitCode: 0, stdout: realMeOutput, stderr: "" };
            }
            if (args[0] === "message" && args[1] === "+send" && args.includes("--dry-run")) {
              return { exitCode: 0, stdout: '{"description":"Send a new message"}', stderr: "" };
            }
            if (args[0] === "message" && args[1] === "+send") {
              const bfIdx = args.indexOf("--body-file");
              const bodyFileContent =
                bfIdx >= 0 && options?.cwd
                  ? NodeFS.readFileSync(NodePath.join(options.cwd, args[bfIdx + 1]!), "utf8")
                  : undefined;
              sendCalls.push({ args: [...args], ...(bodyFileContent ? { bodyFileContent } : {}) });
              sendStep += 1;
              if (sendStep === 1) {
                return {
                  exitCode: 0,
                  stdout: JSON.stringify({
                    ok: true,
                    data: { confirmation_required: true, confirmation_token: "confirm-tok-99" },
                  }),
                  stderr: "",
                };
              }
              return {
                exitCode: 0,
                stdout: JSON.stringify({ ok: true, data: { message_id: "agm-sent-999" } }),
                stderr: "",
              };
            }
            return { exitCode: 0, stdout: "{}", stderr: "" };
          },
        },
      });

      const statusSnap = await service.getStatusSnapshot("owner_chief", { forceProbe: true });
      assert.equal(statusSnap.installed, true);
      assert.equal(statusSnap.version, "1.0.18");
      assert.equal(statusSnap.loggedIn, true);
      assert.equal(statusSnap.address, "fishundersea@agent.qq.com");
      assert.equal(statusSnap.configured, true);
      assert.equal(statusSnap.mailStatus.label, "已配置");

      const report = await service.sendTestMorningReport(
        { emailProvider: "agent_mail", recipient: "fishundersea@agent.qq.com" },
        "owner_chief",
      );
      assert.equal(report.ok, true);
      assert.equal(report.messageId, "agm-sent-999");
      assert.equal(sendCalls.length, 2);
      assert.equal(sendCalls[0]?.args.includes("--body-file"), true);
      assert.equal(sendCalls[0]?.args.includes("--html"), false);
      assert.ok(sendCalls[0]?.bodyFileContent?.includes("夜间全自动工场完工早报"));
      assert.equal(sendCalls[1]?.args.includes("--confirmation-token"), true);
      assert.equal(sendCalls[1]?.args.includes("confirm-tok-99"), true);

      // 4. Gmail OAuth2 missing `gmail.send` scope check & `invalid_grant` diagnostic
      let gmailScopeMode: "readonly" | "invalid_grant" = "readonly";
      const gmailSvc = new OvernightRouteService({
        dataDir: NodeFS.mkdtempSync(NodePath.join(dir, "gmail-")),
        credentialStore: new EncryptedPluginCredentialStore({
          dataDir: NodeFS.mkdtempSync(NodePath.join(dir, "gmail-cred-")),
          masterKey: NodeCrypto.randomBytes(32),
        }),
        networkHooks: {
          fetchFn: (async (url: string | URL) => {
            const u = String(url);
            if (u.includes("oauth2.googleapis.com/token")) {
              if (gmailScopeMode === "invalid_grant") {
                return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
              }
              return new Response(
                JSON.stringify({
                  access_token: "ya29.readonly-only",
                  scope: "https://www.googleapis.com/auth/gmail.readonly",
                }),
                { status: 200 },
              );
            }
            return new Response(
              JSON.stringify({ emailAddress: "owner@gmail.com", messagesTotal: 5 }),
              {
                status: 200,
              },
            );
          }) as typeof fetch,
        },
      });
      await gmailSvc.updateConfig(
        {
          mode: "gmail-oauth2",
          gmail: { clientId: "cid.apps.googleusercontent.com", boundEmail: "owner@gmail.com" },
          secrets: { gmailClientSecret: "sec" },
        },
        "owner_chief",
      );
      await (
        gmailSvc as unknown as {
          openCredentials: () => { set: (k: string, v: string) => Promise<void> };
        }
      )
        .openCredentials()
        .set("gmail.refreshToken", "1//mock-refresh");

      const readonlyRes = await gmailSvc.testMailConnection({}, "owner_chief");
      assert.equal(readonlyRes.ok, false);
      assert.equal(readonlyRes.inbound.ok, true);
      assert.equal(readonlyRes.outbound.ok, false);
      assert.ok((readonlyRes.outbound.hint ?? "").includes("gmail.send"));

      gmailScopeMode = "invalid_grant";
      const expiredRes = await gmailSvc.testMailConnection({}, "owner_chief");
      assert.equal(expiredRes.ok, false);
      assert.ok(expiredRes.message.includes("过期") || expiredRes.message.includes("撤销"));

      gmailSvc.stop();
      service.stop();
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("executes Overnight Factory end-to-end (manual run-now, task queue, real worktree, completion & failure email reports, live cancel, AGY hard block & restart dedup)", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pmx-overnight-e2e-"));
    try {
      const repoDir = NodePath.join(dir, "sample-repo");
      NodeFS.mkdirSync(repoDir, { recursive: true });
      execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, windowsHide: true });
      execFileSync("git", ["config", "user.name", "Prismux E2E"], {
        cwd: repoDir,
        windowsHide: true,
      });
      execFileSync("git", ["config", "user.email", "e2e@prismux.local"], {
        cwd: repoDir,
        windowsHide: true,
      });
      NodeFS.writeFileSync(NodePath.join(repoDir, "hello.txt"), "initial\n", "utf8");
      execFileSync("git", ["add", "hello.txt"], { cwd: repoDir, windowsHide: true });
      execFileSync("git", ["commit", "-m", "init"], { cwd: repoDir, windowsHide: true });

      const sentEmails: OutboundMailPayload[] = [];
      let executorMode: "succeed" | "fail" | "hang_until_abort" = "succeed";

      const factory = new OvernightFactory({
        worktreeBaseDir: NodePath.join(dir, "worktrees"),
        cleanupWorktree: true,
        codingExecutor: async (ctx) => {
          ctx.onLog?.("Executor started coding inside worktree");
          if (executorMode === "fail") {
            throw new Error("Simulated coding tool failure");
          }
          if (executorMode === "hang_until_abort") {
            await new Promise<void>((resolveWait, rejectWait) => {
              const onAbort = () => rejectWait(new Error("aborted"));
              if (ctx.signal?.aborted) {
                onAbort();
                return;
              }
              ctx.signal?.addEventListener("abort", onAbort, { once: true });
              setTimeout(resolveWait, 15_000).unref?.();
            });
            return;
          }
          await ctx.tools.writeFile("hello.txt", "updated by overnight factory\n");
          ctx.onLog?.("Updated hello.txt successfully");
        },
      });

      const store = new EncryptedPluginCredentialStore({
        dataDir: dir,
        masterKey: NodeCrypto.randomBytes(32),
      });
      const chiefManager = new ChiefThreadManager({
        dataDir: dir,
        defaultProvider: "antigravity",
      });
      await chiefManager.init();

      const service = new OvernightRouteService({
        dataDir: dir,
        overnightFactory: factory,
        credentialStore: store,
        chiefManager,
        networkHooks: {
          sendSmtp: async (_params, payload) => {
            sentEmails.push(payload);
            return {
              messageId: `sent-${sentEmails.length}@prismux.dev`,
              acceptedAt: Date.now(),
              provider: "mock",
            };
          },
          createInboundAdapter: () => ({
            mode: "imap",
            pollIncremental: async () => ({
              messages: [
                {
                  messageId: "<dedup-msg-1@qq.com>",
                  from: "owner@qq.com",
                  to: ["owner@qq.com"],
                  subject: "#factory Dedup task",
                  textBody: "Run dedup check",
                },
              ],
            }),
          }),
        },
      });

      await service.updateConfig(
        {
          mode: "imap",
          imapSmtp: {
            preset: "qq",
            email: "owner@qq.com",
            imapHost: "imap.qq.com",
            smtpHost: "smtp.qq.com",
          },
          secrets: { imapPassword: "valid-code" },
          strategy: {
            triggerTag: "#factory",
            allowedSenders: ["owner@qq.com"],
            targetWorkspaceDir: repoDir,
            agentProvider: "codex",
            oracleReviewEnabled: true,
          },
        },
        "owner_chief",
      );

      // 1. Personal AGY hard block (both direct `antigravity` and `chief` when chief -> antigravity)
      await assert.rejects(
        () =>
          service.runManualTask(
            { title: "Direct AGY", prompt: "fix", workspaceDir: repoDir, provider: "antigravity" },
            "owner_chief",
          ),
        (err: unknown) => (err as { code?: string }).code === "AGY_UNATTENDED_FORBIDDEN",
      );
      await assert.rejects(
        () =>
          service.runManualTask(
            { title: "Chief->AGY", prompt: "fix", workspaceDir: repoDir, provider: "chief" },
            "owner_chief",
          ),
        (err: unknown) => (err as { code?: string }).code === "AGY_UNATTENDED_FORBIDDEN",
      );

      // 2. Create queued task & execute via runTaskById -> real worktree branch + completion email report
      const created = service.createTask(
        {
          title: "Update hello.txt",
          prompt: "Update hello.txt with overnight result",
          workspaceDir: repoDir,
          provider: "codex",
          sendEmailReport: true,
          reportRecipient: "owner@qq.com",
        },
        "owner_chief",
      );
      const taskRunRes = await service.runTaskById(created.task.id, { wait: true }, "owner_chief");
      assert.equal(taskRunRes.run.status, "completed");
      assert.equal(taskRunRes.run.stage, "completed");
      assert.ok(taskRunRes.run.branchName?.startsWith("factory/"));
      assert.equal(taskRunRes.run.changedFilesCount, 1);
      assert.equal(taskRunRes.run.reportSent, true);
      assert.ok((taskRunRes.run.logs?.length ?? 0) >= 3);
      assert.equal(sentEmails.length, 1);
      assert.ok(sentEmails[0]!.html.includes("夜间全自动工场完工早报"));

      // 3. Failing run dispatches failure email notification
      executorMode = "fail";
      const failRes = await service.runManualTask(
        {
          title: "Expected failure task",
          prompt: "Trigger error",
          workspaceDir: repoDir,
          provider: "codex",
          sendEmailReport: true,
          reportRecipient: "owner@qq.com",
          wait: true,
        },
        "owner_chief",
      );
      assert.equal(failRes.run.status, "failed");
      assert.equal(failRes.run.stage, "failed");
      assert.equal(failRes.run.reportSent, true);
      assert.equal(sentEmails.length, 2);
      assert.ok(sentEmails[1]!.subject.includes("任务执行失败"));

      // 4. Live cancelRun aborts in-flight run cleanly & marks status cancelled
      executorMode = "hang_until_abort";
      const inFlight = await service.runManualTask(
        {
          title: "Long running task",
          prompt: "Wait for abort",
          workspaceDir: repoDir,
          provider: "codex",
          sendEmailReport: false,
          wait: false,
        },
        "owner_chief",
      );
      const cancelled = service.cancelRun(inFlight.run.id, "owner_chief");
      assert.equal(cancelled.run.status, "cancelled");
      assert.equal(cancelled.run.stage, "cancelled");

      // Retry cancelled run after switching executor back to succeed
      executorMode = "succeed";
      const retried = await service.retryRun(inFlight.run.id, { wait: true }, "owner_chief");
      assert.equal(retried.run.status, "completed");

      // Delete completed run record
      const deleted = service.deleteRun(retried.run.id, "owner_chief");
      assert.equal(deleted.deletedId, retried.run.id);

      // 5. Inbound email polling executes once, then persists messageId dedup across service restart!
      const poll1 = await service.pollNow({}, "owner_chief");
      assert.equal(poll1.executedCount, 1);
      assert.equal(poll1.skippedDuplicateCount, 0);
      service.stop();

      const restarted = new OvernightRouteService({
        dataDir: dir,
        overnightFactory: new OvernightFactory({
          worktreeBaseDir: NodePath.join(dir, "worktrees"),
          cleanupWorktree: true,
          codingExecutor: async (ctx) => {
            await ctx.tools.writeFile("hello.txt", "should not run again\n");
          },
        }),
        credentialStore: store,
        networkHooks: {
          createInboundAdapter: () => ({
            mode: "imap",
            pollIncremental: async () => ({
              messages: [
                {
                  messageId: "<dedup-msg-1@qq.com>",
                  from: "owner@qq.com",
                  to: ["owner@qq.com"],
                  subject: "#factory Dedup task",
                  textBody: "Run dedup check",
                },
              ],
            }),
          }),
        },
      });
      // Persisted task survives restart
      assert.equal(
        restarted.listTasks("owner_chief").tasks.some((t) => t.id === created.task.id),
        true,
      );
      // Duplicate messageId skipped after restart
      const poll2 = await restarted.pollNow({}, "owner_chief");
      assert.equal(poll2.executedCount, 0);
      assert.equal(poll2.skippedDuplicateCount, 1);
      restarted.stop();
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("persists testRecipient across partial patches, strategy saves, Agent Mail probes, sendTestMorningReport, restarts, and legacy JSON configs", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pmx-overnight-recipient-"));
    try {
      const store = new EncryptedPluginCredentialStore({
        dataDir: dir,
        masterKey: NodeCrypto.randomBytes(32),
      });

      // 1. Backwards-compatible load of legacy overnight-factory.json WITHOUT `testRecipient`
      const legacyConfigPath = NodePath.join(dir, "overnight-factory.json");
      NodeFS.writeFileSync(
        legacyConfigPath,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            updatedAt: FIXED_TEST_EPOCH_MS,
            enabled: false,
            mode: "imap",
            emailProvider: "agent_mail",
            agentMailAddress: "legacy@agent.qq.com",
            gmail: {
              clientId: "",
              redirectUri: "",
              boundEmail: "",
              connected: false,
              connectedAt: null,
            },
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
            strategy: {
              triggerTag: "#factory",
              allowedSenders: ["legacy@agent.qq.com"],
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
          },
          null,
          2,
        )}\n`,
        "utf8",
      );

      let probedAgentEmail = "legacy@agent.qq.com";
      const sentTargets: string[] = [];
      const createSvc = () =>
        new OvernightRouteService({
          dataDir: dir,
          credentialStore: store,
          networkHooks: {
            now: () => FIXED_TEST_EPOCH_MS,
            findAgentMailCli: () => "/usr/local/bin/agently-cli",
            runAgentMailCli: async (_cli, args) => {
              if (args[0] === "--version") {
                return { exitCode: 0, stdout: "agently-cli v1.0.18", stderr: "" };
              }
              if (args[0] === "+me") {
                return {
                  exitCode: 0,
                  stdout: JSON.stringify({
                    ok: true,
                    data: {
                      aliases: [{ id: "a1", email: probedAgentEmail, is_default: true }],
                      scopes: ["mail:read", "mail:send"],
                      daily_send_quota: 50,
                    },
                  }),
                  stderr: "",
                };
              }
              if (args[0] === "message" && args[1] === "+send") {
                const toIdx = args.indexOf("--to");
                if (toIdx >= 0 && args[toIdx + 1]) {
                  sentTargets.push(args[toIdx + 1]!);
                }
                return {
                  exitCode: 0,
                  stdout: JSON.stringify({ ok: true, data: { message_id: "agm-test-persist-1" } }),
                  stderr: "",
                };
              }
              return { exitCode: 0, stdout: "{}", stderr: "" };
            },
          },
        });

      const svc1 = createSvc();
      const legacySnap = await svc1.getConfigSnapshot("owner_chief");
      assert.equal(legacySnap.config.testRecipient, "");
      assert.equal(legacySnap.config.agentMailAddress, "legacy@agent.qq.com");
      assert.equal(legacySnap.config.strategy.triggerTag, "#factory");

      // 2. PUT /v1/overnight/config persists normalized testRecipient (trimming spaces & stripping CR/LF)
      const savedRecipientSnap = await svc1.updateConfig(
        { testRecipient: "  owner-test@qq.com \r\n" },
        "owner_chief",
      );
      assert.equal(savedRecipientSnap.config.testRecipient, "owner-test@qq.com");
      assert.equal(savedRecipientSnap.config.agentMailAddress, "legacy@agent.qq.com");

      // 3. Partial strategy update & master toggle switch MUST preserve testRecipient untouched
      const afterStrategy = await svc1.updateConfig(
        {
          enabled: true,
          strategy: { triggerTag: "#nightly", pollIntervalMinutes: 15 },
        },
        "owner_chief",
      );
      assert.equal(afterStrategy.config.enabled, true);
      assert.equal(afterStrategy.config.strategy.triggerTag, "#nightly");
      assert.equal(afterStrategy.config.testRecipient, "owner-test@qq.com");

      // 4. Invalid non-empty values (missing @ or internal whitespace) do not clobber valid saved testRecipient
      const afterInvalid = await svc1.updateConfig(
        { testRecipient: "not-an-email" },
        "owner_chief",
      );
      assert.equal(afterInvalid.config.testRecipient, "owner-test@qq.com");

      const afterWhitespaceInvalid = await svc1.updateConfig(
        { testRecipient: "bad user@qq.com" },
        "owner_chief",
      );
      assert.equal(afterWhitespaceInvalid.config.testRecipient, "owner-test@qq.com");

      await assert.rejects(
        () => svc1.sendTestMorningReport({ recipient: "bad user@qq.com" }, "owner_chief"),
        (err: unknown) =>
          err instanceof Error && (err as { code?: string }).code === "RECIPIENT_MISSING",
      );

      // 5. Background probeAgentMailStatus auto-persisting a new agentMailAddress MUST preserve testRecipient
      probedAgentEmail = "fishundersea@agent.qq.com";
      const afterProbe = await svc1.getConfigSnapshot("owner_chief", { forceProbe: true });
      assert.equal(afterProbe.config.agentMailAddress, "fishundersea@agent.qq.com");
      assert.equal(afterProbe.config.testRecipient, "owner-test@qq.com");

      // 6. sendTestMorningReport({}) without explicit recipient defaults to persisted testRecipient
      const reportDefault = await svc1.sendTestMorningReport({}, "owner_chief");
      assert.equal(reportDefault.ok, true);
      assert.equal(reportDefault.recipient, "owner-test@qq.com");
      assert.equal(reportDefault.testRecipient, "owner-test@qq.com");
      assert.equal(sentTargets.at(-1), "owner-test@qq.com");

      // 7. sendTestMorningReport with a new explicit valid recipient auto-persists it to overnight-factory.json
      const reportExplicit = await svc1.sendTestMorningReport(
        { recipient: "  boss-override@qq.com  " },
        "owner_chief",
      );
      assert.equal(reportExplicit.ok, true);
      assert.equal(reportExplicit.recipient, "boss-override@qq.com");
      assert.equal(reportExplicit.testRecipient, "boss-override@qq.com");
      assert.equal(sentTargets.at(-1), "boss-override@qq.com");

      const rawDiskJson = JSON.parse(NodeFS.readFileSync(legacyConfigPath, "utf8")) as {
        testRecipient?: string;
        agentMailAddress?: string;
        strategy?: { triggerTag?: string };
      };
      assert.equal(rawDiskJson.testRecipient, "boss-override@qq.com");
      assert.equal(rawDiskJson.agentMailAddress, "fishundersea@agent.qq.com");
      assert.equal(rawDiskJson.strategy?.triggerTag, "#nightly");
      svc1.stop();

      // 8. Brand-new OvernightRouteService instance (simulating app restart / software update) restores testRecipient
      const svc2 = createSvc();
      const afterRestart = await svc2.getConfigSnapshot("owner_chief");
      assert.equal(afterRestart.config.testRecipient, "boss-override@qq.com");
      assert.equal(afterRestart.config.agentMailAddress, "fishundersea@agent.qq.com");
      assert.equal(afterRestart.config.strategy.triggerTag, "#nightly");

      // 9. Explicit empty string clears testRecipient and persists cleanly
      const cleared = await svc2.updateConfig({ testRecipient: "   " }, "owner_chief");
      assert.equal(cleared.config.testRecipient, "");
      svc2.stop();

      const svc3 = createSvc();
      const afterClearRestart = await svc3.getConfigSnapshot("owner_chief");
      assert.equal(afterClearRestart.config.testRecipient, "");
      svc3.stop();
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });
});
