import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  ChiefThreadManager,
  CliUpdateError,
  CliUpdateService,
  DaemonRpcServer,
  PairingManager,
  PersistentPtyPool,
  compareSemver,
  detectClaudeInstallMethod,
  extractSemverFromOutput,
  isNewerVersion,
  normalizeCliProviderId,
  parseSemver,
  sanitizeUpdateErrorMessage,
  type CliCommandExecResult,
  type CliProbeResult
} from "../index.js";

async function startMockNpmRegistry(
  versions: Record<string, string>,
  options: { failPrimary?: boolean } = {}
): Promise<{
  server: Server;
  baseUrl: string;
  requests: string[];
  close: () => Promise<void>;
}> {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    const reqUrl = req.url ?? "/";
    requests.push(reqUrl);
    if (options.failPrimary) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "registry unavailable" }));
      return;
    }

    // Match `/@scope/pkg/latest` or `/pkg/latest`
    const latestMatch = /^\/(.+)\/latest$/.exec(reqUrl);
    if (latestMatch?.[1]) {
      const pkg = decodeURIComponent(latestMatch[1]);
      const ver = versions[pkg];
      if (ver) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ name: pkg, version: ver }));
        return;
      }
    }

    // Match full packument fallback `/pkg` or `/@scope%2Fpkg`
    const pkg = decodeURIComponent(reqUrl.replace(/^\//, ""));
    const ver = versions[pkg];
    if (ver) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ name: pkg, "dist-tags": { latest: ver } }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${addr.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      })
  };
}

describe("CliUpdateService — SemVer extraction, strict comparison & provider detection", () => {
  it("extracts clean SemVer from diverse CLI --version outputs", () => {
    assert.equal(extractSemverFromOutput("0.171.0"), "0.171.0");
    assert.equal(extractSemverFromOutput("v0.172.0"), "0.172.0");
    assert.equal(extractSemverFromOutput("codex-cli 0.171.0"), "0.171.0");
    assert.equal(extractSemverFromOutput("2.1.331 (Claude Code)"), "2.1.331");
    assert.equal(
      extractSemverFromOutput("@openai/codex/0.172.0 win32-x64 node-v24.14.0"),
      "0.172.0"
    );
    assert.equal(extractSemverFromOutput("v1.2.3-beta.4+build.77"), "1.2.3-beta.4");
    assert.equal(extractSemverFromOutput("not a version"), null);
    assert.equal(extractSemverFromOutput(""), null);
    assert.equal(extractSemverFromOutput(null), null);
  });

  it("performs strict SemVer 2.0.0 comparisons including v-prefixes and prereleases", () => {
    assert.equal(compareSemver("0.172.0", "0.171.0"), 1);
    assert.equal(compareSemver("v0.172.0", "0.172.0"), 0);
    assert.equal(compareSemver("0.171.0", "0.172.0"), -1);
    assert.equal(compareSemver("0.10.0", "0.9.9"), 1);
    assert.equal(compareSemver("2.1.332", "2.1.331 (Claude Code)"), 1);

    // Prerelease ordering per SemVer 2.0.0 §11
    assert.equal(compareSemver("1.0.0", "1.0.0-rc.1"), 1);
    assert.equal(compareSemver("1.0.0-beta.11", "1.0.0-beta.2"), 1);
    assert.equal(compareSemver("1.0.0-beta", "1.0.0-alpha.1"), 1);
    assert.equal(compareSemver("1.0.0-alpha.beta", "1.0.0-alpha.1"), 1);
    assert.equal(parseSemver("v0.173.0+sha.123")?.normalized, "0.173.0");

    // isNewerVersion is strictly true only when latest > current
    assert.equal(isNewerVersion("0.173.0", "0.172.0"), true);
    assert.equal(isNewerVersion("v0.172.0", "0.172.0"), false);
    assert.equal(isNewerVersion("0.171.0", "0.172.0"), false);
    assert.equal(isNewerVersion("1.0.0-beta.1", "1.0.0"), false);
    assert.equal(isNewerVersion("1.0.0", "1.0.0-beta.1"), true);
    assert.equal(isNewerVersion(null, "0.172.0"), false);
  });

  it("normalizes all provider aliases and UUID instance IDs cleanly", () => {
    assert.equal(normalizeCliProviderId("codex"), "codex");
    assert.equal(
      normalizeCliProviderId("codex_048c43c3-0798-480e-bc42-1a2b3c4d5e6f"),
      "codex"
    );
    assert.equal(normalizeCliProviderId("claudeAgent"), "claude");
    assert.equal(normalizeCliProviderId("claude-code"), "claude");
    assert.equal(normalizeCliProviderId("gemini-cli"), "gemini");
    assert.equal(normalizeCliProviderId("opencode"), "opencode");
    assert.equal(normalizeCliProviderId("omp"), null);
    assert.equal(normalizeCliProviderId("oh-my-pi"), null);
    assert.equal(normalizeCliProviderId("pi"), null);
    assert.equal(normalizeCliProviderId("agy"), "antigravity");
    assert.equal(normalizeCliProviderId("antigravity"), "antigravity");
    assert.equal(normalizeCliProviderId("unknown-acp-agent"), null);
  });

  it("intelligently detects Claude native vs npm/pnpm global installs", () => {
    assert.equal(
      detectClaudeInstallMethod("C:\\Users\\Fish\\.local\\bin\\claude.exe", {
        platform: "win32"
      }),
      "native-self-update"
    );
    assert.equal(
      detectClaudeInstallMethod("/home/user/.local/bin/claude", {
        platform: "linux"
      }),
      "native-self-update"
    );
    assert.equal(
      detectClaudeInstallMethod("C:\\Users\\Fish\\AppData\\Roaming\\npm\\claude.cmd", {
        platform: "win32"
      }),
      "npm-global"
    );
    assert.equal(
      detectClaudeInstallMethod("C:\\Users\\Fish\\AppData\\Local\\pnpm\\claude.cmd", {
        platform: "win32"
      }),
      "npm-global"
    );
  });

  it("sanitizes secrets and noisy traces out of update errors", () => {
    const cleaned = sanitizeUpdateErrorMessage(
      "npm notice New minor version of npm available!\n" +
        "npm error Authorization: Bearer super-secret-token-12345\n" +
        "npm error request to https://user:topsecret@registry.npmjs.org/@openai/codex failed, reason: ETIMEDOUT"
    );
    assert.ok(!cleaned.includes("super-secret-token-12345"));
    assert.ok(!cleaned.includes("topsecret"));
    assert.ok(cleaned.includes("[REDACTED]"));
    assert.ok(cleaned.includes("ETIMEDOUT"));
  });
});

