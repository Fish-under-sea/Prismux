import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import type {
  ApprovalGuideCard,
  HookInvocationContext,
  IslandHookEvent,
  IslandHookResponse,
  LifecycleHookEvent,
  PluginContext,
  PluginCredentialsHandle,
  PluginDisposable
} from "@prismux/protocol";
import {
  FishDockIslandBridge,
  FishDockPushError,
  apply,
  applyWithOptions,
  createApprovalIslandCard,
  createEmailIslandCard,
  createFactoryCompleteIslandCard,
  manifest,
  validateEndpointUrl,
  type IslandApprovalDecision
} from "../index.js";

interface MockIslandReceiver {
  baseUrl: string;
  receivedCards: Array<{
    path: string;
    authorization?: string;
    card: IslandHookEvent;
  }>;
  setNextStatus: (status: number) => void;
  close: () => Promise<void>;
}

async function startMockFishDockServer(): Promise<MockIslandReceiver> {
  const receivedCards: MockIslandReceiver["receivedCards"] = [];
  let nextStatus = 200;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    req.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      const status = nextStatus;
      nextStatus = 200;

      if (status >= 200 && status < 300) {
        const card = JSON.parse(rawBody) as IslandHookEvent;
        receivedCards.push({
          path: req.url ?? "/",
          ...(typeof req.headers.authorization === "string"
            ? { authorization: req.headers.authorization }
            : {}),
          card
        });
      }

      const reply = JSON.stringify({ ok: status >= 200 && status < 300 });
      res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "content-length": String(Buffer.byteLength(reply))
      });
      res.end(reply);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${addr.port}/island/cards`,
    receivedCards,
    setNextStatus(status: number) {
      nextStatus = status;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  };
}

function createHarnessContext(): {
  ctx: PluginContext;
  hooks: Map<
    LifecycleHookEvent,
    Array<(context: HookInvocationContext) => Promise<unknown> | unknown>
  >;
  routes: Map<string, (payload: unknown) => Promise<unknown> | unknown>;
  disposables: PluginDisposable[];
  logs: Array<{ level: string; message: string }>;
  disposeAll: () => Promise<void>;
} {
  const credMap = new Map<string, string>();
  const hooks = new Map<
    LifecycleHookEvent,
    Array<(context: HookInvocationContext) => Promise<unknown> | unknown>
  >();
  const routes = new Map<string, (payload: unknown) => Promise<unknown> | unknown>();
  const disposables: PluginDisposable[] = [];
  const logs: Array<{ level: string; message: string }> = [];

  const credentials: PluginCredentialsHandle = {
    async get(key) {
      return credMap.get(key) ?? null;
    },
    async set(key, value) {
      credMap.set(key, value);
    },
    async delete(key) {
      credMap.delete(key);
    }
  };

  const ctx: PluginContext = {
    manifest,
    realm: "daemon",
    distribution: "managed",
    credentials,
    logger: {
      info(message) {
        logs.push({ level: "info", message });
      },
      warn(message) {
        logs.push({ level: "warn", message });
      },
      error(message) {
        logs.push({ level: "error", message });
      }
    },
    effect(disposable) {
      disposables.push(disposable);
    },
    onHook(event, handler) {
      const list = hooks.get(event) ?? [];
      list.push(handler);
      hooks.set(event, list);
      disposables.push(() => {
        const current = hooks.get(event) ?? [];
        hooks.set(
          event,
          current.filter((item) => item !== handler)
        );
      });
    },
    registerRoute(method, path, handler) {
      const key = `${method} ${path}`;
      routes.set(key, handler as (payload: unknown) => Promise<unknown> | unknown);
      disposables.push(() => {
        routes.delete(key);
      });
    }
  };

  return {
    ctx,
    hooks,
    routes,
    disposables,
    logs,
    async disposeAll() {
      while (disposables.length > 0) {
        const fn = disposables.pop();
        if (fn !== undefined) {
          await fn();
        }
      }
    }
  };
}

const cleanups: Array<() => Promise<void>> = [];

after(async () => {
  while (cleanups.length > 0) {
    const fn = cleanups.pop();
    if (fn !== undefined) {
      await fn();
    }
  }
});

test("FishDockIslandBridge converts and pushes all 3 Dynamic Island card types over real HTTP and routes callbacks", async () => {
  const receiver = await startMockFishDockServer();
  cleanups.push(() => receiver.close());

  const approvalDecisions: IslandApprovalDecision[] = [];
  const workbenchEvents: Array<{ cardId: string; deepLink?: string }> = [];
  const dismissedIds: string[] = [];

  const bridge = new FishDockIslandBridge({
    config: {
      endpointUrl: receiver.baseUrl,
      authToken: "fishdock-test-secret",
      timeoutMs: 2_000
    },
    onApprovalDecision(decision) {
      approvalDecisions.push(decision);
    },
    onOpenWorkbench(event) {
      workbenchEvents.push({
        cardId: event.cardId,
        ...(event.deepLink !== undefined ? { deepLink: event.deepLink } : {})
      });
    },
    onDismiss(event) {
      dismissedIds.push(event.cardId);
    }
  });

  // Backward-compatible export check
  const compatCard = createApprovalIslandCard({
    cardId: "compat-1",
    title: "兼容审批卡片",
    deepLink: "prismux://approval/compat-1"
  });
  assert.equal(compatCard.kind, "approval");
  assert.deepEqual(compatCard.actions, ["approve", "reject", "open_workbench"]);

  // 1. PreToolUse Chinese ApprovalGuideCard -> kind: "approval"
  const guideApprove: ApprovalGuideCard = {
    toolName: "run_command",
    actionSummary: "准备执行高危 Git 强制推送命令：git push --force",
    riskLevel: "high",
    triggerReason: "命中高危规则：强制推送可能覆盖远端提交历史",
    rawCommandOrTarget: "git push --force origin main"
  };

  let perCardDecision: IslandApprovalDecision | undefined;
  const approvalRes = await bridge.pushApprovalGuide(
    {
      requestId: "apr-101",
      threadId: "thread-alpha",
      sessionId: "sess-1",
      approvalGuide: guideApprove
    },
    (decision) => {
      perCardDecision = decision;
    }
  );
  assert.equal(approvalRes.pushResult.statusCode, 200);
  assert.equal(approvalRes.card.kind, "approval");
  assert.equal(approvalRes.card.riskLevel, "high");
  assert.deepEqual(approvalRes.card.approvalGuide, guideApprove);
  assert.deepEqual(approvalRes.card.actions, [
    "approve",
    "reject",
    "open_workbench"
  ]);

  // Second approval card to test `reject` routing
  const guideReject: ApprovalGuideCard = {
    toolName: "write_file",
    actionSummary: "准备修改敏感凭据文件：.env.production",
    riskLevel: "high",
    triggerReason: "命中高危规则：修改敏感凭据文件"
  };
  const rejectRes = await bridge.pushApprovalGuide({
    requestId: "apr-102",
    threadId: "thread-beta",
    approvalGuide: guideReject
  });

  // 2. Important email alert -> kind: "email"
  const emailRes = await bridge.pushEmailAlert({
    messageId: "mail-889",
    from: "boss@example.com",
    subject: "紧急：凌晨发布窗口调整",
    snippet: "请确认夜间工场 PR 在 06:00 前合并",
    importance: "high",
    threadId: "thread-mail-1"
  });
  assert.equal(emailRes.card.kind, "email");
  assert.match(emailRes.card.title, /重要邮件/);

  // 3. Overnight factory completion report -> kind: "factory_complete" with prismux://review/<threadId>
  const factoryRes = await bridge.pushFactoryComplete({
    jobId: "job-777",
    threadId: "thread-factory-99",
    branchName: "factory/overnight-fix",
    summary: "修复了 WebSocket 断连重放竞争条件并通过全部 42 项单测",
    changedFilesCount: 4
  });
  assert.equal(factoryRes.card.kind, "factory_complete");
  assert.equal(
    factoryRes.card.deepLink,
    "prismux://review/thread-factory-99"
  );

  // Verify mock FISH-Dock receiver actually received all 4 HTTP POST requests with Bearer token
  assert.equal(receiver.receivedCards.length, 4);
  assert.equal(
    receiver.receivedCards[0]?.authorization,
    "Bearer fishdock-test-secret"
  );
  assert.equal(receiver.receivedCards[0]?.card.kind, "approval");
  assert.equal(receiver.receivedCards[2]?.card.kind, "email");
  assert.equal(receiver.receivedCards[3]?.card.kind, "factory_complete");
  assert.equal(
    receiver.receivedCards[3]?.card.deepLink,
    "prismux://review/thread-factory-99"
  );

  // Route `open_workbench` action on factory_complete card
  const openRes = await bridge.handleActionCallback({
    cardId: factoryRes.card.cardId,
    action: "open_workbench",
    respondedAt: Date.now()
  });
  assert.equal(openRes.handled, true);
  assert.equal(openRes.status, "opened");
  assert.equal(openRes.deepLink, "prismux://review/thread-factory-99");
  assert.equal(workbenchEvents.length, 1);

  // Route `approve` receipt back to host approval callback
  const approveCallback: IslandHookResponse = {
    cardId: approvalRes.card.cardId,
    action: "approve",
    respondedAt: 1_700_000_111_000
  };
  const approveRouteResult = await bridge.handleActionCallback(approveCallback);
  assert.equal(approveRouteResult.handled, true);
  assert.equal(approveRouteResult.status, "approved");
  assert.equal(approveRouteResult.allow, true);
  assert.equal(approveRouteResult.requestId, "apr-101");
  assert.equal(perCardDecision?.allow, true);
  assert.equal(perCardDecision?.requestId, "apr-101");

  // Duplicate approval replay is blocked cleanly without re-firing callbacks
  const replayResult = await bridge.handleActionCallback(approveCallback);
  assert.equal(replayResult.handled, false);
  assert.equal(replayResult.status, "already_resolved");
  assert.equal(approvalDecisions.length, 1);

  // Route `reject` receipt back to host approval callback
  const rejectRouteResult = await bridge.handleActionCallback({
    cardId: rejectRes.card.cardId,
    action: "reject",
    respondedAt: 1_700_000_222_000
  });
  assert.equal(rejectRouteResult.handled, true);
  assert.equal(rejectRouteResult.status, "rejected");
  assert.equal(rejectRouteResult.allow, false);
  assert.equal(rejectRouteResult.requestId, "apr-102");
  assert.equal(approvalDecisions.length, 2);
  assert.equal(approvalDecisions[1]?.allow, false);
  assert.equal(bridge.getPendingCount(), 0);

  // Route `dismiss` on email card
  const dismissResult = await bridge.handleActionCallback({
    cardId: emailRes.card.cardId,
    action: "dismiss",
    respondedAt: Date.now()
  });
  assert.equal(dismissResult.handled, true);
  assert.equal(dismissResult.status, "dismissed");
  assert.deepEqual(dismissedIds, [emailRes.card.cardId]);

  // Verify HTTP non-2xx and invalid protocol errors
  receiver.setNextStatus(503);
  await assert.rejects(
    () => bridge.pushCard(createEmailIslandCard({ messageId: "m-err", from: "a@b.c", subject: "fail" })),
    (err: unknown) => err instanceof FishDockPushError && err.statusCode === 503
  );

  bridge.configure({ endpointUrl: "file:///tmp/not-http" });
  await assert.rejects(
    () => bridge.pushCard(createFactoryCompleteIslandCard({ jobId: "j-err", threadId: "t-err", summary: "bad" })),
    FishDockPushError
  );

  // HTTPS endpoint URL validation passes cleanly
  assert.equal(
    validateEndpointUrl("https://127.0.0.1:9443/island/cards").protocol,
    "https:"
  );

  // Timeout on stalled HTTP receiver triggers FishDockPushError
  const stalledServer = http.createServer(() => {
    // Intentionally never respond
  });
  await new Promise<void>((resolve) => {
    stalledServer.listen(0, "127.0.0.1", () => resolve());
  });
  const stalledAddr = stalledServer.address() as AddressInfo;
  cleanups.push(async () => {
    stalledServer.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      stalledServer.close((err) => (err ? reject(err) : resolve()));
    });
  });

  bridge.configure({
    endpointUrl: `http://127.0.0.1:${stalledAddr.port}/slow`,
    timeoutMs: 80
  });
  await assert.rejects(
    () => bridge.pushCard(createEmailIslandCard({ messageId: "m-timeout", from: "a@b.c", subject: "slow" })),
    (err: unknown) => err instanceof FishDockPushError && /timed out/i.test(err.message)
  );

  bridge.dispose();
});

