import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type {
  HandoffResult,
  MemoryQueryResponse,
  ObsidianImportResult
} from "@prismux/protocol";
import { WebSocket } from "ws";
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

async function connectWs(
  url: string,
  token: string
): Promise<WebSocket> {
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
): Promise<{ ok: true; result: TResult } | { ok: false; error: { code: string; message: string } }> {
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

test("daemon M2 integration: SQLite WAL persistence, physical qq_group REST/RPC isolation, Obsidian import, and Handoff/Dial/Approval loop", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "prismux-daemon-m2-data-"));
  const vaultDir = mkdtempSync(join(tmpdir(), "prismux-daemon-m2-vault-"));
  tempDirs.push(dataDir, vaultDir);

  const ownerToken = "owner-chief-token-001";
  const qqGroupToken = "qq-group-88888-token-001";

  const daemon = new PrismuxDaemon({
    headless: true,
    host: "127.0.0.1",
    port: 0,
    dataDir,
    machineId: "test-m2-machine",
    authToken: ownerToken
  });
  daemon.pairingManager.registerScopedToken(
    qqGroupToken,
    "qq_group:88888",
    "qq-plugin-group-88888"
  );

  const ready = await daemon.start();
  cleanups.push(async () => {
    await daemon.stop();
  });

  // Verify real SQLite WAL DB file was created on disk
  const dbPath = join(dataDir, "data", "memory.db");
  assert.equal(existsSync(dbPath), true);

  // 1. Unauthenticated calls to M2 REST endpoints must all return 401
  for (const endpoint of [
    "/v1/memory/query",
    "/v1/memory/upsert",
    "/v1/memory/import-obsidian"
  ]) {
    const res = await fetch(`${ready.httpUrl}${endpoint}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(res.status, 401, `Expected 401 on unauthenticated ${endpoint}`);
  }

  // 2. Owner populates private/chief, workspace/prismux, social/qq-group-88888, and social/qq-group-99999
  const seedEntries = [
    {
      namespace: "private/chief",
      kind: "fact",
      title: "Private Chief Secret",
      content: "Personal email key PRIVATE_SECRET_ALPHA belongs strictly to chief."
    },
    {
      namespace: "workspace/prismux",
      kind: "fact",
      title: "Prismux Repo Secret",
      content: "Internal architecture note WORKSPACE_SECRET_BETA for prismux repo."
    },
    {
      namespace: "social/qq-group-88888",
      kind: "member_profile",
      title: "Group 88888 Topic",
      content: "Group members discussed QQ_GROUP_TOPIC_GAMMA weekend meetup."
    },
    {
      namespace: "social/qq-group-99999",
      kind: "episodic",
      title: "Other Group Secret",
      content: "Unrelated group discussed OTHER_GROUP_DELTA secrets."
    }
  ];

  for (const entry of seedEntries) {
    const res = await fetch(`${ready.httpUrl}/v1/memory/upsert`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${ownerToken}`
      },
      body: JSON.stringify(entry)
    });
    assert.equal(res.status, 200);
  }

  // 3. Restricted qq_group:88888 token attempts forged owner_chief escalation on REST & RPC
  for (const forbiddenTerm of [
    "PRIVATE_SECRET_ALPHA",
    "WORKSPACE_SECRET_BETA",
    "OTHER_GROUP_DELTA"
  ]) {
    const restRes = await fetch(`${ready.httpUrl}/v1/memory/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${qqGroupToken}`
      },
      body: JSON.stringify({
        callerScope: "owner_chief",
        _callerScope: "owner_chief",
        namespaces: [
          "private/chief",
          "workspace/prismux",
          "social/qq-group-99999"
        ],
        query: forbiddenTerm
      })
    });
    assert.equal(restRes.status, 200);
    const restPayload = (await restRes.json()) as MemoryQueryResponse;
    assert.equal(
      restPayload.hits.length,
      0,
      `REST query for ${forbiddenTerm} must return 0 hits under qq_group:88888`
    );

    const rpcRes = await fetch(`${ready.httpUrl}/v1/rpc`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${qqGroupToken}`
      },
      body: JSON.stringify({
        id: `forged-${forbiddenTerm}`,
        method: "memory.query",
        params: {
          callerScope: "owner_chief",
          _callerScope: "owner_chief",
          namespaces: ["private/chief", "workspace/prismux"],
          query: forbiddenTerm
        }
      })
    });
    assert.equal(rpcRes.status, 200);
    const rpcPayload = (await rpcRes.json()) as {
      ok: boolean;
      result: MemoryQueryResponse;
    };
    assert.equal(rpcPayload.ok, true);
    assert.equal(
      rpcPayload.result.hits.length,
      0,
      `RPC query for ${forbiddenTerm} must return 0 hits under qq_group:88888`
    );
  }

  // Restricted qq_group:88888 token CAN query its own group namespace via WS RPC even if body claims private/chief
  const qqWs = await connectWs(ready.wsUrl, qqGroupToken);
  cleanups.push(() => closeWs(qqWs));

  const qqOwnRes = await sendWsRpc<MemoryQueryResponse>(
    qqWs,
    "qq-own-1",
    "memory.query",
    {
      callerScope: "owner_chief",
      namespaces: ["private/chief"],
      query: "QQ_GROUP_TOPIC_GAMMA"
    }
  );
  assert.equal(qqOwnRes.ok, true);
  if (qqOwnRes.ok) {
    assert.equal(qqOwnRes.result.hits.length, 1);
    assert.equal(qqOwnRes.result.hits[0]?.entry.namespace, "social/qq-group-88888");
  }

  // Restricted qq_group:88888 token receives 403 on unauthorized write or Obsidian import
  const qqForbiddenWrite = await fetch(`${ready.httpUrl}/v1/memory/upsert`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${qqGroupToken}`
    },
    body: JSON.stringify({
      namespace: "private/chief",
      kind: "fact",
      title: "Illegal Write",
      content: "Should be rejected with 403"
    })
  });
  assert.equal(qqForbiddenWrite.status, 403);

  const qqForbiddenRpcWrite = await sendWsRpc<{ id: string }>(
    qqWs,
    "qq-write-forbid",
    "memory.upsert",
    {
      namespace: "workspace/prismux",
      kind: "fact",
      title: "Illegal RPC Write",
      content: "Should be rejected"
    }
  );
  assert.equal(qqForbiddenRpcWrite.ok, false);
  if (!qqForbiddenRpcWrite.ok) {
    assert.equal(qqForbiddenRpcWrite.error.code, "forbidden");
  }

  const qqForbiddenImport = await fetch(
    `${ready.httpUrl}/v1/memory/import-obsidian`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${qqGroupToken}`
      },
      body: JSON.stringify({ vaultPath: vaultDir })
    }
  );
  assert.equal(qqForbiddenImport.status, 403);

  // 4. Owner imports an Obsidian vault with frontmatter, wikilinks, and .obsidian ignored
  mkdirSync(join(vaultDir, ".obsidian"), { recursive: true });
  mkdirSync(join(vaultDir, "daily"), { recursive: true });
  mkdirSync(join(vaultDir, "prismux"), { recursive: true });

  writeFileSync(
    join(vaultDir, ".obsidian", "workspace.md"),
    "# Internal Config\nIGNORED_OBSIDIAN_TOKEN",
    "utf8"
  );
  writeFileSync(
    join(vaultDir, "daily", "2026-11-22.md"),
    [
      "---",
      "title: Morning Chief Brief",
      "kind: episodic",
      "importance: 0.9",
      "tags: [chief, daily]",
      "---",
      "Reviewed [[Architecture Spec|Prismux Architecture]] and OBSIDIAN_MORNING_MARKER."
    ].join("\n"),
    "utf8"
  );
  writeFileSync(
    join(vaultDir, "prismux", "design.md"),
    "# Liquid Glass Notes\nConnected to [[WebWallGL]] with OBSIDIAN_DESIGN_MARKER.",
    "utf8"
  );

  const importRes = await fetch(`${ready.httpUrl}/v1/memory/import-obsidian`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${ownerToken}`
    },
    body: JSON.stringify({ vaultPath: vaultDir })
  });
  assert.equal(importRes.status, 200);
  const importResult = (await importRes.json()) as ObsidianImportResult;
  assert.equal(importResult.scannedFiles, 2);
  assert.equal(importResult.importedEntries, 2);

  const ownerQueryObsidian = await fetch(`${ready.httpUrl}/v1/memory/query`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${ownerToken}`
    },
    body: JSON.stringify({ query: "OBSIDIAN_MORNING_MARKER" })
  });
  assert.equal(ownerQueryObsidian.status, 200);
  const obsidianHits = (await ownerQueryObsidian.json()) as MemoryQueryResponse;
  assert.equal(obsidianHits.hits.length, 1);
  assert.equal(obsidianHits.hits[0]?.entry.namespace, "private/chief");
  assert.ok(
    obsidianHits.hits[0]?.entry.content.includes("Architecture Spec (Prismux Architecture)")
  );

  // 5. Owner executes handoff.execute, dial.setMode, and hooks.decideApproval via WS RPC
  const ownerWs = await connectWs(ready.wsUrl, ownerToken);
  cleanups.push(() => closeWs(ownerWs));

  const handoffRes = await sendWsRpc<HandoffResult>(
    ownerWs,
    "handoff-1",
    "handoff.execute",
    {
      sourceThreadId: "thread-m2-src",
      targetDialMode: "oracle",
      transcript: [
        {
          role: "user",
          content: "Goal: Implement isolated SQLite memory center in packages/memory-core/src/SqliteMemoryStore.ts"
        },
        {
          role: "assistant",
          content: "Decision: Enforce hardcoded qq_group SQL WHERE clause. Open question: Should backup run nightly?"
        }
      ]
    }
  );
  assert.equal(handoffRes.ok, true);
  if (handoffRes.ok) {
    assert.equal(handoffRes.result.dialMode, "oracle");
    assert.ok(handoffRes.result.newThreadId.startsWith("handoff-"));
    assert.ok(
      handoffRes.result.summary.touchedFiles.includes(
        "packages/memory-core/src/SqliteMemoryStore.ts"
      )
    );

    const dialRes = await sendWsRpc<{ threadId: string; mode: string }>(
      ownerWs,
      "dial-1",
      "dial.setMode",
      { threadId: handoffRes.result.newThreadId, mode: "review" }
    );
    assert.equal(dialRes.ok, true);
    if (dialRes.ok) {
      assert.equal(dialRes.result.mode, "review");
    }
  }

  // Trigger a supervised approval request on LifecycleHookBus and approve it via RPC
  const blockedDispatch = await daemon.hookBus.emit({
    event: "PreToolUse",
    sessionId: "sess-m2-1",
    threadId: "thread-m2-1",
    permissionMode: "supervised",
    toolName: "write_file",
    toolInput: { filePath: "apps/daemon/src/demo.ts" },
    timestamp: Date.now()
  });
  assert.equal(blockedDispatch.decision, "block");
  assert.equal(blockedDispatch.approvalRequired, true);
  assert.ok(blockedDispatch.approvalRequestId !== undefined);

  const approveRes = await sendWsRpc<{
    requestId: string;
    accepted: boolean;
    status: string;
  }>(ownerWs, "approve-1", "hooks.decideApproval", {
    requestId: blockedDispatch.approvalRequestId,
    allow: true,
    reason: "Approved during M2 integration test"
  });
  assert.equal(approveRes.ok, true);
  if (approveRes.ok) {
    assert.equal(approveRes.result.accepted, true);
    assert.equal(approveRes.result.status, "approved");
  }

  const allowedAfterApproval = await daemon.hookBus.emit({
    event: "PreToolUse",
    sessionId: "sess-m2-1",
    threadId: "thread-m2-1",
    permissionMode: "supervised",
    toolName: "write_file",
    toolInput: { filePath: "apps/daemon/src/demo.ts" },
    approvalRequestId: blockedDispatch.approvalRequestId,
    timestamp: Date.now()
  });
  assert.equal(allowedAfterApproval.decision, "allow");
});
