import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import type { Duplex } from "node:stream";
import { after, describe, it } from "node:test";
import {
  isRetiredChiefProviderKind,
  normalizeChiefProviderKind,
  type CoreSupervisorState
} from "@prismux/protocol";
import { WebSocketServer, type WebSocket } from "ws";
import {
  CHIEF_MARKER_FILENAME,
  CHIEF_README_FILENAME,
  CHIEF_SLOT_FILENAME,
  ChiefThreadManager,
  DEFAULT_CHIEF_MCP_SERVERS
} from "../chief/ChiefThreadManager.js";
import {
  CoreRpcClient,
  CoreRpcHandshakeError,
  CoreRpcRemoteError,
  type CoreRpcPushEvent
} from "../core/CoreRpcClient.js";
import {
  CoreServerSupervisor,
  sanitizeChildEnv
} from "../core/CoreServerSupervisor.js";
import { PrismuxDaemon } from "../index.js";

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function waitForCondition(
  check: () => boolean,
  subscribe: (trigger: () => void) => () => void,
  timeoutMs: number,
  label: string
): Promise<void> {
  if (check()) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      unsubscribe();
    };
    const attempt = () => {
      if (settled) {
        return;
      }
      if (check()) {
        settled = true;
        cleanup();
        resolve();
      }
    };
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      unsubscribe();
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for: ${label}`));
    }, timeoutMs);
    const unsubscribe = subscribe(attempt);
    attempt();
  });
}

interface MockEnsureCall {
  workspacePath: string;
  provider: string;
  model?: string;
}

interface MockCoreServerHandle {
  port: number;
  wsUrl: string;
  ensureCalls: MockEnsureCall[];
  close: () => Promise<void>;
}

async function startMockCoreServer(options: {
  port?: number;
  expectedToken: string;
  generation: number;
}): Promise<MockCoreServerHandle> {
  const wss = new WebSocketServer({ noServer: true });
  const sockets = new Set<WebSocket>();
  const ensureCalls: MockEnsureCall[] = [];

  wss.on("connection", (ws: WebSocket) => {
    sockets.add(ws);
    ws.on("close", () => {
      sockets.delete(ws);
    });

    ws.send(
      JSON.stringify({
        event: "provider.status",
        data: { generation: options.generation, ready: true }
      })
    );

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString("utf8")) as {
        id: string;
        method: string;
        params?: Record<string, unknown>;
      };

      if (msg.method === "server.probe") {
        ws.send(
          JSON.stringify({
            id: msg.id,
            ok: true,
            result: { ok: true, generation: options.generation }
          })
        );
        return;
      }

      if (msg.method === "provider.list") {
        ws.send(
          JSON.stringify({
            id: msg.id,
            ok: true,
            result: {
              providers: [
                { id: "claude-code", state: "ready" },
                { id: "codex", state: "ready" },
                { id: "antigravity", state: "ready" },
                { id: "opencode", state: "ready" }
              ]
            }
          })
        );
        return;
      }

      if (msg.method === "chief.ensureThread") {
        const params = msg.params ?? {};
        ensureCalls.push({
          workspacePath: String(params.workspacePath ?? ""),
          provider: String(params.provider ?? ""),
          ...(typeof params.model === "string" ? { model: params.model } : {})
        });
        ws.send(
          JSON.stringify({
            id: msg.id,
            ok: true,
            result: {
              ensured: true,
              workspacePath: params.workspacePath,
              provider: params.provider,
              ...(params.model !== undefined ? { model: params.model } : {})
            }
          })
        );
        return;
      }

      if (msg.method === "orchestration.dispatchCommand") {
        ws.send(
          JSON.stringify({
            id: msg.id,
            ok: true,
            result: {
              accepted: true,
              threadId: msg.params?.threadId,
              payload: msg.params?.payload
            }
          })
        );
        return;
      }

      if (msg.method === "rpc.fail") {
        ws.send(
          JSON.stringify({
            id: msg.id,
            ok: false,
            error: {
              code: "bad_request",
              message: "Intentional mock RPC error"
            }
          })
        );
        return;
      }

      if (msg.method === "rpc.slow") {
        // Intentionally never reply so timeout test triggers cleanly.
        return;
      }

      ws.send(
        JSON.stringify({
          id: msg.id,
          ok: false,
          error: {
            code: "method_not_found",
            message: `Unknown method ${msg.method}`
          }
        })
      );
    });
  });

  const httpServer: Server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, generation: options.generation }));
  });

  httpServer.on(
    "upgrade",
    (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      const parsed = new URL(req.url ?? "/", "http://127.0.0.1");
      if (parsed.pathname !== "/ws") {
        socket.write(
          "HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
        );
        socket.destroy();
        return;
      }

      if (parsed.searchParams.get("orchestrationProtocol") !== "2") {
        const body = JSON.stringify({
          code: "orchestration_protocol_incompatible",
          orchestrationProtocolVersion: 2
        });
        socket.write(
          `HTTP/1.1 426 Upgrade Required\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`
        );
        socket.destroy();
        return;
      }

      if (req.headers.authorization !== `Bearer ${options.expectedToken}`) {
        const body = JSON.stringify({ code: "unauthorized" });
        socket.write(
          `HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`
        );
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    }
  );

  await new Promise<void>((resolveListen, rejectListen) => {
    httpServer.once("error", rejectListen);
    httpServer.listen(options.port ?? 0, "127.0.0.1", () => {
      httpServer.off("error", rejectListen);
      resolveListen();
    });
  });

  const addr = httpServer.address();
  assert(addr !== null && typeof addr === "object");
  const boundPort = addr.port;

  return {
    port: boundPort,
    wsUrl: `ws://127.0.0.1:${boundPort}/ws`,
    ensureCalls,
    close: async () => {
      for (const ws of sockets) {
        try {
          ws.terminate();
        } catch {
          // Ignore socket terminate error.
        }
      }
      sockets.clear();
      await new Promise<void>((resolveWss) => {
        wss.close(() => resolveWss());
      });
      httpServer.closeAllConnections?.();
      await new Promise<void>((resolveHttp) => {
        httpServer.close(() => resolveHttp());
      });
    }
  };
}

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("CoreServerSupervisor", () => {
  it("strips ELECTRON_RUN_AS_NODE and ELECTRON_NO_ATTACH_CONSOLE when spawning Node child", async () => {
    const cleaned = sanitizeChildEnv({
      ELECTRON_RUN_AS_NODE: "1",
      ELECTRON_NO_ATTACH_CONSOLE: "1",
      OMITTED: undefined,
      KEEP_ME: "ok"
    });
    assert.deepEqual(cleaned, { KEEP_ME: "ok" });

    const dir = createTempDir("prismux-sup-env-");
    const scriptPath = join(dir, "env-probe.mjs");
    writeFileSync(
      scriptPath,
      [
        "const report = {",
        '  hasElectronRunAsNode: "ELECTRON_RUN_AS_NODE" in process.env,',
        '  hasElectronNoAttach: "ELECTRON_NO_ATTACH_CONSOLE" in process.env,',
        "  keepValue: process.env.PRISMUX_KEEP ?? null",
        "};",
        'console.log("ENV_REPORT:" + JSON.stringify(report));',
        "const keepAlive = setInterval(() => {}, 1000);",
        'process.on("SIGTERM", () => { clearInterval(keepAlive); process.exit(0); });'
      ].join("\n"),
      "utf8"
    );

    const prevRunAsNode = process.env.ELECTRON_RUN_AS_NODE;
    const prevNoAttach = process.env.ELECTRON_NO_ATTACH_CONSOLE;
    process.env.ELECTRON_RUN_AS_NODE = "1";
    process.env.ELECTRON_NO_ATTACH_CONSOLE = "1";

    const supervisor = new CoreServerSupervisor({
      command: process.execPath,
      args: [scriptPath],
      cwd: dir,
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        ELECTRON_NO_ATTACH_CONSOLE: "1",
        PRISMUX_KEEP: "clean-child"
      },
      stopTimeoutMs: 1000
    });

    try {
      await supervisor.start();
      assert.equal(supervisor.getStatus().state, "running");
      assert.equal(typeof supervisor.getStatus().pid, "number");

      await waitForCondition(
        () =>
          supervisor
            .getLogs()
            .some((line) => line.includes("ENV_REPORT:")),
        (trigger) => {
          supervisor.on("log", trigger);
          return () => supervisor.off("log", trigger);
        },
        5000,
        "child env probe output"
      );

      const reportLine = supervisor
        .getLogs()
        .find((line) => line.includes("ENV_REPORT:"));
      assert.ok(reportLine !== undefined);
      const jsonPart = reportLine.slice(
        reportLine.indexOf("ENV_REPORT:") + "ENV_REPORT:".length
      );
      const parsed = JSON.parse(jsonPart) as {
        hasElectronRunAsNode: boolean;
        hasElectronNoAttach: boolean;
        keepValue: string | null;
      };
      assert.equal(parsed.hasElectronRunAsNode, false);
      assert.equal(parsed.hasElectronNoAttach, false);
      assert.equal(parsed.keepValue, "clean-child");
    } finally {
      await supervisor.stop();
      assert.equal(supervisor.getStatus().state, "stopped");
      assert.equal(supervisor.getStatus().pid, undefined);

      if (prevRunAsNode === undefined) {
        delete process.env.ELECTRON_RUN_AS_NODE;
      } else {
        process.env.ELECTRON_RUN_AS_NODE = prevRunAsNode;
      }
      if (prevNoAttach === undefined) {
        delete process.env.ELECTRON_NO_ATTACH_CONSOLE;
      } else {
        process.env.ELECTRON_NO_ATTACH_CONSOLE = prevNoAttach;
      }
    }
  });

  it("auto-restarts on unexpected exit 1 with exponential backoff and stops cleanly", async () => {
    const dir = createTempDir("prismux-sup-restart-");
    const countFile = join(dir, "boot-count.txt");
    const scriptPath = join(dir, "crash-once.mjs");
    writeFileSync(
      scriptPath,
      [
        'import { existsSync, readFileSync, writeFileSync } from "node:fs";',
        "const file = process.argv[2];",
        'const prev = existsSync(file) ? Number(readFileSync(file, "utf8")) : 0;',
        "const next = prev + 1;",
        "writeFileSync(file, String(next), 'utf8');",
        "if (next === 1) {",
        '  console.log("boot-1-crashing");',
        "  setTimeout(() => process.exit(1), 25);",
        "} else {",
        '  console.log("boot-" + next + "-healthy");',
        "  const timer = setInterval(() => {}, 1000);",
        '  process.on("SIGTERM", () => { clearInterval(timer); process.exit(0); });',
        "}"
      ].join("\n"),
      "utf8"
    );

    const observedStates: CoreSupervisorState[] = [];
    const supervisor = new CoreServerSupervisor({
      command: process.execPath,
      args: [scriptPath, countFile],
      cwd: dir,
      maxRestarts: 3,
      baseBackoffMs: 40,
      maxBackoffMs: 200,
      stopTimeoutMs: 1000,
      logCapacity: 50
    });

    supervisor.on("stateChange", (evt: { current: CoreSupervisorState }) => {
      observedStates.push(evt.current);
    });

    try {
      await supervisor.start();

      await waitForCondition(
        () =>
          supervisor.getStatus().state === "running" &&
          supervisor.getStatus().restartCount >= 1 &&
          supervisor.getLogs().some((line) => line.includes("boot-2-healthy")),
        (trigger) => {
          supervisor.on("stateChange", trigger);
          supervisor.on("log", trigger);
          return () => {
            supervisor.off("stateChange", trigger);
            supervisor.off("log", trigger);
          };
        },
        6000,
        "supervisor restart to running"
      );

      assert.ok(observedStates.includes("restarting"));
      assert.equal(supervisor.getStatus().restartCount, 1);
      assert.equal(supervisor.getStatus().state, "running");
      assert.ok(
        supervisor.getLogs().some((line) => line.includes("boot-1-crashing"))
      );
      assert.ok(
        supervisor.getLogs().some((line) => line.includes("boot-2-healthy"))
      );
    } finally {
      await supervisor.stop();
      assert.equal(supervisor.getStatus().state, "stopped");
      assert.equal(supervisor.getStatus().pid, undefined);
    }
  });

  it("transitions to failed after maxRestarts exhaustion and bounds ring log buffer", async () => {
    const dir = createTempDir("prismux-sup-fail-");
    const scriptPath = join(dir, "always-fail.mjs");
    writeFileSync(
      scriptPath,
      [
        'for (let i = 1; i <= 10; i++) console.log("line-" + i);',
        "setTimeout(() => process.exit(1), 20);"
      ].join("\n"),
      "utf8"
    );

    const supervisor = new CoreServerSupervisor({
      command: process.execPath,
      args: [scriptPath],
      cwd: dir,
      maxRestarts: 1,
      baseBackoffMs: 25,
      maxBackoffMs: 50,
      logCapacity: 5
    });

    try {
      await supervisor.start();

      await waitForCondition(
        () => supervisor.getStatus().state === "failed",
        (trigger) => {
          supervisor.on("stateChange", trigger);
          return () => supervisor.off("stateChange", trigger);
        },
        6000,
        "supervisor failed after maxRestarts"
      );

      assert.equal(supervisor.getStatus().restartCount, 1);
      assert.equal(supervisor.getLogs().length, 5);
    } finally {
      await supervisor.stop();
      assert.equal(supervisor.getStatus().state, "stopped");
    }
  });

  it("waits for healthUrl 200 readiness and cancels pending backoff cleanly when stop() is called during restarting", async () => {
    const dir = createTempDir("prismux-sup-health-");
    let healthHits = 0;
    const healthServer = createServer((_req, res) => {
      healthHits += 1;
      if (healthHits < 3) {
        res.writeHead(503);
        res.end("warming up");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });

    await new Promise<void>((resolveListen, rejectListen) => {
      healthServer.once("error", rejectListen);
      healthServer.listen(0, "127.0.0.1", () => {
        healthServer.off("error", rejectListen);
        resolveListen();
      });
    });

    const addr = healthServer.address();
    assert(addr !== null && typeof addr === "object");
    const healthUrl = `http://127.0.0.1:${addr.port}/health`;

    const healthyScript = join(dir, "stay-alive.mjs");
    writeFileSync(
      healthyScript,
      [
        "const keep = setInterval(() => {}, 1000);",
        'process.on("SIGTERM", () => { clearInterval(keep); process.exit(0); });'
      ].join("\n"),
      "utf8"
    );

    const healthSup = new CoreServerSupervisor({
      command: process.execPath,
      args: [healthyScript],
      cwd: dir,
      healthUrl,
      healthCheckIntervalMs: 25,
      healthTimeoutMs: 500,
      startTimeoutMs: 5000
    });

    try {
      await healthSup.start();
      assert.equal(healthSup.getStatus().state, "running");
      assert.ok(healthHits >= 3);
    } finally {
      await healthSup.stop();
      healthServer.closeAllConnections?.();
      await new Promise<void>((resolveClose) => {
        healthServer.close(() => resolveClose());
      });
    }

    const crashScript = join(dir, "crash-fast.mjs");
    writeFileSync(crashScript, "setTimeout(() => process.exit(1), 20);\n", "utf8");

    const restartSup = new CoreServerSupervisor({
      command: process.execPath,
      args: [crashScript],
      cwd: dir,
      maxRestarts: 3,
      baseBackoffMs: 5_000,
      maxBackoffMs: 10_000
    });

    try {
      await restartSup.start();
      await waitForCondition(
        () => restartSup.getStatus().state === "restarting",
        (trigger) => {
          restartSup.on("stateChange", trigger);
          return () => restartSup.off("stateChange", trigger);
        },
        3000,
        "supervisor entering restarting backoff"
      );

      const stopStart = Date.now();
      await restartSup.stop();
      const elapsedMs = Date.now() - stopStart;
      assert.equal(restartSup.getStatus().state, "stopped");
      assert.ok(elapsedMs < 1000, `Expected quick stop during backoff, took ${elapsedMs}ms`);
    } finally {
      await restartSup.stop();
    }
  });
});

