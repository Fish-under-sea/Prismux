// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { AntigravitySettings, ANTIGRAVITY_AUTH_METHODS } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

const PROVIDER_DIR = import.meta.dirname;
const SERVER_SRC_DIR = NodePath.resolve(PROVIDER_DIR, "..");
const T3CODE_ROOT = NodePath.resolve(SERVER_SRC_DIR, "..", "..", "..");
const PRISMUX_REPO_ROOT = NodePath.resolve(T3CODE_ROOT, "..", "..");
const PRISMUX_DAEMON_SRC_DIR = NodePath.join(PRISMUX_REPO_ROOT, "apps", "daemon", "src");
const AGY_CONTROLLED_LOCK_SECTION_PATH = NodePath.join(
  T3CODE_ROOT,
  "apps",
  "web",
  "src",
  "prismux",
  "AntigravityControlledLockSection.tsx",
);
const IPC_DISPATCH_BRIDGE_PATH = NodePath.join(
  T3CODE_ROOT,
  "apps",
  "web",
  "src",
  "prismux",
  "PrismuxIpcDispatchBridge.tsx",
);

function collectMatchingSourceFiles(
  rootDir: string,
  predicate: (relPosixPath: string) => boolean,
): string[] {
  const results: string[] = [];
  const visit = (dir: string): void => {
    if (!NodeFS.existsSync(dir)) return;
    for (const entry of NodeFS.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = NodePath.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = NodePath.relative(rootDir, fullPath).replaceAll("\\", "/");
      if (predicate(rel)) {
        results.push(fullPath);
      }
    }
  };
  visit(rootDir);
  return results.sort();
}

const ANTIGRAVITY_SERVER_SOURCES = collectMatchingSourceFiles(
  SERVER_SRC_DIR,
  (rel) =>
    /antigravity/iu.test(rel) &&
    /\.(?:ts|tsx|mjs|cjs|js)$/iu.test(rel) &&
    !/\.test(?:kit)?\./iu.test(rel),
);

const ANTIGRAVITY_UI_SOURCES = [
  "apps/web/src/components/settings/AddProviderInstanceDialog.tsx",
  "apps/web/src/components/settings/ProviderAuthenticationSection.tsx",
  "apps/web/src/components/settings/ProviderSettingsForm.tsx",
  "apps/web/src/components/settings/ProviderSettingsPanel.tsx",
  "apps/web/src/components/settings/ProviderSetupSection.tsx",
  "apps/web/src/components/settings/providerStatus.ts",
  "apps/web/src/components/chat/ProviderStatusBanner.tsx",
  "apps/web/src/components/onboarding/WelcomePage.tsx",
  "apps/mobile/src/features/settings/SettingsProviderAccountsRouteScreen.tsx",
].map((rel) => NodePath.join(T3CODE_ROOT, rel));

