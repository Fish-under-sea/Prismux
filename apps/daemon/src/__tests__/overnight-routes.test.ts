import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { EncryptedPluginCredentialStore } from "@prismux/cordis-kernel";
import {
  OVERNIGHT_CREDENTIAL_BUCKET,
  OVERNIGHT_MAIL_PRESETS,
  OvernightRouteService,
  PrismuxDaemon,
  isSenderAllowed,
  isWithinExecutionWindow,
  type OutboundMailPayload
} from "../index.js";

describe("OvernightRouteService & /v1/overnight/* API (encrypted credentials, OAuth2, whitelist & mail)", () => {
  it("persists non-secret config in JSON and seals all mail secrets write-only into overnight-factory.enc", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pmx-overnight-cred-"));
    try {
      const store = new EncryptedPluginCredentialStore({
        dataDir: dir,
        masterKey: randomBytes(32)
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
      const rawJson = readFileSync(join(dir, "overnight-factory.json"), "utf8");
      assert.equal(rawJson.includes(secretPass), false);
      assert.equal(rawJson.includes(gmailSecret), false);

      // 3. Encrypted credential file exists at credentials/overnight-factory.enc without plaintext
      const encPath = store.getCredentialFilePath(OVERNIGHT_CREDENTIAL_BUCKET);
      assert.equal(existsSync(encPath), true);
      assert.ok(encPath.endsWith(`${OVERNIGHT_CREDENTIAL_BUCKET}.enc`));
      const encRaw = readFileSync(encPath, "utf8");
      assert.equal(encRaw.includes(secretPass), false);
      assert.equal(encRaw.includes(gmailSecret), false);
      if (process.platform !== "win32") {
        assert.equal(statSync(encPath).mode & 0o777, 0o600);
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
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("handles Gmail OAuth2 PKCE start -> callback -> token seal -> connectivity test -> disconnect", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pmx-overnight-oauth-"));
    try {
      const store = new EncryptedPluginCredentialStore({
        dataDir: dir,
        masterKey: randomBytes(32)
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
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tests IMAP/SMTP connectivity, sends HTML morning test report, and enforces sender whitelist during pollNow", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pmx-overnight-poll-"));
    try {
      const store = new EncryptedPluginCredentialStore({
        dataDir: dir,
        masterKey: randomBytes(32)
      });
      const sentPayloads: OutboundMailPayload[] = [];

      const service = new OvernightRouteService({
        dataDir: dir,
        credentialStore: store,
        networkHooks: {
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
              acceptedAt: Date.now(),
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
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exposes authenticated /v1/overnight/* endpoints on PrismuxDaemon HTTP server", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pmx-overnight-http-"));
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

      // Authenticated GET returns default config & secret badges
      const getRes = await fetch(`${ready.httpUrl}/v1/overnight/config`, {
        headers: authHeaders
      });
      assert.equal(getRes.status, 200);
      const getJson = (await getRes.json()) as {
        ok: boolean;
        config: { enabled: boolean; strategy: { triggerTag: string } };
        secrets: { hasImapPassword: boolean };
      };
      assert.equal(getJson.ok, true);
      assert.equal(getJson.config.enabled, false);
      assert.equal(getJson.config.strategy.triggerTag, "#factory");
      assert.equal(getJson.secrets.hasImapPassword, false);

      // Authenticated PUT saves sanitized config + sealed password
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
        config: { imapSmtp: { email: string } };
        secrets: { hasImapPassword: boolean };
      };
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
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