describe("CoreRpcClient", () => {
  it("enforces orchestrationProtocol=2 (426), Bearer auth (401), RPC calls, and reconnects after server restart", async () => {
    const token = "prismux-secret-token";
    let server = await startMockCoreServer({ expectedToken: token, generation: 1 });
    const port = server.port;

    const badProtocolClient = new CoreRpcClient({
      url: server.wsUrl,
      token,
      protocolVersion: "1",
      autoReconnect: false
    });
    const badAuthClient = new CoreRpcClient({
      url: server.wsUrl,
      token: "wrong-token",
      autoReconnect: false
    });
    const client = new CoreRpcClient({
      url: server.wsUrl,
      token,
      requestTimeoutMs: 1000,
      baseReconnectMs: 40,
      maxReconnectMs: 120,
      autoReconnect: true
    });

    try {
      assert.ok(client.wsUrl.includes("orchestrationProtocol=2"));

      await assert.rejects(
        () => badProtocolClient.connect(),
        (err: unknown) =>
          err instanceof CoreRpcHandshakeError && err.statusCode === 426
      );

      await assert.rejects(
        () => badAuthClient.connect(),
        (err: unknown) =>
          err instanceof CoreRpcHandshakeError && err.statusCode === 401
      );

      const events: CoreRpcPushEvent[] = [];
      const unsubscribeEvents = client.onEvent((evt) => {
        events.push(evt);
      });

      await client.connect();
      assert.equal(client.isConnected(), true);
      assert.equal(client.getStatus().state, "connected");

      await waitForCondition(
        () => events.some((e) => e.event === "provider.status"),
        (trigger) => client.onEvent(trigger),
        3000,
        "initial push event"
      );

      const ping1 = await client.ping();
      assert.equal(ping1.ok, true);
      assert.deepEqual(ping1.payload, { ok: true, generation: 1 });

      const providers = await client.listProviders();
      assert.equal(providers.length, 4);
      assert.equal(providers[0]?.id, "claude-code");

      const ensured = await client.ensureChiefThread(
        "/tmp/chief-workspace",
        "codex",
        "gpt-5"
      );
      assert.equal(ensured.ensured, true);
      assert.equal(ensured.provider, "codex");

      const dispatched = await client.dispatchThreadCommand("chief-1", {
        action: "continue"
      });
      assert.deepEqual(dispatched, {
        accepted: true,
        threadId: "chief-1",
        payload: { action: "continue" }
      });

      await assert.rejects(
        () => client.request("rpc.fail", {}),
        (err: unknown) =>
          err instanceof CoreRpcRemoteError && err.code === "bad_request"
      );

      await assert.rejects(
        () => client.request("rpc.slow", {}, 60),
        /timed out/
      );

      // Simulate T3 server shutdown and restart on the exact same port.
      await server.close();
      await waitForCondition(
        () => !client.isConnected(),
        (trigger) => client.onStateChange(trigger),
        3000,
        "client disconnect on server shutdown"
      );

      server = await startMockCoreServer({
        port,
        expectedToken: token,
        generation: 2
      });

      await client.waitForConnected(5000);
      assert.equal(client.isConnected(), true);

      const ping2 = await client.ping();
      assert.equal(ping2.ok, true);
      assert.deepEqual(ping2.payload, { ok: true, generation: 2 });

      unsubscribeEvents();
    } finally {
      await badProtocolClient.close();
      await badAuthClient.close();
      await client.close();
      assert.equal(client.isConnected(), false);
      assert.equal(client.getStatus().state, "closed");
      await server.close();
    }
  });

  it("stops PrismuxDaemon core reconnect loop after HTTP 401/403/426 handshake rejection and logs once", async () => {
    for (const statusCode of [401, 403, 426] as const) {
      let upgradeAttempts = 0;
      const rejectServer = createServer((_req, res) => {
        res.writeHead(200);
        res.end("ok");
      });
      rejectServer.on("upgrade", (_req, socket) => {
        upgradeAttempts += 1;
        const reason =
          statusCode === 401
            ? "Unauthorized"
            : statusCode === 403
              ? "Forbidden"
              : "Upgrade Required";
        const body = JSON.stringify({ code: "rejected" });
        socket.write(
          `HTTP/1.1 ${statusCode} ${reason}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`
        );
        socket.destroy();
      });

      await new Promise<void>((resolveListen, rejectListen) => {
        rejectServer.once("error", rejectListen);
        rejectServer.listen(0, "127.0.0.1", () => {
          rejectServer.off("error", rejectListen);
          resolveListen();
        });
      });

      const addr = rejectServer.address();
      assert(addr !== null && typeof addr === "object");

      const dataDir = createTempDir(`prismux-daemon-reject-${statusCode}-`);
      const warnings: string[] = [];
      const origWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        warnings.push(args.map(String).join(" "));
      };

      const daemon = new PrismuxDaemon({
        headless: true,
        host: "127.0.0.1",
        port: 0,
        dataDir,
        authToken: "daemon-test-token",
        t3Url: `ws://127.0.0.1:${addr.port}/ws`,
        t3Token: "raw-unsigned-bootstrap-token",
        disableAutoUpdateCheck: true
      });

      try {
        const ready = await daemon.start();
        assert.equal(ready.coreConnected, false);
        assert.equal(daemon.coreRpcClient?.isConnected(), false);

        // Wait longer than the old 250ms + 500ms rapid backoff to prove retries stopped.
        await new Promise((resolveWait) => setTimeout(resolveWait, 900));

        assert.equal(
          upgradeAttempts,
          1,
          `expected exactly 1 handshake attempt on HTTP ${statusCode}, got ${upgradeAttempts}`
        );
        const handshakeWarnings = warnings.filter((msg) =>
          msg.includes(`HTTP ${statusCode}`)
        );
        assert.equal(
          handshakeWarnings.length,
          1,
          `expected exactly 1 warning for HTTP ${statusCode}, got ${handshakeWarnings.length}`
        );
      } finally {
        console.warn = origWarn;
        await daemon.stop();
        rejectServer.closeAllConnections?.();
        await new Promise<void>((resolveClose) => {
          rejectServer.close(() => resolveClose());
        });
      }
    }
  });

  it("stops background startCoreConnectLoop once delayed server rejects with HTTP 401", async () => {
    // Reserve an ephemeral port, close it so initial probe gets ECONNREFUSED and enters startCoreConnectLoop.
    const probeServer = createServer();
    await new Promise<void>((resolveListen, rejectListen) => {
      probeServer.once("error", rejectListen);
      probeServer.listen(0, "127.0.0.1", () => {
        probeServer.off("error", rejectListen);
        resolveListen();
      });
    });
    const addr = probeServer.address();
    assert(addr !== null && typeof addr === "object");
    const reservedPort = addr.port;
    await new Promise<void>((resolveClose) => probeServer.close(() => resolveClose()));

    let upgradeAttempts = 0;
    let resolveFirstUpgrade: (() => void) | undefined;
    const firstUpgradeHit = new Promise<void>((resolve) => {
      resolveFirstUpgrade = resolve;
    });
    const delayedServer = createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    delayedServer.on("upgrade", (_req, socket) => {
      upgradeAttempts += 1;
      resolveFirstUpgrade?.();
      const body = JSON.stringify({ code: "MalformedSessionTokenError" });
      socket.write(
        `HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`
      );
      socket.destroy();
    });

    const dataDir = createTempDir("prismux-daemon-loop-401-");
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };

    const daemon = new PrismuxDaemon({
      headless: true,
      host: "127.0.0.1",
      port: 0,
      dataDir,
      authToken: "daemon-test-token",
      t3Url: `ws://127.0.0.1:${reservedPort}/ws`,
      t3Token: "malformed-token",
      disableAutoUpdateCheck: true
    });

    let listening = false;
    try {
      await daemon.start();
      await new Promise<void>((resolveListen, rejectListen) => {
        delayedServer.once("error", rejectListen);
        delayedServer.listen(reservedPort, "127.0.0.1", () => {
          delayedServer.off("error", rejectListen);
          listening = true;
          resolveListen();
        });
      });

      // Wait for background backoff to hit the server once, then verify it stops retrying.
      await Promise.race([
        firstUpgradeHit,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Timed out waiting for first 401 attempt")), 3_000)
        )
      ]);
      assert.equal(upgradeAttempts, 1);

      await new Promise((r) => setTimeout(r, 900));
      assert.equal(upgradeAttempts, 1, "startCoreConnectLoop must stop after HTTP 401");
      const authWarnings = warnings.filter((msg) => msg.includes("HTTP 401"));
      assert.equal(authWarnings.length, 1);
    } finally {
      console.warn = origWarn;
      await daemon.stop();
      if (listening) {
        delayedServer.closeAllConnections?.();
        await new Promise<void>((resolveClose) => {
          delayedServer.close(() => resolveClose());
        });
      }
    }
  });
});

