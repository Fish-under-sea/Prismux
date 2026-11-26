import { assert, describe, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstanceConfig,
  type ServerProvider,
} from "@prismux/core-contracts";

import {
  canonicalizeProviderAlias,
  classifyDelegationTargetAuth,
  detectProviderFamily,
  evaluateDelegationSubscriptionGuard,
  isUnattendedDelegationCaller,
  parseSubscriptionWaiverJson,
  providerSearchMetadata,
  readSubscriptionWaiverState,
  resolveSubscriptionWaiverPaths,
  SUBSCRIPTION_ORCHESTRATION_BLOCKED_CODE,
  SUBSCRIPTION_WAIVER_SETTINGS_ROUTE,
  type SubscriptionWaiverState,
} from "./DelegationSubscriptionGuard.ts";

function makeProvider(input: {
  readonly instanceId: string;
  readonly driver: string;
  readonly displayName?: string;
  readonly auth?: Partial<ServerProvider["auth"]>;
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: ProviderDriverKind.make(input.driver),
    displayName: input.displayName ?? input.instanceId,
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: {
      status: "authenticated",
      ...input.auth,
    },
    checkedAt: "2026-11-26T10:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
  };
}

const SIGNED_AGY_WAIVER: SubscriptionWaiverState = {
  signed: true,
  waiverVersion: "2026-04-20-v1",
  signedAt: "2026-11-26T09:00:00.000Z",
  allowAntigravityAsControlledAgent: true,
  allowExternalSubscriptionAgentsInSwarm: false,
};

const SIGNED_EXTERNAL_WAIVER: SubscriptionWaiverState = {
  signed: true,
  waiverVersion: "2026-04-20-v1",
  signedAt: "2026-11-26T09:00:00.000Z",
  allowAntigravityAsControlledAgent: false,
  allowExternalSubscriptionAgentsInSwarm: true,
};

const INTERACTIVE_CALLER = {
  createdBy: "user",
  creationSource: "web",
} as const;