const FORBIDDEN_PATTERNS: ReadonlyArray<{ readonly label: string; readonly regex: RegExp }> = [
  { label: "cloudcode-pa private endpoint", regex: /cloudcode-pa/iu },
  { label: "v1internal private endpoint", regex: /v1internal/iu },
  { label: "loadCodeAssist private RPC", regex: /loadCodeAssist/iu },
  { label: "codeassist private API", regex: /codeassist/iu },
  { label: "antigravityCallback loopback OAuth", regex: /antigravityCallback/iu },
  { label: "state.vscdb token scraper", regex: /state\.vscdb/iu },
  { label: "acp_token.json private token file", regex: /acp_token\.json/iu },
  { label: "Google browser OAuth URL", regex: /accounts\.google\.com\/o\/oauth2/iu },
  { label: "Google OAuth token endpoint", regex: /oauth2\.googleapis\.com/iu },
  { label: "Google OAuth client domain", regex: /googleusercontent\.com/iu },
  { label: "OAuth PKCE / client secret", regex: /\b(?:code_challenge|client_secret|pkce)\b/iu },
  {
    label: "non-compliant AGY auth method",
    regex: /\b(?:oauth-personal|oauth-business|gemini-api-key|agent-platform)\b/u,
  },
  {
    label: "AGY_ACP_FORCE_FILE_STORAGE=1 override",
    regex: /AGY_ACP_FORCE_FILE_STORAGE\s*[:=]\s*["']1["']/u,
  },
  { label: "SSH_CONNECTION spoofing", regex: /\bSSH_CONNECTION\s*[:=]/u },
  { label: "BROWSER helper spoofing", regex: /\bBROWSER\s*:/u },
  { label: "Zed client spoofing", regex: /name\s*:\s*["']zed["']/iu },
  { label: "eager in-app ACP authenticate", regex: /authenticateEagerly\s*:\s*true/u },
  { label: "in-app ACP auth-on-required", regex: /authenticateOnAuthRequired\s*:\s*true/u },
];

const FORBIDDEN_PROXY_AND_ROTATION_PATTERNS: ReadonlyArray<{
  readonly label: string;
  readonly regex: RegExp;
}> = [
  {
    label: "Antigravity reverse-proxy forwarding",
    regex:
      /(?:antigravity|agy)[^\n]{0,100}(?:reverse[-_\s]?proxy|proxy[-_\s]?forward|forward[-_\s]?proxy|openai[-_\s]?compat(?:ible)?[-_\s]?proxy|\/v1\/chat\/completions)/iu,
  },
  {
    label: "reverse-proxy forwarding targeting Antigravity",
    regex:
      /(?:reverse[-_\s]?proxy|proxy[-_\s]?forward|forward[-_\s]?proxy)[^\n]{0,100}(?:antigravity|agy)/iu,
  },
  {
    label: "Antigravity multi-account auto-rotation / credential pooling",
    regex:
      /(?:antigravity|agy)[^\n]{0,100}(?:multi[-_\s]?account[-_\s]?rotat|account[-_\s]?rotat|auto[-_\s]?rotate[-_\s]?account|token[-_\s]?pool|credential[-_\s]?pool|round[-_\s]?robin[-_\s]?account|nextAvailableAccount|rotateAntigravityAccount|rotateAgyAccount)/iu,
  },
  {
    label: "multi-account auto-rotation targeting Antigravity",
    regex:
      /(?:multi[-_\s]?account[-_\s]?rotat|account[-_\s]?rotat|auto[-_\s]?rotate[-_\s]?account|token[-_\s]?pool|credential[-_\s]?pool|round[-_\s]?robin[-_\s]?account|nextAvailableAccount|rotateAntigravityAccount|rotateAgyAccount)[^\n]{0,100}(?:antigravity|agy)/iu,
  },
];

const ANTIGRAVITY_DEDICATED_PROXY_OR_ROTATION_PATTERNS: ReadonlyArray<{
  readonly label: string;
  readonly regex: RegExp;
}> = [
  { label: "HTTP reverse proxy middleware", regex: /\b(?:createProxyServer|http-proxy-middleware)\b/iu },
  {
    label: "dedicated account rotation / credential pool helper",
    regex: /\b(?:rotateAccount|rotateAntigravityAccount|rotateAgyAccount|accountPool|credentialPool|tokenPool|roundRobinAccount|proxyForward|reverseProxy)\b/iu,
  },
];

describe("Antigravity (agy) ban-proof compliance static guard", () => {
  it("permanently deletes antigravityCallback loopback handler files", () => {
    expect(NodeFS.existsSync(NodePath.join(PROVIDER_DIR, "antigravityCallback.ts"))).toBe(false);
    expect(NodeFS.existsSync(NodePath.join(PROVIDER_DIR, "antigravityCallback.test.ts"))).toBe(
      false,
    );
  });

  it("restricts AntigravitySettings strictly to official local-cli and coerces legacy values", () => {
    expect(ANTIGRAVITY_AUTH_METHODS).toEqual([{ value: "local-cli", label: "Local agy CLI" }]);
    const decode = Schema.decodeUnknownSync(AntigravitySettings);
    expect(decode({}).authMethod).toBe("local-cli");
    for (const legacy of [
      "local-cli",
      "oauth-personal",
      "oauth-business",
      "gemini-api-key",
      "agent-platform",
    ]) {
      expect(decode({ authMethod: legacy }).authMethod).toBe("local-cli");
    }
  });

  it("scans every Antigravity server source file and asserts zero forbidden endpoints, OAuth flows, token scrapers, or spoofed headers", () => {
    expect(ANTIGRAVITY_SERVER_SOURCES.length).toBeGreaterThanOrEqual(10);
    const violations: string[] = [];

    for (const filePath of ANTIGRAVITY_SERVER_SOURCES) {
      const rel = NodePath.relative(T3CODE_ROOT, filePath).replaceAll("\\", "/");
      const contents = NodeFS.readFileSync(filePath, "utf8");
      for (const { label, regex } of FORBIDDEN_PATTERNS) {
        if (regex.test(contents)) {
          violations.push(`${rel}: matched forbidden ${label} (${regex})`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("scans every Antigravity UI settings/auth surface and asserts zero non-compliant OAuth or API-key login flows", () => {
    const violations: string[] = [];
    const uiForbidden = FORBIDDEN_PATTERNS.filter(
      (rule) => rule.label !== "OAuth PKCE / client secret",
    );

    for (const filePath of ANTIGRAVITY_UI_SOURCES) {
      expect(NodeFS.existsSync(filePath), filePath).toBe(true);
      const rel = NodePath.relative(T3CODE_ROOT, filePath).replaceAll("\\", "/");
      const contents = NodeFS.readFileSync(filePath, "utf8");
      for (const { label, regex } of uiForbidden) {
        if (regex.test(contents)) {
          violations.push(`${rel}: matched forbidden ${label} (${regex})`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("scans server and daemon sources and asserts zero Antigravity reverse-proxy forwarding or multi-account auto-rotation logic", () => {
    const serverFiles = collectMatchingSourceFiles(
      SERVER_SRC_DIR,
      (rel) => /\.(?:ts|tsx|mjs|cjs|js)$/iu.test(rel) && !/\.test(?:kit)?\./iu.test(rel),
    );
    const daemonFiles = collectMatchingSourceFiles(
      PRISMUX_DAEMON_SRC_DIR,
      (rel) => /\.(?:ts|tsx|mjs|cjs|js)$/iu.test(rel) && !/\.test(?:kit)?\./iu.test(rel),
    );
    expect(serverFiles.length).toBeGreaterThan(0);
    expect(daemonFiles.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const filePath of [...serverFiles, ...daemonFiles]) {
      const rel = NodePath.relative(PRISMUX_REPO_ROOT, filePath).replaceAll("\\", "/");
      const contents = NodeFS.readFileSync(filePath, "utf8");
      for (const { label, regex } of FORBIDDEN_PROXY_AND_ROTATION_PATTERNS) {
        if (regex.test(contents)) {
          violations.push(`${rel}: matched forbidden ${label} (${regex})`);
        }
      }
      if (/antigravity/iu.test(rel)) {
        for (const { label, regex } of ANTIGRAVITY_DEDICATED_PROXY_OR_ROTATION_PATTERNS) {
          if (regex.test(contents)) {
            violations.push(`${rel}: matched forbidden ${label} (${regex})`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("verifies AntigravityControlledLockSection.tsx defaults locked and enforces mandatory disclaimer acceptance", () => {
    expect(NodeFS.existsSync(AGY_CONTROLLED_LOCK_SECTION_PATH)).toBe(true);
    const contents = NodeFS.readFileSync(AGY_CONTROLLED_LOCK_SECTION_PATH, "utf8");

    expect(contents).toContain("ANTIGRAVITY_CONTROLLED_DEFAULT_LOCKED = true");
    expect(contents).toContain("ANTIGRAVITY_CONTROLLED_DEFAULT_ENABLED = false");
    expect(contents).toContain("默认锁定（仅总控）");
    expect(contents).toContain("已签署免责解锁");
    expect(contents).toContain("403");
    expect(contents).toContain("封号");
    expect(contents).toContain("企业版");
    expect(contents).toContain("API Key");
    expect(contents).toContain("后果自负");
    expect(contents).toContain('type="checkbox"');
    expect(contents).toContain("disabled={!disclaimerChecked || saving}");
    expect(contents).toContain("/v1/security/antigravity-policy");
    expect(contents).toContain("disclaimerAccepted: true");
    expect(contents).toContain("v3-2026");

    // Ensure every payload setting allowAntigravityAsControlledAgent: true also sets disclaimerAccepted: true.
    const enablePayloads = [
      ...contents.matchAll(/allowAntigravityAsControlledAgent\s*:\s*true[\s\S]{0,180}/gu),
    ];
    expect(enablePayloads.length).toBeGreaterThan(0);
    for (const match of enablePayloads) {
      expect(match[0]).toContain("disclaimerAccepted: true");
    }

    // Also verify PrismuxIpcDispatchBridge enforces human confirmation gating for draft_only / remote AGY.
    expect(NodeFS.existsSync(IPC_DISPATCH_BRIDGE_PATH)).toBe(true);
    const bridgeContents = NodeFS.readFileSync(IPC_DISPATCH_BRIDGE_PATH, "utf8");
    expect(bridgeContents).toContain("shouldAutoSendDispatch");
    expect(bridgeContents).toContain("requiresHumanConfirmation");
    expect(bridgeContents).toContain("远程请求调用个人版 Antigravity（AGY）——已就位至草稿标签页，等待本人二次确认放行");
  });
});