describe("ChiefThreadManager", () => {
  it("protects chief-workspace, hot-switches providers keeping threadId invariant, syncs T3, and restores from disk", async () => {
    const dataDir = createTempDir("prismux-chief-");
    const workspaceDir = join(dataDir, "chief-workspace");
    mkdirSync(workspaceDir, { recursive: true });
    const userNotesPath = join(workspaceDir, "user-notes.txt");
    writeFileSync(userNotesPath, "keep-me-safe", "utf8");

    const token = "chief-sync-token";
    const server = await startMockCoreServer({ expectedToken: token, generation: 1 });
    const rpcClient = new CoreRpcClient({
      url: server.wsUrl,
      token,
      autoReconnect: false
    });

    try {
      await rpcClient.connect();

      const manager = new ChiefThreadManager({
        dataDir,
        rpcClient
      });

      const initial = await manager.init();
      assert.equal(initial.activeProvider, "claude-code");
      assert.equal(initial.workspacePath, workspaceDir);
      assert.deepEqual(initial.injectedMcpServers, [...DEFAULT_CHIEF_MCP_SERVERS]);
      assert.deepEqual(initial.injectedMcpServers, [
        "prismux-memory",
        "prismux-orchestrator"
      ]);
      assert.equal(initial.switchHistory.length, 0);
      assert.equal(existsSync(join(dataDir, CHIEF_SLOT_FILENAME)), true);

      const markerPath = join(workspaceDir, CHIEF_MARKER_FILENAME);
      const readmePath = join(workspaceDir, CHIEF_README_FILENAME);
      assert.equal(existsSync(markerPath), true);
      assert.equal(existsSync(readmePath), true);
      assert.equal(readFileSync(userNotesPath, "utf8"), "keep-me-safe");

      const markerJson = JSON.parse(readFileSync(markerPath, "utf8")) as {
        protected: boolean;
        injectedMcpServers: string[];
      };
      assert.equal(markerJson.protected, true);
      assert.deepEqual(markerJson.injectedMcpServers, [
        "prismux-memory",
        "prismux-orchestrator"
      ]);

      // Verify existing workspace files are never overwritten on subsequent ensureWorkspace().
      writeFileSync(readmePath, "custom-user-readme", "utf8");
      manager.ensureWorkspace();
      assert.equal(readFileSync(readmePath, "utf8"), "custom-user-readme");
      assert.equal(readFileSync(userNotesPath, "utf8"), "keep-me-safe");

      const step1 = await manager.switchProvider("codex");
      const step2 = await manager.switchProvider("antigravity", "gemini-4-neon");
      const step3 = await manager.switchProvider("opencode");

      for (const state of [step1, step2, step3]) {
        assert.equal(state.threadId, initial.threadId);
        assert.equal(state.workspacePath, initial.workspacePath);
        assert.deepEqual(state.injectedMcpServers, [
          "prismux-memory",
          "prismux-orchestrator"
        ]);
      }

      assert.equal(step1.activeProvider, "codex");
      assert.equal(step1.model, undefined);

      assert.equal(step2.activeProvider, "antigravity");
      assert.equal(step2.model, "gemini-4-neon");

      assert.equal(step3.activeProvider, "opencode");
      assert.equal(step3.model, undefined);

      assert.equal(step3.switchHistory.length, 3);
      assert.equal(step3.switchHistory[0]?.fromProvider, "claude-code");
      assert.equal(step3.switchHistory[0]?.toProvider, "codex");
      assert.equal(step3.switchHistory[1]?.fromProvider, "codex");
      assert.equal(step3.switchHistory[1]?.toProvider, "antigravity");
      assert.equal(step3.switchHistory[1]?.model, "gemini-4-neon");
      assert.equal(step3.switchHistory[2]?.fromProvider, "antigravity");
      assert.equal(step3.switchHistory[2]?.toProvider, "opencode");

      assert.deepEqual(server.ensureCalls, [
        { workspacePath: workspaceDir, provider: "codex" },
        {
          workspacePath: workspaceDir,
          provider: "antigravity",
          model: "gemini-4-neon"
        },
        { workspacePath: workspaceDir, provider: "opencode" }
      ]);

      // Re-instantiate manager from scratch and verify full disk recovery.
      const restoredManager = new ChiefThreadManager({ dataDir });
      const restored = await restoredManager.init();
      assert.deepEqual(restored, step3);
      assert.deepEqual(restoredManager.getSlot(), step3);
    } finally {
      await rpcClient.close();
      await server.close();
    }
  });

  it("defaults reasoningEffort to high when unconfigured, persists across daemon restarts, normalizes aliases, and clears back to provider default", async () => {
    const dataDir = createTempDir("prismux-chief-effort-");
    const manager = new ChiefThreadManager({
      dataDir,
      defaultProvider: "codex"
    });
    const initSlot = await manager.init();
    assert.equal(initSlot.activeProvider, "codex");
    assert.equal(initSlot.reasoningEffort, "high");

    // Explicit empty defaultReasoningEffort opts out to provider default (undefined).
    const clearedDefaultDir = createTempDir("prismux-chief-effort-clear-");
    const clearedManager = new ChiefThreadManager({
      dataDir: clearedDefaultDir,
      defaultProvider: "codex",
      defaultReasoningEffort: ""
    });
    assert.equal((await clearedManager.init()).reasoningEffort, undefined);

    // Switch via T3 alias ("claudeAgent") with explicit model + reasoningEffort.
    const switchedClaude = await manager.switchProvider(
      "claudeAgent" as unknown as "claude-code",
      "claude-opus-4-6",
      "ultracode"
    );
    assert.equal(switchedClaude.activeProvider, "claude-code");
    assert.equal(switchedClaude.model, "claude-opus-4-6");
    assert.equal(switchedClaude.reasoningEffort, "ultracode");
    assert.equal(switchedClaude.switchHistory.at(-1)?.reasoningEffort, "ultracode");

    // Re-instantiate from disk and confirm reasoningEffort survives restart.
    const restarted = new ChiefThreadManager({ dataDir });
    const recovered = await restarted.init();
    assert.equal(recovered.activeProvider, "claude-code");
    assert.equal(recovered.model, "claude-opus-4-6");
    assert.equal(recovered.reasoningEffort, "ultracode");

    // Switch via Antigravity alias ("agy") and clear reasoningEffort back to provider default.
    const switchedAgy = await restarted.switchProvider(
      "agy" as unknown as "antigravity",
      undefined,
      ""
    );
    assert.equal(switchedAgy.activeProvider, "antigravity");
    assert.equal(switchedAgy.model, undefined);
    assert.equal(switchedAgy.reasoningEffort, undefined);

    // Retired omp / oh-my-pi aliases are rejected cleanly.
    await assert.rejects(
      () => restarted.switchProvider("omp" as unknown as "codex"),
      /Invalid Chief provider/
    );

    // Legacy disk file using `defaultEffort` is recovered seamlessly into `reasoningEffort`.
    const slotPath = join(dataDir, CHIEF_SLOT_FILENAME);
    const persisted = JSON.parse(readFileSync(slotPath, "utf8")) as Record<string, unknown>;
    delete persisted["reasoningEffort"];
    persisted["defaultEffort"] = "xhigh";
    writeFileSync(slotPath, JSON.stringify(persisted, null, 2), "utf8");

    const legacyRestored = await new ChiefThreadManager({ dataDir }).init();
    assert.equal(legacyRestored.reasoningEffort, "xhigh");
  });

  it("supports dsh, pi, and arbitrary configured ACP/custom provider IDs across switches & disk reloads while rejecting retired/malformed IDs", async () => {
    // Protocol normalization checks
    assert.equal(normalizeChiefProviderKind("dsh"), "dsh");
    assert.equal(normalizeChiefProviderKind("deepseek-harness"), "dsh");
    assert.equal(normalizeChiefProviderKind("DeepSeek Harness"), "dsh");
    assert.equal(normalizeChiefProviderKind("dsh-acp"), "dsh");
    assert.equal(normalizeChiefProviderKind("dsh_acp"), "dsh");
    assert.equal(normalizeChiefProviderKind("dsh-next"), "dsh");
    assert.equal(normalizeChiefProviderKind("acpRegistry:dsh"), "dsh");
    assert.equal(normalizeChiefProviderKind("acpRegistry_dsh"), "dsh");
    assert.equal(normalizeChiefProviderKind("pi"), "pi");
    assert.equal(normalizeChiefProviderKind("pi-acp"), "pi");
    assert.equal(normalizeChiefProviderKind("pi_acp"), "pi");
    assert.equal(normalizeChiefProviderKind("pi-coding-agent"), "pi");
    assert.equal(normalizeChiefProviderKind("glm-acp-agent"), "glm-acp-agent");
    assert.equal(normalizeChiefProviderKind("Qwen-Code"), "qwen-code");
    assert.equal(normalizeChiefProviderKind("kimi-code"), "kimi-code");
    assert.equal(normalizeChiefProviderKind("kiro"), "kiro");
    assert.equal(normalizeChiefProviderKind("devin"), "devin");

    for (const retired of [
      "omp",
      "oh-my-pi",
      "oh_my_pi",
      "oh my pi",
      "omp:default",
      "omp-custom",
      "omp_alt",
      "oh-my-pi-v2"
    ]) {
      assert.equal(isRetiredChiefProviderKind(retired), true, `expected retired: ${retired}`);
      assert.equal(normalizeChiefProviderKind(retired), null, `expected rejected: ${retired}`);
    }

    for (const invalid of [
      "",
      "   ",
      "bad provider!",
      "../etc",
      "foo..bar",
      "__proto__",
      "constructor",
      "prototype",
      "claude\ncode",
      null,
      123
    ]) {
      assert.equal(
        normalizeChiefProviderKind(invalid),
        null,
        `expected invalid rejected: ${String(invalid)}`
      );
    }

    const dataDir = createTempDir("prismux-chief-acp-providers-");
    const manager = new ChiefThreadManager({ dataDir, defaultProvider: "codex" });
    await manager.init();

    const cases: ReadonlyArray<readonly [string, string]> = [
      ["dsh", "dsh"],
      ["deepseek-harness", "dsh"],
      ["pi", "pi"],
      ["pi-coding-agent", "pi"],
      ["glm-acp-agent", "glm-acp-agent"],
      ["qwen-code", "qwen-code"],
      ["kimi-code", "kimi-code"]
    ];

    for (const [requested, expected] of cases) {
      const switched = await manager.switchProvider(requested, `${expected}-model`, "high");
      assert.equal(switched.activeProvider, expected);
      assert.equal(switched.model, `${expected}-model`);

      const reloaded = await new ChiefThreadManager({ dataDir }).init();
      assert.equal(reloaded.activeProvider, expected);
      assert.equal(reloaded.model, `${expected}-model`);
      assert.equal(reloaded.switchHistory.at(-1)?.toProvider, expected);
    }

    for (const rejected of ["omp", "oh-my-pi", "", "bad provider!", "../etc", "__proto__"]) {
      await assert.rejects(
        () => manager.switchProvider(rejected),
        /Invalid Chief provider/
      );
    }
  });
});