test("plugin-fishdock-hook apply(ctx) wires hooks/routes and ctx.effect() clears all subscriptions & pending maps", async () => {
  const receiver = await startMockFishDockServer();
  cleanups.push(() => receiver.close());

  const harness = createHarnessContext();
  const decisions: IslandApprovalDecision[] = [];

  const bridge = applyWithOptions(harness.ctx, {
    onApprovalDecision(decision) {
      decisions.push(decision);
    }
  });

  // Configure endpoint via route (authToken saved to encrypted credentials handle)
  const configRoute = harness.routes.get("POST /plugins/fishdock-hook/config");
  assert.ok(configRoute);
  await configRoute({
    endpointUrl: receiver.baseUrl,
    authToken: "route-token-123"
  });
  assert.equal(
    await harness.ctx.credentials.get("fishdock:authToken"),
    "route-token-123"
  );

  // Dispatch PreToolUse hook -> pushes approval card automatically
  const preToolHandlers = harness.hooks.get("PreToolUse") ?? [];
  assert.equal(preToolHandlers.length, 1);
  await preToolHandlers[0]!({
    event: "PreToolUse",
    sessionId: "sess-hook",
    threadId: "thread-hook",
    permissionMode: "supervised",
    toolName: "run_command",
    toolInput: {
      approvalRequestId: "apr-hook-55",
      command: "rm -rf ./tmp-cache"
    },
    timestamp: 1_700_000_500_000
  });

  // Dispatch Notification hook for factory_complete
  const notifyHandlers = harness.hooks.get("Notification") ?? [];
  assert.equal(notifyHandlers.length, 1);
  await notifyHandlers[0]!({
    event: "Notification",
    sessionId: "sess-hook",
    threadId: "thread-factory-hook",
    permissionMode: "auto",
    toolInput: {
      kind: "factory_complete",
      factoryReport: {
        jobId: "job-hook-1",
        threadId: "thread-factory-hook",
        summary: "夜间任务构建完成"
      }
    },
    timestamp: 1_700_000_600_000
  });

  assert.equal(receiver.receivedCards.length, 2);
  assert.equal(receiver.receivedCards[0]?.card.kind, "approval");
  assert.equal(receiver.receivedCards[0]?.card.riskLevel, "high");
  assert.equal(receiver.receivedCards[1]?.card.kind, "factory_complete");
  assert.equal(
    receiver.receivedCards[1]?.card.deepLink,
    "prismux://review/thread-factory-hook"
  );

  // Route callback receipt via registered POST /plugins/fishdock-hook/callback
  const callbackRoute = harness.routes.get(
    "POST /plugins/fishdock-hook/callback"
  );
  assert.ok(callbackRoute);
  const callbackRes = (await callbackRoute({
    cardId: receiver.receivedCards[0]!.card.cardId,
    action: "approve",
    respondedAt: Date.now()
  })) as { handled: boolean; requestId?: string; allow?: boolean };

  assert.equal(callbackRes.handled, true);
  assert.equal(callbackRes.requestId, "apr-hook-55");
  assert.equal(callbackRes.allow, true);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0]?.requestId, "apr-hook-55");

  // Push another pending approval then test ctx.effect() disposal clears pending mappings
  await preToolHandlers[0]!({
    event: "PreToolUse",
    sessionId: "sess-hook-2",
    threadId: "thread-hook-2",
    permissionMode: "supervised",
    toolName: "write_file",
    toolInput: {
      approvalRequestId: "apr-hook-pending",
      filePath: ".env"
    },
    timestamp: 1_700_000_700_000
  });
  assert.equal(bridge.getPendingCount(), 1);

  await harness.disposeAll();
  assert.equal(bridge.isDisposed(), true);
  assert.equal(bridge.getPendingCount(), 0);
  assert.equal((harness.hooks.get("PreToolUse") ?? []).length, 0);
  assert.equal((harness.hooks.get("Notification") ?? []).length, 0);
  assert.equal(harness.routes.size, 0);

  // Default apply(ctx) export compatibility smoke test
  const defaultHarness = createHarnessContext();
  apply(defaultHarness.ctx);
  assert.equal((defaultHarness.hooks.get("PreToolUse") ?? []).length, 1);
  assert.equal(defaultHarness.routes.size, 4);
  await defaultHarness.disposeAll();
  assert.equal((defaultHarness.hooks.get("PreToolUse") ?? []).length, 0);
  assert.equal(defaultHarness.routes.size, 0);
});
