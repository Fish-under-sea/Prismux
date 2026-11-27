import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import {
  SUBSCRIPTION_ORCHESTRATION_BLOCKED_CODE,
  SUBSCRIPTION_WAIVER_SETTINGS_ROUTE,
  SUBSCRIPTION_WAIVER_VERSION,
  type PrismuxProviderProbeResponse,
  type SubscriptionOrchestrationBlockedPayload,
  type SubscriptionWaiverResponse
} from "@prismux/protocol";
import {
  AUTH_LABEL_API_CUSTOM,
  AUTH_LABEL_API_KEY,
  AUTH_LABEL_CCS_MAGPIE,
  AUTH_LABEL_LOCAL_RUNTIME,
  AUTH_LABEL_SUBSCRIPTION_OAUTH,
  OfficialQuotaService,
  PrismuxDaemon,
  PrismuxProviderProbeService,
  ServiceDiagnosticsService,
  SubscriptionOrchestrationGuard,
  SubscriptionWaiverError,
  SubscriptionWaiverStore,
  classifyProviderAuth,
  findPackagedAntigravityCli,
  findPackagedDshDesktopCli,
  getDefaultCliExtraDirs,
  parseCodexRoutingConfigToml,
  resolveDshInstalledVersionFastSync
} from "../index.js";

const tempDirs: string[] = [];
const cleanups: Array<() => Promise<void> | void> = [];

