import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { CordisPluginModule } from "@prismux/cordis-kernel";
import type { InstalledPluginRecord } from "@prismux/protocol";
import { WebSocket } from "ws";
import { parseDaemonCliArgs, resolveDefaultDataDir } from "../cli.js";
import { PrismuxDaemon } from "../index.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rawDataToString(data: WebSocket.RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  return Buffer.from(data).toString("utf8");
}

async function connectWs(url: string, token: string): Promise<WebSocket> {
  return new Promise<WebSocket>((resolveWs, rejectWs) => {
    const ws = new WebSocket(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    ws.once("open", () => resolveWs(ws));
    ws.once("unexpected-response", (_req, res) => {
      res.resume();
      rejectWs(new Error(`WS_REJECTED_${res.statusCode ?? 0}`));
    });
    ws.once("error", (err) => rejectWs(err));
  });
}

async function closeWs(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.CLOSED) {
    return;
  }
  await new Promise<void>((resolveClose) => {
    ws.once("close", () => resolveClose());
    if (ws.readyState === WebSocket.CONNECTING) {
      ws.terminate();
    } else {
      ws.close();
    }
  });
}

async function sendWsRpc<TResult>(
  ws: WebSocket,
  id: string,
  method: string,
  params: Record<string, unknown>
): Promise<
  | { ok: true; result: TResult }
  | { ok: false; error: { code: string; message: string } }
> {
  return new Promise((resolveRpc, rejectRpc) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      rejectRpc(new Error(`WS RPC ${method} timed out`));
    }, 5_000);

    const onMessage = (rawData: WebSocket.RawData) => {
      const parsed = JSON.parse(rawDataToString(rawData)) as unknown;
      if (!isRecord(parsed) || parsed.id !== id) {
        return;
      }
      clearTimeout(timer);
      ws.off("message", onMessage);
      resolveRpc(
        parsed as
          | { ok: true; result: TResult }
          | { ok: false; error: { code: string; message: string } }
      );
    };

    ws.on("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const tempDirs: string[] = [];
const cleanups: Array<() => Promise<void>> = [];

after(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop();
    if (fn !== undefined) {
      await fn();
    }
  }
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("daemon M3 integration: zero preinstalled plugins, reversible plugin toggle via RPC, and isolated credentials", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "prismux-daemon-m3-data-"));
  tempDirs.push(dataDir);

  const authToken = "daemon-m3-owner-token";
  const daemon = new PrismuxDaemon({
    headless: true,
    host: "127.0.0.1",
    port: 0,
    dataDir,
    machineId: "m3-test-machine",
    authToken
  });

  const ready = await daemon.start();
  let stopped = false;
  cleanups.push(async () => {
    if (!stopped) {
      await daemon.stop();
      stopped = true;
    }
  });

  // 1. Default zero preinstalled official plugins (qq, pet, fishdock-hook, ssh, purge)
  assert.deepEqual(daemon.pluginHost.listInstalled(), []);

  const listHttpRes = await fetch(`${ready.httpUrl}/v1/rpc`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({ id: "list-empty", method: "plugins.list", params: {} })
  });
  assert.equal(listHttpRes.status, 200);
  const listHttpPayload = (await listHttpRes.json()) as {
    ok: boolean;
    result: { plugins: InstalledPluginRecord[] };
  };
  assert.equal(listHttpPayload.ok, true);
  assert.deepEqual(listHttpPayload.result.plugins, []);

  // 2. Mount a custom plugin module with route, hook, timer, and custom effect
  let cleanupCalls = 0;
  let applyCount = 0;

  const sampleModule: CordisPluginModule = {
    manifest: {
      id: "smoke-plugin",
      version: "0.1.0",
      realms: ["daemon"],
      permissions: ["hooks:subscribe"],
      modelVisible: false
    },
    async apply(ctx) {
      applyCount += 1;
      await ctx.credentials.set("apiSecret", "secret-val");
      ctx.registerRoute?.("GET", "/smoke/health", () => ({ ok: true }));
      ctx.onHook?.("Notification", () => undefined);
      ctx.setInterval(() => undefined, 60_000);
      ctx.effect(() => {
        cleanupCalls += 1;
      });
    }
  };

  await daemon.mountPluginModule(
    {
      manifest: sampleModule.manifest,
      packageName: "prismux-plugin-smoke",
      distribution: "managed",
      enabled: true,
      installPath: join(dataDir, "plugins", "smoke-plugin"),
      installedAt: Date.now()
    },
    sampleModule
  );

  assert.equal(applyCount, 1);
  assert.deepEqual(daemon.pluginHost.getActiveResourceCounts(), {
    routes: 1,
    hooks: 1,
    panels: 0,
    styles: 0,
    timers: 1,
    effects: 1
  });

  const ws = await connectWs(ready.wsUrl, authToken);
  cleanups.push(() => closeWs(ws));

  const wsListActive = await sendWsRpc<{ plugins: InstalledPluginRecord[] }>(
    ws,
    "ws-list-1",
    "plugins.list",
    {}
  );
  assert.equal(wsListActive.ok, true);
  if (wsListActive.ok) {
    assert.equal(wsListActive.result.plugins.length, 1);
    assert.equal(wsListActive.result.plugins[0]?.manifest.id, "smoke-plugin");
    assert.equal(wsListActive.result.plugins[0]?.enabled, true);
  }

  // 3. Disable via plugins.toggle RPC -> zero residual resources in host
  const toggleOff = await sendWsRpc<{ pluginId: string; enabled: boolean }>(
    ws,
    "toggle-off",
    "plugins.toggle",
    { pluginId: "smoke-plugin", enabled: false }
  );
  assert.equal(toggleOff.ok, true);
  if (toggleOff.ok) {
    assert.deepEqual(toggleOff.result, {
      pluginId: "smoke-plugin",
      enabled: false
    });
  }

  assert.equal(cleanupCalls, 1);
  assert.deepEqual(daemon.pluginHost.getActiveResourceCounts(), {
    routes: 0,
    hooks: 0,
    panels: 0,
    styles: 0,
    timers: 0,
    effects: 0
  });

  const wsListDisabled = await sendWsRpc<{ plugins: InstalledPluginRecord[] }>(
    ws,
    "ws-list-2",
    "plugins.list",
    {}
  );
  assert.equal(wsListDisabled.ok, true);
  if (wsListDisabled.ok) {
    assert.equal(wsListDisabled.result.plugins[0]?.enabled, false);
  }

  // 4. Re-enable via plugins.toggle RPC -> restores plugin and reads persisted credential
  const toggleOn = await sendWsRpc<{ pluginId: string; enabled: boolean }>(
    ws,
    "toggle-on",
    "plugins.toggle",
    { pluginId: "smoke-plugin", enabled: true }
  );
  assert.equal(toggleOn.ok, true);
  if (toggleOn.ok) {
    assert.deepEqual(toggleOn.result, {
      pluginId: "smoke-plugin",
      enabled: true
    });
  }

  assert.equal(applyCount, 2);
  assert.deepEqual(daemon.pluginHost.getActiveResourceCounts(), {
    routes: 1,
    hooks: 1,
    panels: 0,
    styles: 0,
    timers: 1,
    effects: 1
  });

  const storedSecret = await daemon.pluginCredentialStore
    .openForPlugin("smoke-plugin")
    .get("apiSecret");
  assert.equal(storedSecret, "secret-val");

  // Unknown plugin toggle must return an error
  const unknownToggle = await sendWsRpc<{ pluginId: string; enabled: boolean }>(
    ws,
    "toggle-unknown",
    "plugins.toggle",
    { pluginId: "non-existent", enabled: true }
  );
  assert.equal(unknownToggle.ok, false);

  // Stopping daemon unmounts active plugins cleanly with zero residual resources
  await closeWs(ws);
  await daemon.stop();
  stopped = true;
  assert.equal(cleanupCalls, 2);
  assert.deepEqual(daemon.pluginHost.getActiveResourceCounts(), {
    routes: 0,
    hooks: 0,
    panels: 0,
    styles: 0,
    timers: 0,
    effects: 0
  });
});

