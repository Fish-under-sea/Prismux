import * as NodeAssert from "node:assert/strict";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTest from "node:test";
import { EncryptedPluginCredentialStore } from "@prismux/cordis-kernel";
import {
  OVERNIGHT_CREDENTIAL_BUCKET,
  OVERNIGHT_MAIL_PRESETS,
  OVERNIGHT_MAIL_PRESET_ORDER,
  OvernightRouteService,
  PrismuxDaemon,
  extractAgentMailAddress,
  extractOpaqueOAuthUrl,
  isSenderAllowed,
  isWithinExecutionWindow,
  type AgentMailLoginSpawnHandle,
  type OutboundMailPayload
} from "../index.js";

const assert: typeof NodeAssert = NodeAssert;
const { describe, it } = NodeTest;
const FIXED_TEST_EPOCH_MS = 1_763_000_000_000;

describe("OvernightRouteService & /v1/overnight/* API (encrypted credentials, OAuth2, whitelist & mail)", () => {
  it("persists non-secret config in JSON and seals all mail secrets write-only into overnight-factory.enc", async () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "pmx-overnight-cred-"));
    try {
      const store = new EncryptedPluginCredentialStore({
        dataDir: dir,
        masterKey: NodeCrypto.randomBytes(32)
      });
      const service = new OvernightRouteService({
        dataDir: dir,
        credentialStore: store
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
            smtpSecure: true
          },
          gmail: {
            clientId: "12345.apps.googleusercontent.com"
          },
          secrets: {
            imapPassword: secretPass,
            gmailClientSecret: gmailSecret
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
            localWorktreeOnlyNoPush: true
          }
        },
        "owner_chief"
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
        "alice@example.com"
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
          strategy: { triggerTag: "#nightly" }
        },
        "owner_chief"
      );
      assert.equal(preserved.secrets.hasImapPassword, true);
      assert.equal(preserved.secrets.hasGmailClientSecret, true);
      assert.equal(preserved.config.strategy.triggerTag, "#nightly");

      // 5. Non-owner scope is strictly rejected (403 FORBIDDEN_SCOPE)
      await assert.rejects(
        () => service.getConfigSnapshot("qq_group:1001"),
        (err: unknown) =>
          err instanceof Error &&
          (err as { statusCode?: number }).statusCode === 403
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
        "custom"
      ]);
      assert.deepEqual(Object.keys(OVERNIGHT_MAIL_PRESETS), [
        "gmail",
        "qq",
        "agent_mail",
        "outlook",
        "netease",
        "custom"
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
        masterKey: NodeCrypto.randomBytes(32)
      });
      const service = new OvernightRouteService({
        dataDir: dir,
        credentialStore: store
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
            email: "dev@gmail.com"
          },
          secrets: {
            imapPassword: "abcd efgh ijkl mnop"
          }
        },
        "owner_chief"
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
            email: "nightowl@126.com"
          }
        },
        "owner_chief"
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
            email: "nightowl@163.com"
          }
        },
        "owner_chief"
      );
      assert.equal(legacy163.config.imapSmtp.preset, "netease");
      assert.equal(legacy163.config.imapSmtp.imapHost, "imap.163.com");
      assert.equal(legacy163.config.imapSmtp.smtpHost, "smtp.163.com");
      service.stop();

      // Reload from persisted JSON preserves normalized "netease" preset and endpoints
      const reloaded = new OvernightRouteService({
        dataDir: dir,
        credentialStore: store
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
        masterKey: NodeCrypto.randomBytes(32)
      });

      const opaqueUrl =
        "https://agent.qq.com/oauth/authorize?client_id=agently&state=RAW%2BOPAQUE%3D%3D&nonce=AbC_123";
      assert.equal(
        extractOpaqueOAuthUrl(`\u001b[36m请打开链接：${opaqueUrl}\u001b[0m\n`),
        opaqueUrl
      );
      assert.equal(
        extractAgentMailAddress('{"email":"fishundersea@agent.qq.com","aliases":[]}'),
        "fishundersea@agent.qq.com"
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
              stdout: "added 1 package @tencent-qqmail/agently-cli Bearer secret_token_should_redact",
              stderr: ""
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
                stderr: ""
              };
            }
            if (args[0] === "message" && args[1] === "+send") {
              return {
                exitCode: 0,
                stdout: JSON.stringify({ success: true, messageId: "agm-report-9001" }),
                stderr: ""
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
                      text: "blocked by whitelist"
                    }
                  ]
                }),
                stderr: ""
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
              kill: () => {}
            };
          }
        }
      });

      // 1. When CLI is absent, getConfigSnapshot never crashes and reports cliInstalled=false
      const snapBefore = await service.getConfigSnapshot("owner_chief");
      assert.equal(snapBefore.agentMail.cliInstalled, false);
      assert.equal(snapBefore.agentMail.authorizedEmail, null);

      // 2. Persist emailProvider="agent_mail"
      const switched = await service.updateConfig(
        { emailProvider: "agent_mail" },
        "owner_chief"
      );
      assert.equal(switched.config.emailProvider, "agent_mail");
      assert.equal(switched.config.imapSmtp.preset, "agent_mail");

      // 3. agentMailAction="install" installs CLI and redacts tokens in stdout
      const installRes = await service.testMailConnection(
        { emailProvider: "agent_mail", agentMailAction: "install" },
        "owner_chief"
      );
      assert.equal(installRes.ok, true);
      assert.equal(installRes.installed, true);
      assert.equal(installRes.stdout?.includes("secret_token_should_redact"), false);
      assert.equal(installRes.stdout?.includes("[REDACTED]"), true);

      // 4. agentMailAction="login" captures exact unmodified opaque OAuth URL immediately
      const loginRes = await service.testMailConnection(
        { emailProvider: "agent_mail", agentMailAction: "login" },
        "owner_chief"
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
        "owner_chief"
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
        masterKey: NodeCrypto.randomBytes(32)
      });

      const fakeFetch: typeof fetch = async (input) => {
        const url = String(input);
        if (url.includes("oauth2.googleapis.com/token")) {
          return new Response(
            JSON.stringify({
              access_token: "ya29.mock-access-token",
              refresh_token: "1//mock-refresh-token-sealed",
              expires_in: 3600
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        if (url.includes("gmail.googleapis.com/gmail/v1/users/me/profile")) {
          return new Response(
            JSON.stringify({
              emailAddress: "owner@gmail.com",
              messagesTotal: 42,
              historyId: "9001"
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response("not found", { status: 404 });
      };

      const service = new OvernightRouteService({
        dataDir: dir,
        credentialStore: store,
        networkHooks: { fetchFn: fakeFetch }
      });

      const started = await service.startGmailOAuth(
        {
          clientId: "mock-client.apps.googleusercontent.com",
          clientSecret: "GOCSPX-mock-client-secret"
        },
        "owner_chief",
        "http://127.0.0.1:43999"
      );
      assert.equal(started.ok, true);
      assert.ok(started.authUrl.includes("accounts.google.com/o/oauth2/v2/auth"));
      assert.ok(started.authUrl.includes("code_challenge_method=S256"));
      assert.equal(
        started.redirectUri,
        "http://127.0.0.1:43999/v1/overnight/oauth/gmail/callback"
      );

      // Rejects forged state
      const forged = await service.handleGmailOAuthCallback(
        new URLSearchParams({ state: "forged-state", code: "abc" })
      );
      assert.equal(forged.ok, false);
      assert.equal(forged.statusCode, 400);

      // Valid callback binds Gmail email and seals refresh token
      const cb = await service.handleGmailOAuthCallback(
        new URLSearchParams({ state: started.state, code: "auth-code-123" })
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
        masterKey: NodeCrypto.randomBytes(32)
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
            message: "IMAP mock ok"
          }),
          probeSmtp: async (params) => ({
            ok: params.host === "smtp.qq.com" && params.password === "valid-auth-code",
            latencyMs: 24,
            message: "SMTP mock ok"
          }),
          sendSmtp: async (_params, payload) => {
            sentPayloads.push(payload);
            return {
              messageId: "mock-report-001@prismux.local",
              acceptedAt: FIXED_TEST_EPOCH_MS,
              provider: "smtp:smtp.qq.com"
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
                  textBody: "malicious prompt"
                },
                {
                  messageId: "<normal-newsletter@news.example>",
                  from: "owner@qq.com",
                  to: ["owner@qq.com"],
                  subject: "Weekly digest without trigger tag",
                  textBody: "hello"
                }
              ]
            })
          })
        }
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
            smtpSecure: true
          },
          secrets: { imapPassword: "valid-auth-code" },
          strategy: {
            triggerTag: "#factory",
            allowedSenders: ["owner@qq.com"]
          }
        },
        "owner_chief"
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
          at2330
        ),
        true
      );
      assert.equal(
        isWithinExecutionWindow(
          { windowMode: "scheduled", windowStart: "23:00", windowEnd: "07:00" },
          at0230
        ),
        true
      );
      assert.equal(
        isWithinExecutionWindow(
          { windowMode: "scheduled", windowStart: "23:00", windowEnd: "07:00" },
          at1400
        ),
        false
      );
      assert.equal(
        isWithinExecutionWindow(
          { windowMode: "always", windowStart: "23:00", windowEnd: "07:00" },
          at1400
        ),
        true
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
      disableAutoUpdateCheck: true
    });

    try {
      const ready = await daemon.start();
      const authHeaders = {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json"
      };

      // Unauthenticated request rejected with 401
      const unauth = await fetch(`${ready.httpUrl}/v1/overnight/config`);
      assert.equal(unauth.status, 401);

      // Authenticated GET returns default config (Generic IMAP/SMTP mode), secret badges, and agentMail probe
      const getRes = await fetch(`${ready.httpUrl}/v1/overnight/config`, {
        headers: authHeaders
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
          imapSmtp: { preset: "163", email: "dev@163.com", imapHost: "imap.163.com", smtpHost: "smtp.163.com" },
          secrets: { imapPassword: "163-secret-code" }
        })
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
        headers: authHeaders
      });
      assert.equal(runsRes.status, 200);
      const runsJson = (await runsRes.json()) as { ok: boolean; runs: unknown[] };
      assert.equal(runsJson.ok, true);
      assert.deepEqual(runsJson.runs, []);

      // Diagnostics engine.overnight_factory links straight to /settings/overnight-factory
      const diagRes = await fetch(`${ready.httpUrl}/v1/diagnostics?force=1`, {
        headers: authHeaders
      });
      assert.equal(diagRes.status, 200);
      const diagJson = (await diagRes.json()) as {
        items: Array<{ id: string; settingsRoute?: string }>;
      };
      const overnightDiag = diagJson.items.find((i) => i.id === "engine.overnight_factory");
      assert.equal(overnightDiag?.settingsRoute, "/settings/overnight-factory");
    } finally {
      await daemon.stop();
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });
});