after(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop();
    if (fn) {
      await fn();
    }
  }
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe("Prismux v3 Unified Provider Probe + Merged Subscription Risk Waiver", () => {
  test("Claude Code: ZERO false positives on CCS/Magpie API injection, custom endpoint, apiKeyHelper, Cloud IAM, and unknown status", () => {
    const emptyHome = makeTempDir("pmx-claude-empty-");

    // 1. Server probe auth.type: apiKey / customEndpoint / bedrock / vertex / foundry -> api_or_custom
    for (const authType of ["apiKey", "customEndpoint", "bedrock", "vertex", "foundry"]) {
      const res = classifyProviderAuth({
        providerId: "claudeAgent",
        installed: true,
        env: {},
        homeDir: emptyHome,
        serverAuth: { type: authType, status: "authenticated" }
      });
      assert.equal(res.authMode, "api_or_custom", `serverAuth.type=${authType}`);
    }

    // 2. ~/.claude/settings.json CCS / Magpie non-official ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN
    const ccsHome = makeTempDir("pmx-claude-ccs-");
    mkdirSync(join(ccsHome, ".claude"), { recursive: true });
    writeFileSync(
      join(ccsHome, ".claude", "settings.json"),
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: "https://ccs.internal.example/v1?secret=do-not-leak",
          ANTHROPIC_AUTH_TOKEN: "sk-ccs-super-secret-value"
        }
      }),
      "utf8"
    );
    const ccsRes = classifyProviderAuth({
      providerId: "cc",
      installed: true,
      env: {},
      homeDir: ccsHome,
      // Even if a stale subscriptionType is reported, API/CCS override MUST win!
      serverAuth: { subscriptionType: "ClaudeMax20xSubscription" }
    });
    assert.equal(ccsRes.authMode, "api_or_custom");
    assert.equal(ccsRes.authSource, "ccs_or_magpie");
    assert.equal(AUTH_LABEL_CCS_MAGPIE, AUTH_LABEL_API_CUSTOM);
    assert.equal(ccsRes.authLabel, AUTH_LABEL_API_CUSTOM);
    assert.equal(ccsRes.endpoint, "https://ccs.internal.example/v1");
    assert.ok(!JSON.stringify(ccsRes).includes("sk-ccs-super-secret-value"));
    assert.ok(!JSON.stringify(ccsRes).includes("do-not-leak"));

    // 3. Project .claude/settings.local.json with apiKeyHelper -> api_or_custom
    const workspaceDir = makeTempDir("pmx-claude-proj-");
    mkdirSync(join(workspaceDir, ".claude"), { recursive: true });
    writeFileSync(
      join(workspaceDir, ".claude", "settings.local.json"),
      JSON.stringify({ apiKeyHelper: "/usr/local/bin/magpie-token-helper" }),
      "utf8"
    );
    const helperRes = classifyProviderAuth({
      providerId: "claudeAgent",
      installed: true,
      env: {},
      homeDir: emptyHome,
      workspacePath: workspaceDir
    });
    assert.equal(helperRes.authMode, "api_or_custom");
    assert.equal(helperRes.authSource, "ccs_or_magpie");

    // 4. Launch wrapper using ccs / magpie -> api_or_custom
    const wrapperRes = classifyProviderAuth({
      providerId: "claudeAgent",
      installed: true,
      launchCommand: "ccs claude --profile relay",
      env: {},
      homeDir: emptyHome
    });
    assert.equal(wrapperRes.authMode, "api_or_custom");
    assert.equal(wrapperRes.authSource, "ccs_or_magpie");

    // 5. Env ANTHROPIC_API_KEY -> api_or_custom
    const envKeyRes = classifyProviderAuth({
      providerId: "claudeAgent",
      installed: true,
      env: { ANTHROPIC_API_KEY: "sk-ant-never-log-me" },
      homeDir: emptyHome
    });
    assert.equal(envKeyRes.authMode, "api_or_custom");
    assert.equal(envKeyRes.authSource, "env");
    assert.equal(envKeyRes.authLabel, AUTH_LABEL_API_KEY);
    assert.ok(!JSON.stringify(envKeyRes).includes("sk-ant-never-log-me"));

    // 6. Explicit official first-party subscription (with NO API overrides) -> subscription_oauth
    for (const sub of ["Free", "Pro", "Max", "Max 5x", "Max 20x", "ClaudeMax20xSubscription"]) {
      const subRes = classifyProviderAuth({
        providerId: "claudeAgent",
        installed: true,
        env: {},
        homeDir: emptyHome,
        serverAuth: { subscriptionType: sub, status: "authenticated" }
      });
      assert.equal(subRes.authMode, "subscription_oauth", `sub=${sub}`);
      assert.equal(subRes.authSource, "official_oauth");
      assert.equal(subRes.authLabel, AUTH_LABEL_SUBSCRIPTION_OAUTH);
    }

    // 7. auth.status === "unknown" MUST NEVER map to subscription_oauth!
    const unknownRes = classifyProviderAuth({
      providerId: "claudeAgent",
      installed: true,
      env: {},
      homeDir: emptyHome,
      serverAuth: { status: "unknown" }
    });
    assert.notEqual(unknownRes.authMode, "subscription_oauth");
  });

  test("Codex: ZERO false positives on config.toml CCS/Magpie provider, requiresOpenaiAuth === false + unknown, OPENAI_API_KEY, and official ChatGPT OAuth detection", () => {
    const emptyHome = makeTempDir("pmx-codex-empty-");

    // 1. ~/.codex/config.toml with custom model_provider & base_url (CCS / Magpie injection)
    const tomlHome = makeTempDir("pmx-codex-toml-");
    mkdirSync(join(tomlHome, ".codex"), { recursive: true });
    const tomlText = [
      'model_provider = "magpie_relay"',
      "",
      "[model_providers.magpie_relay]",
      'base_url = "https://user:pass@relay.magpie.example/v1/codex"',
      "requires_openai_auth = false"
    ].join("\n");
    writeFileSync(join(tomlHome, ".codex", "config.toml"), tomlText, "utf8");

    const parsedToml = parseCodexRoutingConfigToml(tomlText);
    assert.equal(parsedToml.modelProvider, "magpie_relay");
    assert.equal(parsedToml.hasCustomProvider, true);
    assert.equal(parsedToml.providerBaseUrl, "https://relay.magpie.example/v1/codex");
    assert.equal(parsedToml.requiresOpenaiAuth, false);

    const codexTomlRes = classifyProviderAuth({
      providerId: "codex",
      installed: true,
      env: {},
      homeDir: tomlHome,
      // Even if a stale chatgpt account exists, custom provider injection MUST win!
      serverAuth: { accountType: "chatgpt", status: "authenticated" }
    });
    assert.equal(codexTomlRes.authMode, "api_or_custom");
    assert.equal(codexTomlRes.authSource, "ccs_or_magpie");
    assert.equal(codexTomlRes.authLabel, AUTH_LABEL_API_CUSTOM);
    assert.equal(codexTomlRes.endpoint, "https://relay.magpie.example/v1/codex");
    assert.ok(!JSON.stringify(codexTomlRes).includes("user:pass"));

    // 1b. Localhost Codex custom endpoint MUST show the exact same unified label as Claude & DSH!
    const codexLocalhostRes = classifyProviderAuth({
      providerId: "codex",
      installed: true,
      env: { OPENAI_BASE_URL: "http://127.0.0.1:3426/v1" },
      homeDir: emptyHome
    });
    assert.equal(codexLocalhostRes.authMode, "api_or_custom");
    assert.equal(codexLocalhostRes.authSource, "ccs_or_magpie");
    assert.equal(codexLocalhostRes.authLabel, AUTH_LABEL_API_CUSTOM);
    assert.equal(codexLocalhostRes.authLabel, "API / 自定义端点注入（已放行）");

    // 2. requiresOpenaiAuth === false WITH auth.status === "unknown" -> 100% api_or_custom (NEVER subscription_oauth!)
    const reqFalseUnknown = classifyProviderAuth({
      providerId: "codex",
      installed: true,
      env: {},
      homeDir: emptyHome,
      serverAuth: {
        status: "unknown",
        requiresOpenaiAuth: false
      }
    });
    assert.equal(reqFalseUnknown.authMode, "api_or_custom");
    assert.equal(reqFalseUnknown.authLabel, AUTH_LABEL_API_CUSTOM);

    // 3. Server probe auth.type === "apiKey" -> api_or_custom
    const apiKeyServer = classifyProviderAuth({
      providerId: "codex",
      installed: true,
      env: {},
      homeDir: emptyHome,
      serverAuth: { type: "apiKey", status: "authenticated" }
    });
    assert.equal(apiKeyServer.authMode, "api_or_custom");

    // 4. Env OPENAI_API_KEY / OPENAI_BASE_URL -> api_or_custom
    const envOpenAiKey = classifyProviderAuth({
      providerId: "codex",
      installed: true,
      env: { OPENAI_API_KEY: "sk-proj-secret" },
      homeDir: emptyHome
    });
    assert.equal(envOpenAiKey.authMode, "api_or_custom");
    assert.equal(envOpenAiKey.authSource, "env");
    assert.ok(!JSON.stringify(envOpenAiKey).includes("sk-proj-secret"));

    const envOpenAiBase = classifyProviderAuth({
      providerId: "codex",
      installed: true,
      env: { OPENAI_BASE_URL: "https://gateway.company.example/v1" },
      homeDir: emptyHome
    });
    assert.equal(envOpenAiBase.authMode, "api_or_custom");
    assert.equal(envOpenAiBase.authSource, "custom_endpoint");
    assert.equal(envOpenAiBase.endpoint, "https://gateway.company.example/v1");

    // 5. Official ChatGPT personal subscription -> subscription_oauth
    for (const meta of [
      { accountType: "chatgpt", status: "authenticated" },
      { type: "codex-chatgpt", status: "authenticated" }
    ]) {
      const chatgptRes = classifyProviderAuth({
        providerId: "codex",
        installed: true,
        env: {},
        homeDir: emptyHome,
        serverAuth: meta
      });
      assert.equal(chatgptRes.authMode, "subscription_oauth");
      assert.equal(chatgptRes.authSource, "official_oauth");
      assert.equal(chatgptRes.authLabel, AUTH_LABEL_SUBSCRIPTION_OAUTH);
    }

    // 6. auth.status === "unknown" alone -> NEVER subscription_oauth!
    const unknownCodex = classifyProviderAuth({
      providerId: "codex",
      installed: true,
      env: {},
      homeDir: emptyHome,
      serverAuth: { status: "unknown" }
    });
    assert.notEqual(unknownCodex.authMode, "subscription_oauth");
  });

  test("Antigravity, DSH, OpenCode, and Local auth classification rules", () => {
    const emptyHome = makeTempDir("pmx-other-providers-");

    // Antigravity: local agy CLI = subscription_oauth; GEMINI_API_KEY / Vertex = api_or_custom
    const agyLocal = classifyProviderAuth({
      providerId: "antigravity",
      installed: true,
      env: {},
      homeDir: emptyHome
    });
    assert.equal(agyLocal.authMode, "subscription_oauth");
    assert.equal(agyLocal.authSource, "official_oauth");

    const agyApiKey = classifyProviderAuth({
      providerId: "agy",
      installed: true,
      env: { GEMINI_API_KEY: "AIza-fake-key" },
      homeDir: emptyHome
    });
    assert.equal(agyApiKey.authMode, "api_or_custom");
    assert.equal(agyApiKey.authSource, "env");

    const agyVertex = classifyProviderAuth({
      providerId: "antigravity",
      installed: true,
      env: { GOOGLE_GENAI_USE_VERTEXAI: "true" },
      homeDir: emptyHome
    });
    assert.equal(agyVertex.authMode, "api_or_custom");
    assert.equal(agyVertex.authSource, "cloud_iam");

    // DSH / OpenCode / Local default to api_or_custom or local
    const dshRes = classifyProviderAuth({
      providerId: "dsh",
      installed: true,
      env: {},
      homeDir: emptyHome
    });
    assert.equal(dshRes.authMode, "api_or_custom");

    const opencodeRes = classifyProviderAuth({
      providerId: "opencode",
      installed: true,
      env: {},
      homeDir: emptyHome
    });
    assert.equal(opencodeRes.authMode, "api_or_custom");

    const localRes = classifyProviderAuth({
      providerId: "ollama",
      installed: true,
      env: {},
      homeDir: emptyHome
    });
    assert.equal(localRes.authMode, "local");
    assert.equal(localRes.authSource, "local_runtime");
    assert.equal(localRes.authLabel, AUTH_LABEL_LOCAL_RUNTIME);
  });

  test("SubscriptionWaiverStore migrates legacy antigravity-policy.json, enforces WAIVER_SIGNATURE_REQUIRED, and revokes cleanly", () => {
    // 1. Legacy migration from antigravity-policy.json -> subscription-waiver.json
    const legacyDir = makeTempDir("pmx-waiver-migrate-");
    mkdirSync(join(legacyDir, "config"), { recursive: true });
    writeFileSync(
      join(legacyDir, "config", "antigravity-policy.json"),
      JSON.stringify({
        allowAntigravityAsControlledAgent: true,
        disclaimerAcceptedAt: "2026-11-20T00:00:00.000Z",
        disclaimerVersion: "v3-2026"
      }),
      "utf8"
    );
    const migratedStore = new SubscriptionWaiverStore({ dataDir: legacyDir });
    const migrated = migratedStore.getWaiver();
    assert.equal(migrated.signed, true);
    assert.equal(migrated.waiverVersion, "v3-2026");
    assert.equal(migrated.signedAt, "2026-11-20T00:00:00.000Z");
    assert.equal(migrated.allowAntigravityAsControlledAgent, true);
    assert.equal(migrated.allowExternalSubscriptionAgentsInSwarm, false);
    assert.equal(migrated.defaultLocked, true);
    assert.equal(existsSync(join(legacyDir, "config", "subscription-waiver.json")), true);

    // 2. Fresh store defaults all false & blocks enabling Switch A or B when !signed
    const freshDir = makeTempDir("pmx-waiver-fresh-");
    const store = new SubscriptionWaiverStore({ dataDir: freshDir });
    assert.deepEqual(store.getWaiver(), {
      signed: false,
      waiverVersion: null,
      signedAt: null,
      allowAntigravityAsControlledAgent: false,
      allowExternalSubscriptionAgentsInSwarm: false,
      defaultLocked: true
    });

    assert.throws(
      () => store.updateWaiver({ allowAntigravityAsControlledAgent: true }),
      (err: unknown) =>
        err instanceof SubscriptionWaiverError &&
        err.statusCode === 400 &&
        err.code === "WAIVER_SIGNATURE_REQUIRED"
    );
    assert.throws(
      () => store.updateWaiver({ allowExternalSubscriptionAgentsInSwarm: true }),
      (err: unknown) =>
        err instanceof SubscriptionWaiverError &&
        err.statusCode === 400 &&
        err.code === "WAIVER_SIGNATURE_REQUIRED"
    );

    // 3. Sign waiver -> toggles still stay false until explicitly enabled
    const signedOnly = store.updateWaiver({
      signed: true,
      waiverVersion: SUBSCRIPTION_WAIVER_VERSION
    });
    assert.equal(signedOnly.signed, true);
    assert.equal(signedOnly.waiverVersion, SUBSCRIPTION_WAIVER_VERSION);
    assert.ok(typeof signedOnly.signedAt === "string");
    assert.equal(signedOnly.allowAntigravityAsControlledAgent, false);
    assert.equal(signedOnly.allowExternalSubscriptionAgentsInSwarm, false);

    // 4. Enable both toggles, then revoke via signed: false -> BOTH toggles reset immediately!
    const bothEnabled = store.updateWaiver({
      allowAntigravityAsControlledAgent: true,
      allowExternalSubscriptionAgentsInSwarm: true
    });
    assert.equal(bothEnabled.allowAntigravityAsControlledAgent, true);
    assert.equal(bothEnabled.allowExternalSubscriptionAgentsInSwarm, true);

    const revokedViaPut = store.updateWaiver({ signed: false });
    assert.deepEqual(revokedViaPut, {
      signed: false,
      waiverVersion: null,
      signedAt: null,
      allowAntigravityAsControlledAgent: false,
      allowExternalSubscriptionAgentsInSwarm: false,
      defaultLocked: true
    });

    // 5. Re-sign + enable, then revokeWaiver() -> persisted & locked across reload
    store.updateWaiver({
      signed: true,
      allowAntigravityAsControlledAgent: true,
      allowExternalSubscriptionAgentsInSwarm: true
    });
    const revokedViaDelete = store.revokeWaiver();
    assert.equal(revokedViaDelete.signed, false);
    assert.equal(revokedViaDelete.allowAntigravityAsControlledAgent, false);
    assert.equal(revokedViaDelete.allowExternalSubscriptionAgentsInSwarm, false);

    const reloaded = new SubscriptionWaiverStore({ dataDir: freshDir });
    assert.equal(reloaded.getWaiver().signed, false);
    assert.equal(reloaded.getWaiver().allowExternalSubscriptionAgentsInSwarm, false);
  });

  test("SubscriptionOrchestrationGuard: CCS/Magpie & requiresOpenaiAuth=false 100% allowed without waiver; official OAuth blocked -> unlocked -> re-locked immediately on revocation", () => {
    const dataDir = makeTempDir("pmx-guard-unified-");
    const store = new SubscriptionWaiverStore({ dataDir });
    const guard = new SubscriptionOrchestrationGuard(store);

    // 1. CCS / Magpie Claude & Codex (api_or_custom) -> 100% ALLOWED across all callers with ZERO waiver!
    for (const caller of [
      "swarm",
      "agent_subtask",
      "internal_script",
      "secretary_qq",
      "cron",
      "overnight_factory"
    ] as const) {
      const claudeCcs = guard.evaluateDispatch({
        callerKind: caller,
        targetProvider: "claudeAgent",
        probeSnapshot: {
          providerId: "claudeAgent",
          authMode: "api_or_custom",
          authSource: "ccs_or_magpie",
          authLabel: AUTH_LABEL_CCS_MAGPIE,
          endpoint: "https://ccs.local/v1"
        }
      });
      assert.equal(claudeCcs.allowed, true, `claude CCS caller=${caller}`);

      const codexCustom = guard.evaluateDispatch({
        callerKind: caller,
        targetProvider: "codex",
        probeSnapshot: {
          providerId: "codex",
          authMode: "api_or_custom",
          authSource: "custom_endpoint",
          authLabel: AUTH_LABEL_API_CUSTOM,
          endpoint: "https://relay.example/v1"
        }
      });
      assert.equal(codexCustom.allowed, true, `codex custom caller=${caller}`);
    }

    // 2. Official ChatGPT Codex & official Claude OAuth (`subscription_oauth`) -> BLOCKED before waiver!
    for (const provider of ["codex", "claudeAgent"] as const) {
      for (const caller of [
        "swarm",
        "agent_subtask",
        "internal_script",
        "secretary_qq",
        "secretary_gmail",
        "cron",
        "overnight_factory"
      ] as const) {
        const denied = guard.evaluateDispatch({
          callerKind: caller,
          targetProvider: provider,
          probeSnapshot: {
            providerId: provider,
            authMode: "subscription_oauth",
            authSource: "official_oauth",
            authLabel: AUTH_LABEL_SUBSCRIPTION_OAUTH,
            endpoint: null
          }
        });
        assert.equal(denied.allowed, false, `${provider} blocked for ${caller}`);
        assert.equal(denied.httpStatus, 403);
        assert.equal(denied.code, SUBSCRIPTION_ORCHESTRATION_BLOCKED_CODE);
        assert.equal(denied.reasonCode, "EXTERNAL_SUBSCRIPTION_SWARM_LOCKED");
        assert.equal(denied.providerId, provider);
        assert.equal(denied.authMode, "subscription_oauth");
        assert.equal(denied.settingsRoute, SUBSCRIPTION_WAIVER_SETTINGS_ROUTE);
      }

      // Direct human desktop session is still ALLOWED!
      const humanOk = guard.evaluateDispatch({
        callerKind: "human_desktop",
        targetProvider: provider,
        probeSnapshot: {
          providerId: provider,
          authMode: "subscription_oauth",
          authSource: "official_oauth",
          authLabel: AUTH_LABEL_SUBSCRIPTION_OAUTH,
          endpoint: null
        }
      });
      assert.equal(humanOk.allowed, true, `${provider} human_desktop allowed`);
    }

    // 3. Sign waiver + enable Switch A ONLY -> controlled AGY allowed, external OAuth STILL blocked!
    store.updateWaiver({
      signed: true,
      allowAntigravityAsControlledAgent: true,
      allowExternalSubscriptionAgentsInSwarm: false
    });
    assert.equal(
      guard.evaluateDispatch({
        callerKind: "swarm",
        targetProvider: "antigravity"
      }).allowed,
      true
    );
    assert.equal(
      guard.evaluateDispatch({
        callerKind: "swarm",
        targetProvider: "codex",
        probeSnapshot: {
          providerId: "codex",
          authMode: "subscription_oauth",
          authLabel: AUTH_LABEL_SUBSCRIPTION_OAUTH
        }
      }).allowed,
      false
    );

    // 4. Enable Switch B -> external subscription OAuth allowed in swarm/cross-agent!
    store.updateWaiver({ allowExternalSubscriptionAgentsInSwarm: true });
    assert.equal(
      guard.evaluateDispatch({
        callerKind: "swarm",
        targetProvider: "codex",
        probeSnapshot: {
          providerId: "codex",
          authMode: "subscription_oauth",
          authLabel: AUTH_LABEL_SUBSCRIPTION_OAUTH
        }
      }).allowed,
      true
    );
    assert.equal(
      guard.evaluateDispatch({
        callerKind: "agent_subtask",
        targetProvider: "claudeAgent",
        probeSnapshot: {
          providerId: "claudeAgent",
          authMode: "subscription_oauth",
          authLabel: AUTH_LABEL_SUBSCRIPTION_OAUTH
        }
      }).allowed,
      true
    );

    // Unattended cron/overnight_factory targeting personal AGY STILL hard-blocked!
    const cronAgy = guard.evaluateDispatch({
      callerKind: "cron",
      targetProvider: "antigravity"
    });
    assert.equal(cronAgy.allowed, false);
    assert.equal(cronAgy.code, SUBSCRIPTION_ORCHESTRATION_BLOCKED_CODE);
    assert.equal(cronAgy.reasonCode, "AGY_UNATTENDED_FORBIDDEN");

    // 5. Revoke waiver -> BOTH personal AGY and external OAuth IMMEDIATELY hard-locked again!
    store.revokeWaiver();
    assert.equal(
      guard.evaluateDispatch({
        callerKind: "swarm",
        targetProvider: "antigravity"
      }).allowed,
      false
    );
    assert.equal(
      guard.evaluateDispatch({
        callerKind: "swarm",
        targetProvider: "codex",
        probeSnapshot: {
          providerId: "codex",
          authMode: "subscription_oauth",
          authLabel: AUTH_LABEL_SUBSCRIPTION_OAUTH
        }
      }).allowed,
      false
    );
  });

  test("ServiceDiagnosticsService and OfficialQuotaService consume PrismuxProviderProbeService cleanly", async () => {
    const emptyHome = makeTempDir("pmx-probe-wiring-");
    let cliProbeCount = 0;

    const probeService = new PrismuxProviderProbeService({
      homeDir: emptyHome,
      env: { OPENAI_BASE_URL: "https://ccs.local/v1" },
      refreshEnv: () => undefined,
      cliProbe: async (command) => {
        cliProbeCount += 1;
        if (command === "codex") {
          return {
            found: true,
            path: "/usr/bin/codex",
            version: "codex-cli 0.171.0",
            latencyMs: 5
          };
        }
        if (command === "agy") {
          return {
            found: true,
            path: "/usr/bin/agy",
            version: "agy 2.1.0",
            latencyMs: 4
          };
        }
        return { found: false, path: null, version: null, latencyMs: 1 };
      },
      locateExecutable: (command) => (command === "agy" ? "/usr/bin/agy" : null)
    });

    // Diagnostics uses PrismuxProviderProbeService: installed CLIs ok + authLabel, uninstalled omitted!
    const diag = new ServiceDiagnosticsService({
      dataDir: emptyHome,
      version: "0.2.0-rc.1",
      headless: true,
      startedAt: Date.now(),
      providerProbeService: probeService,
      detectAndroidSdk: () => ({ sdkRoot: null, adbPath: null }),
      resolve7za: () => "7za.exe",
      networkProbe: async () => ({ reachable: true, statusCode: 200, latencyMs: 10 }),
      refreshEnv: () => undefined
    });
    const report = await diag.runDiagnostics(true);
    const aiGroup = report.groups.find((g) => g.id === "ai_providers");
    assert.ok(aiGroup);
    assert.equal(aiGroup.items.length, 2);
    assert.ok(cliProbeCount >= 6);
    const codexDiag = aiGroup.items.find((i) => i.id === "provider.codex");
    assert.equal(codexDiag?.status, "ok");
    assert.ok(codexDiag?.summary.includes(AUTH_LABEL_API_CUSTOM));
    // Uninstalled optional CLIs (claude, dsh, gemini, opencode) MUST be omitted, never degraded!
    assert.equal(aiGroup.items.find((i) => i.id === "provider.claude"), undefined);
    assert.equal(aiGroup.degradedCount, 0);

    // OfficialQuotaService locates `agy` via PrismuxProviderProbeService!
    let invokedPath = "";
    const quota = new OfficialQuotaService({
      providerProbeService: probeService,
      refreshEnv: () => undefined,
      cliRunner: async (exePath) => {
        invokedPath = exePath;
        return {
          stdout: "Gemini Models\tWeekly Limit Remaining\t95%\t2026-12-01T00:00:00Z\n",
          stderr: "",
          exitCode: 0
        };
      }
    });
    const summary = await quota.getSummary(true);
    assert.equal(invokedPath, "/usr/bin/agy");
    assert.equal(summary.antigravity.status, "ok");
    assert.equal(summary.antigravity.executablePath, "/usr/bin/agy");
  });

  test("End-to-end HTTP routes: GET /v1/providers/probe, GET/PUT/DELETE /v1/security/subscription-waiver, and 403 ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED", async () => {
    const dataDir = makeTempDir("pmx-http-waiver-");
    const token = "probe-waiver-e2e-token";
    const daemon = new PrismuxDaemon({
      headless: true,
      dataDir,
      host: "127.0.0.1",
      port: 0,
      authToken: token,
      disableAutoUpdateCheck: true
    });
    const ready = await daemon.start();
    cleanups.push(() => daemon.stop());

    const headers = {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json"
    };

    // 1. Auth checks on /v1/providers/probe & /v1/security/subscription-waiver
    const unauthProbe = await fetch(`${ready.httpUrl}/v1/providers/probe`);
    assert.equal(unauthProbe.status, 401);

    const groupToken = "qq-group-non-owner";
    daemon.pairingManager.registerScopedToken(groupToken, "qq_group:888", "qq-888");
    const forbiddenProbe = await fetch(`${ready.httpUrl}/v1/providers/probe`, {
      headers: { Authorization: `Bearer ${groupToken}` }
    });
    assert.equal(forbiddenProbe.status, 403);

    // 2. GET /v1/providers/probe?provider=cc&refresh=1
    const probeRes = await fetch(
      `${ready.httpUrl}/v1/providers/probe?provider=cc&refresh=1`,
      { headers }
    );
    assert.equal(probeRes.status, 200);
    const probeJson = (await probeRes.json()) as PrismuxProviderProbeResponse;
    assert.equal(probeJson.ok, true);
    assert.ok(typeof probeJson.generatedAt === "string");
    assert.equal(probeJson.providers.length, 1);
    assert.equal(probeJson.providers[0]?.providerId, "claudeAgent");

    // 3. GET /v1/security/subscription-waiver defaults all locked
    const getWaiverRes = await fetch(
      `${ready.httpUrl}/v1/security/subscription-waiver`,
      { headers }
    );
    assert.equal(getWaiverRes.status, 200);
    const initialWaiver = (await getWaiverRes.json()) as SubscriptionWaiverResponse;
    assert.equal(initialWaiver.signed, false);
    assert.equal(initialWaiver.allowAntigravityAsControlledAgent, false);
    assert.equal(initialWaiver.allowExternalSubscriptionAgentsInSwarm, false);
    assert.equal(initialWaiver.defaultLocked, true);

    // 4. PUT toggle without signing -> HTTP 400 WAIVER_SIGNATURE_REQUIRED
    const unsignedPut = await fetch(
      `${ready.httpUrl}/v1/security/subscription-waiver`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({ allowExternalSubscriptionAgentsInSwarm: true })
      }
    );
    assert.equal(unsignedPut.status, 400);
    const unsignedPutJson = (await unsignedPut.json()) as { code: string };
    assert.equal(unsignedPutJson.code, "WAIVER_SIGNATURE_REQUIRED");

    // 5. POST /v1/dispatch/thread for subscription_oauth Codex in swarm -> HTTP 403 ERR_SUBSCRIPTION_ORCHESTRATION_BLOCKED
    const blockedRes = await fetch(`${ready.httpUrl}/v1/dispatch/thread`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt: "Run swarm subtask on Codex",
        workspacePath: dataDir,
        callerKind: "swarm",
        provider: "codex",
        probeSnapshot: {
          providerId: "codex",
          authMode: "subscription_oauth",
          authSource: "official_oauth",
          authLabel: AUTH_LABEL_SUBSCRIPTION_OAUTH,
          endpoint: null
        }
      })
    });
    assert.equal(blockedRes.status, 403);
    const blockedJson =
      (await blockedRes.json()) as SubscriptionOrchestrationBlockedPayload;
    assert.equal(blockedJson.ok, false);
    assert.equal(blockedJson.code, SUBSCRIPTION_ORCHESTRATION_BLOCKED_CODE);
    assert.equal(blockedJson.reasonCode, "EXTERNAL_SUBSCRIPTION_SWARM_LOCKED");
    assert.equal(blockedJson.providerId, "codex");
    assert.equal(blockedJson.authMode, "subscription_oauth");
    assert.equal(blockedJson.authLabel, AUTH_LABEL_SUBSCRIPTION_OAUTH);
    assert.equal(blockedJson.settingsRoute, SUBSCRIPTION_WAIVER_SETTINGS_ROUTE);
    assert.ok(blockedJson.message.length > 0);

    // 6. Sign waiver + enable Switch B -> swarm Codex NOW ALLOWED (HTTP 200)!
    const signPut = await fetch(
      `${ready.httpUrl}/v1/security/subscription-waiver`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({
          signed: true,
          waiverVersion: SUBSCRIPTION_WAIVER_VERSION,
          allowExternalSubscriptionAgentsInSwarm: true
        })
      }
    );
    assert.equal(signPut.status, 200);
    const signedJson = (await signPut.json()) as SubscriptionWaiverResponse;
    assert.equal(signedJson.signed, true);
    assert.equal(signedJson.allowExternalSubscriptionAgentsInSwarm, true);

    const allowedRes = await fetch(`${ready.httpUrl}/v1/dispatch/thread`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt: "Run swarm subtask on Codex after waiver",
        workspacePath: dataDir,
        callerKind: "swarm",
        provider: "codex",
        probeSnapshot: {
          providerId: "codex",
          authMode: "subscription_oauth",
          authSource: "official_oauth",
          authLabel: AUTH_LABEL_SUBSCRIPTION_OAUTH,
          endpoint: null
        }
      })
    });
    assert.equal(allowedRes.status, 200);

    // 7. DELETE /v1/security/subscription-waiver -> revokes & immediately hard-locks again!
    const deleteRes = await fetch(
      `${ready.httpUrl}/v1/security/subscription-waiver`,
      { method: "DELETE", headers }
    );
    assert.equal(deleteRes.status, 200);
    const revokedJson = (await deleteRes.json()) as SubscriptionWaiverResponse;
    assert.equal(revokedJson.signed, false);
    assert.equal(revokedJson.allowAntigravityAsControlledAgent, false);
    assert.equal(revokedJson.allowExternalSubscriptionAgentsInSwarm, false);

    const relockedRes = await fetch(`${ready.httpUrl}/v1/dispatch/thread`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt: "Run swarm subtask after revocation",
        workspacePath: dataDir,
        callerKind: "swarm",
        provider: "codex",
        probeSnapshot: {
          providerId: "codex",
          authMode: "subscription_oauth",
          authSource: "official_oauth",
          authLabel: AUTH_LABEL_SUBSCRIPTION_OAUTH,
          endpoint: null
        }
      })
    });
    assert.equal(relockedRes.status, 403);
    const relockedJson =
      (await relockedRes.json()) as SubscriptionOrchestrationBlockedPayload;
    assert.equal(relockedJson.code, SUBSCRIPTION_ORCHESTRATION_BLOCKED_CODE);
  });

  test("Daemon DSH probe resolves real installed version from Electron app.asar and overrides placeholder 0.0.1", async () => {
    const root = makeTempDir("pmx-dsh-asar-ver-");
    const appDir = join(root, "AppData", "Local", "Programs", "DSH NEXT");
    const resDir = join(appDir, "resources");
    mkdirSync(resDir, { recursive: true });
    const exePath = join(appDir, "DSH NEXT.exe");
    writeFileSync(exePath, "");
    const asarPath = join(resDir, "app.asar");

    const entries: Record<string, string> = {
      "package.json": JSON.stringify({ name: "dsh-desktop-next", version: "2.0.24-next" }),
      "node_modules/@deepseek-ai/dsh/package.json": JSON.stringify({
        name: "@deepseek-ai/dsh",
        version: "0.2.2-rc.4"
      }),
      "lib/desktop-cli.js": "export {};"
    };
    const headerTree: { files: Record<string, unknown> } = { files: {} };
    const chunks: Buffer[] = [];
    let offset = 0;
    for (const [rel, content] of Object.entries(entries)) {
      const buf = Buffer.from(content, "utf8");
      const parts = rel.split("/");
      let cursor = headerTree.files;
      for (let i = 0; i < parts.length - 1; i += 1) {
        const seg = parts[i]!;
        if (!cursor[seg] || typeof cursor[seg] !== "object") {
          cursor[seg] = { files: {} };
        }
        cursor = (cursor[seg] as { files: Record<string, unknown> }).files;
      }
      cursor[parts.at(-1)!] = { size: buf.length, offset: String(offset) };
      chunks.push(buf);
      offset += buf.length;
    }
    const jsonBytes = Buffer.from(JSON.stringify(headerTree), "utf8");
    const alignedJsonSize = Math.ceil(jsonBytes.length / 4) * 4;
    const headerSize = alignedJsonSize + 8;
    const header = Buffer.alloc(16 + alignedJsonSize);
    header.writeUInt32LE(4, 0);
    header.writeUInt32LE(headerSize, 4);
    header.writeUInt32LE(headerSize - 4, 8);
    header.writeUInt32LE(jsonBytes.length, 12);
    jsonBytes.copy(header, 16);
    writeFileSync(asarPath, Buffer.concat([header, ...chunks]));

    const fastVer = resolveDshInstalledVersionFastSync({
      binaryPath: exePath,
      platform: "win32",
      env: { LOCALAPPDATA: join(root, "AppData", "Local") },
      homeDir: root
    });
    assert.equal(fastVer, "0.2.2-rc.4");

    const probeService = new PrismuxProviderProbeService({
      homeDir: root,
      platform: "win32",
      env: { LOCALAPPDATA: join(root, "AppData", "Local") },
      refreshEnv: () => undefined,
      cliProbe: async (command) =>
        command === "dsh"
          ? { found: true, path: exePath, version: "0.0.1", latencyMs: 5 }
          : { found: false, path: null, version: null, latencyMs: 1 }
    });
    const snap = await probeService.probeProvider("dsh", { refresh: true });
    assert.equal(snap.installed, true);
    assert.equal(snap.status, "ready");
    assert.equal(snap.version, "0.2.2-rc.4");
    assert.equal(snap.authLabel, AUTH_LABEL_API_CUSTOM);
  });

  test("Daemon mirrors Windows Uninstall Registry + modern CLI bin dir discovery for DSH NEXT and Antigravity", () => {
    const root = makeTempDir("pmx-daemon-reg-discover-");
    const customDshDir = join(root, "CustomApps", "DSH NEXT");
    const customDshRes = join(customDshDir, "resources");
    mkdirSync(customDshRes, { recursive: true });
    const dshExe = join(customDshDir, "DSH NEXT.exe");
    writeFileSync(dshExe, "");

    const headerJson = Buffer.from(
      JSON.stringify({
        files: {
          lib: {
            files: {
              "desktop-cli.js": { size: 9, offset: "0" }
            }
          }
        }
      }),
      "utf8"
    );
    const alignedJsonSize = Math.ceil(headerJson.length / 4) * 4;
    const headerSize = alignedJsonSize + 8;
    const header = Buffer.alloc(16 + alignedJsonSize);
    header.writeUInt32LE(4, 0);
    header.writeUInt32LE(headerSize, 4);
    header.writeUInt32LE(headerSize - 4, 8);
    header.writeUInt32LE(headerJson.length, 12);
    headerJson.copy(header, 16);
    writeFileSync(
      join(customDshRes, "app.asar"),
      Buffer.concat([header, Buffer.from("export {};", "utf8")])
    );

    const customAgyDir = join(root, "CustomApps", "Antigravity");
    const customAgyBin = join(customAgyDir, "bin");
    mkdirSync(customAgyBin, { recursive: true });
    const agyExe = join(customAgyBin, "agy.exe");
    writeFileSync(agyExe, "");

    const regOutput = [
      "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\dsh-guid",
      "    DisplayName    REG_SZ    DSH NEXT 2.0.24-next",
      `    UninstallString    REG_SZ    "${join(customDshDir, "Uninstall DSH NEXT.exe")}" /currentuser`,
      "",
      "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\agy-guid",
      "    DisplayName    REG_SZ    Antigravity 2.35.1",
      `    InstallLocation    REG_SZ    ${customAgyDir}`,
      "",
      "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\skin-guid",
      "    DisplayName    REG_SZ    AntigravityStarSuiteSkin",
      `    InstallLocation    REG_SZ    ${root}`
    ].join("\r\n");

    const mockEnv = { USERPROFILE: root, LOCALAPPDATA: join(root, "AppData", "Local") };
    const foundDsh = findPackagedDshDesktopCli(mockEnv, "win32", root, {
      queryRegistry: () => regOutput,
      scanDriveRoots: false
    });
    assert.equal(foundDsh?.executablePath, dshExe);

    const foundAgy = findPackagedAntigravityCli(mockEnv, "win32", root, {
      queryRegistry: () => regOutput,
      scanDriveRoots: false
    });
    assert.equal(foundAgy, agyExe);

    const extraDirs = getDefaultCliExtraDirs(
      {
        USERPROFILE: root,
        LOCALAPPDATA: join(root, "AppData", "Local"),
        APPDATA: join(root, "AppData", "Roaming"),
        VOLTA_HOME: join(root, "volta"),
        NVM_SYMLINK: join(root, "nvm")
      },
      "win32",
      root
    );
    assert.ok(extraDirs.includes(join(root, ".bun", "bin")));
    assert.ok(extraDirs.includes(join(root, "scoop", "shims")));
    assert.ok(extraDirs.includes(join(root, "volta", "bin")));
    assert.ok(extraDirs.includes(join(root, "nvm")));
    assert.ok(extraDirs.includes(join(root, ".opencode", "bin")));
    assert.ok(extraDirs.includes(join(root, ".dsh", "bin")));
    assert.ok(extraDirs.includes(join(root, "AppData", "Local", "DSH NEXT", "bin")));
  });

  test("Standard FS install paths resolve agy & DSH NEXT without touching Uninstall Registry, and uninstalled CLIs skip CoreRpcClient", async () => {
    const root = makeTempDir("pmx-fast-fs-no-reg-");
    const localAppData = join(root, "AppData", "Local");
    const agyBinDir = join(localAppData, "agy", "bin");
    mkdirSync(agyBinDir, { recursive: true });
    const agyExe = join(agyBinDir, "agy.exe");
    writeFileSync(agyExe, "MZ", "utf8");

    const dshDir = join(localAppData, "Programs", "DSH NEXT");
    const dshRes = join(dshDir, "resources");
    mkdirSync(dshRes, { recursive: true });
    const dshExe = join(dshDir, "DSH NEXT.exe");
    writeFileSync(dshExe, "MZ", "utf8");
    const asarHeaderJson = Buffer.from(
      JSON.stringify({
        files: { lib: { files: { "desktop-cli.js": { size: 9, offset: "0" } } } }
      }),
      "utf8"
    );
    const aligned = Math.ceil(asarHeaderJson.length / 4) * 4;
    const hdr = Buffer.alloc(16 + aligned);
    hdr.writeUInt32LE(4, 0);
    hdr.writeUInt32LE(aligned + 8, 4);
    hdr.writeUInt32LE(aligned + 4, 8);
    hdr.writeUInt32LE(asarHeaderJson.length, 12);
    asarHeaderJson.copy(hdr, 16);
    writeFileSync(
      join(dshRes, "app.asar"),
      Buffer.concat([hdr, Buffer.from("export {};", "utf8")])
    );

    let regQueryCalls = 0;
    const mockEnv = { USERPROFILE: root, LOCALAPPDATA: localAppData, PATH: "" };
    const foundAgy = findPackagedAntigravityCli(mockEnv, "win32", root, {
      queryRegistry: () => {
        regQueryCalls += 1;
        return "";
      }
    });
    const foundDsh = findPackagedDshDesktopCli(mockEnv, "win32", root, {
      queryRegistry: () => {
        regQueryCalls += 1;
        return "";
      }
    });
    assert.equal(foundAgy, agyExe);
    assert.equal(foundDsh?.executablePath, dshExe);
    assert.equal(
      regQueryCalls,
      0,
      "standard FS paths must hit before ever spawning reg.exe Uninstall Registry queries"
    );

    // Uninstalled provider probe MUST NOT touch CoreRpcClient.listProviders()!
    let rpcCalls = 0;
    const probeService = new PrismuxProviderProbeService({
      homeDir: root,
      platform: "win32",
      env: { USERPROFILE: root, LOCALAPPDATA: localAppData, APPDATA: join(root, "AppData", "Roaming"), PATH: "" },
      refreshEnv: () => undefined,
      coreRpcClient: {
        isConnected: () => true,
        listProviders: async () => {
          rpcCalls += 1;
          return [];
        }
      } as never
    });
    const missingGemini = await probeService.probeProvider("gemini", { refresh: true });
    assert.equal(missingGemini.installed, false);
    assert.equal(missingGemini.status, "not_installed");
    assert.equal(rpcCalls, 0, "uninstalled CLI must short-circuit via pure-FS before CoreRpcClient");
  });
});