test("cli.ts portable mode detection converges to sibling data/ directory or falls back to ~/.prismux", () => {
  const portableExecDir = mkdtempSync(join(tmpdir(), "prismux-portable-yes-"));
  const standardExecDir = mkdtempSync(join(tmpdir(), "prismux-portable-no-"));
  tempDirs.push(portableExecDir, standardExecDir);

  mkdirSync(join(portableExecDir, "data"), { recursive: true });

  // 1. Sibling `data/` detected via --portable-root
  const portableParsed = parseDaemonCliArgs(
    ["start", "--headless", "--portable-root", portableExecDir],
    {}
  );
  assert.equal(portableParsed.isPortable, true);
  assert.equal(portableParsed.portableRoot, portableExecDir);
  assert.equal(portableParsed.dataDir, join(portableExecDir, "data"));

  // 2. Sibling `data/` detected via PRISMUX_PORTABLE_DIR environment variable
  const envPortableParsed = parseDaemonCliArgs(["start"], {
    PRISMUX_PORTABLE_DIR: portableExecDir
  });
  assert.equal(envPortableParsed.isPortable, true);
  assert.equal(envPortableParsed.dataDir, join(portableExecDir, "data"));

  // 3. No sibling `data/` falls back to default ~/.prismux
  const standardParsed = parseDaemonCliArgs(
    ["start", "--portable-root", standardExecDir],
    {}
  );
  assert.equal(standardParsed.isPortable, false);
  assert.equal(standardParsed.portableRoot, undefined);
  assert.equal(standardParsed.dataDir, resolveDefaultDataDir());
});