describe("CliUpdateService & DaemonRpcServer — Mock npm Registry E2E check & auto-install", () => {
  it("checks updates against mock npm registry with 15-min cache, mirror policy, and executes real in-place updates via HTTP routes", async () => {
    const primaryMock = await startMockNpmRegistry({
      "@openai/codex": "0.173.0",
      "@anthropic-ai/claude-code": "2.1.335",
      "@google/gemini-cli": "0.5.0",
      "opencode-ai": "0.2.0"
    });
    const mirrorMock = await startMockNpmRegistry({
      "@openai/codex": "0.173.0",
      "@anthropic-ai/claude-code": "2.1.335"
    });

    const dataDir = mkdtempSync(join(tmpdir(), "prismux-cli-update-e2e-"));
    let codexVersion = "codex-cli 0.172.0";
    let claudeVersion = "2.1.331 (Claude Code)";
    let clockNow = 1_700_000_000_000;
    let envRefreshCount = 0;
    let diagnosticsClearedCount = 0;
    const executedCommands: Array<{ exe: string; args: readonly string[] }> = [];

    let rpcServer: DaemonRpcServer | undefined;
    try {
      const cliProbe = async (command: string): Promise<CliProbeResult> => {
        if (command === "codex") {
          return {
            found: true,
            path: "C:\\Users\\Fish\\AppData\\Roaming\\npm\\codex.cmd",
            version: codexVersion,
            latencyMs: 5
          };
        }
        if (command === "claude") {
          return {
            found: true,
            path: "C:\\Users\\Fish\\.local\\bin\\claude.exe",
            version: claudeVersion,
            latencyMs: 5
          };
        }
        if (command === "agy") {
          return {
            found: true,
            path: "C:\\Users\\Fish\\AppData\\Local\\agy\\bin\\agy.exe",
            version: "1.4.2",
            latencyMs: 5
          };
        }
        return { found: false, path: null, version: null, latencyMs: 2 };
      };

      const execCommand = async (
        exe: string,
        args: readonly string[]
      ): Promise<CliCommandExecResult> => {
        executedCommands.push({ exe, args });
        if (exe.toLowerCase().includes("npm") && args.includes("@openai/codex@latest")) {
          codexVersion = "codex-cli 0.173.0";
          return { exitCode: 0, stdout: "changed 1 package in 2s", stderr: "" };
        }
        if (exe.toLowerCase().includes("claude") && args[0] === "update") {
          claudeVersion = "2.1.335 (Claude Code)";
          return { exitCode: 0, stdout: "Updated Claude Code to 2.1.335", stderr: "" };
        }
        return { exitCode: 1, stdout: "", stderr: "unexpected command" };
      };

      const service = new CliUpdateService({
        appUpdater: {
          getPolicy: () => ({
            routePreference: "auto",
            includePrerelease: false,
            customGhProxyPrefix: "",
            pluginRegistryOverride: "npmmirror",
            timeoutMs: 10_000,
            autoCheckEnabled: true
          })
        },
        npmRegistryUrl: primaryMock.baseUrl,
        npmMirrorRegistryUrl: mirrorMock.baseUrl,
        platform: "win32",
        now: () => clockNow,
        cliProbe,
        execCommand,
        findExecutable: (names) =>
          names.includes("npm") ? "C:\\Program Files\\nodejs\\npm.cmd" : null,
        refreshEnv: () => {
          envRefreshCount += 1;
        },
        onAfterUpdate: () => {
          diagnosticsClearedCount += 1;
        }
      });

      const pairing = new PairingManager({ initialAuthToken: "test-token-cli-update" });
      const ptyPool = new PersistentPtyPool();
      const chiefManager = new ChiefThreadManager({ dataDir });
      await chiefManager.init();

      rpcServer = new DaemonRpcServer({
        headless: true,
        ptyPool,
        chiefManager,
        pairingManager: pairing,
        cliUpdateService: service
      });
      await rpcServer.start();
      const baseUrl = rpcServer.getHttpUrl();
      const authHeaders = { Authorization: "Bearer test-token-cli-update" };

      // 1. Check codex via HTTP route — should hit mirror first (per pluginRegistryOverride="npmmirror")
      const check1 = await fetch(`${baseUrl}/v1/cli-updates/check?provider=codex`, {
        headers: authHeaders
      });
      assert.equal(check1.status, 200);
      const body1 = (await check1.json()) as {
        ok: boolean;
        cached: boolean;
        item: {
          currentVersion: string;
          latestVersion: string;
          hasUpdate: boolean;
          updateSupported: boolean;
          registryUsed: string;
        };
      };
      assert.equal(body1.ok, true);
      assert.equal(body1.cached, false);
      assert.equal(body1.item.currentVersion, "0.172.0");
      assert.equal(body1.item.latestVersion, "0.173.0");
      assert.equal(body1.item.hasUpdate, true);
      assert.equal(body1.item.updateSupported, true);
      assert.equal(body1.item.registryUsed, mirrorMock.baseUrl);
      assert.equal(mirrorMock.requests.length, 1);

      // 2. Second check within 15 minutes hits cache without another HTTP request
      clockNow += 60_000;
      const check2 = await fetch(`${baseUrl}/v1/cli-updates/check?provider=codex`, {
        headers: authHeaders
      });
      const body2 = (await check2.json()) as { cached: boolean };
      assert.equal(body2.cached, true);
      assert.equal(mirrorMock.requests.length, 1);

      // 3. ?force=1 bypasses cache and refreshes env
      const checkForce = await fetch(
        `${baseUrl}/v1/cli-updates/check?provider=codex&force=1`,
        { headers: authHeaders }
      );
      const bodyForce = (await checkForce.json()) as { cached: boolean };
      assert.equal(bodyForce.cached, false);
      assert.equal(mirrorMock.requests.length, 2);
      assert.ok(envRefreshCount >= 1);

      // 4. Antigravity (agy) gracefully reports updateSupported: false with zero errors
      const checkAgy = await fetch(`${baseUrl}/v1/cli-updates/check?provider=antigravity`, {
        headers: authHeaders
      });
      const bodyAgy = (await checkAgy.json()) as {
        item: {
          currentVersion: string;
          hasUpdate: boolean;
          updateSupported: boolean;
          latestVersion: string | null;
        };
      };
      assert.equal(bodyAgy.item.currentVersion, "1.4.2");
      assert.equal(bodyAgy.item.hasUpdate, false);
      assert.equal(bodyAgy.item.updateSupported, false);
      assert.equal(bodyAgy.item.latestVersion, null);

      // 5. POST /v1/cli-updates/install for codex -> runs npm install -g @openai/codex@latest --registry=<mirror>
      const installCodex = await fetch(`${baseUrl}/v1/cli-updates/install`, {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({ provider: "codex" })
      });
      assert.equal(installCodex.status, 200);
      const codexRes = (await installCodex.json()) as {
        ok: boolean;
        previousVersion: string;
        newVersion: string;
        method: string;
        item: { hasUpdate: boolean; currentVersion: string };
      };
      assert.equal(codexRes.ok, true);
      assert.equal(codexRes.method, "npm-global");
      assert.equal(codexRes.previousVersion, "0.172.0");
      assert.equal(codexRes.newVersion, "0.173.0");
      assert.equal(codexRes.item.currentVersion, "0.173.0");
      assert.equal(codexRes.item.hasUpdate, false);
      assert.equal(diagnosticsClearedCount, 1);
      assert.ok(
        executedCommands.some(
          (c) =>
            c.exe.endsWith("npm.cmd") &&
            c.args.includes("@openai/codex@latest") &&
            c.args.includes(`--registry=${mirrorMock.baseUrl}`)
        )
      );

      // 6. POST /v1/cli-updates/install for native Claude (~/.local/bin/claude.exe) -> runs `claude update`
      const installClaude = await fetch(`${baseUrl}/v1/cli-updates/install`, {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({ provider: "claudeAgent" })
      });
      assert.equal(installClaude.status, 200);
      const claudeRes = (await installClaude.json()) as {
        ok: boolean;
        method: string;
        previousVersion: string;
        newVersion: string;
      };
      assert.equal(claudeRes.ok, true);
      assert.equal(claudeRes.method, "native-self-update");
      assert.equal(claudeRes.previousVersion, "2.1.331");
      assert.equal(claudeRes.newVersion, "2.1.335");
      assert.equal(diagnosticsClearedCount, 2);
      assert.ok(
        executedCommands.some(
          (c) => c.exe.endsWith("claude.exe") && c.args[0] === "update"
        )
      );

      // 7. POST /v1/cli-updates/install for unsupported provider (antigravity) -> 400
      const installAgy = await fetch(`${baseUrl}/v1/cli-updates/install`, {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({ provider: "antigravity" })
      });
      assert.equal(installAgy.status, 400);
      const agyErr = (await installAgy.json()) as {
        ok: boolean;
        error: { code: string };
      };
      assert.equal(agyErr.ok, false);
      assert.equal(agyErr.error.code, "CLI_UPDATE_UNSUPPORTED");
    } finally {
      await rpcServer?.stop();
      await primaryMock.close();
      await mirrorMock.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("falls back to secondary npm registry when primary fails and surfaces sanitized timeout errors", async () => {
    const failingPrimary = await startMockNpmRegistry({}, { failPrimary: true });
    const healthyBackup = await startMockNpmRegistry({
      "@openai/codex": "0.175.0"
    });
    try {
      const service = new CliUpdateService({
        npmRegistryUrl: failingPrimary.baseUrl,
        npmMirrorRegistryUrl: healthyBackup.baseUrl,
        installTimeoutMs: 5_000,
        cliProbe: async () => ({
          found: true,
          path: "/usr/local/bin/codex",
          version: "0.172.0",
          latencyMs: 3
        }),
        findExecutable: () => "/usr/local/bin/npm",
        execCommand: async () => ({
          exitCode: 1,
          stdout: "",
          stderr: "Command timed out",
          timedOut: true
        }),
        refreshEnv: () => undefined
      });

      const checked = await service.checkUpdates({ provider: "codex" });
      assert.equal(checked.item?.hasUpdate, true);
      assert.equal(checked.item?.latestVersion, "0.175.0");
      assert.equal(checked.item?.registryUsed, healthyBackup.baseUrl);

      await assert.rejects(
        () => service.installUpdate("codex"),
        (err: unknown) =>
          err instanceof CliUpdateError &&
          err.statusCode === 504 &&
          err.code === "CLI_UPDATE_TIMEOUT"
      );
    } finally {
      await failingPrimary.close();
      await healthyBackup.close();
    }
  });
});
