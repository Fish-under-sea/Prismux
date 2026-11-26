import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import type {
  ChiefThreadSlotState,
  DaemonHealthResponse,
  PtyReplayFrame,
  PtyReplayResult,
  PtySessionDescriptor
} from "@prismux/protocol";
import { WebSocket, WebSocketServer } from "ws";

interface DaemonReadyPayload {
  port: number;
  host: string;
  httpUrl: string;
  wsUrl: string;
  pairingCode: string;
  pairingExpiresAt: number;
  t3Connected: boolean;
  headless: boolean;
  dataDir: string;
  chiefThreadId: string;
}

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

async function waitForCondition(
  predicate: () => Promise<boolean>,
  timeoutMs = 8_000,
  intervalMs = 40
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, intervalMs));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms.`);
}

async function connectWs(
  url: string,
  headers?: Record<string, string>
): Promise<WebSocket> {
  return new Promise<WebSocket>((resolveWs, rejectWs) => {
    const ws = new WebSocket(url, { headers });
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
  params: Record<string, unknown> = {}
): Promise<TResult> {
  return new Promise<TResult>((resolveRpc, rejectRpc) => {
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
      if (parsed.ok !== true) {
        rejectRpc(new Error(`WS RPC ${method} failed: ${JSON.stringify(parsed.error)}`));
        return;
      }
      resolveRpc(parsed.result as TResult);
    };

    ws.on("message", onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const tempDirs: string[] = [];
const activeCleanups: Array<() => Promise<void>> = [];

after(async () => {
  while (activeCleanups.length > 0) {
    const fn = activeCleanups.pop();
    if (fn !== undefined) {
      await fn();
    }
  }
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("daemon CLI end-to-end: auth/pairing, T3 bridge, PTY reconnect lossless replay, chief switch, and clean shutdown", async () => {
  const tempDataDir = mkdtempSync(join(tmpdir(), "prismux-daemon-e2e-"));
  tempDirs.push(tempDataDir);

  const mockT3Token = "t3-secret-token";
  const staticAuthToken = "daemon-static-token";
  const ensureThreadCalls: Array<{
    workspacePath: string;
    provider: string;
    model?: string;
  }> = [];

  // 1. Start local mock T3 WebSocketServer validating orchestrationProtocol=2 & Bearer auth.
  const mockT3Wss = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
    verifyClient: (info, callback) => {
      const url = new URL(info.req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/ws") {
        callback(false, 404, "Not Found");
        return;
      }
      if (url.searchParams.get("orchestrationProtocol") !== "2") {
        callback(false, 426, "Upgrade Required");
        return;
      }
      if (info.req.headers.authorization !== `Bearer ${mockT3Token}`) {
        callback(false, 401, "Unauthorized");
        return;
      }
      callback(true);
    }
  });

  await new Promise<void>((resolveReady) => {
    mockT3Wss.once("listening", () => resolveReady());
  });
  activeCleanups.push(
    () =>
      new Promise<void>((resolveClose) => {
        for (const client of mockT3Wss.clients) {
          client.terminate();
        }
        mockT3Wss.close(() => resolveClose());
      })
  );

  mockT3Wss.on("connection", (ws) => {
    ws.on("message", (rawData: WebSocket.RawData) => {
      const parsed = JSON.parse(rawDataToString(rawData)) as unknown;
      if (!isRecord(parsed) || typeof parsed.id !== "string") {
        return;
      }
      const method = parsed.method;
      const params = isRecord(parsed.params) ? parsed.params : {};
      if (method === "server.probe") {
        ws.send(JSON.stringify({ id: parsed.id, ok: true, result: { pong: true } }));
        return;
      }
      if (method === "chief.ensureThread") {
        const record = {
          workspacePath: String(params.workspacePath ?? ""),
          provider: String(params.provider ?? ""),
          ...(typeof params.model === "string" ? { model: params.model } : {})
        };
        ensureThreadCalls.push(record);
        ws.send(
          JSON.stringify({
            id: parsed.id,
            ok: true,
            result: { ensured: true, ...record }
          })
        );
        return;
      }
      ws.send(
        JSON.stringify({
          id: parsed.id,
          ok: false,
          error: { code: "unknown_method", message: String(method) }
        })
      );
    });
  });

  const t3Addr = mockT3Wss.address() as AddressInfo;
  const mockT3Url = `ws://127.0.0.1:${t3Addr.port}/ws`;

  // 2. Spawn real daemon CLI process (`node apps/daemon/dist/cli.js start --headless ...`).
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const cliPath = resolve(currentDir, "../cli.js");

  let daemonChild: ChildProcess | undefined;
  let daemonExited = false;
  const daemonExitPromise = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolveExit) => {
    daemonChild = spawn(
      process.execPath,
      [
        cliPath,
        "start",
        "--headless",
        "--port",
        "0",
        "--host",
        "127.0.0.1",
        "--prismux-url",
        mockT3Url,
        "--prismux-token",
        mockT3Token,
        "--auth-token",
        staticAuthToken,
        "--data-dir",
        tempDataDir
      ],
      {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1"
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      }
    );

    daemonChild.once("exit", (code, signal) => {
      daemonExited = true;
      resolveExit({ code, signal });
    });
  });

  activeCleanups.push(async () => {
    if (daemonChild !== undefined && !daemonExited) {
      daemonChild.kill("SIGKILL");
      await daemonExitPromise;
    }
  });

  const readyInfo = await new Promise<DaemonReadyPayload>((resolveReady, rejectReady) => {
    const child = daemonChild;
    if (child === undefined || child.stdout === null || child.stderr === null) {
      rejectReady(new Error("Daemon child stdio missing."));
      return;
    }

    let stdoutBuffer = "";
    let stderrBuffer = "";
    const timer = setTimeout(() => {
      rejectReady(
        new Error(
          `Timed out waiting for PRISMUX_DAEMON_READY. stdout=${stdoutBuffer} stderr=${stderrBuffer}`
        )
      );
    }, 10_000);

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString("utf8");
    });

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const prefix = "PRISMUX_DAEMON_READY ";
        if (line.startsWith(prefix)) {
          clearTimeout(timer);
          resolveReady(JSON.parse(line.slice(prefix.length)) as DaemonReadyPayload);
          return;
        }
      }
    });

    child.once("exit", (code) => {
      clearTimeout(timer);
      rejectReady(
        new Error(`Daemon exited prematurely with code=${String(code)} stderr=${stderrBuffer}`)
      );
    });
  });

  assert.equal(readyInfo.headless, true);
  assert.equal(readyInfo.t3Connected, true);
  assert.ok(readyInfo.port > 0);
  assert.ok(readyInfo.pairingCode.length > 0);

  // 3. Verify GET /health
  const healthRes = await fetch(`${readyInfo.httpUrl}/health`);
  assert.equal(healthRes.status, 200);
  const health = (await healthRes.json()) as DaemonHealthResponse;
  assert.equal(health.ok, true);
  assert.equal(health.headless, true);
  assert.equal(health.t3Connected, true);
  assert.equal(health.activeProvider, "claude-code");

  // 4. Verify unauthorized access is rejected with 401 and pairing exchange issues a valid device token
  const unauthHttp = await fetch(`${readyInfo.httpUrl}/v1/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "unauth-1", method: "pty.list", params: {} })
  });
  assert.equal(unauthHttp.status, 401);

  await assert.rejects(
    () => connectWs(readyInfo.wsUrl),
    /WS_REJECTED_401/
  );

  const badPairRes = await fetch(`${readyInfo.httpUrl}/v1/pair/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pairingCode: "WRONG-CODE" })
  });
  assert.equal(badPairRes.status, 401);

  const pairRes = await fetch(`${readyInfo.httpUrl}/v1/pair/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pairingCode: readyInfo.pairingCode,
      deviceLabel: "e2e-desktop"
    })
  });
  assert.equal(pairRes.status, 200);
  const pairPayload = (await pairRes.json()) as { token: string };
  assert.ok(pairPayload.token.length > 10);
  const deviceToken = pairPayload.token;

  // Pairing code must be single-use
  const reusePairRes = await fetch(`${readyInfo.httpUrl}/v1/pair/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pairingCode: readyInfo.pairingCode })
  });
  assert.equal(reusePairRes.status, 401);

  // 5. WS Client A spawns an interactive Node PTY child, receives batch 1, then disconnects
  const wsClientA = await connectWs(readyInfo.wsUrl, {
    Authorization: `Bearer ${deviceToken}`
  });
  activeCleanups.push(() => closeWs(wsClientA));

  const ptyFramesA: PtyReplayFrame[] = [];
  wsClientA.on("message", (rawData: WebSocket.RawData) => {
    const msg = JSON.parse(rawDataToString(rawData)) as unknown;
    if (isRecord(msg) && msg.type === "pty.frame" && isRecord(msg.frame)) {
      ptyFramesA.push(msg.frame as unknown as PtyReplayFrame);
    }
  });

  const ptyScript = [
    "const rl = require('node:readline').createInterface({ input: process.stdin });",
    "console.log('PTY_BOOT_ENV_CLEAN=' + String(process.env.ELECTRON_RUN_AS_NODE === undefined));",
    "rl.on('line', (line) => {",
    "  console.log('ECHO:' + line);",
    "  if (line === 'QUIT') process.exit(0);",
    "});"
  ].join(" ");

  const spawnResult = await sendWsRpc<{ session: PtySessionDescriptor }>(
    wsClientA,
    "spawn-1",
    "pty.spawn",
    {
      ptyId: "e2e-pty-1",
      command: process.execPath,
      args: ["-e", ptyScript]
    }
  );
  assert.equal(spawnResult.session.ptyId, "e2e-pty-1");

  await sendWsRpc(wsClientA, "sub-1", "pty.subscribe", {
    ptyId: "e2e-pty-1",
    fromSeq: 0
  });

  await sendWsRpc(wsClientA, "write-1", "pty.write", {
    ptyId: "e2e-pty-1",
    data: "BATCH_ONE\n"
  });

  await waitForCondition(async () => {
    const combined = ptyFramesA.map((f) => f.data).join("");
    return (
      combined.includes("PTY_BOOT_ENV_CLEAN=true") &&
      combined.includes("ECHO:BATCH_ONE")
    );
  });

  // Disconnect WS Client A while PTY stays alive
  await closeWs(wsClientA);

  // 6. Write second batch via authenticated HTTP POST /v1/rpc while no WS client is attached
  const writeHttpRes = await fetch(`${readyInfo.httpUrl}/v1/rpc`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${deviceToken}`
    },
    body: JSON.stringify({
      id: "http-write-2",
      method: "pty.write",
      params: { ptyId: "e2e-pty-1", data: "BATCH_TWO\n" }
    })
  });
  assert.equal(writeHttpRes.status, 200);
  const writeHttpPayload = (await writeHttpRes.json()) as {
    ok: boolean;
    result: { accepted: boolean };
  };
  assert.equal(writeHttpPayload.ok, true);
  assert.equal(writeHttpPayload.result.accepted, true);

  // 7. Reconnect WS Client B with paired token and verify 100% lossless replay of pre + during disconnect frames
  const wsClientB = await connectWs(
    `${readyInfo.wsUrl}?token=${encodeURIComponent(deviceToken)}`
  );
  activeCleanups.push(() => closeWs(wsClientB));

  let replayedText = "";
  await waitForCondition(async () => {
    const replay = await sendWsRpc<PtyReplayResult>(
      wsClientB,
      `replay-${Date.now()}`,
      "pty.replay",
      { ptyId: "e2e-pty-1", fromSeq: 0 }
    );
    replayedText = replay.frames.map((f) => f.data).join("");
    return replayedText.includes("ECHO:BATCH_TWO");
  });

  assert.ok(replayedText.includes("PTY_BOOT_ENV_CLEAN=true"));
  assert.ok(replayedText.includes("ECHO:BATCH_ONE"));
  assert.ok(replayedText.includes("ECHO:BATCH_TWO"));

  // 8. Hot-switch Chief Supervisor slot to antigravity (gemini-4-neon)
  const switchResult = await sendWsRpc<{ slot: ChiefThreadSlotState }>(
    wsClientB,
    "switch-1",
    "chief.switchProvider",
    { provider: "antigravity", model: "gemini-4-neon" }
  );
  assert.equal(switchResult.slot.activeProvider, "antigravity");
  assert.equal(switchResult.slot.model, "gemini-4-neon");
  assert.equal(switchResult.slot.threadId, readyInfo.chiefThreadId);
  assert.ok(
    ensureThreadCalls.some(
      (call) =>
        call.provider === "antigravity" && call.model === "gemini-4-neon"
    )
  );

  // 9. Request graceful shutdown via authenticated RPC and verify exit code 0
  const shutdownResult = await sendWsRpc<{ shuttingDown: boolean }>(
    wsClientB,
    "shutdown-1",
    "daemon.shutdown",
    { reason: "e2e-complete" }
  );
  assert.equal(shutdownResult.shuttingDown, true);

  const exitOutcome = await Promise.race([
    daemonExitPromise,
    new Promise<never>((_, rejectTimeout) =>
      setTimeout(() => rejectTimeout(new Error("Daemon shutdown timed out")), 6_000)
    )
  ]);
  assert.equal(exitOutcome.code, 0);
});