describe("DelegationSubscriptionGuard", () => {
  describe("provider alias & family canonicalization", () => {
    it("maps dsh / deepseek / claude / codex / agy / antigravity aliases cleanly", () => {
      assert.equal(canonicalizeProviderAlias("dsh"), "dsh");
      assert.equal(canonicalizeProviderAlias("deepseek"), "dsh");
      assert.equal(canonicalizeProviderAlias("deepseek-harness"), "dsh");
      assert.equal(canonicalizeProviderAlias("acp:deepseek-harness"), "dsh");
      assert.equal(canonicalizeProviderAlias("acp-deepseek-harness"), "dsh");
      assert.equal(canonicalizeProviderAlias("acp-dsh"), "dsh");
      assert.equal(canonicalizeProviderAlias("DeepSeek Harness"), "dsh");
      assert.equal(canonicalizeProviderAlias("dsh-next"), "dsh");

      assert.equal(canonicalizeProviderAlias("claude"), "claudeAgent");
      assert.equal(canonicalizeProviderAlias("cc"), "claudeAgent");
      assert.equal(canonicalizeProviderAlias("claude-code"), "claudeAgent");
      assert.equal(canonicalizeProviderAlias("acp:claude"), "claudeAgent");

      assert.equal(canonicalizeProviderAlias("codex"), "codex");
      assert.equal(canonicalizeProviderAlias("openai-codex"), "codex");

      assert.equal(canonicalizeProviderAlias("agy"), "antigravity");
      assert.equal(canonicalizeProviderAlias("antigravity"), "antigravity");
      assert.equal(canonicalizeProviderAlias("acp:antigravity"), "antigravity");
      assert.equal(canonicalizeProviderAlias("acp-antigravity"), "antigravity");
      assert.equal(canonicalizeProviderAlias("Google Antigravity"), "antigravity");

      assert.equal(canonicalizeProviderAlias("opencode"), "opencode");
      assert.equal(canonicalizeProviderAlias("pi"), "pi");
      assert.equal(canonicalizeProviderAlias("ollama"), "local");
      assert.isNull(canonicalizeProviderAlias("unknown-vendor"));
    });

    it("detects DSH on generic acpRegistry instances via config commandPath or agentId", () => {
      const provider = makeProvider({
        instanceId: "custom-acp-1",
        driver: "acpRegistry",
        displayName: "Local Harness",
      });
      const localDshConfig: ProviderInstanceConfig = {
        driver: ProviderDriverKind.make("acpRegistry"),
        config: {
          source: "local",
          commandPath: "C:\\Users\\Fish\\AppData\\Roaming\\npm\\dsh.cmd",
          commandArgs: ["acp"],
        },
      };
      assert.equal(detectProviderFamily(provider, localDshConfig), "dsh");
      const searchMeta = providerSearchMetadata(provider, localDshConfig);
      assert.include(searchMeta.aliases, "dsh");
      assert.include(searchMeta.aliases, "deepseek");
      assert.include(searchMeta.aliases, "deepseek-harness");
      assert.include(searchMeta.aliases, "acp:deepseek-harness");
      assert.deepInclude(searchMeta.phrases, ["deepseek", "harness"]);

      const nodeWrapperConfig: ProviderInstanceConfig = {
        driver: ProviderDriverKind.make("acpRegistry"),
        config: {
          source: "local",
          commandPath: "C:\\Program Files\\nodejs\\node.exe",
          commandArgs: [
            "C:\\Users\\Fish\\AppData\\Roaming\\npm\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js",
            "acp",
          ],
        },
      };
      assert.equal(detectProviderFamily(provider, nodeWrapperConfig), "dsh");
    });
  });

  describe("read-only waiver file resolution & fail-closed parsing", () => {
    it("resolves canonical config/subscription-waiver.json before legacy antigravity-policy.json paths", () => {
      const paths = resolveSubscriptionWaiverPaths({
        homeDir: "/home/tester",
        env: {},
        platform: "linux",
      });
      assert.deepEqual(paths, [
        "/home/tester/.prismux/config/subscription-waiver.json",
        "/home/tester/.prismux/config/antigravity-policy.json",
        "/home/tester/.prismux/data/antigravity-policy.json",
      ]);

      const overridden = resolveSubscriptionWaiverPaths({
        homeDir: "/home/tester",
        env: { PRISMUX_DATA_DIR: "/srv/prismux-data" },
        platform: "linux",
      });
      assert.deepEqual(overridden, [
        "/srv/prismux-data/config/subscription-waiver.json",
        "/srv/prismux-data/config/antigravity-policy.json",
        "/srv/prismux-data/data/antigravity-policy.json",
      ]);
    });

    it("parses unified waiver, legacy antigravity policy, and fails closed on missing metadata or corruption", () => {
      const unified = parseSubscriptionWaiverJson(
        JSON.stringify({
          signed: true,
          waiverVersion: "2026-04-20-v1",
          signedAt: "2026-11-26T00:00:00.000Z",
          allowAntigravityAsControlledAgent: true,
          allowExternalSubscriptionAgentsInSwarm: true,
        }),
      );
      assert.isTrue(unified.signed);
      assert.isTrue(unified.allowAntigravityAsControlledAgent);
      assert.isTrue(unified.allowExternalSubscriptionAgentsInSwarm);

      const legacy = parseSubscriptionWaiverJson(
        JSON.stringify({
          allowAntigravityAsControlledAgent: true,
          disclaimerAcceptedAt: "2026-11-26T00:00:00.000Z",
          disclaimerVersion: "v1",
        }),
      );
      assert.isTrue(legacy.signed);
      assert.isTrue(legacy.allowAntigravityAsControlledAgent);
      assert.isFalse(legacy.allowExternalSubscriptionAgentsInSwarm);

      // Unsigned or missing timestamps must always fail closed
      const unsigned = parseSubscriptionWaiverJson(
        JSON.stringify({
          signed: false,
          waiverVersion: "2026-04-20-v1",
          signedAt: "2026-11-26T00:00:00.000Z",
          allowAntigravityAsControlledAgent: true,
          allowExternalSubscriptionAgentsInSwarm: true,
        }),
      );
      assert.isFalse(unsigned.signed);
      assert.isFalse(unsigned.allowAntigravityAsControlledAgent);
      assert.isFalse(unsigned.allowExternalSubscriptionAgentsInSwarm);

      const legacyNoTimestamp = parseSubscriptionWaiverJson(
        JSON.stringify({ allowAntigravityAsControlledAgent: true }),
      );
      assert.isFalse(legacyNoTimestamp.signed);
      assert.isFalse(legacyNoTimestamp.allowAntigravityAsControlledAgent);

      const malformed = parseSubscriptionWaiverJson("{not-json");
      assert.isFalse(malformed.signed);
      assert.isFalse(malformed.allowAntigravityAsControlledAgent);
    });

    it("falls back to data/antigravity-policy.json when canonical file is absent, but stops at revoked canonical file", () => {
      const legacyOnlyFiles = new Map<string, string>([
        [
          "/state/data/antigravity-policy.json",
          JSON.stringify({
            signed: true,
            waiverVersion: "2026-04-20-v1",
            signedAt: "2026-11-26T00:00:00.000Z",
            allowAntigravityAsControlledAgent: true,
            allowExternalSubscriptionAgentsInSwarm: false,
          }),
        ],
      ]);
      const fromLegacy = readSubscriptionWaiverState({
        dataDir: "/state",
        platform: "linux",
        readTextFile: (p) => legacyOnlyFiles.get(p) ?? null,
      });
      assert.isTrue(fromLegacy.signed);
      assert.isTrue(fromLegacy.allowAntigravityAsControlledAgent);

      // Canonical file exists and is revoked -> MUST NOT fall back to stale legacy file
      const revokedFiles = new Map<string, string>([
        [
          "/state/config/subscription-waiver.json",
          JSON.stringify({
            signed: false,
            waiverVersion: null,
            signedAt: null,
            allowAntigravityAsControlledAgent: false,
            allowExternalSubscriptionAgentsInSwarm: false,
          }),
        ],
        [
          "/state/data/antigravity-policy.json",
          JSON.stringify({
            signed: true,
            waiverVersion: "2026-04-20-v1",
            signedAt: "2026-11-26T00:00:00.000Z",
            allowAntigravityAsControlledAgent: true,
            allowExternalSubscriptionAgentsInSwarm: true,
          }),
        ],
      ]);
      const revoked = readSubscriptionWaiverState({
        dataDir: "/state",
        platform: "linux",
        readTextFile: (p) => revokedFiles.get(p) ?? null,
      });
      assert.isFalse(revoked.signed);
      assert.isFalse(revoked.allowAntigravityAsControlledAgent);
      assert.isFalse(revoked.allowExternalSubscriptionAgentsInSwarm);
    });
  });

  describe("non-secret auth classification (zero false positives)", () => {
    it("classifies DSH, local runtimes, API-key, custom-endpoint, CCS/Magpie, Cloud IAM, and unknown Codex/Claude without blocking", () => {
      const readNone = () => null;
      const dsh = makeProvider({
        instanceId: "acp-deepseek-harness",
        driver: "acpRegistry",
        displayName: "DeepSeek Harness",
      });
      assert.equal(
        classifyDelegationTargetAuth({
          provider: dsh,
          config: { env: {}, homeDir: "/home/u", platform: "linux", readTextFile: readNone },
        }).authMode,
        "api_or_custom",
      );

      const codexApiKey = makeProvider({
        instanceId: "codex",
        driver: "codex",
        auth: { status: "authenticated", type: "apiKey" },
      });
      assert.equal(
        classifyDelegationTargetAuth({
          provider: codexApiKey,
          config: { env: {}, homeDir: "/home/u", platform: "linux", readTextFile: readNone },
        }).authMode,
        "api_or_custom",
      );

      // Codex with custom provider / requires_openai_auth = false in config.toml (CCS/Magpie/third-party relay)
      const codexCustomToml = makeProvider({
        instanceId: "codex",
        driver: "codex",
        auth: { status: "authenticated", type: "chatgpt" },
      });
      const tomlMap = new Map<string, string>([
        [
          "/home/u/.codex/config.toml",
          [
            'model_provider = "magpie_relay"',
            "[model_providers.magpie_relay]",
            'base_url = "https://relay.example.com/v1"',
            "requires_openai_auth = false",
          ].join("\n"),
        ],
      ]);
      assert.equal(
        classifyDelegationTargetAuth({
          provider: codexCustomToml,
          config: {
            env: {},
            homeDir: "/home/u",
            platform: "linux",
            readTextFile: (p) => tomlMap.get(p) ?? null,
          },
        }).authMode,
        "api_or_custom",
      );

      // Claude with Bedrock / CCS / custom ANTHROPIC_BASE_URL in settings.json -> api_or_custom
      const claudeCustom = makeProvider({
        instanceId: "claudeAgent",
        driver: "claudeAgent",
        auth: { status: "authenticated", subscriptionType: "pro" },
      });
      const claudeSettingsMap = new Map<string, string>([
        [
          "/home/u/.claude/settings.json",
          JSON.stringify({
            env: {
              ANTHROPIC_BASE_URL: "https://ccs.internal.example/anthropic",
              ANTHROPIC_AUTH_TOKEN: "placeholder-nonsecret-test",
            },
          }),
        ],
      ]);
      assert.equal(
        classifyDelegationTargetAuth({
          provider: claudeCustom,
          config: {
            env: {},
            homeDir: "/home/u",
            platform: "linux",
            readTextFile: (p) => claudeSettingsMap.get(p) ?? null,
          },
        }).authMode,
        "api_or_custom",
      );

      // Claude with unknown auth status -> "unknown" (never misclassified as subscription_oauth)
      const claudeUnknown = makeProvider({
        instanceId: "claudeAgent",
        driver: "claudeAgent",
        auth: { status: "authenticated" },
      });
      assert.equal(
        classifyDelegationTargetAuth({
          provider: claudeUnknown,
          config: { env: {}, homeDir: "/home/u", platform: "linux", readTextFile: readNone },
        }).authMode,
        "unknown",
      );
    });

    it("detects personal OAuth Codex/Claude and personal Antigravity accurately", () => {
      const readNone = () => null;
      const baseCfg = {
        env: {},
        homeDir: "/home/u",
        platform: "linux" as const,
        readTextFile: readNone,
      };

      const codexOauth = makeProvider({
        instanceId: "codex",
        driver: "codex",
        auth: { status: "authenticated", type: "chatgpt", subscriptionType: "plus" },
      });
      assert.equal(
        classifyDelegationTargetAuth({ provider: codexOauth, config: baseCfg }).authMode,
        "subscription_oauth",
      );

      const claudeOauth = makeProvider({
        instanceId: "claudeAgent",
        driver: "claudeAgent",
        auth: { status: "authenticated", type: "oauth", subscriptionType: "max" },
      });
      assert.equal(
        classifyDelegationTargetAuth({ provider: claudeOauth, config: baseCfg }).authMode,
        "subscription_oauth",
      );

      const personalAgy = makeProvider({
        instanceId: "antigravity",
        driver: "antigravity",
        auth: { status: "authenticated" },
      });
      const agyClass = classifyDelegationTargetAuth({ provider: personalAgy, config: baseCfg });
      assert.equal(agyClass.authMode, "subscription_oauth");
      assert.isTrue(agyClass.targetIsAntigravity);

      const vertexAgy = makeProvider({
        instanceId: "antigravity",
        driver: "antigravity",
        auth: { status: "authenticated", type: "vertex" },
      });
      assert.equal(
        classifyDelegationTargetAuth({ provider: vertexAgy, config: baseCfg }).authMode,
        "api_or_custom",
      );
    });
  });

  describe("policy matrix enforcement", () => {
    const readNone = () => null;

    it("Direction A: allows DSH, API Codex, and API Claude directly with zero waiver", () => {
      for (const provider of [
        makeProvider({
          instanceId: "acp-deepseek-harness",
          driver: "acpRegistry",
          displayName: "DeepSeek Harness",
        }),
        makeProvider({
          instanceId: "codex",
          driver: "codex",
          auth: { status: "authenticated", type: "apiKey" },
        }),
        makeProvider({
          instanceId: "claudeAgent",
          driver: "claudeAgent",
          auth: { status: "authenticated", type: "apiKey" },
        }),
      ]) {
        const decision = evaluateDelegationSubscriptionGuard({
          provider,
          caller: INTERACTIVE_CALLER,
          config: { env: {}, homeDir: "/home/u", platform: "linux", readTextFile: readNone },
        });
        assert.isTrue(decision.allowed);
        assert.equal(decision.dispatchPolicy, "direct");
      }
    });

    it("Direction B: blocks personal AGY by default, unlocks only with signed waiver + allowAntigravityAsControlledAgent, and permanently hard-blocks unattended callers", () => {
      const agy = makeProvider({
        instanceId: "antigravity",
        driver: "antigravity",
        displayName: "Antigravity",
      });

      // Default (unsigned) -> blocked with AGY_CONTROLLED_AGENT_LOCKED
      const defaultDecision = evaluateDelegationSubscriptionGuard({
        provider: agy,
        caller: INTERACTIVE_CALLER,
        config: { env: {}, homeDir: "/home/u", platform: "linux", readTextFile: readNone },
      });
      assert.isFalse(defaultDecision.allowed);
      if (!defaultDecision.allowed) {
        assert.equal(defaultDecision.code, SUBSCRIPTION_ORCHESTRATION_BLOCKED_CODE);
        assert.equal(defaultDecision.reasonCode, "AGY_CONTROLLED_AGENT_LOCKED");
        assert.equal(defaultDecision.settingsRoute, SUBSCRIPTION_WAIVER_SETTINGS_ROUTE);
        assert.equal(defaultDecision.dispatchPolicy, "waiver_required");
      }

      // Signed waiver WITHOUT controlled-agent toggle -> still blocked
      const toggleOff = evaluateDelegationSubscriptionGuard({
        provider: agy,
        caller: INTERACTIVE_CALLER,
        config: {
          env: {},
          homeDir: "/home/u",
          platform: "linux",
          readTextFile: readNone,
          waiverOverride: SIGNED_EXTERNAL_WAIVER,
        },
      });
      assert.isFalse(toggleOff.allowed);

      // Signed waiver WITH allowAntigravityAsControlledAgent -> interactive allowed
      const unlocked = evaluateDelegationSubscriptionGuard({
        provider: agy,
        caller: INTERACTIVE_CALLER,
        config: {
          env: {},
          homeDir: "/home/u",
          platform: "linux",
          readTextFile: readNone,
          waiverOverride: SIGNED_AGY_WAIVER,
        },
      });
      assert.isTrue(unlocked.allowed);
      assert.equal(unlocked.dispatchPolicy, "direct");

      // Unattended callers -> PERMANENTLY HARD-BLOCKED even when waiver is signed!
      const unattendedCallers = [
        { scheduledTaskId: "sched-1" },
        { userMessageId: "scheduled-task-message:123" },
        { createdBy: "system", creationSource: "server" },
        { threadTags: ["overnight_factory"] },
        { threadTags: ["cron"] },
        { requestNamespace: "overnight-factory:worker" },
      ];
      for (const caller of unattendedCallers) {
        assert.isTrue(isUnattendedDelegationCaller(caller));
        const decision = evaluateDelegationSubscriptionGuard({
          provider: agy,
          caller,
          config: {
            env: {},
            homeDir: "/home/u",
            platform: "linux",
            readTextFile: readNone,
            waiverOverride: SIGNED_AGY_WAIVER,
          },
        });
        assert.isFalse(decision.allowed);
        if (!decision.allowed) {
          assert.equal(decision.code, SUBSCRIPTION_ORCHESTRATION_BLOCKED_CODE);
          assert.equal(decision.reasonCode, "AGY_UNATTENDED_FORBIDDEN");
          assert.equal(decision.dispatchPolicy, "blocked");
        }
      }
    });

    it("gates external subscription_oauth (personal OAuth Codex/Claude) behind unified waiver", () => {
      const codexOauth = makeProvider({
        instanceId: "codex",
        driver: "codex",
        auth: { status: "authenticated", type: "chatgpt", subscriptionType: "pro" },
      });

      const blocked = evaluateDelegationSubscriptionGuard({
        provider: codexOauth,
        caller: INTERACTIVE_CALLER,
        config: { env: {}, homeDir: "/home/u", platform: "linux", readTextFile: readNone },
      });
      assert.isFalse(blocked.allowed);
      if (!blocked.allowed) {
        assert.equal(blocked.code, SUBSCRIPTION_ORCHESTRATION_BLOCKED_CODE);
        assert.equal(blocked.reasonCode, "EXTERNAL_SUBSCRIPTION_SWARM_LOCKED");
        assert.equal(blocked.settingsRoute, SUBSCRIPTION_WAIVER_SETTINGS_ROUTE);
        assert.equal(blocked.dispatchPolicy, "waiver_required");
      }

      const stillBlockedWhenOnlyAgyEnabled = evaluateDelegationSubscriptionGuard({
        provider: codexOauth,
        caller: INTERACTIVE_CALLER,
        config: {
          env: {},
          homeDir: "/home/u",
          platform: "linux",
          readTextFile: readNone,
          waiverOverride: SIGNED_AGY_WAIVER,
        },
      });
      assert.isFalse(stillBlockedWhenOnlyAgyEnabled.allowed);

      const allowed = evaluateDelegationSubscriptionGuard({
        provider: codexOauth,
        caller: INTERACTIVE_CALLER,
        config: {
          env: {},
          homeDir: "/home/u",
          platform: "linux",
          readTextFile: readNone,
          waiverOverride: SIGNED_EXTERNAL_WAIVER,
        },
      });
      assert.isTrue(allowed.allowed);
      assert.equal(allowed.dispatchPolicy, "direct");
    });
  });
});
